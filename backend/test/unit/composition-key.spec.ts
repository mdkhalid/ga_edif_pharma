import {
  canonicalCompositionKey,
  normaliseIngredientName,
  parseSaltQuery,
} from '../../src/modules/salt-engine/domain/composition-key';

describe('canonicalCompositionKey', () => {
  it('is order-, case- and whitespace-insensitive', () => {
    expect(canonicalCompositionKey(['Cetirizine ', '  Paracetamol'])).toBe(
      canonicalCompositionKey(['paracetamol', 'cetirizine']),
    );
    expect(canonicalCompositionKey(['Paracetamol', 'Cetirizine'])).toBe(
      'cetirizine+paracetamol',
    );
  });

  it('drops blanks', () => {
    expect(canonicalCompositionKey(['Paracetamol', '  ', ''])).toBe('paracetamol');
  });
});

describe('parseSaltQuery', () => {
  it('splits on + and commas and dedupes', () => {
    expect(parseSaltQuery('Paracetamol + Cetirizine, paracetamol')).toEqual([
      'paracetamol',
      'cetirizine',
    ]);
  });

  it('returns an empty list for a blank query', () => {
    expect(parseSaltQuery('   ')).toEqual([]);
  });
});

describe('normaliseIngredientName', () => {
  it('collapses inner whitespace', () => {
    expect(normaliseIngredientName('  Vitamin   C  ')).toBe('vitamin c');
  });
});
