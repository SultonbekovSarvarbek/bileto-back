// 1070000 → "1 070 000 сум"
export const formatSum = (n: number) =>
  n.toLocaleString('ru-RU').replace(/[\s,]/g, ' ') + ' сум';

export const serviceFeePercent = () =>
  Number(process.env.SERVICE_FEE_PERCENT ?? 7);

export function priceBreakdown(unitPrice: number, qty: number) {
  const subtotal = unitPrice * qty;
  const fee = Math.round((subtotal * serviceFeePercent()) / 100);
  return { unitPrice, subtotal, fee, total: subtotal + fee };
}
