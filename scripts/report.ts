import { loadEnv } from '../src/lib/env';

loadEnv();

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { initSchema, closeDb } from '../src/lib/db/client';
import { listLeadTable, getDashboardStats } from '../src/lib/db/repositories/views';
import type { LeadTableRow } from '../src/lib/db/repositories/views';
import { buildBrief } from '../src/lib/brief';
import { getDb } from '../src/lib/db/client';
import { parseJson } from '../src/lib/db/client';
import type { AuditCheck } from '../src/lib/types';

/**
 * Gunluk rapor uretici.
 *
 * Zamanlanmis calistirmanin ciktisi. Iki dosya yazar:
 *   reports/latest.json  — makine okunur anlik goruntu (bir sonraki calistirma
 *                          bununla karsilastirip DEGISIMI bulur)
 *   reports/latest.md    — insan okunur ozet
 *
 * Asil deger karsilastirmada: "bugun ne degisti" sorusunun cevabi, tam listeyi
 * her gun bastan okumaktan daha kullanislidir.
 */

const REPORTS_DIR = resolve(process.cwd(), 'reports');
const SNAPSHOT_PATH = resolve(REPORTS_DIR, 'latest.json');
const MARKDOWN_PATH = resolve(REPORTS_DIR, 'latest.md');

interface Snapshot {
  generatedAt: string;
  stats: ReturnType<typeof getDashboardStats>;
  leads: {
    id: number;
    company: string;
    purchase: number | null;
    priority: string | null;
    offer: string | null;
    website: number | null;
    social: number | null;
    location: string | null;
    phone: string | null;
    websiteStatus: string;
    manualReview: boolean;
    socialStatus: string | null;
  }[];
}

function toSnapshot(rows: LeadTableRow[]): Snapshot {
  return {
    generatedAt: new Date().toISOString(),
    stats: getDashboardStats(),
    leads: rows.map((r) => ({
      id: r.leadId,
      company: r.company,
      purchase: r.purchaseScore,
      priority: r.priority,
      offer: r.offerLabel,
      website: r.websiteScore,
      social: r.socialScore,
      location: r.location,
      phone: r.phone,
      websiteStatus: r.websiteStatus,
      manualReview: r.manualReview,
      socialStatus: r.socialStatus,
    })),
  };
}

function readPrevious(): Snapshot | null {
  if (!existsSync(SNAPSHOT_PATH)) return null;
  try {
    return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
  } catch {
    return null; // Bozuk dosya raporu durdurmasin.
  }
}

const ACTIONABLE = new Set(['HOT', 'HIGH']);

/** Onceki calistirmayla karsilastirip anlamli degisimleri cikarir. */
function diff(current: Snapshot, previous: Snapshot | null) {
  if (!previous) return null;

  const before = new Map(previous.leads.map((l) => [l.id, l]));

  const newLeads = current.leads.filter((l) => !before.has(l.id));
  const promoted: { lead: Snapshot['leads'][0]; from: string | null }[] = [];
  const moved: { lead: Snapshot['leads'][0]; delta: number }[] = [];

  for (const lead of current.leads) {
    const old = before.get(lead.id);
    if (!old) continue;

    // Aranabilir bandına yeni giren lead'ler
    if (
      lead.priority &&
      ACTIONABLE.has(lead.priority) &&
      (!old.priority || !ACTIONABLE.has(old.priority))
    ) {
      promoted.push({ lead, from: old.priority });
    }

    if (lead.purchase !== null && old.purchase !== null) {
      const delta = lead.purchase - old.purchase;
      if (Math.abs(delta) >= 5) moved.push({ lead, delta });
    }
  }

  moved.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    newLeads,
    promoted,
    moved: moved.slice(0, 10),
    disappeared: previous.leads.filter((l) => !current.leads.some((c) => c.id === l.id)).length,
  };
}

/** Lead icin brifing verisini toplar. Rapor, uygulama ve dashboard ayni
 *  `buildBrief` fonksiyonunu kullanir — uc yerde farkli tavsiye cikamaz. */
