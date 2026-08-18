import type { SocialMatch, SocialPlatform } from '../types';
import { getSearchProvider, searchProviderStatus, type SearchResult } from './search';
import { extractSocialLinks, type SocialLink } from './signals';
import { fetchPage } from './fetcher';

/**
 * SOSYAL PROFIL KESFI
 *
 * Uc kaynak, guvenlik sirasina gore:
 *   1. Isletmenin kendi sitesindeki link      -> kanit tam, dogrulama gerekmez
 *   2. Sitenin iletisim/hakkimizda sayfalari  -> ayni guc, sadece daha derin
 *   3. Web aramasi + kimlik dogrulama         -> yalnizca esik gecilirse
 *
 * DOGRULAMA OLMADAN PROFIL EKLENMEZ. Arama sonucundaki her instagram linki
 * isletmeye ait degildir; "pilates istanbul" aramasi onlarca baska studyo
 * dondurur. Yanlis profil eklemek, yanlis skor uretmekten daha kotudur:
 * musteriye "sosyal medyanız zayıf" derken baskasinin hesabina bakiyor
 * oluruz.
 *
 * Esigi gecemeyen aday KAYDEDILMEZ, 'unverified' olarak raporlanir.
 */

/** Dogrulama esigi. Altinda kalan aday reddedilir. */
const MATCH_THRESHOLD = 0.55;

/** Sitede sosyal link bulunamazsa bakilacak ek sayfalar. */
const EXTRA_PATHS = ['/iletisim', '/contact', '/hakkimizda', '/about', '/bize-ulasin'];

/** Isletme adinda ayirt edici olmayan kelimeler — eslesmeye sayilmaz. */
const STOPWORDS = new Set([
  'spor', 'salonu', 'salon', 'merkezi', 'merkez', 'studyo', 'studio', 'stüdyo',
  'fitness', 'gym', 'pilates', 'reformer', 'crossfit', 'club', 'kulup', 'kulübü',
  'center', 'centre', 'akademi', 'academy', 'ltd', 'sti', 'as', 've', 'the',
  'istanbul', 'turkiye', 'türkiye',
]);

export interface DiscoveryCompany {
  name: string;
  website: string | null;
  city: string | null;
  district: string | null;
  phone: string | null;
}

export interface DiscoveredProfile {
  link: SocialLink;
  source: 'website' | 'search';
  match: SocialMatch;
}

export interface DiscoveryOutcome {
  profiles: DiscoveredProfile[];
  /** Bulunan ama dogrulanamayan adaylar — kaydedilmez, raporlanir. */
  rejected: { url: string; score: number; reason: string }[];
  searched: boolean;
  searchReason: string;
}

// --- metin normalizasyonu ---------------------------------------------------

/** Turkce karakterleri katlar, yalnizca harf/rakam birakir. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

function significantTokens(name: string): string[] {
  return name
    .split(/[\s\-_.,/&()]+/)
    .map((t) => normalize(t))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// --- kimlik dogrulama -------------------------------------------------------

/**
 * Aday profilin gercekten bu isletmeye ait olup olmadigini puanlar.
 *
 * Kanit kaynagi yalnizca arama sonucunun basligi ve ozeti — profil sayfasi
 * ACILMAZ. Bu bilincli: platformlar anonim profil erisimini kapatiyor ve
 * kazima kosullara aykiri.
 */
export function verifyCandidate(
  company: DiscoveryCompany,
  candidate: { handle: string | null; url: string; title: string; snippet: string },
): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  const haystack = normalize(`${candidate.title} ${candidate.snippet}`);
  const handle = normalize(candidate.handle ?? '');
  const tokens = significantTokens(company.name);

  // 1) Isletme adinin ayirt edici kelimeleri handle icinde geciyor mu.
  const inHandle = tokens.filter((t) => handle.includes(t));
  if (tokens.length > 0 && inHandle.length > 0) {
    const ratio = inHandle.length / tokens.length;
    score += 0.45 * ratio;
    signals.push(`işletme adı handle içinde (${inHandle.join(', ')})`);
  }

  // 2) Isletme adi arama sonucu metninde geciyor mu.
  const inText = tokens.filter((t) => haystack.includes(t));
  if (tokens.length > 0 && inText.length > 0) {
    const ratio = inText.length / tokens.length;
    score += 0.25 * ratio;
    signals.push(`işletme adı sonuç metninde (${inText.join(', ')})`);
  }

  // 3) Isletmenin kendi alan adi profil metninde geciyor mu. Cok guclu sinyal:
  //    bio'suna kendi sitesini yazmis demektir.
  const domain = domainOf(company.website);
  if (domain) {
    const domainCore = normalize(domain.split('.')[0]);
    if (domainCore.length >= 4 && (haystack.includes(domainCore) || handle.includes(domainCore))) {
      score += 0.3;
      signals.push(`website alan adı eşleşiyor (${domain})`);
    }
  }

  // 4) Konum bilgisi.
  for (const place of [company.district, company.city]) {
    if (!place) continue;
    const p = normalize(place);
    if (p.length >= 4 && haystack.includes(p)) {
      score += 0.12;
      signals.push(`konum eşleşiyor (${place})`);
      break;
    }
  }

  // 5) Telefon. Nadiren gorunur ama gorunduyse neredeyse kesin kanit.
  if (company.phone) {
    const phone = digitsOnly(company.phone).slice(-7);
    if (phone.length === 7 && digitsOnly(`${candidate.title} ${candidate.snippet}`).includes(phone)) {
      score += 0.35;
      signals.push('telefon numarası eşleşiyor');
    }
  }

  return { score: Math.min(score, 1), signals };
}

