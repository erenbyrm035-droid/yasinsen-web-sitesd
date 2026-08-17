-- VIVA SALES ENGINE — Postgres / Supabase semasi
-- src/lib/db/schema.sql (SQLite) ile bire bir ayni tablolar.
-- SQLite'tan gecerken degisen yalnizca src/lib/db/client.ts + repository govdeleri.
--
-- Farklar:
--   * INTEGER PRIMARY KEY AUTOINCREMENT -> BIGSERIAL
--   * TEXT (JSON) -> JSONB
--   * INTEGER (0/1) -> BOOLEAN
--   * datetime('now') -> now()

CREATE TABLE IF NOT EXISTS companies (
  id                BIGSERIAL PRIMARY KEY,
  name              TEXT        NOT NULL,
  website           TEXT,
  domain            TEXT,
  location_city     TEXT,
  location_district TEXT,
  lat               DOUBLE PRECISION,
  lon               DOUBLE PRECISION,
  industry          TEXT,
  segment           TEXT,
  employee_count    INTEGER,
  phone             TEXT,
  source            TEXT        NOT NULL,
  source_ref        TEXT        NOT NULL,
  raw               JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_ref)
);

CREATE INDEX IF NOT EXISTS idx_companies_domain   ON companies (domain);
CREATE INDEX IF NOT EXISTS idx_companies_district ON companies (location_district);

-- E-posta bulunamazsa NULL kalir; asla tahmin edilmez.
CREATE TABLE IF NOT EXISTS contacts (
  id           BIGSERIAL PRIMARY KEY,
  company_id   BIGINT      NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  full_name    TEXT,
  title        TEXT,
  email        TEXT,
  phone        TEXT,
  linkedin_url TEXT,
  source       TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, full_name, title)
);

CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts (company_id);

CREATE TABLE IF NOT EXISTS leads (
  id                 BIGSERIAL PRIMARY KEY,
  company_id         BIGINT      NOT NULL UNIQUE REFERENCES companies (id) ON DELETE CASCADE,
  primary_contact_id BIGINT      REFERENCES contacts (id) ON DELETE SET NULL,
  status             TEXT        NOT NULL DEFAULT 'discovered'
                       CHECK (status IN ('discovered', 'analyzed', 'scored')),
  discovered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);

CREATE TABLE IF NOT EXISTS website_audits (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT      NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  has_website BOOLEAN     NOT NULL,
  http_status INTEGER,
  final_url   TEXT,
  checks      JSONB       NOT NULL,
  raw_signals JSONB       NOT NULL,
  score       INTEGER     NOT NULL,
  confidence  TEXT        NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  notes       TEXT
);

CREATE INDEX IF NOT EXISTS idx_website_audits_company ON website_audits (company_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS social_audits (
  id             BIGSERIAL PRIMARY KEY,
  company_id     BIGINT      NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  platform       TEXT        NOT NULL,
  handle         TEXT,
  profile_url    TEXT,
  resolved       BOOLEAN,
  signals        JSONB       NOT NULL,
  data_available JSONB       NOT NULL,
  score          INTEGER,
  confidence     TEXT        NOT NULL CHECK (confidence IN ('none', 'low', 'medium', 'high'))
);

CREATE INDEX IF NOT EXISTS idx_social_audits_company ON social_audits (company_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS lead_scores (
  id                      BIGSERIAL PRIMARY KEY,
  lead_id                 BIGINT      NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  website_score           INTEGER     NOT NULL,
  social_score            INTEGER,
  business_potential      INTEGER     NOT NULL,
  digital_gap             INTEGER     NOT NULL,
  estimated_buying_intent INTEGER     NOT NULL,
  purchase_score          INTEGER     NOT NULL,
  priority                TEXT        NOT NULL CHECK (priority IN ('HOT', 'HIGH', 'MEDIUM', 'LOW')),
  breakdown               JSONB       NOT NULL,
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_scores_lead     ON lead_scores (lead_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_scores_purchase ON lead_scores (purchase_score DESC);

CREATE TABLE IF NOT EXISTS offer_recommendations (
  id           BIGSERIAL PRIMARY KEY,
  lead_id      BIGINT      NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  offer_code   TEXT        NOT NULL CHECK (offer_code IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')),
  offer_label  TEXT        NOT NULL,
  rationale    TEXT        NOT NULL,
  digital_gaps JSONB       NOT NULL,
  confidence   TEXT        NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offers_lead ON offer_recommendations (lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_runs (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT        NOT NULL CHECK (kind IN ('discover', 'audit', 'score', 'pipeline')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  stats       JSONB
);
