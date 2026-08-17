import type { SocialAuditResult, WebsiteAuditResult } from '../types';
import { fetchPage } from './fetcher';
import { auditWebsite, auditWebsiteFromPage } from './website';
import { auditSocial } from './social';

export interface CompanyAuditResult {
  website: WebsiteAuditResult;
  social: SocialAuditResult[];
}

/**
 * Bir isletmenin website + sosyal denetimini tek sayfa getirmeyle calistirir.
 * Sosyal profiller sitenin HTML'inden cikarildigi icin ikisi ayni kaynagi
 * paylasir; sayfa iki kez indirilmez.
 */
export async function auditCompany(website: string | null): Promise<CompanyAuditResult> {
  if (!website) {
    return { website: await auditWebsite(null), social: [] };
  }

  const page = await fetchPage(website);
  const websiteAudit = await auditWebsiteFromPage(page);
  const social = await auditSocial({ website, html: page.html });

  return { website: websiteAudit, social };
}

export { auditWebsite, auditWebsiteFromPage } from './website';
export { auditSocial, aggregateSocialScore } from './social';
export { fetchPage, probeUrl } from './fetcher';
