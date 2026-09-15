import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Capability, type AuthenticatedPrincipal } from '@medichain/shared-types';

import {
  CurrentTenant,
  CurrentUser,
  Idempotent,
  RequireCapability,
} from '../../../common/decorators';
import { uuidParam } from '../../../common/pipes/parse-uuid.pipe';
import { OnboardingService } from '../application/onboarding.service';
import { ReviewApplicationDto, SubmitApplicationDto } from './dto/onboarding.dto';

/**
 * Onboarding endpoints.
 *
 * Submit is authenticated (tenant comes from the principal); review and
 * approve are capability-gated for back-office staff.
 */
@ApiTags('onboarding')
@ApiBearerAuth()
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('applications')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a distributor onboarding application' })
  @ApiResponse({ status: 201, description: 'Application received as PENDING.' })
  async submit(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: SubmitApplicationDto,
  ): Promise<{ data: { id: string } }> {
    const result = await this.onboarding.submit(tenantId, dto, principal.userId);
    return { data: result };
  }

  @Get('applications')
  @RequireCapability(Capability.ONBOARDING_READ)
  @ApiOperation({ summary: 'List pending onboarding applications' })
  @ApiResponse({ status: 200, description: 'Reviewer queue.' })
  async listPending(@CurrentTenant() tenantId: string): Promise<{
    data: Array<{ id: string; legalName: string; type: string; createdAt: Date }>;
  }> {
    const rows = await this.onboarding.listPending(tenantId);
    return { data: rows };
  }

  @Post('applications/:id/approve')
  @RequireCapability(Capability.ONBOARDING_APPROVE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve an application' })
  @ApiResponse({ status: 200, description: 'Organisation is now ACTIVE.' })
  async approve(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: ReviewApplicationDto,
  ): Promise<{ data: { id: string } }> {
    await this.onboarding.approve(tenantId, id, principal.userId, dto.reason);
    return { data: { id } };
  }

  @Post('applications/:id/reject')
  @RequireCapability(Capability.ONBOARDING_REVIEW)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject an application' })
  @ApiResponse({ status: 200, description: 'Organisation is now BLOCKED.' })
  async reject(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: ReviewApplicationDto,
  ): Promise<{ data: { id: string } }> {
    await this.onboarding.reject(tenantId, id, principal.userId, dto.reason);
    return { data: { id } };
  }
}
