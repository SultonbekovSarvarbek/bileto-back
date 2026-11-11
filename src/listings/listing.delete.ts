import { Prisma, PrismaClient } from '@prisma/client';

// Мягкое удаление: объявление пропадает из ленты, «Моих» и избранного,
// но запись и заявки остаются операторам для разбора споров.
export function softDeleteListing(
  prisma: PrismaClient,
  listing: { id: string; status: string },
  extra: Prisma.ListingUpdateInput = {},
) {
  return prisma.$transaction([
    prisma.favorite.deleteMany({ where: { listingId: listing.id } }),
    prisma.listing.update({
      where: { id: listing.id },
      data: {
        deletedAt: new Date(),
        ...(listing.status === 'ACTIVE' ? { status: 'ARCHIVED' } : {}),
        ...extra,
      },
      include: { seller: { select: { name: true, phone: true } } },
    }),
  ]);
}
