import { Module } from '@nestjs/common';

import { SaltEngineModule } from '../salt-engine';
import { SearchController } from './api/search.controller';

/**
 * Search bounded context: HTTP only. Matching lives in `salt-engine`,
 * consumed through its barrel.
 */
@Module({
  imports: [SaltEngineModule],
  controllers: [SearchController],
})
export class SearchModule {}
