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
import { OffersService } from './offers.service';
import { CreateOfferDto } from './dto/create-offer.dto';

@ApiTags('offers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  /** Предложить свою цену за билет с пометкой «торг уместен». Продавец видит имя и размытый номер. */
  @Post('offers')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOfferDto) {
    return this.offers.create(user.id, dto);
  }

  /** Мои предложения цены (покупатель) */
  @Get('me/offers')
  mine(@CurrentUser() user: AuthUser) {
    return this.offers.mine(user.id);
  }

  /** Предложения по моим объявлениям, которые ждут ответа (продавец) */
  @Get('me/offers/incoming')
  incoming(@CurrentUser() user: AuthUser) {
    return this.offers.incoming(user.id);
  }

  /** Продавец принимает цену: создаётся заявка, её ведёт оператор */
  @Post('offers/:id/accept')
  @HttpCode(200)
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.offers.respond(user.id, id, true);
  }

  @Post('offers/:id/decline')
  @HttpCode(200)
  decline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.offers.respond(user.id, id, false);
  }
}
