/**
 * Salt / composition normalisation.
 *
 * ## Why this suite is exhaustive
 *
 * The composition key is the join between "what a product is" and "what a buyer
 * typed". The product side writes it once, at save time; the query side computes
 * it on every search. If the two ever disagree, nothing throws and nothing logs —
 * search simply returns the wrong products, or none. That failure is invisible in
 * a demo and expensive in production, which is exactly why every branch below is
 * pinned by a test.
 *
 * The equivalence cases (same salt written two ways must produce the same key)
 * and the distinction cases (different strengths must produce different keys) are
 * the two halves of the contract. A bug that makes the normaliser too aggressive
 * collapses distinct products into one key; too lax, and nothing matches.
 */
import {
  ANY_STRENGTH,
  buildCompositionKey,
  buildCompositionSaltKey,
  compositionSegment,
  isCombination,
  normalizeStrength,
  normalizeStrengthToken,
  normalizeToken,
  parseStrength,
  splitNameAndStrength,
  splitSaltQuery,
  trimDecimalString,
} from '../src/salt/normalize';

describe('normalizeToken', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(normalizeToken('Paracetamol')).toBe('paracetamol');
    expect(normalizeToken('CETIRIZINE')).toBe('cetirizine');
  });

  it('strips diacritics so accented and plain spellings collide', () => {
    // A buyer typing the accented form and a catalogue entry in plain ASCII must
    // produce the same token, or the same medicine is two products.
    expect(normalizeToken('Paracétamol')).toBe('paracetamol');
    expect(normalizeToken('Ácido Acetilsalicílico')).toBe('acidoacetilsalicilico');
  });

  it('removes spaces, hyphens and parentheses', () => {
    expect(normalizeToken('Vitamin B-12')).toBe('vitaminb12');
    expect(normalizeToken('Amoxicillin (trihydrate)')).toBe('amoxicillintrihydrate');
  });

  it('degrades gracefully when String.prototype.normalize is unavailable', () => {
    // Older Hermes builds on React Native lack `normalize`. The function must
    // still return a usable token rather than throwing, or the mobile client
    // breaks on any accented salt name.
    const original = String.prototype.normalize;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (String.prototype as any).normalize = undefined;
    try {
      expect(normalizeToken('Paracetamol')).toBe('paracetamol');
    } finally {
      String.prototype.normalize = original;
    }
  });
});

describe('trimDecimalString', () => {
  it('never emits a trailing .0', () => {
    expect(trimDecimalString('500.0000')).toBe('500');
    expect(trimDecimalString(500)).toBe('500');
  });

  it('keeps a meaningful fraction and drops trailing zeros', () => {
    expect(trimDecimalString('0.5000')).toBe('0.5');
    expect(trimDecimalString(0.25)).toBe('0.25');
  });

  it('passes through an unparseable value rather than emitting NaN', () => {
    // Emitting "NaN" would create a key that looks valid and matches nothing.
    expect(trimDecimalString('not-a-number')).toBe('not-a-number');
  });
});

describe('normalizeStrength — unit equivalence', () => {
  it('treats 0.5 g and 500 mg as the same strength', () => {
    // The single most important equivalence: the same medicine described in
    // grams on one record and milligrams on another must be one key.
    expect(normalizeStrength('0.5', 'g')).toBe('500mg');
    expect(normalizeStrength('500', 'mg')).toBe('500mg');
    expect(normalizeStrength(500, 'mg')).toBe('500mg');
  });

  it('converts micrograms and kilograms to milligrams', () => {
    expect(normalizeStrength('500', 'mcg')).toBe('0.5mg');
    expect(normalizeStrength('1', 'kg')).toBe('1000000mg');
  });

  it('converts litres to millilitres', () => {
    expect(normalizeStrength('1', 'l')).toBe('1000ml');
    expect(normalizeStrength('250', 'ml')).toBe('250ml');
  });

  it('preserves units it does not know rather than guessing', () => {
    // A wrong conversion is worse than no conversion: it would merge two
    // genuinely different strengths into one key.
    expect(normalizeStrength('10', 'drops')).toBe('10drops');
    expect(normalizeStrength('5', 'iu')).toBe('5iu');
    expect(normalizeStrength('2', '%')).toBe('2%');
  });

  it('is case- and whitespace-insensitive in the unit', () => {
    expect(normalizeStrength('500', ' MG ')).toBe('500mg');
    expect(normalizeStrength('500', 'Mg')).toBe('500mg');
  });

  it('passes an unparseable value through with the base unit', () => {
    expect(normalizeStrength('unknown', 'mg')).toBe('unknownmg');
  });
});

