import { Prisma } from '@prisma/client';
import { maskPhone } from '../common/utils/phone';

export const SELLER_SELECT = {
  id: true,
  name: true,
  phone: true,
  verified: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

// Публичное представление: без proofPath — обложку отдаёт coverUrl.
export const LISTING_PUBLIC_SELECT = {
  id: true,
  eventId: true,
  title: true,
  city: true,
  description: true,
  coverUrl: true,
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

// Номер продавца покупателю виден только размытым: связь — через заявку и оператора.
export function toPublicListing({ seller, ...l }: Row) {
  const { phone, ...s } = seller;
  return { ...l, seller: { ...s, phoneMasked: maskPhone(phone) } };
}
