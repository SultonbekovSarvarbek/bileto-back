import { Delivery } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Приходит multipart/form-data вместе с файлом "proof" (обложка), поэтому числа приводим через @Type.
export class CreateListingDto {
  /** Событие из каталога приложения, если объявление создано со страницы события */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  eventId?: string;

  /** Название, которое ввёл продавец */
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  city: string;

  /** Описание продавца: место, ряд, формат билета. Телефоны, ники и ссылки из него вырезаются */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  qty: number;

  /** Цена за 1 билет, сум */
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(100_000_000)
  price: number;

  @IsEnum(Delivery)
  delivery: Delivery;
}
