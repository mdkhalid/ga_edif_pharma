/**
 * Salt / composition normalisation — the single source of truth.
 *
 * Imported by:
 *   - the backend, to build `composition_key` when a product is saved
 *   - the backend, to normalise an incoming salt-combination search query
 *   - the web and mobile clients, to normalise a query before sending it
 *
 * If the product-side and query-side normalisers ever diverge, exact matching
 * breaks SILENTLY: search still returns results, just the wrong ones. That is
 * why this file is shared rather than duplicated.
 *
 * CONSTRAINT — pure JavaScript only. No `node:crypto`, no `Buffer`, no DOM.
 * React Native (Hermes) has no Node built-ins, so hashing lives in the backend
 * (`backend/src/modules/salt-engine`), not here.
 */

export interface CompositionPart {
  /** The salt's canonical name, e.g. `Paracetamol`. Aliases must be resolved first. */
  readonly canonicalSalt: string;
  /** Optional strength as a human string, e.g. `500mg`, `0.5 g`. */
  readonly strength?: string | undefined;
}

export interface ParsedStrength {
  readonly value: string;
  readonly unit: string;
}

/** Sentinel strength used when the caller did not specify one. */
export const ANY_STRENGTH = 'any';

interface UnitConversion {
  readonly base: string;
  readonly factor: number;
}

/**
 * Every unit we can convert, mapped to its canonical base unit.
 * Mass normalises to mg, volume to ml. Unknown units are preserved verbatim
 * rather than guessed at — a wrong guess is worse than no conversion.
 */
const STRENGTH_UNITS: Readonly<Record<string, UnitConversion>> = {
  mcg: { base: 'mg', factor: 0.001 },
  ug: { base: 'mg', factor: 0.001 },
  '\u00b5g': { base: 'mg', factor: 0.001 },
  '\u03bcg': { base: 'mg', factor: 0.001 },
  mg: { base: 'mg', factor: 1 },
  g: { base: 'mg', factor: 1000 },
  gm: { base: 'mg', factor: 1000 },
  kg: { base: 'mg', factor: 1_000_000 },
  ml: { base: 'ml', factor: 1 },
  l: { base: 'ml', factor: 1000 },
  iu: { base: 'iu', factor: 1 },
  '%': { base: '%', factor: 1 },
};

const STRENGTH_PATTERN = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z%\u00b5\u03bc]+)\s*$/;

/** Splits a raw salt-combination query into individual salt segments. */
const SALT_SEPARATOR_PATTERN = /\s*(?:\+|,|&|\/|;|\band\b|\bwith\b)\s*/gi;

/**
 * Lowercase, strip diacritics, drop everything that is not alphanumeric.
 *
 * `String.prototype.normalize` is guarded because older Hermes builds (React
 * Native) do not implement it. Without the guard, mobile clients would throw
 * on any accented salt name instead of degrading to a slightly worse match.
 */
export function normalizeToken(input: string): string {
  const decomposed =
    typeof input.normalize === 'function'
      ? input.normalize('NFKD')
      : input;

  return decomposed
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** `500.0000` -> `500`, `0.5000` -> `0.5`. Never emits a trailing `.0`. */
export function trimDecimalString(value: number | string): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value).trim();
  if (Number.isInteger(numeric)) return String(numeric);
  return String(parseFloat(numeric.toFixed(6)));
}

/**
 * Converts a strength to its canonical base unit and formats it deterministically.
 *
 *   ('500', 'mg')  -> '500mg'
 *   ('0.5', 'g')   -> '500mg'   (same key — this is the point)
 *   ('10',  'mg')  -> '10mg'
 *   ('650', 'mg')  -> '650mg'   (correctly different)
 */
export function normalizeStrength(value: number | string, unit: string): string {
  const unitKey = unit.trim().toLowerCase();
  const conversion = STRENGTH_UNITS[unitKey];

  if (conversion === undefined) {
    return `${trimDecimalString(value)}${normalizeToken(unitKey)}`;
  }

  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return `${trimDecimalString(value)}${conversion.base}`;
  }

  return `${trimDecimalString(numeric * conversion.factor)}${conversion.base}`;
}

/** Parses `500mg` / `0.5 g` into its numeric and unit parts. Returns null if unparseable. */
export function parseStrength(raw: string): ParsedStrength | null {
  const match = STRENGTH_PATTERN.exec(raw);
  if (match === null) return null;

  const value = match[1];
  const unit = match[2];
  if (value === undefined || unit === undefined) return null;

  return { value, unit };
}

/** Normalises a strength already expressed as a single string, e.g. `0.5 g` -> `500mg`. */
export function normalizeStrengthToken(raw: string): string {
  const parsed = parseStrength(raw);
  if (parsed === null) return normalizeToken(raw);
  return normalizeStrength(parsed.value, parsed.unit);
}

/** One `name-strength` segment of a composition key. */
export function compositionSegment(part: CompositionPart): string {
  const name = normalizeToken(part.canonicalSalt);
  const strength =
    part.strength !== undefined && part.strength.trim() !== ''
      ? normalizeStrengthToken(part.strength)
      : ANY_STRENGTH;

  return `${name}-${strength}`;
}

/**
 * THE canonical composition key. Sorted, normalised, strength-annotated.
 *
 *   [{ Paracetamol, '500mg' }, { Cetirizine, '10mg' }]
 *     -> 'cetirizine-10mg|paracetamol-500mg'
 *
 * Sorting makes it order-independent, so `Cetirizine + Paracetamol` and
 * `Paracetamol + Cetirizine` produce the identical key.
 */
export function buildCompositionKey(parts: readonly CompositionPart[]): string {
  return parts.map(compositionSegment).sort().join('|');
}

/**
 * Strength-agnostic key, used when the buyer did not specify strengths.
 *
 *   [{ Paracetamol }, { Cetirizine }] -> 'cetirizine|paracetamol'
 *
 * A query with no strengths cannot match `composition_key` exactly (no product
 * has an `any` strength), so it matches against this key instead.
 */
export function buildCompositionSaltKey(parts: readonly CompositionPart[]): string {
  const names = parts.map((part) => normalizeToken(part.canonicalSalt));
  return [...new Set(names)].sort().join('|');
}

/** True when the composition contains more than one distinct salt. */
export function isCombination(parts: readonly CompositionPart[]): boolean {
  return new Set(parts.map((part) => normalizeToken(part.canonicalSalt))).size > 1;
}

/**
 * Splits raw user input into salt segments.
 * Handles `+`, `,`, `&`, `/`, `;`, `and`, `with` — all of which buyers actually type.
 */
export function splitSaltQuery(raw: string): string[] {
  return raw
    .split(SALT_SEPARATOR_PATTERN)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/**
 * Separates a strength suffix from a salt name.
 * `'Paracetamol 500mg'` -> `{ name: 'Paracetamol', strength: '500mg' }`
 * `'Paracetamol'`       -> `{ name: 'Paracetamol', strength: undefined }`
 */
export function splitNameAndStrength(raw: string): {
  name: string;
  strength: string | undefined;
} {
  const match = /^(.*?)[\s]*([0-9]+(?:\.[0-9]+)?\s*[a-zA-Z%\u00b5\u03bc]+)$/.exec(
    raw.trim(),
  );

  if (match === null) return { name: raw.trim(), strength: undefined };

  const name = match[1];
  const strength = match[2];
  if (name === undefined || name.trim() === '' || strength === undefined) {
    return { name: raw.trim(), strength: undefined };
  }

  return { name: name.trim(), strength: strength.replace(/\s+/g, '') };
}
