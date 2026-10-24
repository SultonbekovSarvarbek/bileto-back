import { PrismaClient } from '@prisma/client';

// Создаёт (или повышает до админа) пользователя с номером ADMIN_PHONE.
async function main() {
  const phone = process.env.ADMIN_PHONE;
  if (!phone || !/^\+998\d{9}$/.test(phone))
    throw new Error('ADMIN_PHONE must look like +998XXXXXXXXX');
  const prisma = new PrismaClient();
  const admin = await prisma.user.upsert({
    where: { phone },
    update: { role: 'ADMIN' },
    create: { phone, role: 'ADMIN', name: 'Admin' },
  });
  console.log(`Admin: ${admin.phone} (${admin.id})`);
  await prisma.$disconnect();
}

void main();
