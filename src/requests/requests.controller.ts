import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';

@ApiTags('requests')
@Controller()
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  /** Заявка на покупку: имя, телефон, количество. Уходит операторам в Telegram. Вход не обязателен. */
  @Post('requests')
  @UseGuards(OptionalJwtAuthGuard)
  create(@Body() dto: CreateRequestDto, @CurrentUser() user?: AuthUser) {
    return this.requests.create(dto, user?.id);
  }

  /** Мои заявки */
  @Get('me/requests')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() user: AuthUser) {
    return this.requests.mine(user.id);
  }
}
