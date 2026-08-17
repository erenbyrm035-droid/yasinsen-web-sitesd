import { initSchema, closeDb } from '../../src/lib/db/client';
import { upsertManualInput, deleteManualInput } from '../../src/lib/db/repositories/social-manual';
import { rescoreCompanyById } from '../../src/lib/scoring/score-company';
import { resolveCompanySocial } from '../../src/lib/social-resolution';

/**
 * Gelistirme yardimcisi: manuel sosyal veri girisinin skoru nasil degistirdigini
 * gosterir. Ornek verisi girer, olcer, sonra GERI ALIR — veritabaninda iz birakmaz.
 *
 *   npx tsx scripts/dev/manual-input-check.ts <companyId>
 */
const companyId = Number.parseInt(process.argv[2] ?? '', 10);
if (Number.isNaN(companyId)) {
  console.error('Kullanim: npx tsx scripts/dev/manual-input-check.ts <companyId>');
  process.exit(1);
}

initSchema();

const before = rescoreCompanyById(companyId);
if (!before) {
  console.error(`Şirket ${companyId} bulunamadı ya da denetimi yok.`);
  process.exit(1);
}
console.log(
  `ÖNCE   purchase ${before.score.purchaseScore} (${before.score.priority}) · ` +
    `sosyal ${before.score.socialScore ?? '—'} · ${before.offer.offerLabel}`,
);

upsertManualInput(companyId, 'instagram', {
  followers: 8400,
  postsLast30d: 18,
  reelsLast30d: 7,
  avgLikes: 310, // ~%3.7 etkilesim
  visualQuality: 5,
  salesContent: 4,
  bioHasWebsite: true,
  bioHasContact: true,
  note: 'geçici kontrol verisi',
  enteredBy: 'manual-input-check',
});

const after = rescoreCompanyById(companyId);
const ig = resolveCompanySocial(companyId).find((s) => s.platform === 'instagram');
console.log(
  `SONRA  purchase ${after?.score.purchaseScore} (${after?.score.priority}) · ` +
    `sosyal ${after?.score.socialScore ?? '—'} (güven: ${ig?.confidence}) · ${after?.offer.offerLabel}`,
);
console.log(
  `       manuel rubrik ${ig?.manual?.score}/100 · kapsam %${Math.round((ig?.manual?.coverage ?? 0) * 100)}`,
);

// Geri al — bu betik veritabanini kalici degistirmez.
deleteManualInput(companyId, 'instagram');
rescoreCompanyById(companyId);
console.log('Geçici veri silindi, skor eski haline döndürüldü.');

closeDb();
