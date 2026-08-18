import { loadEnv } from '../src/lib/env';

loadEnv();

import { initSchema, closeDb } from '../src/lib/db/client';
import { startRun, finishRun } from '../src/lib/db/repositories/runs';
import { runDiscover } from './discover';
import { countLeads } from '../src/lib/db/repositories/leads';
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

  /**
   * Kesif basarisiz olabilir ve bu pipeline'i BITIRMEMELI.
   *
   * Gercek vaka: anahtari olmayan yeni bir kullanicida sistem OSM'e dusuyor,
   * Overpass da o an 504 donuyordu — ve tum calistirma cokup hicbir sey
   * uretmiyordu. Oysa veritabaninda zaten lead varsa onlari denetleyip
   * puanlamak hala anlamli. Kesif, pipeline'in tamami degil bir adimidir.
   */
  let discover: Awaited<ReturnType<typeof runDiscover>> | null = null;
  let discoverError: string | null = null;
  try {
    discover = await runDiscover({ limit, city, sourceId: args.source });
  } catch (err) {
    discoverError = err instanceof Error ? err.message : String(err);
    console.warn(`\n[pipeline] Keşif adımı başarısız: ${discoverError}`);

    const existing = countLeads();
    if (existing === 0) {
      // Elde hicbir sey yok: devam etmenin anlami yok, ama kullaniciya NE
      // YAPMASI gerektigi soylenmeli.
      console.error(
        '\n[pipeline] Veritabanı boş ve yeni işletme keşfedilemedi.\n' +
          '\n  Yapılabilecekler:\n' +
          '   1. Google Places anahtarı ekleyin (.env → GOOGLE_MAPS_API_KEY).\n' +
          '      En sağlam yol; telefon ve yorum verisi de gelir.\n' +
          '   2. Ya da birkaç dakika sonra tekrar deneyin — ücretsiz OpenStreetMap\n' +
          '      sunucusu (Overpass) yoğun olduğunda geçici olarak yanıt vermiyor.\n',
      );
      process.exitCode = 1;
      return;
    }

    console.warn(
      `[pipeline] Veritabanındaki ${existing} lead ile devam ediliyor ` +
        '(yeni işletme eklenmedi).\n',
    );
  }

  console.log('\n▸ 2/3 ANALYZE');
  const audit = await runAudit({ limit, concurrency: args.concurrency });

  console.log('\n▸ 3/3 SCORE + RECOMMEND');
  // Buyuk partilerde per-lead gerekce ciktisi okunmaz hale geliyor.
  const score = await runScore({ limit, quiet: args.quiet ?? limit > 25 });

  const stats = {
    city,
    limit,
    discover,
    discoverError,
    audit,
    score,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  finishRun(runId, stats);

  console.log(
    `\n✓ Pipeline tamamlandı (${stats.durationSeconds}s)` +
      (discoverError ? ' — keşif adımı atlandı' : '') +
      `. Uygulama için: npm start → http://localhost:3000`,
  );
}

main()
  .catch((err) => {
    console.error(`\n[pipeline] HATA: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
