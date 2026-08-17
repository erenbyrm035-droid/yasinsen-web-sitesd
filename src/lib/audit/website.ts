import type { AuditCheck, Confidence, WebsiteAuditResult, WebsiteRawSignals } from '../types';
import { fetchPage, probeUrl, fetchLighthouse, type FetchPageResult } from './fetcher';
import {
  PATTERNS,
  TEL_LINK_PATTERN,
  MAILTO_PATTERN,
  WHATSAPP_PATTERN,
  copyrightYear,
  countTag,
  detectPlatform,
  extractSocialLinks,
  htmlLang,
  metaContent,
  pageTitle,
  renderBlockingCount,
  visibleText,
} from './signals';

/**
 * WEBSITE AUDIT
 *
 * Her madde bir `AuditCheck` uretir: gecti mi, kismi puani ne, ve HANGI KANITA
 * dayaniyor. Kanit alani zorunlu — "iyi/kotu" hukmu her zaman olculen bir seye
 * baglidir.
 *
 * Skor = sum(ratio * weight). Agirliklar toplami 100.
 * Ayrintili gerekce: docs/SCORING.md
 */

const WEIGHTS = {
  reachable: 8,
  https: 5,
  mobileViewport: 8,
  responsive: 4,
  cta: 8,
  whatsapp: 5,
  booking: 8,
  membership: 6,
  pricing: 6,
  contactEase: 7,
  seoBasics: 9,
  indexability: 4,
  performance: 9,
  trust: 7,
  conversion: 6,
} as const;

function check(
  key: string,
  label: string,
  ratio: number | null,
  evidence: string,
  weight: number,
): AuditCheck {
  return {
    key,
    label,
    passed: ratio === null ? null : ratio >= 0.5,
    ratio,
    evidence,
    weight,
  };
}

/**
 * Yerel performans sezgiseli. PAGESPEED_API_KEY varsa gercek Lighthouse
 * skoru kullanilir; yoksa TTFB + sayfa agirligi + render-blocking kaynak
 * sayisindan 0..1 arasi bir oran uretilir. Bu bir Lighthouse skoru DEGILDIR
 * ve oyle sunulmaz.
 */
function performanceRatio(
  ttfbMs: number | null,
  bytes: number | null,
  blocking: number,
): { ratio: number; evidence: string } {
  const parts: string[] = [];
  let total = 0;
  let count = 0;

  if (ttfbMs !== null) {
    const score = ttfbMs <= 400 ? 1 : ttfbMs <= 900 ? 0.7 : ttfbMs <= 2000 ? 0.4 : 0.1;
    total += score;
    count += 1;
    parts.push(`yanıt süresi ${ttfbMs}ms`);
  }

  if (bytes !== null) {
    const kb = Math.round(bytes / 1024);
    const score = kb <= 150 ? 1 : kb <= 500 ? 0.7 : kb <= 1500 ? 0.4 : 0.1;
    total += score;
    count += 1;
    parts.push(`HTML ${kb}KB`);
  }

  const blockingScore = blocking <= 3 ? 1 : blocking <= 8 ? 0.6 : blocking <= 15 ? 0.3 : 0.1;
  total += blockingScore;
  count += 1;
  parts.push(`${blocking} render-blocking kaynak`);

  return { ratio: count === 0 ? 0 : total / count, evidence: parts.join(', ') };
}

function buildOfflineResult(reason: string, hasWebsite: boolean): WebsiteAuditResult {
  const checks: AuditCheck[] = [
    check(
      'reachable',
      'Website erişilebilir',
      0,
      hasWebsite ? reason : 'Kayıtlı website adresi yok',
      WEIGHTS.reachable,
    ),
    // Diger maddeler olculemedi — 0 degil, null. "Kotu" ile "bilinmiyor" ayri seyler.
    ...Object.entries(WEIGHTS)
      .filter(([key]) => key !== 'reachable')
      .map(([key, weight]) =>
        check(key, LABELS[key as keyof typeof WEIGHTS], null, 'Sayfa alınamadı', weight),
      ),
  ];

  return {
    hasWebsite,
    httpStatus: null,
    finalUrl: null,
    checks,
    rawSignals: emptySignals(),
    // Sitesi olmayan/acilmayan isletme dijital olarak sifir noktasindadir.
    score: 0,
    // "Website yok" kesin bir bulgudur; "site acilmadi" ise gecici olabilir.
    confidence: hasWebsite ? 'low' : 'high',
    notes: hasWebsite ? reason : 'Kayıtlı website adresi yok',
  };
}

