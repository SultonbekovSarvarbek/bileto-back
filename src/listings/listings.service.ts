import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ListingStatus, Prisma } from '@prisma/client';
import { unlink } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { listingButtons, listingText } from '../requests/request.messages';
import { photoUrl } from '../common/utils/upload';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { LISTING_PUBLIC_SELECT, toPublicListing } from './listing.view';
import { stripContacts } from '../common/utils/contacts';
import { softDeleteListing } from './listing.delete';

// Пустое описание после чистки контактов храним как null.
const cleanDescription = (s?: string) => (s && stripContacts(s)) || null;

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  async feed({ city, q, page, limit }: FeedQueryDto) {
    const query = q?.trim();
    const where: Prisma.ListingWhereInput = {
      status: 'ACTIVE',
      deletedAt: null,
      qtyAvailable: { gt: 0 },
      ...(city ? { city } : {}),
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        select: LISTING_PUBLIC_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.listing.count({ where }),
    ]);
    return { items: rows.map(toPublicListing), total, page, limit };
  }

  async getPublic(id: string, viewerId?: string) {
    const row = await this.prisma.listing.findFirst({
      where: { id, deletedAt: null },
      select: { ...LISTING_PUBLIC_SELECT, sellerId: true },
    });
    const visible =
      row &&
      (row.status === 'ACTIVE' ||
        row.status === 'SOLD' ||
        row.sellerId === viewerId);
    if (!visible) throw new NotFoundException('Объявление не найдено');
    if (row.sellerId !== viewerId) {
      await this.prisma.listing.update({
        where: { id },
        data: { views: { increment: 1 } },
      });
    }
    return toPublicListing(row);
  }

  // Фото необязательно: без него объявление выходит без обложки.
  async create(sellerId: string, dto: CreateListingDto, proofPath?: string) {
    const seller = await this.prisma.user.findUniqueOrThrow({
      where: { id: sellerId },
      select: { role: true },
    });
    if (seller.role !== 'SELLER') {
      if (proofPath) await unlink(proofPath).catch(() => undefined);
      throw new ForbiddenException(
        'Продавать билеты могут только продавцы — смените роль в профиле',
      );
    }
    const created = await this.prisma.listing.create({
      data: {
        ...dto,
        description: cleanDescription(dto.description),
        sellerId,
        proofPath,
        coverUrl: proofPath ? photoUrl(proofPath) : null,
        qtyAvailable: dto.qty,
      },
      include: { seller: { select: { name: true, phone: true } } },
    });
    // Операторы видят каждое новое объявление (с фото, если оно есть) и могут снять подделку.
    const text = listingText(created);
    const buttons = listingButtons(created);
    await (
      proofPath
        ? this.telegram.sendPhoto(proofPath, text, buttons)
        : this.telegram.send(text, buttons)
    ).catch((e: unknown) =>
      this.logger.error(
        `Объявление ${created.id} не ушло в Telegram: ${String(e)}`,
      ),
    );
    return this.getPublic(created.id, sellerId);
  }

  mine(sellerId: string, status?: ListingStatus) {
    return this.prisma.listing
      .findMany({
        where: { sellerId, deletedAt: null, ...(status ? { status } : {}) },
        select: LISTING_PUBLIC_SELECT,
        orderBy: { createdAt: 'desc' },
      })
      .then((rows) => rows.map(toPublicListing));
  }

  private async ownOrThrow(sellerId: string, id: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('Объявление не найдено');
    if (listing.sellerId !== sellerId) throw new ForbiddenException();
    if (listing.deletedAt) throw new NotFoundException('Объявление не найдено');
    return listing;
  }

  async update(
    sellerId: string,
    id: string,
    dto: UpdateListingDto,
    newProofPath?: string,
  ) {
    const listing = await this.ownOrThrow(sellerId, id);
    if (listing.status === 'REJECTED' || listing.status === 'ARCHIVED') {
      throw new ConflictException('Снятое объявление нельзя изменить');
    }

    // Уже проданные билеты нельзя «убрать» уменьшением количества.
    const taken = listing.qty - listing.qtyAvailable;
    const qty = dto.qty ?? listing.qty;
    if (qty < taken)
      throw new BadRequestException(
        `Нельзя меньше ${taken}: столько уже продано`,
      );
    const qtyAvailable = qty - taken;

    const row = await this.prisma.listing.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.description !== undefined
          ? { description: cleanDescription(dto.description) }
          : {}),
        qty,
        qtyAvailable,
        status: qtyAvailable > 0 ? 'ACTIVE' : 'SOLD',
        ...(newProofPath
          ? { proofPath: newProofPath, coverUrl: photoUrl(newProofPath) }
          : {}),
      },
      select: LISTING_PUBLIC_SELECT,
    });
    if (newProofPath && listing.proofPath)
      await unlink(listing.proofPath).catch(() => undefined);
    return toPublicListing(row);
  }

  async markSold(sellerId: string, id: string) {
    const listing = await this.ownOrThrow(sellerId, id);
    if (listing.status !== 'ACTIVE')
      throw new ConflictException('Объявление уже снято с продажи');
    await this.prisma.listing.update({
      where: { id },
      data: { status: 'SOLD', qtyAvailable: 0 },
    });
  }

  async archive(sellerId: string, id: string) {
    await this.ownOrThrow(sellerId, id);
    await this.prisma.listing.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
  }

  // Удаление продавцом: объявление пропадает из «Моих», ленты и избранного.
  // Запись и заявки остаются операторам для разбора споров.
  // Пока по билету есть открытая заявка, удалить его нельзя: с покупателем уже работает оператор.
  async remove(sellerId: string, id: string) {
    const listing = await this.removableOrThrow(sellerId, id);
    await softDeleteListing(this.prisma, listing);
  }

  async removableOrThrow(sellerId: string, id: string) {
    const listing = await this.ownOrThrow(sellerId, id);
    const open = await this.prisma.purchaseRequest.count({
      where: { listingId: id, status: { in: ['NEW', 'IN_PROGRESS'] } },
    });
    if (open)
      throw new ConflictException('У вас есть активные заявки на этот билет');
    return listing;
  }
}
