import { Delivery, ListingStatus, RequestStatus } from '@prisma/client';
import { escapeHtml as h } from '../telegram/telegram.service';
import {
  formatSum,
  priceBreakdown,
  serviceFeePercent,
} from '../common/utils/money';

// Тексты публичного бота: русский (по умолчанию) и узбекский на кириллице.

export type BotLang = 'ru' | 'uz';
export const LANGS: BotLang[] = ['ru', 'uz'];
export const LANG_BUTTON = '🌐 Тил / Язык';
export const STATS_BUTTON = '📊 Статистика';
export const TICKETS_BUTTON = '🗑 Билеты';

const ru = {
  menu: {
    buy: '🎟 Купить билет',
    sell: '💰 Продать билет',
    myListings: '📋 Мои объявления',
    myRequests: '🧾 Мои заявки',
    app: '🔑 Вход в приложение',
    download: '📲 Скачать приложение',
    support: '💬 Поддержка',
  },
  support:
    'Есть вопрос или проблема? Напишите менеджеру Bileto — ответим в Telegram.',
  writeSupport: '💬 Написать в поддержку',
  appSoon:
    '📲 <b>Приложение Bileto скоро выйдет!</b>\n\nА пока покупайте и продавайте билеты здесь, в боте.',
  cancel: '❌ Отмена',
  skip: 'Пропустить',
  delivery: {
    DELIVERY: '🚚 Доставка',
    PICKUP: '🤝 Самовывоз',
  } as Record<Delivery, string>,
  // Торг: продавец выбирает при создании объявления.
  negotiable: {
    final: '🔒 Цена окончательная',
    open: '💬 Торг уместен',
  },
  sum: 'сум',
  pcs: 'шт.',
  welcome: [
    '👋 <b>Bileto</b> — перепродажа билетов на концерты и события.',
    '',
    'Без регистрации: выберите билет — оператор перезвонит и проведёт сделку.',
    'Продаёте? Создайте объявление за минуту.',
    '',
    'Чтобы найти событие, просто напишите его название.',
  ].join('\n'),
  askContact:
    'Нажмите «📱 Поделиться номером» — по нему с вами свяжется оператор Bileto.',
  shareContact: '📱 Поделиться номером',
  cancelled: 'Отменено.',
  oops: 'Что-то пошло не так, попробуйте ещё раз.',
  openApp:
    'Удобнее в приложении: билеты, поиск и продажа — прямо в Telegram 👇',
  openAppButton: '🎟 Открыть Bileto',
  phoneLinked: '✅ Номер подтверждён. Вернитесь в приложение Bileto.',
  ownNumber: 'Нужен ваш собственный номер — нажмите кнопку ниже.',
  onlyUz:
    'Пока работаем только с номерами Узбекистана (+998). Напишите оператору или попробуйте с другого аккаунта.',
  appLogin: (phone: string) =>
    [
      '🔑 <b>Вход в приложение Bileto</b>',
      '',
      `Ваш номер: ${phone}`,
      'Придумайте пароль (от 6 символов) и отправьте его сообщением. Сообщение с паролем бот сразу удалит.',
      '',
      'В приложении нажмите «Войти» и введите этот номер и пароль — там будут ваши объявления и заявки.',
    ].join('\n'),
  passwordAsText: 'Отправьте пароль текстом.',
  passwordLength: 'Пароль — от 6 до 72 символов. Попробуйте ещё раз.',
  passwordSaved:
    '✅ Пароль сохранён. Войдите в приложении Bileto по своему номеру и этому паролю.',
  noTickets: 'Пока нет билетов в продаже — загляните позже.',
  chooseCity: 'Выберите город — или напишите название события для поиска.',
  allCities: '🌍 Все города',
  nothingFound: (q: string, buy: string) =>
    `По запросу «${q}» ничего не нашли. Попробуйте короче или выберите «${buy}».`,
  feedTitle: (city?: string) => `🎟 Билеты${city ? ` — ${city}` : ''}`,
  feedMeta: (total: number, page: number, pages: number) =>
    `${total} шт., стр. ${page}/${pages}`,
  tapNumber: 'Нажмите номер, чтобы открыть объявление.',
  listingGone: 'Объявление не найдено или снято с продажи.',
  buy: '🛒 Купить',
  unavailable: 'Этот билет уже недоступен.',
  howMany: 'Сколько билетов нужно?',
  offer: '💬 Предложить цену',
  offerAsk: (price: string) =>
    `Цена продавца — ${price} за билет. Какую цену за 1 билет предлагаете? Напишите число в сумах.`,
  offerPriceError: 'Напишите цену числом — от 1 000 сум.',
  offerSent: (title: string, qty: string, price: string) =>
    [
      '✅ <b>Предложение отправлено продавцу</b>',
      '',
      `<b>${title}</b>`,
      `${qty} × ${price}`,
      '',
      'Продавец увидит ваше имя из Telegram и номер со скрытыми цифрами. Как только он ответит, мы напишем вам сюда.',
    ].join('\n'),
  offerIncoming: (o: {
    title: string;
    name: string;
    phone: string;
    qty: string;
    price: string;
    listPrice: string;
  }) =>
    [
      '💬 <b>Вам предложили цену</b>',
      '',
      `<b>${o.title}</b>`,
      `👤 ${o.name}, ${o.phone}`,
      `Предлагает: ${o.qty} × <b>${o.price}</b>`,
      `Ваша цена: ${o.listPrice}`,
      '',
      'Если примете — оператор Bileto свяжется с вами и покупателем и проведёт сделку по этой цене.',
    ].join('\n'),
  offerAccept: '✅ Принять',
  offerDecline: '❌ Отклонить',
  offerAcceptedSeller: (n: number) =>
    `✅ Вы приняли цену. Создана заявка #${n} — оператор Bileto скоро позвонит.`,
  offerDeclinedSeller: '❌ Вы отклонили предложение.',
  offerAcceptedBuyer: (title: string, price: string, n: number) =>
    [
      '🎉 <b>Продавец принял вашу цену</b>',
      '',
      `<b>${title}</b> — ${price} за билет`,
      `Создана заявка #${n}. Оператор Bileto скоро позвонит вам и расскажет, как оплатить и получить билет.`,
    ].join('\n'),
  offerDeclinedBuyer: (title: string, price: string) =>
    `😔 Продавец не согласился на ${price} за билет «${title}». Можно предложить другую цену или купить по цене продавца.`,
  noRequests: (buy: string) => `Заявок пока нет. Найдите билет через «${buy}».`,
  myRequests: '🧾 <b>Мои заявки</b>',
  sellIntro:
    '💰 <b>Новое объявление</b>\n\nНа какое событие билет? Например: «Концерт Шахзоды, 15 ноября».',
  titleLength: 'Название — от 2 до 120 символов.',
  noContacts:
    '⛔ Нельзя указывать номер телефона, @username, ссылки и другие контакты — покупатель связывается с вами через оператора Bileto. Напишите ещё раз без контактов.',
  askCity: 'Город?',
  cityError: 'Напишите город.',
  askPrice: 'Цена за 1 билет в сумах? Например: 250000',
  priceError: 'Цена — число от 1 000 до 100 000 000 сум.',
  askNegotiable:
    'Цена окончательная или торг уместен? При торге покупатели смогут предложить свою цену — решать вам.',
  askQty: 'Сколько билетов продаёте?',
  qtyError: 'От 1 до 10 билетов.',
  askDelivery: 'Как покупатель получит билет?',
  useButtons: 'Выберите вариант кнопкой.',
  askDescription:
    'Описание: сектор, ряд, место, формат билета (электронный/бумажный).\n⛔ Без номера телефона и @username — связь только через оператора.',
  descriptionLength: 'Описание — до 1000 символов.',
  askPhoto:
    '📷 Пришлите фото билета или афиши (как фото, не файлом) — оно станет обложкой объявления. Фото нет — нажмите «Пропустить».',
  needPhoto: 'Пришлите фотографию или нажмите «Пропустить».',
  published: '✅ <b>Объявление опубликовано</b>',
  publishedHint: 'Когда найдётся покупатель, оператор Bileto позвонит вам.',
  shareLink: 'Ссылка, чтобы поделиться:',
  noListings: (sell: string) =>
    `Объявлений пока нет. Создайте через «${sell}».`,
  myListings: '📋 <b>Мои объявления</b>',
  soldMyself: '✅ Продал сам',
  archive: '🗑 Снять',
  listingNotFound: 'Объявление не найдено',
  markedSold: 'Отмечено как проданное',
  archived: 'Объявление снято',
  remove: '❌ Удалить',
  removeAsk: (title: string) =>
    `Удалить объявление «${title}»? Вернуть его будет нельзя.`,
  removeYes: '❌ Да, удалить',
  removeNo: '↩️ Отмена',
  removed: 'Объявление удалено',
  perTicket: 'за билет',
  inStock: (n: number) => `🎟 В наличии: ${n} шт.`,
  soldOut: '⛔ Продано',
  feeNote: (p: number) => `+ сервисный сбор ${p}%`,
  requestAccepted: (n: number) => `✅ <b>Заявка #${n} принята</b>`,
  tickets: 'Билеты',
  fee: (p: number) => `Сервисный сбор ${p}%`,
  total: 'Итого',
  operatorWillCall:
    'Оператор Bileto скоро позвонит вам и расскажет, как оплатить и получить билет.',
  requestStatus: {
    NEW: '🆕 Новая',
    IN_PROGRESS: '🟡 В работе',
    DONE: '✅ Куплено',
    CANCELLED: '❌ Отменена',
  } as Record<RequestStatus, string>,
  listingStatus: {
    ACTIVE: '🟢 В продаже',
    SOLD: '✅ Продано',
    REJECTED: '⛔ Снято модератором',
    ARCHIVED: '🗄 Снято',
  } as Record<ListingStatus, string>,
};

