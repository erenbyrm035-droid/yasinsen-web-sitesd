import { loadEnv } from '../src/lib/env';

loadEnv();

import { initSchema, closeDb, getDb, parseJson } from '../src/lib/db/client';

/**
 * UCTAN UCA DOGRULAMA
 *
 * Aranacak listedeki her lead'i tek tek gosterir ve sistemin kendi
 * kurallarina uyup uymadigini denetler. Amaci "skorlar guzel gorunuyor mu"
 * degil, "bir yeri uydurmus muyuz" sorusunu cevaplamak.
 *
 * Denetlenen degismezler:
 *   1. Olculemeyen website dusuk skor almamali (null olmali)
 *   2. Olculemeyen sosyal dusuk skor almamali (null olmali)
 *   3. Eksik veri tahmin edilmemeli
 *   4. HTTP/challenge/SPA durumlari dogru siniflanmali
 *   5. Aranacak listedeki lead olculmus bir seye dayanmali
 *
 * Kullanim: npx tsx scripts/verify.ts [--limit N]
 */

interface LeadRow {
  lead_id: number;
  company: string;
  phone: string | null;
  website: string | null;
  website_status: string | null;
  website_score: number | null;
  website_confidence: string | null;
  website_reason: string | null;
  manual_review: number | null;
  rating: number | null;
  review_count: number | null;
  purchase_score: number | null;
  digital_gap: number | null;
  business_potential: number | null;
  priority: string | null;
  offer_code: string | null;
  offer_label: string | null;
  company_id: number;
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
    l.id AS lead_id, c.id AS company_id, c.name AS company, c.phone, c.website,
    c.rating, c.review_count,
    a.status AS website_status, a.score AS website_score,
    a.confidence AS website_confidence, a.reason AS website_reason,
    a.manual_review,
    s.website_score AS score_website, s.purchase_score, s.digital_gap,
    s.business_potential, s.priority,
    o.offer_code, o.offer_label
  FROM leads l
  JOIN companies c ON c.id = l.company_id
  LEFT JOIN latest_score s ON s.lead_id = l.id
  LEFT JOIN latest_offer o ON o.lead_id = l.id
  LEFT JOIN latest_audit a ON a.company_id = c.id
  ORDER BY s.purchase_score DESC NULLS LAST, c.name ASC
`;

interface SocialRow {
  platform: string;
  handle: string | null;
  profile_url: string | null;
  score: number | null;
  confidence: string;
  status: string;
}

function socialFor(companyId: number): SocialRow[] {
  const db = getDb();
  const newest = db
    .prepare('SELECT MAX(fetched_at) AS t FROM social_audits WHERE company_id = ?')
    .get(companyId) as { t: string | null };
  if (!newest.t) return [];
  return db
    .prepare('SELECT * FROM social_audits WHERE company_id = ? AND fetched_at = ? ORDER BY score DESC')
    .all(companyId, newest.t) as SocialRow[];
}

const STATUS_LABEL: Record<string, string> = {
  ok: 'denetlendi',
  no_website: 'site yok',
  unreachable: 'ulaşılamadı',
  blocked: 'bot koruması',
  unrendered: 'JS ile render',
};

function fmt(v: unknown, dash = '—'): string {
  return v === null || v === undefined || v === '' ? dash : String(v);
}

// --- degismez denetimleri ---------------------------------------------------

interface Violation {
  lead: string;
  rule: string;
  detail: string;
}

function checkInvariants(rows: LeadRow[]): Violation[] {
  const bad: Violation[] = [];

  for (const r of rows) {
    const socials = socialFor(r.company_id);
    const measured = r.website_status === 'ok' || r.website_status === 'no_website';

    // 1. Olculemeyen website skor almamali
    if (!measured && r.website_score !== null) {
      bad.push({
        lead: r.company,
        rule: 'Ölçülemeyen website skor aldı',
        detail: `status=${r.website_status} ama score=${r.website_score}`,
      });
    }

    // 1b. Olculemeyen website 'none' disinda guven tasiyamaz
    if (!measured && r.website_confidence !== 'none') {
      bad.push({
        lead: r.company,
        rule: 'Ölçülemeyen website güven taşıyor',
        detail: `status=${r.website_status}, confidence=${r.website_confidence}`,
      });
    }

    // 1c. Olculemeyen website elle incelemeye dusmeli
    if (!measured && r.manual_review !== 1) {
      bad.push({
        lead: r.company,
        rule: 'Ölçülemeyen website elle incelemeye düşmedi',
        detail: `status=${r.website_status}, manual_review=${r.manual_review}`,
      });
    }

    // 1d. Denetlenmis site elle incelemeye DUSMEMELI
    if (r.website_status === 'ok' && r.manual_review === 1) {
      bad.push({
        lead: r.company,
        rule: 'Denetlenmiş site gereksiz yere elle incelemede',
        detail: 'status=ok ama manual_review=1',
      });
    }

    // 2. Olculemeyen sosyal dusuk skor almamali
    for (const s of socials) {
      if (s.confidence === 'none' && s.score !== null) {
        bad.push({
          lead: r.company,
          rule: 'Ölçülemeyen sosyal skor aldı',
          detail: `${s.platform}: confidence=none ama score=${s.score}`,
        });
      }
    }

    // 3. Sosyal profil yoksa sosyal skor uretilmemeli
    if (socials.length === 0) {
      const scoreRow = getDb()
        .prepare('SELECT social_score FROM lead_scores WHERE lead_id = ? ORDER BY id DESC LIMIT 1')
        .get(r.lead_id) as { social_score: number | null } | undefined;
      if (scoreRow && scoreRow.social_score !== null) {
        bad.push({
          lead: r.company,
          rule: 'Profil yokken sosyal skor üretildi',
          detail: `social_score=${scoreRow.social_score}`,
        });
      }
    }

    // 4. Kaydedilen profil dogrulanmis olmali (tahmin yok)
    for (const s of socials) {
      if (!['on_site', 'verified', 'manual'].includes(s.status)) {
        bad.push({
          lead: r.company,
          rule: 'Doğrulanmamış sosyal profil kaydedilmiş',
          detail: `${s.platform}: status=${s.status}`,
        });
      }
    }

    // 5. Website yoksa skor 0 ve guven yuksek olmali (gercek bulgu)
    if (r.website_status === 'no_website' && (r.website_score !== 0 || r.website_confidence !== 'high')) {
      bad.push({
        lead: r.company,
        rule: '"Website yok" bulgusu yanlış kodlanmış',
        detail: `score=${r.website_score}, confidence=${r.website_confidence}`,
      });
    }

    // 6. Gerekce zorunlu: olculemeyen her lead nedenini tasimali
    if (!measured && !r.website_reason) {
      bad.push({ lead: r.company, rule: 'Ölçülememe gerekçesi boş', detail: `status=${r.website_status}` });
    }
  }

  return bad;
}

/** Aranacak listedeki lead gercekten olculmus bir seye dayaniyor mu. */
function checkCallListEvidence(rows: LeadRow[]): Violation[] {
  return rows
    .filter((r) => r.priority === 'HOT' || r.priority === 'HIGH')
    .filter((r) => {
      const measuredWebsite = r.website_status === 'ok' || r.website_status === 'no_website';
      const hasSocial = socialFor(r.company_id).some((s) => s.score !== null);
      return !measuredWebsite && !hasSocial;
    })
    .map((r) => ({
      lead: r.company,
      rule: 'Aranacak listede ama hiçbir dijital ölçüm yok',
      detail: `status=${r.website_status}, sosyal profil yok`,
    }));
}

// --- cikti ------------------------------------------------------------------

function printLead(r: LeadRow, index: number): void {
  const socials = socialFor(r.company_id);
  const best = socials.find((s) => s.score !== null) ?? socials[0] ?? null;

  const websiteScoreText =
    r.website_status === 'ok'
      ? `${r.website_score}/100 (güven: ${r.website_confidence})`
      : r.website_status === 'no_website'
        ? '0/100 — site yok (gerçek bulgu)'
        : `ÖLÇÜLEMEDİ — ${r.website_reason}`;

  const socialText = best
    ? `${best.platform} @${fmt(best.handle)} — ${best.score === null ? 'ölçülemedi' : `${best.score}/100`} ` +
      `(güven: ${best.confidence}, kaynak: ${best.status})`
    : 'profil bulunamadı — arama katmanı kapalı, tahmin üretilmedi';

  console.log(`\n${'─'.repeat(78)}`);
  console.log(`${String(index).padStart(2)}. ${r.company}`);
  console.log(`${'─'.repeat(78)}`);
  console.log(`  Telefon              ${fmt(r.phone, 'veri yok')}`);
  console.log(`  Website              ${fmt(r.website, 'yok')}`);
  console.log(`  Website durumu       ${STATUS_LABEL[r.website_status ?? ''] ?? fmt(r.website_status)}`);
  console.log(`  Website skoru        ${websiteScoreText}`);
  console.log(`  Sosyal profil        ${socialText}`);
  console.log(`  Google puanı         ${fmt(r.rating, 'veri yok')}`);
  console.log(`  Yorum sayısı         ${fmt(r.review_count, 'veri yok')}`);
  console.log(`  Purchase score       ${fmt(r.purchase_score)}/100`);
  console.log(`  Öncelik              ${fmt(r.priority)}`);
  console.log(`  Önerilen hizmet      ${fmt(r.offer_code)} — ${fmt(r.offer_label)}`);
  console.log(`  Elle inceleme        ${r.manual_review === 1 ? 'EVET' : 'hayır'}`);
}

function main(): void {
  initSchema();
  const all = getDb().prepare(SQL).all() as LeadRow[];
  const callList = all.filter((r) => r.priority === 'HOT' || r.priority === 'HIGH');

  console.log('═'.repeat(78));
  console.log('  UÇTAN UCA DOĞRULAMA — aranacak liste');
  console.log('═'.repeat(78));
  console.log(`\n${callList.length} lead HOT/HIGH önceliğinde (toplam ${all.length} lead içinden).`);

  callList.forEach((r, i) => printLead(r, i + 1));

  // --- degismezler --------------------------------------------------------
  console.log(`\n${'═'.repeat(78)}`);
  console.log('  DEĞİŞMEZ DENETİMİ — tüm 100 lead üzerinde');
  console.log('═'.repeat(78));

  const violations = [...checkInvariants(all), ...checkCallListEvidence(all)];

  const RULES = [
    'Ölçülemeyen website düşük skor almasın',
    'Ölçülemeyen sosyal düşük skor almasın',
    'Eksik veri tahmin edilmesin',
    'Ölçülemeyen lead elle incelemeye düşsün',
    'Aranacak listedeki lead ölçülmüş bir şeye dayansın',
  ];
  for (const rule of RULES) {
    console.log(`  ${violations.length === 0 ? '✓' : '·'} ${rule}`);
  }

  if (violations.length > 0) {
    console.log(`\n  ${violations.length} İHLAL:`);
    for (const v of violations) {
      console.log(`    ✗ ${v.lead} — ${v.rule}: ${v.detail}`);
    }
  } else {
    console.log('\n  İhlal yok.');
  }

  // --- siniflandirma dagilimi ---------------------------------------------
  console.log(`\n${'═'.repeat(78)}`);
  console.log('  SINIFLANDIRMA DAĞILIMI');
  console.log('═'.repeat(78));
  const byStatus = new Map<string, number>();
  for (const r of all) {
    const k = r.website_status ?? 'bilinmiyor';
    byStatus.set(k, (byStatus.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...byStatus].sort((a, b) => b[1] - a[1])) {
    const scored = all.filter((r) => r.website_status === k && r.website_score !== null).length;
    console.log(
      `  ${(STATUS_LABEL[k] ?? k).padEnd(16)} ${String(v).padStart(3)} lead — ` +
        `${scored} tanesine website skoru verildi`,
    );
  }

  // --- ilk 10 -------------------------------------------------------------
  console.log(`\n${'═'.repeat(78)}`);
  console.log('  EN YÜKSEK SATIN ALMA POTANSİYELİ — İLK 10');
  console.log('═'.repeat(78));
  console.log(
    `\n  ${'#'.padEnd(4)}${'İşletme'.padEnd(34)}${'Telefon'.padEnd(19)}` +
      `${'Purchase'.padEnd(10)}${'Öncelik'.padEnd(9)}Hizmet`,
  );
  console.log(`  ${'─'.repeat(88)}`);
  all.slice(0, 10).forEach((r, i) => {
    console.log(
      `  ${String(i + 1).padEnd(4)}${r.company.slice(0, 32).padEnd(34)}` +
        `${fmt(r.phone, 'veri yok').padEnd(19)}${String(fmt(r.purchase_score)).padEnd(10)}` +
        `${fmt(r.priority).padEnd(9)}${fmt(r.offer_label)}`,
    );
  });

  console.log(
    `\n  Bu liste yalnızca araştırma çıktısıdır. Hiçbir işletmeye mesaj ` +
      `gönderilmedi,\n  e-posta atılmadı, Apollo'da kayıt oluşturulmadı.\n`,
  );

  if (violations.length > 0) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error(`[verify] HATA: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  closeDb();
}
