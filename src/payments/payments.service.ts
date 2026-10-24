import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Order } from '@prisma/client';

// Точка интеграции с платёжными системами (Payme, Click, Uzcard/Humo, Visa).
// Сейчас реализован только провайдер "mock" для разработки: оплата подтверждается
// вызовом POST /orders/:id/pay. Реальный провайдер должен вызывать
// OrdersService.markPaid() из своего webhook-а после успешного списания.
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly config: ConfigService) {}

  get isMock() {
    return (
      this.config.get<string>('PAYMENT_PROVIDER') === 'mock' &&
      this.config.get<string>('NODE_ENV') !== 'production'
    );
  }

  /** Данные для перехода к оплате. Для mock ссылки нет. */
  checkout(): { provider: string; payUrl: string | null } {
    if (this.isMock) return { provider: 'mock', payUrl: null };
    throw new Error('Платёжный провайдер не настроен');
  }

  /** Вернуть деньги покупателю (полная сумма, включая сервисный сбор). */
  refund(order: Order): Promise<void> {
    if (this.isMock) {
      this.logger.log(`Возврат ${order.total} сум по заказу ${order.id}`);
      return Promise.resolve();
    }
    throw new Error('Платёжный провайдер не настроен');
  }
}
