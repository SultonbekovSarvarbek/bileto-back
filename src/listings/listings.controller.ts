import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { ListingStatus } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';
import { proofUploadOptions } from '../common/utils/upload';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { FeedQueryDto } from './dto/feed-query.dto';

@ApiTags('listings')
@Controller()
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  /** Лента активных объявлений: фильтр по городу и поиск */
  @Get('listings')
  feed(@Query() query: FeedQueryDto) {
    return this.listings.feed(query);
  }

  @Get('listings/:id')
  @UseGuards(OptionalJwtAuthGuard)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthUser) {
    return this.listings.getPublic(id, user?.id);
  }

  /** Создать объявление. multipart/form-data: поля CreateListingDto + файл "proof" (фото билета, обязательно) */
  @Post('listings')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('proof', proofUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateListingDto })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateListingDto,
    @UploadedFile() proof?: Express.Multer.File,
  ) {
    if (!proof) throw new BadRequestException('Добавьте фото билета');
    return this.listings.create(user.id, dto, proof.path);
  }

  /** Изменить объявление. Можно приложить новое фото "proof". */
  @Patch('listings/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('proof', proofUploadOptions))
  @ApiConsumes('multipart/form-data', 'application/json')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListingDto,
    @UploadedFile() proof?: Express.Multer.File,
  ) {
    return this.listings.update(user.id, id, dto, proof?.path);
  }

  /** Снять объявление с продажи */
  @Delete('listings/:id')
  @HttpCode(204)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  archive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.listings.archive(user.id, id);
  }

  /** Мои объявления */
  @Get('me/listings')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  mine(
    @CurrentUser() user: AuthUser,
    @Query('status', new ParseEnumPipe(ListingStatus, { optional: true }))
    status?: ListingStatus,
  ) {
    return this.listings.mine(user.id, status);
  }
}
