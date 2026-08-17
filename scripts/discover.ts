import { initSchema, closeDb } from '../src/lib/db/client';
import { upsertCompany, upsertContact } from '../src/lib/db/repositories/companies';
import { ensureLead, setPrimaryContact } from '../src/lib/db/repositories/leads';
import { startRun, finishRun } from '../src/lib/db/repositories/runs';
import { getSource } from '../src/lib/sources';
import { parseArgs } from './args';

/**
 * DISCOVER asamasi: kaynaktan isletmeleri cek, companies/contacts/leads
 * tablolarina yaz. Idempotent — tekrar calistirmak kayit cogaltmaz.
 */
export async function runDiscover(options: {
  limit: number;
  city: string;
  sourceId?: string;
}): Promise<{ discovered: number; inserted: number; source: string }> {
  initSchema();

  const source = getSource(options.sourceId);
  const availability = await source.isAvailable();

  if (!availability.available) {
    throw new Error(`[discover] "${source.id}" kaynagi kullanilamiyor: ${availability.reason}`);
  }
  if (availability.reason) {
    console.log(`[discover] ${source.id}: ${availability.reason}`);
  }

  const runId = startRun('discover');
  console.log(`[discover] kaynak=${source.id} sehir=${options.city} limit=${options.limit}`);

  const companies = await source.discover({ city: options.city, limit: options.limit });
  let inserted = 0;

  for (const company of companies) {
    const companyId = upsertCompany(company);
    const leadId = ensureLead(companyId);

    for (const contact of company.contacts ?? []) {
      const contactId = upsertContact(companyId, contact);
      setPrimaryContact(leadId, contactId);
    }

    inserted += 1;
    const site = company.website ?? 'website yok';
    console.log(`  + ${company.name} (${company.segment}) — ${site}`);
  }

  const stats = { source: source.id, city: options.city, discovered: companies.length, inserted };
  finishRun(runId, stats);
  console.log(`[discover] ${inserted} isletme kaydedildi.`);

  return { discovered: companies.length, inserted, source: source.id };
}

// Dogrudan calistirildiginda CLI olarak davran.
if (process.argv[1]?.endsWith('discover.ts')) {
  const args = parseArgs(process.argv.slice(2));
  runDiscover({
    limit: args.limit ?? 10,
    city: args.city ?? 'istanbul',
    sourceId: args.source,
  })
    .catch((err) => {
      console.error(`[discover] HATA: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
