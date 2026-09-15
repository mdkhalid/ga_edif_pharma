import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit';
import { CartController } from './api/cart.controller';
import { CartService } from './application/cart.service';

/**
 * Cart bounded context. Reached through `./index`, never by deep import.
 */
@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
