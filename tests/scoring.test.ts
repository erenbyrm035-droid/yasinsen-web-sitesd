import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeLeadScore, toPriority } from '../src/lib/scoring/purchase-score';
import { computeDigitalGap } from '../src/lib/scoring/digital-gap';
import { computeBusinessPotential } from '../src/lib/scoring/business-potential';
import { aggregateSocialScore } from '../src/lib/audit/social';
import type { AuditCheck, SocialAuditResult } from '../src/lib/types';
import type { LeadScoreInput as ScoreInput } from '../src/lib/scoring/purchase-score';

function check(key: string, passed: boolean | null, weight = 5): AuditCheck {
  return { key, label: key, passed, ratio: passed === null ? null : passed ? 1 : 0, evidence: 'test', weight };
}

function scoreFor(overrides: Partial<ScoreInput> = {}) {
  return computeLeadScore({
    segment: 'gym',
    district: 'Kadıköy',
    employeeCount: null,
    hasPhone: true,
    isInstitutional: false,
    websiteScore: 50,
    hasWebsite: true,
    websiteBroken: false,
    checks: [],
    copyrightYear: null,
    platform: null,
    socialScore: 50,
    socialConfidence: 'low',
    hasSocialPresence: true,
    ...overrides,
  });
}

describe('Priority esikleri', () => {
  test('esikler sartnameye uyar: HOT>=80, HIGH>=65, MEDIUM>=45, altı LOW', () => {
    assert.equal(toPriority(100), 'HOT');
    assert.equal(toPriority(80), 'HOT');
    assert.equal(toPriority(79), 'HIGH');
    assert.equal(toPriority(65), 'HIGH');
    assert.equal(toPriority(64), 'MEDIUM');
    assert.equal(toPriority(45), 'MEDIUM');
    assert.equal(toPriority(44), 'LOW');
    assert.equal(toPriority(0), 'LOW');
  });
});

describe('Digital gap', () => {
  test('sosyal skor null ise agirlik tamamen website\'a devredilir', () => {
    const { gap, detail } = computeDigitalGap(70, null, 'none');
    assert.equal(gap, 30);
    assert.equal(detail.socialWeight, 0);
    assert.equal(detail.websiteWeight, 1);
  });

  test('dusuk guvenli sosyal skorun agirligi yariya iner', () => {
    const { detail } = computeDigitalGap(60, 80, 'low');
    assert.equal(detail.socialWeight, 0.2); // 0.40 taban × 0.5 güven
    assert.equal(detail.websiteWeight, 0.8);
  });

  test('gap 0-100 araligini asmaz', () => {
    assert.equal(computeDigitalGap(0, 0, 'high').gap, 100);
    assert.equal(computeDigitalGap(100, 100, 'high').gap, 0);
  });

  test('yuksek website skoru dusuk gap uretir', () => {
    assert.ok(computeDigitalGap(90, 90, 'high').gap < 15);
  });
});

describe('Business potential', () => {
  const base = {
    segment: 'gym' as const,
    district: 'Kadıköy',
    employeeCount: null,
    hasWebsite: true,
    hasSocialPresence: true,
    hasPhone: true,
    isInstitutional: false,
  };

  test('bilinmeyen calisan sayisi bilesen olarak hic sayilmaz (sifir gibi cezalandirilmaz)', () => {
    const unknown = computeBusinessPotential(base);
    const known = computeBusinessPotential({ ...base, employeeCount: 10 });

    assert.equal(unknown.components.some((c) => c.key === 'employees'), false);
    assert.equal(known.components.some((c) => c.key === 'employees'), true);
    // Bilinmiyor -> paydadan dusuldugu icin skor "0 calisan" varsayimindan yuksek kalir.
    assert.ok(unknown.score > computeBusinessPotential({ ...base, employeeCount: 1 }).score);
  });

  test('pilates studyosu klasik salondan yuksek potansiyel alir', () => {
    const pilates = computeBusinessPotential({ ...base, segment: 'pilates_studio' });
    const gym = computeBusinessPotential({ ...base, segment: 'gym' });
    assert.ok(pilates.score > gym.score);
  });

  test('yuksek alim gucu ilcesi standart ilceden yuksek puanlanir', () => {
    const premium = computeBusinessPotential({ ...base, district: 'Beşiktaş' });
    const standard = computeBusinessPotential({ ...base, district: 'Esenyurt' });
    assert.ok(premium.score > standard.score);
  });

  test('kurumsal/kamu tesisi cezalandirilir ve ceza breakdown\'da gorunur', () => {
    const normal = computeBusinessPotential(base);
    const institutional = computeBusinessPotential({ ...base, isInstitutional: true });

    assert.ok(institutional.score < normal.score);
    assert.equal(institutional.components.some((c) => c.key === 'institutionalPenalty'), true);
  });
});

