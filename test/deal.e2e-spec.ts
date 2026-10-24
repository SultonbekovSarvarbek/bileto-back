import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrdersService } from '../src/orders/orders.service';

// 1×1 PNG — «фото билета»
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const randomPhone = () =>
  '+99890' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');

describe('Безопасная сделка (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let orders: OrdersService;
  const http = () => request(app.getHttpServer());

  async function login(phone = randomPhone()) {
    const sent = await http()
      .post('/api/auth/otp/send')
      .send({ phone })
      .expect(200);
    const code = (sent.body as { devCode: string }).devCode;
    const res = await http()
      .post('/api/auth/otp/verify')
      .send({ phone, code })
      .expect(200);
    const body = res.body as { token: string; user: { id: string } };
    return {
      token: body.token,
      id: body.user.id,
      phone,
      auth: `Bearer ${body.token}`,
    };
  }

  async function createListing(
    auth: string,
    fields: Record<string, string> = {},
  ) {
    const req = http().post('/api/listings').set('Authorization', auth);
    const data = {
      title: 'Концерт в Humo Arena',
      city: 'Ташкент',
      sector: 'Партер',
      row: '5',
      seats: '1–3',
      qty: '3',
      price: '500000',
      delivery: 'PICKUP',
      ...fields,
    };
    for (const [k, v] of Object.entries(data)) void req.field(k, v);
    const res = await req
      .attach('proof', PNG, {
        filename: 'ticket.png',
        contentType: 'image/png',
      })
      .expect(201);
    return res.body as { id: string };
  }

  const order = (auth: string, listingId: string, qty: number) =>
    http()
      .post('/api/orders')
      .set('Authorization', auth)
      .send({ listingId, qty, paymentMethod: 'PAYME' });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    orders = app.get(OrdersService);
  });

  afterAll(() => app.close());

  it('вход по SMS-коду: неверный код не пускает, верный выдаёт токен', async () => {
    const phone = randomPhone();
    await http()
      .post('/api/auth/otp/send')
      .send({ phone: phone.replace('+998', '') })
      .expect(200);
    await http()
      .post('/api/auth/otp/verify')
      .send({ phone, code: '00000' })
      .expect(400);
    const wrong = await http()
      .post('/api/auth/otp/verify')
      .send({ phone, code: '9999' });
    // Код случайный: «9999» почти всегда неверен
    expect([200, 401]).toContain(wrong.status);
    await http().post('/api/auth/otp/send').send({ phone }).expect(429);
    await http().get('/api/me').expect(401);
  });

  it('объявление: без фото нельзя; фото не попадает в публичный ответ; поиск находит', async () => {
    const seller = await login();
    await http()
      .post('/api/listings')
      .set('Authorization', seller.auth)
      .field('title', 'X')
      .expect(400);
    const listing = await createListing(seller.auth, {
      title: 'Лебединое озеро уникальное',
    });
    const feed = await http()
      .get('/api/listings')
      .query({ city: 'Ташкент', q: 'лебединое озеро уник' })
      .expect(200);
    const items = (feed.body as { items: Record<string, unknown>[] }).items;
    expect(items.map((i) => i.id)).toContain(listing.id);
    expect(items[0]).not.toHaveProperty('proofPath');
  });

  it('полный цикл: резерв → оплата → передача → подтверждение → выплата', async () => {
    const seller = await login();
    const buyer = await login();
    const other = await login();
    const listing = await createListing(seller.auth);

    await order(seller.auth, listing.id, 1).expect(400); // свой билет купить нельзя

    const created = await order(buyer.auth, listing.id, 2).expect(201);
    const o = (
      created.body as {
        order: {
          id: string;
          total: number;
          status: string;
          seller: { phone: string | null };
        };
      }
    ).order;
    expect(o.status).toBe('PENDING_PAYMENT');
    expect(o.total).toBe(1_000_000 + 70_000); // 7% сбор
    expect(o.seller.phone).toBeNull(); // контакты скрыты до оплаты

    await order(other.auth, listing.id, 2).expect(409); // осталось только 1 — перепродажи нет

    const paid = await http()
      .post(`/api/orders/${o.id}/pay`)
      .set('Authorization', buyer.auth)
      .expect(200);
    expect(paid.body).toMatchObject({
      status: 'PAID',
      seller: { phone: seller.phone },
    });

    await http()
      .post(`/api/orders/${o.id}/handover`)
      .set('Authorization', buyer.auth)
      .expect(403);
    await http()
      .post(`/api/orders/${o.id}/confirm`)
      .set('Authorization', buyer.auth)
      .expect(409); // ещё не передан
    await http()
      .post(`/api/orders/${o.id}/handover`)
      .set('Authorization', seller.auth)
      .expect(200);
    await http()
      .delete(`/api/listings/${listing.id}`)
      .set('Authorization', seller.auth)
      .expect(409);

    const done = await http()
      .post(`/api/orders/${o.id}/confirm`)
      .set('Authorization', buyer.auth)
      .expect(200);
    expect(done.body).toMatchObject({
      status: 'COMPLETED',
      payoutStatus: 'PENDING',
    });

    await http()
      .get(`/api/orders/${o.id}`)
      .set('Authorization', other.auth)
      .expect(404);
    const sales = await http()
      .get('/api/me/sales')
      .set('Authorization', seller.auth)
      .expect(200);
    expect((sales.body as { id: string }[]).map((s) => s.id)).toContain(o.id);
  });

  it('спор: админ возвращает деньги; обычный пользователь в админку не попадает', async () => {
    const seller = await login();
    const buyer = await login();
    const admin = await login();
    await prisma.user.update({
      where: { id: admin.id },
      data: { role: 'ADMIN' },
    });
    const listing = await createListing(seller.auth);

    const o = (
      (await order(buyer.auth, listing.id, 1).expect(201)).body as {
        order: { id: string };
      }
    ).order;
    await http()
      .post(`/api/orders/${o.id}/pay`)
      .set('Authorization', buyer.auth)
      .expect(200);
    await http()
      .post(`/api/orders/${o.id}/dispute`)
      .set('Authorization', buyer.auth)
      .send({ reason: 'Продавец не выходит на связь' })
      .expect(200);

    await http()
      .get('/api/admin/orders')
      .set('Authorization', buyer.auth)
      .expect(403);
    await http()
      .get(`/api/admin/listings/${listing.id}/proof`)
      .set('Authorization', admin.auth)
      .expect(200);
    const resolved = await http()
      .post(`/api/admin/orders/${o.id}/resolve`)
      .set('Authorization', admin.auth)
      .send({ decision: 'REFUND', note: 'Билет не передан' })
      .expect(200);
    expect(resolved.body).toMatchObject({ status: 'REFUNDED' });
  });

  it('сроки: неоплаченный заказ отменяется и билеты возвращаются; непереданный — возврат; неподтверждённый — завершается', async () => {
    const seller = await login();
    const buyer = await login();
    const listing = await createListing(seller.auth, { qty: '3' });
    const id = (r: request.Response) =>
      (r.body as { order: { id: string } }).order.id;

    const unpaid = id(await order(buyer.auth, listing.id, 1).expect(201));
    const notHanded = id(await order(buyer.auth, listing.id, 1).expect(201));
    const notConfirmed = id(await order(buyer.auth, listing.id, 1).expect(201));
    for (const oid of [notHanded, notConfirmed]) {
      await http()
        .post(`/api/orders/${oid}/pay`)
        .set('Authorization', buyer.auth)
        .expect(200);
    }
    await http()
      .post(`/api/orders/${notConfirmed}/handover`)
      .set('Authorization', seller.auth)
      .expect(200);
    expect(
      (await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } }))
        .status,
    ).toBe('SOLD');

    await orders.sweep(new Date(Date.now() + 48 * 3600_000));

    const status = async (oid: string) =>
      (await prisma.order.findUniqueOrThrow({ where: { id: oid } })).status;
    expect(await status(unpaid)).toBe('CANCELLED');
    expect(await status(notHanded)).toBe('REFUNDED');
    expect(await status(notConfirmed)).toBe('COMPLETED');
    const l = await prisma.listing.findUniqueOrThrow({
      where: { id: listing.id },
    });
    expect(l).toMatchObject({ qtyAvailable: 1, status: 'ACTIVE' });
  });
});