const LABELS: Record<keyof typeof WEIGHTS, string> = {
  reachable: 'Website erişilebilir',
  https: 'HTTPS güvenli bağlantı',
  mobileViewport: 'Mobil uyumluluk (viewport)',
  responsive: 'Responsive tasarım işaretleri',
  cta: 'Net çağrı-aksiyon (CTA)',
  whatsapp: 'WhatsApp ile iletişim',
  booking: 'Online rezervasyon / randevu',
  membership: 'Online üyelik / satın alma',
  pricing: 'Paket ve fiyat bilgisi',
  contactEase: 'İletişim kolaylığı',
  seoBasics: 'SEO temel durumu',
  indexability: 'Google görünürlüğü (indekslenebilirlik)',
  performance: 'Sayfa performansı',
  trust: 'Güven unsurları',
  conversion: 'Dönüşüm optimizasyonu',
};

function emptySignals(): WebsiteRawSignals {
  return {
    ttfbMs: null,
    htmlBytes: null,
    scriptCount: null,
    stylesheetCount: null,
    renderBlockingCount: null,
    imageCount: null,
    title: null,
    metaDescription: null,
    h1Count: null,
    lang: null,
    hasRobotsTxt: null,
    hasSitemap: null,
    platform: null,
    copyrightYear: null,
    socialLinks: [],
    lighthousePerformance: null,
  };
}

export async function auditWebsite(website: string | null): Promise<WebsiteAuditResult> {
  if (!website) return buildOfflineResult('Kayıtlı website adresi yok', false);
  return auditWebsiteFromPage(await fetchPage(website));
}

/**
 * Sayfa zaten getirilmisse tekrar indirmeden denetler.
 * Sosyal denetim ayni HTML'i kullandigi icin pipeline tek fetch yapar.
 */
export async function auditWebsiteFromPage(page: FetchPageResult): Promise<WebsiteAuditResult> {
  if (!page.html || !page.finalUrl) {
    return buildOfflineResult(`Sayfa alınamadı: ${page.error ?? `HTTP ${page.status}`}`, true);
  }
  return analyzePage(page);
}