export type Texts = typeof ru;

const uz: Texts = {
  menu: {
    buy: '🎟 Чипта сотиб олиш',
    sell: '💰 Чипта сотиш',
    myListings: '📋 Эълонларим',
    myRequests: '🧾 Аризаларим',
    app: '🔑 Иловага кириш',
    download: '📲 Иловани юклаб олиш',
    support: '💬 Қўллаб-қувватлаш',
  },
  support:
    'Саволингиз ёки муаммоингиз борми? Bileto менежерига ёзинг — Telegram орқали жавоб берамиз.',
  writeSupport: '💬 Қўллаб-қувватлашга ёзиш',
  appSoon:
    '📲 <b>Bileto иловаси тез орада чиқади!</b>\n\nҲозирча чипталарни шу ерда, ботда сотиб олинг ва сотинг.',
  cancel: '❌ Бекор қилиш',
  skip: 'Ўтказиб юбориш',
  delivery: {
    DELIVERY: '🚚 Етказиб бериш',
    PICKUP: '🤝 Ўзи олиб кетади',
  },
  negotiable: {
    final: '🔒 Нарх қатъий',
    open: '💬 Келишамиз',
  },
  sum: 'сўм',
  pcs: 'та',
  welcome: [
    '👋 <b>Bileto</b> — концерт ва тадбирларга чипталарни қайта сотиш.',
    '',
    'Рўйхатдан ўтиш шарт эмас: чиптани танланг — оператор қўнғироқ қилиб, савдони ўтказади.',
    'Сотмоқчимисиз? Бир дақиқада эълон яратинг.',
    '',
    'Тадбирни топиш учун унинг номини ёзинг.',
  ].join('\n'),
  askContact:
    '«📱 Рақамни юбориш» тугмасини босинг — шу рақам орқали Bileto оператори сиз билан боғланади.',
  shareContact: '📱 Рақамни юбориш',
  cancelled: 'Бекор қилинди.',
  oops: 'Нимадир хато кетди, қайта уриниб кўринг.',
  openApp:
    'Иловада қулайроқ: билетлар, қидирув ва сотиш — тўғридан-тўғри Telegram ичида 👇',
  openAppButton: '🎟 Bileto’ни очиш',
  phoneLinked: '✅ Рақам тасдиқланди. Bileto иловасига қайтинг.',
  ownNumber: 'Ўз рақамингиз керак — пастдаги тугмани босинг.',
  onlyUz:
    'Ҳозирча фақат Ўзбекистон рақамлари (+998) билан ишлаймиз. Операторга ёзинг ёки бошқа аккаунтдан уриниб кўринг.',
  appLogin: (phone: string) =>
    [
      '🔑 <b>Bileto иловасига кириш</b>',
      '',
      `Рақамингиз: ${phone}`,
      'Парол ўйлаб топинг (камида 6 белги) ва уни хабар қилиб юборинг. Парол ёзилган хабарни бот дарҳол ўчиради.',
      '',
      'Иловада «Кириш»ни босинг ва шу рақам ҳамда паролни киритинг — у ерда эълонларингиз ва аризаларингиз бўлади.',
    ].join('\n'),
  passwordAsText: 'Паролни матн кўринишида юборинг.',
  passwordLength:
    'Парол 6 тадан 72 тагача белгидан иборат бўлсин. Қайта уриниб кўринг.',
  passwordSaved:
    '✅ Парол сақланди. Bileto иловасига рақамингиз ва шу парол билан киринг.',
  noTickets: 'Ҳозирча сотувда чипталар йўқ — кейинроқ қаранг.',
  chooseCity: 'Шаҳарни танланг — ёки қидириш учун тадбир номини ёзинг.',
  allCities: '🌍 Барча шаҳарлар',
  nothingFound: (q: string, buy: string) =>
    `«${q}» бўйича ҳеч нарса топилмади. Қисқароқ ёзиб кўринг ёки «${buy}»ни танланг.`,
  feedTitle: (city?: string) => `🎟 Чипталар${city ? ` — ${city}` : ''}`,
  feedMeta: (total: number, page: number, pages: number) =>
    `${total} та, ${page}/${pages}-саҳифа`,
  tapNumber: 'Эълонни очиш учун рақамни босинг.',
  listingGone: 'Эълон топилмади ёки сотувдан олинган.',
  buy: '🛒 Сотиб олиш',
  unavailable: 'Бу чипта энди мавжуд эмас.',
  howMany: 'Нечта чипта керак?',
  offer: '💬 Нарх таклиф қилиш',
  offerAsk: (price: string) =>
    `Сотувчи нархи — битта чипта ${price}. Битта чипта учун қанча таклиф қиласиз? Сўмда рақам билан ёзинг.`,
  offerPriceError: 'Нархни рақам билан ёзинг — 1 000 сўмдан.',
  offerSent: (title: string, qty: string, price: string) =>
    [
      '✅ <b>Таклиф сотувчига юборилди</b>',
      '',
      `<b>${title}</b>`,
      `${qty} × ${price}`,
      '',
      'Сотувчи Telegram’даги исмингизни ва рақамингизни қисман яширилган ҳолда кўради. У жавоб бериши билан шу ерга ёзамиз.',
    ].join('\n'),
  offerIncoming: (o: {
    title: string;
    name: string;
    phone: string;
    qty: string;
    price: string;
    listPrice: string;
  }) =>
    [
      '💬 <b>Сизга нарх таклиф қилишди</b>',
      '',
      `<b>${o.title}</b>`,
      `👤 ${o.name}, ${o.phone}`,
      `Таклиф: ${o.qty} × <b>${o.price}</b>`,
      `Сизнинг нархингиз: ${o.listPrice}`,
      '',
      'Қабул қилсангиз — Bileto оператори сиз ва харидор билан боғланиб, савдони шу нархда ўтказади.',
    ].join('\n'),
  offerAccept: '✅ Қабул қилиш',
  offerDecline: '❌ Рад этиш',
  offerAcceptedSeller: (n: number) =>
    `✅ Нархни қабул қилдингиз. #${n}-ариза яратилди — Bileto оператори тез орада қўнғироқ қилади.`,
  offerDeclinedSeller: '❌ Таклифни рад этдингиз.',
  offerAcceptedBuyer: (title: string, price: string, n: number) =>
    [
      '🎉 <b>Сотувчи нархингизни қабул қилди</b>',
      '',
      `<b>${title}</b> — битта чипта ${price}`,
      `#${n}-ариза яратилди. Bileto оператори тез орада қўнғироқ қилиб, қандай тўлаш ва чиптани олишни айтиб беради.`,
    ].join('\n'),
  offerDeclinedBuyer: (title: string, price: string) =>
    `😔 Сотувчи «${title}» чиптаси учун ${price} нархига рози бўлмади. Бошқа нарх таклиф қилишингиз ёки сотувчи нархида олишингиз мумкин.`,
  noRequests: (buy: string) =>
    `Ҳозирча аризалар йўқ. Чиптани «${buy}» орқали топинг.`,
  myRequests: '🧾 <b>Аризаларим</b>',
  sellIntro:
    '💰 <b>Янги эълон</b>\n\nЧипта қайси тадбирга? Масалан: «Шаҳзода концерти, 15 ноябрь».',
  titleLength: 'Номи 2 тадан 120 тагача белгидан иборат бўлсин.',
  noContacts:
    '⛔ Телефон рақами, @username, ҳавола ва бошқа алоқа маълумотларини ёзиш мумкин эмас — харидор сиз билан Bileto оператори орқали боғланади. Алоқа маълумотларисиз қайта ёзинг.',
  askCity: 'Шаҳар?',
  cityError: 'Шаҳарни ёзинг.',
  askPrice: 'Битта чипта нархи сўмда? Масалан: 250000',
  priceError: 'Нарх 1 000 дан 100 000 000 сўмгача бўлсин.',
  askNegotiable:
    'Нарх қатъийми ёки келишиш мумкинми? Келишиш мумкин бўлса, харидорлар ўз нархини таклиф қила олади — қарор сизда.',
  askQty: 'Нечта чипта сотяпсиз?',
  qtyError: '1 тадан 10 тагача чипта.',
  askDelivery: 'Харидор чиптани қандай олади?',
  useButtons: 'Вариантни тугма орқали танланг.',
  askDescription:
    'Тавсиф: сектор, қатор, жой, чипта тури (электрон/қоғоз).\n⛔ Телефон рақами ва @username ёзманг — алоқа фақат оператор орқали.',
  descriptionLength: 'Тавсиф 1000 белгигача бўлсин.',
  askPhoto:
    '📷 Чипта ёки афиша суратини юборинг (файл эмас, сурат қилиб) — у эълон муқоваси бўлади. Сурат бўлмаса — «Ўтказиб юбориш»ни босинг.',
  needPhoto: 'Сурат юборинг ёки «Ўтказиб юбориш»ни босинг.',
  published: '✅ <b>Эълон жойлаштирилди</b>',
  publishedHint: 'Харидор топилганда Bileto оператори сизга қўнғироқ қилади.',
  shareLink: 'Улашиш учун ҳавола:',
  noListings: (sell: string) =>
    `Ҳозирча эълонлар йўқ. «${sell}» орқали яратинг.`,
  myListings: '📋 <b>Эълонларим</b>',
  soldMyself: '✅ Ўзим сотдим',
  archive: '🗑 Олиб ташлаш',
  listingNotFound: 'Эълон топилмади',
  markedSold: 'Сотилган деб белгиланди',
  archived: 'Эълон олиб ташланди',
  remove: '❌ Ўчириш',
  removeAsk: (title: string) =>
    `«${title}» эълони ўчирилсинми? Уни қайтариб бўлмайди.`,
  removeYes: '❌ Ҳа, ўчириш',
  removeNo: '↩️ Бекор қилиш',
  removed: 'Эълон ўчирилди',
  perTicket: 'битта чипта',
  inStock: (n: number) => `🎟 Мавжуд: ${n} та`,
  soldOut: '⛔ Сотилган',
  feeNote: (p: number) => `+ ${p}% хизмат ҳақи`,
  requestAccepted: (n: number) => `✅ <b>#${n}-ариза қабул қилинди</b>`,
  tickets: 'Чипталар',
  fee: (p: number) => `Хизмат ҳақи ${p}%`,
  total: 'Жами',
  operatorWillCall:
    'Bileto оператори тез орада қўнғироқ қилиб, қандай тўлаш ва чиптани олишни айтиб беради.',
  requestStatus: {
    NEW: '🆕 Янги',
    IN_PROGRESS: '🟡 Жараёнда',
    DONE: '✅ Сотиб олинди',
    CANCELLED: '❌ Бекор қилинган',
  },
  listingStatus: {
    ACTIVE: '🟢 Сотувда',
    SOLD: '✅ Сотилган',
    REJECTED: '⛔ Модератор олиб ташлаган',
    ARCHIVED: '🗄 Олиб ташланган',
  },
};

