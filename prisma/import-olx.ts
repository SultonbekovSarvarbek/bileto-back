// Импорт объявлений о билетах с OLX от служебного продавца Bileto.
// Заявку на такое объявление оператор ведёт через исходное объявление на OLX (Listing.sourceUrl).
// Запуск: npx ts-node prisma/import-olx.ts <olx.json>
// Повторный запуск обновляет уже импортированные объявления по ссылке, статус не трогает.
// Пишет напрямую в базу, поэтому в Telegram уведомления о новых объявлениях не уходят.
import { PrismaClient } from '@prisma/client';
import { stripContacts } from '../src/common/utils/contacts';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

type OlxItem = {
  id: number;
  url: string;
  title: string;
  description: string;
  price: { value: number; currency: 'UZS' | 'UYE' };
  location: string;
  created: string;
  photos: string[];
};

const prisma = new PrismaClient();
const PROOFS_DIR = join(process.cwd(), 'uploads', 'proofs');
const SELLER_PHONE = process.env.OLX_SELLER_PHONE ?? '+998000000000';
const SELLER_NAME = 'Bileto';

// Курс у.е. → сум: OLX_USD_RATE, иначе ЦБ на сегодня, иначе open.er-api.com (cbu.uz доступен не отовсюду).
async function usdRate() {
  if (process.env.OLX_USD_RATE) return Number(process.env.OLX_USD_RATE);
  try {
    const res = await fetch(
      'https://cbu.uz/ru/arkhiv-kursov-valyut/json/USD/',
      {
        signal: AbortSignal.timeout(10_000),
      },
    );
    const [usd] = (await res.json()) as { Rate: string }[];
    return Number(usd.Rate);
  } catch {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const { rates } = (await res.json()) as { rates: { UZS: number } };
    return rates.UZS;
  }
}

// Сектор из текста объявления, если продавец его указал.
function sector(text: string) {
  const t = text.replace(/\s+/g, ' ');
  const m =
    t.match(
      /(?:сектор|sector|sektor|блитчер|blitcher|biletcher)\s*([A-ZА-Я]?\d{1,3}|[A-ZА-Я]\d?)\b/i,
    ) ??
    t.match(/\b(\d{1,2})\s*-?\s*(?:сектор|sector|sektor)/i) ??
    t.match(/\b([ABCDEАВСЕ]\d{3})\b/);
  if (m) return `Сектор ${m[1].toUpperCase()}`;
  if (/golden\s*ring|голден/i.test(t)) return 'Golden Ring';
  if (/mstar\s*pit/i.test(t)) return 'Mstar Pit';
  if (/fan\s*-?\s*zon|фан\s*-?\s*зон/i.test(t)) return 'Фан-зона';
  if (/vip/i.test(t)) return 'VIP';
  if (/партер/i.test(t)) return 'Партер';
  if (/балкон|balkon/i.test(t)) return 'Балкон';
  return '—';
}

// Событие из каталога приложения (src/data.ts в bileto): по нему приложение показывает обложку, дату и площадку.
// Меладзе в каталоге только 30 октября — объявления на 1 ноября не привязываем, чтобы не показать неверную дату.
const RICHTER = /max\s*richter|макс\s*рихтер/i;
const SHOXRUX = /sho[xh]ru[xh]|шохру[хx]|(^|[^\p{L}])(shox|шох)([^\p{L}]|$)/iu;
const AL_NASSR = /al.?nass?r|аль?.?насс?р/i;
const MOLLY = /пошл\S* молли/i;

const EVENTS: [string, RegExp, RegExp?][] = [
  ['e1', RICHTER],
  ['e5', /меладзе|meladze/i, /1\s*ноябр|01\.11/i],
  ['e7', /агутин/i],
  ['e8', SHOXRUX],
  ['e9', AL_NASSR],
  ['e16', MOLLY],
  ['e17', /lvbel/i],
  ['e23', /yangi yil shou/i],
];
const eventId = (text: string) =>
  EVENTS.find(([, re, not]) => re.test(text) && !not?.test(text))?.[0] ?? null;

// Афиша события с iticket.uz: [slug, поисковый запрос, признак в тексте объявления].
// Не нашли событие — обложки нет, приложение покажет обложку каталога или заглушку.
const ITICKET: [string, string, RegExp][] = [
  ['shoxrux2026', 'shoxrux', SHOXRUX],
  ['ppaalsr26', 'Pakhtakor', AL_NASSR],
  ['valerij-meladze2026', 'meladze', /меладзе|meladze/i],
  ['leonid-agutin-2026', 'agutin', /агутин/i],
  ['max-richter', 'richter', RICHTER],
  ['avaz-oxun2026', 'avaz', /ava[zs]\s*o[xh]u[nm]|аваз\s*о[хx]у[нм]/i],
  ['gaybulla-tursunov2026', 'gaybulla', /g.?aybulla|ғайбулла|гайбулла/i],
  ['poshlayamolly', 'Пошлая', MOLLY],
  ['benom-guruhi-the-best-yangi', 'benom', /benom|беном/i],
  ['bunyodbek-saidov26', 'bunyodbek', /bunyodbek|бунё?дбек|бунйодбек/i],
  ['lvbel-c5-2026', 'lvbel', /lvbel/i],
  ['yalla-ansambli-soginib-kutgandim', 'yalla', /yalla|ялла/i],
  ['yangi-yil-shou', 'yangi yil', /yangi yil shou/i],
  ['xurshid-rasulov2027', 'xurshid', /xurshid\s*rasulov|хуршид\s*расулов/i],
  ['otabek-madrahimov', 'otabek', /otabek\s*madrahimov|отабека?\s*мадрахимов/i],
];

