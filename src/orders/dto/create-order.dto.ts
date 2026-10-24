import { PaymentMethod } from '@prisma/client';
import { IsEnum, IsInt, IsUUID, Max, Min } from 'class-validator';

export class CreateOrderDto {
  @IsUUID()
  listingId: string;

  @IsInt()
  @Min(1)
  @Max(10)
  qty: number;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
}
