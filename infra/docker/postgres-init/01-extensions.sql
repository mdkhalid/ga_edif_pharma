-- Extensions required by MediChain.
-- Loaded automatically by the postgres container on first boot.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- fuzzy medicine/brand search
CREATE EXTENSION IF NOT EXISTS "unaccent";    -- accent-insensitive search
CREATE EXTENSION IF NOT EXISTS "btree_gin";   -- composite GIN indexes
CREATE EXTENSION IF NOT EXISTS "citext";      -- case-insensitive email/username
-- CREATE EXTENSION IF NOT EXISTS "postgis";  -- uncomment when geo delivery zones go live
