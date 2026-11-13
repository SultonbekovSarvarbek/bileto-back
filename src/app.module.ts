import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { TelegramModule } from './telegram/telegram.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ListingsModule } from './listings/listings.module';
import { RequestsModule } from './requests/requests.module';
import { OffersModule } from './offers/offers.module';
import { FavoritesModule } from './favorites/favorites.module';
import { AdminModule } from './admin/admin.module';
import { BotModule } from './bot/bot.module';
import { MiniappModule } from './miniapp/miniapp.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    TelegramModule,
    AuthModule,
    UsersModule,
    ListingsModule,
    RequestsModule,
    OffersModule,
    FavoritesModule,
    AdminModule,
    BotModule,
    MiniappModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
