import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'viva-dup-'));
process.env.VIVA_DB_PATH = join(tmp, 'test.db');

import { initSchema, closeDb, getDb } from '../src/lib/db/client';
import { upsertCompany, findDuplicateCompany } from '../src/lib/db/repositories/companies';
import type { DiscoveredCompany } from '../src/lib/types';

/**
 * MUKERRER KONTROLU
 *
 * Ayni isletme OSM ve Places'ten iki kez gelirse iki lead olusur ve satis
 * ekibi ayni yeri iki kez arar. Kimlik sirasi: kaynak referansi -> alan adi
 * -> telefon -> normalize isim + ilce.
 */

function company(overrides: Partial<DiscoveredCompany> = {}): DiscoveredCompany {
  return {
    name: 'Fizyotime Pilates',
    website: 'https://fizyotime.com',
    domain: 'fizyotime.com',
    locationCity: 'İstanbul',
    locationDistrict: 'Kadıköy',
    lat: null, lon: null,
    industry: null,
    segment: 'pilates_studio',
    employeeCount: null,
    phone: '0533 143 58 88',
    rating: null, reviewCount: null,
    googlePlaceId: null,
    mapsUri: null,
    source: 'places',
    sourceRef: 'place-1',
    raw: {},
    contacts: [],
    ...overrides,
  } as DiscoveredCompany;
}

before(() => initSchema());
after(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  getDb().prepare('DELETE FROM companies').run();
});

describe('Mukerrer isletme olusturulmaz', () => {
  test('ayni kaynak referansi tekrar gelirse satir cogalmaz', () => {
    const a = upsertCompany(company());
    const b = upsertCompany(company());
    assert.equal(a, b);
    assert.equal((getDb().prepare('SELECT COUNT(*) n FROM companies').get() as { n: number }).n, 1);
  });

  test('farkli kaynak, ayni alan adi -> tek kayit', () => {
    const places = upsertCompany(company({ source: 'places', sourceRef: 'place-1' }));
    const osm = upsertCompany(
      company({ source: 'osm', sourceRef: 'node/999', phone: null, rating: null }),
    );
    assert.equal(osm, places, 'alan adi ayniysa ayni kayit guncellenmeli');
    assert.equal((getDb().prepare('SELECT COUNT(*) n FROM companies').get() as { n: number }).n, 1);
  });

  test('farkli kaynak, ayni telefon (farkli yazim) -> tek kayit', () => {
    const first = upsertCompany(company({ website: null, domain: null }));
    const second = upsertCompany(
      company({
        source: 'osm', sourceRef: 'node/1000',
        website: null, domain: null,
        phone: '+90 533 143 58 88', // ayni numara, baska yazim
      }),
    );
    assert.equal(second, first);
  });

  test('ayni isim + ayni ilce -> tek kayit', () => {
    const first = upsertCompany(company({ website: null, domain: null, phone: null }));
    const second = upsertCompany(
      company({
        source: 'osm', sourceRef: 'node/1001',
        name: 'FIZYOTIME PİLATES', // buyuk harf + Turkce karakter
        website: null, domain: null, phone: null,
      }),
    );
    assert.equal(second, first);
  });

  test('ayni isim FARKLI ilce -> AYRI kayit', () => {
    // "Fit Life" adinda iki ayri salon olabilir; birlestirmek gercek bir
    // lead'i yok ederdi.
    const kadikoy = upsertCompany(
      company({ name: 'Fit Life', website: null, domain: null, phone: null, locationDistrict: 'Kadıköy' }),
    );
    const sisli = upsertCompany(
      company({
        name: 'Fit Life', source: 'osm', sourceRef: 'node/1002',
        website: null, domain: null, phone: null, locationDistrict: 'Şişli',
      }),
    );
    assert.notEqual(sisli, kadikoy);
  });

  test('mukerrer kayit eksik alanlari zenginlestirir, doldurulmusu silmez', () => {
    upsertCompany(company({ phone: null, rating: null }));
    upsertCompany(
      company({ source: 'osm', sourceRef: 'node/1003', phone: '0533 143 58 88', rating: 4.9 }),
    );

    const row = getDb().prepare('SELECT * FROM companies').get() as {
      phone: string | null;
      rating: number | null;
      website: string | null;
    };
    assert.equal(row.phone, '0533 143 58 88', 'eksik alan dolmali');
    assert.equal(row.rating, 4.9);
    assert.equal(row.website, 'https://fizyotime.com', 'mevcut veri korunmali');
  });

  test('alakasiz isletme mukerrer sayilmaz', () => {
    upsertCompany(company());
    const other = findDuplicateCompany(
      company({
        name: 'Bambaska Gym', source: 'osm', sourceRef: 'node/2000',
        website: 'https://baska.com', domain: 'baska.com',
        phone: '0212 000 00 00', locationDistrict: 'Beşiktaş',
      }),
    );
    assert.equal(other, undefined);
  });
});

describe('Google Place ID', () => {
  test('Place ID farkli kaynaklar arasinda da mukerreri yakalar', () => {
    // Ayni isletme once Places'ten, sonra baska bir sorgudan farkli bir
    // source_ref ile gelirse yine tek kayit olmali.
    const first = upsertCompany(
      company({ googlePlaceId: 'ChIJ_TEST_1', website: null, domain: null, phone: null }),
    );
    const second = upsertCompany(
      company({
        googlePlaceId: 'ChIJ_TEST_1',
        source: 'places', sourceRef: 'baska-ref',
        name: 'Farkli Yazilmis Isim',
        website: null, domain: null, phone: null,
        locationDistrict: 'Beşiktaş',
      }),
    );
    assert.equal(second, first, 'ayni Place ID tek kayit olmali');
  });

  test('Place ID mukerrer birlestirmede kaybolmaz', () => {
    upsertCompany(company({ googlePlaceId: 'ChIJ_KEEP', mapsUri: 'https://maps.app.goo.gl/x' }));
    // Ayni isletme OSM'den geliyor: Place ID tasimıyor ama mevcut olan silinmemeli.
    upsertCompany(
      company({ source: 'osm', sourceRef: 'node/5000', googlePlaceId: null, mapsUri: null }),
    );

    const row = getDb().prepare('SELECT * FROM companies').get() as {
      google_place_id: string | null;
      maps_uri: string | null;
    };
    assert.equal(row.google_place_id, 'ChIJ_KEEP');
    assert.equal(row.maps_uri, 'https://maps.app.goo.gl/x');
  });

  test('Place ID vermeyen kaynak uydurmaz', () => {
    upsertCompany(company({ source: 'osm', sourceRef: 'node/6000', googlePlaceId: null, mapsUri: null }));
    const row = getDb().prepare('SELECT * FROM companies').get() as { google_place_id: string | null };
    assert.equal(row.google_place_id, null, 'OSM Place ID vermez — uydurulmamali');
  });
});
