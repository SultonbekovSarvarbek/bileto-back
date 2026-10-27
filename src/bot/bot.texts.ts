import { Delivery } from '@prisma/client';
import { escapeHtml as h } from '../telegram/telegram.service';
import {
  formatSum,
  priceBreakdown,
  serviceFeePercent,
} from '../common/utils/money';

// Тексты и клавиатуры публичного бота.

export const MENU = {
  buy: '🎟 Купить билет',
  sell: '💰 Продать билет',
  myListings: '📋 Мои объявления',
  myRequests: '🧾 Мои заявки',
  app: '🔑 Вход в приложение',
};
export const CANCEL = '❌ Отмена';
export const SKIP = 'Пропустить';
export const DELIVERY: Record<Delivery, string> = {
  DELIVERY: '🚚 Доставка',
  PICKUP: '🤝 Самовывоз',
};

export const menuKeyboard = {
  keyboard: [
    [{ text: MENU.buy }, { text: MENU.sell }],
    [{ text: MENU.myListings }, { text: MENU.myRequests }],
    [{ text: MENU.app }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

// Клавиатура шага: варианты ответа и «Отмена» последней строкой.
export const stepKeyboard = (options: string[][] = []) => ({
  keyboard: [...options, [CANCEL]].map((row) => row.map((text) => ({ text }))),
  resize_keyboard: true,
});

export const contactKeyboard = {
  keyboard: [
    [{ text: '📱 Поделиться номером', request_contact: true }],
    [{ text: CANCEL }],
  ],
  resize_keyboard: true,
  one_time_keyboard: true,
};

export const WELCOME = [
  '👋 <b>Bileto</b> — перепродажа билетов на концерты и события.',
  '',
  'Без регистрации: выберите билет — оператор перезвонит и проведёт сделку.',
  'Продаёте? Создайте объявление за минуту.',
  '',
  'Чтобы найти событие, просто напишите его название.',
].join('\n');

export const ASK_CONTACT =
  'Нажмите «📱 Поделиться номером» — по нему с вами свяжется оператор Bileto.';

type CardListing = {
  title: string;
  city: string;
  description: string | null;
  price: number;
  qtyAvailable: number;
  delivery: Delivery;
  status: string;
};

export function listingCard(l: CardListing) {
  return [
    `<b>${h(l.title)}</b>`,
    `📍 ${h(l.city)} · ${DELIVERY[l.delivery]}`,
    ...(l.description ? ['', `💬 ${h(l.description.slice(0, 600))}`] : []),
    '',
    `💵 ${formatSum(l.price)} за билет`,
    l.status === 'ACTIVE' && l.qtyAvailable > 0
      ? `🎟 В наличии: ${l.qtyAvailable} шт.`
      : '⛔ Продано',
    `<i>+ сервисный сбор ${serviceFeePercent()}%</i>`,
  ].join('\n');
}

export function feedLine(
  n: number,
  l: { title: string; city: string; price: number; qtyAvailable: number },
) {
  return `${n}. <b>${h(l.title)}</b>\n    📍 ${h(l.city)} · ${formatSum(l.price)} · ${l.qtyAvailable} шт.`;
}

export function requestDone(
  number: number,
  title: string,
  qty: number,
  price: number,
) {
  const p = priceBreakdown(price, qty);
  return [
    `✅ <b>Заявка #${number} принята</b>`,
    '',
    `<b>${h(title)}</b>`,
    `Билеты: ${qty} × ${formatSum(price)} = ${formatSum(p.subtotal)}`,
    `Сервисный сбор ${serviceFeePercent()}%: ${formatSum(p.fee)}`,
    `<b>Итого: ${formatSum(p.total)}</b>`,
    '',
    'Оператор Bileto скоро позвонит вам и расскажет, как оплатить и получить билет.',
  ].join('\n');
}

export const REQUEST_STATUS: Record<string, string> = {
  NEW: '🆕 Новая',
  IN_PROGRESS: '🟡 В работе',
  DONE: '✅ Куплено',
  CANCELLED: '❌ Отменена',
};

export const LISTING_STATUS: Record<string, string> = {
  ACTIVE: '🟢 В продаже',
  SOLD: '✅ Продано',
  REJECTED: '⛔ Снято модератором',
  ARCHIVED: '🗄 Снято',
};
