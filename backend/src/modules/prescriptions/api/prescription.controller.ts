import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Capability, type AuthenticatedPrincipal } from '@medichain/shared-types';

import {
  CurrentTenant,
  CurrentUser,
  RequireCapability,
} from '../../../common/decorators';
import { uuidParam } from '../../../common/pipes/parse-uuid.pipe';
import { NotFoundError } from '../../../common/exceptions/domain.exception';
import { PrescriptionService } from '../application/prescription.service';
import {
  CreatePrescriptionDto,
  ListPrescriptionsQuery,
  VerifyPrescriptionDto,
} from './dto/prescription.dto';

@ApiTags('prescriptions')
@ApiBearerAuth()
@Controller('prescriptions')
export class PrescriptionController {
  constructor(private readonly prescriptions: PrescriptionService) {}

  @Post()
  @RequireCapability(Capability.PRESCRIPTION_READ)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create (upload metadata for) a prescription' })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: CreatePrescriptionDto,
  ): Promise<{ data: { id: string } }> {
    const result = await this.prescriptions.create(tenantId, principal.userId, dto);
    return { data: result };
  }

  @Get()
  @RequireCapability(Capability.PRESCRIPTION_READ)
  @ApiOperation({ summary: 'List prescriptions (own organisation, or all for staff)' })
  async list(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ListPrescriptionsQuery,
  ): Promise<unknown> {
    return this.prescriptions.list(
      tenantId,
      principal.organisationId,
      this.isStaff(principal),
      query,
    );
  }

  @Get(':id')
  @RequireCapability(Capability.PRESCRIPTION_READ)
  @ApiOperation({ summary: 'Get a prescription by id' })
  async getById(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
  ): Promise<{ data: unknown }> {
    const row = await this.prescriptions.getById(
      tenantId,
      id,
      principal.organisationId,
      this.isStaff(principal),
    );
    if (!row) throw new NotFoundError('Prescription not found.');
    return { data: row };
  }

  @Post(':id/verify')
  @RequireCapability(Capability.PRESCRIPTION_VERIFY)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify (approve/reject) a prescription' })
  async verify(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: VerifyPrescriptionDto,
  ): Promise<{ data: { id: string } }> {
    await this.prescriptions.verify(tenantId, id, principal.userId, dto);
    return { data: { id } };
  }

  private isStaff(principal: AuthenticatedPrincipal): boolean {
    return principal.capabilities.includes(Capability.PRESCRIPTION_VERIFY);
  }
}
