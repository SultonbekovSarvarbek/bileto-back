import { IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  phone: string;

  /** 4 цифры из SMS */
  @Matches(/^\d{4}$/)
  code: string;
}
