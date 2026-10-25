// Демо-данные: продавцы и объявления на события из каталога приложения (афиша iTicket.uz).
// Запуск: npm run db:seed. Повторный запуск заменяет демо-объявления, не трогая остальные.
import { Delivery, PrismaClient } from '@prisma/client';
import data from './seed-data.json';

const prisma = new PrismaClient();
// У демо-объявлений нет своего фото: путь-заглушка, админский эндпоинт вернёт 404, обложка — из каталога.
const DEMO_PROOF = 'seed/demo-proof.jpg';

async function main() {
  const ids = new Map<string, string>();
  for (const s of data.sellers) {
    const user = await prisma.user.upsert({
      where: { phone: s.phone },
      update: { name: s.name, verified: s.verified, role: 'SELLER' },
      create: {
        phone: s.phone,
        name: s.name,
        verified: s.verified,
        role: 'SELLER',
      },
    });
    ids.set(s.id, user.id);
  }

  const sellerIds = [...ids.values()];
  const old = { sellerId: { in: sellerIds }, proofPath: DEMO_PROOF };
  await prisma.purchaseRequest.deleteMany({ where: { listing: old } });
  await prisma.listing.deleteMany({ where: old });

  for (const l of data.listings) {
    await prisma.listing.create({
      data: {
        sellerId: ids.get(l.seller)!,
        eventId: l.eventId,
        title: l.title,
        city: l.city,
        description: l.description,
        qty: l.qty,
        qtyAvailable: l.qty,
        price: l.price,
        delivery: l.delivery as Delivery,
        views: l.views,
        proofPath: DEMO_PROOF,
        createdAt: new Date(l.createdAt),
      },
    });
  }
  console.log(
    `Seed: ${data.sellers.length} продавцов, ${data.listings.length} объявлений`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
