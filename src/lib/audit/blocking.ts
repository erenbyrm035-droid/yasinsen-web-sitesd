import { pageTitle, visibleText } from './signals';

/**
 * ENGEL / CHALLENGE SAYFASI TESPITI
 *
 * Neden var: bir sunucu HTTP 403 dondugunde de govdede HTML gonderir. O HTML
 * isletmenin sitesi degil, guvenlik duvarinin "erisim engellendi" sayfasidir.
 * Denetim motoru bunu gercek sayfa sanip analiz ederse ortaya su cikar:
 *
 *   MACFit Mall of Istanbul -> website skoru 33, guven: YUKSEK
 *     reachable ✓  kanit: "HTTP 403"        <- kendi icinde celiskili
 *
 * Yani Cloudflare'in hata sayfasi denetlenip "bu isletmenin sitesi kotu"
 * hukmu veriliyordu. Turkiye'nin en buyuk zincirinin sitesi gayet calisiyor.
 *
 * Daha sinsi olan durum: bazi WAF'lar challenge sayfasini HTTP 200 ile
 * dondurur. O yuzden yalnizca durum koduna bakmak yetmez, ICERIGE de bakilir.
 *
 * TASARIM KURALI — yanlis pozitif, yanlis negatiften pahalidir.
 * Gercek bir siteyi "engellendi" diye isaretlersek olculebilir bir lead'i
 * elle incelemeye gondeririz (maliyet: biraz insan zamani). Tersini yaparsak
 * musteriye yanlis bilgiyle gideriz (maliyet: guvenilirlik). Bu yuzden
 * saticiya ozgu imzalar disinda kalan zayif ipuclari tek basina yeterli
 * sayilmaz; kisa govde sarti aranir.
 */

export type BlockKind =
  /** Bot korumasi / WAF challenge sayfasi. */
  | 'blocked'
  /** Hata sayfasi (HTTP 200 ile donen 404/500 gibi). */
  | 'error_page'
  /** Sayfa geldi ama icerigi sunucudan gelmiyor: JS ile render edilen SPA
   *  ya da neredeyse bos bir govde. Engellenmedik — okuyamiyoruz. */
  | 'unrendered';

export interface BlockDetection {
  kind: BlockKind | null;
  /** Tespit edilen saglayici / hata turu — kanit metninde gorunur. */
  vendor: string | null;
  evidence: string | null;
}

const NOT_BLOCKED: BlockDetection = { kind: null, vendor: null, evidence: null };

/**
 * Saticiya ozgu imzalar. Bunlar gercek bir isletme sayfasinda tesadufen
 * bulunmaz — tek basina karar vermek icin yeterlidir.
 */
