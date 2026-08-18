import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { auditWebsiteFromPage } from '../src/lib/audit/website';
import { detectBlockPage } from '../src/lib/audit/blocking';
import { computeDigitalGap } from '../src/lib/scoring/digital-gap';
import { computeLeadScore, type LeadScoreInput } from '../src/lib/scoring/purchase-score';
import { recommendOffer } from '../src/lib/offer/engine';
import type { FetchPageResult } from '../src/lib/audit/fetcher';

/**
 * ULASILAMAYAN SITE DAVRANISI
 *
 * Bu dosya, 100 lead'lik calistirmada bulunan gercek hatayi kilitler:
 * MACFit'in sitesi HTTP 403 donuyordu, sistem Cloudflare'in hata sayfasini
 * denetleyip "website skoru 33, guven YUKSEK" yaziyordu. Aranacak listenin
 * ucte biri bu yanlis olcume dayaniyordu.
 *
 * Kural: olculemeyen sey puanlanmaz.
 */

function page(overrides: Partial<FetchPageResult> = {}): FetchPageResult {
  return {
    ok: true,
    status: 200,
    finalUrl: 'https://example.com/',
    html: '<html><head><title>Test</title></head><body>içerik</body></html>',
    ttfbMs: 200,
    bytes: 1000,
    headers: {},
    https: true,
    error: null,
    ...overrides,
  };
}

/** Gercek bir isletme sayfasina benzeyen, yeterince zengin HTML. */
function realSiteHtml(): string {
  const nav = Array.from({ length: 20 }, (_, i) => `<a href="/sayfa-${i}">Bağlantı ${i}</a>`).join('');
  const body = 'Pilates stüdyomuza hoş geldiniz. '.repeat(80);
  return `<html lang="tr"><head><title>Örnek Pilates Stüdyo</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="description" content="İstanbul pilates stüdyosu"></head>
    <body><h1>Pilates Stüdyo</h1>${nav}<p>${body}</p>
    <a href="tel:+902121234567">Ara</a></body></html>`;
}

const CLOUDFLARE_HTML = `<html><head><title>Attention Required! | Cloudflare</title></head>
  <body><div id="cf-error-details">Sorry, you have been blocked</div>
  <script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script></body></html>`;

describe('HTTP hata durumlari — skor uretilmez', () => {
  for (const status of [400, 401, 403, 404, 429, 500, 502, 503, 504]) {
    test(`HTTP ${status} -> unreachable/blocked, skor null, manuel inceleme`, async () => {
      const result = await auditWebsiteFromPage(
        page({ ok: false, status, html: '<html><body>Error</body></html>' }),
      );

      assert.equal(result.score, null, 'skor uretilmemeli');
      assert.equal(result.confidence, 'none', 'guven none olmali');
      assert.ok(
        result.status === 'unreachable' || result.status === 'blocked',
        `status unreachable/blocked olmali, ${result.status} geldi`,
      );
      assert.equal(result.manualReviewRequired, true, 'elle inceleme isaretlenmeli');
      assert.ok(result.reason?.includes(String(status)), 'gerekce gercek HTTP kodunu icermeli');
      assert.equal(result.httpStatus, status);

      // Hicbir denetim maddesi "gecti/kaldi" hukmu tasimamali.
      assert.ok(
        result.checks.every((c) => c.passed === null && c.ratio === null),
        'tum maddeler olculmemis olmali',
      );
    });
  }

  test('403 sayfasi ASLA dusuk skor almaz (MACFit vakasi)', async () => {
    const result = await auditWebsiteFromPage(page({ ok: false, status: 403, html: CLOUDFLARE_HTML }));
    assert.equal(result.score, null);
    assert.equal(result.status, 'blocked');
    assert.notEqual(result.score, 0, 'sifir da bir hukumdur — verilmemeli');
    assert.ok(result.reason?.includes('Cloudflare'), 'engelin kaynagi kanitta gorunmeli');
  });

  test('sunucuya hic ulasilamadi -> unreachable, skor null', async () => {
    const result = await auditWebsiteFromPage(
      page({ ok: false, status: null, html: null, finalUrl: null, error: 'ECONNREFUSED' }),
    );
    assert.equal(result.score, null);
    assert.equal(result.status, 'unreachable');
    assert.equal(result.manualReviewRequired, true);
  });
});

