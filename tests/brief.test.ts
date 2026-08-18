import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildBrief, type BriefInput } from '../src/lib/brief';
import type { AuditCheck } from '../src/lib/types';

function check(key: string, label: string, passed: boolean | null, evidence: string, weight = 8, ratio: number | null = null): AuditCheck {
  return { key, label, passed, ratio: ratio ?? (passed === null ? null : passed ? 1 : 0), evidence, weight };
}

const base: BriefInput = {
  name: 'Test Pilates',
  segment: 'pilates_studio',
  district: 'Kadıköy',
  rating: 4.7,
  reviewCount: 200,
  hasWebsite: true,
  websiteScore: 45,
  websiteStatus: 'ok',
  websiteReason: null,
  socialScore: 60,
  socialUrl: 'https://instagram.com/test',
  offerLabel: 'Website',
  offerRationale: '[R5] Website skoru düşük.',
  checks: [check('booking', 'Online rezervasyon / randevu', false, 'Online rezervasyon akışı yok', 10)],
};

describe('Brifing yalnızca ölçülene dayanır', () => {
  test('ölçülemeyen sitede HİÇBİR bulgu üretilmez', () => {
    const b = buildBrief({
      ...base,
      websiteScore: null,
      websiteStatus: 'blocked',
      websiteReason: 'HTTP 403 (Cloudflare bot koruması)',
      checks: [check('booking', 'Online rezervasyon', null, 'Sayfa denetlenemedi', 10)],
    });
    assert.equal(b.findings.length, 0, 'ölçülemeyen siteden bulgu çıkarılmamalı');
    assert.ok(
      b.cautions.some((c) => /ARAMADAN ÖNCE/.test(c)),
      'kullanıcı elle bakmaya yönlendirilmeli',
    );
    assert.ok(
      b.cautions.some((c) => /Sitenizde şu eksik.*demeyin/.test(c)),
      'iddia kurulmaması açıkça söylenmeli',
    );
  });

  test('ölçülemeyen sitede açılış cümlesi eksik iddia etmez', () => {
    const b = buildBrief({ ...base, websiteScore: null, websiteStatus: 'unrendered', websiteReason: 'SPA' });
    assert.doesNotMatch(b.opening, /eksik görünüyor/, 'ölçmeden "eksik" denmemeli');
  });

  test('ölçülmüş sitede bulgular kanıtıyla gelir', () => {
    const b = buildBrief(base);
    assert.equal(b.findings.length, 1);
    assert.equal(b.findings[0].evidence, 'Online rezervasyon akışı yok');
  });

  test('sosyal aranmadıysa "yok" denmemesi hatırlatılır', () => {
    const b = buildBrief({ ...base, socialScore: null, socialUrl: null });
    assert.ok(b.cautions.some((c) => /ARANMADI/.test(c)));
  });
});

describe('Bulgu metni', () => {
  test('kısmen geçen madde "bulunan" listesiyle olumlu okunmaz', () => {
    const b = buildBrief({
      ...base,
      checks: [check('trust', 'Güven unsurları', false, 'Bulunan: fiziksel adres, hakkımızda', 7, 0.4)],
    });
    assert.match(b.findings[0].evidence, /kısmen var \(%40\)/);
    assert.match(b.findings[0].evidence, /yalnızca/);
  });

  test('kısaltmalar cümle içinde küçültülmez', () => {
    const b = buildBrief({
      ...base,
      checks: [check('seoBasics', 'SEO temel durumu', false, 'Eksik: title', 9)],
    });
    assert.match(b.opening, /SEO/, '"seo" diye küçültülmemeli');
  });
});

describe('Website yoksa', () => {
  test('anlamsız "adres yok" maddeleri listelenmez', () => {
    const b = buildBrief({
      ...base,
      hasWebsite: false,
      websiteScore: 0,
      websiteStatus: 'no_website',
      checks: [
        check('seoBasics', 'SEO temel durumu', false, 'Kayıtlı website adresi yok', 9),
        check('performance', 'Sayfa performansı', false, 'Kayıtlı website adresi yok', 9),
      ],
    });
    assert.equal(b.findings.length, 0, 'hepsi aynı şeyi söyleyen maddeler tekrarlanmamalı');
    assert.match(b.headline, /[Ss]itesi olmayan/);
  });

  test('yorum sayısı açılışta kanıt olarak kullanılır', () => {
    const b = buildBrief({ ...base, hasWebsite: false, websiteScore: 0, websiteStatus: 'no_website', checks: [] });
    assert.match(b.opening, /200 yorumunuz var/);
  });
});

describe('Türkçe dil bilgisi', () => {
  test('çoğul eki bozuk birleştirilmez', () => {
    for (const seg of ['gym', 'pilates_studio', 'crossfit_box', 'martial_arts', 'personal_training', 'fitness_other']) {
      const b = buildBrief({
        ...base, segment: seg, websiteScore: null, websiteStatus: 'blocked', websiteReason: 'HTTP 403',
      });
      assert.doesNotMatch(b.opening, /(salonu|stüdyosu|işletmesi)leri/, `${seg}: bozuk çoğul eki`);
    }
  });
});

describe('Geçmiş görüşme', () => {
  test('daha önce arandıysa uyarıda görünür', () => {
    const b = buildBrief({ ...base, callCount: 2, lastCallNotes: 'Fiyat istedi.\nCuma aranacak.' });
    assert.ok(b.cautions.some((c) => /2 kez arandı/.test(c)));
    assert.ok(b.cautions.some((c) => /Fiyat istedi\./.test(c)));
  });
});

describe('Tutarlılık koruması', () => {
  /**
   * Bu test gerçek bir hatadan doğdu: telefon sürümünde hasWebsite yanlış
   * alandan okunuyordu ve sitesi olan bir işletme için brifing "web siteniz
   * çıkmıyor" diyordu. Ekranda aynı anda website skoru 45 ve site linki
   * duruyordu. Böyle bir çelişki müşteriye söylenirse güven biter.
   */
  test('ölçülmüş website skoru varken "sitesi yok" denmez', () => {
    const b = buildBrief({ ...base, hasWebsite: false, websiteScore: 45, websiteStatus: 'ok' });
    assert.doesNotMatch(b.headline, /[Ss]itesi olmayan/);
    assert.doesNotMatch(b.opening, /web siteniz çıkmıyor/);
  });

  test('bot koruması durumunda da "sitesi yok" denmez', () => {
    const b = buildBrief({
      ...base, hasWebsite: false, websiteScore: null,
      websiteStatus: 'blocked', websiteReason: 'HTTP 403',
    });
    assert.doesNotMatch(b.headline, /[Ss]itesi olmayan/);
  });

  test('gerçekten sitesi yoksa doğru söylenir', () => {
    const b = buildBrief({
      ...base, hasWebsite: false, websiteScore: 0, websiteStatus: 'no_website', checks: [],
    });
    assert.match(b.headline, /[Ss]itesi olmayan/);
  });
});
