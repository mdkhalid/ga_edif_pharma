import { SaltEngineService } from '../../src/modules/salt-engine';
import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { asTenantUser, createTestPrisma, seededTenant } from '../support/database';

/**
 * The salt-search half of the Phase 1 exit criteria, against a real catalogue:
 *
 *   "Searching `Paracetamol + Cetirizine` returns all matching products, and a
 *    typo (`Paracetmol`) still finds Paracetamol."
 *
 * The exact pass, the trigram fallback, and the decision to prefer exact results
 * are all behaviour of this service, so they are asserted through it rather than
 * through SQL — a test that reimplemented the query would prove only that SQL
 * behaves like SQL.
 */
describe('salt search (integration)', () => {
  let prisma: ExtendedPrismaClient;
  let engine: SaltEngineService;
  let tenantId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantId = (await seededTenant(prisma)).id;
    engine = new SaltEngineService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Runs a search as a signed-in user of the seeded tenant. */
  const search = async (query: string): Promise<string[]> => {
    const result = await asTenantUser(tenantId, () =>
      engine.search(tenantId, query, { pageSize: 50 }),
    );
    return result.data.map((row) => row.name);
  };

  describe('an exactly spelled combination', () => {
    it('returns the product holding that combination', async () => {
      const names = await search('Paracetamol + Cetirizine');

      expect(names).toContain('Paracetamol 500mg + Cetirizine 5mg');
    });

    it('marks the canonical key match as exact, and nothing else', async () => {
      const result = await asTenantUser(tenantId, () =>
        engine.search(tenantId, 'Paracetamol + Cetirizine', { pageSize: 50 }),
      );

      const combo = result.data.find((row) => row.name === 'Paracetamol 500mg + Cetirizine 5mg');
      expect(combo?.exact).toBe(true);

      // The other Paracetamol product does not hold Cetirizine, so it is not a
      // match at all — let alone an exact one.
      expect(result.data.map((row) => row.name)).not.toContain(
        'Paracetamol 325mg + Ibuprofen 400mg',
      );
    });

    it('accepts comma separators and any casing as the same query', async () => {
      const names = await search('cetirizine, PARACETAMOL');

      expect(names).toContain('Paracetamol 500mg + Cetirizine 5mg');
    });
  });

  describe('a misspelled salt', () => {
    it('still finds the products, including ones naming the salt only in their composition', async () => {
      const names = await search('Paracetmol');

      // Named "Paracetamol" in the product name.
      expect(names).toContain('Paracetamol 500mg + Cetirizine 5mg');
      // Brand names: Paracetamol appears only in `composition_names`.
      expect(names).toContain('Dolo 650mg');
      expect(names).toContain('Crocin Advance 500mg');
    });

    it('does not drag in unrelated salts', async () => {
      const names = await search('Paracetmol');

      expect(names).not.toContain('Azithromycin 500mg');
      expect(names).not.toContain('Pantoprazole 40mg');
      expect(names).not.toContain('Amoxicillin 500mg + Clavulanic Acid 125mg');
    });

    it('tolerates the t/s typo, which scores exactly at pg_trgm’s default floor', async () => {
      // `parasetamol` scores 0.600 against `paracetamol`. pg_trgm's default
      // word-similarity threshold is 0.6 and the operator compares strictly, so
      // with the stock setting this query returns nothing. The service lowers
      // the threshold for exactly this case.
      const names = await search('Parasetamol');

      expect(names).toContain('Dolo 650mg');
    });

    it('applies the AND rule across misspelled tokens', async () => {
      const names = await search('Paracetmol + Cetirizin');

      expect(names).toEqual(['Paracetamol 500mg + Cetirizine 5mg']);
    });
  });

  describe('a query that matches nothing', () => {
    it('returns no rows rather than the whole catalogue', async () => {
      const names = await search('zzzznotadrug');

      expect(names).toEqual([]);
    });
  });
});
