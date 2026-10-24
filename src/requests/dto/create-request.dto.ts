import {
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRequestDto {
  @IsUUID()
  listingId: string;

  @IsInt()
  @Min(1)
  @Max(10)
  qty: number;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  /** Телефон покупателя, по нему перезванивает оператор */
  @IsString()
  phone: string;
}
