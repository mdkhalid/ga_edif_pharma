import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Capability, type CreditPage, type CreditSummary } from '@medichain/shared-types';

import { CurrentTenant, RequireCapability } from '../../../common/decorators';
import { uuidParam } from '../../../common/pipes/parse-uuid.pipe';
import { CreditQueryService } from '../application/credit-query.service';
import { ListCreditQuery } from './dto/credit.dto';

@ApiTags('credit')
@ApiBearerAuth()
@Controller('credit/summary')
export class CreditController {
  constructor(private readonly credit: CreditQueryService) {}

  @Get()
  @RequireCapability(Capability.CREDIT_READ)
  @ApiOperation({ summary: 'List organisations with limit, exposure and available credit' })
  async list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListCreditQuery,
  ): Promise<CreditPage> {
    return this.credit.list(tenantId, query);
  }

  @Get(':organisationId')
  @RequireCapability(Capability.CREDIT_READ)
  @ApiOperation({ summary: 'Get the credit summary for one organisation' })
  async getById(
    @CurrentTenant() tenantId: string,
    @Param('organisationId', uuidParam('organisationId')) organisationId: string,
  ): Promise<{ data: CreditSummary }> {
    return { data: await this.credit.getById(tenantId, organisationId) };
  }
}