describe('HTTP 200 ama gercek sayfa degil', () => {
  test('Cloudflare challenge 200 ile gelse bile analiz edilmez', async () => {
    const result = await auditWebsiteFromPage(page({ status: 200, html: CLOUDFLARE_HTML }));
    assert.equal(result.status, 'blocked');
    assert.equal(result.score, null);
    assert.equal(result.manualReviewRequired, true);
  });

  test('200 ile donen "sayfa bulunamadi" hata sayfasi analiz edilmez', async () => {
    const html = '<html><head><title>404 - Sayfa bulunamadı</title></head><body>Yok</body></html>';
    const result = await auditWebsiteFromPage(page({ status: 200, html }));
    assert.equal(result.status, 'unreachable');
    assert.equal(result.score, null);
  });

  test('gercek 200 sayfa NORMAL denetlenir — skor ve guven uretilir', async () => {
    const result = await auditWebsiteFromPage(page({ status: 200, html: realSiteHtml() }));
    assert.equal(result.status, 'ok');
    assert.equal(result.manualReviewRequired, false);
    assert.equal(result.reason, null);
    assert.ok(typeof result.score === 'number', 'gercek sayfada skor uretilmeli');
    assert.ok((result.score as number) > 0);
    assert.ok(result.checks.some((c) => c.passed === true), 'gecen madde olmali');
  });
});

describe('Kalip listesine guvenilmez — genel yakalayici', () => {
  /**
   * Gercek vaka: gymcity.com.tr HTTP 200 ile "One moment, please... Please
   * wait while your request is being verified" donuyordu. Cloudflare imzasi
   * yoktu, Ingilizce "just a moment" kalibina da uymuyordu. Sistem bu sayfayi
   * denetleyip website skorunu 67'den 32'ye dusurmustu — yani sitenin
   * kotulestigini sanmisti. Oysa site degismemisti, biz engellenmistik.
   */
  test('link icermeyen, neredeyse bos sayfa engel sayilir', () => {
    const html =
      '<html><head><title>One moment, please...</title></head>' +
      '<body><div>Please wait while your request is being verified...</div></body></html>';
    const d = detectBlockPage(html, 200);
    assert.equal(d.kind, 'blocked');
  });

  test('JS ile render edilen SPA "bot koruması" diye etiketlenmez', async () => {
    // Gercek vaka: okyanusfly.com — 4.4KB'lik React kabugu. Sunucudan gelen
    // HTML'de icerik yok. Engellenmedik, sadece okuyamiyoruz; gerekce bunu
    // dogru soylemeli.
    const html = '<html><head><title>Okyanusfly</title></head><body><div id="root"></div></body></html>';
    const d = detectBlockPage(html, 200);
    assert.equal(d.kind, 'unrendered');
    assert.match(d.evidence ?? '', /JavaScript/);

    const result = await auditWebsiteFromPage(page({ status: 200, html }));
    assert.equal(result.score, null, 'bos kabuga skor verilmemeli');
    assert.equal(result.status, 'unrendered');
    assert.equal(result.manualReviewRequired, true);
    assert.doesNotMatch(result.reason ?? '', /[Bb]ot koruması/);
  });

  test('Turkce challenge sayfasi yakalanir', () => {
    const html =
      '<html><head><title>Bir dakika lütfen…</title></head>' +
      '<body><p>İsteğiniz doğrulanırken lütfen bekleyin.</p></body></html>';
    assert.equal(detectBlockPage(html, 200).kind, 'blocked');
  });

  test('bos challenge sayfasi denetlenmez, skor uretilmez', async () => {
    const html =
      '<html><head><title>One moment, please...</title></head>' +
      '<body><div>Please wait while your request is being verified...</div></body></html>';
    const result = await auditWebsiteFromPage(page({ status: 200, html }));
    assert.equal(result.score, null, 'engellenmis sayfaya skor verilmemeli');
    assert.equal(result.status, 'blocked');
    assert.equal(result.manualReviewRequired, true);
  });
});

describe('Engel tespiti — yanlis pozitif olmamali', () => {
  test('icerigi zengin gercek sayfa engel sanilmaz', () => {
    assert.equal(detectBlockPage(realSiteHtml(), 200).kind, null);
  });

  test('"forbidden" kelimesi gecen uzun sayfa engel sanilmaz', () => {
    const html = `<html><head><title>Blog</title></head><body>
      ${Array.from({ length: 20 }, (_, i) => `<a href="/y-${i}">y</a>`).join('')}
      <p>${'Forbidden City hakkında uzun bir yazı. '.repeat(60)}</p></body></html>`;
    assert.equal(detectBlockPage(html, 200).kind, null);
  });

  test('saticiya ozgu imza tek basina yeterli', () => {
    const d = detectBlockPage('<html><body>_Incapsula_Resource?SWJIYLHA</body></html>', 200);
    assert.equal(d.kind, 'blocked');
    assert.equal(d.vendor, 'Imperva/Incapsula');
  });
});

