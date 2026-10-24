// 1070000 → "1 070 000 сум"
export const formatSum = (n: number) =>
  n.toLocaleString('ru-RU').replace(/[\s,]/g, ' ') + ' сум';

// Сервисный сбор платит покупатель сверх цены билета.
export const serviceFeePercent = () =>
  Number(process.env.SERVICE_FEE_PERCENT ?? 7);

// Комиссия Bileto удерживается из суммы продавца с каждого проданного билета.
export const sellerCommissionPercent = () =>
  Number(process.env.SELLER_COMMISSION_PERCENT ?? 10);

export const sellerCommission = (subtotal: number) =>
  Math.round((subtotal * sellerCommissionPercent()) / 100);

export function priceBreakdown(unitPrice: number, qty: number) {
  const subtotal = unitPrice * qty;
  const fee = Math.round((subtotal * serviceFeePercent()) / 100);
  return { unitPrice, subtotal, fee, total: subtotal + fee };
}
