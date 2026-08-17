import { initSchema, closeDb } from '../src/lib/db/client';
import { listCompanies } from '../src/lib/db/repositories/companies';
import { insertWebsiteAudit, insertSocialAudit } from '../src/lib/db/repositories/audits';
import { ensureLead, setLeadStatus } from '../src/lib/db/repositories/leads';
import { startRun, finishRun } from '../src/lib/db/repositories/runs';
import { auditCompany } from '../src/lib/audit';
import { parseArgs } from './args';

/**
 * ANALYZE asamasi: her isletme icin website + sosyal denetim calistirir.
 * Denetimler sirayla yapilir — hedef siteleri es zamanli isteklerle yormamak icin.
 */
export async function runAudit(options: { limit?: number } = {}): Promise<{
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

  const runId = startRun('audit');
  console.log(`[audit] ${companies.length} isletme denetleniyor...`);

  let withWebsite = 0;
  let withoutWebsite = 0;
  let socialProfiles = 0;

  for (const company of companies) {
    const result = await auditCompany(company.website);

    insertWebsiteAudit(company.id, result.website);
    for (const social of result.social) {
      insertSocialAudit(company.id, social);
    }

    const leadId = ensureLead(company.id);
    setLeadStatus(leadId, 'analyzed');

    if (result.website.hasWebsite && result.website.httpStatus !== null) withWebsite += 1;
    else withoutWebsite += 1;
    socialProfiles += result.social.length;

    const socialSummary =
      result.social.length > 0
        ? result.social.map((s) => `${s.platform}:${s.score ?? '—'}`).join(' ')
        : 'sosyal profil yok';

    console.log(
      `  · ${company.name} — website ${result.website.score}/100 (${result.website.confidence}) | ${socialSummary}`,
    );
    if (result.website.notes) console.log(`      ${result.website.notes}`);
  }

  const stats = { audited: companies.length, withWebsite, withoutWebsite, socialProfiles };
  finishRun(runId, stats);
  console.log(
    `[audit] Bitti — ${companies.length} denetim, ${withWebsite} erisilebilir site, ` +
      `${withoutWebsite} site yok/acilmadi, ${socialProfiles} sosyal profil.`,
  );

  return { audited: companies.length, withWebsite, withoutWebsite, socialProfiles };
}

if (process.argv[1]?.endsWith('audit.ts')) {
  const args = parseArgs(process.argv.slice(2));
  runAudit({ limit: args.limit })
    .catch((err) => {
      console.error(`[audit] HATA: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
