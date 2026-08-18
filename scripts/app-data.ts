import { loadEnv } from '../src/lib/env';

loadEnv();

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initSchema, closeDb, getDb, parseJson } from '../src/lib/db/client';
import { buildBrief } from '../src/lib/brief';
import type { AuditCheck } from '../src/lib/types';

/**
 * Telefonda kullanilacak surumun verisini uretir.
 *
 * Arastirma verisi (lead'ler, denetimler, skorlar) SALT OKUNUR gomulur;
 * satis durumu sayfanin kendi icinde tutulur. Boylece bu dosya yalnizca
 * "ne bulduk" bilgisini tasir, "ne yaptik" bilgisini degil.
 */

const SQL = `
  WITH latest_score AS (
    SELECT s.* FROM lead_scores s
    JOIN (SELECT lead_id, MAX(id) AS id FROM lead_scores GROUP BY lead_id) m ON m.id = s.id
  ),
  latest_offer AS (
    SELECT o.* FROM offer_recommendations o
    JOIN (SELECT lead_id, MAX(id) AS id FROM offer_recommendations GROUP BY lead_id) m ON m.id = o.id
  ),
  latest_audit AS (
    SELECT w.* FROM website_audits w
    JOIN (SELECT company_id, MAX(id) AS id FROM website_audits GROUP BY company_id) m ON m.id = w.id
  ),
  best_social AS (
    SELECT company_id, profile_url, handle, platform, score,
           ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY score DESC NULLS LAST, id DESC) AS rn
    FROM social_audits
  )
  SELECT
    l.id AS lead_id, c.name, c.segment, c.location_district AS district,
    c.phone, c.website, c.rating, c.review_count,
    c.google_place_id, c.maps_uri,
    a.score AS website_score, a.status AS website_status, a.reason AS website_reason,
    a.manual_review, a.checks,
    bs.score AS social_score, bs.profile_url AS social_url, bs.handle AS social_handle,
    bs.platform AS social_platform,
    s.purchase_score, s.priority, s.business_potential, s.digital_gap,
    s.estimated_buying_intent, s.breakdown,
    o.offer_code, o.offer_label, o.rationale, o.digital_gaps
  FROM leads l
  JOIN companies c ON c.id = l.company_id
  LEFT JOIN latest_score s ON s.lead_id = l.id
  LEFT JOIN latest_offer o ON o.lead_id = l.id
  LEFT JOIN latest_audit a ON a.company_id = c.id
  LEFT JOIN best_social bs ON bs.company_id = c.id AND bs.rn = 1
  ORDER BY s.purchase_score DESC NULLS LAST, c.name ASC
`;

const SEGMENT_LABEL: Record<string, string> = {
  gym: 'Spor salonu',
  boutique_gym: 'Butik salon',
  pilates_studio: 'Pilates stüdyosu',
  crossfit_box: 'CrossFit',
  martial_arts: 'Dövüş sporları',
  personal_training: 'Kişisel antrenman',
  fitness_other: 'Fitness',
};

function mapsUrl(r: Record<string, unknown>): string {
  if (r.maps_uri) return String(r.maps_uri);
  const name = encodeURIComponent(String(r.name));
  if (r.google_place_id) {
    return `https://www.google.com/maps/search/?api=1&query=${name}&query_place_id=${encodeURIComponent(String(r.google_place_id))}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${name}%20${encodeURIComponent(String(r.district ?? ''))}`;
}

function main(): void {
  const out = process.argv[2];
  if (!out) {
    console.error('Kullanım: tsx scripts/app-data.ts <çıktı.json>');
    process.exitCode = 1;
    return;
  }

  initSchema();
  const rows = getDb().prepare(SQL).all() as Record<string, unknown>[];

  const leads = rows.map((r) => {
    const checks = parseJson<AuditCheck[]>(r.checks as string, []);

    // Arama brifingi rapor, dashboard ve bu uygulama icin AYNI fonksiyondan
    // uretilir — uc yerde farkli tavsiye cikamaz.
    const brief = buildBrief({
      name: r.name as string,
      segment: (r.segment as string) ?? null,
      district: (r.district as string) ?? null,
      rating: (r.rating as number) ?? null,
      reviewCount: (r.review_count as number) ?? null,
      hasWebsite: Boolean(r.website),
      websiteScore: (r.website_score as number) ?? null,
      websiteStatus: String(r.website_status ?? 'ok'),
      websiteReason: (r.website_reason as string) ?? null,
      socialScore: (r.social_score as number) ?? null,
      socialUrl: (r.social_url as string) ?? null,
      offerLabel: (r.offer_label as string) ?? null,
      offerRationale: (r.rationale as string) ?? null,
      checks,
    });
    const breakdown = parseJson<Record<string, unknown>>(r.breakdown as string, {});
    const intent = (breakdown.buyingIntentComponents as { value: number | null; weight: number; detail: string }[] ?? [])
      .filter((c) => c.value !== null)
      .sort((a, b) => (b.value as number) * b.weight - (a.value as number) * a.weight)[0];

    return {
      id: r.lead_id as number,
      name: r.name as string,
      seg: SEGMENT_LABEL[String(r.segment)] ?? (r.segment as string) ?? '—',
      dist: (r.district as string) ?? null,
      tel: (r.phone as string) ?? null,
      web: (r.website as string) ?? null,
      maps: mapsUrl(r),
      rating: (r.rating as number) ?? null,
      reviews: (r.review_count as number) ?? null,
      ws: (r.website_score as number) ?? null,
      wstat: (r.website_status as string) ?? 'ok',
      wreason: (r.website_reason as string) ?? null,
      manual: r.manual_review === 1,
      ss: (r.social_score as number) ?? null,
      surl: (r.social_url as string) ?? null,
      shandle: (r.social_handle as string) ?? null,
      splat: (r.social_platform as string) ?? null,
      ps: (r.purchase_score as number) ?? null,
      pri: (r.priority as string) ?? null,
      pot: (r.business_potential as number) ?? null,
      gap: (r.digital_gap as number) ?? null,
      intent: (r.estimated_buying_intent as number) ?? null,
      why: intent?.detail ?? null,
      oc: (r.offer_code as string) ?? null,
      ol: (r.offer_label as string) ?? null,
      rat: (r.rationale as string) ?? null,
      // Arama brifingi — "bu isletmeyi arayinca ne yapacagim".
      brief: {
        h: brief.headline,
        o: brief.opening,
        f: brief.findings,
        p: brief.pitch,
        q: brief.questions,
        c: brief.cautions,
      },
      // Gecen kontroller: "sitenizde su var" demek icin.
      ok: checks.filter((c) => c.passed === true).map((c) => c.label).slice(0, 6),
    };
  });

  writeFileSync(resolve(out), JSON.stringify({ leads, generatedAt: new Date().toISOString() }));
  console.log(`[app-data] ${out} — ${leads.length} lead`);
}

try {
  main();
} catch (err) {
  console.error(`[app-data] HATA: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  closeDb();
}
