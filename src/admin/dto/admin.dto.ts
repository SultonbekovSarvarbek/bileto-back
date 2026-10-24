import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class RejectListingDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class ResolveDisputeDto {
  /** REFUND — вернуть деньги покупателю, RELEASE — завершить сделку в пользу продавца */
  @IsIn(['REFUND', 'RELEASE'])
  decision: 'REFUND' | 'RELEASE';

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note: string;
}
