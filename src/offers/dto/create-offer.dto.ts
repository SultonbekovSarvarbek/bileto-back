import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateOfferDto {
  @IsUUID()
  listingId: string;

  @IsInt()
  @Min(1)
  @Max(10)
  qty: number;

  /** Предложенная цена за 1 билет, сум */
  @IsInt()
  @Min(1000)
  @Max(100_000_000)
  price: number;

  /** Telegram.WebApp.initData из мини-приложения: из него берётся имя, которое увидит продавец */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  initData?: string;
}
