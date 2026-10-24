import { OrderStatus, Prisma } from '@prisma/client';

// Заказы, по которым сделка ещё идёт: пока они есть, объявление нельзя снять.
export const OPEN_ORDER_STATUSES: OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAID',
  'HANDED_OVER',
  'DISPUTED',
];

export const SELLER_SELECT = {
  id: true,
  name: true,
  verified: true,
  createdAt: true,
  _count: { select: { sales: { where: { status: 'COMPLETED' } } } },
} satisfies Prisma.UserSelect;

// Публичное представление: без proofPath (фото билета видит только модератор).
export const LISTING_PUBLIC_SELECT = {
  id: true,
  title: true,
  city: true,
  sector: true,
  row: true,
  seats: true,
  qty: true,
  qtyAvailable: true,
  price: true,
  delivery: true,
  status: true,
  views: true,
  createdAt: true,
  updatedAt: true,
  seller: { select: SELLER_SELECT },
} satisfies Prisma.ListingSelect;

type Row = Prisma.ListingGetPayload<{ select: typeof LISTING_PUBLIC_SELECT }>;

export function toPublicListing({ seller, ...l }: Row) {
  const { _count, ...s } = seller;
  return { ...l, seller: { ...s, deals: _count.sales } };
}
