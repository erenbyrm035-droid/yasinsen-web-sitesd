import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  DiscoveredCompany,
  DiscoveryCriteria,
  LeadSource,
  Segment,
} from '../types';
import { classifySegment, extractDomain } from './overpass';

/**
 * Apollo lead kaynagi — SADECE OKUMA.
 *
 * Bu adapter Apollo'da hicbir kayit olusturmaz/guncellemez, hicbir sequence
 * baslatmaz, hicbir e-posta gondermez. Yalnizca People Search sonucunu okur.
 *
 * DURUM (2026-08 itibariyle dogrulanmis): baglantidaki Apollo hesabi Free
 * plan; `mixed_people/api_search` ucu `API_INACCESSIBLE` donuyor.
 * Ayrintilar ve acma adimlari: docs/APOLLO.md
 *
 * Iki gercek calisma modu vardir. Hicbiri kullanilabilir degilse tipli hata
 * firlatilir — ornek/sahte lead URETILMEZ.
 *
 *   1) APOLLO_API_KEY set ise  -> api.apollo.io People Search'e gercek istek.
 *   2) Anahtar yoksa           -> data/apollo-import.json (Apollo MCP
 *                                 ciktisinin kaydedilmis hali) okunur.
 */

const APOLLO_SEARCH_URL = 'https://api.apollo.io/api/v1/mixed_people/search';
const IMPORT_PATH = resolve(process.cwd(), 'data/apollo-import.json');

export class ApolloUnavailableError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApolloUnavailableError';
  }
}

/** Apollo People Search yanitindaki kisi kaydinin kullandigimiz alanlari. */
interface ApolloPerson {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  /** Apollo dogrulanmamis e-postayi "email_not_unlocked@domain.com" olarak doner. */
  email?: string | null;
  linkedin_url?: string | null;
  phone_numbers?: { raw_number?: string }[];
  organization?: {
    id?: string;
    name?: string;
    website_url?: string | null;
    primary_domain?: string | null;
    estimated_num_employees?: number | null;
    industry?: string | null;
    keywords?: string[];
    phone?: string | null;
    city?: string | null;
    state?: string | null;
    raw_address?: string | null;
  } | null;
}

interface ApolloSearchResponse {
  people?: ApolloPerson[];
  contacts?: ApolloPerson[];
  error?: string;
  error_code?: string;
}

/**
 * Apollo kilitli e-postayi placeholder ile doner. Bunu gercek e-posta gibi
 * saklamak yanlis veri olur — null'a cevriliyor.
 */
function realEmailOrNull(email: string | null | undefined): string | null {
  if (!email) return null;
  if (/email_not_unlocked|not_unlocked|^n\/a$/i.test(email)) return null;
  if (!email.includes('@')) return null;
  return email;
}

function personToCompany(person: ApolloPerson): DiscoveredCompany | null {
  const org = person.organization;
  if (!org?.name) return null;

  const website = org.website_url ?? (org.primary_domain ? `https://${org.primary_domain}` : null);
  const segment: Segment = classifySegment({
    name: org.name,
    sport: (org.keywords ?? []).join(' '),
    brand: org.industry ?? '',
  });

  const fullName =
    person.name ?? ([person.first_name, person.last_name].filter(Boolean).join(' ') || null);

  return {
    name: org.name,
    website,
    domain: org.primary_domain ?? extractDomain(website),
    locationCity: org.city ?? null,
    locationDistrict: null,
    lat: null,
    lon: null,
    industry: org.industry ?? null,
    segment,
    employeeCount: org.estimated_num_employees ?? null,
    phone: org.phone ?? null,
    // OSM/Apollo puan ve yorum verisi tasimaz — Places doldurur.
    rating: null,
    reviewCount: null,
    // Bu kaynak Google Place ID vermez — uydurulmaz, null kalir.
    googlePlaceId: null,
    mapsUri: null,
    source: 'apollo',
    sourceRef: org.id ?? `person:${person.id ?? org.name}`,
    raw: person,
    contacts: fullName
      ? [
          {
            fullName,
            title: person.title ?? null,
            // Kilitli/placeholder e-posta null'a cevrilir; tahmin yapilmaz.
            email: realEmailOrNull(person.email),
            phone: person.phone_numbers?.[0]?.raw_number ?? null,
            linkedinUrl: person.linkedin_url ?? null,
            source: 'apollo',
          },
        ]
      : [],
  };
}

function loadImportFile(): ApolloPerson[] {
  const parsed = JSON.parse(readFileSync(IMPORT_PATH, 'utf8')) as
    | ApolloSearchResponse
    | ApolloPerson[];

  if (Array.isArray(parsed)) return parsed;
  return parsed.people ?? parsed.contacts ?? [];
}

async function searchViaApi(criteria: DiscoveryCriteria, apiKey: string): Promise<ApolloPerson[]> {
  const [minEmployees, maxEmployees] = criteria.employeeRange ?? [1, 50];

  const res = await fetch(APOLLO_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      person_locations: [criteria.city],
      person_titles: criteria.titles ?? [
        'Owner',
        'Founder',
        'Co-Founder',
        'General Manager',
        'Business Owner',
        'Studio Owner',
        'Gym Owner',
      ],
      organization_num_employees_ranges: [`${minEmployees},${maxEmployees}`],
      q_organization_keyword_tags: ['fitness', 'gym', 'pilates', 'crossfit', 'personal training'],
      per_page: Math.min(criteria.limit, 100),
      page: 1,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const body = (await res.json().catch(() => ({}))) as ApolloSearchResponse;

  if (!res.ok || body.error) {
    // Plan kisitini oldugu gibi yuzeye cikar — sessizce yutup sahte veri uretme.
    throw new ApolloUnavailableError(
      `Apollo People Search reddedildi (HTTP ${res.status}): ${body.error ?? 'bilinmeyen hata'}`,
      body,
    );
  }

  return body.people ?? body.contacts ?? [];
}

export const apolloSource: LeadSource = {
  id: 'apollo',

  async isAvailable() {
    if (process.env.APOLLO_API_KEY) return { available: true };
    if (existsSync(IMPORT_PATH)) {
      return { available: true, reason: `data/apollo-import.json okunacak` };
    }
    return {
      available: false,
      reason:
        'APOLLO_API_KEY tanimli degil ve data/apollo-import.json yok. ' +
        'Apollo hesabi Free plan oldugu icin People Search API kapali (docs/APOLLO.md).',
    };
  },

  async discover(criteria: DiscoveryCriteria): Promise<DiscoveredCompany[]> {
    const apiKey = process.env.APOLLO_API_KEY;

    let people: ApolloPerson[];
    if (apiKey) {
      people = await searchViaApi(criteria, apiKey);
    } else if (existsSync(IMPORT_PATH)) {
      people = loadImportFile();
    } else {
      throw new ApolloUnavailableError(
        'Apollo kaynagi kullanilamiyor: APOLLO_API_KEY yok ve data/apollo-import.json bulunamadi. ' +
          'Sahte lead uretilmedi.',
      );
    }

    const companies: DiscoveredCompany[] = [];
    const seen = new Set<string>();

    for (const person of people) {
      const company = personToCompany(person);
      if (!company || seen.has(company.sourceRef)) continue;
      seen.add(company.sourceRef);
      companies.push(company);
      if (companies.length >= criteria.limit) break;
    }

    return companies;
  },
};
