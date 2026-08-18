import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyCandidate,
  buildQueries,
  normalize,
  type DiscoveryCompany,
} from '../src/lib/audit/social-discovery';
import { searchProviderStatus } from '../src/lib/audit/search';

/**
 * SOSYAL PROFIL DOGRULAMA
 *
 * Buradaki tek soru su: bulunan Instagram hesabi GERCEKTEN bu isletmenin mi?
 *
 * Yanlis profil eklemek, profil hic eklememekten daha zararlidir — musteriye
 * "sosyal medyanız zayıf" derken baskasinin hesabina bakiyor oluruz. Bu yuzden
 * esigi gecemeyen aday kaydedilmez.
 */

const COMPANY: DiscoveryCompany = {
  name: 'Fizyohaus Pilates Studio',
  website: 'https://fizyohaus.com',
  city: 'İstanbul',
  district: 'Kağıthane',
  phone: '0533 958 28 62',
};

describe('Turkce normalizasyon', () => {
  test('Turkce karakterler katlanir', () => {
    assert.equal(normalize('Kağıthane'), 'kagithane');
    assert.equal(normalize('Şişli Spor'), 'sislispor');
    assert.equal(normalize('ÖZGÜR-ÇINAR'), 'ozgurcinar');
  });
});

describe('Arama sorgusu kurulumu', () => {
  test('isletme adi + ilce + platform iceren sorgu uretir', () => {
    const queries = buildQueries(COMPANY);
    assert.equal(queries.length, 2);
    assert.ok(queries[0].query.includes('"Fizyohaus Pilates Studio"'));
    assert.ok(queries[0].query.includes('Kağıthane'));
    assert.ok(queries[0].query.includes('instagram'));
    assert.ok(queries[1].query.includes('facebook'));
  });
});

describe('Profil kimlik dogrulama', () => {
  test('DOGRU profil kabul edilir (ad + konum + alan adi)', () => {
    const verdict = verifyCandidate(COMPANY, {
      handle: 'fizyohauspilates',
      url: 'https://instagram.com/fizyohauspilates',
      title: 'Fizyohaus Pilates Studio (@fizyohauspilates) • Instagram',
      snippet: 'Kağıthane İstanbul reformer pilates stüdyosu. fizyohaus.com',
    });

    assert.ok(verdict.score >= 0.55, `esigi gecmeliydi, skor: ${verdict.score}`);
    assert.ok(verdict.signals.length >= 2, 'birden fazla kanit sinyali olmali');
  });

  test('YANLIS profil reddedilir — baska bir pilates studyosu', () => {
    const verdict = verifyCandidate(COMPANY, {
      handle: 'pilateslifeistanbul',
      url: 'https://instagram.com/pilateslifeistanbul',
      title: 'Pilates Life Istanbul (@pilateslifeistanbul) • Instagram',
      snippet: 'Beşiktaş pilates ve reformer dersleri',
    });

    assert.ok(verdict.score < 0.55, `reddedilmeliydi, skor: ${verdict.score}`);
  });

  test('sadece sektor kelimesi eslesirse kabul edilmez', () => {
    // "pilates" ve "studio" stopword; tek baslarina kimlik kaniti degil.
    const verdict = verifyCandidate(COMPANY, {
      handle: 'pilatesstudio',
      url: 'https://instagram.com/pilatesstudio',
      title: 'Pilates Studio • Instagram',
      snippet: 'Pilates studio',
    });

    assert.ok(verdict.score < 0.55, 'jenerik sektor kelimesi eslesme sayilmamali');
  });

  test('sadece sehir eslesmesi tek basina yetmez', () => {
    const verdict = verifyCandidate(COMPANY, {
      handle: 'randomgym',
      url: 'https://instagram.com/randomgym',
      title: 'Random Gym • Instagram',
      snippet: 'Kağıthane İstanbul',
    });

    assert.ok(verdict.score < 0.55, 'konum tek basina kimlik kaniti degil');
  });

  test('telefon eslesmesi guclu kanit sayilir', () => {
    const verdict = verifyCandidate(COMPANY, {
      handle: 'fizyohaus',
      url: 'https://instagram.com/fizyohaus',
      title: 'Fizyohaus',
      snippet: 'Randevu: 0533 958 28 62',
    });

    assert.ok(verdict.signals.some((s) => s.includes('telefon')));
    assert.ok(verdict.score >= 0.55);
  });

  test('hicbir sinyal yoksa skor sifir ve gerekce bos', () => {
    const verdict = verifyCandidate(COMPANY, {
      handle: 'zzzz',
      url: 'https://instagram.com/zzzz',
      title: 'Bir şey',
      snippet: 'Alakasız içerik',
    });

    assert.equal(verdict.score, 0);
    assert.equal(verdict.signals.length, 0);
  });
});

describe('Arama saglayicisi yoksa', () => {
  test('durum acikca bildirilir, tahmin uretilmez', () => {
    const previous = { cse: process.env.GOOGLE_CSE_ID, se: process.env.SEARCH_ENGINE_ID };
    delete process.env.GOOGLE_CSE_ID;
    delete process.env.SEARCH_ENGINE_ID;

    try {
      const status = searchProviderStatus();
      assert.equal(status.available, false);
      assert.ok(status.reason.includes('GOOGLE_CSE_ID'), 'eksik ayar adi soylenmeli');
    } finally {
      if (previous.cse) process.env.GOOGLE_CSE_ID = previous.cse;
      if (previous.se) process.env.SEARCH_ENGINE_ID = previous.se;
    }
  });
});
