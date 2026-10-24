import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { DisputeDto } from './dto/dispute.dto';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Купить: резервирует билеты на время оплаты */
  @Post('orders')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.id, dto);
  }

  @Get('orders/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(user.id, id);
  }

  /** Только для PAYMENT_PROVIDER=mock: имитация успешной оплаты */
  @Post('orders/:id/pay')
  @HttpCode(200)
  pay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.payMock(user.id, id);
  }

  /** Покупатель: отменить неоплаченный заказ */
  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.cancel(user.id, id);
  }

  /** Продавец: билет передан покупателю */
  @Post('orders/:id/handover')
  @HttpCode(200)
  handover(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.handover(user.id, id);
  }

  /** Покупатель: билет получен и проверен — деньги уходят продавцу */
  @Post('orders/:id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.confirm(user.id, id);
  }

  /** Покупатель: открыть спор (билет не пришёл / не тот / недействителен) */
  @Post('orders/:id/dispute')
  @HttpCode(200)
  dispute(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisputeDto,
  ) {
    return this.orders.dispute(user.id, id, dto.reason);
  }

  /** Мои покупки */
  @Get('me/purchases')
  purchases(@CurrentUser() user: AuthUser) {
    return this.orders.list({ buyerId: user.id });
  }

  /** Мои продажи */
  @Get('me/sales')
  sales(@CurrentUser() user: AuthUser) {
    return this.orders.list({
      sellerId: user.id,
      status: { not: 'CANCELLED' },
    });
  }
}
