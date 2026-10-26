import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
const KEY_LEN = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

// Хеш пароля для User.passwordHash: "соль:хеш" в hex.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const actual = await scryptAsync(password, Buffer.from(salt, 'hex'));
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
