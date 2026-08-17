import { getDb } from '../client';
import type { DiscoveredCompany, DiscoveredContact } from '../../types';

export interface CompanyRow {
  id: number;
  name: string;
  website: string | null;
  domain: string | null;
  location_city: string | null;
  location_district: string | null;
  lat: number | null;
  lon: number | null;
  industry: string | null;
  segment: string | null;
  employee_count: number | null;
  phone: string | null;
  rating: number | null;
  review_count: number | null;
  source: string;
  source_ref: string;
  raw: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactRow {
  id: number;
  company_id: number;
  full_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  source: string;
  created_at: string;
}

/**
 * Kaynak kaydi upsert eder. (source, source_ref) benzersiz oldugu icin
 * pipeline'i tekrar calistirmak kayit cogaltmaz — mevcut satir guncellenir.
 *
 * Guncellemede COALESCE kullaniliyor: yeni kayitta bir alan null ise eski
 * (muhtemelen elle girilmis) deger korunur.
 */
export function upsertCompany(c: DiscoveredCompany): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO companies (
      name, website, domain, location_city, location_district, lat, lon,
      industry, segment, employee_count, phone, rating, review_count,
      source, source_ref, raw
    ) VALUES (
      @name, @website, @domain, @city, @district, @lat, @lon,
      @industry, @segment, @employeeCount, @phone, @rating, @reviewCount,
      @source, @sourceRef, @raw
    )
    ON CONFLICT (source, source_ref) DO UPDATE SET
      name              = excluded.name,
      rating            = COALESCE(excluded.rating, companies.rating),
      review_count      = COALESCE(excluded.review_count, companies.review_count),
      website           = COALESCE(excluded.website, companies.website),
      domain            = COALESCE(excluded.domain, companies.domain),
      location_city     = COALESCE(excluded.location_city, companies.location_city),
      location_district = COALESCE(excluded.location_district, companies.location_district),
      lat               = COALESCE(excluded.lat, companies.lat),
      lon               = COALESCE(excluded.lon, companies.lon),
      industry          = COALESCE(excluded.industry, companies.industry),
      segment           = excluded.segment,
      employee_count    = COALESCE(excluded.employee_count, companies.employee_count),
      phone             = COALESCE(excluded.phone, companies.phone),
      raw               = excluded.raw,
      updated_at        = datetime('now')
    RETURNING id
  `);

  const row = stmt.get({
    name: c.name,
    website: c.website,
    domain: c.domain,
    city: c.locationCity,
    district: c.locationDistrict,
    lat: c.lat,
    lon: c.lon,
    industry: c.industry,
    segment: c.segment,
    employeeCount: c.employeeCount,
    phone: c.phone,
    rating: c.rating,
    reviewCount: c.reviewCount,
    source: c.source,
    sourceRef: c.sourceRef,
    raw: JSON.stringify(c.raw ?? null),
  }) as { id: number };

  return row.id;
}

/**
 * Karar vericiyi kaydeder. E-postasi olmayan kayit da saklanir —
 * eksik e-posta asla uretilmez, NULL kalir.
 */
export function upsertContact(companyId: number, contact: DiscoveredContact): number {
  const db = getDb();
  const row = db
    .prepare(
      `INSERT INTO contacts (company_id, full_name, title, email, phone, linkedin_url, source)
       VALUES (@companyId, @fullName, @title, @email, @phone, @linkedinUrl, @source)
       ON CONFLICT (company_id, full_name, title) DO UPDATE SET
         email        = COALESCE(excluded.email, contacts.email),
         phone        = COALESCE(excluded.phone, contacts.phone),
         linkedin_url = COALESCE(excluded.linkedin_url, contacts.linkedin_url)
       RETURNING id`,
    )
    .get({
      companyId,
      fullName: contact.fullName,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      linkedinUrl: contact.linkedinUrl,
      source: contact.source,
    }) as { id: number };

  return row.id;
}

export function getCompany(id: number): CompanyRow | undefined {
  return getDb().prepare('SELECT * FROM companies WHERE id = ?').get(id) as CompanyRow | undefined;
}

export function listCompanies(limit?: number): CompanyRow[] {
  const db = getDb();
  return limit === undefined
    ? (db.prepare('SELECT * FROM companies ORDER BY id').all() as CompanyRow[])
    : (db.prepare('SELECT * FROM companies ORDER BY id LIMIT ?').all(limit) as CompanyRow[]);
}

export function countCompanies(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM companies').get() as { n: number };
  return row.n;
}

export function listContacts(companyId: number): ContactRow[] {
  return getDb()
    .prepare('SELECT * FROM contacts WHERE company_id = ? ORDER BY id')
    .all(companyId) as ContactRow[];
}
