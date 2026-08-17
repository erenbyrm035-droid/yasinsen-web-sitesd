import { initSchema, closeDb } from '../src/lib/db/client';
import { listCompanies } from '../src/lib/db/repositories/companies';
import { latestWebsiteAudit, latestSocialAudits } from '../src/lib/db/repositories/audits';
import { ensureLead, setLeadStatus } from '../src/lib/db/repositories/leads';
import { insertLeadScore, insertOffer } from '../src/lib/db/repositories/scores';
import { startRun, finishRun } from '../src/lib/db/repositories/runs';
import { computeLeadScore } from '../src/lib/scoring/purchase-score';
import { aggregateSocialScore } from '../src/lib/audit/social';
import { recommendOffer } from '../src/lib/offer/engine';
import { buildAnalysis } from '../src/lib/ai/reasoner';
import { isInstitutional } from '../src/lib/sources/overpass';
import { parseJson } from '../src/lib/db/client';
import type { Priority, Segment } from '../src/lib/types';
import { parseArgs } from './args';

/**
 * SCORE asamasi: denetim sonuclarindan skor + teklif + AI gerekcesi uretir.
 * Denetimi olmayan sirket atlanir (once `npm run audit` calismali).
 */
export async function runScore(options: { limit?: number } = {}): Promise<{
  scored: number;
  skipped: number;
  byPriority: Record<Priority, number>;
}> {
  initSchema();

  const companies = listCompanies(options.limit);
  const runId = startRun('score');
  const byPriority: Record<Priority, number> = { HOT: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };

  let scored = 0;
  let skipped = 0;

  for (const company of companies) {
    const websiteAudit = latestWebsiteAudit(company.id);
    if (!websiteAudit) {
      console.log(`  · ${company.name} — denetim yok, atlandı`);
      skipped += 1;
      continue;
    }

    const socialAudits = latestSocialAudits(company.id);
    const social = aggregateSocialScore(socialAudits);

    const checkPassed = (key: string) =>
      websiteAudit.checks.find((c) => c.key === key)?.passed === true;

    const rawTags = parseJson<Record<string, string>>(company.raw, {});
    const institutional = isInstitutional(rawTags, company.website);

    const score = computeLeadScore({
      segment: (company.segment ?? 'fitness_other') as Segment,
      district: company.location_district,
      employeeCount: company.employee_count,
      hasPhone: Boolean(company.phone),
      isInstitutional: institutional,

      websiteScore: websiteAudit.score,
      hasWebsite: Boolean(company.website),
      // Site kayitli ama istek tamamlanmadi -> bozuk site.
      websiteBroken: Boolean(company.website) && websiteAudit.httpStatus === null,
      checks: websiteAudit.checks,
      copyrightYear: websiteAudit.rawSignals.copyrightYear ?? null,
      platform: websiteAudit.rawSignals.platform ?? null,

      socialScore: social.score,
      socialConfidence: social.confidence,
      hasSocialPresence: socialAudits.length > 0,
    });

    const offer = recommendOffer({
      websiteScore: score.websiteScore,
      socialScore: score.socialScore,
      digitalGap: score.digitalGap,
      businessPotential: score.businessPotential,
      hasWebsite: Boolean(company.website),
      hasSocialPresence: socialAudits.length > 0,
      hasPhone: Boolean(company.phone),
      hasBooking: checkPassed('booking'),
      hasMembership: checkPassed('membership'),
      employeeCount: company.employee_count,
      isInstitutional: institutional,
      checks: websiteAudit.checks,
      socialConfidence: social.confidence,
      websiteConfidence: websiteAudit.confidence,
    });

    const leadId = ensureLead(company.id);
    insertLeadScore(leadId, score);
    insertOffer(leadId, offer);
    setLeadStatus(leadId, 'scored');

    // Sartnamedeki analiz JSON'u — reasoning alanini doldurur.
    const analysis = await buildAnalysis({
      companyName: company.name,
      industry: company.industry,
      district: company.location_district,
      websiteAudit,
      socialAudits,
      score,
      offer,
    });

    byPriority[score.priority] += 1;
    scored += 1;

    console.log(
      `  · ${company.name} — purchase ${score.purchaseScore} (${score.priority}) ` +
        `| gap ${score.digitalGap} potansiyel ${score.businessPotential} niyet ${score.estimatedBuyingIntent} ` +
        `→ ${offer.offerLabel}`,
    );
    console.log(`      ${analysis.reasoning}`);
  }

  const stats = { scored, skipped, byPriority };
  finishRun(runId, stats);
  console.log(
    `[score] Bitti — ${scored} lead skorlandı (${skipped} atlandı). ` +
      `HOT ${byPriority.HOT} · HIGH ${byPriority.HIGH} · MEDIUM ${byPriority.MEDIUM} · LOW ${byPriority.LOW}`,
  );

  return { scored, skipped, byPriority };
}

if (process.argv[1]?.endsWith('score.ts')) {
  const args = parseArgs(process.argv.slice(2));
  runScore({ limit: args.limit })
    .catch((err) => {
      console.error(`[score] HATA: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