describe('Purchase score', () => {
  test('formul 0.35·gap + 0.35·potansiyel + 0.30·niyet olarak uygulanir', () => {
    const result = scoreFor();
    const expected = Math.round(
      0.35 * result.digitalGap + 0.35 * result.businessPotential + 0.3 * result.estimatedBuyingIntent,
    );
    assert.equal(result.breakdown.purchase.base, expected);
  });

  test('hicbir iletisim kanali olmayan lead -10 ceza alir', () => {
    const result = scoreFor({
      hasPhone: false,
      hasWebsite: false,
      hasSocialPresence: false,
      websiteScore: 0,
      socialScore: null,
      socialConfidence: 'none',
    });
    assert.equal(result.breakdown.purchase.modifiers.some((m) => m.key === 'noContactChannel'), true);
  });

  test('dijital varligi olmayan lead 60 tavanini asamaz', () => {
    const result = scoreFor({
      segment: 'pilates_studio',
      district: 'Beşiktaş',
      hasWebsite: false,
      hasSocialPresence: false,
      websiteScore: 0,
      socialScore: null,
      socialConfidence: 'none',
    });
    assert.ok(result.purchaseScore <= 60);
  });

  test('skor daima 0-100 araliginda kalir', () => {
    for (const websiteScore of [0, 50, 100]) {
      const result = scoreFor({ websiteScore });
      assert.ok(result.purchaseScore >= 0 && result.purchaseScore <= 100);
    }
  });

  test('bozuk site "acil yenileme" niyet sinyalini tetikler', () => {
    const broken = scoreFor({ websiteBroken: true, websiteScore: 0 });
    const component = broken.breakdown.buyingIntentComponents.find((c) => c.key === 'outdatedSite');
    assert.equal(component?.value, 100);
    assert.match(component?.detail ?? '', /açılmıyor/);
  });

  test('guclu sosyal + zayif website "yatirim var, altyapi eksik" sinyali verir', () => {
    const result = scoreFor({ websiteScore: 40, socialScore: 85 });
    const component = result.breakdown.buyingIntentComponents.find(
      (c) => c.key === 'investedButIncomplete',
    );
    assert.equal(component?.value, 100);
  });

  test('fiyat var ama rezervasyon/uyelik yoksa donusum firsati isaretlenir', () => {
    const result = scoreFor({
      checks: [check('pricing', true), check('booking', false), check('membership', false)],
    });
    const component = result.breakdown.buyingIntentComponents.find(
      (c) => c.key === 'sellsWithoutInfrastructure',
    );
    assert.equal(component?.value, 100);
  });
});

describe('Sosyal skor toplama', () => {
  function socialAudit(score: number | null): SocialAuditResult {
    return {
      platform: 'instagram',
      handle: 'x',
      profileUrl: 'https://instagram.com/x',
      resolved: true,
      signals: {
        linkOnSite: true,
        handleResolves: true,
        platformCount: 1,
        feedEmbedOnSite: false,
        linkPlacementProminent: false,
      },
      dataAvailable: {
        followers: false,
        postFrequency: false,
        reelsUsage: false,
        visualQuality: false,
        bio: false,
        engagement: false,
        salesContent: false,
        websiteLinkInBio: false,
      },
      score,
      confidence: score === null ? 'none' : 'low',
    };
  }

  test('profil yoksa skor null doner — 0 DEGIL', () => {
    const result = aggregateSocialScore([]);
    assert.equal(result.score, null);
    assert.equal(result.confidence, 'none');
  });

  test('birden fazla platformda en yuksek skor alinir', () => {
    const result = aggregateSocialScore([socialAudit(40), socialAudit(75), socialAudit(60)]);
    assert.equal(result.score, 75);
  });

  test('olculebilir metrik olmadigi surece guven daima dusuk kalir', () => {
    assert.equal(aggregateSocialScore([socialAudit(95)]).confidence, 'low');
  });
});
