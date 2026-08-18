import type { SalesLeadRow } from '@/lib/db/repositories/sales-views';
import { isSalesStatus, type SalesStatus } from '@/lib/sales';
import type { Priority } from '@/lib/types';

/**
 * Lead listesi filtreleri.
 *
 * Filtreleme URL uzerinden calisir (?priority=HOT&called=no) — boylece
 * "aranmadı + purchase > 70" gibi bir gunluk arama listesi yer imine
 * eklenebilir ve her gun ayni sorgu tek tikla acilir.
 *
 * Saf fonksiyon olarak tutuldu: sunucu bileseni de test de ayni mantigi
 * kullanir.
 */

export interface LeadFilters {
  priority: Priority | null;
  status: SalesStatus | null;
  segment: string | null;
  district: string | null;
  minPurchase: number | null;
  minWebsite: number | null;
  minSocial: number | null;
  /** 'yes' = en az bir kez arandi, 'no' = hic aranmadi */
  called: 'yes' | 'no' | null;
  /** 'due' = takip tarihi gelmis, 'none' = takip planlanmamis */
  followUp: 'due' | 'none' | null;
  /** 'sent' = teklif gonderilmis, 'none' = gonderilmemis */
  offer: 'sent' | 'none' | null;
  search: string | null;
}

export const EMPTY_FILTERS: LeadFilters = {
  priority: null, status: null, segment: null, district: null,
  minPurchase: null, minWebsite: null, minSocial: null,
  called: null, followUp: null, offer: null, search: null,
};

const PRIORITIES = ['HOT', 'HIGH', 'MEDIUM', 'LOW'];

function num(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseFilters(params: Record<string, string | string[] | undefined>): LeadFilters {
  const get = (key: string): string | undefined => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const priority = get('priority');
  const status = get('status');

  return {
    priority: priority && PRIORITIES.includes(priority) ? (priority as Priority) : null,
    status: status && isSalesStatus(status) ? status : null,
    segment: get('segment') || null,
    district: get('district') || null,
    minPurchase: num(get('minPurchase')),
    minWebsite: num(get('minWebsite')),
    minSocial: num(get('minSocial')),
    called: oneOf(get('called'), ['yes', 'no'] as const),
    followUp: oneOf(get('followUp'), ['due', 'none'] as const),
    offer: oneOf(get('offer'), ['sent', 'none'] as const),
    search: get('q')?.trim() || null,
  };
}

/** Turkce karakterleri katlayarak arama yapar (ı/i, ş/s, ğ/g...). */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/İ/g, 'i').replace(/ş/g, 's')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
}

export function applyFilters(leads: SalesLeadRow[], f: LeadFilters): SalesLeadRow[] {
  const today = new Date().toISOString().slice(0, 10);

  return leads.filter((l) => {
    if (f.priority && l.priority !== f.priority) return false;
    if (f.status && l.salesStatus !== f.status) return false;
    if (f.segment && l.segment !== f.segment) return false;
    if (f.district && l.district !== f.district) return false;

    // Skor filtreleri: OLCULEMEYEN lead elenmez, cunku "null < 70" demek
    // "bu lead kotu" demek olurdu. Filtre yalnizca olculmus degerlere uygulanir.
    if (f.minPurchase !== null && (l.purchaseScore === null || l.purchaseScore < f.minPurchase)) return false;
    if (f.minWebsite !== null && (l.websiteScore === null || l.websiteScore < f.minWebsite)) return false;
    if (f.minSocial !== null && (l.socialScore === null || l.socialScore < f.minSocial)) return false;

    if (f.called === 'yes' && l.callCount === 0) return false;
    if (f.called === 'no' && l.callCount > 0) return false;

    if (f.followUp === 'due') {
      if (!l.nextFollowUpAt || l.nextFollowUpAt.slice(0, 10) > today) return false;
    }
    if (f.followUp === 'none' && l.nextFollowUpAt) return false;

    const offerSent = l.salesStatus === 'OFFER_SENT' || l.salesStatus === 'NEGOTIATION' ||
      l.salesStatus === 'WON' || l.salesStatus === 'LOST';
    if (f.offer === 'sent' && !offerSent) return false;
    if (f.offer === 'none' && offerSent) return false;

    if (f.search) {
      const needle = fold(f.search);
      const hay = fold([l.company, l.district, l.phone, l.website].filter(Boolean).join(' '));
      if (!hay.includes(needle)) return false;
    }

    return true;
  });
}

export function activeFilterCount(f: LeadFilters): number {
  return Object.values(f).filter((v) => v !== null).length;
}
