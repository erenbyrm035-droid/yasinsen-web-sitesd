import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scoreManualInput, mergeManualInput, auditFromManualOnly } from '../src/lib/audit/social-manual';
import { aggregateResolvedSocial, type MergedSocialAudit } from '../src/lib/social-resolution';
import type { SocialAuditResult } from '../src/lib/types';
import type { StoredSocialManualInput } from '../src/lib/db/repositories/social-manual';

/** Elle girilen sosyal medya verisinin skorlamaya etkisi. */

function manualInput(overrides: Partial<StoredSocialManualInput> = {}): StoredSocialManualInput {
  return {
    id: 1,
    companyId: 1,
    platform: 'instagram',
    followers: null,
    postsLast30d: null,
    reelsLast30d: null,
    avgLikes: null,
    visualQuality: null,
    salesContent: null,
    bioHasWebsite: null,
    bioHasContact: null,
    note: null,
    enteredBy: null,
    updatedAt: '2026-08-17 12:00:00',
    ...overrides,
  };
}

function autoAudit(score: number | null): SocialAuditResult {
  return {
    platform: 'instagram',
    handle: 'x',
    profileUrl: 'https://instagram.com/x',
    resolved: true,
    signals: {
      linkOnSite: true,
      handleResolves: true,
      platformCount: 2,
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

describe('Manuel rubrik', () => {
  test('hicbir alan girilmemisse null doner', () => {
    assert.equal(scoreManualInput(manualInput()), null);
  });

  test('yalnizca girilen alanlar paya ve paydaya girer', () => {
    const only = scoreManualInput(manualInput({ followers: 8000 }));
    assert.ok(only);
    // 8000 takipci -> 85 puan; tek bilesen oldugu icin skor da 85.
    assert.equal(only.score, 85);
    assert.equal(only.components.length, 1);
    assert.ok(only.coverage < 0.3, 'tek alan girildiğinde kapsam düşük olmalı');
  });

  test('etkilesim orani takipci ve begeni birlikte girilince hesaplanir', () => {
    const withoutFollowers = scoreManualInput(manualInput({ avgLikes: 300 }));
    assert.equal(
      withoutFollowers,
      null,
      'takipçi olmadan avgLikes tek başına bileşen üretmemeli',
    );

    const withBoth = scoreManualInput(manualInput({ followers: 10_000, avgLikes: 400 }));
    assert.ok(withBoth?.components.some((c) => c.key === 'engagement'));
  });

  test('tum alanlar girilince kapsam %100 olur', () => {
    const full = scoreManualInput(
      manualInput({
        followers: 8400,
        postsLast30d: 18,
        reelsLast30d: 7,
        avgLikes: 310,
        visualQuality: 5,
        salesContent: 4,
        bioHasWebsite: true,
        bioHasContact: true,
      }),
    );
    assert.ok(full);
    assert.equal(Math.round(full.coverage * 100), 100);
    assert.ok(full.score > 70, `güçlü profil yüksek skor almalı, alınan: ${full.score}`);
  });

  test('zayif profil dusuk skor alir', () => {
    const weak = scoreManualInput(
      manualInput({ followers: 90, postsLast30d: 0, reelsLast30d: 0, visualQuality: 1 }),
    );
    assert.ok(weak);
    assert.ok(weak.score < 25, `zayıf profil düşük skor almalı, alınan: ${weak.score}`);
  });
});

describe('Otomatik + manuel birlestirme', () => {
  test('manuel veri yoksa denetim degismeden doner', () => {
    const merged = mergeManualInput(autoAudit(70), null);
    assert.equal(merged.score, 70);
    assert.equal(merged.manual, null);
    assert.equal(merged.confidence, 'low');
  });

  test('tam manuel veri guveni high yapar ve olculebilirlik bayraklarini acar', () => {
    const merged = mergeManualInput(
      autoAudit(70),
      manualInput({
        followers: 8400,
        postsLast30d: 18,
        reelsLast30d: 7,
        avgLikes: 310,
        visualQuality: 5,
        salesContent: 4,
        bioHasWebsite: true,
        bioHasContact: true,
      }),
    );
    assert.equal(merged.confidence, 'high');
    assert.equal(merged.dataAvailable.followers, true);
    assert.equal(merged.dataAvailable.engagement, true);
    assert.equal(merged.dataAvailable.reelsUsage, true);
    assert.ok(merged.manual);
  });

  test('kismi veri guveni medium seviyesinde birakir', () => {
    const merged = mergeManualInput(
      autoAudit(70),
      manualInput({ followers: 5000, postsLast30d: 10 }),
    );
    assert.equal(merged.confidence, 'medium');
  });

  test('sitede link yokken bile elle veri denetim uretir', () => {
    const result = auditFromManualOnly(manualInput({ followers: 12_000, postsLast30d: 20 }));
    assert.ok(result);
    assert.equal(result.signals.linkOnSite, false);
    assert.ok((result.score ?? 0) > 0);
  });
});

describe('Sirket geneli sosyal skor secimi', () => {
  function merged(score: number, confidence: MergedSocialAudit['confidence']): MergedSocialAudit {
    return { ...autoAudit(score), confidence, manual: null, manualUpdatedAt: null };
  }

  test('yuksek guvenli olcum, dusuk guvenli tahmini yener (skor daha dusuk olsa bile)', () => {
    // Gercek olculmus 86, yalnizca sinyalden uretilmis 90'i yenmeli.
    const result = aggregateResolvedSocial([merged(90, 'low'), merged(86, 'high')]);
    assert.equal(result.score, 86);
    assert.equal(result.confidence, 'high');
  });

  test('esit guvende yuksek skor secilir', () => {
    const result = aggregateResolvedSocial([merged(60, 'low'), merged(80, 'low')]);
    assert.equal(result.score, 80);
  });

  test('hic skor yoksa null doner', () => {
    assert.deepEqual(aggregateResolvedSocial([]), { score: null, confidence: 'none' });
  });
});
