import { createHmac } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { BotService } from '../src/bot/bot.service';
import { statsText } from '../src/bot/bot.stats';
import { TEXTS, LANG_PROMPT } from '../src/bot/bot.texts';
import { PrismaService } from '../src/prisma/prisma.service';
import { TelegramService } from '../src/telegram/telegram.service';

// Токен ненастоящий: им только подписываем initData мини-приложения, в сеть бот не ходит.
const BOT_TOKEN = '1:TEST';
process.env.TELEGRAM_PUBLIC_BOT_TOKEN = BOT_TOKEN;

// Строка initData, как её формирует Telegram для мини-приложения.
function initData(id: number, token = BOT_TOKEN, ageSeconds = 0) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000) - ageSeconds),
    query_id: 'AAE',
    user: JSON.stringify({ id, first_name: 'Тест', language_code: 'ru' }),
  });
  const check = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

type Sent = { method: string; text?: string };
// Закрытые методы бота, которые тест вызывает или подменяет.
type BotInternals = {
  api: (method: string, body: Record<string, unknown>) => Promise<unknown>;
  download: () => Promise<Buffer>;
  dispatch: (u: unknown) => void;
  queues: Map<number, Promise<void>>;
};

describe('Публичный бот: метки ?start= (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let bot: BotInternals;
  let sent: Sent[] = [];
  let updateId = 1;
  // Свои метки на каждый прогон: тестовая база не очищается.
  const run = Date.now().toString(36);
  const tag = (name: string) => `sell_${name}_${run}`;
  const newChat = () => 1_000_000 + Math.floor(Math.random() * 1e9);

  async function send(chat: number, message: Record<string, unknown>) {
    sent = [];
    bot.dispatch({
      update_id: updateId++,
      message: {
        message_id: updateId,
        chat: { id: chat, type: 'private' },
        from: { id: chat, first_name: 'Тест' },
        ...message,
      },
    });
    await bot.queues.get(chat);
    return sent.filter((s) => s.method === 'sendMessage').map((s) => s.text);
  }
  const say = (chat: number, text: string) => send(chat, { text });
  async function press(chat: number, data: string) {
    sent = [];
    bot.dispatch({
      update_id: updateId++,
      callback_query: {
        id: '1',
        data,
        from: { id: chat, first_name: 'Тест' },
        message: { message_id: 1, chat: { id: chat, type: 'private' } },
      },
    });
    await bot.queues.get(chat);
    return sent.filter((s) => s.method === 'sendMessage').map((s) => s.text);
  }

  const ADMIN = 990_000_777;

  beforeAll(async () => {
    process.env.ADMIN_TELEGRAM_IDS = String(ADMIN);
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TelegramService)
      .useValue({
        enabled: true,
        onCallback() {},
        isOperatorChat: () => false,
        send: () => Promise.resolve(1),
        sendPhoto: () => Promise.resolve(1),
        edit: () => Promise.resolve(),
      })
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    bot = app.get<BotInternals>(BotService);
    bot.api = (method, body) => {
      sent.push({ method, text: body.text as string | undefined });
      return Promise.resolve({});
    };
    bot.download = () => Promise.resolve(PNG);
  });

  afterAll(() => app.close());

  it.each(['zivert_a', 'zivert_b', 'zivert_c'])(
    'новичок по sell_%s: язык, затем сразу продажа без приветствия',
    async (name) => {
      const chat = newChat();
      expect(await say(chat, `/start ${tag(name)}`)).toEqual([LANG_PROMPT]);
      expect(await press(chat, 'lg:ru')).toEqual([TEXTS.ru.sellIntro]);
      const row = await prisma.botChat.findUnique({
        where: { id: String(chat) },
      });
      expect(row).toMatchObject({
        firstSource: tag(name),
        lastSource: tag(name),
      });
    },
  );

  it('просто sell: тот же сценарий; знакомому пользователю — продажа сразу', async () => {
    const chat = newChat();
    expect(await say(chat, '/start sell')).toEqual([LANG_PROMPT]);
    expect(await press(chat, 'lg:uz')).toEqual([TEXTS.uz.sellIntro]);
    expect(await say(chat, '/start sell')).toEqual([TEXTS.uz.sellIntro]);
    expect(
      await prisma.botStart.findMany({
        where: { chatId: String(chat) },
        orderBy: { id: 'asc' },
        select: { source: true, isNew: true },
      }),
    ).toEqual([
      { source: 'sell', isNew: true },
      { source: 'sell', isNew: false },
    ]);
  });

  it('первая метка не перезаписывается, последняя обновляется; пришедший без метки — не «новый»', async () => {
    const chat = newChat();
    await say(chat, `/start ${tag('first')}`);
    await press(chat, 'lg:ru');
    await say(chat, `/start ${tag('second')}`);
    expect(
      await prisma.botChat.findUnique({ where: { id: String(chat) } }),
    ).toMatchObject({ firstSource: tag('first'), lastSource: tag('second') });

    const organic = newChat();
    await say(organic, '/start');
    await press(organic, 'lg:ru');
    await say(organic, `/start ${tag('second')}`);
    expect(
      await prisma.botChat.findUnique({ where: { id: String(organic) } }),
    ).toMatchObject({ firstSource: null, lastSource: tag('second') });
  });

  it('незнакомая метка и мусор не ломают бота, ID объявления работает как раньше', async () => {
    const chat = newChat();
    expect(await say(chat, `/start promo_${run}`)).toEqual([LANG_PROMPT]);
    expect(await press(chat, 'lg:ru')).toEqual([TEXTS.ru.welcome]);
    expect(await say(chat, `/start promo_${run}`)).toEqual([TEXTS.ru.welcome]);
    expect(await say(chat, '/start <b>💥</b>')).toEqual([TEXTS.ru.welcome]);
    expect(await say(chat, '/start')).toEqual([TEXTS.ru.welcome]);
    expect(
      await prisma.botStart.count({ where: { chatId: String(chat) } }),
    ).toBe(2);

    const seller = await prisma.user.create({
      data: { phone: '+99891' + String(chat).padStart(7, '0').slice(-7) },
    });
    const listing = await prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: `Концерт ${run}`,
        city: 'Ташкент',
        qty: 1,
        qtyAvailable: 1,
        price: 100000,
        delivery: 'PICKUP',
        proofPath: 'x.jpg',
      },
    });
    sent = [];
    await say(chat, `/start ${listing.id}`);
    expect(JSON.stringify(sent)).toContain(`Концерт ${run}`);
    expect(
      await prisma.botStart.count({ where: { chatId: String(chat) } }),
    ).toBe(2);
  });

  it('статистика: переходы → новые → разместили билет', async () => {
    const source = tag('stats');
    const seller = newChat();
    const idle = newChat();
    await say(idle, `/start ${source}`);
    await say(idle, `/start ${source}`);
    await say(seller, `/start ${source}`);
    await press(seller, 'lg:ru');
    for (const text of [
      'Концерт Zivert',
      'Ташкент',
      '500000',
      TEXTS.ru.negotiable.final,
      '2',
    ])
      await say(seller, text);
    await say(seller, TEXTS.ru.delivery.PICKUP);
    await say(seller, TEXTS.ru.skip);
    await send(seller, { photo: [{ file_id: 'f' }] });
    await send(seller, {
      contact: {
        user_id: seller,
        phone_number: '+99893' + String(seller).padStart(7, '0').slice(-7),
      },
    });
    expect(
      await prisma.listing.count({
        where: { seller: { telegramId: String(seller) } },
      }),
    ).toBe(1);

    const line = (await statsText(prisma))
      .split('\n')
      .find((l) => l.includes(source));
    expect(line).toBe(`<code>${source}</code>: 3 → 2 → <b>1</b> (50%)`);
  });

  it('в группе бот называет её ID админу по /chatid и молчит для остальных', async () => {
    const group = -1_000_000_000_000 - Math.floor(Math.random() * 1e9);
    const ask = async (from: number, text: string) => {
      sent = [];
      bot.dispatch({
        update_id: updateId++,
        message: {
          message_id: updateId,
          chat: { id: group, type: 'supergroup' },
          from: { id: from },
          text,
        },
      });
      await new Promise((r) => setTimeout(r, 50));
      return sent.map((s) => s.text);
    };
    expect(await ask(newChat(), '/chatid')).toEqual([]);
    expect(await ask(ADMIN, 'привет')).toEqual([]);
    expect((await ask(ADMIN, '/chatid')).join()).toContain(String(group));
  });

  it('админ удаляет билет командой /tickets, остальным она недоступна', async () => {
    const title = `Билет ${tag('adm')}`;
    const seller = await prisma.user.create({
      data: { phone: `+99877${String(Date.now()).slice(-7)}`, role: 'SELLER' },
    });
    const listing = await prisma.listing.create({
      data: {
        sellerId: seller.id,
        title,
        city: 'Ташкент',
        qty: 2,
        qtyAvailable: 2,
        price: 100000,
        delivery: 'PICKUP',
      },
    });
    const deletedAt = async () =>
      (await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } }))
        .deletedAt;

    // не админ: ни списка, ни удаления
    const stranger = newChat();
    await say(stranger, '/start');
    await press(stranger, 'lg:ru');
    expect((await say(stranger, `/tickets ${title}`)).join()).not.toContain(
      '🗑 <b>Билеты</b>',
    );
    await press(stranger, `ax:${listing.id}`);
    expect(await deletedAt()).toBeNull();

    await say(ADMIN, '/start');
    await press(ADMIN, 'lg:ru');
    const [list] = await say(ADMIN, `/tickets ${title}`);
    expect(list).toContain(title);

    await press(ADMIN, `ad:${listing.id}`); // только переспрашивает
    expect(await deletedAt()).toBeNull();
    await press(ADMIN, `ax:${listing.id}`);
    expect(await deletedAt()).not.toBeNull();
    const [after] = await say(ADMIN, `/tickets ${title}`);
    expect(after).toContain('Ничего не найдено');
  });

  it('продажа без фото: «Пропустить» публикует объявление без обложки', async () => {
    const chat = newChat();
    await say(chat, '/start sell');
    await press(chat, 'lg:ru');
    for (const text of [
      `Без фото ${run}`,
      'Ташкент',
      '300000',
      TEXTS.ru.negotiable.final,
      '1',
    ])
      await say(chat, text);
    await say(chat, TEXTS.ru.delivery.PICKUP);
    expect(await say(chat, TEXTS.ru.skip)).toEqual([TEXTS.ru.askPhoto]);
    expect(await say(chat, 'нет фото')).toEqual([TEXTS.ru.needPhoto]);
    await say(chat, TEXTS.ru.skip);
    await send(chat, {
      contact: {
        user_id: chat,
        phone_number: '+99895' + String(chat).padStart(7, '0').slice(-7),
      },
    });
    const listing = await prisma.listing.findFirstOrThrow({
      where: { title: `Без фото ${run}` },
    });
    expect(listing).toMatchObject({ proofPath: null, coverUrl: null });
  });

  it('торг: покупатель предлагает цену, продавец видит имя и скрытый номер и принимает', async () => {
    const seller = newChat();
    const buyer = newChat();
    const phoneOf = (chat: number, code: string) =>
      `+998${code}` + String(chat).padStart(7, '0').slice(-7);
    const share = (chat: number, code: string) =>
      send(chat, {
        contact: { user_id: chat, phone_number: phoneOf(chat, code) },
      });
    const sell = async (title: string, negotiable: string) => {
      await say(seller, '/start sell');
      for (const text of [title, 'Ташкент', '400000', negotiable, '2'])
        await say(seller, text);
      await say(seller, TEXTS.ru.delivery.PICKUP);
      await say(seller, TEXTS.ru.skip);
      await say(seller, TEXTS.ru.skip);
      return prisma.listing.findFirstOrThrow({ where: { title } });
    };

    // Продавец: после цены бот спрашивает, окончательная она или торг уместен.
    await say(seller, '/start sell');
    await press(seller, 'lg:ru');
    for (const text of [`Торг ${run}`, 'Ташкент']) await say(seller, text);
    expect(await say(seller, '400000')).toEqual([TEXTS.ru.askNegotiable]);
    expect(await say(seller, 'не знаю')).toEqual([TEXTS.ru.useButtons]);
    expect(await say(seller, TEXTS.ru.negotiable.open)).toEqual([
      TEXTS.ru.askQty,
    ]);
    await say(seller, '2');
    await say(seller, TEXTS.ru.delivery.PICKUP);
    await say(seller, TEXTS.ru.skip);
    await say(seller, TEXTS.ru.skip);
    await share(seller, '97');
    const listing = await prisma.listing.findFirstOrThrow({
      where: { title: `Торг ${run}` },
    });
    expect(listing.negotiable).toBe(true);
    const fixed = await sell(`Без торга ${run}`, TEXTS.ru.negotiable.final);
    expect(fixed.negotiable).toBe(false);

    // Покупатель: предложить цену можно и за билет с окончательной ценой.
    await say(buyer, '/start');
    await press(buyer, 'lg:ru');
    expect(await press(buyer, `o:${fixed.id}`)).toEqual([TEXTS.ru.howMany]);

    // Цена не ниже цены продавца — отказ; номер бот просит один раз.
    expect(await press(buyer, `o:${listing.id}`)).toEqual([TEXTS.ru.howMany]);
    await press(buyer, `oq:${listing.id}:2`);
    expect(await say(buyer, 'дёшево')).toEqual([TEXTS.ru.offerPriceError]);
    expect(await say(buyer, '400000')).toEqual([TEXTS.ru.askContact]);
    const [refused] = await share(buyer, '93');
    expect(refused).toContain('ниже цены продавца');

    await press(buyer, `oq:${listing.id}:2`);
    const texts = await say(buyer, '350 000');
    const incoming = texts.find((x) => x?.includes('Вам предложили цену'));
    // Продавцу — имя из Telegram и номер со скрытой серединой, полного номера нет.
    const full = phoneOf(buyer, '93');
    expect(incoming).toContain('Тест');
    expect(incoming).toContain(`+998 93 ••• •• ${full.slice(-2)}`);
    expect(incoming).not.toContain(full.slice(6, 11));
    expect(incoming).toContain('350 000');
    expect(texts.some((x) => x?.includes('Предложение отправлено'))).toBe(true);

    // Второе предложение на тот же билет, пока продавец не ответил, — отказ.
    await press(buyer, `oq:${listing.id}:1`);
    const [twice] = await say(buyer, '300000');
    expect(twice).toContain('дождитесь ответа продавца');

    // То же самое продавец видит через API — без номера покупателя.
    const login = await request(app.getHttpServer())
      .post('/api/auth/telegram')
      .send({ initData: initData(seller) })
      .expect(200);
    const auth = `Bearer ${(login.body as { token: string }).token}`;
    const list = await request(app.getHttpServer())
      .get('/api/me/offers/incoming')
      .set('Authorization', auth)
      .expect(200);
    const offers = list.body as {
      id: string;
      price: number;
      buyer: Record<string, string>;
    }[];
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ price: 350000, listPrice: 400000 });
    expect(offers[0].buyer).toEqual({
      name: 'Тест',
      phoneMasked: `+998 93 ••• •• ${full.slice(-2)}`,
    });
    expect(JSON.stringify(offers)).not.toContain(full);

    // Чужой человек ответить на предложение не может.
    const stranger = newChat();
    await say(stranger, '/start');
    await press(stranger, 'lg:ru');
    await share(stranger, '91');
    await press(stranger, `oa:${offers[0].id}`);
    expect(
      await prisma.purchaseRequest.count({ where: { listingId: listing.id } }),
    ).toBe(0);

    // Продавец принимает: заявка по договорной цене, покупателю приходит ответ.
    const answer = await press(seller, `oa:${offers[0].id}`);
    expect(answer.some((x) => x?.includes('Продавец принял вашу цену'))).toBe(
      true,
    );
    const requests = await prisma.purchaseRequest.findMany({
      where: { listingId: listing.id },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      offerId: offers[0].id,
      qty: 2,
      unitPrice: 350000,
      subtotal: 700000,
      phone: full,
      status: 'NEW',
    });
    // Повторное нажатие вторую заявку не создаёт.
    await press(seller, `oa:${offers[0].id}`);
    await press(seller, `od:${offers[0].id}`);
    expect(
      await prisma.purchaseRequest.count({ where: { listingId: listing.id } }),
    ).toBe(1);
    expect(
      await prisma.priceOffer.findUniqueOrThrow({
        where: { id: offers[0].id },
      }),
    ).toMatchObject({ status: 'ACCEPTED' });
  });

  it('торг через API: цену можно предложить на любой билет, отклонённое предложение можно повторить', async () => {
    const http = () => request(app.getHttpServer());
    const account = async (role: string) => {
      const phone =
        '+99890' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
      const res = await http()
        .post('/api/auth/register')
        .send({ name: 'Гость', phone, password: 'secret123', role })
        .expect(200);
      return `Bearer ${(res.body as { token: string }).token}`;
    };
    const seller = await account('SELLER');
    const buyer = await account('BUYER');
    const create = async (negotiable?: string) => {
      const req = http()
        .post('/api/listings')
        .set('Authorization', seller)
        .field('title', `API торг ${run}`)
        .field('city', 'Ташкент')
        .field('qty', '1')
        .field('price', '200000')
        .field('delivery', 'PICKUP');
      if (negotiable) void req.field('negotiable', negotiable);
      const res = await req.expect(201);
      return res.body as { id: string; negotiable: boolean };
    };
    const offer = (listingId: string, price: number, auth = buyer) =>
      http()
        .post('/api/offers')
        .set('Authorization', auth)
        .send({ listingId, qty: 1, price });

    // Без поля negotiable цена окончательная.
    const fixed = await create();
    expect(fixed.negotiable).toBe(false);
    await offer(fixed.id, 150000).expect(201);
    await http()
      .post('/api/listings')
      .set('Authorization', seller)
      .field('title', 'x1')
      .field('city', 'Ташкент')
      .field('qty', '1')
      .field('price', '200000')
      .field('delivery', 'PICKUP')
      .field('negotiable', 'maybe')
      .expect(400);

    const open = await create('true');
    expect(open.negotiable).toBe(true);
    await offer(open.id, 200000).expect(400); // не ниже цены продавца
    await offer(open.id, 150000, seller).expect(400); // свой билет
    await http()
      .post('/api/offers')
      .send({ listingId: open.id, qty: 1, price: 150000 })
      .expect(401);
    const first = await offer(open.id, 150000).expect(201);
    const id = (first.body as { id: string }).id;
    expect(first.body).not.toHaveProperty('phone');
    await offer(open.id, 160000).expect(409); // ждёт ответа

    await http()
      .post(`/api/offers/${id}/accept`)
      .set('Authorization', buyer)
      .expect(404);
    await http()
      .post(`/api/offers/${id}/decline`)
      .set('Authorization', seller)
      .expect(200);
    await http()
      .post(`/api/offers/${id}/accept`)
      .set('Authorization', seller)
      .expect(409);
    const mine = await http()
      .get('/api/me/offers')
      .set('Authorization', buyer)
      .expect(200);
    expect(mine.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id, status: 'DECLINED', price: 150000 }),
      ]),
    );

    // После отказа — новая цена; продавец принимает, в «Моих заявках» цена договорная.
    const second = await offer(open.id, 180000).expect(201);
    const accepted = await http()
      .post(`/api/offers/${(second.body as { id: string }).id}/accept`)
      .set('Authorization', seller)
      .expect(200);
    expect(
      (accepted.body as { requestNumber: number }).requestNumber,
    ).toBeGreaterThan(0);
    const reqs = await http()
      .get('/api/me/requests')
      .set('Authorization', buyer)
      .expect(200);
    expect(reqs.body).toMatchObject([
      { unitPrice: 180000, listPrice: 200000, total: 192600 },
    ]);

    // Торг можно выключить правкой объявления.
    const patched = await http()
      .patch(`/api/listings/${open.id}`)
      .set('Authorization', seller)
      .send({ negotiable: false })
      .expect(200);
    expect((patched.body as { negotiable: boolean }).negotiable).toBe(false);
  });

  it('мини-приложение: вход по подписи Telegram, аккаунт — после «Поделиться номером»', async () => {
    const chat = newChat();
    const login = (data: string) =>
      request(app.getHttpServer())
        .post('/api/auth/telegram')
        .send({ initData: data });
    await say(chat, '/start');
    await press(chat, 'lg:uz');

    // Номера ещё нет: вход проходит, но без токена; язык — как в боте.
    const guest = await login(initData(chat)).expect(200);
    expect(guest.body).toEqual({ token: null, user: null, lang: 'uz' });

    // Контакт приходит боту вне сценария — так его отправляет мини-приложение.
    const phone = '+99894' + String(chat).padStart(7, '0').slice(-7);
    expect(
      await send(chat, { contact: { user_id: chat + 1, phone_number: phone } }),
    ).toEqual([TEXTS.uz.ownNumber]);
    expect(
      await send(chat, { contact: { user_id: chat, phone_number: phone } }),
    ).toEqual([TEXTS.uz.phoneLinked]);

    const res = await login(initData(chat)).expect(200);
    const body = res.body as { token: string; user: { phone: string } };
    expect(body.user.phone).toBe(phone);
    const me = await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${body.token}`)
      .expect(200);
    expect(me.body).toMatchObject({ phone, lang: 'uz' });
  });

  it('мини-приложение: чужая, просроченная и испорченная подпись — 401', async () => {
    const login = (data: string) =>
      request(app.getHttpServer())
        .post('/api/auth/telegram')
        .send({ initData: data });
    const chat = newChat();
    await login(initData(chat, '2:OTHER')).expect(401);
    await login(initData(chat, BOT_TOKEN, 2 * 86_400)).expect(401);
    await login(initData(chat).replace('%D0%A2', '%D0%A3')).expect(401);
    await login('hash=00').expect(401);
  });

  it('мини-приложение: настройки для экранов', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/miniapp/config')
      .expect(200);
    expect(res.body).toMatchObject({ feePercent: 7, commissionPercent: 10 });
    expect(Array.isArray((res.body as { cities: string[] }).cities)).toBe(true);
  });
});
