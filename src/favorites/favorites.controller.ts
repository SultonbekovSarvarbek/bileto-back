import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import {
  LISTING_PUBLIC_SELECT,
  toPublicListing,
} from '../listings/listing.view';

@ApiTags('favorites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class FavoritesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me/favorites')
  async list(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.favorite.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { listing: { select: LISTING_PUBLIC_SELECT } },
    });
    return rows.map((r) => toPublicListing(r.listing));
  }

  @Put('favorites/:listingId')
  @HttpCode(204)
  async add(
    @CurrentUser() user: AuthUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ) {
    const exists = await this.prisma.listing.count({
      where: { id: listingId },
    });
    if (!exists) throw new NotFoundException('Объявление не найдено');
    await this.prisma.favorite.upsert({
      where: { userId_listingId: { userId: user.id, listingId } },
      update: {},
      create: { userId: user.id, listingId },
    });
  }

  @Delete('favorites/:listingId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ) {
    await this.prisma.favorite.deleteMany({
      where: { userId: user.id, listingId },
    });
  }
}
