import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * SATIS TAKIBI TESTLERI
 *
 * Gercek bir SQLite dosyasi uzerinde calisir (gecici dizinde). Sahte
 * veritabani yerine gercegini kullaniyoruz cunku test edilen seylerin cogu
 * SQL davranisidir: transaction, siralama, tarih karsilastirmasi.
 */

// dbPath() dosya yolunu getDb() cagrilirken okur, modul yuklenirken degil —
// bu yuzden env'i statik import'lardan sonra ayarlamak yeterli.
const tmp = mkdtempSync(join(tmpdir(), 'viva-sales-'));
process.env.VIVA_DB_PATH = join(tmp, 'test.db');

import { initSchema, closeDb, getDb } from '../src/lib/db/client';
import * as sales from '../src/lib/db/repositories/sales';
import * as views from '../src/lib/db/repositories/sales-views';
import { RESULT_TO_STATUS } from '../src/lib/sales';

function seedLead(name: string, phone: string | null, priority: string, score: number): number {
  const db = getDb();
  const company = db
    .prepare(
      `INSERT INTO companies (name, phone, segment, location_district, source, source_ref, raw)
       VALUES (?, ?, 'pilates_studio', 'Kadıköy', 'test', ?, '{}') RETURNING id`,
    )
    .get(name, phone, `ref-${name}`) as { id: number };

  const lead = db
    .prepare('INSERT INTO leads (company_id) VALUES (?) RETURNING id')
    .get(company.id) as { id: number };

  db.prepare(
    `INSERT INTO lead_scores
       (lead_id, website_score, social_score, business_potential, digital_gap,
        estimated_buying_intent, purchase_score, priority, breakdown)
     VALUES (?, 50, NULL, 60, 50, 50, ?, ?, '{}')`,
  ).run(lead.id, score, priority);

  return lead.id;
}

before(() => initSchema());
after(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  for (const t of ['sales_events', 'call_logs', 'follow_ups', 'offers', 'lead_scores', 'leads', 'companies']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
});

describe('Gorusme kaydi', () => {
  test('call_count artar ve son arama zamani islenir', () => {
    const leadId = seedLead('Test Pilates', '0555 111 22 33', 'HIGH', 70);

    sales.logCall({ leadId, result: 'REACHED', notes: 'Fiyat istedi.' });

    const lead = views.getSalesLead(leadId);
    assert.equal(lead?.callCount, 1);
    assert.ok(lead?.lastCalledAt, 'son arama zamani yazilmali');
    assert.equal(lead?.salesStatus, 'CALLED');
  });

  test('ikinci arama sayaci ikiye cikarir, gecmis silinmez', () => {
    const leadId = seedLead('Test Gym', '0555 111 22 34', 'HIGH', 70);

    sales.logCall({ leadId, result: 'NO_ANSWER' });
    sales.logCall({ leadId, result: 'INTERESTED', notes: 'İlgilendi.' });

    assert.equal(views.getSalesLead(leadId)?.callCount, 2);
    const calls = sales.listCalls(leadId);
    assert.equal(calls.length, 2, 'her iki gorusme de saklanmali');
    assert.equal(views.getSalesLead(leadId)?.salesStatus, 'INTERESTED');
  });

  test('her gorusme sonucu dogru satis durumuna tasir', () => {
    for (const [result, expected] of Object.entries(RESULT_TO_STATUS)) {
      const leadId = seedLead(`Lead ${result}`, '0555 000 00 00', 'MEDIUM', 50);
      sales.logCall({ leadId, result: result as never });
      assert.equal(
        views.getSalesLead(leadId)?.salesStatus,
        expected,
        `${result} -> ${expected} olmali`,
      );
      getDb().prepare('DELETE FROM leads WHERE id = ?').run(leadId);
    }
  });

  test('gorusmede takip tarihi verilirse otomatik planlanir', () => {
    const leadId = seedLead('Takipli', '0555 111 22 35', 'HIGH', 70);
    sales.logCall({ leadId, result: 'CALLBACK', nextFollowUpAt: '2026-09-01' });

    assert.equal(views.getSalesLead(leadId)?.nextFollowUpAt, '2026-09-01');
    assert.equal(sales.listFollowUps(leadId).filter((f) => f.status === 'OPEN').length, 1);
  });
});

