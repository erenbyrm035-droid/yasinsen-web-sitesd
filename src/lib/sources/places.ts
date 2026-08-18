import type {
  DiscoveredCompany,
  DiscoveryCriteria,
  LeadSource,
  Segment,
} from '../types';
import { classifySegment, extractDomain, isInstitutional } from './overpass';

/**
 * Google Places (New) lead kaynagi.
 *
 * OSM'e gore avantaji: telefon, website, PUAN ve YORUM SAYISI gelir.
 * Yorum sayisi gercek musteri hacmi sinyalidir ve business potential
 * hesabinda kullanilir (bkz. src/lib/scoring/business-potential.ts).
 *
 * Anahtar: GOOGLE_MAPS_API_KEY (ya da PLACES_API_KEY). Anahtarin bagli oldugu
 * projede "Places API (New)" ETKIN olmali ve anahtarin API kisitlamalari bu
 * servisi kapsamali — aksi halde 403 / PERMISSION_DENIED doner ve adapter
 * bunu oldugu gibi yuzeye cikarir.
 */

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.primaryType',
  'places.types',
  'places.businessStatus',
  // Resmi harita linki — kendimiz arama sorgusu kurmaktan cok daha dogru.
  'places.googleMapsUri',
  'places.location',
  'nextPageToken',
].join(',');

/** Places tek istekte en fazla 20 sonuc verir; kapsama sorgu cesitliligiyle saglanir. */
const PAGE_SIZE = 20;

/** Sehir sinirlari — sonuclari kisitlamak icin. Sira: guney, bati, kuzey, dogu. */
const CITY_BOUNDS: Record<string, { label: string; bbox: [number, number, number, number] }> = {
  istanbul: { label: 'İstanbul', bbox: [40.8, 27.95, 41.65, 29.95] },
};

/**
 * Sorgu sablonlari. Her segment icin ayri arama yapilir; boylece Places'in
 * kendi siralamasi tek bir kategoriye yigilmaz.
 */
const QUERY_TERMS = [
  'spor salonu',
  'fitness merkezi',
  'pilates stüdyosu',
  'reformer pilates',
  'crossfit',
  'personal training stüdyo',
  'dövüş sporları salonu',
  'boks kulübü',
];

/** Istanbul'un yogun ilceleri — kapsami genisletmek icin sorguya eklenir. */
const DISTRICTS = [
  'Kadıköy', 'Beşiktaş', 'Şişli', 'Bakırköy', 'Ataşehir', 'Üsküdar',
  'Maltepe', 'Beylikdüzü', 'Başakşehir', 'Ümraniye', 'Sarıyer', 'Bahçelievler',
];

interface PlaceResult {
  id?: string;
  googleMapsUri?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  types?: string[];
  businessStatus?: string;
  location?: { latitude?: number; longitude?: number };
}

interface SearchResponse {
  places?: PlaceResult[];
  nextPageToken?: string;
  error?: { message?: string; status?: string };
}

export class PlacesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlacesUnavailableError';
  }
}

