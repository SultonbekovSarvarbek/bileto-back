import { Delivery, Prisma, RequestStatus } from '@prisma/client';
import { InlineButton, escapeHtml as h } from '../telegram/telegram.service';
import { formatPhone } from '../common/utils/phone';
import { formatSum, serviceFeePercent } from '../common/utils/money';

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

const place = (l: {
  sector: string;
  row: string | null;
  seats: string | null;
}) =>
  [l.sector, l.row && `ряд ${l.row}`, l.seats && `места ${l.seats}`]
    .filter(Boolean)
    .join(', ');

export function requestText(r: RequestRow, actor?: string) {
  const l = r.listing;
  return [
    `🎟 <b>Заявка #${r.number}</b> — ${STATUS[r.status]}${actor ? ` (${h(actor)})` : ''}`,
    '',
    `<b>${h(l.title)}</b>`,
    `${h(place(l))} · ${h(l.city)} · ${DELIVERY[l.delivery]}`,
    '',
    `Билеты: ${r.qty} × ${formatSum(r.unitPrice)} = ${formatSum(r.subtotal)}`,
    `Сервисный сбор ${serviceFeePercent()}%: ${formatSum(r.fee)}`,
    `<b>Итого покупатель платит: ${formatSum(r.total)}</b>`,
    `Продавцу: ${formatSum(r.subtotal)}`,
    '',
    `👤 Покупатель: ${h(r.name)}, ${formatPhone(r.phone)}`,
    `🏷 Продавец: ${h(l.seller.name ?? '—')}, ${formatPhone(l.seller.phone)}`,
    `В наличии сейчас: ${l.qtyAvailable} шт.`,
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

export function listingText(l: ListingForMessage, rejectedBy?: string) {
  return [
    `🆕 <b>Новое объявление</b>${rejectedBy ? ` — ⛔ снято (${h(rejectedBy)})` : ''}`,
    '',
    `<b>${h(l.title)}</b>`,
    `${h(place(l))} · ${h(l.city)} · ${DELIVERY[l.delivery]}`,
    `${l.qty} шт. × ${formatSum(l.price)}`,
    `🏷 Продавец: ${h(l.seller.name ?? '—')}, ${formatPhone(l.seller.phone)}`,
  ].join('\n');
}

export const listingButtons = (
  l: { id: string },
  rejected = false,
): InlineButton[][] =>
  rejected
    ? []
    : [[{ text: '⛔ Снять объявление', callback_data: `l:${l.id}:reject` }]];
