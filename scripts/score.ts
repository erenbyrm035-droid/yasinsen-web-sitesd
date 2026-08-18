import { loadEnv } from '../src/lib/env';

loadEnv();

import { initSchema, closeDb } from '../src/lib/db/client';
import { listCompanies } from '../src/lib/db/repositories/companies';
import { latestWebsiteAudit } from '../src/lib/db/repositories/audits';
import { startRun, finishRun } from '../src/lib/db/repositories/runs';
import { scoreCompany } from '../src/lib/scoring/score-company';
import { markReadyToCall, recordEvent } from '../src/lib/db/repositories/sales';
import { resolveCompanySocial } from '../src/lib/social-resolution';
import { buildAnalysis } from '../src/lib/ai/reasoner';
import type { Priority } from '../src/lib/types';
import { parseArgs } from './args';

/**
 * SCORE asamasi: denetim sonuclarindan skor + teklif + AI gerekcesi uretir.
 * Denetimi olmayan sirket atlanir (once `npm run audit` calismali).
 *
 * Skorlama mantigi src/lib/scoring/score-company.ts icinde — dashboard'daki
 * manuel veri formu da ayni fonksiyonu cagirir.
 */
export async function runScore(options: { limit?: number; quiet?: boolean } = {}): Promise<{
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
    const result = scoreCompany(company);
    if (!result) {
      console.log(`  · ${company.name} — denetim yok, atlandı`);
      skipped += 1;
      continue;
    }

    const { score, offer } = result;
    byPriority[score.priority] += 1;
    scored += 1;
    recordEvent(result.leadId, 'lead_scored', {
      purchaseScore: score.purchaseScore,
      priority: score.priority,
    });

    console.log(
      `  · ${company.name} — purchase ${score.purchaseScore} (${score.priority}) ` +
        `| gap ${score.digitalGap} potansiyel ${score.businessPotential} niyet ${score.estimatedBuyingIntent} ` +
        `→ ${offer.offerLabel}`,
    );

    // Gerekce uretimi (AI anahtari varsa Claude, yoksa deterministik).
    // Buyuk partilerde cikti gurultusunu azaltmak icin --quiet ile susturulur.
    if (!options.quiet) {
      const websiteAudit = latestWebsiteAudit(company.id);
      if (websiteAudit) {
        const analysis = await buildAnalysis({
          companyName: company.name,
          industry: company.industry,
          district: company.location_district,
          websiteAudit,
          socialAudits: resolveCompanySocial(company.id),
          score,
          offer,
        });
        console.log(`      ${analysis.reasoning}`);
      }
    }
  }

  /**
   * Analizi biten ve TELEFONU OLAN lead'ler aranmaya hazir isaretlenir.
   * Yalnizca NEW durumundakiler tasinir — elle degistirilmis satis
   * durumlari (ilgilenmedi, teklif gonderildi...) korunur.
   */
  const readied = markReadyToCall();

  const stats = { scored, skipped, byPriority, readied };
  finishRun(runId, stats);
  console.log(
    `[score] Bitti — ${scored} lead skorlandı (${skipped} atlandı). ` +
      `HOT ${byPriority.HOT} · HIGH ${byPriority.HIGH} · MEDIUM ${byPriority.MEDIUM} · LOW ${byPriority.LOW}` +
      (readied > 0 ? ` · ${readied} lead aranmaya hazır` : ''),
  );

  return { scored, skipped, byPriority };
}

if (process.argv[1]?.endsWith('score.ts')) {
  const args = parseArgs(process.argv.slice(2));
  runScore({ limit: args.limit, quiet: args.quiet })
    .catch((err) => {
      console.error(`[score] HATA: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
