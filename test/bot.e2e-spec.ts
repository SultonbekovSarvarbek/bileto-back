import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { BotService } from '../src/bot/bot.service';
import { statsText } from '../src/bot/bot.stats';
import { TEXTS, LANG_PROMPT } from '../src/bot/bot.texts';
import { PrismaService } from '../src/prisma/prisma.service';
import { TelegramService } from '../src/telegram/telegram.service';

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
  let app: INestApplication;
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

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TelegramService)
      .useValue({
        enabled: true,
        onCallback() {},
        send: () => Promise.resolve(1),
        sendPhoto: () => Promise.resolve(1),
        edit: () => Promise.resolve(),
      })
      .compile();
    app = mod.createNestApplication();
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
    for (const text of ['Концерт Zivert', 'Ташкент', '500000', '2'])
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
});
