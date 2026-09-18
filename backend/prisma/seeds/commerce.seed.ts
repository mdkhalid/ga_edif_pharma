import type { PrismaClient } from '@prisma/client';
import { v5 as uuidv5 } from 'uuid';

import { canonicalCompositionKey } from '../../src/modules/salt-engine/domain/composition-key';

/**
 * Phase 1 demo commerce data: one buyer organisation, a small catalogue and
 * warehouse stock.
 *
 * This is what makes the storefront, cart and order paths driveable locally:
 * without products and stock, `/products`, `/salt-search`, the cart page and
 * order placement all answer correctly against an empty database — which proves
 * nothing.
 *
 * ## Design rules
 *
 * **Idempotent.** Every write is an `upsert`, never a `create`. Products and the
 * demo organisation carry no natural unique key the seed can rely on (a re-run
 * must not mint a second "Demo Retail Pharmacy"), so both use deterministic
 * UUIDv5 ids derived from a fixed namespace plus a stable natural key. Stock
 * rows upsert on the `@@unique([tenantId, productId, warehouseId])` compound
 * key the schema already declares.
 *
 * **Consistent with search.** Each product's `compositionKey` is computed with
 * the real `canonicalCompositionKey` from the salt engine, not hand-written.
 * A hand-written key that drifts from the engine's normalisation would make the
 * seeded combo product invisible to the very `Paracetamol + Cetirizine` query
 * the Phase 1 exit criteria name.
 *
 * **Development only.** Like the admin-user seed, this refuses to run in
 * production: demo stock in a live ledger would corrupt real inventory, and the
 * demo GSTIN below is syntactically shaped but not a real registration.
 */

// Fixed namespace so ids are stable across machines and re-runs. Any UUID
// works; this one was generated once and must never change, or re-runs would
// mint duplicate rows.
const COMMERCE_NAMESPACE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const DEMO_WAREHOUSE_ID = 'WH-MUM-01';

interface SeedProduct {
  key: string;
  name: string;
  description: string;
  schedule: string;
  hsnCode: string;
  strength: string;
  packSize: number;
  packUnit: string;
  price: number;
  saltAliases: string[];
  compositionNames: string[];
  stock: number;
  batchId: string;
}

const PRODUCTS: readonly SeedProduct[] = [
  {
    key: 'crocin-advance-500',
    name: 'Crocin Advance 500mg',
    description: 'Paracetamol 500mg tablets for fever and pain relief.',
    schedule: 'OTC',
    hsnCode: '3004',
    strength: '500mg',
    packSize: 15,
    packUnit: 'strip',
    price: 32,
    saltAliases: ['paracetamol', 'acetaminophen'],
    compositionNames: ['Paracetamol'],
    stock: 5000,
    batchId: 'B202601',
  },
  {
    key: 'dolo-650',
    name: 'Dolo 650mg',
    description: 'Paracetamol 650mg tablets for fever and pain relief.',
    schedule: 'OTC',
    hsnCode: '3004',
    strength: '650mg',
    packSize: 15,
    packUnit: 'strip',
    price: 35,
    saltAliases: ['paracetamol', 'acetaminophen'],
    compositionNames: ['Paracetamol'],
    stock: 4000,
    batchId: 'B202602',
  },
  {
    key: 'cetirizine-10',
    name: 'Cetirizine 10mg',
    description: 'Cetirizine 10mg tablets for allergy relief.',
    schedule: 'OTC',
    hsnCode: '3004',
    strength: '10mg',
    packSize: 10,
    packUnit: 'strip',
    price: 45,
    saltAliases: ['cetirizine', 'cetirizine hydrochloride'],
    compositionNames: ['Cetirizine'],
    stock: 3000,
    batchId: 'B202603',
  },
  {
    key: 'paracetamol-ibuprofen-combo',
    name: 'Paracetamol 325mg + Ibuprofen 400mg',
    description: 'Combination tablets for pain and inflammation.',
    schedule: 'H',
    hsnCode: '3004',
    strength: '325mg+400mg',
    packSize: 20,
    packUnit: 'strip',
    price: 58,
    saltAliases: [],
    compositionNames: ['Paracetamol', 'Ibuprofen'],
    stock: 2500,
    batchId: 'B202604',
  },
  {
    key: 'paracetamol-cetirizine-combo',
    name: 'Paracetamol 500mg + Cetirizine 5mg',
    description: 'Combination tablets for cold and flu symptoms.',
    schedule: 'H',
    hsnCode: '3004',
    strength: '500mg+5mg',
    packSize: 10,
    packUnit: 'strip',
    price: 62,
    saltAliases: [],
    compositionNames: ['Paracetamol', 'Cetirizine'],
    stock: 2000,
    batchId: 'B202605',
  },
  {
    key: 'azithromycin-500',
    name: 'Azithromycin 500mg',
    description: 'Azithromycin 500mg tablets, macrolide antibiotic.',
    schedule: 'H1',
    hsnCode: '3004',
    strength: '500mg',
    packSize: 5,
    packUnit: 'strip',
    price: 120,
    saltAliases: ['azithromycin'],
    compositionNames: ['Azithromycin'],
    stock: 1500,
    batchId: 'B202606',
  },
  {
    key: 'amoxicillin-clavulanate',
    name: 'Amoxicillin 500mg + Clavulanic Acid 125mg',
    description: 'Broad-spectrum antibiotic combination tablets.',
    schedule: 'H',
    hsnCode: '3004',
    strength: '500mg+125mg',
    packSize: 10,
    packUnit: 'strip',
    price: 185,
    saltAliases: [],
    compositionNames: ['Amoxicillin', 'Clavulanic Acid'],
    stock: 1200,
    batchId: 'B202607',
  },
  {
    key: 'pantoprazole-40',
    name: 'Pantoprazole 40mg',
    description: 'Pantoprazole 40mg tablets for acidity and reflux.',
    schedule: 'H',
    hsnCode: '3004',
    strength: '40mg',
    packSize: 15,
    packUnit: 'strip',
    price: 95,
    saltAliases: ['pantoprazole'],
    compositionNames: ['Pantoprazole'],
    stock: 2800,
    batchId: 'B202608',
  },
];

