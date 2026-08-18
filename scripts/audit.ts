import { loadEnv } from '../src/lib/env';

loadEnv();

import { initSchema, closeDb } from '../src/lib/db/client';
import { listCompanies } from '../src/lib/db/repositories/companies';
import { insertWebsiteAudit, insertSocialAudit } from '../src/lib/db/repositories/audits';
import { ensureLead, setLeadStatus } from '../src/lib/db/repositories/leads';
import { startRun, finishRun } from '../src/lib/db/repositories/runs';
import { auditCompany } from '../src/lib/audit';
import { parseArgs } from './args';

/**
 * ANALYZE asamasi: her isletme icin website + sosyal denetim calistirir.
 *
 * Sinirli es zamanlilik (varsayilan 4) kullanilir. Her lead FARKLI bir alan
 * adina gittigi icin bu, tek bir siteyi yormaz — ayni anda 4 ayri isletmenin
 * sitesi denetlenir. `--concurrency 1` ile tamamen siraya alinabilir.
 */
export async function runAudit(
  options: { limit?: number; concurrency?: number } = {},
): Promise<{
  audited: number;
  withWebsite: number;
  withoutWebsite: number;
  socialProfiles: number;
}> {
  initSchema();

  const companies = listCompanies(options.limit);
  if (companies.length === 0) {
    console.log('[audit] Denetlenecek isletme yok — once `npm run discover` calistirin.');
    return { audited: 0, withWebsite: 0, withoutWebsite: 0, socialProfiles: 0 };
  }

  const concurrency = Math.min(options.concurrency ?? 4, companies.length);
  const runId = startRun('audit');
  console.log(`[audit] ${companies.length} isletme denetleniyor (es zamanli: ${concurrency})...`);

  let withWebsite = 0;
  let withoutWebsite = 0;
  let unmeasurable = 0;
  let socialProfiles = 0;
  let socialViaSearch = 0;
  let socialRejected = 0;
  let cursor = 0;
  let done = 0;

  /**
   * Havuzdan sirayla is ceker. DB yazmalari better-sqlite3 senkron oldugu icin
   * dogal olarak seri kalir; yalnizca ag istekleri paralellesir.
   */
  async function worker(): Promise<void> {
    while (cursor < companies.length) {
      const company = companies[cursor];
      cursor += 1;

      const result = await auditCompany(company.website, {
        name: company.name,
        website: company.website,
        city: company.location_city,
        district: company.location_district,
        phone: company.phone,
      });

      insertWebsiteAudit(company.id, result.website);
      for (const social of result.social) {
        insertSocialAudit(company.id, social);
      }

      const leadId = ensureLead(company.id);
      setLeadStatus(leadId, 'analyzed');

      if (result.website.status === 'ok') withWebsite += 1;
      else if (result.website.status === 'no_website') withoutWebsite += 1;
      else unmeasurable += 1;

      socialProfiles += result.social.length;
      socialViaSearch += result.social.filter((s) => s.status === 'verified').length;
      socialRejected += result.socialRejected.length;

      done += 1;
      const socialSummary =
        result.social.length > 0
          ? result.social
              .map((s) => `${s.platform}:${s.score ?? '—'}${s.status === 'verified' ? '*' : ''}`)
              .join(' ')
          : `sosyal yok (${result.socialStatus})`;

      // Olculemeyen site "0/100" olarak yazilmaz — yanlis okumaya yol acar.
      const websiteSummary =
        result.website.score === null
          ? `website ÖLÇÜLEMEDİ (${result.website.status}: ${result.website.reason})`
          : `website ${result.website.score}/100 (${result.website.confidence})`;

      console.log(`  · [${done}/${companies.length}] ${company.name} — ${websiteSummary} | ${socialSummary}`);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const stats = {
    audited: companies.length,
    withWebsite,
    withoutWebsite,
    unmeasurable,
    socialProfiles,
    socialViaSearch,
    socialRejected,
  };
  finishRun(runId, stats);
  console.log(
    `[audit] Bitti — ${companies.length} denetim: ${withWebsite} site denetlendi, ` +
      `${withoutWebsite} sitesi yok, ${unmeasurable} ÖLÇÜLEMEDİ (elle inceleme). ` +
      `${socialProfiles} sosyal profil (${socialViaSearch} arama ile doğrulandı, ` +
      `${socialRejected} aday doğrulanamadığı için reddedildi).`,
  );

  return { audited: companies.length, withWebsite, withoutWebsite, socialProfiles };
}

if (process.argv[1]?.endsWith('audit.ts')) {
  const args = parseArgs(process.argv.slice(2));
  runAudit({ limit: args.limit, concurrency: args.concurrency })
    .catch((err) => {
      console.error(`[audit] HATA: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
