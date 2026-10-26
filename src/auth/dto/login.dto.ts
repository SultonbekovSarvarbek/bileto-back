import { UserRole } from '@prisma/client';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  /** Номер телефона, например +998 90 123-45-67 */
  @IsString()
  phone: string;

  @IsString()
  @MaxLength(72)
  password: string;
}

export class RegisterDto extends LoginDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  /** Пароль, минимум 6 символов */
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  declare password: string;

  /** Покупатель или продавец. Продавать билеты может только SELLER. */
  @IsEnum(UserRole)
  role: UserRole;
}
