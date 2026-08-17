import { getDb, parseJson } from '../client';
import type {
  AuditCheck,
  Confidence,
  SocialAuditResult,
  SocialConfidence,
  SocialDataAvailability,
  SocialPlatform,
  SocialSignals,
  WebsiteAuditResult,
  WebsiteRawSignals,
} from '../../types';

interface WebsiteAuditRow {
  id: number;
  company_id: number;
  fetched_at: string;
  has_website: number;
  http_status: number | null;
  final_url: string | null;
  checks: string;
  raw_signals: string;
  score: number;
  confidence: Confidence;
  notes: string | null;
}

interface SocialAuditRow {
  id: number;
  company_id: number;
  fetched_at: string;
  platform: SocialPlatform;
  handle: string | null;
  profile_url: string | null;
  resolved: number | null;
  signals: string;
  data_available: string;
  score: number | null;
  confidence: SocialConfidence;
}

export interface StoredWebsiteAudit extends WebsiteAuditResult {
  id: number;
  companyId: number;
  fetchedAt: string;
}

export interface StoredSocialAudit extends SocialAuditResult {
  id: number;
  companyId: number;
  fetchedAt: string;
}

export function insertWebsiteAudit(companyId: number, result: WebsiteAuditResult): number {
  const row = getDb()
    .prepare(
      `INSERT INTO website_audits
         (company_id, has_website, http_status, final_url, checks, raw_signals, score, confidence, notes)
       VALUES (@companyId, @hasWebsite, @httpStatus, @finalUrl, @checks, @rawSignals, @score, @confidence, @notes)
       RETURNING id`,
    )
    .get({
      companyId,
      hasWebsite: result.hasWebsite ? 1 : 0,
      httpStatus: result.httpStatus,
      finalUrl: result.finalUrl,
      checks: JSON.stringify(result.checks),
      rawSignals: JSON.stringify(result.rawSignals),
      score: result.score,
      confidence: result.confidence,
      notes: result.notes,
    }) as { id: number };

  return row.id;
}

export function insertSocialAudit(companyId: number, result: SocialAuditResult): number {
  const row = getDb()
    .prepare(
      `INSERT INTO social_audits
         (company_id, platform, handle, profile_url, resolved, signals, data_available, score, confidence)
       VALUES (@companyId, @platform, @handle, @profileUrl, @resolved, @signals, @dataAvailable, @score, @confidence)
       RETURNING id`,
    )
    .get({
      companyId,
      platform: result.platform,
      handle: result.handle,
      profileUrl: result.profileUrl,
      resolved: result.resolved === null ? null : result.resolved ? 1 : 0,
      signals: JSON.stringify(result.signals),
      dataAvailable: JSON.stringify(result.dataAvailable),
      score: result.score,
      confidence: result.confidence,
    }) as { id: number };

  return row.id;
}

function toWebsiteAudit(row: WebsiteAuditRow): StoredWebsiteAudit {
  return {
    id: row.id,
    companyId: row.company_id,
    fetchedAt: row.fetched_at,
    hasWebsite: row.has_website === 1,
    httpStatus: row.http_status,
    finalUrl: row.final_url,
    checks: parseJson<AuditCheck[]>(row.checks, []),
    rawSignals: parseJson<WebsiteRawSignals>(row.raw_signals, {} as WebsiteRawSignals),
    score: row.score,
    confidence: row.confidence,
    notes: row.notes,
  };
}

function toSocialAudit(row: SocialAuditRow): StoredSocialAudit {
  return {
    id: row.id,
    companyId: row.company_id,
    fetchedAt: row.fetched_at,
    platform: row.platform,
    handle: row.handle,
    profileUrl: row.profile_url,
    resolved: row.resolved === null ? null : row.resolved === 1,
    signals: parseJson<SocialSignals>(row.signals, {} as SocialSignals),
    dataAvailable: parseJson<SocialDataAvailability>(row.data_available, {} as SocialDataAvailability),
    score: row.score,
    confidence: row.confidence,
  };
}

/** Sirketin en guncel website denetimi. Gecmis satirlar korunur. */
export function latestWebsiteAudit(companyId: number): StoredWebsiteAudit | null {
  const row = getDb()
    .prepare('SELECT * FROM website_audits WHERE company_id = ? ORDER BY id DESC LIMIT 1')
    .get(companyId) as WebsiteAuditRow | undefined;
  return row ? toWebsiteAudit(row) : null;
}

/** Sirketin en guncel denetim turundaki tum platform kayitlari. */
export function latestSocialAudits(companyId: number): StoredSocialAudit[] {
  const db = getDb();
  const newest = db
    .prepare('SELECT MAX(fetched_at) AS t FROM social_audits WHERE company_id = ?')
    .get(companyId) as { t: string | null };
  if (!newest.t) return [];

  const rows = db
    .prepare('SELECT * FROM social_audits WHERE company_id = ? AND fetched_at = ? ORDER BY id')
    .all(companyId, newest.t) as SocialAuditRow[];
  return rows.map(toSocialAudit);
}

export function countAuditedCompanies(): number {
  const row = getDb()
    .prepare('SELECT COUNT(DISTINCT company_id) AS n FROM website_audits')
    .get() as { n: number };
  return row.n;
}
