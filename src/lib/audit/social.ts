import type {
  SocialAuditResult,
  SocialAuditStatus,
  SocialConfidence,
  SocialDataAvailability,
  SocialMatch,
  SocialPlatform,
} from '../types';
import { fetchPage, probeUrl } from './fetcher';
import { hasSocialFeedEmbed, type SocialLink } from './signals';
import {
  discoverSocialProfiles,
  type DiscoveryCompany,
  type DiscoveryOutcome,
} from './social-discovery';

/**
 * SOCIAL MEDIA AUDIT — sinyal bazli.
 *
 * ONEMLI KISIT (2026-08 itibariyle dogrulandi): Instagram public profil
 * sayfalari login duvarinin arkasinda. Anonim istek 200 donuyor ama sayfada
 * ne takipci sayisi, ne post sayisi, ne de og:description bulunuyor.
 *
 * Bu yuzden sartnamedeki su maddeler SU AN OLCULEMEZ ve `dataAvailable`
 * icinde false olarak isaretlenir; degerleri uydurulmaz:
 *   profil aktifligi, icerik sikligi, Reels kullanimi, gorsel kalite,
 *   bio, etkilesim sinyalleri, satisa yonelik icerik, bio'daki site linki.
 *
 * OLCULEBILEN sinyaller (skor yalnizca bunlardan uretilir):
 *   * sitede sosyal profil linki var mi
 *   * link ettigi profil gercekten cozuluyor mu (200 / 404)
 *   * kac farkli platformda varlik gosteriyor
 *   * sitede gomulu sosyal feed var mi
 *   * link one cikan bir yerde mi (fold ustu / header)
 *
 * Skor yalnizca olculebilen sinyallerin agirligi uzerinden normalize edilir
 * ve daima `confidence: 'low'` ile saklanir — dashboard bunu acikca gosterir.
 * Gercek metrik icin Instagram Graph API baglanmali (bkz. docs/SOCIAL.md).
 */

/** Hicbir metrik su an olculemiyor. Bu nesne dashboard'da "veri yok" rozetlerine donusur. */
const UNAVAILABLE_METRICS: SocialDataAvailability = {
  followers: false,
  postFrequency: false,
  reelsUsage: false,
  visualQuality: false,
  bio: false,
  engagement: false,
  salesContent: false,
  websiteLinkInBio: false,
};

const SIGNAL_WEIGHTS = {
  linkOnSite: 30,
  handleResolves: 35,
  platformCount: 20,
  feedEmbedOnSite: 10,
  linkPlacementProminent: 5,
} as const;

export interface SocialAuditInput {
  website: string | null;
  /** Website denetimi zaten HTML'i getirdiyse tekrar indirmemek icin. */
  html?: string | null;
  /** Arama ile kesif ve kimlik dogrulamasi icin isletme bilgileri. */
  company?: DiscoveryCompany;
}

export interface SocialAuditOutcome {
  audits: SocialAuditResult[];
  /** Hicbir profil bulunamadiysa nedeni — 'not_found' mu 'not_searched' mi. */
  status: SocialAuditStatus;
  detail: string;
  rejected: DiscoveryOutcome['rejected'];
}

/**
 * Sirketin sosyal varligini denetler.
 * Website yoksa sosyal profil kesfedilecek dogrulanabilir bir kaynak da yok —
 * bos liste doner (tahmini handle uretilmez).
 */
