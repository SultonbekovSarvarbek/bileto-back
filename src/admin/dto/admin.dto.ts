import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectListingDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}
