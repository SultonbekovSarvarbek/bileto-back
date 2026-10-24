// Приводит "+998 90 123-45-67" / "998901234567" / "901234567" к "+998901234567".
export function normalizeUzPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const full = digits.length === 9 ? '998' + digits : digits;
  return /^998\d{9}$/.test(full) ? '+' + full : null;
}

// "+998901234567" → "+998 90 ••• •• 67": номер продавца виден покупателю только размытым.
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)} ${phone.slice(4, 6)} ••• •• ${phone.slice(-2)}`;
}

// "+998901234567" → "+998 90 123-45-67" для сообщений операторам.
export function formatPhone(phone: string): string {
  return `${phone.slice(0, 4)} ${phone.slice(4, 6)} ${phone.slice(6, 9)}-${phone.slice(9, 11)}-${phone.slice(11)}`;
}
