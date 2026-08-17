import type { SocialAuditResult, SocialConfidence, SocialDataAvailability } from '../types';
import type { StoredSocialManualInput } from '../db/repositories/social-manual';

/**
 * Elle girilen sosyal medya metriklerini denetim sonucuyla birlestirir.
 *
 * Otomatik denetim yalnizca "sitede link var mi, profil cozuluyor mu" gibi
 * kabuk sinyalleri olcebiliyor (Instagram login duvari). Elle veri girildiginde
 * ICERIK KALITESI de olculebilir hale gelir ve skor tam rubrige gecer.
 *
 * Kural: yalnizca GIRILEN alanlar hesaba katilir. Bos birakilan alan
 * paydadan da dusulur — "girilmedi" asla "kotu" demek degildir.
 */

/** Manuel rubrik agirliklari — hepsi girilirse toplam 100. */
const MANUAL_WEIGHTS = {
  followers: 20,
  postFrequency: 20,
  reels: 15,
  engagement: 20,
  visualQuality: 10,
  salesContent: 10,
  bio: 5,
} as const;

/** Otomatik sinyallerin birlesik skordaki payi (geri kalani manuel rubrik). */
const AUTO_WEIGHT_WHEN_MANUAL = 0.3;

function followersScore(n: number): number {
  if (n >= 10_000) return 100;
  if (n >= 5_000) return 85;
  if (n >= 2_000) return 70;
  if (n >= 500) return 50;
  if (n >= 100) return 30;
  return 15;
}

function postFrequencyScore(posts: number): number {
  if (posts >= 20) return 100;
  if (posts >= 12) return 85;
  if (posts >= 8) return 70;
  if (posts >= 4) return 50;
  if (posts >= 1) return 25;
  return 0;
}

function reelsScore(reels: number): number {
  if (reels >= 8) return 100;
  if (reels >= 4) return 80;
  if (reels >= 2) return 60;
  if (reels >= 1) return 40;
  return 10;
}

/** Etkilesim orani = ortalama begeni / takipci. Ikisi de gerekli. */
function engagementScore(avgLikes: number, followers: number): number | null {
  if (followers <= 0) return null;
  const rate = (avgLikes / followers) * 100;
  if (rate >= 6) return 100;
  if (rate >= 3) return 85;
  if (rate >= 1.5) return 65;
  if (rate >= 0.5) return 40;
  return 20;
}

/** 1-5 arasi elle degerlendirmeyi 0-100'e tasir. */
function ratingScore(rating: number): number {
  return ((Math.min(Math.max(rating, 1), 5) - 1) / 4) * 100;
}

export interface ManualScoreResult {
  score: number;
  /** Girilen alanlarin agirlik orani (0-1) — guven seviyesini belirler. */
  coverage: number;
  components: { key: string; label: string; value: number; weight: number; detail: string }[];
}

/** Elle girilen metriklerden 0-100 skor. Hic alan girilmemisse null. */
export function scoreManualInput(input: StoredSocialManualInput): ManualScoreResult | null {
  const components: ManualScoreResult['components'] = [];
  let earned = 0;
  let achievable = 0;

  const add = (key: string, label: string, value: number, weight: number, detail: string) => {
    components.push({ key, label, value, weight, detail });
    earned += (value / 100) * weight;
    achievable += weight;
  };

  if (input.followers !== null) {
    add(
      'followers',
      'Takipçi sayısı',
      followersScore(input.followers),
      MANUAL_WEIGHTS.followers,
      `${input.followers.toLocaleString('tr-TR')} takipçi`,
    );
  }

  if (input.postsLast30d !== null) {
    add(
      'postFrequency',
      'İçerik sıklığı',
      postFrequencyScore(input.postsLast30d),
      MANUAL_WEIGHTS.postFrequency,
      `son 30 günde ${input.postsLast30d} paylaşım`,
    );
  }

  if (input.reelsLast30d !== null) {
    add(
      'reels',
      'Reels kullanımı',
      reelsScore(input.reelsLast30d),
      MANUAL_WEIGHTS.reels,
      `son 30 günde ${input.reelsLast30d} Reels/video`,
    );
  }

  if (input.avgLikes !== null && input.followers !== null) {
    const value = engagementScore(input.avgLikes, input.followers);
    if (value !== null) {
      const rate = ((input.avgLikes / input.followers) * 100).toFixed(2);
      add('engagement', 'Etkileşim oranı', value, MANUAL_WEIGHTS.engagement, `%${rate} (ort. ${input.avgLikes} beğeni)`);
    }
  }

  if (input.visualQuality !== null) {
    add(
      'visualQuality',
      'Görsel kalite',
      ratingScore(input.visualQuality),
      MANUAL_WEIGHTS.visualQuality,
      `${input.visualQuality}/5 (elle değerlendirme)`,
    );
  }

  if (input.salesContent !== null) {
    add(
      'salesContent',
      'Satışa yönelik içerik',
      ratingScore(input.salesContent),
      MANUAL_WEIGHTS.salesContent,
      `${input.salesContent}/5 (elle değerlendirme)`,
    );
  }

  if (input.bioHasWebsite !== null || input.bioHasContact !== null) {
    const hits = [input.bioHasWebsite, input.bioHasContact].filter((v) => v === true).length;
    const asked = [input.bioHasWebsite, input.bioHasContact].filter((v) => v !== null).length;
    const found = [
      input.bioHasWebsite ? 'site linki' : null,
      input.bioHasContact ? 'iletişim' : null,
    ].filter(Boolean);
    add(
      'bio',
      'Bio içeriği',
      (hits / asked) * 100,
      MANUAL_WEIGHTS.bio,
      found.length > 0 ? `bio'da ${found.join(' + ')}` : "bio'da yönlendirme yok",
    );
  }

  if (achievable === 0) return null;

  const totalWeight = Object.values(MANUAL_WEIGHTS).reduce((a, b) => a + b, 0);

  return {
    score: Math.round((earned / achievable) * 100),
    coverage: achievable / totalWeight,
    components,
  };
}

