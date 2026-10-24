import { NestFactory } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

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
  const app = await NestFactory.create(AppModule);
  configureApp(app);

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
      'Безопасная перепродажа билетов: деньги замораживаются до передачи билета',
    )
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Bileto API on http://localhost:${port}/api, docs at /docs`);
}

if (require.main === module) void bootstrap();