export const TEXTS: Record<BotLang, Texts> = { ru, uz };

// Ошибки сервисов приходят по-русски — для узбекского переводим известные.
const UZ_ERRORS: [RegExp, string][] = [
  [/^В наличии только (\d+) шт\.$/, 'Мавжуд: фақат $1 та.'],
  [
    /^Заявка на этот билет уже отправлена.*$/,
    'Бу чиптага ариза аллақачон юборилган — оператор тез орада сиз билан боғланади.',
  ],
  [/^Слишком много заявок.*$/, 'Аризалар жуда кўп, кейинроқ уриниб кўринг.'],
  [/^Объявление (недоступно|не найдено).*$/, 'Эълон топилмади.'],
  [/^Нельзя купить свой билет.*$/, 'Ўз чиптангизни сотиб ола олмайсиз.'],
  [/^Объявление уже снято.*$/, 'Эълон аллақачон сотувдан олинган.'],
  [
    /^Продавец указал, что цена окончательная.*$/,
    'Сотувчи нархни қатъий деб белгилаган — келишиш кўзда тутилмаган.',
  ],
  [
    /^Предложите цену ниже цены продавца.*$/,
    'Сотувчи нархидан пастроқ нарх таклиф қилинг — ёки оддий ариза қолдиринг.',
  ],
  [
    /^Вы уже предложили цену за этот билет.*$/,
    'Бу чипта учун нарх таклиф қилгансиз — сотувчининг жавобини кутинг.',
  ],
  [
    /^Слишком много предложений.*$/,
    'Таклифлар жуда кўп, кейинроқ уриниб кўринг.',
  ],
  [/^Предложение не найдено$/, 'Таклиф топилмади.'],
  [
    /^На это предложение уже ответили$/,
    'Бу таклифга аллақачон жавоб берилган.',
  ],
  [
    /^У вас есть активные заявки на этот билет$/,
    'Бу чипта бўйича фаол аризаларингиз бор',
  ],
];

