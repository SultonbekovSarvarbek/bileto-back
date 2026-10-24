import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, RequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  actorName,
  CallbackQuery,
  TelegramService,
} from '../telegram/telegram.service';
import { normalizeUzPhone } from '../common/utils/phone';
import { priceBreakdown } from '../common/utils/money';
import { CreateRequestDto } from './dto/create-request.dto';
import {
  listingButtons,
  listingText,
  REQUEST_INCLUDE,
  requestButtons,
  requestText,
} from './request.messages';

const MAX_REQUESTS_PER_HOUR = 10;
const OPEN: RequestStatus[] = ['NEW', 'IN_PROGRESS'];

@Injectable()
export class RequestsService implements OnModuleInit {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  onModuleInit() {
    this.telegram.onCallback((q) => this.handleCallback(q));
  }

  async create(dto: CreateRequestDto, userId?: string) {
    const phone = normalizeUzPhone(dto.phone);
    if (!phone) throw new BadRequestException('Неверный номер телефона');

    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
    });
    if (!listing || listing.status !== 'ACTIVE')
      throw new NotFoundException('Объявление недоступно');
    if (userId && listing.sellerId === userId)
      throw new BadRequestException('Нельзя купить свой билет');
    if (dto.qty > listing.qtyAvailable)
      throw new ConflictException(
        `В наличии только ${listing.qtyAvailable} шт.`,
      );

    const hourAgo = new Date(Date.now() - 3600_000);
    const recent = await this.prisma.purchaseRequest.findMany({
      where: { phone, createdAt: { gt: hourAgo } },
      select: { listingId: true, status: true },
    });
    if (
      recent.some((r) => r.listingId === listing.id && OPEN.includes(r.status))
    ) {
      throw new ConflictException(
        'Заявка на этот билет уже отправлена — оператор скоро свяжется с вами',
      );
    }
    if (recent.length >= MAX_REQUESTS_PER_HOUR) {
      throw new HttpException(
        'Слишком много заявок, попробуйте позже',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const created = await this.prisma.purchaseRequest.create({
      data: {
        listingId: listing.id,
        userId,
        name: dto.name.trim(),
        phone,
        qty: dto.qty,
        ...priceBreakdown(listing.price, dto.qty),
      },
      include: REQUEST_INCLUDE,
    });

    // Сбой Telegram не должен терять заявку: она уже в БД, оператор увидит её в /admin/requests.
    try {
      const messageId = await this.telegram.send(
        requestText(created),
        requestButtons(created),
      );
      if (messageId) {
        await this.prisma.purchaseRequest.update({
          where: { id: created.id },
          data: { tgMessageId: messageId },
        });
      }
    } catch (e) {
      this.logger.error(
        `Заявка #${created.number} не отправлена в Telegram: ${String(e)}`,
      );
    }
    return this.toPublic(created);
  }

  private toPublic(
    r: Prisma.PurchaseRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>,
  ) {
    const { listing, tgMessageId, ...rest } = r;
    void tgMessageId; // служебное поле Telegram наружу не отдаём
    return {
      ...rest,
      listing: {
        id: listing.id,
        title: listing.title,
        sector: listing.sector,
        row: listing.row,
      },
    };
  }

  async mine(userId: string) {
    const rows = await this.prisma.purchaseRequest.findMany({
      where: { userId },
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toPublic(r));
  }

  /** Смена статуса оператором. DONE списывает билеты с объявления. */
  async setStatus(id: string, status: RequestStatus) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.purchaseRequest.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Заявка не найдена');
      if (!OPEN.includes(r.status))
        throw new ConflictException('Заявка уже закрыта');

      if (status === 'DONE') {
        const taken = await tx.listing.updateMany({
          where: { id: r.listingId, qtyAvailable: { gte: r.qty } },
          data: { qtyAvailable: { decrement: r.qty } },
        });
        if (!taken.count)
          throw new ConflictException('В объявлении не хватает билетов');
        await tx.listing.updateMany({
          where: { id: r.listingId, qtyAvailable: 0 },
          data: { status: 'SOLD' },
        });
      }
      const moved = await tx.purchaseRequest.updateMany({
        where: { id, status: { in: OPEN } },
        data: { status },
      });
      if (!moved.count) throw new ConflictException('Заявка уже закрыта');
      return tx.purchaseRequest.findUniqueOrThrow({
        where: { id },
        include: REQUEST_INCLUDE,
      });
    });
  }

  async handleCallback(q: CallbackQuery): Promise<string> {
    const [kind, id, action] = (q.data ?? '').split(':');
    const who = actorName(q);

    if (kind === 'r' && id && action && action in RequestStatus) {
      try {
        const r = await this.setStatus(id, action as RequestStatus);
        if (r.tgMessageId)
          await this.telegram.edit(
            r.tgMessageId,
            requestText(r, who),
            requestButtons(r),
          );
        return 'Готово';
      } catch (e) {
        if (e instanceof HttpException) return e.message;
        throw e;
      }
    }

    if (kind === 'l' && id && action === 'reject') {
      const l = await this.prisma.listing.update({
        where: { id },
        data: { status: 'REJECTED', rejectReason: `Снято оператором: ${who}` },
        include: { seller: { select: { name: true, phone: true } } },
      });
      if (q.message)
        await this.telegram.edit(
          q.message.message_id,
          listingText(l, who),
          listingButtons(l, true),
          true,
        );
      return 'Объявление снято';
    }
    return 'Неизвестная команда';
  }
}
