import { ConfigService } from '@nestjs/config';

// Правила безопасной сделки — те же цифры, что в Пользовательском соглашении.
export type DealRules = {
  feePercent: number;
  paymentTimeoutMin: number;
  handoverDeadlineHours: number;
  confirmWindowHours: number;
};

export function dealRules(config: ConfigService): DealRules {
  const num = (key: string, def: number) =>
    Number(config.get<string>(key) ?? def);
  return {
    feePercent: num('SERVICE_FEE_PERCENT', 7),
    paymentTimeoutMin: num('PAYMENT_TIMEOUT_MIN', 15),
    handoverDeadlineHours: num('HANDOVER_DEADLINE_HOURS', 2),
    confirmWindowHours: num('CONFIRM_WINDOW_HOURS', 24),
  };
}

export const addMinutes = (d: Date, m: number) =>
  new Date(d.getTime() + m * 60_000);
export const addHours = (d: Date, h: number) => addMinutes(d, h * 60);
