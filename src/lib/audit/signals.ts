/**
 * HTML'den sinyal cikarma yardimcilari.
 *
 * Bilincli olarak regex tabanli: denetim icin gereken sinyaller sig ve
 * yapisal degil (link var mi, meta var mi, kelime geciyor mu). Tam bir DOM
 * parser'i ek bagimlilik getirir ve bu sinyaller icin dogruluk kazandirmaz.
 */

/** <script>/<style>/yorum bloklarini atarak yalnizca gorunur metni birakir. */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function metaContent(html: string, name: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i'),
    new RegExp(`<meta[^>]+property=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function pageTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, ' ').trim() || null;
}

export function countTag(html: string, tag: string): number {
  return html.match(new RegExp(`<${tag}[\\s>]`, 'gi'))?.length ?? 0;
}

export function htmlLang(html: string): string | null {
  const match = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  return match?.[1]?.trim() ?? null;
}

/** Sayfadaki tum href/src degerleri. */
export function allLinks(html: string): string[] {
  return [...html.matchAll(/(?:href|src)=["']([^"']+)["']/gi)].map((m) => m[1]);
}

/**
 * Render'i bloklayan kaynak sayisi: <head> icindeki defer/async'siz script'ler
 * ve stylesheet'ler.
 */
export function renderBlockingCount(html: string): number {
  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? html.slice(0, 20_000);
  const scripts = [...head.matchAll(/<script\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /\bsrc=/i.test(tag) && !/\b(defer|async|type=["']module["'])/i.test(tag));
  const styles = [...head.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)];
  return scripts.length + styles.length;
}

/** Site altyapisi — sablon kalitesi ve yenilenme maliyeti hakkinda ipucu. */
export function detectPlatform(html: string, headers: Record<string, string>): string | null {
  const generator = metaContent(html, 'generator');
  const haystack = `${html.slice(0, 60_000)} ${generator ?? ''} ${headers['x-powered-by'] ?? ''}`;

  if (/wp-content|wp-includes|wordpress/i.test(haystack)) return 'WordPress';
  if (/wix\.com|wixstatic|X-Wix/i.test(haystack)) return 'Wix';
  if (/squarespace/i.test(haystack)) return 'Squarespace';
  if (/shopify/i.test(haystack)) return 'Shopify';
  if (/webflow/i.test(haystack)) return 'Webflow';
  if (/ticimax|ideasoft|tsoft/i.test(haystack)) return 'Ticari e-ticaret altyapisi';
  if (/_next\/static|__NEXT_DATA__/i.test(haystack)) return 'Next.js';
  if (/\/_nuxt\//i.test(haystack)) return 'Nuxt';
  return null;
}

/** Sayfadaki en buyuk telif yili — sitenin ne zaman guncellendigine dair ipucu. */
export function copyrightYear(text: string): number | null {
  const years = [...text.matchAll(/(?:©|&copy;|copyright|telif)[^0-9]{0,20}(20\d{2})/gi)].map((m) =>
    Number.parseInt(m[1], 10),
  );
  if (years.length === 0) return null;
  return Math.max(...years);
}

// ---------------------------------------------------------------------------
// Anahtar kelime kaliplari (TR + EN)
// ---------------------------------------------------------------------------

export const PATTERNS = {
  cta: /üye ol|uye ol|hemen başla|hemen basla|deneme dersi|ücretsiz dene|ucretsiz dene|randevu al|kayıt ol|kayit ol|bize ulaşın|bize ulasin|iletişime geç|iletisime gec|join now|sign up|book now|get started|free trial|start today/i,
  booking:
    /rezervasyon|randevu|ders programı|ders programi|seans seç|seans sec|calendly|setmore|appointment|booking|book a class|schedule/i,
  membership:
    /üyelik satın|uyelik satin|online üyelik|online uyelik|sepete ekle|sepet|ödeme|odeme|checkout|satın al|satin al|abonelik|membership plan|buy membership/i,
  pricing: /fiyat|ücret|ucret|paket|tarife|₺|\btl\b|pricing|price list|packages|abonelik ücreti/i,
  trustSocialProof:
    /yorum|referans|üye görüşleri|uye gorusleri|başarı hikaye|basari hikaye|testimonial|review|müşteri yorumları|musteri yorumlari/i,
  trustLegal: /kvkk|gizlilik politikası|gizlilik politikasi|çerez politikası|cerez politikasi|privacy policy|kullanım koşulları|kullanim kosullari|mesafeli satış/i,
  about: /hakkımızda|hakkimizda|biz kimiz|about us|ekibimiz|our team|eğitmenler|egitmenler|trainers/i,
  address: /mah\.|mahalle|sokak|sok\.|cad\.|cadde|no:|kat:|istanbul|i̇stanbul|adres/i,
  chatWidget: /tawk\.to|crisp\.chat|intercom|zendesk|livechat|jivosite|whatsapp-widget/i,
  mapEmbed: /google\.com\/maps|maps\.google|maps\.googleapis|yandex\.com\/map|openstreetmap/i,
  responsive: /@media[^{]*\(\s*(?:max|min)-width|col-(?:xs|sm|md|lg)|\bflex\b|\bgrid\b|tailwind|bootstrap/i,
  stickyContact: /position\s*:\s*(?:fixed|sticky)|class=["'][^"']*(?:sticky|fixed|floating)[^"']*["']/i,
} as const;

export const WHATSAPP_PATTERN = /wa\.me\/|api\.whatsapp\.com|whatsapp:\/\/|web\.whatsapp\.com/i;
export const TEL_LINK_PATTERN = /href=["']tel:/i;
export const MAILTO_PATTERN = /href=["']mailto:/i;

// ---------------------------------------------------------------------------
// Sosyal medya
// ---------------------------------------------------------------------------

export interface SocialLink {
  platform: 'instagram' | 'facebook' | 'youtube' | 'tiktok';
  handle: string | null;
  url: string;
}

const SOCIAL_MATCHERS: {
  platform: SocialLink['platform'];
  pattern: RegExp;
  /** Profil olmayan yollar (paylas butonlari, gomulu icerik vb.) */
  reject: RegExp;
}[] = [
  {
    platform: 'instagram',
    pattern: /(?:https?:)?\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)/i,
    reject: /^(p|reel|reels|explore|stories|accounts|share|tv|direct)$/i,
  },
  {
    platform: 'facebook',
    pattern: /(?:https?:)?\/\/(?:www\.|tr-tr\.|web\.)?facebook\.com\/([A-Za-z0-9._-]+)/i,
    reject: /^(sharer|share|plugins|tr|dialog|profile\.php|people|pages|events|photo)$/i,
  },
  {
    platform: 'youtube',
    pattern: /(?:https?:)?\/\/(?:www\.)?youtube\.com\/((?:@|c\/|channel\/|user\/)?[A-Za-z0-9._-]+)/i,
    reject: /^(embed|watch|results|shorts|player)$/i,
  },
  {
    platform: 'tiktok',
    pattern: /(?:https?:)?\/\/(?:www\.)?tiktok\.com\/(@[A-Za-z0-9._]+)/i,
    reject: /^(embed|share|music|tag)$/i,
  },
];

/** Sayfadaki linklerden sosyal medya profillerini cikarir (tekil, ilk gorulen). */
export function extractSocialLinks(html: string): SocialLink[] {
  const links = allLinks(html);
  const found = new Map<SocialLink['platform'], SocialLink>();

  for (const link of links) {
    for (const matcher of SOCIAL_MATCHERS) {
      if (found.has(matcher.platform)) continue;

      const match = link.match(matcher.pattern);
      if (!match) continue;

      const handle = match[1]?.replace(/\/$/, '') ?? null;
      if (!handle || matcher.reject.test(handle)) continue;

      const url = link.startsWith('//') ? `https:${link}` : link;
      found.set(matcher.platform, {
        platform: matcher.platform,
        handle,
        url: /^https?:\/\//i.test(url) ? url : `https://${url}`,
      });
    }
  }

  return [...found.values()];
}

/** Sitede gomulu sosyal feed var mi (Elfsight, LightWidget, IG embed...). */
export function hasSocialFeedEmbed(html: string): boolean {
  return /elfsight|lightwidget|snapwidget|instagram-media|juicer\.io|curator\.io|behold\.so|taggbox/i.test(
    html,
  );
}
