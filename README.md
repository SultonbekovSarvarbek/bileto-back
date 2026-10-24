# bileto-back

API для мобильного приложения Bileto — безопасная перепродажа билетов между людьми.
Bileto выступает посредником: деньги покупателя замораживаются и уходят продавцу только после передачи билета.

**Стек:** NestJS 11, Prisma 5, PostgreSQL, JWT, Swagger.

## Запуск

```bash
npm install
cp .env.example .env            # заполнить DATABASE_URL и JWT_SECRET
npx prisma migrate dev          # создать таблицы
npm run seed                    # сделать ADMIN_PHONE администратором
npm run start:dev               # http://localhost:3000/api, Swagger — /docs
```

Тесты идут на отдельной БД. Создайте `.env.test` — копию `.env` с другой базой (например, `bileto_test`):

```bash
npm run test:e2e
```

## Как устроена сделка

```
POST /orders              → PENDING_PAYMENT  билеты зарезервированы на PAYMENT_TIMEOUT_MIN (15 мин)
оплата                    → PAID             деньги заморожены; продавец должен передать билет за HANDOVER_DEADLINE_HOURS (2 ч)
POST /orders/:id/handover → HANDED_OVER      у покупателя CONFIRM_WINDOW_HOURS (24 ч), чтобы подтвердить или открыть спор
POST /orders/:id/confirm  → COMPLETED        payoutStatus = PENDING → админ перечисляет деньги продавцу
POST /orders/:id/dispute  → DISPUTED         решает админ: REFUND (возврат) или RELEASE (в пользу продавца)
```

Планировщик раз в минуту следит за сроками:
- не оплатили вовремя → заказ отменяется, билеты возвращаются в объявление;
- продавец не передал билет вовремя → полный возврат покупателю (включая сервисный сбор);
- покупатель не подтвердил и не открыл спор → сделка завершается.

Сервисный сбор (`SERVICE_FEE_PERCENT`, 7%) платит покупатель, продавец получает свою цену полностью.
Телефоны сторон видны друг другу только после оплаты.

## API (префикс `/api`)

| Метод | Путь | Кто | Что |
|---|---|---|---|
| POST | `/auth/otp/send` | все | отправить SMS-код |
| POST | `/auth/otp/verify` | все | войти по коду → `token` |
| GET / PATCH | `/me` | пользователь | профиль (имя, язык `ru`/`en`/`uz`) |
| GET | `/listings?city=&q=&page=` | все | лента активных объявлений, поиск по названию и сектору |
| GET | `/listings/:id` | все | объявление |
| POST | `/listings` | пользователь | создать (multipart: поля + файл `proof`) |
| PATCH / DELETE | `/listings/:id` | продавец | изменить / снять с продажи |
| GET | `/me/listings` | продавец | мои объявления |
| POST | `/orders` | покупатель | купить (резерв) |
| POST | `/orders/:id/pay` | покупатель | оплата, только при `PAYMENT_PROVIDER=mock` |
| POST | `/orders/:id/cancel` | покупатель | отменить неоплаченный заказ |
| POST | `/orders/:id/handover` | продавец | билет передан |
| POST | `/orders/:id/confirm` | покупатель | билет получен |
| POST | `/orders/:id/dispute` | покупатель | открыть спор |
| GET | `/me/purchases`, `/me/sales` | пользователь | мои покупки / продажи |
| GET / PUT / DELETE | `/me/favorites`, `/favorites/:listingId` | пользователь | избранное |
| GET | `/admin/listings`, `/admin/listings/:id/proof` | админ | модерация, фото билета |
| POST | `/admin/listings/:id/reject`, `/restore` | админ | снять / вернуть объявление |
| GET | `/admin/orders?status=&payoutStatus=` | админ | заказы |
| POST | `/admin/orders/:id/resolve` | админ | решение по спору |
| POST | `/admin/orders/:id/payout` | админ | выплата продавцу перечислена |

Подробности и схемы — в Swagger: `/docs`.

## Что пока заглушки

- **SMS** (`SMS_PROVIDER=console`): код пишется в лог, а в разработке ещё и возвращается в ответе (`OTP_DEV_ECHO=true`). Для продакшена нужен реальный провайдер в `src/sms/sms.service.ts`.
- **Оплата** (`PAYMENT_PROVIDER=mock`): `POST /orders/:id/pay` сразу помечает заказ оплаченным. Для Payme/Click нужно реализовать провайдера в `src/payments/` и вызывать `OrdersService.markPaid()` из их webhook-ов.
- **Выплаты продавцам** админ отмечает вручную (`/admin/orders/:id/payout`).
- **Фото билетов** хранятся на диске в `uploads/proofs` и отдаются только админу.

В production (`NODE_ENV=production`) dev-режимы SMS и оплаты отключаются автоматически.
