-- Typo-tolerant salt search.
--
-- `pg_trgm` is a trusted contrib extension, so the database owner can install
-- it without superuser rights (PostgreSQL 13+). The three GIN indexes below
-- back the typo pass in SaltEngineService.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- `array_to_string` is STABLE rather than IMMUTABLE — it is polymorphic and
-- depends on the element type's output function — which disqualifies it from an
-- index expression. For a `text[]` with a constant separator the result is
-- deterministic, so this wrapper is genuinely immutable, and it is what makes
-- the two array sources indexable alongside the scalar `name` column.
CREATE OR REPLACE FUNCTION medichain_text_array_to_string(text[])
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  AS $$ SELECT array_to_string($1, ' ') $$;

-- pg_trgm folds case when it extracts trigrams, so `Paracetmol` and
-- `paracetamol` produce comparable trigram sets and no `lower()` expression
-- (and therefore no functional index) is needed.
--
-- All three sources the exact pass matches on are indexed, so a typo is
-- tolerated wherever the correct spelling would have matched — including
-- products that name the salt only in their composition, such as `Dolo 650mg`.
CREATE INDEX "product_name_trgm_idx"
  ON "product" USING GIN ("name" gin_trgm_ops);

CREATE INDEX "product_salt_aliases_trgm_idx"
  ON "product" USING GIN (medichain_text_array_to_string("salt_aliases") gin_trgm_ops);

CREATE INDEX "product_composition_names_trgm_idx"
  ON "product" USING GIN (medichain_text_array_to_string("composition_names") gin_trgm_ops);