export function translateError(lang: BotLang, message: string) {
  if (lang === 'ru') return message;
  const hit = UZ_ERRORS.find(([re]) => re.test(message));
  return hit ? message.replace(hit[0], hit[1]) : message;
}

export const money = (t: Texts, n: number) =>
  formatSum(n).replace(/сум$/, t.sum);

// Админам (ADMIN_TELEGRAM_IDS) — ещё кнопка статистики.
export const menuKeyboard = (t: Texts, admin = false) => ({
  keyboard: [
    [{ text: t.menu.buy }, { text: t.menu.sell }],
    [{ text: t.menu.myListings }, { text: t.menu.myRequests }],
    [{ text: t.menu.download }, { text: t.menu.support }],
    [{ text: t.menu.app }, { text: LANG_BUTTON }],
    ...(admin ? [[{ text: STATS_BUTTON }, { text: TICKETS_BUTTON }]] : []),
  ],
  resize_keyboard: true,
  is_persistent: true,
});

// Клавиатура шага: варианты ответа и «Отмена» последней строкой.
export const stepKeyboard = (t: Texts, options: string[][] = []) => ({
  keyboard: [...options, [t.cancel]].map((row) =>
    row.map((text) => ({ text })),
  ),
  resize_keyboard: true,
});

export const contactKeyboard = (t: Texts) => ({
  keyboard: [
    [{ text: t.shareContact, request_contact: true }],
    [{ text: t.cancel }],
  ],
  resize_keyboard: true,
  one_time_keyboard: true,
});

