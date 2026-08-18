import type { SocialAuditResult, SocialAuditStatus, WebsiteAuditResult } from '../types';
import { fetchPage } from './fetcher';
import { auditWebsite, auditWebsiteFromPage } from './website';
import { auditSocial } from './social';
import type { DiscoveryCompany } from './social-discovery';

export interface CompanyAuditResult {
  website: WebsiteAuditResult;
  social: SocialAuditResult[];
  /** Profil bulunamadiysa nedeni: arandi mi, aranamadi mi. */
  socialStatus: SocialAuditStatus;
  socialDetail: string;
  /** Dogrulanamadigi icin REDDEDILEN adaylar — kaydedilmez, izlenebilir kalir. */
  socialRejected: { url: string; score: number; reason: string }[];
}

/**
 * Bir isletmenin website + sosyal denetimini tek sayfa getirmeyle calistirir.
 * Sosyal profiller sitenin HTML'inden cikarildigi icin ikisi ayni kaynagi
 * paylasir; sayfa iki kez indirilmez.
 */
export async function auditCompany(
  website: string | null,
  company?: DiscoveryCompany,
): Promise<CompanyAuditResult> {
  // Site yoksa bile sosyal medya araniir: "sitesi yok ama Instagram'da aktif"
  // fitness sektorunde cok yaygin ve satis acisindan degerli bir durum.
  if (!website) {
    const websiteAudit = await auditWebsite(null);
    const social = await auditSocial({ website: null, html: null, company });
    return {
      website: websiteAudit,
      social: social.audits,
      socialStatus: social.status,
      socialDetail: social.detail,
      socialRejected: social.rejected,
    };
  }

  const page = await fetchPage(website);
  const websiteAudit = await auditWebsiteFromPage(page);

  // Denetim engellendiyse gelen HTML bot korumasi sayfasidir; ondan sosyal
  // link cikarmaya calismak anlamsiz. Bu durumda arama yolu devreye girer.
  const usableHtml = websiteAudit.status === 'ok' ? page.html : null;
  const social = await auditSocial({ website, html: usableHtml, company });

  return {
    website: websiteAudit,
    social: social.audits,
    socialStatus: social.status,
    socialDetail: social.detail,
    socialRejected: social.rejected,
  };
}

export { auditWebsite, auditWebsiteFromPage } from './website';
export { auditSocial, aggregateSocialScore } from './social';
export { fetchPage, probeUrl } from './fetcher';
