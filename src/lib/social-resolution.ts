import { latestSocialAudits } from './db/repositories/audits';
import { listManualInputs } from './db/repositories/social-manual';
import { mergeManualInput, auditFromManualOnly, type MergedSocialAudit } from './audit/social-manual';
import type { SocialConfidence } from './types';

/**
 * Bir sirketin nihai sosyal medya tablosu: otomatik denetim + elle girilen
 * metrikler birlestirilmis hali.
 *
 * Hem skorlama (scripts/score.ts) hem dashboard ayni fonksiyonu kullanir —
 * ekranda gorunen skor ile hesaplanan skor asla ayrisamaz.
 */
export function resolveCompanySocial(companyId: number): MergedSocialAudit[] {
  const audits = latestSocialAudits(companyId);
  const manualInputs = listManualInputs(companyId);
  const manualByPlatform = new Map(manualInputs.map((m) => [m.platform, m]));

  const merged: MergedSocialAudit[] = audits.map((audit) =>
    mergeManualInput(audit, manualByPlatform.get(audit.platform) ?? null),
  );

  // Sitede linki bulunmayan ama elle veri girilmis platformlar da listeye girer:
  // "sitede link yok ama Instagram hesabı var" gercek ve satis acisindan anlamli.
  const auditedPlatforms = new Set(audits.map((a) => a.platform));
  for (const input of manualInputs) {
    if (auditedPlatforms.has(input.platform)) continue;
    const manualOnly = auditFromManualOnly(input);
    if (manualOnly) merged.push(manualOnly);
  }

  return merged;
}

const CONFIDENCE_RANK: Record<SocialConfidence, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Sirket geneli sosyal skoru.
 *
 * Secim once GUVENE, sonra skora gore yapilir. Bu siralama bilincli:
 * elle olculmus 87 ile yalnizca "sitede link var + profil aciliyor" sinyalinden
 * uretilmis 90 ayni sey degildir. Yuksek guvenli olcum, dusuk guvenli tahmini
 * daima yener — aksi halde gercek veri girmek skoru dusurebilir ve kullanici
 * veri girmekten caydirilirdi.
 */
export function aggregateResolvedSocial(audits: MergedSocialAudit[]): {
  score: number | null;
  confidence: SocialConfidence;
} {
  const scored = audits.filter((a) => a.score !== null);
  if (scored.length === 0) return { score: null, confidence: 'none' };

  const best = scored.reduce((a, b) => {
    const rankDiff = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (rankDiff !== 0) return rankDiff > 0 ? b : a;
    return (b.score ?? 0) > (a.score ?? 0) ? b : a;
  });

  return { score: best.score, confidence: best.confidence };
}

export type { MergedSocialAudit };
