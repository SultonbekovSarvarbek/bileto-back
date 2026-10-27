import { PrismaClient, RequestStatus } from '@prisma/client';
import {
  formatSum,
  sellerCommission,
  sellerCommissionPercent,
} from '../common/utils/money';

// Статистика для админов публичного бота (ADMIN_TELEGRAM_IDS), только по-русски.

const DAY = 86_400_000;

const STATUS: Record<RequestStatus, string> = {
  NEW: '🆕 новые',
  IN_PROGRESS: '🟡 в работе',
  DONE: '✅ продано',
  CANCELLED: '❌ отменены',
};

export async function statsText(prisma: PrismaClient) {
  const now = Date.now();
  const day = new Date(now - DAY);
  const week = new Date(now - 7 * DAY);
  const since = (d: Date) => ({ gte: d });

  const [
    chats,
    chatsDay,
    chatsWeek,
    activeDay,
    activeWeek,
    uzChats,
    users,
    withPhone,
    withPassword,
    sellers,
    listingsActive,
    listingsAll,
    listingsDay,
    listingsWeek,
    requestsAll,
    requestsDay,
    requestsWeek,
    byStatus,
    done,
    doneWeek,
  ] = await prisma.$transaction([
    prisma.botChat.count(),
    prisma.botChat.count({ where: { createdAt: since(day) } }),
    prisma.botChat.count({ where: { createdAt: since(week) } }),
    prisma.botChat.count({ where: { lastSeenAt: since(day) } }),
    prisma.botChat.count({ where: { lastSeenAt: since(week) } }),
    prisma.botChat.count({ where: { lang: 'uz' } }),
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { telegramId: { not: null } } }),
    prisma.user.count({
      where: { deletedAt: null, passwordHash: { not: null } },
    }),
    prisma.user.count({ where: { deletedAt: null, role: 'SELLER' } }),
    prisma.listing.count({
      where: { status: 'ACTIVE', qtyAvailable: { gt: 0 } },
    }),
    prisma.listing.count(),
    prisma.listing.count({ where: { createdAt: since(day) } }),
    prisma.listing.count({ where: { createdAt: since(week) } }),
    prisma.purchaseRequest.count(),
    prisma.purchaseRequest.count({ where: { createdAt: since(day) } }),
    prisma.purchaseRequest.count({ where: { createdAt: since(week) } }),
    prisma.purchaseRequest.groupBy({
      by: ['status'],
      _count: { status: true },
      orderBy: { status: 'asc' },
    }),
    prisma.purchaseRequest.aggregate({
      where: { status: 'DONE' },
      _sum: { subtotal: true, fee: true, qty: true },
      _count: true,
    }),
    prisma.purchaseRequest.aggregate({
      where: { status: 'DONE', updatedAt: since(week) },
      _sum: { subtotal: true, fee: true },
    }),
  ]);

  const count = (s: RequestStatus) =>
    // groupBy внутри $transaction теряет точный тип _count
    (byStatus.find((r) => r.status === s)?._count as { status: number })
      ?.status ?? 0;
  // Доход Bileto: сервисный сбор покупателя + комиссия с продавца.
  const income = (a: { subtotal: number | null; fee: number | null }) =>
    (a.fee ?? 0) + sellerCommission(a.subtotal ?? 0);
  const conversion = requestsAll
    ? Math.round((count('DONE') / requestsAll) * 100)
    : 0;
  const time = new Date(now).toLocaleString('ru-RU', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return [
    `📊 <b>Статистика Bileto</b> · ${time}`,
    '',
    '<b>🤖 Бот</b>',
    `Запустили: ${chats} (+${chatsDay} за 24 ч, +${chatsWeek} за 7 дн.)`,
    `Активны: ${activeDay} за 24 ч · ${activeWeek} за 7 дн.`,
    `Язык: 🇷🇺 ${chats - uzChats} · 🇺🇿 ${uzChats}`,
    `Поделились номером: ${withPhone}`,
    '',
    '<b>👥 Аккаунты</b> (бот + приложение)',
    `Всего: ${users} · с паролем: ${withPassword} · продавцов: ${sellers}`,
    '',
    '<b>🎟 Объявления</b>',
    `В продаже: ${listingsActive} · всего: ${listingsAll}`,
    `Новых: +${listingsDay} за 24 ч · +${listingsWeek} за 7 дн.`,
    '',
    '<b>🧾 Заявки</b>',
    `Всего: ${requestsAll} (+${requestsDay} за 24 ч, +${requestsWeek} за 7 дн.)`,
    (Object.keys(STATUS) as RequestStatus[])
      .map((s) => `${STATUS[s]}: ${count(s)}`)
      .join(' · '),
    `Конверсия в продажу: ${conversion}%`,
    '',
    '<b>💰 Продажи</b> (заявки «Продано»)',
    `Сделок: ${done._count} · билетов: ${done._sum.qty ?? 0}`,
    `Оборот: ${formatSum(done._sum.subtotal ?? 0)}`,
    `Доход Bileto (сбор + ${sellerCommissionPercent()}%): <b>${formatSum(income(done._sum))}</b>`,
    `За 7 дн.: оборот ${formatSum(doneWeek._sum.subtotal ?? 0)}, доход ${formatSum(income(doneWeek._sum))}`,
  ].join('\n');
}
