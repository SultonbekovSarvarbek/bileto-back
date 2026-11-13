import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestsService } from '../requests/requests.service';
import { maskPhone } from '../common/utils/phone';
import { verifyInitData } from '../common/utils/telegram-init-data';
import { CreateOfferDto } from './dto/create-offer.dto';

const MAX_OFFERS_PER_HOUR = 10;

export const OFFER_INCLUDE = {
  listing: {
    select: {
      id: true,
      title: true,
      sellerId: true,
      seller: { select: { telegramId: true } },
    },
  },
  user: { select: { telegramId: true } },
  request: { select: { number: true } },
} satisfies Prisma.PriceOfferInclude;
export type OfferRow = Prisma.PriceOfferGetPayload<{
  include: typeof OFFER_INCLUDE;
}>;

// created — продавцу пришло предложение; accepted / declined — ответ покупателю.
export type OfferEvent = {
  type: 'created' | 'accepted' | 'declined';
  offer: OfferRow;
};

// Как покупатель подписан для продавца: имя из Telegram и размытый номер.
// Полный номер продавцу не показываем — сделку ведёт оператор.
export const offerBuyer = (o: { name: string; phone: string }) => ({
  name: o.name,
  phoneMasked: maskPhone(o.phone),
});

// Торг: покупатель предлагает цену за билет, у которого продавец отметил «торг уместен».
// Продавец принимает или отклоняет; принятое предложение становится обычной заявкой
// по договорной цене, дальше сделку ведёт оператор.
@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);
  private notify?: (e: OfferEvent) => Promise<unknown>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: RequestsService,
    private readonly config: ConfigService,
  ) {}

  /** Публичный бот подписывается, чтобы писать продавцу и покупателю в Telegram. */
  onEvent(handler: (e: OfferEvent) => Promise<unknown>) {
    this.notify = handler;
  }

  // Сбой уведомления не должен ломать само предложение: оно уже в базе и видно в «Моих».
  private async emit(type: OfferEvent['type'], offer: OfferRow) {
    try {
      await this.notify?.({ type, offer });
    } catch (e) {
      this.logger.error(`Предложение ${offer.id} (${type}): ${String(e)}`);
    }
  }

  // Имя из Telegram: бот передаёт его сам, мини-приложение — подписанным initData.
  private tgName(initData: string | undefined, telegramId: string | null) {
    const token = this.config.get<string>('TELEGRAM_PUBLIC_BOT_TOKEN');
    const tg = initData && token ? verifyInitData(initData, token) : null;
    if (!tg || String(tg.id) !== telegramId) return undefined;
    return [tg.first_name, tg.last_name].filter(Boolean).join(' ');
  }

  async create(userId: string, dto: CreateOfferDto, tgName?: string) {
    const buyer = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { phone: true, name: true, telegramId: true },
    });
    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
    });
    if (!listing || listing.status !== 'ACTIVE' || listing.deletedAt)
      throw new NotFoundException('Объявление недоступно');
    if (listing.sellerId === userId)
      throw new BadRequestException('Нельзя купить свой билет');
    if (!listing.negotiable)
      throw new ConflictException(
        'Продавец указал, что цена окончательная — торг не предусмотрен',
      );
    if (dto.qty > listing.qtyAvailable)
      throw new ConflictException(
        `В наличии только ${listing.qtyAvailable} шт.`,
      );
    if (dto.price >= listing.price)
      throw new BadRequestException(
        'Предложите цену ниже цены продавца — или оставьте обычную заявку',
      );

    const hourAgo = new Date(Date.now() - 3600_000);
    const [pending, openRequest, recent] = await Promise.all([
      this.prisma.priceOffer.count({
        where: { listingId: listing.id, userId, status: 'PENDING' },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          listingId: listing.id,
          phone: buyer.phone,
          status: { in: ['NEW', 'IN_PROGRESS'] },
        },
      }),
      this.prisma.priceOffer.count({
        where: { userId, createdAt: { gt: hourAgo } },
      }),
    ]);
    if (pending)
      throw new ConflictException(
        'Вы уже предложили цену за этот билет — дождитесь ответа продавца',
      );
    if (openRequest)
      throw new ConflictException(
        'Заявка на этот билет уже отправлена — оператор скоро свяжется с вами',
      );
    if (recent >= MAX_OFFERS_PER_HOUR)
      throw new HttpException(
        'Слишком много предложений, попробуйте позже',
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const name = (
      tgName ||
      this.tgName(dto.initData, buyer.telegramId) ||
      buyer.name ||
      ''
    )
      .trim()
      .slice(0, 60);
    const offer = await this.prisma.priceOffer.create({
      data: {
        listingId: listing.id,
        userId,
        name: name.length >= 2 ? name : 'Покупатель',
        phone: buyer.phone,
        qty: dto.qty,
        price: dto.price,
        listPrice: listing.price,
      },
      include: OFFER_INCLUDE,
    });
    await this.emit('created', offer);
    return this.toBuyer(offer);
  }

  /** Ответ продавца. Принятое предложение сразу становится заявкой по договорной цене. */
  async respond(sellerId: string, id: string, accept: boolean) {
    const found = await this.prisma.priceOffer.findUnique({
      where: { id },
      include: OFFER_INCLUDE,
    });
    if (!found || found.listing.sellerId !== sellerId)
      throw new NotFoundException('Предложение не найдено');
    const pending = { id, status: 'PENDING' as const };
    const claimed = await this.prisma.priceOffer.updateMany({
      where: pending,
      data: { status: accept ? 'ACCEPTED' : 'DECLINED' },
    });
    if (!claimed.count)
      throw new ConflictException('На это предложение уже ответили');

    if (accept) {
      try {
        await this.requests.create(
          {
            listingId: found.listingId,
            qty: found.qty,
            name: found.name,
            phone: found.phone,
          },
          found.userId,
          { id, price: found.price },
        );
      } catch (e) {
        // Заявка не создалась (билет продан, снят…) — предложение остаётся без ответа.
        await this.prisma.priceOffer.update({
          where: { id },
          data: { status: 'PENDING' },
        });
        throw e;
      }
    }
    const offer = await this.prisma.priceOffer.findUniqueOrThrow({
      where: { id },
      include: OFFER_INCLUDE,
    });
    await this.emit(accept ? 'accepted' : 'declined', offer);
    return this.toSeller(offer);
  }

  async mine(userId: string) {
    const rows = await this.prisma.priceOffer.findMany({
      where: { userId },
      include: OFFER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((o) => this.toBuyer(o));
  }

  async incoming(sellerId: string) {
    const rows = await this.prisma.priceOffer.findMany({
      where: {
        status: 'PENDING',
        listing: { sellerId, status: 'ACTIVE', deletedAt: null },
      },
      include: OFFER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((o) => this.toSeller(o));
  }

  private base(o: OfferRow) {
    return {
      id: o.id,
      listing: { id: o.listing.id, title: o.listing.title },
      qty: o.qty,
      price: o.price,
      listPrice: o.listPrice,
      status: o.status,
      requestNumber: o.request?.number ?? null,
      createdAt: o.createdAt,
    };
  }

  private toBuyer(o: OfferRow) {
    return this.base(o);
  }

  private toSeller(o: OfferRow) {
    return { ...this.base(o), buyer: offerBuyer(o) };
  }
}
