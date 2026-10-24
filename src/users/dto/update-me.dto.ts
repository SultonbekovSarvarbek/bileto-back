import { Lang, UserRole } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsEnum(Lang)
  lang?: Lang;

  /** Сменить роль: покупатель ↔ продавец */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
