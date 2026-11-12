import { PrismaClient, Prisma } from '@prisma/client';
import { formatSum } from '../common/utils/money';
import { formatPhone } from '../common/utils/phone';
import { escapeHtml as h } from '../telegram/telegram.service';
import { TEXTS } from './bot.texts';

// Удаление билетов админами публичного бота (ADMIN_TELEGRAM_IDS), только по-русски.
// Колбэки: at:<страница> — список, ad:<id> — переспросить, ax:<id> — удалить.

const PAGE = 8;

type Button = { text: string; callback_data: string };
type Screen = { html: string; buttons: Button[][] };

const OPEN_REQUESTS = {
  select: {
    requests: { where: { status: { in: ['NEW', 'IN_PROGRESS'] } } },
  },
} satisfies Prisma.ListingCountOutputTypeDefaultArgs;

/** Страница всех неудалённых объявлений, новые сверху; q — поиск по названию. */
export async function adminTickets(
  prisma: PrismaClient,
  page: number,
  q?: string,
): Promise<Screen> {
  const where: Prisma.ListingWhereInput = {
    deletedAt: null,
    ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
  };
  const total = await prisma.listing.count({ where });
  const head = `🗑 <b>Билеты</b>${q ? ` · «${h(q)}»` : ''}`;
  if (!total) return { html: `${head}\n\nНичего не найдено.`, buttons: [] };
  const pages = Math.ceil(total / PAGE);
  page = Math.min(Math.max(1, page), pages);
  const rows = await prisma.listing.findMany({
    where,
    include: {
      seller: { select: { name: true, phone: true } },
      _count: OPEN_REQUESTS,
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * PAGE,
    take: PAGE,
  });
  const html = [
    `${head} · ${total} шт., стр. ${page}/${pages}`,
    '',
    ...rows.map((l, i) =>
      [
        `${i + 1}. <b>${h(l.title)}</b>`,
        `    ${h(l.city)} · ${l.qtyAvailable}/${l.qty} шт. · ${formatSum(l.price)} · ${TEXTS.ru.listingStatus[l.status]}`,
        `    🏷 ${h(l.seller.name ?? '—')}, ${formatPhone(l.seller.phone)}` +
          (l._count.requests
            ? ` · ⚠️ активных заявок: ${l._count.requests}`
            : ''),
      ].join('\n'),
    ),
    '',
    'Нажмите номер, чтобы удалить билет. Поиск: <code>/tickets название</code>',
  ].join('\n');
  const numbers = rows.map((l, i) => ({
    text: `🗑 ${i + 1}`,
    callback_data: `ad:${l.id}`,
  }));
  const buttons: Button[][] = [];
  for (let i = 0; i < numbers.length; i += 4)
    buttons.push(numbers.slice(i, i + 4));
  const nav: Button[] = [];
  if (page > 1) nav.push({ text: '⬅️', callback_data: `at:${page - 1}` });
  if (page < pages) nav.push({ text: '➡️', callback_data: `at:${page + 1}` });
  if (nav.length) buttons.push(nav);
  return { html, buttons };
}

/** Вопрос перед удалением; null — объявления нет или оно уже удалено. */
export async function adminTicketConfirm(
  prisma: PrismaClient,
  id: string,
): Promise<Screen | null> {
  const l = await prisma.listing.findFirst({
    where: { id, deletedAt: null },
    include: {
      seller: { select: { name: true, phone: true } },
      _count: OPEN_REQUESTS,
    },
  });
  if (!l) return null;
  return {
    html: [
      `Удалить билет «<b>${h(l.title)}</b>»?`,
      `${h(l.city)} · ${l.qty} шт. × ${formatSum(l.price)}`,
      `🏷 ${h(l.seller.name ?? '—')}, ${formatPhone(l.seller.phone)}`,
      ...(l._count.requests
        ? ['', `⚠️ По билету есть активные заявки: ${l._count.requests}`]
        : []),
      '',
      'Билет пропадёт из ленты и у продавца. Вернуть его будет нельзя.',
    ].join('\n'),
    buttons: [
      [
        { text: '🗑 Да, удалить', callback_data: `ax:${l.id}` },
        { text: '↩️ Отмена', callback_data: 'at:1' },
      ],
    ],
  };
}