describe('Skorlama — olculemeyen veri "kotu" sayilmaz', () => {
  test('website null + sosyal yok -> digital gap null', () => {
    const result = computeDigitalGap(null, null, 'none', 'none');
    assert.equal(result.gap, null);
    assert.equal(result.detail.unmeasurable, true);
  });

  test('website null iken gap 100 URETILMEZ', () => {
    const result = computeDigitalGap(null, null, 'none', 'none');
    assert.notEqual(result.gap, 100, 'olcememek "acik devasa" demek degil');
  });

  test('olculmus website skoru varken agirliklar eskisi gibi kalir (regresyon)', () => {
    // Mevcut calisan lead'lerin skorlari degismemeli.
    const result = computeDigitalGap(60, 80, 'low', 'high');
    assert.equal(result.detail.websiteWeight, 0.8);
    assert.equal(result.detail.socialWeight, 0.2);
  });

  test('gap olculemedigi lead sifira da tepeye de gonderilmez', () => {
    const base: LeadScoreInput = {
      segment: 'gym',
      district: 'Kadıköy',
      employeeCount: null,
      hasPhone: true,
      isInstitutional: false,
      reviewCount: 120,
      websiteScore: null,
      websiteConfidence: 'none',
      hasWebsite: true,
      websiteBroken: false,
      checks: [],
      copyrightYear: null,
      platform: null,
      socialScore: null,
      socialConfidence: 'none',
      hasSocialPresence: false,
    socialPresenceKnown: true,
    };

    const result = computeLeadScore(base);
    assert.equal(result.digitalGap, null);
    assert.ok(result.purchaseScore > 0 && result.purchaseScore < 100);
    assert.ok(
      result.breakdown.purchase.formula.includes('dijital açık ölçülemedi'),
      'formul olculemedigini acikca yazmali',
    );
  });

  test('olculemeyen site, olculmus kotu siteden daha yuksek gap almaz', () => {
    const common = {
      segment: 'gym' as const,
      district: 'Kadıköy',
      employeeCount: null,
      hasPhone: true,
      isInstitutional: false,
      reviewCount: 120,
      hasWebsite: true,
      websiteBroken: false,
      checks: [],
      copyrightYear: null,
      platform: null,
      socialScore: null,
      socialConfidence: 'none' as const,
      hasSocialPresence: false,
      socialPresenceKnown: true,
    };

    const unmeasured = computeLeadScore({
      ...common,
      websiteScore: null,
      websiteConfidence: 'none',
    });
    const measuredBad = computeLeadScore({
      ...common,
      websiteScore: 10,
      websiteConfidence: 'high',
    });

    assert.ok(
      unmeasured.purchaseScore < measuredBad.purchaseScore,
      'olculemeyen lead, gercekten kotu olculmus lead kadar firsat sayilmamali',
    );
  });
});

describe('Teklif motoru — olculemeyen site', () => {
  test('website ve sosyal olculemediyse teklif uretilmez, elle inceleme denir', () => {
    const offer = recommendOffer({
      websiteScore: null,
      socialScore: null,
      digitalGap: null,
      businessPotential: 70,
      hasWebsite: true,
      hasSocialPresence: false,
      hasPhone: true,
      hasBooking: false,
      hasMembership: false,
      employeeCount: null,
      isInstitutional: false,
      checks: [],
      socialConfidence: 'none',
      websiteConfidence: 'none',
    });

    assert.equal(offer.offerCode, 'G');
    assert.ok(offer.rationale.includes('ELLE İNCELENMELİ'));
    assert.equal(offer.confidence, 'low');
  });

  test('website olculemedi ama sosyal olculdu -> "website sat" denmez', () => {
    const offer = recommendOffer({
      websiteScore: null,
      socialScore: 75,
      digitalGap: 40,
      businessPotential: 70,
      hasWebsite: true,
      hasSocialPresence: true,
      hasPhone: true,
      hasBooking: false,
      hasMembership: false,
      employeeCount: null,
      isInstitutional: false,
      checks: [],
      socialConfidence: 'medium',
      websiteConfidence: 'none',
    });

    // R4/R5 "site zayif -> website" kurallari null skorda ateslenmemeli.
    assert.notEqual(offer.offerCode, 'A');
  });
});
