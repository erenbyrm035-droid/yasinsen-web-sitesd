import type {
  DiscoveredCompany,
  DiscoveryCriteria,
  LeadSource,
  Segment,
} from '../types';

/**
 * OpenStreetMap / Overpass API lead kaynagi.
 *
 * Neden OSM: Apollo Free plan People Search'u kapatiyor (docs/APOLLO.md).
 * OSM ucretsiz, acik lisansli (ODbL) ve Istanbul fitness isletmeleri icin
 * gercek isim/adres/website/telefon verisi veriyor.
 *
 * Sinir: OSM calisan sayisi ve karar verici bilgisi tasimaz — bu alanlar
 * null kalir, tahmin edilmez.
 */

/**
 * Tek endpoint: overpass-api.de.
 *
 * Denenip elenen aynalar — yedek olarak eklenmemelerinin nedeni:
 *   * kumi.systems, private.coffee : bu ortamdan erisilemiyor (zaman asimi)
 *   * maps.mail.ru                 : HTTP 504
 *   * overpass.osm.ch              : yanit veriyor ama yalnizca Isvicre verisi
 *                                    tasiyor; Turkiye sorgusuna BOS ama basarili
 *                                    yanit donuyor. Yedek olarak eklenirse
 *                                    "veri yok" ile "sunucu yok" ayirt edilemez
 *                                    hale gelir — bu yuzden kullanilmiyor.
 *
 * overpass-api.de kullanici basina 2 es zamanli slot veriyor; slot dolunca
 * HTTP 503 veya baglanti sifirlamasi doner. Sorgular SIRAYLA calisir ve
 * her sorgudan once /api/status okunup bos slot beklenir.
 */
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const OVERPASS_STATUS = 'https://overpass-api.de/api/status';
const RETRY_DELAYS_MS = [10_000, 30_000, 60_000];
const USER_AGENT = 'viva-sales-engine/0.1 (lead research)';

/**
 * Sehir sinirlari bbox olarak tutuluyor. `area["name"=...]` aramasi cok daha
 * pahali ve Overpass'te sik sik zaman asimina ugruyor; bbox indeksli ve hizli.
 * Sira: [guney, bati, kuzey, dogu]
 */
const CITY_BBOX: Record<string, { label: string; bbox: [number, number, number, number] }> = {
  istanbul: { label: 'İstanbul', bbox: [40.80, 27.95, 41.65, 29.95] },
};

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

/**
 * Sorgular kucuk parcalara bolunmustur. Tek buyuk sorgu (ozellikle indekssiz
 * `sport` regex'i tum il alaninda) Overpass'te zaman asimina/503'e yol aciyor;
 * `leisure` uzerinden daralttiktan sonra filtrelemek hizli calisiyor.
 *
 * Ilk sorgu birincildir: basarisiz olursa discovery hata verir. Sonrakiler
 * tamamlayicidir; basarisiz olurlarsa uyari loglanip eldeki sonucla devam
 * edilir — eksik veri uydurulmaz.
 */
function buildQueries(
  bbox: [number, number, number, number],
  limit: number,
): { label: string; query: string }[] {
  const box = bbox.join(',');
  return [
    {
      label: 'fitness_centre',
      query: `[out:json][timeout:60];nwr["leisure"="fitness_centre"](${box});out center ${limit};`,
    },
    {
      label: 'sports_centre (pilates/crossfit/dovus)',
      query: `[out:json][timeout:60];nwr["leisure"="sports_centre"]["sport"~"pilates|crossfit|martial_arts|boxing|yoga|fitness",i](${box});out center ${limit};`,
    },
  ];
}