describe('parseStrength', () => {
  it('parses a value and unit', () => {
    expect(parseStrength('500mg')).toEqual({ value: '500', unit: 'mg' });
    expect(parseStrength('0.5 g')).toEqual({ value: '0.5', unit: 'g' });
  });

  it('returns null when there is no unit', () => {
    expect(parseStrength('500')).toBeNull();
    expect(parseStrength('Paracetamol')).toBeNull();
    expect(parseStrength('')).toBeNull();
  });
});

describe('normalizeStrengthToken', () => {
  it('normalises a written strength', () => {
    expect(normalizeStrengthToken('0.5 g')).toBe('500mg');
    expect(normalizeStrengthToken('500mg')).toBe('500mg');
  });

  it('falls back to token normalisation for a non-numeric strength', () => {
    expect(normalizeStrengthToken('As needed')).toBe('asneeded');
  });
});

describe('compositionSegment', () => {
  it('annotates a segment with its strength', () => {
    expect(compositionSegment({ canonicalSalt: 'Paracetamol', strength: '500mg' })).toBe(
      'paracetamol-500mg',
    );
  });

  it('uses the ANY sentinel when no strength is given', () => {
    expect(compositionSegment({ canonicalSalt: 'Paracetamol' })).toBe(`paracetamol-${ANY_STRENGTH}`);
    expect(compositionSegment({ canonicalSalt: 'Paracetamol', strength: '   ' })).toBe(
      `paracetamol-${ANY_STRENGTH}`,
    );
  });
});

describe('buildCompositionKey — the canonical key', () => {
  it('sorts the parts so order does not matter', () => {
    // The case the whole design exists for: the same combination entered in
    // either order must produce one key.
    const one = buildCompositionKey([
      { canonicalSalt: 'Cetirizine', strength: '10mg' },
      { canonicalSalt: 'Paracetamol', strength: '500mg' },
    ]);
    const two = buildCompositionKey([
      { canonicalSalt: 'Paracetamol', strength: '500mg' },
      { canonicalSalt: 'Cetirizine', strength: '10mg' },
    ]);

    expect(one).toBe('cetirizine-10mg|paracetamol-500mg');
    expect(one).toBe(two);
  });

  it('is insensitive to case, spacing and strength units', () => {
    const one = buildCompositionKey([
      { canonicalSalt: '  PARACETAMOL ', strength: '0.5 g' },
      { canonicalSalt: 'cetirizine', strength: '10 MG' },
    ]);

    expect(one).toBe('cetirizine-10mg|paracetamol-500mg');
  });

  it('distinguishes different strengths of the same salt', () => {
    // Too-aggressive normalisation would merge these. They are different
    // products and must not collide.
    const low = buildCompositionKey([{ canonicalSalt: 'Paracetamol', strength: '500mg' }]);
    const high = buildCompositionKey([{ canonicalSalt: 'Paracetamol', strength: '650mg' }]);

    expect(low).not.toBe(high);
    expect(low).toBe('paracetamol-500mg');
    expect(high).toBe('paracetamol-650mg');
  });

  it('distinguishes a missing strength from a stated one', () => {
    const anyStrength = buildCompositionKey([{ canonicalSalt: 'Paracetamol' }]);
    const stated = buildCompositionKey([{ canonicalSalt: 'Paracetamol', strength: '500mg' }]);

    expect(anyStrength).not.toBe(stated);
    expect(anyStrength).toBe(`paracetamol-${ANY_STRENGTH}`);
  });

  it('returns an empty string for an empty composition', () => {
    expect(buildCompositionKey([])).toBe('');
  });

  it('handles a three-salt combination deterministically', () => {
    const parts = [
      { canonicalSalt: 'Paracetamol', strength: '500mg' },
      { canonicalSalt: 'Cetirizine', strength: '10mg' },
      { canonicalSalt: 'Pseudoephedrine', strength: '30mg' },
    ];
    // Sorted lexicographically by the whole segment, not by insertion order.
    expect(buildCompositionKey(parts)).toBe(
      'cetirizine-10mg|paracetamol-500mg|pseudoephedrine-30mg',
    );
    expect(buildCompositionKey([...parts].reverse())).toBe(buildCompositionKey(parts));
  });
});

