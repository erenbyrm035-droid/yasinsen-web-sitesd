import { getDb, dbExists } from '../client';
import type { OfferCode, Priority } from '../../types';
import type { SalesStatus } from '../../sales';

/**
 * Satis ekranlarinin okudugu birlestirilmis gorunumler.
 *
 * Tum sorgular tek bir temel gorunum uzerine kurulur (SALES_LEAD_SQL) —
 * dashboard, liste ve gunluk arama listesi ayni satirlari gorur, boylece
 * "dashboard 12 diyor ama liste 9 gosteriyor" durumu olusamaz.
 */

export interface SalesLeadRow {
  leadId: number;
  companyId: number;
  company: string;
  segment: string | null;
  industry: string | null;
  district: string | null;
  city: string | null;
  location: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  googlePlaceId: string | null;
  /** Harita linki — resmi kayit varsa o, yoksa arama sorgusu. */
  mapsUrl: string;
  /** Link gercek kayda mi gidiyor, yoksa arama sonucuna mi? */
  mapsExact: boolean;
  decisionMaker: string | null;
  decisionMakerTitle: string | null;
  websiteScore: number | null;
  websiteStatus: string | null;
  manualReview: boolean;
  socialScore: number | null;
  socialProfile: string | null;
  purchaseScore: number | null;
  priority: Priority | null;
  offerCode: OfferCode | null;
  offerLabel: string | null;
  salesStatus: SalesStatus;
  lastCalledAt: string | null;
  callCount: number;
  nextFollowUpAt: string | null;
  lastCallResult: string | null;
  lastCallNotes: string | null;
}

const SALES_LEAD_SQL = `
  WITH latest_score AS (
    SELECT s.* FROM lead_scores s
    JOIN (SELECT lead_id, MAX(id) AS id FROM lead_scores GROUP BY lead_id) m ON m.id = s.id
  ),
  latest_offer AS (
    SELECT o.* FROM offer_recommendations o
    JOIN (SELECT lead_id, MAX(id) AS id FROM offer_recommendations GROUP BY lead_id) m ON m.id = o.id
  ),
  latest_audit AS (
    SELECT w.* FROM website_audits w
    JOIN (SELECT company_id, MAX(id) AS id FROM website_audits GROUP BY company_id) m ON m.id = w.id
  ),
  latest_call AS (
    SELECT c.* FROM call_logs c
    JOIN (SELECT lead_id, MAX(id) AS id FROM call_logs GROUP BY lead_id) m ON m.id = c.id
  ),
  best_social AS (
    SELECT company_id, profile_url, score,
           ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY score DESC NULLS LAST, id DESC) AS rn
    FROM social_audits
  )
  SELECT
    l.id AS lead_id, c.id AS company_id, c.name AS company,
    c.segment, c.industry, c.location_district AS district, c.location_city AS city,
    c.phone, c.website, c.rating, c.review_count,
    c.google_place_id, c.maps_uri,
    ct.full_name AS decision_maker, ct.title AS decision_maker_title,
    a.score AS website_score, a.status AS website_status, a.manual_review,
    bs.score AS social_score, bs.profile_url AS social_profile,
    s.purchase_score, s.priority,
    o.offer_code, o.offer_label,
    COALESCE(l.sales_status, 'NEW') AS sales_status,
    l.last_called_at, COALESCE(l.call_count, 0) AS call_count, l.next_follow_up_at,
    lc.result AS last_call_result, lc.notes AS last_call_notes
  FROM leads l
  JOIN companies c ON c.id = l.company_id
  LEFT JOIN contacts ct ON ct.id = l.primary_contact_id
  LEFT JOIN latest_score s ON s.lead_id = l.id
  LEFT JOIN latest_offer o ON o.lead_id = l.id
  LEFT JOIN latest_audit a ON a.company_id = c.id
  LEFT JOIN latest_call lc ON lc.lead_id = l.id
  LEFT JOIN best_social bs ON bs.company_id = c.id AND bs.rn = 1
`;

interface SqlRow {
  lead_id: number;
  company_id: number;
  company: string;
  segment: string | null;
  industry: string | null;
  district: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  google_place_id: string | null;
  maps_uri: string | null;
  decision_maker: string | null;
  decision_maker_title: string | null;
  website_score: number | null;
  website_status: string | null;
  manual_review: number | null;
  social_score: number | null;
  social_profile: string | null;
  purchase_score: number | null;
  priority: Priority | null;
  offer_code: OfferCode | null;
  offer_label: string | null;
  sales_status: SalesStatus;
  last_called_at: string | null;
  call_count: number;
  next_follow_up_at: string | null;
  last_call_result: string | null;
  last_call_notes: string | null;
}

