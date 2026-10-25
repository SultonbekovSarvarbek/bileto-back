import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { basename, extname, join } from 'path';
import { mkdirSync } from 'fs';

// Старые фото билетов (до обложек) лежат вне публичной раздачи: их отдаёт только админский эндпоинт.
export const PROOFS_DIR = join(process.cwd(), 'uploads', 'proofs');
// Фото продавца — обложка объявления: билет или любая картинка на его выбор. Раздаётся публично.
export const PHOTOS_DIR = join(process.cwd(), 'uploads', 'photos');
export const PHOTOS_PREFIX = '/photos/';

// В coverUrl храним путь без хоста: приложение подставляет адрес API само.
export const photoUrl = (path: string) => PHOTOS_PREFIX + basename(path);

const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

export const proofUploadOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      mkdirSync(PHOTOS_DIR, { recursive: true });
      cb(null, PHOTOS_DIR);
    },
    filename: (_req, file, cb) =>
      cb(null, randomUUID() + extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    cb: (e: Error | null, ok: boolean) => void,
  ) =>
    ALLOWED.has(file.mimetype)
      ? cb(null, true)
      : cb(
          new BadRequestException('Фото должно быть JPEG, PNG, WEBP или HEIC'),
          false,
        ),
};
