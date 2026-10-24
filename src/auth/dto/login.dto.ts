import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  /** Номер телефона, например +998 90 123-45-67 */
  @IsString()
  phone: string;
}