const VENDOR_SIGNATURES: { vendor: string; pattern: RegExp }[] = [
  { vendor: 'Cloudflare', pattern: /cdn-cgi\/challenge-platform|__cf_chl|cf_chl_opt|cf-browser-verification|cf-error-details/i },
  { vendor: 'Cloudflare', pattern: /Attention Required!\s*\|\s*Cloudflare/i },
  { vendor: 'Imperva/Incapsula', pattern: /_Incapsula_Resource|Incapsula incident ID|Request unsuccessful\./i },
  { vendor: 'Sucuri', pattern: /sucuri_cloudproxy|Sucuri WebSite Firewall/i },
  { vendor: 'PerimeterX', pattern: /perimeterx|_pxhd|px-captcha/i },
  { vendor: 'DataDome', pattern: /datadome|dd_cookie_test/i },
  { vendor: 'Akamai', pattern: /AkamaiGHost|Reference&#32;#\d+\.|akamai\.net\/errorpage/i },
  { vendor: 'AWS WAF', pattern: /awswaf|aws-waf-token/i },
  { vendor: 'ModSecurity', pattern: /Mod_Security|ModSecurity Action/i },
];

/** Challenge/engel basliklari. Kisa govde sartiyla birlikte degerlendirilir. */
const BLOCK_TITLES = [
  /just a moment/i,
  /one moment,?\s*please/i,
  /bir dakika l[üu]tfen/i,
  /l[üu]tfen bekleyin/i,
  /checking your browser/i,
  /attention required/i,
  /access denied/i,
  /erişim engellendi|erisim engellendi/i,
  /forbidden/i,
  /you have been blocked/i,
  /security check/i,
  /are you a (human|robot)/i,
  /bot verification/i,
  /ddos protection/i,
  /request blocked/i,
  /site\s*(is\s*)?(temporarily\s*)?unavailable/i,
];

/** Govdede gecen engel ifadeleri. Yine kisa govde sartiyla birlikte. */
const BLOCK_PHRASES = [
  /please wait while your request is being verified/i,
  /iste[ğg]iniz do[ğg]rulan(ı|i)rken/i,
  /enable javascript and cookies to continue/i,
  /checking if the site connection is secure/i,
  /your request has been blocked/i,
  /this website is using a security service to protect itself/i,
  /bu site kendini korumak için bir güvenlik servisi kullanıyor/i,
  /verify you are human/i,
];

/** HTTP 200 ile dondurulen "sayfa bulunamadi" / sunucu hatasi sayfalari. */
const ERROR_TITLES = [
  /^\s*404\b/,
  /page not found/i,
  /not found\s*$/i,
  /sayfa bulunamadı|sayfa bulunamadi/i,
  /^\s*(500|502|503)\b/,
  /internal server error/i,
  /server error/i,
];

/**
 * Govde "gercek bir isletme sayfasi" gibi mi duruyor?
 * Engel sayfalari kisadir ve neredeyse hic link icermez. Gercek bir kurumsal
 * site bu esiklerin cok uzerindedir.
 */
function looksThin(html: string, text: string): boolean {
  const linkCount = (html.match(/<a\b/gi) ?? []).length;
  return text.length < 1200 && linkCount < 12;
}

export function detectBlockPage(html: string | null, httpStatus: number | null): BlockDetection {
  if (!html) return NOT_BLOCKED;

  // 1) Saticiya ozgu imza: tek basina yeterli.
  for (const { vendor, pattern } of VENDOR_SIGNATURES) {
    const match = html.match(pattern);
    if (match) {
      return {
        kind: 'blocked',
        vendor,
        evidence: `${vendor} bot koruması imzası bulundu ("${match[0].slice(0, 60)}")`,
      };
    }
  }

  const title = pageTitle(html) ?? '';
  const text = visibleText(html);
  const thin = looksThin(html, text);

  // 2) Baslik/govde ifadesi + ince govde: birlikte yeterli.
  //    Tek baslarina degil — gercek bir sayfada "forbidden" kelimesi gecebilir.
  if (thin) {
    const titleHit = BLOCK_TITLES.find((r) => r.test(title));
    if (titleHit) {
      return {
        kind: 'blocked',
        vendor: null,
        evidence: `Engel sayfası başlığı: "${title.slice(0, 80)}" (gövde ${text.length} karakter)`,
      };
    }

    const phraseHit = BLOCK_PHRASES.find((r) => r.test(text));
    if (phraseHit) {
      const found = text.match(phraseHit)?.[0] ?? '';
      return {
        kind: 'blocked',
        vendor: null,
        evidence: `Engel sayfası ifadesi: "${found.slice(0, 80)}"`,
      };
    }

    // 3) HTTP 200 ile dondurulen hata sayfasi (soft 404). Tanınabilir bir
    //    hata sayfasi, asagidaki genel yakalayicidan ONCE siniflandirilir.
    //    Yalnizca sunucu basarili dedi ama icerik hata sayfasi ise anlamli.
    if (httpStatus !== null && httpStatus >= 200 && httpStatus < 300) {
      const errorHit = ERROR_TITLES.find((r) => r.test(title));
      if (errorHit) {
        return {
          kind: 'error_page',
          vendor: null,
          evidence: `HTTP ${httpStatus} döndü ama sayfa bir hata sayfası: "${title.slice(0, 80)}"`,
        };
      }
    }
    /**
     * 4) Genel yakalayici: link'i olmayan, neredeyse bos bir sayfa.
     *
     * Gercek bir isletme anasayfasinda menu, iletisim, hizmet linkleri olur.
     * Hic link icermeyen ve birkac cumleden ibaret bir govde ya challenge, ya
     * JS ile render edilen bir SPA, ya da bos bir sablon sayfasidir. Hicbir
     * durumda uzerinden "website kalitesi" hukmu verilemez.
     *
     * Bu kural, kalip listesine guvenmenin yetmedigini gosteren gercek
     * vakadan dogdu: gymcity.com.tr HTTP 200 ile "One moment, please..."
     * donuyordu, saticiya ozgu hicbir imza tasimiyordu ve sistem sayfayi
     * denetleyip website skorunu 67'den 32'ye dusurmustu. Site degismemisti;
     * biz engellenmistik.
     *
     * SPA ile challenge AYIRT EDILIR — ikisi de olculemez ama sebepleri
     * farklidir ve rapordaki gerekce dogru olmali.
     */
    const linkCount = (html.match(/<a\b/gi) ?? []).length;
    if (linkCount === 0 && text.length < 200) {
      const spa = /id=["']root["']|id=["']app["']|__NEXT_DATA__|ng-app|data-reactroot|<div[^>]+id=["']__nuxt/i.test(html);
      return {
        kind: 'unrendered',
        vendor: spa ? 'JS uygulaması' : null,
        evidence: spa
          ? `Sayfa JavaScript ile render ediliyor — sunucudan gelen HTML boş bir kabuk ` +
            `(${text.length} karakter, hiç bağlantı yok)`
          : `Sayfada hiç bağlantı yok ve görünür metin ${text.length} karakter ` +
            `("${text.slice(0, 60)}") — içerik okunamadı`,
      };
    }

  }

  return NOT_BLOCKED;
}
