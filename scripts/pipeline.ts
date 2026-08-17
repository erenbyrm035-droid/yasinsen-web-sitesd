import { loadEnv } from '../src/lib/env';

loadEnv();

import { initSchema, closeDb } from '../src/lib/db/client';
import { startRun, finishRun } from '../src/lib/db/repositories/runs';
import { runDiscover } from './discover';
import { runAudit } from './audit';
import { runScore } from './score';
import { parseArgs } from './args';

/**
 * Uctan uca pipeline: DISCOVER -> ANALYZE -> SCORE -> RECOMMEND
 *
 * Bu sistem hicbir lead'e mesaj gondermez, hicbir CRM kaydi olusturmaz.
 * Ayrintilar: docs/SAFETY.md
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const limit = args.limit ?? 10;
  const city = args.city ?? 'istanbul';

  initSchema();
  const runId = startRun('pipeline');
  const startedAt = Date.now();

  console.log('╭──────────────────────────────────────────╮');
  console.log('│  VIVA SALES ENGINE — pipeline            │');
  console.log('╰──────────────────────────────────────────╯');
  console.log(`Hedef: ${city} · ${limit} lead\n`);

  console.log('▸ 1/3 DISCOVER');
  const discover = await runDiscover({ limit, city, sourceId: args.source });

  console.log('\n▸ 2/3 ANALYZE');
  const audit = await runAudit({ limit, concurrency: args.concurrency });

  console.log('\n▸ 3/3 SCORE + RECOMMEND');
  // Buyuk partilerde per-lead gerekce ciktisi okunmaz hale geliyor.
  const score = await runScore({ limit, quiet: args.quiet ?? limit > 25 });

  const stats = {
    city,
    limit,
    discover,
    audit,
    score,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  finishRun(runId, stats);

  console.log(
    `\n✓ Pipeline tamamlandı (${stats.durationSeconds}s). ` +
      `Dashboard için: npm run dev → http://localhost:3000`,
  );
}

main()
  .catch((err) => {
    console.error(`\n[pipeline] HATA: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
