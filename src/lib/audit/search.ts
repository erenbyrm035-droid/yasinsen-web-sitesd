/**
 * WEB ARAMA KATMANI
 *
 * Sosyal medya profillerini bulmak icin kullanilir. Instagram/Facebook
 * sayfalarini DOGRUDAN KAZIMAYIZ — hem login duvari yuzunden ise yaramaz,
 * hem de platformlarin kosullarina aykiridir. Bunun yerine arama sonucunun
 * baslik + ozet metnini okuruz; kimlik dogrulamasi bu metinler uzerinden
 * yapilir.
 *
 * NEDEN ARAMA MOTORU KAZIMA DEGIL:
 * Bing/DuckDuckGo HTML sayfalarini kazimak denendi ve bilincli olarak
 * reddedildi. Bing'in RSS ciktisi telif metninde acikca "yalnizca kisisel,
 * ticari olmayan RSS okuyucu kullanimi" diyor; HTML kazima da kosullara
 * aykiri ve her arayuz degisiminde kirilgan. Uretimde her gun calisacak bir
 * sistemi bunun uzerine kurmak dogru degil.
 *
 * Bu yuzden yalnizca RESMI, kotasi belli bir API kullanilir:
 * Google Programmable Search (Custom Search JSON API) — gunde 100 sorgu
 * ucretsiz. Kurulumu docs/SOCIAL.md'de.
 *
 * Saglayici yapilandirilmamissa arama YAPILMAZ ve sonuc 'not_searched'
 * olarak isaretlenir. Uydurma profil uretilmez.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  id: string;
  search(query: string, limit: number): Promise<SearchResult[]>;
}

export class SearchUnavailableError extends Error {}

const CSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1';
const TIMEOUT_MS = 15_000;

function cseCredentials(): { key: string; cx: string } | null {
  // Ayri bir arama anahtari tercih edilir: Maps anahtari genelde yalnizca
  // harita API'lerine kisitlanmis olur ve Custom Search'e erisemez.
  const key =
    process.env.GOOGLE_SEARCH_API_KEY ??
    process.env.GOOGLE_MAPS_API_KEY ??
    process.env.PAGESPEED_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID ?? process.env.SEARCH_ENGINE_ID;
  if (!key || !cx) return null;
  return { key, cx };
}

interface CseResponse {
  items?: { title?: string; link?: string; snippet?: string }[];
  error?: { message?: string };
}

class GoogleCseProvider implements SearchProvider {
  readonly id = 'google-cse';

  constructor(
    private readonly key: string,
    private readonly cx: string,
  ) {}

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const url = new URL(CSE_ENDPOINT);
    url.searchParams.set('key', this.key);
    url.searchParams.set('cx', this.cx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', String(Math.min(Math.max(limit, 1), 10)));

    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await res.json().catch(() => ({}))) as CseResponse;

    if (!res.ok) {
      throw new SearchUnavailableError(
        `Custom Search HTTP ${res.status}${body.error?.message ? ` — ${body.error.message}` : ''}`,
      );
    }

    return (body.items ?? [])
      .filter((i): i is { title: string; link: string; snippet?: string } => Boolean(i.link))
      .map((i) => ({
        title: i.title ?? '',
        url: i.link,
        snippet: i.snippet ?? '',
      }));
  }
}

/**
 * Yapilandirilmis arama saglayicisi. Yoksa null — cagiran taraf bunu
 * 'not_searched' olarak isaretler, tahmin uretmez.
 */
export function getSearchProvider(): SearchProvider | null {
  const creds = cseCredentials();
  return creds ? new GoogleCseProvider(creds.key, creds.cx) : null;
}

export function searchProviderStatus(): { available: boolean; reason: string } {
  if (cseCredentials()) return { available: true, reason: 'Google Programmable Search etkin' };
  return {
    available: false,
    reason:
      'Arama sağlayıcısı yapılandırılmamış (GOOGLE_CSE_ID + GOOGLE_SEARCH_API_KEY gerekli) — ' +
      'sosyal profil araması atlanıyor, tahmin üretilmiyor',
  };
}