function confidenceFor(coverage: number): SocialConfidence {
  if (coverage >= 0.8) return 'high';
  if (coverage >= 0.4) return 'medium';
  return 'low';
}

/** Elle girilen alanlari `data_available` bayraklarina yansitir. */
function availabilityFrom(
  base: SocialDataAvailability,
  input: StoredSocialManualInput,
): SocialDataAvailability {
  return {
    ...base,
    followers: input.followers !== null,
    postFrequency: input.postsLast30d !== null,
    reelsUsage: input.reelsLast30d !== null,
    visualQuality: input.visualQuality !== null,
    engagement: input.avgLikes !== null && input.followers !== null,
    salesContent: input.salesContent !== null,
    bio: input.bioHasWebsite !== null || input.bioHasContact !== null,
    websiteLinkInBio: input.bioHasWebsite !== null,
  };
}

export interface MergedSocialAudit extends SocialAuditResult {
  /** Elle veri kullanildiysa dolu — dashboard bunu ayri gosterir. */
  manual: ManualScoreResult | null;
  manualUpdatedAt: string | null;
}

/**
 * Otomatik denetim sonucunu elle girilen metriklerle birlestirir.
 *
 * Elle veri yoksa sonuc oldugu gibi doner (manual: null).
 * Varsa skor = %30 otomatik sinyal + %70 manuel rubrik, guven coverage'a gore
 * yukselir.
 */
export function mergeManualInput(
  audit: SocialAuditResult,
  manualInput: StoredSocialManualInput | null,
): MergedSocialAudit {
  if (!manualInput) {
    return { ...audit, manual: null, manualUpdatedAt: null };
  }

  const manual = scoreManualInput(manualInput);
  if (!manual) {
    return { ...audit, manual: null, manualUpdatedAt: manualInput.updatedAt };
  }

  const autoScore = audit.score ?? 0;
  const combined = Math.round(
    AUTO_WEIGHT_WHEN_MANUAL * autoScore + (1 - AUTO_WEIGHT_WHEN_MANUAL) * manual.score,
  );

  return {
    ...audit,
    score: combined,
    confidence: confidenceFor(manual.coverage),
    dataAvailable: availabilityFrom(audit.dataAvailable, manualInput),
    manual,
    manualUpdatedAt: manualInput.updatedAt,
  };
}

/**
 * Sitede hic sosyal link bulunamamis ama kullanici elle veri girmisse,
 * sifirdan bir denetim sonucu uretir (link yok ama hesap var durumu).
 */
export function auditFromManualOnly(input: StoredSocialManualInput): MergedSocialAudit | null {
  const manual = scoreManualInput(input);
  if (!manual) return null;

  const base: SocialAuditResult = {
    platform: input.platform,
    handle: null,
    profileUrl: null,
    resolved: null,
    signals: {
      linkOnSite: false,
      handleResolves: null,
      platformCount: 1,
      feedEmbedOnSite: false,
      linkPlacementProminent: null,
    },
    dataAvailable: availabilityFrom(
      {
        followers: false,
        postFrequency: false,
        reelsUsage: false,
        visualQuality: false,
        bio: false,
        engagement: false,
        salesContent: false,
        websiteLinkInBio: false,
      },
      input,
    ),
    // Sitede link yok: otomatik sinyal payi 0 kabul edilir.
    score: Math.round((1 - AUTO_WEIGHT_WHEN_MANUAL) * manual.score),
    confidence: confidenceFor(manual.coverage),
  };

  return { ...base, manual, manualUpdatedAt: input.updatedAt };
}
