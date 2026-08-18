import { parseJson } from '../db/client';
import { getCompany, type CompanyRow } from '../db/repositories/companies';
import { latestWebsiteAudit } from '../db/repositories/audits';
import { ensureLead, setLeadStatus } from '../db/repositories/leads';
import { insertLeadScore, insertOffer } from '../db/repositories/scores';
import { resolveCompanySocial, aggregateResolvedSocial } from '../social-resolution';
import { computeLeadScore } from './purchase-score';
import { recommendOffer } from '../offer/engine';
import { isInstitutional } from '../sources/overpass';
import type { LeadScoreResult, OfferRecommendation, Segment } from '../types';

/**
 * Tek bir sirketi skorlar ve teklif uretir.
 *
 * Hem `npm run score` hem dashboard'daki manuel veri formu bu fonksiyonu
 * cagirir — boylece ekranda gorunen skor ile toplu calistirmadaki skor asla
 * ayrisamaz.
 */

export interface ScoreCompanyResult {
  leadId: number;
  score: LeadScoreResult;
  offer: OfferRecommendation;
}

export function scoreCompany(company: CompanyRow): ScoreCompanyResult | null {
  const websiteAudit = latestWebsiteAudit(company.id);
  if (!websiteAudit) return null; // Once denetim calismali.

  const socialAudits = resolveCompanySocial(company.id);
  const social = aggregateResolvedSocial(socialAudits);

  const checkPassed = (key: string) =>
    websiteAudit.checks.find((c) => c.key === key)?.passed === true;

  const rawTags = parseJson<Record<string, string>>(company.raw, {});
  const institutional = isInstitutional(rawTags, company.website);

  const score = computeLeadScore({
    segment: (company.segment ?? 'fitness_other') as Segment,
    district: company.location_district,
    employeeCount: company.employee_count,
    reviewCount: company.review_count,
    hasPhone: Boolean(company.phone),
    isInstitutional: institutional,

    websiteScore: websiteAudit.score,
    websiteConfidence: websiteAudit.confidence,
    hasWebsite: Boolean(company.website),
    /**
     * "Bozuk site" yalnizca sunucu HIC yanit vermediginde soylenebilir.
     * HTTP 403/503 dondugunde sunucu ayakta ve site muhtemelen calisiyor —
     * bize kapali olmasi onu bozuk yapmaz.
     */
    websiteBroken:
      Boolean(company.website) &&
      websiteAudit.status === 'unreachable' &&
      websiteAudit.httpStatus === null,
    checks: websiteAudit.checks,
    copyrightYear: websiteAudit.rawSignals.copyrightYear ?? null,
    platform: websiteAudit.rawSignals.platform ?? null,

    socialScore: social.score,
    socialConfidence: social.confidence,
    hasSocialPresence: socialAudits.length > 0,
  });

  const offer = recommendOffer({
    websiteScore: score.websiteScore,
    socialScore: score.socialScore,
    digitalGap: score.digitalGap,
    businessPotential: score.businessPotential,
    hasWebsite: Boolean(company.website),
    hasSocialPresence: socialAudits.length > 0,
    hasPhone: Boolean(company.phone),
    hasBooking: checkPassed('booking'),
    hasMembership: checkPassed('membership'),
    employeeCount: company.employee_count,
    isInstitutional: institutional,
    checks: websiteAudit.checks,
    socialConfidence: social.confidence,
    websiteConfidence: websiteAudit.confidence,
  });

  const leadId = ensureLead(company.id);
  insertLeadScore(leadId, score);
  insertOffer(leadId, offer);
  setLeadStatus(leadId, 'scored');

  return { leadId, score, offer };
}

/** Sirket id'sinden skorlama — form gibi tekil cagirimlar icin. */
export function rescoreCompanyById(companyId: number): ScoreCompanyResult | null {
  const company = getCompany(companyId);
  if (!company) return null;
  return scoreCompany(company);
}
