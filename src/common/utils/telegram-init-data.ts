import { createHmac, timingSafeEqual } from 'crypto';

export type TgWebAppUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  language_code?: string;
};

const MAX_AGE_S = 86_400; // подпись старше суток не принимаем

// Проверяет initData мини-приложения Telegram (подпись HMAC токеном бота) и возвращает пользователя.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function verifyInitData(
  initData: string,
  botToken: string,
  now = Date.now(),
): TgWebAppUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || now / 1000 - authDate > MAX_AGE_S) return null;
  try {
    const user = JSON.parse(params.get('user') ?? '') as TgWebAppUser;
    return Number.isSafeInteger(user?.id) ? user : null;
  } catch {
    return null;
  }
}
