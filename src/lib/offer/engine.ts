import type {
  AuditCheck,
  AuditConfidence,
  Confidence,
  OfferRecommendation,
  SocialConfidence,
} from '../types';
import { OFFER_LABELS, OFFER_RULES, type OfferRuleContext } from './rules';

/**
 * Teklif motoru: kural tablosunu sirayla dener, ilk eslesen kurali uygular.
 * Karar mantigi rules.ts'te; burasi yalnizca calistirir ve gerekce/boslugu
 * paketler.
 */

export interface OfferEngineInput extends OfferRuleContext {
  checks: AuditCheck[];
  socialConfidence: SocialConfidence;
  websiteConfidence: AuditConfidence;
}

/** Denetimde kalan maddeler = kapatilacak dijital bosluklar. */
export function collectDigitalGaps(checks: AuditCheck[]): string[] {
  return checks
    .filter((c) => c.passed === false)
    .sort((a, b) => b.weight - a.weight)
    .map((c) => c.label);
}

export function recommendOffer(input: OfferEngineInput): OfferRecommendation {
  const rule = OFFER_RULES.find((r) => r.matches(input));
  // R8 her zaman eslesir; yine de tip guvenligi icin kontrol.
  if (!rule) throw new Error('Offer kural tablosunda varsayilan kural bulunamadi');

  const offerCode = rule.offer(input);

  return {
    offerCode,
    offerLabel: OFFER_LABELS[offerCode],
    rationale: `[${rule.id}] ${rule.rationale(input)}`,
    digitalGaps: collectDigitalGaps(input.checks),
    confidence: resolveConfidence(input),
  };
}

/**
 * Teklifin guveni, dayandigi olcumlerin guveninden yuksek olamaz.
 * Sosyal metrikleri su an olculemedigi icin sosyale dayanan kararlar
 * en fazla 'medium' guven tasir.
 */
function resolveConfidence(input: OfferEngineInput): Confidence {
  // Website hic olculemediyse teklif de olculmus bir seye dayanmiyor demektir.
  if (input.websiteConfidence === 'none') return 'low';
  if (input.websiteConfidence === 'low') return 'low';
  if (input.socialConfidence === 'none' && input.hasSocialPresence) return 'low';
  if (input.socialConfidence === 'low' || input.socialConfidence === 'none') return 'medium';
  return input.websiteConfidence;
}

export { OFFER_LABELS, OFFER_RULES } from './rules';
