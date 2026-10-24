import { IsString, MaxLength, MinLength } from 'class-validator';

export class DisputeDto {
  /** Что не так с билетом */
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;
}
