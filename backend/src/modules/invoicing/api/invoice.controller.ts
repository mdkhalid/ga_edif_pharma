import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Capability, type AuthenticatedPrincipal } from '@medichain/shared-types';

import {
  CurrentTenant,
  CurrentUser,
  Idempotent,
  RequireCapability,
} from '../../../common/decorators';
import { uuidParam } from '../../../common/pipes/parse-uuid.pipe';
import { NotFoundError } from '../../../common/exceptions/domain.exception';
import { InvoicingService } from '../application/invoicing.service';
import { CancelInvoiceDto, IssueInvoiceDto, ListInvoicesQuery } from './dto/invoice.dto';

/**
 * Tax-invoice endpoints.
 *
 * Issuing is idempotent twice over: the `Idempotency-Key` replay guards the
 * HTTP retry, and the service returns the existing live invoice when the order
 * was already invoiced — a second number for the same order is a duplicate tax
 * document, which must never exist.
 */
@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoicing: InvoicingService) {}

  @Post('issue')
  @RequireCapability(Capability.INVOICE_WRITE)
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Issue a GST tax invoice against an order' })
  @ApiResponse({ status: 201, description: 'Invoice issued with a gapless number.' })
  async issue(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: IssueInvoiceDto,
  ): Promise<{ data: { id: string; invoiceNumber: string; total: string } }> {
    const result = await this.invoicing.issueFromOrder(tenantId, principal.userId, dto);
    return { data: result };
  }

  @Get()
  @RequireCapability(Capability.INVOICE_READ)
  @ApiOperation({ summary: 'List invoices (own organisation, or all for staff)' })
  @ApiResponse({ status: 200, description: 'Paginated invoice list.' })
  async list(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ListInvoicesQuery,
  ): Promise<{
    data: Array<{ id: string; invoiceNumber: string; status: string; total: string; createdAt: Date }>;
    meta: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
  }> {
    return this.invoicing.list(tenantId, principal.organisationId, this.isStaff(principal), query);
  }

  @Get(':id')
  @RequireCapability(Capability.INVOICE_READ)
  @ApiOperation({ summary: 'Get an invoice with its lines and totals' })
  @ApiResponse({ status: 200, description: 'The invoice.' })
  async getById(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
  ): Promise<{
    data: {
      id: string;
      invoiceNumber: string;
      status: string;
      gstType: string;
      totals: {
        taxableTotal: string;
        cgstTotal: string;
        sgstTotal: string;
        igstTotal: string;
        totalTax: string;
        roundOff: string;
        grandTotal: string;
      };
      lines: Array<{
        productId: string;
        description: string | null;
        hsnCode: string;
        taxRate: string;
        quantity: string;
        taxableValue: string;
        cgst: string;
        sgst: string;
        igst: string;
        lineTotal: string;
      }>;
    };
  }> {
    const row = await this.invoicing.getById(
      tenantId,
      id,
      principal.organisationId,
      this.isStaff(principal),
    );
    if (!row) throw new NotFoundError('Invoice not found.');
    return { data: row };
  }

  @Post(':id/cancel')
  @RequireCapability(Capability.INVOICE_CANCEL)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an issued invoice' })
  async cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id', uuidParam('id')) id: string,
    @Body() dto: CancelInvoiceDto,
  ): Promise<{ data: { id: string } }> {
    await this.invoicing.cancel(tenantId, id, principal.userId, dto);
    return { data: { id } };
  }

  private isStaff(principal: AuthenticatedPrincipal): boolean {
    return principal.capabilities.includes(Capability.INVOICE_WRITE);
  }
}
