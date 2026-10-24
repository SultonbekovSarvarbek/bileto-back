import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Отправка SMS. Сейчас только провайдер "console" (код пишется в лог).
// Для продакшена сюда добавляется реальный провайдер (например, Eskiz.uz).
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  send(phone: string, text: string): Promise<void> {
    const provider = this.config.get<string>('SMS_PROVIDER') ?? 'console';
    if (provider === 'console') {
      this.logger.log(`SMS → ${phone}: ${text}`);
      return Promise.resolve();
    }
    throw new Error(`SMS provider "${provider}" is not implemented`);
  }
}
