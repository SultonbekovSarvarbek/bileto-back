import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import {
  sellerCommissionPercent,
  serviceFeePercent,
} from '../common/utils/money';

// Мини-приложение в Telegram: сам интерфейс — статика из папки miniapp (раздаётся по /app/),
// работает через общий API. Здесь только то, что ему нужно знать при запуске.
@ApiTags('miniapp')
@Controller('miniapp')
export class MiniappController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Настройки для экранов: города с билетами, проценты, контакт поддержки */
  @Get('config')
  async get() {
    const rows = await this.prisma.listing.groupBy({
      by: ['city'],
      where: { status: 'ACTIVE', qtyAvailable: { gt: 0 } },
      _count: { city: true },
      orderBy: { _count: { city: 'desc' } },
      take: 8,
    });
    return {
      cities: rows.map((r) => r.city),
      feePercent: serviceFeePercent(),
      commissionPercent: sellerCommissionPercent(),
      support: (
        this.config.get<string>('SUPPORT_TELEGRAM') || 'bileto_manager'
      ).replace(/^@/, ''),
    };
  }
}