const COVERS_DIR = join(process.cwd(), 'uploads', 'covers');
const PUBLIC_URL = process.env.PUBLIC_URL ?? 'https://api.bileto.uz';

type IticketEvent = {
  slug: string;
  poster_url: string | null;
  poster_bg_url: string | null;
};

const download = async (url: string) =>
  Buffer.from(await (await fetch(url)).arrayBuffer());

// iTicket рисует афишу двумя слоями: фон и прозрачная PNG поверх (у матча — логотипы команд).
// Склеиваем их в одну картинку и раздаём сами: https://api.bileto.uz/covers/<slug>.jpg
async function iticketPosters() {
  await mkdir(COVERS_DIR, { recursive: true });
  const posters = new Map<string, string>();
  for (const [slug, q] of ITICKET) {
    const url = `https://api.iticket.uz/ru/v5/events/search?client=web&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = (await res.json()) as {
      response: { events: IticketEvent[] };
    };
    const event = data.response.events.find((e) => e.slug === slug);
    if (!event?.poster_bg_url) {
      console.warn(`iTicket: нет афиши для ${slug}`);
      continue;
    }
    const bg = sharp(await download(event.poster_bg_url));
    if (event.poster_url)
      bg.composite([{ input: await download(event.poster_url) }]);
    await bg.jpeg({ quality: 85 }).toFile(join(COVERS_DIR, `${slug}.jpg`));
    posters.set(slug, `${PUBLIC_URL}/covers/${slug}.jpg`);
  }
  return posters;
}

// Количество билетов, если указано: "2 ta", "3 шт", "4 билета". Иначе 1.
function qty(text: string) {
  const m = text.match(
    /\b(\d{1,2})\s*-?\s*(?:ta|та|шт|dona|дона|билета|билетов|bilet)\b/i,
  );
  const n = m ? Number(m[1]) : 1;
  return n >= 1 && n <= 10 ? n : 1;
}

// У объявления без фото — путь-заглушка, как у демо-данных: админский эндпоинт вернёт 404.
const NO_PROOF = 'olx/no-photo.jpg';

async function saveProof(item: OlxItem) {
  if (!item.photos.length) return NO_PROOF;
  const file = join(PROOFS_DIR, `olx-${item.id}.jpg`);
  const res = await fetch(item.photos[0]);
  if (!res.ok) throw new Error(`фото ${item.id}: HTTP ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('Укажите путь к JSON с объявлениями OLX');
  const raw = JSON.parse(await readFile(path, 'utf8')) as
    OlxItem[] | { items: OlxItem[] };
  const items = Array.isArray(raw) ? raw : raw.items;

  const rate = await usdRate();
  const posters = await iticketPosters();
  const coverUrl = (text: string) => {
    const slug = ITICKET.find(([, , re]) => re.test(text))?.[0];
    return (slug && posters.get(slug)) || null;
  };
  await mkdir(PROOFS_DIR, { recursive: true });
  const seller = await prisma.user.upsert({
    where: { phone: SELLER_PHONE },
    update: {},
    create: {
      phone: SELLER_PHONE,
      name: SELLER_NAME,
      role: 'SELLER',
      verified: true,
    },
  });

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const text = `${item.title} ${item.description}`;
    const price =
      item.price.currency === 'UYE'
        ? Math.round((item.price.value * rate) / 1000) * 1000
        : item.price.value;
    const n = qty(text);
    const data = {
      title: item.title.trim().slice(0, 120),
      city: item.location.split(',')[0].trim(),
      sector: sector(text),
      price,
      eventId: eventId(text),
      coverUrl: coverUrl(text),
      description: stripContacts(item.description).slice(0, 1000) || null,
    };

    const existing = await prisma.listing.findUnique({
      where: { sourceUrl: item.url },
    });
    if (existing) {
      await prisma.listing.update({ where: { id: existing.id }, data });
      updated++;
      continue;
    }
    await prisma.listing.create({
      data: {
        ...data,
        sellerId: seller.id,
        sourceUrl: item.url,
        qty: n,
        qtyAvailable: n,
        delivery: 'PICKUP',
        proofPath: await saveProof(item),
        createdAt: new Date(item.created),
      },
    });
    created++;
  }
  console.log(
    `OLX: ${created} новых, ${updated} обновлено (курс у.е. ${rate} сум)`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
