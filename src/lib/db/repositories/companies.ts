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
  google_place_id: string | null;
  maps_uri: string | null;
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
/** Kaynak + kaynak referansiyla birebir eslesen kayit. */
export function getCompanyBySourceRef(source: string, sourceRef: string): CompanyRow | undefined {
  return getDb()
    .prepare('SELECT * FROM companies WHERE source = ? AND source_ref = ?')
    .get(source, sourceRef) as CompanyRow | undefined;
}

/** Turkce karakterleri katlayip yalnizca harf/rakam birakir. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/İ/g, 'i').replace(/ş/g, 's')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Son 10 hane: 0212..., +90212..., 212... hepsi ayni numaraya iner.
  return digits.slice(-10);
}

/**
 * MUKERRER KONTROLU
 *
 * Ayni isletme farkli kaynaklardan (OSM ve Places) ya da degismis bir
 * source_ref ile tekrar gelebilir. Kimlik sirasi guclu -> zayif:
 *
 *   1. kaynak + kaynak referansi (Google Place ID dahil) — kesin
 *   2. website alan adi                                  — cok guclu
 *   3. telefon (son 10 hane)                             — guclu
 *   4. normalize edilmis isim + ilce                     — zayif, ilce sarti sart
 *
 * 4. adimda ilce sarti bilincli: "Fit Life" adinda iki ayri salon farkli
 * ilcelerde olabilir ve bunlari birlestirmek gercek bir lead'i yok ederdi.
 */
export function findDuplicateCompany(c: DiscoveredCompany): CompanyRow | undefined {
  const db = getDb();

  const exact = getCompanyBySourceRef(c.source, c.sourceRef);
  if (exact) return exact;

  // Google Place ID: farkli kaynaklar arasinda da gecerli, en guclu kimlik.
  if (c.googlePlaceId) {
    const byPlaceId = db
      .prepare('SELECT * FROM companies WHERE google_place_id = ?')
      .get(c.googlePlaceId) as CompanyRow | undefined;
    if (byPlaceId) return byPlaceId;
  }

  if (c.domain) {
    const byDomain = db.prepare('SELECT * FROM companies WHERE domain = ?').get(c.domain) as
      | CompanyRow
      | undefined;
    if (byDomain) return byDomain;
  }

  if (c.phone) {
    const phone = normalizePhone(c.phone);
    if (phone.length === 10) {
      const rows = db
        .prepare("SELECT * FROM companies WHERE phone IS NOT NULL AND phone <> ''")
        .all() as CompanyRow[];
      const byPhone = rows.find((r) => r.phone && normalizePhone(r.phone) === phone);
      if (byPhone) return byPhone;
    }
  }

  if (c.locationDistrict) {
    const name = normalizeName(c.name);
    const rows = db
      .prepare('SELECT * FROM companies WHERE location_district = ?')
      .all(c.locationDistrict) as CompanyRow[];
    const byName = rows.find((r) => normalizeName(r.name) === name);
    if (byName) return byName;
  }

  return undefined;
}

export function upsertCompany(c: DiscoveredCompany): number {
  const db = getDb();

  /**
   * Farkli bir kaynaktan gelen ayni isletme: yeni satir ACILMAZ, mevcut
   * kayit zenginlestirilir. COALESCE sirasi yeni veriyi one alir ama
   * eksik alanlarda eskiyi korur.
   */
  const duplicate = findDuplicateCompany(c);
  if (duplicate && !(duplicate.source === c.source && duplicate.source_ref === c.sourceRef)) {
    db.prepare(
      `UPDATE companies SET
         website           = COALESCE(@website, website),
         domain            = COALESCE(@domain, domain),
         location_city     = COALESCE(@city, location_city),
         location_district = COALESCE(@district, location_district),
         lat               = COALESCE(@lat, lat),
         lon               = COALESCE(@lon, lon),
         industry          = COALESCE(@industry, industry),
         employee_count    = COALESCE(@employeeCount, employee_count),
         phone             = COALESCE(@phone, phone),
         rating            = COALESCE(@rating, rating),
         review_count      = COALESCE(@reviewCount, review_count),
         google_place_id   = COALESCE(@googlePlaceId, google_place_id),
         maps_uri          = COALESCE(@mapsUri, maps_uri),
         updated_at        = datetime('now')
       WHERE id = @id`,
    ).run({
      id: duplicate.id,
      website: c.website, domain: c.domain, city: c.locationCity,
      district: c.locationDistrict, lat: c.lat, lon: c.lon,
      industry: c.industry, employeeCount: c.employeeCount, phone: c.phone,
      rating: c.rating, reviewCount: c.reviewCount,
      googlePlaceId: c.googlePlaceId, mapsUri: c.mapsUri,
    });
    return duplicate.id;
  }
  const stmt = db.prepare(`
    INSERT INTO companies (
      name, website, domain, location_city, location_district, lat, lon,
      industry, segment, employee_count, phone, rating, review_count,
      google_place_id, maps_uri, source, source_ref, raw
    ) VALUES (
      @name, @website, @domain, @city, @district, @lat, @lon,
      @industry, @segment, @employeeCount, @phone, @rating, @reviewCount,
      @googlePlaceId, @mapsUri, @source, @sourceRef, @raw
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
      google_place_id   = COALESCE(excluded.google_place_id, companies.google_place_id),
      maps_uri          = COALESCE(excluded.maps_uri, companies.maps_uri),
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
    googlePlaceId: c.googlePlaceId,
    mapsUri: c.mapsUri,
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
