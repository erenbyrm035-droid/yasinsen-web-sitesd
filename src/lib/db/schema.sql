-- VIVA SALES ENGINE — SQLite semasi (MVP)
-- Postgres/Supabase karsiligi: supabase/migrations/0001_init.sql
--
-- Tasarim kurallari:
--   * Erisilemeyen her alan NULL kalir. Hicbir deger tahmin edilmez.
--   * (source, source_ref) UNIQUE -> pipeline idempotent, tekrar calistirmak
--     kayit cogaltmaz.
--   * Butun JSON alanlari TEXT olarak saklanir (SQLite'ta native JSON yok).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- companies — kesfedilen isletmeler
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  website           TEXT,             -- NULL = site bulunamadi (satis sinyali)
  domain            TEXT,
  location_city     TEXT,
  location_district TEXT,
  lat               REAL,
  lon               REAL,
  industry          TEXT,             -- 'Fitness & Gym', 'Pilates', ...
  segment           TEXT,             -- 'boutique_gym', 'pilates_studio', ...
  employee_count    INTEGER,          -- NULL = bilinmiyor (OSM bu veriyi vermez)
  phone             TEXT,
  rating            REAL,             -- Google puani (yalnizca Places kaynagi)
  review_count      INTEGER,          -- yorum sayisi — gercek musteri hacmi sinyali
  source            TEXT    NOT NULL, -- 'osm' | 'apollo'
  source_ref        TEXT    NOT NULL, -- 'node/2585358357' | apollo org id
  raw               TEXT,             -- JSON: kaynak kaydin ham hali
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, source_ref)
);

CREATE INDEX IF NOT EXISTS idx_companies_domain   ON companies (domain);
CREATE INDEX IF NOT EXISTS idx_companies_district ON companies (location_district);

-- ---------------------------------------------------------------------------
-- contacts — karar vericiler
-- E-posta bulunamazsa NULL birakilir; asla tahmin edilmez.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  full_name    TEXT,
  title        TEXT,              -- 'Owner', 'Founder', 'General Manager', ...
  email        TEXT,              -- NULL = bulunamadi
  phone        TEXT,
  linkedin_url TEXT,
  source       TEXT NOT NULL,     -- 'apollo' | 'website' | 'manual'
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, full_name, title)
);

CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts (company_id);

-- ---------------------------------------------------------------------------
-- leads — sirket + karar verici birlesimi, pipeline durumu
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER NOT NULL UNIQUE REFERENCES companies (id) ON DELETE CASCADE,
  primary_contact_id INTEGER REFERENCES contacts (id) ON DELETE SET NULL,
  status             TEXT    NOT NULL DEFAULT 'discovered'
                       CHECK (status IN ('discovered', 'analyzed', 'scored')),
  discovered_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);

-- ---------------------------------------------------------------------------
-- website_audits — her denetim bir satir (gecmis korunur)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS website_audits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  fetched_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  has_website  INTEGER NOT NULL,  -- 0/1
  http_status  INTEGER,           -- NULL = istek hic tamamlanmadi
  final_url    TEXT,
  checks       TEXT    NOT NULL,  -- JSON: [{ key, label, passed, evidence, weight }]
  raw_signals  TEXT    NOT NULL,  -- JSON: olculen ham degerler
  score        INTEGER NOT NULL,  -- 0-100
  confidence   TEXT    NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_website_audits_company ON website_audits (company_id, fetched_at DESC);

-- ---------------------------------------------------------------------------
-- social_audits — platform basina bir satir
-- Olculemeyen metrikler (takipci, etkilesim...) data_available icinde
-- false olarak isaretlenir ve NULL kalir.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_audits (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  fetched_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  platform       TEXT    NOT NULL,  -- 'instagram' | 'facebook' | 'youtube' | 'tiktok'
  handle         TEXT,
  profile_url    TEXT,
  resolved       INTEGER,           -- 1 = profil URL'i 200 dondu, 0 = 404, NULL = kontrol edilemedi
  signals        TEXT    NOT NULL,  -- JSON: olculebilen sinyaller
  data_available TEXT    NOT NULL,  -- JSON: { followers: false, post_frequency: false, ... }
  score          INTEGER,           -- 0-100, hic sinyal yoksa NULL
  confidence     TEXT    NOT NULL CHECK (confidence IN ('none', 'low', 'medium', 'high'))
);

CREATE INDEX IF NOT EXISTS idx_social_audits_company ON social_audits (company_id, fetched_at DESC);

-- ---------------------------------------------------------------------------
-- social_manual_inputs — elle girilen sosyal medya metrikleri
--
-- Instagram public profilleri login duvarinin arkasinda oldugu icin takipci,
-- etkilesim ve icerik metrikleri otomatik olculemiyor. Bu tablo, dashboard'dan
-- ELLE girilen degerleri tutar ve girilen alanlar sosyal skoru tam rubrikle
-- hesaplatir.
--
-- Denetim tablolarindan AYRI durur: `npm run audit` tekrar calistiginda
-- silinmez. Her alan NULL olabilir — yalnizca girilenler hesaba katilir.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_manual_inputs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  platform           TEXT    NOT NULL,
  followers          INTEGER,  -- takipci sayisi
  posts_last_30d     INTEGER,  -- son 30 gunde paylasim sayisi
  reels_last_30d     INTEGER,  -- son 30 gunde Reels/video sayisi
  avg_likes          INTEGER,  -- son gonderilerin ortalama begenisi
  visual_quality     INTEGER CHECK (visual_quality BETWEEN 1 AND 5),   -- 1-5 elle degerlendirme
  sales_content      INTEGER CHECK (sales_content BETWEEN 1 AND 5),    -- satisa yonelik icerik yogunlugu
  bio_has_website    INTEGER,  -- 0/1 bio'da site linki var mi
  bio_has_contact    INTEGER,  -- 0/1 bio'da iletisim bilgisi var mi
  note               TEXT,
  entered_by         TEXT,
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_social_manual_company ON social_manual_inputs (company_id);

-- ---------------------------------------------------------------------------
-- lead_scores — hesaplanan skorlar (formuller: docs/SCORING.md)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_scores (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id                INTEGER NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  website_score          INTEGER NOT NULL,
  social_score           INTEGER,          -- NULL = olculebilir sosyal sinyal yok
  business_potential     INTEGER NOT NULL,
  digital_gap            INTEGER NOT NULL,
  estimated_buying_intent INTEGER NOT NULL,
  purchase_score         INTEGER NOT NULL, -- 0-100
  priority               TEXT    NOT NULL CHECK (priority IN ('HOT', 'HIGH', 'MEDIUM', 'LOW')),
  breakdown              TEXT    NOT NULL, -- JSON: her bilesenin katkisi + modifierlar
  computed_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lead_scores_lead     ON lead_scores (lead_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_scores_purchase ON lead_scores (purchase_score DESC);

-- ---------------------------------------------------------------------------
-- offer_recommendations — hangi hizmet satilmali
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS offer_recommendations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id      INTEGER NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  offer_code   TEXT    NOT NULL CHECK (offer_code IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')),
  offer_label  TEXT    NOT NULL,
  rationale    TEXT    NOT NULL,  -- audit kanitlarindan uretilen gerekce
  digital_gaps TEXT    NOT NULL,  -- JSON: string[]
  confidence   TEXT    NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_offers_lead ON offer_recommendations (lead_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- audit_runs — izlenebilirlik
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('discover', 'audit', 'score', 'pipeline')),
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  stats       TEXT   -- JSON
);