/**
 * Harita linki, guclu kaynaktan zayifa:
 *
 *   1. Places'in dondurdugu resmi googleMapsUri  -> tam kayit, tek dogru yer
 *   2. Place ID ile kayit sorgusu                -> yine tam kayit
 *   3. Ad + ilce arama sorgusu                   -> yalnizca son care
 *
 * 3. secenek yanlis isletmeye gotur ebilir; bu yuzden yalnizca elde kimlik
 * yokken kullanilir (OSM kaynakli lead'ler).
 */
function mapsUrlFor(r: SqlRow): string {
  if (r.maps_uri) return r.maps_uri;
  if (r.google_place_id) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      r.company,
    )}&query_place_id=${encodeURIComponent(r.google_place_id)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [r.company, r.district, r.city].filter(Boolean).join(' '),
  )}`;
}

function toRow(r: SqlRow): SalesLeadRow {
  return {
    leadId: r.lead_id,
    companyId: r.company_id,
    company: r.company,
    segment: r.segment,
    industry: r.industry,
    district: r.district,
    city: r.city,
    location: [r.district, r.city].filter(Boolean).join(', ') || null,
    phone: r.phone,
    website: r.website,
    googlePlaceId: r.google_place_id,
    mapsUrl: mapsUrlFor(r),
    mapsExact: Boolean(r.maps_uri || r.google_place_id),
    rating: r.rating,
    reviewCount: r.review_count,
    decisionMaker: r.decision_maker,
    decisionMakerTitle: r.decision_maker_title,
    websiteScore: r.website_score,
    websiteStatus: r.website_status,
    manualReview: r.manual_review === 1,
    socialScore: r.social_score,
    socialProfile: r.social_profile,
    purchaseScore: r.purchase_score,
    priority: r.priority,
    offerCode: r.offer_code,
    offerLabel: r.offer_label,
    salesStatus: r.sales_status ?? 'NEW',
    lastCalledAt: r.last_called_at,
    callCount: r.call_count ?? 0,
    nextFollowUpAt: r.next_follow_up_at,
    lastCallResult: r.last_call_result,
    lastCallNotes: r.last_call_notes,
  };
}

const PRIORITY_ORDER = `CASE s.priority
  WHEN 'HOT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END`;

export function listSalesLeads(): SalesLeadRow[] {
  if (!dbExists()) return [];
  const rows = getDb()
    .prepare(`${SALES_LEAD_SQL} ORDER BY s.purchase_score DESC NULLS LAST, c.name ASC`)
    .all() as SqlRow[];
  return rows.map(toRow);
}

export function getSalesLead(leadId: number): SalesLeadRow | null {
  if (!dbExists()) return null;
  const row = getDb().prepare(`${SALES_LEAD_SQL} WHERE l.id = ?`).get(leadId) as SqlRow | undefined;
  return row ? toRow(row) : null;
}

/**
 * Gunluk arama listesi.
 *
 * Siralama sartnamedeki oncelige birebir uyar:
 *   1. HOT  2. HIGH  3. purchase score  4. hic aranmamis  5. telefonu olan
 *
 * Kapanmis lead'ler (WON/LOST/ilgilenmedi/iletisim kurma) listeye girmez —
 * gunluk liste yapilacak isi gosterir, arsivi degil.
 */
export function listTodayCallList(limit = 25): SalesLeadRow[] {
  if (!dbExists()) return [];
  const rows = getDb()
    .prepare(
      `${SALES_LEAD_SQL}
       WHERE COALESCE(l.sales_status, 'NEW') NOT IN ('WON','LOST','NOT_INTERESTED','DO_NOT_CONTACT')
         AND c.phone IS NOT NULL AND TRIM(c.phone) <> ''
         AND (
           l.next_follow_up_at IS NULL
           OR date(l.next_follow_up_at) <= date('now','localtime')
         )
       ORDER BY ${PRIORITY_ORDER},
                s.purchase_score DESC NULLS LAST,
                COALESCE(l.call_count, 0) ASC,
                c.name ASC
       LIMIT ?`,
    )
    .all(limit) as SqlRow[];
  return rows.map(toRow);
}

/** Takip tarihi bugun ya da gecmiste kalmis, hala acik olan lead'ler. */
export function listFollowUpsDue(): { today: SalesLeadRow[]; overdue: SalesLeadRow[] } {
  if (!dbExists()) return { today: [], overdue: [] };
  const rows = getDb()
    .prepare(
      `${SALES_LEAD_SQL}
       WHERE l.next_follow_up_at IS NOT NULL
         AND COALESCE(l.sales_status, 'NEW') NOT IN ('WON','LOST','DO_NOT_CONTACT')
         AND date(l.next_follow_up_at) <= date('now','localtime')
       ORDER BY l.next_follow_up_at ASC`,
    )
    .all() as SqlRow[];

  const today: SalesLeadRow[] = [];
  const overdue: SalesLeadRow[] = [];
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const r of rows.map(toRow)) {
    const day = (r.nextFollowUpAt ?? '').slice(0, 10);
    if (day < todayStr) overdue.push(r);
    else today.push(r);
  }
  return { today, overdue };
}