/**
 * Seeds the demo buyer, catalogue and stock for `tenantId`. Returns the demo
 * organisation id so later seeds (or scripts) can build on it.
 */
export async function seedCommerce(prisma: PrismaClient, tenantId: string): Promise<{ organisationId: string }> {
  if (process.env['NODE_ENV'] === 'production') {
    console.log('  commerce        skipped (production)');
    return { organisationId: '' };
  }

  // 1. The demo buyer. Deterministic id so a re-run upserts the same row;
  // the GSTIN is dev-shaped, never a real registration.
  const orgId = uuidv5(`commerce:organisation:${tenantId}:demo-pharmacy`, COMMERCE_NAMESPACE);
  const organisation = await prisma.organisation.upsert({
    where: { id: orgId },
    update: {},
    create: {
      id: orgId,
      tenantId,
      type: 'PHARMACY',
      status: 'ACTIVE',
      legalName: 'Demo Retail Pharmacy',
      tradeName: 'CityCare Pharmacy',
      drugLicenceNo: 'MH-20B-DEV-000001',
      gstin: '27DEV000000A1Z5',
      stateCode: 'MH',
      email: 'orders@citycare.local',
      phone: '+919820000001',
      approvedAt: new Date(),
    },
    select: { id: true },
  });
  console.log(`  commerce org  Demo Retail Pharmacy (${organisation.id})`);

  // 2. Catalogue + stock. Stock upserts on the compound unique key, so a
  // re-run refreshes nothing an operator has since edited (update: {}).
  for (const item of PRODUCTS) {
    const productId = uuidv5(`commerce:product:${tenantId}:${item.key}`, COMMERCE_NAMESPACE);
    await prisma.product.upsert({
      where: { id: productId },
      update: {},
      create: {
        id: productId,
        tenantId,
        name: item.name,
        description: item.description,
        schedule: item.schedule,
        hsnCode: item.hsnCode,
        strength: item.strength,
        packSize: item.packSize,
        packUnit: item.packUnit,
        price: item.price,
        currency: 'INR',
        status: 'ACTIVE',
        visibility: 'PUBLIC',
        saltAliases: item.saltAliases,
        compositionKey: canonicalCompositionKey(item.compositionNames),
        compositionNames: item.compositionNames,
      },
    });

    await prisma.warehouseStock.upsert({
      where: {
        tenantId_productId_warehouseId: {
          tenantId,
          productId,
          warehouseId: DEMO_WAREHOUSE_ID,
        },
      },
      update: {},
      create: {
        tenantId,
        productId,
        warehouseId: DEMO_WAREHOUSE_ID,
        quantity: item.stock,
        batchId: item.batchId,
        expiryDate: new Date('2027-06-30T00:00:00.000Z'),
        reserved: 0,
      },
    });
  }
  console.log(`  commerce      ${PRODUCTS.length} products + stock @ ${DEMO_WAREHOUSE_ID}`);

  return { organisationId: organisation.id };
}