export const LANG_PROMPT = 'Тилни танланг / Выберите язык';
export const langKeyboard = {
  inline_keyboard: [
    [
      { text: '🇷🇺 Русский', callback_data: 'lg:ru' },
      { text: '🇺🇿 Ўзбекча', callback_data: 'lg:uz' },
    ],
  ],
};

// Кнопки меню, «Отмена», «Пропустить» и доставка узнаются на любом языке:
// после смены языка у человека может остаться старая клавиатура.
export const menuAction = (text: string) =>
  LANGS.flatMap(
    (l) => Object.entries(TEXTS[l].menu) as [keyof Texts['menu'], string][],
  ).find(([, v]) => v === text)?.[0];
export const isCancel = (text: string) =>
  LANGS.some((l) => TEXTS[l].cancel === text);
export const isSkip = (text: string) =>
  LANGS.some((l) => TEXTS[l].skip === text);
// true — торг уместен, false — цена окончательная, undefined — не кнопка.
export const negotiableFrom = (text: string) =>
  LANGS.some((l) => TEXTS[l].negotiable.open === text)
    ? true
    : LANGS.some((l) => TEXTS[l].negotiable.final === text)
      ? false
      : undefined;
export const deliveryFrom = (text: string) =>
  LANGS.flatMap(
    (l) => Object.entries(TEXTS[l].delivery) as [Delivery, string][],
  ).find(([, v]) => v === text)?.[0];

