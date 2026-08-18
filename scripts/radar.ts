import { loadEnv } from '../src/lib/env';

loadEnv();

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initSchema, closeDb, getDb, parseJson } from '../src/lib/db/client';

/**
 * Radar sayfasi ureticisi.
 *
 * Veritabanindan tek dosyalik, kendi kendine yeten bir HTML uretir
 * (scratchpad/radar-shell.html kabugu + gomulu JSON). Amaci: pipeline'in
 * sonucunu Next.js sunucusu calistirmadan telefonda/tarayicida acabilmek.
 *
 * Kullanim:
 *   npx tsx scripts/radar.ts <kabuk.html> <cikti.html>
 */

interface Row {
  [key: string]: unknown;
}

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
  )
  SELECT
    l.id AS lead_id, c.id AS company_id, c.name, c.segment, c.location_district,
    c.phone, c.rating, c.review_count, c.website AS site_url,
    s.website_score, s.social_score, s.business_potential, s.digital_gap,
    s.estimated_buying_intent, s.purchase_score, s.priority, s.breakdown,
    o.offer_code, o.offer_label, o.rationale, o.digital_gaps,
    a.status AS website_status, a.reason AS website_reason,
    a.manual_review, a.confidence AS website_confidence, a.checks
  FROM leads l
  JOIN companies c ON c.id = l.company_id
  LEFT JOIN latest_score s ON s.lead_id = l.id
  LEFT JOIN latest_offer o ON o.lead_id = l.id
  LEFT JOIN latest_audit a ON a.company_id = c.id
  ORDER BY s.purchase_score DESC NULLS LAST, c.name ASC
`;

function build(): { stats: Row; cov: Row; leads: Row[] } {
  const db = getDb();
  const rows = db.prepare(SQL).all() as Row[];

  const socialByCompany = new Map<number, Row[]>();
  for (const s of db.prepare('SELECT * FROM social_audits ORDER BY id').all() as Row[]) {
    const id = s.company_id as number;
    if (!socialByCompany.has(id)) socialByCompany.set(id, []);
    socialByCompany.get(id)!.push({
      platform: s.platform,
      handle: s.handle,
      url: s.profile_url,
      score: s.score,
      confidence: s.confidence,
      status: s.status,
    });
  }

  const leads = rows.map((r) => {
    const breakdown = parseJson<Record<string, unknown>>(r.breakdown as string, {});
    const checks = parseJson<{ key: string; label: string; passed: boolean | null; evidence: string }[]>(
      r.checks as string,
      [],
    );
    return {
      lead_id: r.lead_id,
      name: r.name,
      segment: r.segment,
      location_district: r.location_district,
      phone: r.phone,
      rating: r.rating,
      review_count: r.review_count,
      site_url: r.site_url,
      website_score: r.website_score,
      website_status: r.website_status ?? 'ok',
      website_reason: r.website_reason,
      manual_review: r.manual_review === 1,
      social_score: r.social_score,
      business_potential: r.business_potential,
      digital_gap: r.digital_gap,
      estimated_buying_intent: r.estimated_buying_intent,
      purchase_score: r.purchase_score,
      priority: r.priority,
      offer_code: r.offer_code,
      offer_label: r.offer_label,
      rationale: r.rationale,
      digital_gaps: parseJson<string[]>(r.digital_gaps as string, []),
      breakdown: {
        gap: (breakdown.digitalGap as Record<string, unknown>)?.formula ?? null,
        purchase: (breakdown.purchase as Record<string, unknown>)?.formula ?? null,
        intent: (breakdown.buyingIntentComponents as { key: string; value: number | null; weight: number; detail: string }[] ?? [])
          .filter((c) => c.value !== null)
          .map((c) => ({ v: c.value, w: c.weight, d: c.detail })),
        potential: (breakdown.businessPotentialComponents as { value: number | null; weight: number; detail: string }[] ?? [])
          .filter((c) => c.value !== null)
          .map((c) => ({ v: c.value, w: c.weight, d: c.detail })),
      },
      website: {
        passed: checks.filter((c) => c.passed === true).map((c) => c.label),
        failed: checks.filter((c) => c.passed === false).map((c) => c.label),
        unmeasured: checks.filter((c) => c.passed === null).length,
      },
      socials: socialByCompany.get(r.company_id as number) ?? [],
    };
  });

  const count = (fn: (l: (typeof leads)[0]) => boolean) => leads.filter(fn).length;

  return {
    stats: {
      total: leads.length,
      hot: count((l) => l.priority === 'HOT'),
      high: count((l) => l.priority === 'HIGH'),
      medium: count((l) => l.priority === 'MEDIUM'),
      low: count((l) => l.priority === 'LOW'),
      avg: Math.round(
        leads.reduce((s, l) => s + ((l.purchase_score as number) ?? 0), 0) / (leads.length || 1),
      ),
      generatedAt: new Date().toISOString(),
    },
    cov: {
      phone: count((l) => Boolean(l.phone)),
      website: count((l) => Boolean(l.site_url)),
      audited: count((l) => l.website_status === 'ok'),
      noWebsite: count((l) => l.website_status === 'no_website'),
      manualReview: count((l) => l.manual_review === true),
      social: count((l) => (l.socials as unknown[]).length > 0),
      reviews: count((l) => l.review_count != null),
    },
    leads,
  };
}

function main(): void {
  const [shellPath, outPath] = process.argv.slice(2);
  if (!shellPath || !outPath) {
    console.error('Kullanım: tsx scripts/radar.ts <kabuk.html> <çıktı.html>');
    process.exitCode = 1;
    return;
  }

  initSchema();
  const data = build();
  const shell = readFileSync(resolve(shellPath), 'utf8');

  // </script> dizisi gomulu JSON'u erken kapatir — kacilmali.
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');
  writeFileSync(resolve(outPath), shell.replace('__DATA__', json), 'utf8');

  console.log(
    `[radar] ${outPath} — ${data.leads.length} lead, ` +
      `${data.cov.audited} denetlendi, ${data.cov.manualReview} elle inceleme`,
  );
}

try {
  main();
} catch (err) {
  console.error(`[radar] HATA: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  closeDb();
}
