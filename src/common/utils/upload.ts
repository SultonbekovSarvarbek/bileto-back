import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';

// Фото билетов лежат вне публичной раздачи: их отдаёт только админский эндпоинт.
export const PROOFS_DIR = join(process.cwd(), 'uploads', 'proofs');

const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

export const proofUploadOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      mkdirSync(PROOFS_DIR, { recursive: true });
      cb(null, PROOFS_DIR);
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
