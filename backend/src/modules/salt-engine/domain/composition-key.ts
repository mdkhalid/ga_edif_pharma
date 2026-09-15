/**
 * Canonical composition key.
 *
 * Two products hold the same salt combination iff their canonical keys are
 * equal, regardless of ingredient order, casing or extra whitespace. The key
 * is `name1+name2` with each name normalised (trimmed, inner whitespace
 * collapsed, lowercased) and the list sorted, so `Cetirizine + Paracetamol`
 * and `paracetamol+cetirizine` produce the same key.
 *
 * Pure and dependency-free so it can be unit-tested without a database and
 * reused by import scripts and the search path alike.
 */

/** Normalises one ingredient name. */
export function normaliseIngredientName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Builds the canonical key for a list of ingredient names. */
export function canonicalCompositionKey(names: readonly string[]): string {
  const cleaned = names
    .map((name) => normaliseIngredientName(name))
    .filter((name) => name.length > 0);
  cleaned.sort();
  return cleaned.join('+');
}

/**
 * Parses a salt query such as `Paracetamol + Cetirizine` or
 * `paracetamol,cetirizine` into normalised, deduplicated tokens.
 */
export function parseSaltQuery(query: string): string[] {
  const tokens = query
    .split(/[+,]/)
    .map((token) => normaliseIngredientName(token))
    .filter((token) => token.length > 0);
  return [...new Set(tokens)];
}
