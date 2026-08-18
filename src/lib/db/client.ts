import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * SQLite baglantisi. Supabase/Postgres'e gecis bu dosya + repository
 * govdelerinin degistirilmesiyle sinirlidir; cagiran katmanlar etkilenmez.
 */

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'schema.sql');

let db: Database.Database | null = null;

export function dbPath(): string {
  return resolve(process.env.VIVA_DB_PATH ?? './data/viva.db');
}

export function getDb(): Database.Database {
  if (db) return db;

  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });

  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * Sema sonrasi eklenen kolonlar.
 *
 * `CREATE TABLE IF NOT EXISTS` mevcut tabloya yeni kolon eklemez, bu yuzden
 * sonradan gelen alanlar burada idempotent olarak eklenir. Var olan
 * veritabanlari silinmeden guncellenir.
 */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: 'companies', column: 'rating', definition: 'REAL' },
  { table: 'companies', column: 'review_count', definition: 'INTEGER' },
  { table: 'companies', column: 'google_place_id', definition: 'TEXT' },
  { table: 'companies', column: 'maps_uri', definition: 'TEXT' },
  { table: 'website_audits', column: 'status', definition: "TEXT NOT NULL DEFAULT 'ok'" },
  { table: 'website_audits', column: 'reason', definition: 'TEXT' },
  { table: 'website_audits', column: 'manual_review', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'social_audits', column: 'status', definition: "TEXT NOT NULL DEFAULT 'on_site'" },
  { table: 'social_audits', column: 'match_info', definition: 'TEXT' },
  // Satis takibi. leads.status (pipeline) ile karistirilmamali.
  { table: 'leads', column: 'sales_status', definition: "TEXT NOT NULL DEFAULT 'NEW'" },
  { table: 'leads', column: 'last_called_at', definition: 'TEXT' },
  { table: 'leads', column: 'call_count', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'leads', column: 'next_follow_up_at', definition: 'TEXT' },
];

/**
 * Kisit gevsetme goclari.
 *
 * SQLite'ta CHECK ve NOT NULL kisitlari ALTER TABLE ile degistirilemez —
 * tablonun yeniden kurulmasi gerekir. website_audits.score baslangicta
 * NOT NULL idi ve confidence yalnizca low/medium/high kabul ediyordu.
 * Artik "olculemedi" durumunu temsil edebilmek icin ikisi de gevsetildi.
 *
 * Gecmis satirlar KORUNUR: veri kopyalanir, yalnizca kisit degisir.
 */
function relaxLeadScoreConstraints(db: Database.Database): void {
  const table = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'lead_scores'")
    .get() as { sql: string } | undefined;
  if (!table) return;

  const needsRebuild =
    /website_score\s+INTEGER\s+NOT\s+NULL/i.test(table.sql) ||
    /digital_gap\s+INTEGER\s+NOT\s+NULL/i.test(table.sql);
  if (!needsRebuild) return;

  db.exec('PRAGMA foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE lead_scores_new (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id                 INTEGER NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
        website_score           INTEGER,
        social_score            INTEGER,
        business_potential      INTEGER NOT NULL,
        digital_gap             INTEGER,
        estimated_buying_intent INTEGER NOT NULL,
        purchase_score          INTEGER NOT NULL,
        priority                TEXT    NOT NULL CHECK (priority IN ('HOT', 'HIGH', 'MEDIUM', 'LOW')),
        breakdown               TEXT    NOT NULL,
        computed_at             TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`
      INSERT INTO lead_scores_new
        (id, lead_id, website_score, social_score, business_potential, digital_gap,
         estimated_buying_intent, purchase_score, priority, breakdown, computed_at)
      SELECT id, lead_id, website_score, social_score, business_potential, digital_gap,
             estimated_buying_intent, purchase_score, priority, breakdown, computed_at
      FROM lead_scores
    `);
    db.exec('DROP TABLE lead_scores');
    db.exec('ALTER TABLE lead_scores_new RENAME TO lead_scores');
    db.exec('CREATE INDEX IF NOT EXISTS idx_lead_scores_lead ON lead_scores (lead_id, computed_at DESC)');
  })();
  db.exec('PRAGMA foreign_keys = ON');
}

function relaxWebsiteAuditConstraints(db: Database.Database): void {
  const table = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'website_audits'")
    .get() as { sql: string } | undefined;
  if (!table) return;

  const needsRebuild =
    /score\s+INTEGER\s+NOT\s+NULL/i.test(table.sql) ||
    !/confidence[^)]*'none'/i.test(table.sql);
  if (!needsRebuild) return;

  const columns = (db.prepare('PRAGMA table_info(website_audits)').all() as { name: string }[]).map(
    (c) => c.name,
  );
  const shared = [
    'id',
    'company_id',
    'fetched_at',
    'has_website',
    'http_status',
    'final_url',
    'checks',
    'raw_signals',
    'score',
    'confidence',
    'notes',
  ].filter((c) => columns.includes(c));

  db.exec('PRAGMA foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE website_audits_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id    INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
        fetched_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        has_website   INTEGER NOT NULL,
        http_status   INTEGER,
        final_url     TEXT,
        checks        TEXT    NOT NULL,
        raw_signals   TEXT    NOT NULL,
        score         INTEGER,
        confidence    TEXT    NOT NULL CHECK (confidence IN ('none', 'low', 'medium', 'high')),
        status        TEXT    NOT NULL DEFAULT 'ok',
        reason        TEXT,
        manual_review INTEGER NOT NULL DEFAULT 0,
        notes         TEXT
      )
    `);
    db.exec(
      `INSERT INTO website_audits_new (${shared.join(', ')}) SELECT ${shared.join(', ')} FROM website_audits`,
    );
    db.exec('DROP TABLE website_audits');
    db.exec('ALTER TABLE website_audits_new RENAME TO website_audits');
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_website_audits_company ON website_audits (company_id, fetched_at DESC)',
    );
  })();
  db.exec('PRAGMA foreign_keys = ON');
}

function applyAddedColumns(db: Database.Database): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.length === 0) continue; // tablo yok — sema henuz uygulanmamis
    if (columns.some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** Semayi uygular. Idempotent — her tablo CREATE TABLE IF NOT EXISTS. */
export function initSchema(): void {
  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  const db = getDb();
  db.exec(sql);
  relaxWebsiteAuditConstraints(db);
  relaxLeadScoreConstraints(db);
  applyAddedColumns(db);
}

/** Veritabani dosyasi olusturulmus mu (dashboard'in bos durumu ayirt etmesi icin). */
export function dbExists(): boolean {
  return existsSync(dbPath());
}

export function closeDb(): void {
  db?.close();
  db = null;
}

/** JSON kolonlarini guvenli okuma — bozuk satir tum sayfayi dusurmesin. */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
