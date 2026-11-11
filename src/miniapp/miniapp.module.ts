import { Module } from '@nestjs/common';
import { MiniappController } from './miniapp.controller';

@Module({ controllers: [MiniappController] })
export class MiniappModule {}
