import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit';
import { CatalogController } from './api/catalog.controller';
import { CatalogService } from './application/catalog.service';

/**
 * Catalogue bounded context. Reached through `./index`, never by deep import.
 */
@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
