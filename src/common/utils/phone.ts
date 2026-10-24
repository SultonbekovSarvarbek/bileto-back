// Приводит "+998 90 123-45-67" / "998901234567" / "901234567" к "+998901234567".
export function normalizeUzPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const full = digits.length === 9 ? '998' + digits : digits;
  return /^998\d{9}$/.test(full) ? '+' + full : null;
}
