/**
 * Denetim icin HTTP getirme katmani.
 *
 * Tek kural: olculemeyen sey null doner. Zaman asimi ya da baglanti hatasi
 * "site kotu" demek degildir — `ok:false` + `error` ile isaretlenir ve
 * denetim guveni (confidence) dusurulur.
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const PAGE_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 10_000;
/** Cok buyuk sayfalarda bellegi korumak icin okunan HTML ust siniri. */
const MAX_HTML_BYTES = 3_000_000;

export interface FetchPageResult {
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  html: string | null;
  /** Yanitin ilk baytina kadar gecen sure (ms). */
  ttfbMs: number | null;
  bytes: number | null;
  headers: Record<string, string>;
  /** HTTPS uzerinden basarili yanit alindi mi. */
  https: boolean;
  error: string | null;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Sayfayi getirir. HTTPS basarisiz olursa HTTP'ye duser — cunku "HTTPS yok"
 * bulgusu ancak siteye HTTP ile ulasilabildigi zaman dogrulanabilir.
 */
export async function fetchPage(url: string): Promise<FetchPageResult> {
  const attempts = [normalizeUrl(url)];
  if (attempts[0].startsWith('https://')) {
    attempts.push(attempts[0].replace(/^https:/, 'http:'));
  }

  let lastError: string | null = null;

  for (const attempt of attempts) {
    const started = Date.now();
    try {
      const res = await fetch(attempt, {
        redirect: 'follow',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });

      const ttfbMs = Date.now() - started;
      const buffer = await res.arrayBuffer();
      const sliced = buffer.byteLength > MAX_HTML_BYTES ? buffer.slice(0, MAX_HTML_BYTES) : buffer;
      const html = new TextDecoder('utf-8', { fatal: false }).decode(sliced);

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      return {
        ok: res.ok,
        status: res.status,
        finalUrl: res.url || attempt,
        html,
        ttfbMs,
        bytes: buffer.byteLength,
        headers,
        https: (res.url || attempt).startsWith('https://'),
        error: null,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    ok: false,
    status: null,
    finalUrl: null,
    html: null,
    ttfbMs: null,
    bytes: null,
    headers: {},
    https: false,
    error: lastError,
  };
}

/**
 * Bir yolun var olup olmadigini yoklar (robots.txt, sitemap.xml, sosyal profil).
 * Donen deger: true = 200, false = 404/benzeri, null = kontrol edilemedi.
 */
export async function probeUrl(url: string): Promise<boolean | null> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.status >= 200 && res.status < 300) return true;
    if (res.status === 404 || res.status === 410) return false;
    // 403/429 gibi durumlar "yok" anlamina gelmez — belirsiz birak.
    return null;
  } catch {
    return null;
  }
}

export interface LighthouseResult {
  performance: number | null;
  error: string | null;
}

/**
 * PageSpeed Insights (Lighthouse) skoru.
 * PAGESPEED_API_KEY yoksa CAGIRILMAZ ve null doner — skor uydurulmaz.
 * (Anahtarsiz paylasimli kota bu ortamda 429 veriyor.)
 */
export async function fetchLighthouse(url: string): Promise<LighthouseResult> {
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (!apiKey) return { performance: null, error: 'PAGESPEED_API_KEY tanimli degil' };

  const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('strategy', 'mobile');
  endpoint.searchParams.set('category', 'performance');
  endpoint.searchParams.set('key', apiKey);

  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) return { performance: null, error: `PageSpeed HTTP ${res.status}` };

    const body = (await res.json()) as {
      lighthouseResult?: { categories?: { performance?: { score?: number } } };
    };
    const score = body.lighthouseResult?.categories?.performance?.score;
    if (typeof score !== 'number') return { performance: null, error: 'PageSpeed skoru yanitta yok' };

    return { performance: Math.round(score * 100), error: null };
  } catch (err) {
    return { performance: null, error: err instanceof Error ? err.message : String(err) };
  }
}
