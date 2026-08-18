import { getDb, parseJson } from '../client';
import type {
  Confidence,
  LeadScoreResult,
  OfferCode,
  OfferRecommendation,
  Priority,
  ScoreBreakdown,
} from '../../types';

interface LeadScoreRow {
  id: number;
  lead_id: number;
  website_score: number | null;
  social_score: number | null;
  business_potential: number;
  digital_gap: number | null;
  estimated_buying_intent: number;
  purchase_score: number;
  priority: Priority;
  breakdown: string;
  computed_at: string;
}

interface OfferRow {
  id: number;
  lead_id: number;
  offer_code: OfferCode;
  offer_label: string;
  rationale: string;
  digital_gaps: string;
  confidence: Confidence;
  created_at: string;
}

export interface StoredLeadScore extends LeadScoreResult {
  id: number;
  leadId: number;
  computedAt: string;
}

export interface StoredOffer extends OfferRecommendation {
  id: number;
  leadId: number;
  createdAt: string;
}

export function insertLeadScore(leadId: number, score: LeadScoreResult): number {
  const row = getDb()
    .prepare(
      `INSERT INTO lead_scores
         (lead_id, website_score, social_score, business_potential, digital_gap,
          estimated_buying_intent, purchase_score, priority, breakdown)
       VALUES (@leadId, @websiteScore, @socialScore, @businessPotential, @digitalGap,
               @buyingIntent, @purchaseScore, @priority, @breakdown)
       RETURNING id`,
    )
    .get({
      leadId,
      websiteScore: score.websiteScore,
      socialScore: score.socialScore,
      businessPotential: score.businessPotential,
      digitalGap: score.digitalGap,
      buyingIntent: score.estimatedBuyingIntent,
      purchaseScore: score.purchaseScore,
      priority: score.priority,
      breakdown: JSON.stringify(score.breakdown),
    }) as { id: number };

  return row.id;
}

export function insertOffer(leadId: number, offer: OfferRecommendation): number {
  const row = getDb()
    .prepare(
      `INSERT INTO offer_recommendations
         (lead_id, offer_code, offer_label, rationale, digital_gaps, confidence)
       VALUES (@leadId, @offerCode, @offerLabel, @rationale, @digitalGaps, @confidence)
       RETURNING id`,
    )
    .get({
      leadId,
      offerCode: offer.offerCode,
      offerLabel: offer.offerLabel,
      rationale: offer.rationale,
      digitalGaps: JSON.stringify(offer.digitalGaps),
      confidence: offer.confidence,
    }) as { id: number };

  return row.id;
}

export function latestLeadScore(leadId: number): StoredLeadScore | null {
  const row = getDb()
    .prepare('SELECT * FROM lead_scores WHERE lead_id = ? ORDER BY id DESC LIMIT 1')
    .get(leadId) as LeadScoreRow | undefined;
  if (!row) return null;

  return {
    id: row.id,
    leadId: row.lead_id,
    computedAt: row.computed_at,
    websiteScore: row.website_score,
    socialScore: row.social_score,
    businessPotential: row.business_potential,
    digitalGap: row.digital_gap,
    estimatedBuyingIntent: row.estimated_buying_intent,
    purchaseScore: row.purchase_score,
    priority: row.priority,
    breakdown: parseJson<ScoreBreakdown>(row.breakdown, {} as ScoreBreakdown),
  };
}

export function latestOffer(leadId: number): StoredOffer | null {
  const row = getDb()
    .prepare('SELECT * FROM offer_recommendations WHERE lead_id = ? ORDER BY id DESC LIMIT 1')
    .get(leadId) as OfferRow | undefined;
  if (!row) return null;

  return {
    id: row.id,
    leadId: row.lead_id,
    createdAt: row.created_at,
    offerCode: row.offer_code,
    offerLabel: row.offer_label,
    rationale: row.rationale,
    digitalGaps: parseJson<string[]>(row.digital_gaps, []),
    confidence: row.confidence,
  };
}
