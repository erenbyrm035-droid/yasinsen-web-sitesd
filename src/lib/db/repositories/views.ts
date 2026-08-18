import { getDb, dbExists } from '../client';
import type { OfferCode, Priority } from '../../types';
import { latestWebsiteAudit, type StoredWebsiteAudit } from './audits';
import { resolveCompanySocial, type MergedSocialAudit } from '../../social-resolution';
import { listManualInputs, type StoredSocialManualInput } from './social-manual';
import { latestLeadScore, latestOffer, type StoredLeadScore, type StoredOffer } from './scores';
import { getCompany, listContacts, type CompanyRow, type ContactRow } from './companies';

/**
 * Dashboard'in okudugu birlestirilmis gorunumler.
 * Her lead icin "en guncel" skor/denetim satiri alinir; gecmis korunur.
 */

export interface DashboardStats {
  totalLeads: number;
  analyzed: number;
  hotLeads: number;
  highPotential: number;
  averageScore: number | null;
}

export interface LeadTableRow {
  leadId: number;
  companyId: number;
  company: string;
  website: string | null;
  decisionMaker: string | null;
  decisionMakerTitle: string | null;
  industry: string | null;
  segment: string | null;
  location: string | null;
  /** Places kaynagindan gelir — aranacak listenin en islevsel alani. */
  phone: string | null;
  websiteScore: number | null;
  socialScore: number | null;
  socialConfidence: string | null;
  purchaseScore: number | null;
  offerCode: OfferCode | null;
  offerLabel: string | null;
  priority: Priority | null;
  status: string;
}

interface LeadTableSqlRow {
  lead_id: number;
  company_id: number;
  company: string;
  website: string | null;
  industry: string | null;
  segment: string | null;
  district: string | null;
  city: string | null;
  phone: string | null;
  status: string;
  decision_maker: string | null;
  decision_maker_title: string | null;
  website_score: number | null;
  social_score: number | null;
  purchase_score: number | null;
  priority: Priority | null;
  offer_code: OfferCode | null;
  offer_label: string | null;
  social_confidence: string | null;
}

/**
 * Her lead icin en guncel skor + teklif + karar verici.
 * Skoru olmayan lead'ler de doner (purchase_score NULL) — pipeline'in yarim
 * kaldigi durumlar dashboard'da gorunur olsun.
 */
const LEAD_TABLE_SQL = `
  SELECT
    l.id                AS lead_id,
    c.id                AS company_id,
    c.name              AS company,
    c.website           AS website,
    c.industry          AS industry,
    c.segment           AS segment,
    c.location_district AS district,
    c.location_city     AS city,
    c.phone             AS phone,
    l.status            AS status,
    ct.full_name        AS decision_maker,
    ct.title            AS decision_maker_title,
    s.website_score     AS website_score,
    s.social_score      AS social_score,
    s.purchase_score    AS purchase_score,
    s.priority          AS priority,
    o.offer_code        AS offer_code,
    o.offer_label       AS offer_label,
    (
      SELECT sa.confidence FROM social_audits sa
      WHERE sa.company_id = c.id
      ORDER BY sa.score DESC NULLS LAST, sa.id DESC LIMIT 1
    )                   AS social_confidence
  FROM leads l
  JOIN companies c ON c.id = l.company_id
  LEFT JOIN contacts ct ON ct.id = l.primary_contact_id
  LEFT JOIN lead_scores s
    ON s.id = (SELECT id FROM lead_scores WHERE lead_id = l.id ORDER BY id DESC LIMIT 1)
  LEFT JOIN offer_recommendations o
    ON o.id = (SELECT id FROM offer_recommendations WHERE lead_id = l.id ORDER BY id DESC LIMIT 1)
  ORDER BY s.purchase_score DESC NULLS LAST, c.name ASC
`;

export function listLeadTable(): LeadTableRow[] {
  if (!dbExists()) return [];

  const rows = getDb().prepare(LEAD_TABLE_SQL).all() as LeadTableSqlRow[];
  return rows.map((r) => ({
    leadId: r.lead_id,
    companyId: r.company_id,
    company: r.company,
    website: r.website,
    decisionMaker: r.decision_maker,
    decisionMakerTitle: r.decision_maker_title,
    industry: r.industry,
    segment: r.segment,
    location: [r.district, r.city].filter(Boolean).join(', ') || null,
    phone: r.phone,
    websiteScore: r.website_score,
    socialScore: r.social_score,
    socialConfidence: r.social_confidence,
    purchaseScore: r.purchase_score,
    offerCode: r.offer_code,
    offerLabel: r.offer_label,
    priority: r.priority,
    status: r.status,
  }));
}

export function getDashboardStats(): DashboardStats {
  if (!dbExists()) {
    return { totalLeads: 0, analyzed: 0, hotLeads: 0, highPotential: 0, averageScore: null };
  }

  const db = getDb();
  const totals = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM leads)                              AS total,
         (SELECT COUNT(DISTINCT company_id) FROM website_audits)   AS analyzed`,
    )
    .get() as { total: number; analyzed: number };

  // Her lead'in yalnizca en guncel skoru sayilir.
  const priorities = db
    .prepare(
      `WITH latest AS (
         SELECT s.* FROM lead_scores s
         JOIN (SELECT lead_id, MAX(id) AS id FROM lead_scores GROUP BY lead_id) m
           ON m.id = s.id
       )
       SELECT
         SUM(CASE WHEN priority = 'HOT'  THEN 1 ELSE 0 END) AS hot,
         SUM(CASE WHEN priority = 'HIGH' THEN 1 ELSE 0 END) AS high,
         AVG(purchase_score)                                AS avg_score
       FROM latest`,
    )
    .get() as { hot: number | null; high: number | null; avg_score: number | null };

  return {
    totalLeads: totals.total,
    analyzed: totals.analyzed,
    hotLeads: priorities.hot ?? 0,
    highPotential: priorities.high ?? 0,
    averageScore: priorities.avg_score === null ? null : Math.round(priorities.avg_score),
  };
}

export interface LeadDetail {
  leadId: number;
  status: string;
  company: CompanyRow;
  contacts: ContactRow[];
  websiteAudit: StoredWebsiteAudit | null;
  /** Otomatik denetim + elle girilen metrikler birlesik. */
  socialAudits: MergedSocialAudit[];
  manualInputs: StoredSocialManualInput[];
  score: StoredLeadScore | null;
  offer: StoredOffer | null;
}

export function getLeadDetail(leadId: number): LeadDetail | null {
  if (!dbExists()) return null;

  const lead = getDb().prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as
    | { id: number; company_id: number; status: string }
    | undefined;
  if (!lead) return null;

  const company = getCompany(lead.company_id);
  if (!company) return null;

  return {
    leadId: lead.id,
    status: lead.status,
    company,
    contacts: listContacts(company.id),
    websiteAudit: latestWebsiteAudit(company.id),
    socialAudits: resolveCompanySocial(company.id),
    manualInputs: listManualInputs(company.id),
    score: latestLeadScore(lead.id),
    offer: latestOffer(lead.id),
  };
}
