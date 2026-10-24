import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Order, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import {
  addHours,
  addMinutes,
  dealRules,
  DealRules,
} from '../common/utils/deal-rules';
import { CreateOrderDto } from './dto/create-order.dto';

type Tx = Prisma.TransactionClient;

// После оплаты стороны видят телефоны друг друга, чтобы договориться о передаче.
const CONTACTS_VISIBLE: OrderStatus[] = [
  'PAID',
  'HANDED_OVER',
  'DISPUTED',
  'COMPLETED',
];

const ORDER_INCLUDE = {
  listing: {
    select: {
      id: true,
      title: true,
      city: true,
      sector: true,
      row: true,
      seats: true,
      delivery: true,
    },
  },
  buyer: { select: { id: true, name: true, phone: true } },
  seller: { select: { id: true, name: true, phone: true, verified: true } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly rules: DealRules;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    config: ConfigService,
  ) {
    this.rules = dealRules(config);
  }

  private view(o: OrderRow) {
    const showContacts = CONTACTS_VISIBLE.includes(o.status);
    const person = <T extends { phone: string }>({ phone, ...p }: T) => ({
      ...p,
      phone: showContacts ? phone : null,
    });
    return { ...o, buyer: person(o.buyer), seller: person(o.seller) };
  }

  private async load(id: string) {
    const o = await this.prisma.order.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });
    if (!o) throw new NotFoundException('Заказ не найден');
    return o;
  }

  /** Атомарный переход статуса: если заказ уже не в ожидаемом статусе — 409. */
  private async transition(
    id: string,
    from: OrderStatus[],
    data: Prisma.OrderUpdateManyMutationInput,
    tx: Tx = this.prisma,
    extraWhere: Prisma.OrderWhereInput = {},
  ) {
    const res = await tx.order.updateMany({
      where: { id, status: { in: from }, ...extraWhere },
      data,
    });
    if (!res.count) throw new ConflictException('Статус заказа уже изменился');
  }

  /** Вернуть зарезервированные билеты в объявление (только для неоплаченных заказов). */
  private async releaseQty(tx: Tx, listingId: string, qty: number) {
    await tx.listing.update({
      where: { id: listingId },
      data: { qtyAvailable: { increment: qty } },
    });
    await tx.listing.updateMany({
      where: { id: listingId, status: 'SOLD', qtyAvailable: { gt: 0 } },
      data: { status: 'ACTIVE' },
    });
  }

  // ---------- покупатель ----------

  async create(buyerId: string, dto: CreateOrderDto) {
    const order = await this.prisma.$transaction(async (tx) => {
      const listing = await tx.listing.findUnique({
        where: { id: dto.listingId },
      });
      if (!listing || listing.status !== 'ACTIVE')
        throw new NotFoundException('Объявление недоступно');
      if (listing.sellerId === buyerId)
        throw new BadRequestException('Нельзя купить свой билет');

      // Резерв без гонок: списываем, только если билетов ещё хватает.
      const reserved = await tx.listing.updateMany({
        where: {
          id: listing.id,
          status: 'ACTIVE',
          qtyAvailable: { gte: dto.qty },
        },
        data: { qtyAvailable: { decrement: dto.qty } },
      });
      if (!reserved.count)
        throw new ConflictException('Столько билетов уже нет');
      await tx.listing.updateMany({
        where: { id: listing.id, qtyAvailable: 0 },
        data: { status: 'SOLD' },
      });

      const subtotal = listing.price * dto.qty;
      const fee = Math.round((subtotal * this.rules.feePercent) / 100);
      return tx.order.create({
        data: {
          listingId: listing.id,
          buyerId,
          sellerId: listing.sellerId,
          qty: dto.qty,
          unitPrice: listing.price,
          subtotal,
          fee,
          total: subtotal + fee,
          paymentMethod: dto.paymentMethod,
          expiresAt: addMinutes(new Date(), this.rules.paymentTimeoutMin),
        },
        include: ORDER_INCLUDE,
      });
    });
    return { order: this.view(order), payment: this.payments.checkout() };
  }

  /** Оплата для провайдера "mock" (разработка). */
  async payMock(buyerId: string, id: string) {
    if (!this.payments.isMock)
      throw new ForbiddenException('Оплата идёт через платёжную систему');
    const o = await this.load(id);
    if (o.buyerId !== buyerId) throw new ForbiddenException();
    await this.markPaid(id, `mock-${Date.now()}`);
    return this.view(await this.load(id));
  }

  /** Деньги поступили на счёт сервиса и заморожены. Вызывается платёжным провайдером. */
  async markPaid(id: string, paymentRef: string) {
    const now = new Date();
    await this.transition(
      id,
      ['PENDING_PAYMENT'],
      {
        status: 'PAID',
        paidAt: now,
        paymentRef,
        handoverDeadline: addHours(now, this.rules.handoverDeadlineHours),
      },
      this.prisma,
      { expiresAt: { gt: now } },
    );
  }

  async cancel(buyerId: string, id: string) {
    const o = await this.load(id);
    if (o.buyerId !== buyerId) throw new ForbiddenException();
    await this.cancelUnpaid(o);
    return this.view(await this.load(id));
  }

  private cancelUnpaid(o: Order) {
    return this.prisma.$transaction(async (tx) => {
      await this.transition(
        o.id,
        ['PENDING_PAYMENT'],
        { status: 'CANCELLED', cancelledAt: new Date() },
        tx,
      );
      await this.releaseQty(tx, o.listingId, o.qty);
    });
  }

  async confirm(buyerId: string, id: string) {
    const o = await this.load(id);
    if (o.buyerId !== buyerId) throw new ForbiddenException();
    await this.complete(id, ['HANDED_OVER']);
    return this.view(await this.load(id));
  }

  async dispute(buyerId: string, id: string, reason: string) {
    const o = await this.load(id);
    if (o.buyerId !== buyerId) throw new ForbiddenException();
    await this.transition(id, ['PAID', 'HANDED_OVER'], {
      status: 'DISPUTED',
      disputeReason: reason,
      disputedAt: new Date(),
    });
    return this.view(await this.load(id));
  }

  // ---------- продавец ----------

  async handover(sellerId: string, id: string) {
    const o = await this.load(id);
    if (o.sellerId !== sellerId) throw new ForbiddenException();
    const now = new Date();
    await this.transition(id, ['PAID'], {
      status: 'HANDED_OVER',
      handedOverAt: now,
      confirmDeadline: addHours(now, this.rules.confirmWindowHours),
    });
    return this.view(await this.load(id));
  }

  // ---------- общее ----------

  async get(userId: string, id: string) {
    const o = await this.load(id);
    if (o.buyerId !== userId && o.sellerId !== userId)
      throw new NotFoundException('Заказ не найден');
    return this.view(o);
  }

  async list(where: Prisma.OrderWhereInput) {
    const rows = await this.prisma.order.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((o) => this.view(o));
  }

  /** Завершить сделку: деньги уходят продавцу (выплата в статусе PENDING). */
  async complete(id: string, from: OrderStatus[], resolutionNote?: string) {
    const now = new Date();
    await this.transition(id, from, {
      status: 'COMPLETED',
      completedAt: now,
      payoutStatus: 'PENDING',
      ...(resolutionNote !== undefined
        ? { resolutionNote, resolvedAt: now }
        : {}),
    });
  }

  /** Вернуть покупателю всю сумму. Билеты в объявление не возвращаются: продавец сделку не выполнил. */
  async refund(id: string, from: OrderStatus[], resolutionNote?: string) {
    const now = new Date();
    await this.transition(id, from, {
      status: 'REFUNDED',
      refundedAt: now,
      ...(resolutionNote !== undefined
        ? { resolutionNote, resolvedAt: now }
        : {}),
    });
    await this.payments.refund(
      await this.prisma.order.findUniqueOrThrow({ where: { id } }),
    );
  }

  async markPayoutPaid(id: string) {
    const res = await this.prisma.order.updateMany({
      where: { id, status: 'COMPLETED', payoutStatus: 'PENDING' },
      data: { payoutStatus: 'PAID', payoutAt: new Date() },
    });
    if (!res.count) throw new ConflictException('Выплата не ожидается');
    return this.view(await this.load(id));
  }

  /** Сроки сделки. Запускается планировщиком раз в минуту. */
  async sweep(now = new Date()) {
    const pick = (where: Prisma.OrderWhereInput) =>
      this.prisma.order.findMany({ where, take: 200 });
    const safe = (label: string, fn: () => Promise<unknown>) =>
      fn().catch((e: unknown) => {
        if (!(e instanceof ConflictException))
          this.logger.error(`${label}: ${String(e)}`);
      });

    // 1. Не оплатили вовремя — снимаем резерв.
    for (const o of await pick({
      status: 'PENDING_PAYMENT',
      expiresAt: { lt: now },
    })) {
      await safe(`cancel ${o.id}`, () => this.cancelUnpaid(o));
    }
    // 2. Продавец не передал билет в срок — полный возврат покупателю.
    for (const o of await pick({
      status: 'PAID',
      handoverDeadline: { lt: now },
    })) {
      await safe(`refund ${o.id}`, () =>
        this.refund(o.id, ['PAID'], 'Продавец не передал билет в срок'),
      );
    }
    // 3. Покупатель не подтвердил и не открыл спор — сделка завершается.
    for (const o of await pick({
      status: 'HANDED_OVER',
      confirmDeadline: { lt: now },
    })) {
      await safe(`complete ${o.id}`, () =>
        this.complete(o.id, ['HANDED_OVER']),
      );
    }
  }
}