// --- kesif ------------------------------------------------------------------

function candidateFromResult(result: SearchResult): SocialLink | null {
  const links = extractSocialLinks(`<a href="${result.url}"></a>`);
  return links[0] ?? null;
}

/** Isletme adi + konum + platform seklinde arama sorgusu kurar. */
export function buildQueries(company: DiscoveryCompany): { platform: SocialPlatform; query: string }[] {
  const place = company.district ?? company.city ?? '';
  return [
    { platform: 'instagram' as SocialPlatform, query: `"${company.name}" ${place} instagram` },
    { platform: 'facebook' as SocialPlatform, query: `"${company.name}" ${place} facebook` },
  ];
}

/**
 * Sitenin ic sayfalarinda sosyal link arar. Anasayfada link olmamasi
 * "sosyal medyasi yok" demek degil — cogu site linkleri iletisim sayfasina
 * koyuyor.
 */
async function discoverOnExtraPages(website: string): Promise<SocialLink[]> {
  let origin: string;
  try {
    origin = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).origin;
  } catch {
    return [];
  }

  for (const path of EXTRA_PATHS) {
    const page = await fetchPage(`${origin}${path}`);
    if (!page.html || page.status === null || page.status >= 400) continue;
    const links = extractSocialLinks(page.html);
    if (links.length > 0) return links;
  }
  return [];
}

export async function discoverSocialProfiles(
  company: DiscoveryCompany,
  homepageHtml: string | null,
): Promise<DiscoveryOutcome> {
  const rejected: DiscoveryOutcome['rejected'] = [];

  // --- 1. Anasayfadaki linkler -------------------------------------------
  let onSite = homepageHtml ? extractSocialLinks(homepageHtml) : [];

  // --- 2. Ic sayfalar -----------------------------------------------------
  if (onSite.length === 0 && company.website) {
    onSite = await discoverOnExtraPages(company.website);
  }

  if (onSite.length > 0) {
    return {
      profiles: onSite.map((link) => ({
        link,
        source: 'website' as const,
        match: {
          source: 'website' as const,
          score: 1,
          signals: ['işletmenin kendi sitesinde bu profile link veriliyor'],
          query: null,
        },
      })),
      rejected,
      searched: false,
      searchReason: 'Sitede doğrudan link bulundu, aramaya gerek kalmadı',
    };
  }

  // --- 3. Web aramasi -----------------------------------------------------
  const provider = getSearchProvider();
  if (!provider) {
    return { profiles: [], rejected, searched: false, searchReason: searchProviderStatus().reason };
  }

  const found = new Map<SocialPlatform, DiscoveredProfile>();

  for (const { platform, query } of buildQueries(company)) {
    let results: SearchResult[] = [];
    try {
      results = await provider.search(query, 5);
    } catch (err) {
      return {
        profiles: [...found.values()],
        rejected,
        searched: true,
        searchReason: `Arama başarısız: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    for (const result of results) {
      const link = candidateFromResult(result);
      if (!link || link.platform !== platform) continue;
      if (found.has(platform)) break;

      const verdict = verifyCandidate(company, {
        handle: link.handle,
        url: link.url,
        title: result.title,
        snippet: result.snippet,
      });

      if (verdict.score < MATCH_THRESHOLD) {
        rejected.push({
          url: link.url,
          score: Number(verdict.score.toFixed(2)),
          reason:
            verdict.signals.length > 0
              ? `Yetersiz eşleşme: ${verdict.signals.join('; ')}`
              : 'Hiçbir kimlik sinyali eşleşmedi',
        });
        continue;
      }

      found.set(platform, {
        link,
        source: 'search',
        match: {
          source: 'search',
          score: Number(verdict.score.toFixed(2)),
          signals: verdict.signals,
          query,
        },
      });
    }
  }

  return {
    profiles: [...found.values()],
    rejected,
    searched: true,
    searchReason: `${provider.id} ile arandı`,
  };
}
