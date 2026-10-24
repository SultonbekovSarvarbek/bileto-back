import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ListingStatus, Prisma } from '@prisma/client';
import { unlink } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import {
  LISTING_PUBLIC_SELECT,
  OPEN_ORDER_STATUSES,
  toPublicListing,
} from './listing.view';

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  async feed({ city, q, page, limit }: FeedQueryDto) {
    const query = q?.trim();
    const where: Prisma.ListingWhereInput = {
      status: 'ACTIVE',
      qtyAvailable: { gt: 0 },
      ...(city ? { city } : {}),
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { sector: { contains: query, mode: 'insensitive' } },
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
    const row = await this.prisma.listing.findUnique({
      where: { id },
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

  async create(sellerId: string, dto: CreateListingDto, proofPath: string) {
    const row = await this.prisma.listing.create({
      data: { ...dto, sellerId, proofPath, qtyAvailable: dto.qty },
      select: LISTING_PUBLIC_SELECT,
    });
    return toPublicListing(row);
  }

  mine(sellerId: string, status?: ListingStatus) {
    return this.prisma.listing
      .findMany({
        where: { sellerId, ...(status ? { status } : {}) },
        select: LISTING_PUBLIC_SELECT,
        orderBy: { createdAt: 'desc' },
      })
      .then((rows) => rows.map(toPublicListing));
  }

  private async ownOrThrow(sellerId: string, id: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('Объявление не найдено');
    if (listing.sellerId !== sellerId) throw new ForbiddenException();
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

    // Уже купленные/зарезервированные билеты нельзя «убрать» уменьшением количества.
    const taken = listing.qty - listing.qtyAvailable;
    const qty = dto.qty ?? listing.qty;
    if (qty < taken)
      throw new BadRequestException(
        `Нельзя меньше ${taken}: столько уже куплено или зарезервировано`,
      );
    const qtyAvailable = qty - taken;

    const row = await this.prisma.listing.update({
      where: { id },
      data: {
        ...dto,
        qty,
        qtyAvailable,
        status: qtyAvailable > 0 ? 'ACTIVE' : 'SOLD',
        ...(newProofPath ? { proofPath: newProofPath } : {}),
      },
      select: LISTING_PUBLIC_SELECT,
    });
    if (newProofPath) await unlink(listing.proofPath).catch(() => undefined);
    return toPublicListing(row);
  }

  async archive(sellerId: string, id: string) {
    await this.ownOrThrow(sellerId, id);
    const open = await this.prisma.order.count({
      where: { listingId: id, status: { in: OPEN_ORDER_STATUSES } },
    });
    if (open)
      throw new ConflictException(
        'По объявлению идёт сделка — снять его пока нельзя',
      );
    await this.prisma.listing.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
  }
}
