// Убирает из описания объявления контакты продавца: телефоны, Telegram-ники и ссылки.
// Связь покупателя с продавцом идёт только через заявку и оператора.
const PHONE =
  /(?:\+?\b998[\s()-]*|\b)\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g;
const URL = /(?:https?:\/\/|www\.|t\.me\/)\S+/gi;
const HANDLE = /@[a-z0-9_]{4,}/gi;
const MESSENGER = '(?:tg|тг|telegram+|телеграм+|телег[ау])';
// Ник после «tg:» без пробела, с цифрами/подчёркиванием или в конце строки: «tg:bilet», «тг: user_77», «Tg yozila biletchi».
// Обычные слова после «Telegram: aloqaga …» не трогаем.
const MESSENGER_HANDLE = new RegExp(
  `(${MESSENGER}\\s*[:\\-]?\\s*(?:(?:yozila|ёзила|ezila|пишите|напишите)\\s*[:\\-]?\\s*)?)` +
    `(?:(?<=:)[a-z][a-z0-9_]{3,}|[a-z][a-z0-9_]*[0-9_][a-z0-9_]*|[a-z][a-z0-9_]{3,}(?=\\s*$))`,
  'gimu',
);
// Подпись, от которой после чистки ничего не осталось: «Telegram:», «Тел: », «Писать :».
const DANGLING =
  /(?:^|[\s,.;])(?:tg|тг|telegram+|телеграм+|tel|тел|telefon|телефон|instagram|instagaram|алоқа|aloqa|связь|писать|пишите(?: или звоните)?|звоните|nomer|номер)\s*[:\-–]\s*(?=[\s,.;]*(?:$|\n))/gimu;

// Есть ли в тексте контакты: телефон, @ник, ссылка или ник после «tg:».
export const hasContacts = (text: string) =>
  [PHONE, URL, HANDLE, MESSENGER_HANDLE].some((re) => {
    re.lastIndex = 0; // у глобальных регулярок test() запоминает позицию
    return re.test(text);
  });

export function stripContacts(text: string): string {
  return text
    .replace(URL, '')
    .replace(HANDLE, '')
    .replace(MESSENGER_HANDLE, '$1')
    .replace(PHONE, '')
    .replace(/(^|\s)\*+(?=\s|$)/g, '$1') // OLX заменяет скрытые контакты звёздочкой
    .replace(DANGLING, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
