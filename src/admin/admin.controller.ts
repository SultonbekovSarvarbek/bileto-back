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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ListingStatus, OrderStatus, PayoutStatus, Role } from '@prisma/client';
import type { Response } from 'express';
import { relative, resolve } from 'path';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PROOFS_DIR } from '../common/utils/upload';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { RejectListingDto, ResolveDisputeDto } from './dto/admin.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  @Get('listings')
  listings(
    @Query('status', new ParseEnumPipe(ListingStatus, { optional: true }))
    status?: ListingStatus,
  ) {
    return this.prisma.listing.findMany({
      where: status ? { status } : {},
      include: {
        seller: {
          select: { id: true, name: true, phone: true, verified: true },
        },
      },
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

  /** Снять объявление (подделка, нарушение правил) */
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

  /** Вернуть снятое объявление в продажу */
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

  @Get('orders')
  list(
    @Query('status', new ParseEnumPipe(OrderStatus, { optional: true }))
    status?: OrderStatus,
    @Query('payoutStatus', new ParseEnumPipe(PayoutStatus, { optional: true }))
    payoutStatus?: PayoutStatus,
  ) {
    return this.orders.list({
      ...(status ? { status } : {}),
      ...(payoutStatus ? { payoutStatus } : {}),
    });
  }

  /** Решение по спору */
  @Post('orders/:id/resolve')
  @HttpCode(200)
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    if (dto.decision === 'REFUND')
      await this.orders.refund(id, ['DISPUTED'], dto.note);
    else await this.orders.complete(id, ['DISPUTED'], dto.note);
    return this.prisma.order.findUniqueOrThrow({ where: { id } });
  }

  /** Отметить, что деньги перечислены продавцу */
  @Post('orders/:id/payout')
  @HttpCode(200)
  payout(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.markPayoutPaid(id);
  }
}
