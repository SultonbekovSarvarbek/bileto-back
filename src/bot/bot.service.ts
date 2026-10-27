import {
  HttpException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Delivery } from '@prisma/client';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { ListingsService } from '../listings/listings.service';
import { RequestsService } from '../requests/requests.service';
import { escapeHtml as h } from '../telegram/telegram.service';
import { normalizeUzPhone } from '../common/utils/phone';
import { PHOTOS_DIR } from '../common/utils/upload';
import { formatSum } from '../common/utils/money';
import { formatPhone } from '../common/utils/phone';
import { hashPassword } from '../common/utils/password';
import {
  ASK_CONTACT,
  CANCEL,
  contactKeyboard,
  DELIVERY,
  feedLine,
  listingCard,
  LISTING_STATUS,
  MENU,
  menuKeyboard,
  REQUEST_STATUS,
  requestDone,
  SKIP,
  stepKeyboard,
  WELCOME,
} from './bot.texts';

type TgUser = { id: number; first_name?: string; last_name?: string };
type TgMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  contact?: { phone_number: string; user_id?: number };
  photo?: { file_id: string }[];
};
type TgCallback = {
  id: string;
  data?: string;
  from: TgUser;
  message?: TgMessage;
};
type Update = {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallback;
};
type Button = { text: string; callback_data: string };

type Draft = {
  title?: string;
  city?: string;
  price?: number;
  qty?: number;
  delivery?: Delivery;
  description?: string;
  photoFileId?: string;
};
type SellStep =
  'title' | 'city' | 'price' | 'qty' | 'delivery' | 'description' | 'photo';
// Действие, которое ждёт номер телефона.
type Pending =
  | { type: 'buy'; listingId: string; qty: number }
  | { type: 'sell'; draft: Draft }
  | { type: 'password' };
type ChatState =
  | { kind: 'sell'; step: SellStep; draft: Draft }
  | { kind: 'contact'; pending: Pending }
  | { kind: 'password'; userId: string };
type BotUser = { id: string; phone: string; name: string | null; role: string };

const FEED_PAGE = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tgName = (u: TgUser) =>
  [u.first_name, u.last_name].filter(Boolean).join(' ').trim().slice(0, 60);