describe('Takip', () => {
  test('yeni takip eskisini iptal eder — tek acik takip kalir', () => {
    const leadId = seedLead('Tek Takip', '0555 111 22 36', 'HIGH', 70);

    sales.scheduleFollowUp(leadId, '2026-09-01');
    sales.scheduleFollowUp(leadId, '2026-09-10');

    const open = sales.listFollowUps(leadId).filter((f) => f.status === 'OPEN');
    assert.equal(open.length, 1, 'ayni anda tek acik takip olmali');
    assert.equal(open[0].scheduled_at, '2026-09-10');
  });

  test('tamamlanan takip lead uzerinden dusulur', () => {
    const leadId = seedLead('Tamamlanan', '0555 111 22 37', 'HIGH', 70);
    sales.scheduleFollowUp(leadId, '2026-09-01');
    const open = sales.listFollowUps(leadId)[0];

    sales.completeFollowUp(open.id);

    assert.equal(views.getSalesLead(leadId)?.nextFollowUpAt, null);
  });

  test('gecmis tarihli takip "gecikmis" olarak ayrilir', () => {
    const leadId = seedLead('Gecikmis', '0555 111 22 38', 'HIGH', 70);
    sales.scheduleFollowUp(leadId, '2020-01-01');

    const { overdue, today } = views.listFollowUpsDue();
    assert.equal(overdue.length, 1);
    assert.equal(today.length, 0);
    assert.equal(overdue[0].leadId, leadId);
  });
});

describe('Teklif', () => {
  test('teklif kaydi lead durumunu OFFER_SENT yapar', () => {
    const leadId = seedLead('Teklifli', '0555 111 22 39', 'HIGH', 70);
    sales.createOffer({ leadId, service: 'Website', amount: 25000 });

    assert.equal(views.getSalesLead(leadId)?.salesStatus, 'OFFER_SENT');
  });

  test('tutar girilmezse NULL kalir — uydurulmaz', () => {
    const leadId = seedLead('Tutarsiz', '0555 111 22 40', 'HIGH', 70);
    sales.createOffer({ leadId, service: 'Website', amount: null });

    assert.equal(sales.listOffers(leadId)[0].amount, null);
  });

  test('teklif kazanilinca lead WON olur', () => {
    const leadId = seedLead('Kazanan', '0555 111 22 41', 'HIGH', 70);
    const offerId = sales.createOffer({ leadId, service: 'Website', amount: 25000 });

    sales.closeOffer(offerId, 'WON');

    assert.equal(views.getSalesLead(leadId)?.salesStatus, 'WON');
    assert.equal(sales.listOffers(leadId)[0].status, 'WON');
  });
});

describe('Gunluk arama listesi', () => {
  test('telefonu olmayan lead listeye girmez', () => {
    seedLead('Telefonsuz', null, 'HOT', 85);
    seedLead('Telefonlu', '0555 111 22 42', 'MEDIUM', 50);

    const list = views.listTodayCallList();
    assert.equal(list.length, 1);
    assert.equal(list[0].company, 'Telefonlu');
  });

  test('siralama HOT -> HIGH -> skor -> hic aranmamis', () => {
    seedLead('Orta', '0555 000 00 01', 'MEDIUM', 60);
    seedLead('Sicak', '0555 000 00 02', 'HOT', 82);
    seedLead('Yuksek', '0555 000 00 03', 'HIGH', 70);

    const list = views.listTodayCallList();
    assert.deepEqual(
      list.map((l) => l.company),
      ['Sicak', 'Yuksek', 'Orta'],
    );
  });

  test('esit oncelikte hic aranmamis olan one gecer', () => {
    const aranan = seedLead('Aranan', '0555 000 00 04', 'HIGH', 70);
    seedLead('Aranmamis', '0555 000 00 05', 'HIGH', 70);
    sales.logCall({ leadId: aranan, result: 'NO_ANSWER' });

    const list = views.listTodayCallList();
    assert.equal(list[0].company, 'Aranmamis');
  });

  test('kapanmis lead listeye girmez', () => {
    const leadId = seedLead('Kaybedilen', '0555 000 00 06', 'HOT', 85);
    sales.setSalesStatus(leadId, 'LOST');

    assert.equal(views.listTodayCallList().length, 0);
  });

  test('ileri tarihli takibi olan lead bugun aranmaz', () => {
    const leadId = seedLead('Ileri Takip', '0555 000 00 07', 'HOT', 85);
    sales.scheduleFollowUp(leadId, '2099-01-01');

    assert.equal(views.listTodayCallList().length, 0);
  });
});