function briefFor(leadId: number) {
  const row = getDb()
    .prepare(
      `SELECT c.name, c.segment, c.location_district, c.rating, c.review_count, c.website,
              w.score AS website_score, w.status AS website_status, w.reason AS website_reason,
              w.checks,
              (SELECT sa.score FROM social_audits sa WHERE sa.company_id = c.id
                 ORDER BY sa.score DESC NULLS LAST LIMIT 1) AS social_score,
              (SELECT sa.profile_url FROM social_audits sa WHERE sa.company_id = c.id
                 ORDER BY sa.score DESC NULLS LAST LIMIT 1) AS social_url,
              o.offer_label, o.rationale,
              COALESCE(l.call_count, 0) AS call_count,
              (SELECT cl.notes FROM call_logs cl WHERE cl.lead_id = l.id
                 ORDER BY cl.id DESC LIMIT 1) AS last_notes
         FROM leads l
         JOIN companies c ON c.id = l.company_id
         LEFT JOIN website_audits w ON w.id =
           (SELECT MAX(id) FROM website_audits WHERE company_id = c.id)
         LEFT JOIN offer_recommendations o ON o.id =
           (SELECT MAX(id) FROM offer_recommendations WHERE lead_id = l.id)
        WHERE l.id = ?`,
    )
    .get(leadId) as Record<string, unknown> | undefined;
  if (!row) return null;

  return buildBrief({
    name: String(row.name),
    segment: (row.segment as string) ?? null,
    district: (row.location_district as string) ?? null,
    rating: (row.rating as number) ?? null,
    reviewCount: (row.review_count as number) ?? null,
    hasWebsite: Boolean(row.website),
    websiteScore: (row.website_score as number) ?? null,
    websiteStatus: String(row.website_status ?? 'ok'),
    websiteReason: (row.website_reason as string) ?? null,
    socialScore: (row.social_score as number) ?? null,
    socialUrl: (row.social_url as string) ?? null,
    offerLabel: (row.offer_label as string) ?? null,
    offerRationale: (row.rationale as string) ?? null,
    checks: parseJson<AuditCheck[]>(row.checks as string, []),
    callCount: (row.call_count as number) ?? 0,
    lastCallNotes: (row.last_notes as string) ?? null,
  });
}

function scoreCell(v: number | null): string {
  return v === null ? '—' : String(v);
}