// Публичный бот для покупателей и продавцов — пока приложение на проверке в App Store.
// Регистрации нет: пользователя узнаём по Telegram ID, номер берём кнопкой «Поделиться номером»
// (Telegram подтверждает, что контакт свой). Заявки и объявления идут через те же сервисы,
// что и в приложении, поэтому операторы получают их в обычный чат.
// Состояние диалогов хранится в памяти: после перезапуска незаконченный шаг начинается заново.
@Injectable()
export class BotService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(BotService.name);
  private readonly token?: string;
  private readonly abort = new AbortController();
  private username?: string;
  private readonly states = new Map<number, ChatState>();
  private readonly feeds = new Map<number, { city?: string; q?: string }>();
  private readonly queues = new Map<number, Promise<void>>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly requests: RequestsService,
  ) {
    this.token = config.get<string>('TELEGRAM_PUBLIC_BOT_TOKEN') || undefined;
  }

  onApplicationBootstrap() {
    if (this.token && this.config.get<string>('TELEGRAM_POLLING') !== 'false')
      void this.poll();
  }

  onApplicationShutdown() {
    this.abort.abort();
  }

  // ---------- Telegram API ----------

  private async api<T>(
    method: string,
    body: Record<string, unknown> | FormData,
  ): Promise<T> {
    const isForm = body instanceof FormData;
    const res = await fetch(
      `https://api.telegram.org/bot${this.token}/${method}`,
      {
        method: 'POST',
        headers: isForm ? undefined : { 'Content-Type': 'application/json' },
        body: isForm ? body : JSON.stringify(body),
        signal: this.abort.signal,
      },
    );
    const json = (await res.json()) as {
      ok: boolean;
      result: T;
      description?: string;
    };
    if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
    return json.result;
  }

  private say(chat: number, html: string, markup: object = menuKeyboard) {
    return this.api('sendMessage', {
      chat_id: chat,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: markup,
    });
  }

  private inline(buttons: Button[][]) {
    return { inline_keyboard: buttons };
  }

  private async download(fileId: string): Promise<Buffer> {
    const f = await this.api<{ file_path: string }>('getFile', {
      file_id: fileId,
    });
    const res = await fetch(
      `https://api.telegram.org/file/bot${this.token}/${f.file_path}`,
      { signal: this.abort.signal },
    );
    if (!res.ok) throw new Error(`Telegram file: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  // ---------- Цикл обновлений ----------

  private async poll() {
    let offset = 0;
    while (!this.abort.signal.aborted) {
      try {
        if (!this.username) {
          this.username = (
            await this.api<{ username: string }>('getMe', {})
          ).username;
          this.logger.log(`Публичный бот @${this.username} запущен`);
        }
        const updates = await this.api<Update[]>('getUpdates', {
          offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query'],
        });
        for (const u of updates) {
          offset = u.update_id + 1;
          this.dispatch(u);
        }
      } catch (e) {
        if (this.abort.signal.aborted) return;
        this.logger.warn(`polling: ${String(e)}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  // Обновления одного чата обрабатываются по очереди, разные чаты — параллельно.
  private dispatch(u: Update) {
    const chat = u.message?.chat.id ?? u.callback_query?.from.id;
    if (chat === undefined) return;
    const job = async () => {
      try {
        if (u.message) await this.onMessage(u.message);
        else if (u.callback_query) await this.onCallback(u.callback_query);
      } catch (e) {
        this.logger.error(`чат ${chat}: ${String(e)}`);
        await this.say(chat, 'Что-то пошло не так, попробуйте ещё раз.').catch(
          () => undefined,
        );
      }
    };
    const run = (this.queues.get(chat) ?? Promise.resolve()).then(job);
    this.queues.set(chat, run);
    void run.finally(() => {
      if (this.queues.get(chat) === run) this.queues.delete(chat);
    });
  }

  private async onMessage(m: TgMessage) {
    if (m.chat.type !== 'private' || !m.from) return;
    const chat = m.chat.id;
    const text = m.text?.trim() ?? '';

    if (text.startsWith('/start')) {
      this.states.delete(chat);
      const arg = text.split(/\s+/)[1];
      if (arg && UUID.test(arg)) return this.showListing(chat, arg);
      return this.say(chat, WELCOME);
    }
    if (text === CANCEL || text === '/cancel') {
      this.states.delete(chat);
      return this.say(chat, 'Отменено.');
    }
    if (Object.values(MENU).includes(text)) this.states.delete(chat);

    const state = this.states.get(chat);
    if (state?.kind === 'contact') return this.onContact(m, state.pending);
    if (state?.kind === 'sell') return this.onSellStep(m, state);
    if (state?.kind === 'password') return this.onPassword(m, state.userId);

    switch (text) {
      case MENU.buy:
        return this.showCities(chat);
      case MENU.sell:
        return this.startSell(chat);
      case MENU.myListings:
        return this.showMyListings(chat, m.from.id);
      case MENU.myRequests:
        return this.showMyRequests(chat, m.from.id);
      case MENU.app:
        return this.withUser(chat, m.from, { type: 'password' });
    }
    if (text && !text.startsWith('/')) {
      this.feeds.set(chat, { q: text.slice(0, 100) });
      return this.showFeed(chat, 1);
    }
    return this.say(chat, WELCOME);
  }

  private async onCallback(q: TgCallback) {
    const chat = q.message?.chat.id ?? q.from.id;
    const [kind, arg, extra] = (q.data ?? '').split(':');
    let notice: string | undefined;
    try {
      switch (kind) {
        case 'c':
          this.feeds.set(chat, arg ? { city: arg } : {});
          await this.showFeed(chat, 1);
          break;
        case 'p':
          await this.showFeed(chat, Number(arg) || 1, q.message?.message_id);
          break;
        case 'l':
          await this.showListing(chat, arg);
          break;
        case 'b':
          await this.chooseQty(chat, q.from, arg);
          break;
        case 'q':
          await this.withUser(chat, q.from, {
            type: 'buy',
            listingId: arg,
            qty: Number(extra),
          });
          break;
        case 'ms':
        case 'ma':
          notice = await this.closeListing(q.from.id, arg, kind === 'ms');
          if (q.message)
            await this.showMyListings(chat, q.from.id, q.message.message_id);
          break;
      }
    } catch (e) {
      if (!(e instanceof HttpException)) throw e;
      notice = e.message;
    } finally {
      await this.api('answerCallbackQuery', {
        callback_query_id: q.id,
        text: notice,
      }).catch(() => undefined);
    }
  }

  // ---------- Пользователь и номер ----------

  private userByTg(tgId: number): Promise<BotUser | null> {
    return this.prisma.user.findUnique({
      where: { telegramId: String(tgId) },
      select: { id: true, phone: true, name: true, role: true },
    });
  }

  // Выполняет действие сразу, если номер уже известен, иначе сначала просит контакт.
  private async withUser(chat: number, from: TgUser, pending: Pending) {
    const user = await this.userByTg(from.id);
    if (user) return this.run(chat, from, user, pending);
    this.states.set(chat, { kind: 'contact', pending });
    return this.say(chat, ASK_CONTACT, contactKeyboard);
  }

  private async onContact(m: TgMessage, pending: Pending) {
    const chat = m.chat.id;
    const from = m.from!;
    const c = m.contact;
    if (!c) return this.say(chat, ASK_CONTACT, contactKeyboard);
    if (c.user_id !== from.id)
      return this.say(
        chat,
        'Нужен ваш собственный номер — нажмите кнопку ниже.',
        contactKeyboard,
      );
    const phone = normalizeUzPhone(c.phone_number);
    if (!phone) {
      this.states.delete(chat);
      return this.say(
        chat,
        'Пока работаем только с номерами Узбекистана (+998). Напишите оператору или попробуйте с другого аккаунта.',
      );
    }

    // Номер подтверждён Telegram, поэтому привязываем существующий аккаунт с этим номером.
    const tgId = String(from.id);
    const [, user] = await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { telegramId: tgId, NOT: { phone } },
        data: { telegramId: null },
      }),
      this.prisma.user.upsert({
        where: { phone },
        update: { telegramId: tgId },
        create: { phone, telegramId: tgId, name: tgName(from) || null },
        select: { id: true, phone: true, name: true, role: true },
      }),
    ]);
    // Заявки, оставленные с этого номера без входа (в приложении или до привязки), — теперь его.
    await this.prisma.purchaseRequest.updateMany({
      where: { phone, userId: null },
      data: { userId: user.id },
    });
    this.states.delete(chat);
    return this.run(chat, from, user, pending);
  }

  private run(chat: number, from: TgUser, user: BotUser, p: Pending) {
    if (p.type === 'buy')
      return this.createRequest(chat, from, user, p.listingId, p.qty);
    if (p.type === 'sell') return this.publish(chat, user, p.draft);
    this.states.set(chat, { kind: 'password', userId: user.id });
    return this.say(
      chat,
      [
        '🔑 <b>Вход в приложение Bileto</b>',
        '',
        `Ваш номер: ${formatPhone(user.phone)}`,
        'Придумайте пароль (от 6 символов) и отправьте его сообщением. Сообщение с паролем бот сразу удалит.',
        '',
        'В приложении нажмите «Войти» и введите этот номер и пароль — там будут ваши объявления и заявки.',
      ].join('\n'),
      stepKeyboard(),
    );
  }

  // Номер подтверждён Telegram, поэтому пароль можно задать или сменить без старого.
  private async onPassword(m: TgMessage, userId: string) {
    const chat = m.chat.id;
    const password = m.text ?? '';
    if (!m.text)
      return this.say(chat, 'Отправьте пароль текстом.', stepKeyboard());
    await this.api('deleteMessage', {
      chat_id: chat,
      message_id: m.message_id,
    }).catch(() => undefined);
    if (password.length < 6 || password.length > 72)
      return this.say(
        chat,
        'Пароль — от 6 до 72 символов. Попробуйте ещё раз.',
        stepKeyboard(),
      );
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password) },
    });
    this.states.delete(chat);
    return this.say(
      chat,
      '✅ Пароль сохранён. Войдите в приложении Bileto по своему номеру и этому паролю.',
    );
  }

  // ---------- Покупка ----------

  private async showCities(chat: number) {
    const cities = await this.prisma.listing.groupBy({
      by: ['city'],
      where: { status: 'ACTIVE', qtyAvailable: { gt: 0 } },
      _count: { city: true },
      orderBy: { _count: { city: 'desc' } },
      take: 10,
    });
    if (!cities.length)
      return this.say(chat, 'Пока нет билетов в продаже — загляните позже.');
    const buttons = cities
      .map((c) => ({
        text: `${c.city} (${c._count.city})`,
        callback_data: `c:${c.city}`,
      }))
      .filter((b) => Buffer.byteLength(b.callback_data) <= 64);
    const rows: Button[][] = [[{ text: '🌍 Все города', callback_data: 'c:' }]];
    for (let i = 0; i < buttons.length; i += 2)
      rows.push(buttons.slice(i, i + 2));
    return this.say(
      chat,
      'Выберите город — или напишите название события для поиска.',
      this.inline(rows),
    );
  }

  private async showFeed(chat: number, page: number, editId?: number) {
    const filter = this.feeds.get(chat) ?? {};
    const { items, total } = await this.listings.feed({
      ...filter,
      page,
      limit: FEED_PAGE,
    });
    if (!total) {
      const html = filter.q
        ? `По запросу «${h(filter.q)}» ничего не нашли. Попробуйте короче или выберите «${MENU.buy}».`
        : 'Билетов пока нет — загляните позже.';
      return this.say(chat, html);
    }
    const pages = Math.ceil(total / FEED_PAGE);
    const header = filter.q
      ? `🔍 «${h(filter.q)}»`
      : `🎟 Билеты${filter.city ? ` — ${h(filter.city)}` : ''}`;
    const html = [
      `${header} · ${total} шт., стр. ${page}/${pages}`,
      '',
      ...items.map((l, i) => feedLine(i + 1, l)),
      '',
      'Нажмите номер, чтобы открыть объявление.',
    ].join('\n');
    const nav: Button[] = [];
    if (page > 1) nav.push({ text: '◀️', callback_data: `p:${page - 1}` });
    if (page < pages) nav.push({ text: '▶️', callback_data: `p:${page + 1}` });
    const markup = this.inline([
      items.map((l, i) => ({
        text: String(i + 1),
        callback_data: `l:${l.id}`,
      })),
      ...(nav.length ? [nav] : []),
    ]);
    if (editId)
      return this.api('editMessageText', {
        chat_id: chat,
        message_id: editId,
        text: html,
        parse_mode: 'HTML',
        reply_markup: markup,
      }).catch(() => undefined); // «message is not modified» при повторном нажатии
    return this.say(chat, html, markup);
  }

  private async showListing(chat: number, id: string) {
    const l = await this.listings.getPublic(id).catch(() => null);
    if (!l) return this.say(chat, 'Объявление не найдено или снято с продажи.');
    const active = l.status === 'ACTIVE' && l.qtyAvailable > 0;
    const markup = this.inline(
      active ? [[{ text: '🛒 Купить', callback_data: `b:${l.id}` }]] : [],
    );
    const caption = listingCard(l);
    if (l.coverUrl) {
      try {
        return await this.sendPhoto(chat, l.coverUrl, caption, markup);
      } catch (e) {
        this.logger.warn(`обложка ${l.id}: ${String(e)}`);
      }
    }
    return this.say(chat, caption, markup);
  }

  // coverUrl — афиша по http(s) или путь /photos/… / /covers/… внутри uploads.
  private async sendPhoto(
    chat: number,
    coverUrl: string,
    caption: string,
    markup: object,
  ) {
    const common = { caption, parse_mode: 'HTML', reply_markup: markup };
    if (/^https?:\/\//.test(coverUrl))
      return this.api('sendPhoto', {
        chat_id: chat,
        photo: coverUrl,
        ...common,
      });
    const path = join(process.cwd(), 'uploads', coverUrl);
    if (!existsSync(path)) throw new Error(`нет файла ${path}`);
    const form = new FormData();
    form.append('chat_id', String(chat));
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    form.append('reply_markup', JSON.stringify(markup));
    form.append('photo', new Blob([await readFile(path)]), basename(path));
    return this.api('sendPhoto', form);
  }

  private async chooseQty(chat: number, from: TgUser, id: string) {
    const l = await this.prisma.listing.findUnique({ where: { id } });
    if (!l || l.status !== 'ACTIVE' || l.qtyAvailable < 1)
      return this.say(chat, 'Этот билет уже недоступен.');
    if (l.qtyAvailable === 1)
      return this.withUser(chat, from, { type: 'buy', listingId: id, qty: 1 });
    const n = Math.min(l.qtyAvailable, 10);
    const buttons = Array.from({ length: n }, (_, i) => ({
      text: String(i + 1),
      callback_data: `q:${id}:${i + 1}`,
    }));
    const rows: Button[][] = [];
    for (let i = 0; i < buttons.length; i += 5)
      rows.push(buttons.slice(i, i + 5));
    return this.say(chat, 'Сколько билетов нужно?', this.inline(rows));
  }

  private async createRequest(
    chat: number,
    from: TgUser,
    user: BotUser,
    listingId: string,
    qty: number,
  ) {
    const name = user.name ?? tgName(from);
    try {
      const r = await this.requests.create(
        {
          listingId,
          qty,
          name: name.length >= 2 ? name : 'Покупатель',
          phone: user.phone,
        },
        user.id,
      );
      return this.say(
        chat,
        requestDone(r.number, r.listing.title, r.qty, r.unitPrice),
      );
    } catch (e) {
      if (e instanceof HttpException) return this.say(chat, h(e.message));
      throw e;
    }
  }

  private async showMyRequests(chat: number, tgId: number) {
    const user = await this.userByTg(tgId);
    const rows = user ? (await this.requests.mine(user.id)).slice(0, 15) : [];
    if (!rows.length)
      return this.say(
        chat,
        'Заявок пока нет. Найдите билет через «🎟 Купить билет».',
      );
    const html = [
      '🧾 <b>Мои заявки</b>',
      '',
      ...rows.map(
        (r) =>
          `#${r.number} <b>${h(r.listing.title)}</b>\n    ${r.qty} шт. · ${formatSum(r.total)} · ${REQUEST_STATUS[r.status]}`,
      ),
    ].join('\n');
    return this.say(chat, html);
  }

  // ---------- Продажа ----------

  private async startSell(chat: number) {
    this.states.set(chat, { kind: 'sell', step: 'title', draft: {} });
    return this.say(
      chat,
      '💰 <b>Новое объявление</b>\n\nНа какое событие билет? Например: «Концерт Шахзоды, 15 ноября».',
      stepKeyboard(),
    );
  }

  private async onSellStep(
    m: TgMessage,
    state: Extract<ChatState, { kind: 'sell' }>,
  ) {
    const chat = m.chat.id;
    const text = m.text?.trim() ?? '';
    const d = state.draft;
    const next = (step: SellStep, html: string, options?: string[][]) => {
      state.step = step;
      return this.say(chat, html, stepKeyboard(options));
    };

    switch (state.step) {
      case 'title':
        if (text.length < 2 || text.length > 120)
          return this.say(
            chat,
            'Название — от 2 до 120 символов.',
            stepKeyboard(),
          );
        d.title = text;
        return next('city', 'Город?', await this.cityOptions());
      case 'city':
        if (text.length < 2 || text.length > 60)
          return this.say(chat, 'Напишите город.', stepKeyboard());
        d.city = text;
        return next('price', 'Цена за 1 билет в сумах? Например: 250000');
      case 'price': {
        const price = Number(text.replace(/\D/g, ''));
        if (!price || price < 1000 || price > 100_000_000)
          return this.say(
            chat,
            'Цена — число от 1 000 до 100 000 000 сум.',
            stepKeyboard(),
          );
        d.price = price;
        return next('qty', 'Сколько билетов продаёте?', [
          ['1', '2', '3', '4', '5'],
          ['6', '7', '8', '9', '10'],
        ]);
      }
      case 'qty': {
        const qty = Number(text);
        if (!Number.isInteger(qty) || qty < 1 || qty > 10)
          return this.say(chat, 'От 1 до 10 билетов.', stepKeyboard());
        d.qty = qty;
        return next('delivery', 'Как покупатель получит билет?', [
          [DELIVERY.DELIVERY, DELIVERY.PICKUP],
        ]);
      }
      case 'delivery': {
        const found = (Object.keys(DELIVERY) as Delivery[]).find(
          (k) => DELIVERY[k] === text,
        );
        if (!found)
          return this.say(
            chat,
            'Выберите вариант кнопкой.',
            stepKeyboard([[DELIVERY.DELIVERY, DELIVERY.PICKUP]]),
          );
        d.delivery = found;
        return next(
          'description',
          'Описание: сектор, ряд, место, формат билета (электронный/бумажный). Контакты не пишите — связь через оператора.',
          [[SKIP]],
        );
      }
      case 'description':
        if (text !== SKIP) {
          if (!text || text.length > 1000)
            return this.say(
              chat,
              'Описание — до 1000 символов.',
              stepKeyboard([[SKIP]]),
            );
          d.description = text;
        }
        return next(
          'photo',
          '📷 Пришлите фото билета или афиши (как фото, не файлом). Оно станет обложкой объявления.',
        );
      case 'photo': {
        const photo = m.photo?.at(-1);
        if (!photo) return this.say(chat, 'Нужна фотография.', stepKeyboard());
        d.photoFileId = photo.file_id;
        this.states.delete(chat);
        return this.withUser(chat, m.from!, { type: 'sell', draft: d });
      }
    }
  }

  private async cityOptions() {
    const rows = await this.prisma.listing.groupBy({
      by: ['city'],
      where: { status: 'ACTIVE' },
      _count: { city: true },
      orderBy: { _count: { city: 'desc' } },
      take: 4,
    });
    const cities = rows.map((r) => r.city);
    if (!cities.length) cities.push('Ташкент', 'Самарканд');
    return [cities.slice(0, 2), cities.slice(2, 4)].filter((r) => r.length);
  }

  private async publish(chat: number, user: BotUser, d: Draft) {
    await mkdir(PHOTOS_DIR, { recursive: true });
    const path = join(PHOTOS_DIR, `${randomUUID()}.jpg`);
    await writeFile(path, await this.download(d.photoFileId!));
    // Кто выставил билет через бота — продавец.
    if (user.role !== 'SELLER')
      await this.prisma.user.update({
        where: { id: user.id },
        data: { role: 'SELLER' },
      });
    const l = await this.listings.create(
      user.id,
      {
        title: d.title!,
        city: d.city!,
        price: d.price!,
        qty: d.qty!,
        delivery: d.delivery!,
        description: d.description,
      },
      path,
    );
    return this.say(
      chat,
      [
        '✅ <b>Объявление опубликовано</b>',
        '',
        `<b>${h(l.title)}</b> — ${l.qty} шт. × ${formatSum(l.price)}`,
        '',
        'Когда найдётся покупатель, оператор Bileto позвонит вам.',
        ...(this.username
          ? [
              '',
              `Ссылка, чтобы поделиться: https://t.me/${this.username}?start=${l.id}`,
            ]
          : []),
      ].join('\n'),
    );
  }

  private async showMyListings(chat: number, tgId: number, editId?: number) {
    const user = await this.userByTg(tgId);
    const rows = user ? (await this.listings.mine(user.id)).slice(0, 10) : [];
    if (!rows.length)
      return this.say(
        chat,
        `Объявлений пока нет. Создайте через «${MENU.sell}».`,
      );
    const html = [
      '📋 <b>Мои объявления</b>',
      '',
      ...rows.map(
        (l, i) =>
          `${i + 1}. <b>${h(l.title)}</b>\n    ${l.qtyAvailable}/${l.qty} шт. · ${formatSum(l.price)} · ${LISTING_STATUS[l.status]}`,
      ),
    ].join('\n');
    const buttons: Button[][] = rows
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => l.status === 'ACTIVE')
      .map(({ l, n }) => [
        { text: `${n}. ✅ Продал сам`, callback_data: `ms:${l.id}` },
        { text: `${n}. 🗑 Снять`, callback_data: `ma:${l.id}` },
      ]);
    if (editId)
      return this.api('editMessageText', {
        chat_id: chat,
        message_id: editId,
        text: html,
        parse_mode: 'HTML',
        reply_markup: this.inline(buttons),
      }).catch(() => undefined);
    return this.say(chat, html, this.inline(buttons));
  }

  private async closeListing(tgId: number, id: string, sold: boolean) {
    const user = await this.userByTg(tgId);
    if (!user) return 'Объявление не найдено';
    if (sold) await this.listings.markSold(user.id, id);
    else await this.listings.archive(user.id, id);
    return sold ? 'Отмечено как проданное' : 'Объявление снято';
  }
}