export async function auditSocial(input: SocialAuditInput): Promise<SocialAuditOutcome> {
  let html = input.html ?? null;

  if (!html && input.website) {
    const page = await fetchPage(input.website);
    // Sadece gercekten basarili yanitin HTML'i kullanilir; bot korumasi
    // sayfasindan sosyal link cikarmanin anlami yok.
    html = page.status !== null && page.status < 400 ? page.html : null;
  }

  const company: DiscoveryCompany = input.company ?? {
    name: '',
    website: input.website,
    city: null,
    district: null,
    phone: null,
  };

  const discovery = await discoverSocialProfiles(company, html);

  if (discovery.profiles.length === 0) {
    return {
      audits: [],
      status: discovery.searched ? 'not_found' : 'not_searched',
      detail: discovery.searchReason,
      rejected: discovery.rejected,
    };
  }

  const feedEmbed = html ? hasSocialFeedEmbed(html) : false;
  // Fold ustu / header bolgesi: linkin one cikip cikmadigina dair kaba gosterge.
  const prominentArea = html ? html.slice(0, 15_000) : '';

  const audits: SocialAuditResult[] = [];

  for (const profile of discovery.profiles) {
    const resolved = await probeUrl(profile.link.url);
    audits.push(
      buildResult(profile.link, {
        resolved,
        platformCount: discovery.profiles.length,
        feedEmbed,
        // Arama ile bulunan profil sitede yer almadigi icin "one cikan
        // konumda" olamaz; olculmemis sayilir.
        prominent: profile.source === 'website' ? prominentArea.includes(profile.link.url) : null,
        status: profile.source === 'website' ? 'on_site' : 'verified',
        match: profile.match,
      }),
    );
  }

  return {
    audits,
    status: discovery.profiles.some((p) => p.source === 'website') ? 'on_site' : 'verified',
    detail: discovery.searchReason,
    rejected: discovery.rejected,
  };
}

function buildResult(
  link: SocialLink,
  ctx: {
    resolved: boolean | null;
    platformCount: number;
    feedEmbed: boolean;
    prominent: boolean | null;
    status: SocialAuditStatus;
    match: SocialMatch;
  },
): SocialAuditResult {
  const onSite = ctx.status === 'on_site';
  const signals = {
    linkOnSite: onSite,
    handleResolves: ctx.resolved,
    platformCount: ctx.platformCount,
    feedEmbedOnSite: ctx.feedEmbed,
    linkPlacementProminent: ctx.prominent,
  };

  // Yalnizca olculebilen sinyaller paya ve paydaya girer.
  let earned = 0;
  let achievable = 0;

  // "Sitede link var" sinyali yalnizca site okunabildiyse anlamlidir.
  // Arama ile bulunan profilde bu sinyal olculmemis sayilir; yoklugu
  // ceza olarak yazilmaz.
  if (onSite) {
    achievable += SIGNAL_WEIGHTS.linkOnSite;
    earned += SIGNAL_WEIGHTS.linkOnSite;
  }

  // Profil cozulemediyse (403/zaman asimi) bu sinyal skora hic katilmaz.
  if (ctx.resolved !== null) {
    achievable += SIGNAL_WEIGHTS.handleResolves;
    if (ctx.resolved) earned += SIGNAL_WEIGHTS.handleResolves;
  }

  achievable += SIGNAL_WEIGHTS.platformCount;
  earned += SIGNAL_WEIGHTS.platformCount * Math.min(ctx.platformCount / 3, 1);

  if (onSite) {
    achievable += SIGNAL_WEIGHTS.feedEmbedOnSite;
    if (ctx.feedEmbed) earned += SIGNAL_WEIGHTS.feedEmbedOnSite;
  }

  if (ctx.prominent !== null) {
    achievable += SIGNAL_WEIGHTS.linkPlacementProminent;
    if (ctx.prominent) earned += SIGNAL_WEIGHTS.linkPlacementProminent;
  }

  const score = achievable === 0 ? null : Math.round((earned / achievable) * 100);

  // Metriklerin hicbiri olculemedigi surece guven daima 'low'.
  const confidence: SocialConfidence = score === null ? 'none' : 'low';

  return {
    platform: link.platform as SocialPlatform,
    handle: link.handle,
    profileUrl: link.url,
    resolved: ctx.resolved,
    signals,
    dataAvailable: UNAVAILABLE_METRICS,
    score,
    confidence,
    status: ctx.status,
    match: ctx.match,
  };
}

/**
 * Sirketin genel sosyal skoru: platformlarin en iyisi.
 * Hic olculebilir sinyal yoksa null — 0 DEGIL. "Sosyal medyası yok" ile
 * "sosyal medyası ölçülemedi" ayri seylerdir ve skorlamada farkli davranirlar.
 */
export function aggregateSocialScore(audits: SocialAuditResult[]): {
  score: number | null;
  confidence: SocialConfidence;
} {
  const scored = audits.filter((a) => a.score !== null);
  if (scored.length === 0) return { score: null, confidence: 'none' };

  const best = Math.max(...scored.map((a) => a.score as number));
  return { score: best, confidence: 'low' };
}
