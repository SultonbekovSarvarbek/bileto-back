import { IsString, MaxLength, MinLength } from 'class-validator';

export class TelegramAuthDto {
  /** Строка Telegram.WebApp.initData из мини-приложения */
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  initData: string;
}
