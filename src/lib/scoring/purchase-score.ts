import type {
  AuditConfidence,
  AuditCheck,
  LeadScoreResult,
  Priority,
  ScoreBreakdown,
  Segment,
  SocialConfidence,
} from '../types';
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
  /** Google yorum sayisi — yalnizca Places kaynagi doldurur. */
  reviewCount?: number | null;

  /** Denetlenemediyse null. Sifir DEGIL — bkz. digital-gap.ts. */
  websiteScore: number | null;
  websiteConfidence: AuditConfidence;
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
    reviewCount: input.reviewCount ?? null,
    hasWebsite: input.hasWebsite && !input.websiteBroken,
    hasSocialPresence: input.hasSocialPresence,
    hasPhone: input.hasPhone,
    isInstitutional: input.isInstitutional,
  });

  const gap = computeDigitalGap(
    input.websiteScore,
    input.socialScore,
    input.socialConfidence,
    input.websiteConfidence,
  );

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

  /**
   * Agirliklar yalnizca OLCULEBILEN bilesenler uzerinden normalize edilir.
   *
   * Dijital acik hesaplanamadiginda (site bot korumasi arkasinda, sosyal de
   * yok) o bilesen formulden tamamen cikarilir; sifir sayilmaz. Kalan iki
   * bilesenin agirligi 1'e olceklenir.
   *
   * Neden onemli: gap'i 0 saymak lead'i haksiz yere dibe atardi, 100 saymak
   * ise haksiz yere tepeye. Ikisi de uydurma olurdu. Dogru cevap "bu bilesen
   * hakkinda bir sey bilmiyoruz"tur.
   */
  const parts: { weight: number; value: number }[] = [
    { weight: WEIGHTS.businessPotential, value: business.score },
    { weight: WEIGHTS.buyingIntent, value: intent.score },
  ];
  if (gap.gap !== null) {
    parts.unshift({ weight: WEIGHTS.digitalGap, value: gap.gap });
  }

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const base = parts.reduce((sum, p) => sum + (p.weight / totalWeight) * p.value, 0);

  const modifiers: ScoreBreakdown['purchase']['modifiers'] = [];
  let purchase = base;

  /**
   * ULASILABILIRLIK CARPANI
   *
   * 100 lead'lik kalibrasyon calismasindan cikan bulgu: hicbir iletisim kanali
   * olmayan isletmeler digital_gap = 100 aliyor ve sistem bunu "devasa firsat"
   * sanip skoru yukseltiyordu. Oysa ulasilamayan isletme firsat degildir —
   * gap'i doldurmak icin once o isletmeye ulasmak gerekir.
   *
   * Sabit -10 ceza bu etkiyi kapatmiyordu (100 lead'in 85'i MEDIUM'a yigilmisti).
   * Bunun yerine skor, ulasilabilirlikle CARPILIR: kanal sayisi arttikca skor
   * gercek degerine yaklasir.
   */
  const channels = [input.hasPhone, input.hasWebsite, input.hasSocialPresence].filter(
    Boolean,
  ).length;

  const REACHABILITY: Record<number, { factor: number; label: string }> = {
    0: { factor: 0.55, label: 'Hiçbir iletişim kanalı yok — ulaşılamayan lead' },
    1: { factor: 0.85, label: 'Tek iletişim kanalı — ulaşmak zor' },
  };

  const reach = REACHABILITY[channels];
  if (reach) {
    const after = purchase * reach.factor;
    modifiers.push({
      key: 'reachability',
      label: `${reach.label} (×${reach.factor})`,
      delta: Math.round(after - purchase),
    });
    purchase = after;
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
        (gap.gap === null
          ? `purchase = ${(WEIGHTS.businessPotential / totalWeight).toFixed(2)}·potential(${business.score}) + ` +
            `${(WEIGHTS.buyingIntent / totalWeight).toFixed(2)}·intent(${intent.score}) ` +
            '— dijital açık ölçülemedi, ağırlığı diğer bileşenlere dağıtıldı '
          : `purchase = 0.35·gap(${gap.gap}) + 0.35·potential(${business.score}) + 0.30·intent(${intent.score}) `) +
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