type CardListing = {
  title: string;
  city: string;
  description: string | null;
  price: number;
  negotiable: boolean;
  qtyAvailable: number;
  delivery: Delivery;
  status: string;
};

export function listingCard(t: Texts, l: CardListing) {
  return [
    `<b>${h(l.title)}</b>`,
    `📍 ${h(l.city)} · ${t.delivery[l.delivery]}`,
    ...(l.description ? ['', `💬 ${h(l.description.slice(0, 600))}`] : []),
    '',
    `💵 ${money(t, l.price)} — ${t.perTicket}`,
    l.negotiable ? t.negotiable.open : t.negotiable.final,
    l.status === 'ACTIVE' && l.qtyAvailable > 0
      ? t.inStock(l.qtyAvailable)
      : t.soldOut,
    `<i>${t.feeNote(serviceFeePercent())}</i>`,
  ].join('\n');
}

export function feedLine(
  t: Texts,
  n: number,
  l: { title: string; city: string; price: number; qtyAvailable: number },
) {
  return `${n}. <b>${h(l.title)}</b>\n    📍 ${h(l.city)} · ${money(t, l.price)} · ${l.qtyAvailable} ${t.pcs}`;
}

export function requestDone(
  t: Texts,
  number: number,
  title: string,
  qty: number,
  price: number,
) {
  const p = priceBreakdown(price, qty);
  return [
    t.requestAccepted(number),
    '',
    `<b>${h(title)}</b>`,
    `${t.tickets}: ${qty} × ${money(t, price)} = ${money(t, p.subtotal)}`,
    `${t.fee(serviceFeePercent())}: ${money(t, p.fee)}`,
    `<b>${t.total}: ${money(t, p.total)}</b>`,
    '',
    t.operatorWillCall,
  ].join('\n');
}
