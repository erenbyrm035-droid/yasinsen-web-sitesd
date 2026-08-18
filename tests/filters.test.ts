import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyFilters, parseFilters, EMPTY_FILTERS } from '../src/app/leads/filters';
import type { SalesLeadRow } from '../src/lib/db/repositories/sales-views';

function lead(overrides: Partial<SalesLeadRow> = {}): SalesLeadRow {
  return {
    leadId: 1, companyId: 1, company: 'Test Pilates', segment: 'pilates_studio',
    industry: null, district: 'Kadıköy', city: 'İstanbul', location: 'Kadıköy, İstanbul',
    phone: '0555 111 22 33', website: 'https://test.com', mapsUrl: '',
    rating: 4.5, reviewCount: 100, googlePlaceId: null, mapsExact: false,
    decisionMaker: null, decisionMakerTitle: null,
    websiteScore: 50, websiteStatus: 'ok', manualReview: false,
    socialScore: 60, socialProfile: null, purchaseScore: 70, priority: 'HIGH',
    offerCode: 'A', offerLabel: 'Website', salesStatus: 'READY_TO_CALL',
    lastCalledAt: null, callCount: 0, nextFollowUpAt: null,
    lastCallResult: null, lastCallNotes: null,
    ...overrides,
  };
}

describe('Filtre ayristirma', () => {
  test('gecersiz degerler yok sayilir, cokme olmaz', () => {
    const f = parseFilters({ priority: 'SICAK', status: 'OLMAYAN', minPurchase: 'abc' });
    assert.equal(f.priority, null);
    assert.equal(f.status, null);
    assert.equal(f.minPurchase, null);
  });

  test('gecerli degerler okunur', () => {
    const f = parseFilters({ priority: 'HOT', status: 'INTERESTED', minPurchase: '70', called: 'no' });
    assert.equal(f.priority, 'HOT');
    assert.equal(f.status, 'INTERESTED');
    assert.equal(f.minPurchase, 70);
    assert.equal(f.called, 'no');
  });
});

describe('Skor filtreleri olculemeyeni yanlis siniflamaz', () => {
  /**
   * "purchase >= 70" filtresi, skoru OLCULEMEYEN lead'i elemeli ama bunu
   * "skoru dusuk" diye degil "olculemedi" diye yapmali. Kritik olan:
   * null'i 0 gibi ele alip lead'i sessizce kotu saymamak.
   */
  test('website skoru null olan lead skor filtresine takilir', () => {
    const leads = [lead({ leadId: 1, websiteScore: null, websiteStatus: 'blocked' })];
    const result = applyFilters(leads, { ...EMPTY_FILTERS, minWebsite: 50 });
    assert.equal(result.length, 0, 'olculemeyen lead skor filtresini gecemez');
  });

  test('skor filtresi yokken olculemeyen lead listede kalir', () => {
    const leads = [lead({ websiteScore: null, websiteStatus: 'blocked' })];
    assert.equal(applyFilters(leads, EMPTY_FILTERS).length, 1);
  });
});

describe('Gunluk arama listesi filtresi', () => {
  test('"aranmadi + purchase >= 65" dogru calisir', () => {
    const leads = [
      lead({ leadId: 1, company: 'Aranmamis Yuksek', callCount: 0, purchaseScore: 70 }),
      lead({ leadId: 2, company: 'Aranmis Yuksek', callCount: 2, purchaseScore: 75 }),
      lead({ leadId: 3, company: 'Aranmamis Dusuk', callCount: 0, purchaseScore: 40 }),
    ];
    const result = applyFilters(leads, { ...EMPTY_FILTERS, called: 'no', minPurchase: 65 });
    assert.deepEqual(result.map((l) => l.company), ['Aranmamis Yuksek']);
  });
});

describe('Arama', () => {
  test('Turkce karakter farki aramayi bozmaz', () => {
    const leads = [lead({ company: 'Fizyoşah Pilates', district: 'Şişli' })];
    assert.equal(applyFilters(leads, { ...EMPTY_FILTERS, search: 'sisli' }).length, 1);
    assert.equal(applyFilters(leads, { ...EMPTY_FILTERS, search: 'fizyosah' }).length, 1);
  });

  test('telefon uzerinden aranabilir', () => {
    const leads = [lead({ phone: '0555 111 22 33' })];
    assert.equal(applyFilters(leads, { ...EMPTY_FILTERS, search: '111 22' }).length, 1);
  });
});

describe('Takip ve teklif filtreleri', () => {
  test('takip zamani gelmis lead bulunur', () => {
    const leads = [
      lead({ leadId: 1, nextFollowUpAt: '2020-01-01' }),
      lead({ leadId: 2, nextFollowUpAt: '2099-01-01' }),
      lead({ leadId: 3, nextFollowUpAt: null }),
    ];
    const due = applyFilters(leads, { ...EMPTY_FILTERS, followUp: 'due' });
    assert.deepEqual(due.map((l) => l.leadId), [1]);
  });

  test('teklif gonderilmis lead bulunur', () => {
    const leads = [
      lead({ leadId: 1, salesStatus: 'OFFER_SENT' }),
      lead({ leadId: 2, salesStatus: 'WON' }),
      lead({ leadId: 3, salesStatus: 'READY_TO_CALL' }),
    ];
    assert.deepEqual(
      applyFilters(leads, { ...EMPTY_FILTERS, offer: 'sent' }).map((l) => l.leadId),
      [1, 2],
    );
  });
});
