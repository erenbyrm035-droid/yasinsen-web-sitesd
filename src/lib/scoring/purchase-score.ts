import type { LeadScoreResult, Priority, ScoreBreakdown, SocialConfidence, Segment, AuditCheck } from '../types';
import { computeBusinessPotential } from './business-potential';
import { computeBuyingIntent } from './buying-intent';
import { computeDigitalGap } from './digital-gap';

/**
 * PURCHASE SCORE (0-100) ve LEAD PRIORITY
 *
 *   purchase = 0.35 · digital_gap + 0.35 · business_potential + 0.30 · buying_intent
 *
 * Neden bu agirliklar:
 *   * digital_gap        — satilacak is var mi
 *   * business_potential — odeyebilir mi
 *   * buying_intent      — satin almaya yatkin mi
 * Ilk ikisi esit agirlikta cunku biri olmadan digeri satisa donmez; niyet
 * tahmini en spekulatif bilesen oldugu icin biraz daha dusuk agirlikta.
 *
 * Ardindan modifierlar uygulanir (hepsi breakdown'da gorunur).
 */

const WEIGHTS = { digitalGap: 0.35, businessPotential: 0.35, buyingIntent: 0.3 } as const;

const PRIORITY_THRESHOLDS = { HOT: 80, HIGH: 65, MEDIUM: 45 } as const;

export function toPriority(purchaseScore: number): Priority {
  if (purchaseScore >= PRIORITY_THRESHOLDS.HOT) return 'HOT';
  if (purchaseScore >= PRIORITY_THRESHOLDS.HIGH) return 'HIGH';
  if (purchaseScore >= PRIORITY_THRESHOLDS.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

export interface LeadScoreInput {
  segment: Segment;
  district: string | null;
  employeeCount: number | null;
  hasPhone: boolean;
  isInstitutional: boolean;

  websiteScore: number;
  hasWebsite: boolean;
  websiteBroken: boolean;
  checks: AuditCheck[];
  copyrightYear: number | null;
  platform: string | null;

  socialScore: number | null;
  socialConfidence: SocialConfidence;
  hasSocialPresence: boolean;
}

export function computeLeadScore(input: LeadScoreInput): LeadScoreResult {
  const business = computeBusinessPotential({
    segment: input.segment,
    district: input.district,
    employeeCount: input.employeeCount,
    hasWebsite: input.hasWebsite && !input.websiteBroken,
    hasSocialPresence: input.hasSocialPresence,
    hasPhone: input.hasPhone,
    isInstitutional: input.isInstitutional,
  });

  const gap = computeDigitalGap(input.websiteScore, input.socialScore, input.socialConfidence);

  const intent = computeBuyingIntent({
    websiteScore: input.websiteScore,
    socialScore: input.socialScore,
    hasWebsite: input.hasWebsite,
    websiteBroken: input.websiteBroken,
    hasSocialPresence: input.hasSocialPresence,
    hasPhone: input.hasPhone,
    checks: input.checks,
    copyrightYear: input.copyrightYear,
    platform: input.platform,
  });

  const base =
    WEIGHTS.digitalGap * gap.gap +
    WEIGHTS.businessPotential * business.score +
    WEIGHTS.buyingIntent * intent.score;

  const modifiers: ScoreBreakdown['purchase']['modifiers'] = [];
  let purchase = base;

  // Ulasilamayan lead satilamaz.
  if (!input.hasPhone && !input.hasWebsite && !input.hasSocialPresence) {
    modifiers.push({
      key: 'noContactChannel',
      label: 'Hiçbir iletişim kanalı yok (telefon/website/sosyal)',
      delta: -10,
    });
    purchase -= 10;
  }

  // Ne site ne sosyal: gap mekanik olarak 100'e yakin cikar ama bu isletmeye
  // ulasip ikna etmenin zorlugunu yansitmaz. Tavan uygulanir.
  if (!input.hasWebsite && !input.hasSocialPresence && purchase > 60) {
    modifiers.push({
      key: 'noDigitalPresenceCap',
      label: 'Dijital varlık hiç yok — skor 60 ile sınırlandı',
      delta: Math.round(60 - purchase),
    });
    purchase = 60;
  }

  const purchaseScore = Math.max(0, Math.min(100, Math.round(purchase)));

  const breakdown: ScoreBreakdown = {
    businessPotentialComponents: business.components,
    buyingIntentComponents: intent.components,
    digitalGap: gap.detail,
    purchase: {
      base: Math.round(base),
      modifiers,
      formula:
        `purchase = 0.35·gap(${gap.gap}) + 0.35·potential(${business.score}) + 0.30·intent(${intent.score}) ` +
        `= ${Math.round(base)}` +
        (modifiers.length > 0
          ? ` → modifier(${modifiers.map((m) => `${m.delta > 0 ? '+' : ''}${m.delta}`).join(', ')}) → ${purchaseScore}`
          : ''),
    },
  };

  return {
    websiteScore: input.websiteScore,
    socialScore: input.socialScore,
    businessPotential: business.score,
    digitalGap: gap.gap,
    estimatedBuyingIntent: intent.score,
    purchaseScore,
    priority: toPriority(purchaseScore),
    breakdown,
  };
}
