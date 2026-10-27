import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateMeDto } from './dto/update-me.dto';

const ME_SELECT = {
  id: true,
  phone: true,
  name: true,
  role: true,
  lang: true,
  verified: true,
  createdAt: true,
};

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  me(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: ME_SELECT,
    });
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.prisma.user.update({
      where: { id: user.id },
      data: dto,
      select: ME_SELECT,
    });
  }

  // Удаление аккаунта: стираем имя и телефон, снимаем активные объявления.
  // Заявки и объявления остаются операторам для разбора споров (см. политику).
  // Освободившийся номер можно снова зарегистрировать — это будет новый аккаунт.
  @Delete()
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser) {
    await this.prisma.$transaction([
      this.prisma.listing.updateMany({
        where: { sellerId: user.id, status: 'ACTIVE' },
        data: { status: 'ARCHIVED' },
      }),
      this.prisma.favorite.deleteMany({ where: { userId: user.id } }),
      this.prisma.purchaseRequest.updateMany({
        where: { userId: user.id },
        data: { userId: null },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          phone: `deleted:${user.id}`,
          name: null,
          passwordHash: null,
          telegramId: null,
          deletedAt: new Date(),
        },
      }),
    ]);
  }
}
