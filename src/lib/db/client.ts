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

/** Semayi uygular. Idempotent — her tablo CREATE TABLE IF NOT EXISTS. */
export function initSchema(): void {
  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  getDb().exec(sql);
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