/** OSM tag'lerinden isletme segmentini cikarir. */
export function classifySegment(tags: Record<string, string>): Segment {
  const haystack = [tags.name, tags.sport, tags.leisure, tags.brand, tags['name:en']]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/pilates|reformer/.test(haystack)) return 'pilates_studio';
  if (/crossfit|cross fit/.test(haystack)) return 'crossfit_box';
  if (/martial|karate|judo|taekwondo|boks|boxing|muay|mma|dovus|dövüş|kickbox/.test(haystack)) {
    return 'martial_arts';
  }
  if (/personal train|pt studio|ept|kisisel antren/.test(haystack)) return 'personal_training';
  if (/boutique|studio|stüdyo|studyo/.test(haystack)) return 'boutique_gym';
  if (/gym|fitness|spor salonu|health club|fit\b/.test(haystack)) return 'gym';
  return 'fitness_other';
}

/**
 * Belediye/universite/kamu tesisleri OSM'de ticari salonlarla ayni tag'i
 * tasiyor ama satis hedefimiz degiller (butce ve karar sureci tamamen farkli).
 * Silinmezler — sadece siralamada geriye alinir ve business potential
 * hesabinda cezalandirilirlar, boylece karar kullanicida kalir.
 */
export function isInstitutional(tags: Record<string, string>, website: string | null): boolean {
  const haystack = [tags.name, tags.operator, tags['operator:type'], website]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (
    /belediye|municipal|üniversite|universite|university|\bitu\b|kaymakam|gençlik ve spor|genclik ve spor|devlet|kamu|halk eğitim|halk egitim/.test(
      haystack,
    ) || /\.edu\.tr|\.gov\.tr|\.bel\.tr|spor\.istanbul/.test(haystack)
  );
}

const SEGMENT_INDUSTRY: Record<Segment, string> = {
  gym: 'Fitness & Gym',
  boutique_gym: 'Boutique Gym',
  pilates_studio: 'Pilates / Reformer',
  crossfit_box: 'CrossFit',
  martial_arts: 'Dövüş Sporları',
  personal_training: 'Personal Training',
  fitness_other: 'Fitness (diğer)',
};

