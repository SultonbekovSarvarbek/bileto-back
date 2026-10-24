import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { ListingStatus, RequestStatus } from '@prisma/client';
import type { Response } from 'express';
import { relative, resolve } from 'path';
import { AdminKeyGuard } from '../common/guards/admin-key.guard';
import { PROOFS_DIR } from '../common/utils/upload';
import { PrismaService } from '../prisma/prisma.service';
import { RejectListingDto } from './dto/admin.dto';

// Основная работа операторов — в Telegram. Эти эндпоинты — запасной доступ и база для будущей веб-админки.
@ApiTags('admin')
@ApiHeader({ name: 'X-Admin-Key', required: true })
@UseGuards(AdminKeyGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('listings')
  listings(
    @Query('status', new ParseEnumPipe(ListingStatus, { optional: true }))
    status?: ListingStatus,
  ) {
    return this.prisma.listing.findMany({
      where: status ? { status } : {},
      include: { seller: { select: { id: true, name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Фото билета для модерации */
  @Get('listings/:id/proof')
  async proof(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: { proofPath: true },
    });
    const file = listing && resolve(listing.proofPath);
    if (!file || relative(PROOFS_DIR, file).startsWith('..'))
      throw new NotFoundException();
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(file);
  }

  @Post('listings/:id/reject')
  @HttpCode(200)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectListingDto,
  ) {
    return this.prisma.listing.update({
      where: { id },
      data: { status: 'REJECTED', rejectReason: dto.reason },
    });
  }

  @Post('listings/:id/restore')
  @HttpCode(200)
  async restore(@Param('id', ParseUUIDPipe) id: string) {
    const l = await this.prisma.listing.findUniqueOrThrow({ where: { id } });
    return this.prisma.listing.update({
      where: { id },
      data: {
        status: l.qtyAvailable > 0 ? 'ACTIVE' : 'SOLD',
        rejectReason: null,
      },
    });
  }

  /** Все заявки — на случай, если Telegram был недоступен */
  @Get('requests')
  requests(
    @Query('status', new ParseEnumPipe(RequestStatus, { optional: true }))
    status?: RequestStatus,
  ) {
    return this.prisma.purchaseRequest.findMany({
      where: status ? { status } : {},
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            seller: { select: { name: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