describe('READY_TO_CALL kurali', () => {
  test('yalnizca telefonu olan ve skorlanmis lead hazir isaretlenir', () => {
    const telefonlu = seedLead('Hazir', '0555 000 00 08', 'HIGH', 70);
    const telefonsuz = seedLead('Telefonsuz', null, 'HIGH', 70);

    sales.markReadyToCall();

    assert.equal(views.getSalesLead(telefonlu)?.salesStatus, 'READY_TO_CALL');
    assert.equal(views.getSalesLead(telefonsuz)?.salesStatus, 'NEW', 'telefonu yoksa hazir sayilmaz');
  });

  test('elle degistirilmis durumu ezmez', () => {
    const leadId = seedLead('Ilgilenmedi', '0555 000 00 09', 'HIGH', 70);
    sales.setSalesStatus(leadId, 'NOT_INTERESTED');

    sales.markReadyToCall();

    assert.equal(
      views.getSalesLead(leadId)?.salesStatus,
      'NOT_INTERESTED',
      'kullanicinin verdigi karar korunmali',
    );
  });
});

describe('Zaman cizelgesi', () => {
  test('her satis hareketi olay birakir', () => {
    const leadId = seedLead('Cizelge', '0555 000 00 10', 'HIGH', 70);

    sales.logCall({ leadId, result: 'INTERESTED', notes: 'İlgilendi' });
    sales.scheduleFollowUp(leadId, '2026-09-05');
    const offerId = sales.createOffer({ leadId, service: 'Website', amount: 20000 });
    sales.closeOffer(offerId, 'WON');

    const types = sales.listEvents(leadId).map((e) => e.event_type);
    for (const expected of ['call_logged', 'follow_up_scheduled', 'offer_sent', 'offer_closed', 'status_changed']) {
      assert.ok(types.includes(expected), `${expected} olayi kaydedilmeli`);
    }
  });

  test('ayni duruma tekrar gecmek gereksiz olay uretmez', () => {
    const leadId = seedLead('Tekrar', '0555 000 00 11', 'HIGH', 70);

    sales.setSalesStatus(leadId, 'CALLED');
    sales.setSalesStatus(leadId, 'CALLED');

    const changes = sales.listEvents(leadId).filter((e) => e.event_type === 'status_changed');
    assert.equal(changes.length, 1);
  });
});

describe('Donusum oranlari', () => {
  test('payda sifirken oran null doner — %0 yaziImaz', () => {
    const stats = views.getSalesStats();
    assert.equal(stats.rates.callToContact, null, 'hic arama yokken oran hesaplanamaz');
    assert.equal(stats.rates.offerToWon, null);
  });

  test('gercek hareketlerle oranlar hesaplanir', () => {
    const a = seedLead('A', '0555 000 00 12', 'HIGH', 70);
    const b = seedLead('B', '0555 000 00 13', 'HIGH', 70);

    sales.logCall({ leadId: a, result: 'REACHED' });
    sales.logCall({ leadId: b, result: 'NO_ANSWER' });

    const stats = views.getSalesStats();
    assert.equal(stats.called, 2);
    assert.equal(stats.contacted, 1);
    assert.equal(stats.rates.callToContact, 50);
  });
});