// --- istatistikler ----------------------------------------------------------

export interface SalesStats {
  totalLeads: number;
  readyToCall: number;
  called: number;
  contacted: number;
  interested: number;
  offerSent: number;
  won: number;
  lost: number;
  followUpDue: number;
  hot: number;
  high: number;
  medium: number;
  low: number;
  /** Donusum oranlari — payda 0 ise null (0% yazmak yaniltici olurdu). */
  rates: {
    callToContact: number | null;
    contactToInterest: number | null;
    interestToOffer: number | null;
    offerToWon: number | null;
    leadToWon: number | null;
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 100);
}

export function getSalesStats(): SalesStats {
  const empty: SalesStats = {
    totalLeads: 0, readyToCall: 0, called: 0, contacted: 0, interested: 0,
    offerSent: 0, won: 0, lost: 0, followUpDue: 0,
    hot: 0, high: 0, medium: 0, low: 0,
    rates: { callToContact: null, contactToInterest: null, interestToOffer: null, offerToWon: null, leadToWon: null },
  };
  if (!dbExists()) return empty;

  const db = getDb();

  const totals = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM leads) AS total,
         (SELECT COUNT(*) FROM leads WHERE COALESCE(sales_status,'NEW') = 'READY_TO_CALL') AS ready,
         (SELECT COUNT(*) FROM leads WHERE COALESCE(call_count,0) > 0) AS called,
         (SELECT COUNT(DISTINCT lead_id) FROM call_logs
            WHERE result IN ('REACHED','INTERESTED','NOT_INTERESTED','ASKED_OFFER','CALLBACK')) AS contacted,
         (SELECT COUNT(*) FROM leads WHERE COALESCE(sales_status,'NEW') IN ('INTERESTED','NEGOTIATION')) AS interested,
         (SELECT COUNT(DISTINCT lead_id) FROM offers) AS offer_sent,
         (SELECT COUNT(*) FROM leads WHERE COALESCE(sales_status,'NEW') = 'WON') AS won,
         (SELECT COUNT(*) FROM leads WHERE COALESCE(sales_status,'NEW') = 'LOST') AS lost,
         (SELECT COUNT(*) FROM leads
            WHERE next_follow_up_at IS NOT NULL
              AND date(next_follow_up_at) <= date('now','localtime')
              AND COALESCE(sales_status,'NEW') NOT IN ('WON','LOST','DO_NOT_CONTACT')) AS follow_due`,
    )
    .get() as Record<string, number>;

  const priorities = db
    .prepare(
      `WITH latest AS (
         SELECT s.* FROM lead_scores s
         JOIN (SELECT lead_id, MAX(id) AS id FROM lead_scores GROUP BY lead_id) m ON m.id = s.id
       )
       SELECT
         SUM(CASE WHEN priority = 'HOT'    THEN 1 ELSE 0 END) AS hot,
         SUM(CASE WHEN priority = 'HIGH'   THEN 1 ELSE 0 END) AS high,
         SUM(CASE WHEN priority = 'MEDIUM' THEN 1 ELSE 0 END) AS medium,
         SUM(CASE WHEN priority = 'LOW'    THEN 1 ELSE 0 END) AS low
       FROM latest`,
    )
    .get() as Record<string, number | null>;

  // "Teklif istedi" ile biten gorusmeler ilgi -> teklif hunisinin paydasi.
  const interestedEver = db
    .prepare(
      `SELECT COUNT(DISTINCT lead_id) AS n FROM call_logs WHERE result IN ('INTERESTED','ASKED_OFFER')`,
    )
    .get() as { n: number };

  return {
    totalLeads: totals.total,
    readyToCall: totals.ready,
    called: totals.called,
    contacted: totals.contacted,
    interested: totals.interested,
    offerSent: totals.offer_sent,
    won: totals.won,
    lost: totals.lost,
    followUpDue: totals.follow_due,
    hot: priorities.hot ?? 0,
    high: priorities.high ?? 0,
    medium: priorities.medium ?? 0,
    low: priorities.low ?? 0,
    rates: {
      callToContact: ratio(totals.contacted, totals.called),
      contactToInterest: ratio(interestedEver.n, totals.contacted),
      interestToOffer: ratio(totals.offer_sent, interestedEver.n),
      offerToWon: ratio(totals.won, totals.offer_sent),
      leadToWon: ratio(totals.won, totals.total),
    },
  };
}
