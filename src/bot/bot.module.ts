import { Module } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module';
import { RequestsModule } from '../requests/requests.module';
import { OffersModule } from '../offers/offers.module';
import { BotService } from './bot.service';

@Module({
  imports: [ListingsModule, RequestsModule, OffersModule],
  providers: [BotService],
})
export class BotModule {}
