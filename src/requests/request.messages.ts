import { Delivery, Prisma, RequestStatus } from '@prisma/client';
import { InlineButton, escapeHtml as h } from '../telegram/telegram.service';
import { formatPhone } from '../common/utils/phone';
import {
  formatSum,
  sellerCommission,
  sellerCommissionPercent,
  serviceFeePercent,
} from '../common/utils/money';

// Тексты сообщений в чате операторов.

export const REQUEST_INCLUDE = {
  listing: { include: { seller: { select: { name: true, phone: true } } } },
} satisfies Prisma.PurchaseRequestInclude;
export type RequestRow = Prisma.PurchaseRequestGetPayload<{
  include: typeof REQUEST_INCLUDE;
}>;

const STATUS: Record<RequestStatus, string> = {
  NEW: '🆕 Новая',
  IN_PROGRESS: '🟡 В работе',
  DONE: '✅ Продано',
  CANCELLED: '❌ Отменена',
};
const DELIVERY: Record<Delivery, string> = {
  DELIVERY: 'Доставка',
  PICKUP: 'Самовывоз',
};

const place = (l: { city: string; delivery: Delivery }) =>
  `${h(l.city)} · ${DELIVERY[l.delivery]}`;

const clip = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1) + '…' : s;

// Импортированное объявление: продавец на OLX, связь с ним — через исходное объявление.
const source = (l: { sourceUrl: string | null }) =>
  l.sourceUrl ? [`🔗 Объявление на OLX: ${h(l.sourceUrl)}`] : [];

export function requestText(r: RequestRow, actor?: string) {
  const l = r.listing;
  return [
    `🎟 <b>Заявка #${r.number}</b> — ${STATUS[r.status]}${actor ? ` (${h(actor)})` : ''}`,
    '',
    `<b>${h(l.title)}</b>`,
    place(l),
    // Место и ряд продавец пишет в описании — оператору оно нужно в заявке.
    ...(l.description ? [`💬 ${h(clip(l.description, 300))}`] : []),
    '',
    `Билеты: ${r.qty} × ${formatSum(r.unitPrice)} = ${formatSum(r.subtotal)}`,
    `Сервисный сбор ${serviceFeePercent()}%: ${formatSum(r.fee)}`,
    `<b>Итого покупатель платит: ${formatSum(r.total)}</b>`,
    `Комиссия Bileto ${sellerCommissionPercent()}%: ${formatSum(sellerCommission(r.subtotal))}`,
    `Продавцу: ${formatSum(r.subtotal - sellerCommission(r.subtotal))}`,
    '',
    `👤 Покупатель: ${h(r.name)}, ${formatPhone(r.phone)}`,
    `🏷 Продавец: ${h(l.seller.name ?? '—')}, ${formatPhone(l.seller.phone)}`,
    `В наличии сейчас: ${l.qtyAvailable} шт.`,
    ...source(l),
  ].join('\n');
}

export function requestButtons(r: {
  id: string;
  status: RequestStatus;
}): InlineButton[][] {
  const b = (text: string, status: RequestStatus) => ({
    text,
    callback_data: `r:${r.id}:${status}`,
  });
  if (r.status === 'NEW')
    return [
      [b('🟡 В работу', 'IN_PROGRESS'), b('✅ Продано', 'DONE')],
      [b('❌ Отменить', 'CANCELLED')],
    ];
  if (r.status === 'IN_PROGRESS')
    return [[b('✅ Продано', 'DONE'), b('❌ Отменить', 'CANCELLED')]];
  return [];
}

type ListingForMessage = Prisma.ListingGetPayload<{
  include: { seller: { select: { name: true; phone: true } } };
}>;

// Пометка в заголовке: кто из операторов снял или удалил объявление.
function listingMark(l: ListingForMessage) {
  const what = l.deletedAt
    ? '🗑 удалено'
    : l.status === 'REJECTED'
      ? '⛔ снято'
      : null;
  if (!what) return '';
  const by = l.rejectReason?.match(/оператором: (.+)$/)?.[1];
  return ` — ${what}${by ? ` (${h(by)})` : ''}`;
}

export function listingText(l: ListingForMessage) {
  return [
    `🆕 <b>Новое объявление</b>${listingMark(l)}`,
    '',
    `<b>${h(l.title)}</b>`,
    place(l),
    `${l.qty} шт. × ${formatSum(l.price)}`,
    `🏷 Продавец: ${h(l.seller.name ?? '—')}, ${formatPhone(l.seller.phone)}`,
    ...source(l),
    // Подпись к фото в Telegram ограничена 1024 символами — описание обрезаем.
    ...(l.description ? ['', `💬 ${h(clip(l.description, 300))}`] : []),
  ].join('\n');
}

// «Удалить» сначала переспрашивает (confirm): вернуть объявление кнопкой нельзя.
export function listingButtons(
  l: { id: string; status: string; deletedAt: Date | null },
  confirm = false,
): InlineButton[][] {
  if (l.deletedAt) return [];
  const b = (text: string, action: string): InlineButton => ({
    text,
    callback_data: `l:${l.id}:${action}`,
  });
  if (confirm) return [[b('🗑 Да, удалить', 'delete!'), b('↩️ Отмена', 'keep')]];
  return [
    ...(l.status === 'REJECTED' ? [] : [[b('⛔ Снять объявление', 'reject')]]),
    [b('🗑 Удалить объявление', 'delete')],
  ];
}
