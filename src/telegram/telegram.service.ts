import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { basename } from 'path';

export type InlineButton = { text: string; callback_data: string };
export type CallbackQuery = {
  id: string;
  data?: string;
  from: { first_name?: string; last_name?: string; username?: string };
  message?: { message_id: number };
};
// Возвращает текст всплывающего уведомления для нажавшего кнопку.
export type CallbackHandler = (q: CallbackQuery) => Promise<string>;

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Бот шлёт заявки и новые объявления в чат операторов и принимает нажатия кнопок
// через long polling (публичный URL для webhook не нужен).
// Без TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID сообщения только пишутся в лог.
@Injectable()
export class TelegramService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TelegramService.name);
  private readonly token?: string;
  private readonly chatId?: string;
  private handler?: CallbackHandler;
  private readonly abort = new AbortController();

  constructor(private readonly config: ConfigService) {
    this.token = config.get<string>('TELEGRAM_BOT_TOKEN') || undefined;
    this.chatId = config.get<string>('TELEGRAM_CHAT_ID') || undefined;
  }

  get enabled() {
    return !!this.token && !!this.chatId;
  }

  onCallback(handler: CallbackHandler) {
    this.handler = handler;
  }

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

  private markup(buttons: InlineButton[][]) {
    return { inline_keyboard: buttons };
  }

  /** Отправить сообщение в чат операторов. Возвращает id сообщения или null, если бот не настроен. */
  async send(
    html: string,
    buttons: InlineButton[][] = [],
  ): Promise<number | null> {
    if (!this.enabled) {
      this.logger.log(`[telegram выключен]\n${html}`);
      return null;
    }
    const msg = await this.api<{ message_id: number }>('sendMessage', {
      chat_id: this.chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: this.markup(buttons),
    });
    return msg.message_id;
  }

  /** Фото с подписью; если Telegram не принял фото — обычное сообщение. */
  async sendPhoto(
    path: string,
    html: string,
    buttons: InlineButton[][] = [],
  ): Promise<number | null> {
    if (!this.enabled) return this.send(html, buttons);
    try {
      const form = new FormData();
      form.append('chat_id', this.chatId!);
      form.append('caption', html);
      form.append('parse_mode', 'HTML');
      form.append('reply_markup', JSON.stringify(this.markup(buttons)));
      form.append('photo', new Blob([await readFile(path)]), basename(path));
      const msg = await this.api<{ message_id: number }>('sendPhoto', form);
      return msg.message_id;
    } catch (e) {
      this.logger.warn(`sendPhoto failed, sending text: ${String(e)}`);
      return this.send(html, buttons);
    }
  }

  async edit(
    messageId: number,
    html: string,
    buttons: InlineButton[][],
    caption = false,
  ) {
    if (!this.enabled) return;
    await this.api(caption ? 'editMessageCaption' : 'editMessageText', {
      chat_id: this.chatId,
      message_id: messageId,
      [caption ? 'caption' : 'text']: html,
      parse_mode: 'HTML',
      reply_markup: this.markup(buttons),
    }).catch((e: unknown) => this.logger.warn(String(e)));
  }

  onApplicationBootstrap() {
    if (this.enabled && this.config.get<string>('TELEGRAM_POLLING') !== 'false')
      void this.poll();
  }

  onApplicationShutdown() {
    this.abort.abort();
  }

  private async poll() {
    let offset = 0;
    this.logger.log('Telegram polling started');
    while (!this.abort.signal.aborted) {
      try {
        const updates = await this.api<
          { update_id: number; callback_query?: CallbackQuery }[]
        >('getUpdates', {
          offset,
          timeout: 25,
          allowed_updates: ['callback_query'],
        });
        for (const u of updates) {
          offset = u.update_id + 1;
          if (u.callback_query) await this.answer(u.callback_query);
        }
      } catch (e) {
        if (this.abort.signal.aborted) return;
        this.logger.warn(`polling: ${String(e)}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  private async answer(q: CallbackQuery) {
    let text = 'Неизвестная команда';
    try {
      if (this.handler) text = await this.handler(q);
    } catch (e) {
      this.logger.error(`callback ${q.data}: ${String(e)}`);
      text = 'Ошибка, попробуйте ещё раз';
    }
    await this.api('answerCallbackQuery', {
      callback_query_id: q.id,
      text,
    }).catch(() => undefined);
  }
}

export const actorName = (q: CallbackQuery) =>
  [q.from.first_name, q.from.last_name].filter(Boolean).join(' ') ||
  q.from.username ||
  'оператор';
