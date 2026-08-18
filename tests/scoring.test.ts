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
    websiteConfidence: 'high',
    hasWebsite: true,
    websiteBroken: false,
    checks: [],
    copyrightYear: null,
    platform: null,
    socialScore: 50,
    socialConfidence: 'low',
    hasSocialPresence: true,
    socialPresenceKnown: true,
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
    assert.ok((computeDigitalGap(90, 90, 'high').gap as number) < 15);
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
    assert.notEqual(result.digitalGap, null);
    const expected = Math.round(
      0.35 * (result.digitalGap as number) +
        0.35 * result.businessPotential +
        0.3 * result.estimatedBuyingIntent,
    );
    assert.equal(result.breakdown.purchase.base, expected);
  });

  // 100 lead'lik kalibrasyondan gelen davranis: ulasilamayan lead firsat degildir.
  test('hicbir iletisim kanali olmayan lead ulasilabilirlik carpani yer', () => {
    const result = scoreFor({
      hasPhone: false,
      hasWebsite: false,
      hasSocialPresence: false,
      websiteScore: 0,
      socialScore: null,
      socialConfidence: 'none',
    });
    const modifier = result.breakdown.purchase.modifiers.find((m) => m.key === 'reachability');
    assert.ok(modifier, 'reachability modifier bekleniyordu');
    assert.ok(modifier.delta < 0, 'çarpan skoru düşürmeli');
    assert.match(modifier.label, /×0\.55/);
  });

  test('tek kanali olan lead daha hafif carpan yer', () => {
    const result = scoreFor({
      hasPhone: true,
      hasWebsite: false,
      hasSocialPresence: false,
      websiteScore: 0,
      socialScore: null,
      socialConfidence: 'none',
    });
    const modifier = result.breakdown.purchase.modifiers.find((m) => m.key === 'reachability');
    assert.match(modifier?.label ?? '', /×0\.85/);
  });

  test('iki veya daha fazla kanali olan lead carpan yemez', () => {
    const result = scoreFor({ hasPhone: true, hasWebsite: true, hasSocialPresence: false });
    assert.equal(
      result.breakdown.purchase.modifiers.some((m) => m.key === 'reachability'),
      false,
    );
  });

  test('ulasilamayan lead, ulasilabilir esdegerinden daima dusuk skorlanir', () => {
    const common = {
      segment: 'pilates_studio' as const,
      district: 'Beşiktaş',
      websiteScore: 0,
      socialScore: null,
      socialConfidence: 'none' as const,
      hasWebsite: false,
      hasSocialPresence: false,
    };
    const reachable = scoreFor({ ...common, hasPhone: true });
    const unreachable = scoreFor({ ...common, hasPhone: false });

    assert.ok(
      unreachable.purchaseScore < reachable.purchaseScore,
      `ulaşılamayan (${unreachable.purchaseScore}) < ulaşılabilir (${reachable.purchaseScore}) olmalı`,
    );
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
      status: 'on_site',
      match: { source: 'website', score: 1, signals: ['test'], query: null },
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

describe('Bakilmayan sosyal medya "yok" sayilmaz', () => {
  /**
   * Sitesi olmayan bir isletmede sosyal profil taranacak sayfa yoktur ve
   * arama katmani kapalidir. Sistem bu durumda "website ve sosyal medya yok"
   * diye kesin konusuyordu — oysa sosyal medyaya hic bakmamisti.
   * Kanit yoklugu, yokluk kaniti degildir.
   */
  const noWebsiteLead = (socialPresenceKnown: boolean) =>
    computeLeadScore({
      segment: 'pilates_studio' as const,
      district: 'Kadıköy',
      employeeCount: null,
      reviewCount: 400,
      hasPhone: true,
      isInstitutional: false,
      websiteScore: 0,
      websiteConfidence: 'high',
      hasWebsite: false,
      websiteBroken: false,
      checks: [],
      copyrightYear: null,
      platform: null,
      socialScore: null,
      socialConfidence: 'none',
      hasSocialPresence: false,
      socialPresenceKnown,
    });

  test('bakilamadiysa "sosyal medya yok" iddiasi kurulmaz', () => {
    const result = noWebsiteLead(false);
    const c = result.breakdown.buyingIntentComponents.find((x) => x.key === 'activeButOffline');
    assert.ok(c, 'bilesen bulunmali');
    assert.doesNotMatch(
      c!.detail,
      /sosyal medya yok/i,
      'bakilmadigi halde "sosyal medya yok" denmemeli',
    );
    assert.match(c!.detail, /BİLİNMİYOR/, 'durumun bilinmedigi acikca yazilmali');
  });

  test('bakildiysa ve gercekten yoksa tam puan verilir', () => {
    const c = noWebsiteLead(true).breakdown.buyingIntentComponents.find(
      (x) => x.key === 'activeButOffline',
    );
    assert.equal(c?.value, 100);
    assert.match(c!.detail, /sosyal medya yok/i);
  });

  test('bakilamayan lead, bakilip dogrulanandan daha dusuk skor alir', () => {
    assert.ok(
      noWebsiteLead(false).purchaseScore < noWebsiteLead(true).purchaseScore,
      'dogrulanmamis iddia, dogrulanmis olandan daha az agirlik tasimali',
    );
  });
});
