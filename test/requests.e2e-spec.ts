import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { RequestsService } from '../src/requests/requests.service';
import {
  CallbackQuery,
  InlineButton,
  TelegramService,
} from '../src/telegram/telegram.service';

// 1×1 PNG — «фото билета»
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const randomPhone = () =>
  '+99890' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');

// Фейковый бот: запоминает, что ушло бы в чат операторов.
class FakeTelegram {
  sent: { html: string; buttons: InlineButton[][]; photo?: string }[] = [];
  edits: { id: number; html: string }[] = [];
  enabled = true;
  onCallback() {}
  send(html: string, buttons: InlineButton[][] = []) {
    this.sent.push({ html, buttons });
    return Promise.resolve(this.sent.length);
  }
  sendPhoto(photo: string, html: string, buttons: InlineButton[][] = []) {
    this.sent.push({ html, buttons, photo });
    return Promise.resolve(this.sent.length);
  }
  edit(id: number, html: string) {
    this.edits.push({ id, html });
    return Promise.resolve();
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
}

describe('Заявки через Telegram (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let requests: RequestsService;
  const tg = new FakeTelegram();
  const http = () => request(app.getHttpServer());

  async function login(name = 'Азиз', phone = randomPhone(), role = 'SELLER') {
    const res = await http()
      .post('/api/auth/login')
      .send({ name, phone, role })
      .expect(200);
    const body = res.body as { token: string; user: { id: string } };
    return { id: body.user.id, phone, auth: `Bearer ${body.token}` };
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
    return res.body as { id: string; seller: Record<string, unknown> };
  }

  const press = (data: string): CallbackQuery => ({
    id: '1',
    data,
    from: { first_name: 'Оператор' },
    message: { message_id: 1 },
  });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TelegramService)
      .useValue(tg)
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    requests = app.get(RequestsService);
  });

  afterAll(() => app.close());

  it('регистрация: имя + телефон, повторный вход по тому же номеру — тот же пользователь', async () => {
    const phone = randomPhone();
    const a = await login('Малика', phone.replace('+998', ''));
    const b = await login('Малика Р.', phone);
    expect(a.id).toBe(b.id);
    const me = await http()
      .get('/api/me')
      .set('Authorization', b.auth)
      .expect(200);
    expect(me.body).toMatchObject({ name: 'Малика Р.', phone, role: 'SELLER' });

    // Покупатель не может выставить билет, пока не сменит роль
    const buyer = await login('Покупатель', randomPhone(), 'BUYER');
    await http()
      .post('/api/listings')
      .set('Authorization', buyer.auth)
      .field('title', 'Концерт')
      .field('city', 'Ташкент')
      .field('sector', 'Партер')
      .field('qty', '1')
      .field('price', '100000')
      .field('delivery', 'PICKUP')
      .attach('proof', PNG, {
        filename: 'ticket.png',
        contentType: 'image/png',
      })
      .expect(403);
    await http()
      .patch('/api/me')
      .set('Authorization', buyer.auth)
      .send({ role: 'SELLER' })
      .expect(200);
    await createListing(buyer.auth);
    await http()
      .post('/api/auth/login')
      .send({ name: 'X', phone: '123' })
      .expect(400);
  });

  it('объявление уходит операторам с фото; номер продавца в ленте размыт', async () => {
    const seller = await login('Тимур');
    const listing = await createListing(seller.auth, {
      title: 'Лебединое озеро уникальное',
    });
    expect(tg.last()).toMatchObject({ photo: expect.any(String) as string });
    expect(tg.last().html).toContain('Лебединое озеро уникальное');

    const feed = await http()
      .get('/api/listings')
      .query({ q: 'лебединое озеро уник' })
      .expect(200);
    const item = (
      feed.body as { items: { id: string; seller: Record<string, unknown> }[] }
    ).items[0];
    expect(item.id).toBe(listing.id);
    expect(item.seller.phone).toBeUndefined();
    expect(item.seller.phoneMasked).toBe(
      `${seller.phone.slice(0, 4)} ${seller.phone.slice(4, 6)} ••• •• ${seller.phone.slice(-2)}`,
    );
    expect(item).not.toHaveProperty('proofPath');
  });

  it('заявка без входа: сбор 7% в сумах, сообщение операторам с телефонами обеих сторон', async () => {
    const seller = await login('Тимур');
    const listing = await createListing(seller.auth);
    const buyerPhone = randomPhone();

    const res = await http()
      .post('/api/requests')
      .send({
        listingId: listing.id,
        qty: 2,
        name: 'Покупатель',
        phone: buyerPhone,
      })
      .expect(201);
    expect(res.body).toMatchObject({
      status: 'NEW',
      subtotal: 1_000_000,
      fee: 70_000,
      total: 1_070_000,
    });

    const msg = tg.last().html;
    expect(msg).toContain('Сервисный сбор 7%: 70 000 сум');
    expect(msg).toContain('Итого покупатель платит: 1 070 000 сум');
    expect(msg).toContain('Комиссия Bileto 10%: 100 000 сум');
    expect(msg).toContain('Продавцу: 900 000 сум');
    expect(msg).toContain(buyerPhone.slice(6, 9)); // телефон покупателя виден оператору
    expect(msg).toContain(seller.phone.slice(6, 9)); // и телефон продавца
    expect(
      tg
        .last()
        .buttons.flat()
        .map((b) => b.callback_data),
    ).toContain(`r:${(res.body as { id: string }).id}:DONE`);

    // Повторная заявка на тот же билет — отказ; больше, чем есть, — отказ
    await http()
      .post('/api/requests')
      .send({
        listingId: listing.id,
        qty: 1,
        name: 'Покупатель',
        phone: buyerPhone,
      })
      .expect(409);
    await http()
      .post('/api/requests')
      .send({
        listingId: listing.id,
        qty: 5,
        name: 'Другой',
        phone: randomPhone(),
      })
      .expect(409);
  });

  it('оператор в Telegram: «В работу» → «Продано» списывает билеты; закрытую заявку не изменить', async () => {
    const seller = await login('Тимур');
    const buyer = await login('Покупатель');
    const listing = await createListing(seller.auth, { qty: '2' });
    await http()
      .post('/api/requests')
      .set('Authorization', seller.auth)
      .send({ listingId: listing.id, qty: 1, name: 'Я', phone: seller.phone })
      .expect(400); // свой билет

    const r = (
      await http()
        .post('/api/requests')
        .set('Authorization', buyer.auth)
        .send({
          listingId: listing.id,
          qty: 2,
          name: 'Покупатель',
          phone: buyer.phone,
        })
        .expect(201)
    ).body as { id: string };

    expect(await requests.handleCallback(press(`r:${r.id}:IN_PROGRESS`))).toBe(
      'Готово',
    );
    expect(await requests.handleCallback(press(`r:${r.id}:DONE`))).toBe(
      'Готово',
    );
    expect(tg.edits[tg.edits.length - 1].html).toContain(
      '✅ Продано (Оператор)',
    );
    expect(await requests.handleCallback(press(`r:${r.id}:CANCELLED`))).toBe(
      'Заявка уже закрыта',
    );

    const l = await prisma.listing.findUniqueOrThrow({
      where: { id: listing.id },
    });
    expect(l).toMatchObject({ qtyAvailable: 0, status: 'SOLD' });

    const mine = await http()
      .get('/api/me/requests')
      .set('Authorization', buyer.auth)
      .expect(200);
    expect(mine.body).toEqual([
      expect.objectContaining({ id: r.id, status: 'DONE' }),
    ]);
  });

  it('оператор снимает объявление кнопкой; админка закрыта без ключа', async () => {
    const seller = await login('Тимур');
    const listing = await createListing(seller.auth);
    expect(await requests.handleCallback(press(`l:${listing.id}:reject`))).toBe(
      'Объявление снято',
    );
    await http().get(`/api/listings/${listing.id}`).expect(404);

    await http().get('/api/admin/requests').expect(401);
    await http()
      .get('/api/admin/requests')
      .set('X-Admin-Key', 'wrong')
      .expect(401);
    await http()
      .get('/api/admin/requests')
      .set('X-Admin-Key', process.env.ADMIN_API_KEY!)
      .expect(200);
  });
});
