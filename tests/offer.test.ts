import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { recommendOffer, collectDigitalGaps } from '../src/lib/offer/engine';
import { OFFER_RULES } from '../src/lib/offer/rules';
import type { AuditCheck, OfferCode } from '../src/lib/types';

/**
 * Offer engine fixture testleri.
 * Sartnamedeki uc ornek birebir burada kilitlenmistir — kural tablosu
 * degistirilirse bu testler kirilir ve degisiklik bilincli olmak zorunda kalir.
 */

function check(key: string, passed: boolean | null, weight = 5): AuditCheck {
  return { key, label: key, passed, ratio: passed === null ? null : passed ? 1 : 0, evidence: 'test', weight };
}

interface Overrides {
  websiteScore?: number;
  socialScore?: number | null;
  digitalGap?: number;
  businessPotential?: number;
  hasWebsite?: boolean;
  hasSocialPresence?: boolean;
  hasPhone?: boolean;
  hasBooking?: boolean;
  hasMembership?: boolean;
  employeeCount?: number | null;
  isInstitutional?: boolean;
  checks?: AuditCheck[];
}

function offerFor(overrides: Overrides): OfferCode {
  return recommendOffer({
    websiteScore: 50,
    socialScore: 50,
    digitalGap: 50,
    businessPotential: 60,
    hasWebsite: true,
    hasSocialPresence: true,
    hasPhone: true,
    hasBooking: false,
    hasMembership: false,
    employeeCount: null,
    isInstitutional: false,
    checks: [],
    socialConfidence: 'low',
    websiteConfidence: 'high',
    ...overrides,
  }).offerCode;
}

describe('Offer engine — sartnamedeki ornekler', () => {
  test('Website 42 / Social 81 → C (Social Media)', () => {
    assert.equal(offerFor({ websiteScore: 42, socialScore: 81 }), 'C');
  });

  test('Website 48 / Social 45 → A (Website)', () => {
    assert.equal(offerFor({ websiteScore: 48, socialScore: 45 }), 'A');
  });

  test('Website 85 / Social 82 / dusuk gap → buyutme hizmeti (D, E veya F)', () => {
    const code = offerFor({
      websiteScore: 85,
      socialScore: 82,
      digitalGap: 18,
      hasBooking: true,
      hasMembership: true,
    });
    assert.ok(['D', 'E', 'F'].includes(code), `beklenen D/E/F, gelen ${code}`);
  });
});

describe('Offer engine — buyutme dalinin alt kararlari', () => {
  const strong = { websiteScore: 88, socialScore: 90, digitalGap: 15 };

  test('rezervasyon/uyelik eksikse → D (Website + Automation)', () => {
    assert.equal(offerFor({ ...strong, hasBooking: false, hasMembership: true }), 'D');
  });

  test('altyapi tam + buyuk ekip → E (Custom Software)', () => {
    assert.equal(
      offerFor({ ...strong, hasBooking: true, hasMembership: true, employeeCount: 25 }),
      'E',
    );
  });

  test('altyapi tam + kucuk ekip → F (Ads / Conversion)', () => {
    assert.equal(
      offerFor({ ...strong, hasBooking: true, hasMembership: true, employeeCount: 5 }),
      'F',
    );
  });
});

describe('Offer engine — No Offer kosullari', () => {
  test('kurumsal/kamu tesisi → G', () => {
    assert.equal(offerFor({ isInstitutional: true, websiteScore: 80, socialScore: 80 }), 'G');
  });

  test('hicbir iletisim kanali yok → G', () => {
    assert.equal(
      offerFor({ hasPhone: false, hasWebsite: false, hasSocialPresence: false, websiteScore: 0 }),
      'G',
    );
  });
});

describe('Offer engine — diger dallar', () => {
  test('website yok → A (Website)', () => {
    assert.equal(offerFor({ websiteScore: 0, hasWebsite: false, socialScore: null }), 'A');
  });

  test('site yeterli, sosyal olculemedi → C (Social Media)', () => {
    assert.equal(
      offerFor({ websiteScore: 65, socialScore: null, hasSocialPresence: false }),
      'C',
    );
  });

  test('site iyi, rezervasyon yok → D (Website + Automation)', () => {
    assert.equal(
      offerFor({ websiteScore: 75, socialScore: 60, hasBooking: false, hasMembership: false }),
      'D',
    );
  });

  test('her iki kanal orta → B (Website + Social Media)', () => {
    assert.equal(
      offerFor({ websiteScore: 62, socialScore: 60, hasBooking: true, hasMembership: true }),
      'B',
    );
  });
});

describe('Offer engine — yapisal garantiler', () => {
  test('kural tablosunun son kurali her zaman eslesir (varsayilan dal)', () => {
    const last = OFFER_RULES[OFFER_RULES.length - 1];
    assert.equal(
      last.matches({
        websiteScore: 0,
        socialScore: null,
        digitalGap: 0,
        businessPotential: 0,
        hasWebsite: false,
        hasSocialPresence: false,
        hasPhone: false,
        hasBooking: false,
        hasMembership: false,
        employeeCount: null,
        isInstitutional: false,
      }),
      true,
    );
  });

  test('gerekce daima uygulanan kuralin kimligini tasir', () => {
    const result = recommendOffer({
      websiteScore: 42,
      socialScore: 81,
      digitalGap: 50,
      businessPotential: 60,
      hasWebsite: true,
      hasSocialPresence: true,
      hasPhone: true,
      hasBooking: false,
      hasMembership: false,
      employeeCount: null,
      isInstitutional: false,
      checks: [],
      socialConfidence: 'low',
      websiteConfidence: 'high',
    });
    assert.match(result.rationale, /^\[R\d+\]/);
  });

  test('digital gaps yalnizca KALAN maddeleri, agirlik sirasiyla listeler', () => {
    const gaps = collectDigitalGaps([
      check('a', true, 9),
      check('b', false, 3),
      check('c', false, 8),
      check('d', null, 10),
    ]);
    assert.deepEqual(gaps, ['c', 'b']);
  });
});