async function analyzePage(page: FetchPageResult): Promise<WebsiteAuditResult> {
  const html = page.html as string;
  const finalUrl = page.finalUrl as string;
  const text = visibleText(html);
  const origin = new URL(finalUrl).origin;

  // Sunucu tarafi yoklamalari ve Lighthouse paralel calisir.
  const [hasRobots, hasSitemap, lighthouse] = await Promise.all([
    probeUrl(`${origin}/robots.txt`),
    probeUrl(`${origin}/sitemap.xml`),
    fetchLighthouse(finalUrl),
  ]);

  const title = pageTitle(html);
  const description = metaContent(html, 'description');
  const h1Count = countTag(html, 'h1');
  const lang = htmlLang(html);
  const blocking = renderBlockingCount(html);
  const socialLinks = extractSocialLinks(html);
  const platform = detectPlatform(html, page.headers);

  const rawSignals: WebsiteRawSignals = {
    ttfbMs: page.ttfbMs,
    htmlBytes: page.bytes,
    scriptCount: countTag(html, 'script'),
    stylesheetCount: (html.match(/rel=["']stylesheet["']/gi) ?? []).length,
    renderBlockingCount: blocking,
    imageCount: countTag(html, 'img'),
    title,
    metaDescription: description,
    h1Count,
    lang,
    hasRobotsTxt: hasRobots,
    hasSitemap,
    platform,
    copyrightYear: copyrightYear(text),
    socialLinks: socialLinks.map((s) => s.url),
    lighthousePerformance: lighthouse.performance,
  };

  const checks: AuditCheck[] = [];

  // --- Erisim ve guvenlik ---------------------------------------------------
  checks.push(
    check(
      'reachable',
      LABELS.reachable,
      page.ok ? 1 : 0.5,
      `HTTP ${page.status} — ${finalUrl}`,
      WEIGHTS.reachable,
    ),
  );

  const hstsHeader = Boolean(page.headers['strict-transport-security']);
  checks.push(
    check(
      'https',
      LABELS.https,
      page.https ? 1 : 0,
      page.https
        ? `HTTPS üzerinden yüklendi${hstsHeader ? ' (HSTS aktif)' : ''}`
        : 'Site yalnızca HTTP üzerinden yanıt verdi',
      WEIGHTS.https,
    ),
  );

  // --- Mobil ----------------------------------------------------------------
  const viewport = metaContent(html, 'viewport');
  checks.push(
    check(
      'mobileViewport',
      LABELS.mobileViewport,
      viewport ? 1 : 0,
      viewport ? `meta viewport: "${viewport}"` : 'meta viewport etiketi yok — mobilde ölçekleme bozulur',
      WEIGHTS.mobileViewport,
    ),
  );

  const responsive = PATTERNS.responsive.test(html);
  checks.push(
    check(
      'responsive',
      LABELS.responsive,
      responsive ? 1 : 0,
      responsive
        ? 'Media query / responsive grid işaretleri bulundu'
        : 'Responsive düzen işareti bulunamadı',
      WEIGHTS.responsive,
    ),
  );

  // --- Donusum yollari ------------------------------------------------------
  const hasCta = PATTERNS.cta.test(text);
  checks.push(
    check(
      'cta',
      LABELS.cta,
      hasCta ? 1 : 0,
      hasCta
        ? `CTA metni bulundu: "${text.match(PATTERNS.cta)?.[0]}"`
        : 'Üyelik/deneme/randevu yönlendiren net bir CTA bulunamadı',
      WEIGHTS.cta,
    ),
  );

  const whatsapp = WHATSAPP_PATTERN.test(html);
  checks.push(
    check(
      'whatsapp',
      LABELS.whatsapp,
      whatsapp ? 1 : 0,
      whatsapp ? 'WhatsApp bağlantısı var' : 'WhatsApp bağlantısı yok',
      WEIGHTS.whatsapp,
    ),
  );

  const booking = PATTERNS.booking.test(text) || /calendly|setmore|simplybook/i.test(html);
  checks.push(
    check(
      'booking',
      LABELS.booking,
      booking ? 1 : 0,
      booking
        ? `Rezervasyon/randevu işareti: "${text.match(PATTERNS.booking)?.[0] ?? 'rezervasyon aracı'}"`
        : 'Online rezervasyon veya randevu akışı yok',
      WEIGHTS.booking,
    ),
  );

  const membership = PATTERNS.membership.test(text);
  checks.push(
    check(
      'membership',
      LABELS.membership,
      membership ? 1 : 0,
      membership
        ? `Online üyelik/ödeme işareti: "${text.match(PATTERNS.membership)?.[0]}"`
        : 'Online üyelik veya ödeme akışı yok',
      WEIGHTS.membership,
    ),
  );

  const pricing = PATTERNS.pricing.test(text);
  checks.push(
    check(
      'pricing',
      LABELS.pricing,
      pricing ? 1 : 0,
      pricing
        ? `Fiyat/paket bilgisi: "${text.match(PATTERNS.pricing)?.[0]}"`
        : 'Paket veya fiyat bilgisi yayınlanmamış',
      WEIGHTS.pricing,
    ),
  );

  // --- Iletisim kolayligi (4 alt madde) ------------------------------------
  const contactParts = [
    { ok: TEL_LINK_PATTERN.test(html), label: 'tıklanabilir telefon' },
    { ok: MAILTO_PATTERN.test(html), label: 'e-posta bağlantısı' },
    { ok: PATTERNS.address.test(text), label: 'adres bilgisi' },
    { ok: PATTERNS.mapEmbed.test(html), label: 'harita' },
  ];
  const contactHits = contactParts.filter((p) => p.ok);
  checks.push(
    check(
      'contactEase',
      LABELS.contactEase,
      contactHits.length / contactParts.length,
      contactHits.length > 0
        ? `Bulunan: ${contactHits.map((p) => p.label).join(', ')}`
        : 'Telefon, e-posta, adres veya harita bulunamadı',
      WEIGHTS.contactEase,
    ),
  );

  // --- SEO temeli (6 alt madde) --------------------------------------------
  const seoParts = [
    { ok: Boolean(title && title.length >= 10 && title.length <= 70), label: 'uygun uzunlukta title' },
    {
      ok: Boolean(description && description.length >= 50 && description.length <= 170),
      label: 'meta description',
    },
    { ok: h1Count === 1, label: 'tek H1' },
    { ok: Boolean(metaContent(html, 'og:title')), label: 'Open Graph etiketleri' },
    { ok: /rel=["']canonical["']/i.test(html), label: 'canonical' },
    { ok: Boolean(lang), label: 'html lang' },
  ];
  const seoHits = seoParts.filter((p) => p.ok);
  const seoMisses = seoParts.filter((p) => !p.ok);
  checks.push(
    check(
      'seoBasics',
      LABELS.seoBasics,
      seoHits.length / seoParts.length,
      seoMisses.length === 0
        ? 'Tüm temel SEO etiketleri mevcut'
        : `Eksik: ${seoMisses.map((p) => p.label).join(', ')}`,
      WEIGHTS.seoBasics,
    ),
  );

  // --- Indekslenebilirlik ---------------------------------------------------
  // Google siralamasi bu sistemden olculemez; olculebilen sey sitenin
  // indekslenmeye acik olup olmadigidir. Madde bilincli olarak boyle adlandirildi.
  const robotsMeta = metaContent(html, 'robots') ?? '';
  const noindex = /noindex/i.test(robotsMeta);
  const indexParts = [!noindex, hasRobots === true, hasSitemap === true];
  const indexRatio = indexParts.filter(Boolean).length / indexParts.length;
  checks.push(
    check(
      'indexability',
      LABELS.indexability,
      indexRatio,
      noindex
        ? 'meta robots "noindex" — sayfa aramaya kapalı'
        : `robots.txt: ${hasRobots === true ? 'var' : hasRobots === false ? 'yok' : 'kontrol edilemedi'}, sitemap.xml: ${hasSitemap === true ? 'var' : hasSitemap === false ? 'yok' : 'kontrol edilemedi'}`,
      WEIGHTS.indexability,
    ),
  );

  // --- Performans -----------------------------------------------------------
  if (lighthouse.performance !== null) {
    checks.push(
      check(
        'performance',
        LABELS.performance,
        lighthouse.performance / 100,
        `Lighthouse mobil performans skoru: ${lighthouse.performance}/100`,
        WEIGHTS.performance,
      ),
    );
  } else {
    const perf = performanceRatio(page.ttfbMs, page.bytes, blocking);
    checks.push(
      check(
        'performance',
        LABELS.performance,
        perf.ratio,
        `Yerel ölçüm (Lighthouse anahtarı yok): ${perf.evidence}`,
        WEIGHTS.performance,
      ),
    );
  }

  // --- Guven unsurlari (5 alt madde) ---------------------------------------
  const trustParts = [
    { ok: page.https, label: 'HTTPS' },
    { ok: PATTERNS.address.test(text), label: 'fiziksel adres' },
    { ok: PATTERNS.about.test(text), label: 'hakkımızda/ekip' },
    { ok: PATTERNS.trustSocialProof.test(text), label: 'yorum/referans' },
    { ok: PATTERNS.trustLegal.test(text), label: 'KVKK/gizlilik' },
  ];
  const trustHits = trustParts.filter((p) => p.ok);
  checks.push(
    check(
      'trust',
      LABELS.trust,
      trustHits.length / trustParts.length,
      trustHits.length > 0
        ? `Bulunan: ${trustHits.map((p) => p.label).join(', ')}`
        : 'Güven unsuru bulunamadı',
      WEIGHTS.trust,
    ),
  );

  // --- Donusum optimizasyonu (4 alt madde) ---------------------------------
  const aboveFold = html.slice(0, 15_000);
  const conversionParts = [
    { ok: PATTERNS.cta.test(visibleText(aboveFold)), label: 'fold üstü CTA' },
    { ok: /<form[\s>]/i.test(html), label: 'iletişim formu' },
    { ok: PATTERNS.stickyContact.test(html), label: 'sabit iletişim butonu' },
    { ok: PATTERNS.chatWidget.test(html) || whatsapp, label: 'canlı sohbet/WhatsApp' },
  ];
  const conversionHits = conversionParts.filter((p) => p.ok);
  checks.push(
    check(
      'conversion',
      LABELS.conversion,
      conversionHits.length / conversionParts.length,
      conversionHits.length > 0
        ? `Bulunan: ${conversionHits.map((p) => p.label).join(', ')}`
        : 'Dönüşüm unsuru bulunamadı (fold üstü CTA, form, sabit buton, sohbet)',
      WEIGHTS.conversion,
    ),
  );

  // --- Skor -----------------------------------------------------------------
  // Olculemeyen maddeler (ratio === null) paydadan da dusulur; bilinmeyen
  // madde sifir puan gibi cezalandirilmaz.
  const measured = checks.filter((c) => c.ratio !== null);
  const achievable = measured.reduce((sum, c) => sum + c.weight, 0);
  const earned = measured.reduce((sum, c) => sum + (c.ratio as number) * c.weight, 0);
  const score = achievable === 0 ? 0 : Math.round((earned / achievable) * 100);

  const notes: string[] = [];
  if (platform) notes.push(`Altyapı: ${platform}`);
  if (rawSignals.copyrightYear && rawSignals.copyrightYear < new Date().getFullYear() - 1) {
    notes.push(`Telif yılı ${rawSignals.copyrightYear} — site güncellenmiyor olabilir`);
  }
  if (lighthouse.error && lighthouse.error !== 'PAGESPEED_API_KEY tanimli degil') {
    notes.push(`PageSpeed alınamadı: ${lighthouse.error}`);
  }

  // Guven: olculemeyen madde sayisi arttikca duser.
  const unmeasured = checks.length - measured.length;
  const confidence: Confidence = unmeasured === 0 ? 'high' : unmeasured <= 2 ? 'medium' : 'low';

  return {
    hasWebsite: true,
    httpStatus: page.status,
    finalUrl,
    checks,
    rawSignals,
    score,
    confidence,
    notes: notes.length > 0 ? notes.join(' · ') : null,
  };
}