function apiKey(): string | undefined {
  return process.env.GOOGLE_MAPS_API_KEY ?? process.env.PLACES_API_KEY;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Turkiye'de ilce = administrative_area_level_2. */
function districtOf(place: PlaceResult): string | null {
  const components = place.addressComponents ?? [];
  const ilce = components.find((c) => c.types?.includes('administrative_area_level_2'));
  if (ilce?.longText) return ilce.longText;

  // Yedek: adres metninden "…, 34710 Kadıköy/İstanbul" kalibi.
  const match = place.formattedAddress?.match(/\d{5}\s+([^/,]+)\s*\/\s*İstanbul/i);
  return match?.[1]?.trim() ?? null;
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

function toCompany(place: PlaceResult, cityLabel: string): DiscoveredCompany | null {
  const name = place.displayName?.text?.trim();
  if (!name || !place.id) return null;

  // Kapanmis isletmeler lead degildir.
  if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') return null;

  const segment = classifySegment({
    name,
    sport: (place.types ?? []).join(' '),
    leisure: place.primaryType ?? '',
  });

  const website = place.websiteUri ?? null;

  return {
    name,
    website,
    domain: extractDomain(website),
    locationCity: cityLabel,
    locationDistrict: districtOf(place),
    lat: place.location?.latitude ?? null,
    lon: place.location?.longitude ?? null,
    industry: SEGMENT_INDUSTRY[segment],
    segment,
    // Places calisan sayisi vermez — tahmin edilmez.
    employeeCount: null,
    phone: place.nationalPhoneNumber ?? null,
    rating: place.rating ?? null,
    reviewCount: place.userRatingCount ?? null,
    source: 'places',
    googlePlaceId: place.id,
    mapsUri: place.googleMapsUri ?? null,
    sourceRef: place.id,
    raw: place,
    // Places karar verici vermez.
    contacts: [],
  };
}

async function searchText(
  key: string,
  textQuery: string,
  bbox: [number, number, number, number],
  pageToken?: string,
): Promise<SearchResponse> {
  const [south, west, north, east] = bbox;

  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      languageCode: 'tr',
      regionCode: 'TR',
      maxResultCount: PAGE_SIZE,
      ...(pageToken ? { pageToken } : {}),
      locationRestriction: {
        rectangle: {
          low: { latitude: south, longitude: west },
          high: { latitude: north, longitude: east },
        },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const body = (await res.json().catch(() => ({}))) as SearchResponse;

  if (!res.ok || body.error) {
    const detail = body.error?.message ?? `HTTP ${res.status}`;
    // Yetki hatasini sessizce yutmuyoruz — kullanicinin ne yapmasi gerektigi belli olsun.
    if (res.status === 403 || body.error?.status === 'PERMISSION_DENIED') {
      throw new PlacesUnavailableError(
        `Places API reddetti: ${detail}\n` +
          'Google Cloud Console → APIs & Services → Library → "Places API (New)" → Enable, ' +
          'ardından Credentials → anahtarınız → API restrictions listesine bu servisi ekleyin.',
      );
    }
    throw new Error(`Places araması başarısız: ${detail}`);
  }

  return body;
}

export const placesSource: LeadSource = {
  id: 'places',

  async isAvailable() {
    if (!apiKey()) {
      return {
        available: false,
        reason:
          'GOOGLE_MAPS_API_KEY (veya PLACES_API_KEY) tanımlı değil. ' +
          'Anahtarı .env dosyasına ekleyin; bağlı olduğu projede "Places API (New)" etkin olmalı.',
      };
    }
    return { available: true };
  },

  async discover(criteria: DiscoveryCriteria): Promise<DiscoveredCompany[]> {
    const key = apiKey();
    if (!key) {
      throw new PlacesUnavailableError(
        'Places kaynağı kullanılamıyor: GOOGLE_MAPS_API_KEY tanımlı değil. Sahte lead üretilmedi.',
      );
    }

    const city = CITY_BOUNDS[criteria.city.toLowerCase()];
    if (!city) {
      throw new Error(
        `Bilinmeyen sehir: "${criteria.city}". Tanimli sehirler: ${Object.keys(CITY_BOUNDS).join(', ')}`,
      );
    }

    // Once genel terimler (tum sehir), sonra ilce kirilimi — hedefe ulasilinca durulur.
    const queries: string[] = [
      ...QUERY_TERMS.map((t) => `${t} ${city.label}`),
      ...DISTRICTS.flatMap((d) => QUERY_TERMS.slice(0, 4).map((t) => `${t} ${d} ${city.label}`)),
    ];

    const found = new Map<string, DiscoveredCompany>();

    for (const query of queries) {
      if (found.size >= criteria.limit * 2) break;

      let pageToken: string | undefined;
      let pages = 0;

      do {
        const body = await searchText(key, query, city.bbox, pageToken);
        const places = body.places ?? [];

        for (const place of places) {
          if (!place.id || found.has(place.id)) continue;
          const company = toCompany(place, city.label);
          if (company) found.set(place.id, company);
        }

        pageToken = body.nextPageToken;
        pages += 1;
        // Places sayfa jetonunun gecerli olmasi icin kisa bir bekleme ister.
        if (pageToken) await sleep(1_500);
      } while (pageToken && pages < 3 && found.size < criteria.limit * 2);

      console.log(`  [places] "${query}" → toplam ${found.size} benzersiz işletme`);
      await sleep(200);
    }

    const companies = [...found.values()];

    // Siralama onceligi: ticari isletmeler kamu tesislerinin onunde, ardindan
    // yorum sayisi (gercek musteri hacmi), sonra website varligi.
    companies.sort((a, b) => {
      const institutional =
        Number(isInstitutional({ name: a.name }, a.website)) -
        Number(isInstitutional({ name: b.name }, b.website));
      if (institutional !== 0) return institutional;

      const reviews = (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
      if (reviews !== 0) return reviews;

      return Number(Boolean(b.website)) - Number(Boolean(a.website));
    });

    return companies.slice(0, criteria.limit);
  },
};