describe('buildCompositionSaltKey — strength-agnostic key', () => {
  it('drops strengths so a query without strengths can match', () => {
    expect(
      buildCompositionSaltKey([
        { canonicalSalt: 'Cetirizine', strength: '10mg' },
        { canonicalSalt: 'Paracetamol', strength: '500mg' },
      ]),
    ).toBe('cetirizine|paracetamol');
  });

  it('de-duplicates a salt repeated in the composition', () => {
    // A buyer typing "paracetamol + paracetamol" should not produce a key that
    // matches nothing.
    expect(
      buildCompositionSaltKey([{ canonicalSalt: 'Paracetamol' }, { canonicalSalt: 'paracetamol' }]),
    ).toBe('paracetamol');
  });

  it('is order-independent', () => {
    const a = buildCompositionSaltKey([{ canonicalSalt: 'B' }, { canonicalSalt: 'A' }]);
    const b = buildCompositionSaltKey([{ canonicalSalt: 'A' }, { canonicalSalt: 'B' }]);
    expect(a).toBe('a|b');
    expect(a).toBe(b);
  });
});

describe('isCombination', () => {
  it('is false for a single salt, however it is spelled', () => {
    expect(isCombination([{ canonicalSalt: 'Paracetamol' }])).toBe(false);
    expect(
      isCombination([{ canonicalSalt: 'Paracetamol' }, { canonicalSalt: 'PARACETAMOL ' }]),
    ).toBe(false);
  });

  it('is true for two distinct salts', () => {
    expect(isCombination([{ canonicalSalt: 'Paracetamol' }, { canonicalSalt: 'Cetirizine' }])).toBe(
      true,
    );
  });

  it('is false for an empty composition', () => {
    expect(isCombination([])).toBe(false);
  });
});

describe('splitSaltQuery', () => {
  it('splits on every separator a buyer actually types', () => {
    // These are not hypothetical: each one appears in real order forms.
    for (const separator of [' + ', ',', ' & ', '/', ';', ' and ', ' with ']) {
      expect(splitSaltQuery(`Paracetamol${separator}Cetirizine`)).toEqual([
        'Paracetamol',
        'Cetirizine',
      ]);
    }
  });

  it('trims and drops empty segments', () => {
    expect(splitSaltQuery('  Paracetamol +  + Cetirizine  ')).toEqual([
      'Paracetamol',
      'Cetirizine',
    ]);
  });

  it('returns a single segment when there is no separator', () => {
    expect(splitSaltQuery('Paracetamol')).toEqual(['Paracetamol']);
  });

  it('returns an empty array for blank input', () => {
    expect(splitSaltQuery('   ')).toEqual([]);
    expect(splitSaltQuery('')).toEqual([]);
  });

  it('does not split a multi-word salt name on its internal space', () => {
    // "Vitamin B12" is one salt. Splitting on whitespace would be wrong.
    expect(splitSaltQuery('Vitamin B12')).toEqual(['Vitamin B12']);
  });
});

describe('splitNameAndStrength', () => {
  it('separates a trailing strength', () => {
    expect(splitNameAndStrength('Paracetamol 500mg')).toEqual({
      name: 'Paracetamol',
      strength: '500mg',
    });
    expect(splitNameAndStrength('Paracetamol 0.5 g')).toEqual({
      name: 'Paracetamol',
      strength: '0.5g',
    });
  });

  it('returns no strength when none is present', () => {
    expect(splitNameAndStrength('Paracetamol')).toEqual({
      name: 'Paracetamol',
      strength: undefined,
    });
  });

  it('treats a name that is only digits and letters as a name', () => {
    // "B12" is part of the name, not a strength.
    expect(splitNameAndStrength('Vitamin B12')).toEqual({
      name: 'Vitamin B12',
      strength: undefined,
    });
  });

  it('trims surrounding whitespace', () => {
    expect(splitNameAndStrength('  Paracetamol 500mg  ')).toEqual({
      name: 'Paracetamol',
      strength: '500mg',
    });
  });
});

describe('round trip — product write and query agree', () => {
  it('produces the same key from a catalogue entry and a free-text query', () => {
    // This is the property the whole module exists to guarantee, expressed as
    // one assertion: whatever the catalogue stored, a buyer typing the same
    // combination in any form must reach it.
    const catalogueEntry = buildCompositionKey([
      { canonicalSalt: 'Cetirizine', strength: '10mg' },
      { canonicalSalt: 'Paracetamol', strength: '500mg' },
    ]);

    const typedVariants = [
      'Paracetamol 500mg + Cetirizine 10mg',
      'cetirizine 10 mg and paracetamol 0.5 g',
      'PARACETAMOL 0.5g & CETIRIZINE 10MG',
      'Cetirizine 10mg, Paracetamol 500mg',
    ];

    for (const variant of typedVariants) {
      const parts = splitSaltQuery(variant).map((segment) => {
        const { name, strength } = splitNameAndStrength(segment);
        return { canonicalSalt: name, strength };
      });

      expect(buildCompositionKey(parts)).toBe(catalogueEntry);
    }
  });
});