/** URL'den hostname cikarir; gecersizse null (uydurma domain uretilmez). */
export function extractDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withProtocol).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function normalizeWebsite(tags: Record<string, string>): string | null {
  const raw = tags.website ?? tags['contact:website'] ?? tags.url ?? null;
  if (!raw) return null;

  const first = raw.split(/[;,\s]+/)[0]?.trim();
  if (!first) return null;
  if (!/^https?:\/\//i.test(first) && !/\./.test(first)) return null;

  return /^https?:\/\//i.test(first) ? first : `https://${first}`;
}

function toCompany(el: OverpassElement, city: string): DiscoveredCompany | null {
  const tags = el.tags ?? {};
  const name = tags.name ?? tags['name:tr'] ?? tags['name:en'];
  if (!name) return null; // Isimsiz POI satis icin kullanilamaz.

  const segment = classifySegment(tags);
  const website = normalizeWebsite(tags);
  const coords = el.center ?? { lat: el.lat, lon: el.lon };

  return {
    name: name.trim(),
    website,
    domain: extractDomain(website),
    locationCity: city,
    locationDistrict: tags['addr:district'] ?? tags['addr:city'] ?? null,
    lat: coords?.lat ?? null,
    lon: coords?.lon ?? null,
    industry: SEGMENT_INDUSTRY[segment],
    segment,
    // OSM calisan sayisi tasimaz — tahmin edilmez.
    employeeCount: null,
    phone: tags.phone ?? tags['contact:phone'] ?? tags['contact:mobile'] ?? null,
    // OSM/Apollo puan ve yorum verisi tasimaz — Places doldurur.
    rating: null,
    reviewCount: null,
    source: 'osm',
    sourceRef: `${el.type}/${el.id}`,
    raw: tags,
    // OSM karar verici vermez; contacts bos birakilir.
    contacts: [],
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Overpass'in kendi slot durumunu okur ve bos slot yoksa bekler.
 * /api/status ciktisi ornegi:
 *
 *   Rate limit: 2
 *   1 slots available now.
 *   Slot available after: 2026-08-17T15:01:34Z, in 19 seconds.
 *
 * Durum okunamazsa bekleme yapilmaz — sorgu yine de denenir, hata yolu
 * zaten backoff ile tekrar ediyor.
 */
async function waitForSlot(): Promise<void> {
  let text: string;
  try {
    const res = await fetch(OVERPASS_STATUS, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return;
    text = await res.text();
  } catch {
    return;
  }

  if (/\d+ slots available now/.test(text)) return;

  const waits = [...text.matchAll(/in (\d+) seconds/g)].map((m) => Number.parseInt(m[1], 10));
  if (waits.length === 0) return;

  // En yakin bosalacak slotu bekle (+1 sn tampon), makul bir tavanla sinirla.
  const seconds = Math.min(Math.min(...waits) + 1, 90);
  if (seconds <= 0) return;

  console.log(`  [overpass] tum slotlar dolu, ${seconds}s bekleniyor...`);
  await sleep(seconds * 1000);
}

async function requestOverpass(query: string): Promise<OverpassResponse> {
  let lastError: unknown = null;

  // Ilk deneme + RETRY_DELAYS_MS uzunlugu kadar tekrar.
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      console.log(`  [overpass] tekrar denenecek (${delay / 1000}s)...`);
      await sleep(delay);
    }

    await waitForSlot();

    try {
      const res = await fetch(OVERPASS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(90_000),
      });

      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      return (await res.json()) as OverpassResponse;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Overpass sorgusu basarisiz: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export const overpassSource: LeadSource = {
  id: 'osm',

  async isAvailable() {
    return { available: true };
  },

  async discover(criteria: DiscoveryCriteria): Promise<DiscoveredCompany[]> {
    const city = CITY_BBOX[criteria.city.toLowerCase()];
    if (!city) {
      throw new Error(
        `Bilinmeyen sehir: "${criteria.city}". Tanimli sehirler: ${Object.keys(CITY_BBOX).join(', ')}`,
      );
    }

    // Isimsiz kayitlar elenecegi icin istenen limitin uzerinde cekiyoruz.
    const fetchLimit = Math.min(Math.max(criteria.limit * 6, 60), 400);
    const queries = buildQueries(city.bbox, fetchLimit);

    const elements: OverpassElement[] = [];
    for (const [index, { label, query }] of queries.entries()) {
      try {
        const data = await requestOverpass(query);
        elements.push(...data.elements);
        console.log(`  [overpass] ${label}: ${data.elements.length} kayit`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Birincil sorgu basarisizsa devam edecek veri yok.
        if (index === 0) throw new Error(message);
        console.warn(`  [overpass] UYARI — "${label}" sorgusu alinamadi (${message}); devam ediliyor.`);
      }
    }

    const companies: DiscoveredCompany[] = [];
    const seenNames = new Set<string>();
    const seenRefs = new Set<string>();

    for (const el of elements) {
      const ref = `${el.type}/${el.id}`;
      if (seenRefs.has(ref)) continue; // Iki sorgu ayni POI'yi dondurebilir.
      seenRefs.add(ref);

      const company = toCompany(el, city.label);
      if (!company) continue;

      // Ayni zincirin farkli subelerini tek lead olarak saymamak icin
      // isim+ilce bazli tekillestirme.
      const key = `${company.name.toLowerCase()}|${company.locationDistrict ?? ''}`;
      if (seenNames.has(key)) continue;
      seenNames.add(key);

      companies.push(company);
    }

    // Siralama onceligi:
    //   1) Ticari isletmeler kamu/universite tesislerinin onunde,
    //   2) Websitesi olanlar once (denetim icin daha zengin veri).
    // Sitesi olmayanlar listede kalir — "website yok" guclu bir satis sinyali.
    companies.sort((a, b) => {
      const institutional =
        Number(isInstitutional((a.raw ?? {}) as Record<string, string>, a.website)) -
        Number(isInstitutional((b.raw ?? {}) as Record<string, string>, b.website));
      if (institutional !== 0) return institutional;
      return Number(Boolean(b.website)) - Number(Boolean(a.website));
    });

    return companies.slice(0, criteria.limit);
  },
};