function buildMarkdown(current: Snapshot, previous: Snapshot | null): string {
  const d = diff(current, previous);
  const date = new Date(current.generatedAt).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const s = current.stats;
  const lines: string[] = [];

  lines.push(`# Lead Radarı — ${date}`);
  lines.push('');
  lines.push(
    `**${s.totalLeads}** lead · **${s.analyzed}** denetlendi · ` +
      `ortalama purchase score **${s.averageScore ?? '—'}**`,
  );
  lines.push('');
  lines.push(
    `🔥 HOT **${s.hotLeads}** · 🟢 HIGH **${s.highPotential}** · ` +
      `🟡 MEDIUM **${current.leads.filter((l) => l.priority === 'MEDIUM').length}** · ` +
      `🔴 LOW **${current.leads.filter((l) => l.priority === 'LOW').length}**`,
  );
  lines.push('');

  // --- Bugun ne degisti -----------------------------------------------------
  if (d) {
    const hasChange =
      d.newLeads.length > 0 || d.promoted.length > 0 || d.moved.length > 0 || d.disappeared > 0;

    lines.push('## Bugün ne değişti');
    lines.push('');

    if (!hasChange) {
      lines.push('Önceki çalıştırmaya göre kayda değer bir değişiklik yok.');
      lines.push('');
    } else {
      if (d.promoted.length > 0) {
        lines.push(`### ⬆️ Aranacak listeye giren ${d.promoted.length} lead`);
        lines.push('');
        for (const { lead, from } of d.promoted) {
          lines.push(
            `- **${lead.company}** — ${lead.purchase} (${lead.priority})` +
              `${from ? `, önceki durum: ${from}` : ''} → _${lead.offer ?? '—'}_`,
          );
        }
        lines.push('');
      }

      if (d.newLeads.length > 0) {
        lines.push(`### 🆕 Yeni keşfedilen ${d.newLeads.length} işletme`);
        lines.push('');
        for (const lead of d.newLeads.slice(0, 15)) {
          lines.push(
            `- **${lead.company}** — ${scoreCell(lead.purchase)} (${lead.priority ?? '—'})` +
              `${lead.location ? ` · ${lead.location}` : ''}`,
          );
        }
        if (d.newLeads.length > 15) lines.push(`- …ve ${d.newLeads.length - 15} tane daha`);
        lines.push('');
      }

      if (d.moved.length > 0) {
        lines.push('### 📈 Skoru belirgin değişenler');
        lines.push('');
        lines.push('| İşletme | Değişim | Yeni skor | Öncelik |');
        lines.push('|---|---|---|---|');
        for (const { lead, delta } of d.moved) {
          const arrow = delta > 0 ? `+${delta}` : String(delta);
          lines.push(
            `| ${lead.company} | ${arrow} | ${scoreCell(lead.purchase)} | ${lead.priority ?? '—'} |`,
          );
        }
        lines.push('');
        lines.push(
          '_Skor değişimi genelde sitenin gerçekten değişmesinden ya da bir denetim ' +
            'maddesinin bu sefer ölçülebilmesinden kaynaklanır._',
        );
        lines.push('');
      }

      if (d.disappeared > 0) {
        lines.push(
          `_${d.disappeared} lead bu çalıştırmanın kapsamına girmedi (limit ya da kaynak sıralaması)._`,
        );
        lines.push('');
      }
    }
  }

  // --- Aranacak liste -------------------------------------------------------
  const callList = current.leads
    .filter((l) => l.priority && ACTIONABLE.has(l.priority))
    .slice(0, 20);

  lines.push('## Aranacak liste');
  lines.push('');
  if (callList.length === 0) {
    lines.push('Bu çalıştırmada HOT ya da HIGH öncelikli lead çıkmadı.');
  } else {
    lines.push('| # | İşletme | Telefon | Konum | Website | Purchase | Önerilen hizmet |');
    lines.push('|---|---|---|---|---|---|---|');
    callList.forEach((l, i) => {
      const websiteCell =
        l.website === null && l.websiteStatus !== 'no_website'
          ? '⚠️ ölçülemedi'
          : scoreCell(l.website);
      lines.push(
        `| ${i + 1} | **${l.company}** | ${l.phone ?? '—'} | ${l.location ?? '—'} | ` +
          `${websiteCell} | **${scoreCell(l.purchase)}** | ${l.offer ?? '—'} |`,
      );
    });
  }
  lines.push('');

  // --- Elle incelenecekler ---------------------------------------------------
  const manual = current.leads.filter((l) => l.manualReview);
  if (manual.length > 0) {
    lines.push('## Elle incelenmesi gerekenler');
    lines.push('');
    lines.push(
      `${manual.length} işletmenin sitesi otomatik denetime kapalı (bot koruması ya da sunucu hatası). ` +
        'Bu sitelere **skor verilmedi** — ölçemediğimiz için "kötü" varsaymıyoruz. ' +
        'Aramadan önce siteyi tarayıcıda açıp bakın.',
    );
    lines.push('');
    lines.push('| İşletme | Telefon | Website | Durum |');
    lines.push('|---|---|---|---|');
    for (const lead of manual.slice(0, 20)) {
      lines.push(
        `| ${lead.company} | ${lead.phone ?? '—'} | ${lead.location ?? '—'} | ${lead.websiteStatus} |`,
      );
    }
    if (manual.length > 20) lines.push(`| _…ve ${manual.length - 20} tane daha_ | | | |`);
    lines.push('');
  }

  // --- Arama brifingleri ----------------------------------------------------
  if (callList.length > 0) {
    lines.push('## Arama brifingleri');
    lines.push('');
    lines.push('_Her cümle bir ölçüme dayanır. Ölçemediğimiz şey hakkında iddia yoktur._');
    lines.push('');

    for (const [i, lead] of callList.entries()) {
      const brief = briefFor(lead.id);
      if (!brief) continue;

      lines.push(`### ${i + 1}. ${lead.company}`);
      lines.push('');
      lines.push(`**${brief.headline}**`);
      lines.push('');
      if (lead.phone) lines.push(`📞 ${lead.phone}${lead.location ? ` · ${lead.location}` : ''}`);
      lines.push('');

      lines.push('**Nasıl başlanır**');
      lines.push('');
      lines.push(`> ${brief.opening}`);
      lines.push('');

      if (brief.findings.length > 0) {
        lines.push('**Konuşulacak somut bulgular**');
        lines.push('');
        for (const f of brief.findings) {
          lines.push(`- **${f.label}** — ${f.evidence}`);
        }
        lines.push('');
      }

      if (brief.pitch) {
        lines.push('**Ne satılır**');
        lines.push('');
        lines.push(brief.pitch);
        lines.push('');
      }

      if (brief.questions.length > 0) {
        lines.push('**Sorulacaklar**');
        lines.push('');
        for (const q of brief.questions) lines.push(`- ${q}`);
        lines.push('');
      }

      if (brief.cautions.length > 0) {
        lines.push('**⚠️ Dikkat**');
        lines.push('');
        for (const c of brief.cautions) lines.push(`- ${c}`);
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }
  }

  lines.push('');
  lines.push(
    '_Bu rapor otomatik üretildi. Sistem yalnızca araştırma yapar: hiçbir işletmeye ' +
      'mesaj gönderilmez, e-posta atılmaz. Skorların nasıl hesaplandığı: `docs/SCORING.md`._',
  );
  lines.push('');

  return lines.join('\n');
}

function main(): void {
  initSchema();

  const rows = listLeadTable();
  if (rows.length === 0) {
    console.log('[report] Lead yok — önce `npm run pipeline` çalıştırın.');
    return;
  }

  const previous = readPrevious();
  const current = toSnapshot(rows);
  const markdown = buildMarkdown(current, previous);

  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(MARKDOWN_PATH, markdown, 'utf8');
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2), 'utf8');

  const d = diff(current, previous);
  console.log(`[report] ${MARKDOWN_PATH}`);
  console.log(
    `[report] ${current.leads.length} lead · ` +
      (d
        ? `${d.newLeads.length} yeni · ${d.promoted.length} aranacak listeye girdi · ${d.moved.length} skor değişimi`
        : 'ilk çalıştırma, karşılaştırma yok'),
  );
}

try {
  main();
} catch (err) {
  console.error(`[report] HATA: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  closeDb();
}
