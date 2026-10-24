import { IsString } from 'class-validator';

export class SendOtpDto {
  /** Номер телефона, например +998 90 123-45-67 */
  @IsString()
  phone: string;
}
