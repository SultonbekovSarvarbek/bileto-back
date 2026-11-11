import { NestFactory } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { PHOTOS_DIR, PHOTOS_PREFIX } from './common/utils/upload';

function swaggerBasicAuth(user: string, pass: string) {
  const same = (a: string, b: string) =>
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  return (req: Request, res: Response, next: NextFunction) => {
    const b64 = (req.headers['authorization'] ?? '').replace(/^Basic\s+/i, '');
    const [u = '', p = ''] = Buffer.from(b64, 'base64').toString().split(':');
    if (same(u, user) && same(p, pass)) return next();
    res.set('WWW-Authenticate', 'Basic realm="Swagger"');
    res.status(401).send('Unauthorized');
  };
}

// Общая настройка — используется и в main, и в e2e-тестах.
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const origins = process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim());
  app.enableCors({ origin: origins?.length ? origins : false });
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  // Афиши событий и фото продавцов — публичные, в отличие от старых фото билетов в uploads/proofs.
  app.useStaticAssets(join(process.cwd(), 'uploads', 'covers'), {
    prefix: '/covers/',
    maxAge: '7d',
  });
  app.useStaticAssets(PHOTOS_DIR, { prefix: PHOTOS_PREFIX, maxAge: '7d' });
  // Мини-приложение Telegram: статика без сборки, открывается из бота (MINI_APP_URL).
  // Cloudflare велит браузеру держать .js/.css 4 часа, поэтому страница ссылается на них
  // с версией запуска сервера: после деплоя все сразу получают свежие файлы.
  const miniapp = join(process.cwd(), 'miniapp');
  const version = Date.now().toString(36);
  app.use('/app', (req: Request, res: Response, next: NextFunction) => {
    if (req.path !== '/') return next();
    if (!req.originalUrl.startsWith('/app/')) return res.redirect('/app/');
    const html = readFileSync(join(miniapp, 'index.html'), 'utf8');
    res
      .type('html')
      .set('Cache-Control', 'no-cache')
      .send(
        html.replace(/"(app\.css|i18n\.js|app\.js)"/g, `"$1?v=${version}"`),
      );
  });
  app.useStaticAssets(miniapp, { prefix: '/app/' });

  const swaggerUser = process.env.SWAGGER_USER;
  const swaggerPassword = process.env.SWAGGER_PASSWORD;
  if (swaggerUser && swaggerPassword) {
    app.use(
      ['/docs', '/docs-json'],
      swaggerBasicAuth(swaggerUser, swaggerPassword),
    );
  }
  const config = new DocumentBuilder()
    .setTitle('Bileto API')
    .setDescription(
      'Перепродажа билетов: заявки на покупку обрабатывают операторы, оплата — вне приложения',
    )
    .setVersion('0.1')
    .addServer('https://api.bileto.uz', 'Production')
    .addServer(`http://localhost:${process.env.PORT ?? 3000}`, 'Local')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Bileto API on http://localhost:${port}/api, docs at /docs`);
}

if (require.main === module) void bootstrap();
