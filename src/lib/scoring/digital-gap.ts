import type { ScoreBreakdown, SocialConfidence } from '../types';

/**
 * DIGITAL GAP (0-100)
 * "Bu isletmenin dijital varliginda ne kadar bosluk var?" — yani bizim
 * doldurabilecegimiz alan. Yuksek gap = satilacak cok is var.
 *
 * Temel formul:  gap = 100 − (wWeb · websiteScore + wSocial · socialScore)
 *
 * Sosyal skorun guveni dusuk oldugu icin (Instagram metrikleri login duvarinin
 * arkasinda — bkz. src/lib/audit/social.ts) agirligi guvene gore ayarlanir:
 * olculemeyen sosyal, website skorunu asiri cezalandirmasin diye agirligi
 * website'a devreder.
 */

const BASE_WEIGHTS = { website: 0.6, social: 0.4 } as const;

/** Sosyal skorun guvenine gore agirlik carpani. */
const SOCIAL_CONFIDENCE_FACTOR: Record<SocialConfidence, number> = {
  none: 0,    // hic olculebilir sinyal yok -> sosyal hesaba katilmaz
  low: 0.5,   // yalnizca sinyal bazli (bugunku durum)
  medium: 0.8,
  high: 1,
};

export interface DigitalGapResult {
  gap: number;
  detail: ScoreBreakdown['digitalGap'];
}

export function computeDigitalGap(
  websiteScore: number,
  socialScore: number | null,
  socialConfidence: SocialConfidence,
): DigitalGapResult {
  const factor = socialScore === null ? 0 : SOCIAL_CONFIDENCE_FACTOR[socialConfidence];

  // Sosyalden dusen agirlik website'a aktarilir; toplam daima 1 kalir.
  const socialWeight = BASE_WEIGHTS.social * factor;
  const websiteWeight = 1 - socialWeight;

  const combined = websiteWeight * websiteScore + socialWeight * (socialScore ?? 0);
  const gap = Math.round(Math.max(0, Math.min(100, 100 - combined)));

  return {
    gap,
    detail: {
      websiteWeight: Number(websiteWeight.toFixed(2)),
      socialWeight: Number(socialWeight.toFixed(2)),
      socialConfidence,
      formula:
        socialScore === null
          ? `gap = 100 − website(${websiteScore}) · 1.00 — ölçülebilir sosyal sinyal yok, ağırlık website'a devredildi`
          : `gap = 100 − (website(${websiteScore}) · ${websiteWeight.toFixed(2)} + social(${socialScore}) · ${socialWeight.toFixed(2)}); ` +
            `sosyal güven "${socialConfidence}" olduğu için ağırlığı ${BASE_WEIGHTS.social} → ${socialWeight.toFixed(2)} düşürüldü`,
    },
  };
}
