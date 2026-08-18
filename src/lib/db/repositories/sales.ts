import { getDb } from '../client';
import {
  isClosed,
  RESULT_TO_STATUS,
  type CallResult,
  type SalesStatus,
} from '../../sales';

/**
 * SATIS TAKIBI REPOSITORY
 *
 * Tum satis yazmalari buradan gecer. Iki degismez:
 *   1. Gecmis SILINMEZ. call_logs ve sales_events yalnizca eklenir.
 *   2. Durum degisikligi daima bir olay birakir — zaman cizelgesi
 *      veritabanindan uretilir, ekranda kurgulanmaz.
 */

export interface CallLogRow {
  id: number;
  lead_id: number;
  called_at: string;
  result: CallResult;
  notes: string | null;
  next_follow_up_at: string | null;
  created_at: string;
}

export interface FollowUpRow {
  id: number;
  lead_id: number;
  scheduled_at: string;
  status: 'OPEN' | 'DONE' | 'CANCELLED';
  notes: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface OfferRow {
  id: number;
  lead_id: number;
  service: string;
  amount: number | null;
  sent_at: string;
  status: 'SENT' | 'WON' | 'LOST';
  notes: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface SalesEventRow {
  id: number;
  lead_id: number;
  event_type: string;
  event_data: string | null;
  created_at: string;
}

// --- olaylar ----------------------------------------------------------------

export function recordEvent(leadId: number, type: string, data?: unknown): void {
  getDb()
    .prepare('INSERT INTO sales_events (lead_id, event_type, event_data) VALUES (?, ?, ?)')
    .run(leadId, type, data === undefined ? null : JSON.stringify(data));
}

export function listEvents(leadId: number): SalesEventRow[] {
  return getDb()
    .prepare('SELECT * FROM sales_events WHERE lead_id = ? ORDER BY created_at, id')
    .all(leadId) as SalesEventRow[];
}

// --- durum ------------------------------------------------------------------

export function getSalesStatus(leadId: number): SalesStatus {
  const row = getDb().prepare('SELECT sales_status FROM leads WHERE id = ?').get(leadId) as
    | { sales_status: SalesStatus }
    | undefined;
  return row?.sales_status ?? 'NEW';
}

export function setSalesStatus(leadId: number, status: SalesStatus, note?: string): void {
  const previous = getSalesStatus(leadId);
  if (previous === status) return;

  getDb()
    .prepare("UPDATE leads SET sales_status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, leadId);
  recordEvent(leadId, 'status_changed', { from: previous, to: status, note: note ?? null });
}

/**
 * Analizi biten ve TELEFONU OLAN lead'leri aranmaya hazir isaretler.
 *
 * Telefon sarti bilincli: telefonu olmayan bir lead "aranacak" listesine
 * girerse liste kirlenir ve gunluk satis akisi bozulur. Ayrica yalnizca
 * NEW durumundakiler tasinir — elle degistirilmis durumlar korunur.
 */
export function markReadyToCall(): number {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT l.id FROM leads l
       JOIN companies c ON c.id = l.company_id
       WHERE l.sales_status = 'NEW'
         AND c.phone IS NOT NULL AND TRIM(c.phone) <> ''
         AND EXISTS (SELECT 1 FROM lead_scores s WHERE s.lead_id = l.id)`,
    )
    .all() as { id: number }[];

  for (const { id } of rows) setSalesStatus(id, 'READY_TO_CALL');
  return rows.length;
}

// --- gorusme ----------------------------------------------------------------

export interface LogCallInput {
  leadId: number;
  result: CallResult;
  notes?: string | null;
  nextFollowUpAt?: string | null;
}

/**
 * Bir gorusmeyi kaydeder ve lead'i gunceller.
 *
 * ONEMLI: call_count YALNIZCA burada artar. "ARA" butonu telefon uygulamasini
 * acar ama sayaci artirmaz — kullanici telefonu acmadan arama sayilmamali.
 * Sayaci ne zaman artiracagina kullanici karar verir.
 */
export function logCall(input: LogCallInput): number {
  const db = getDb();

  return db.transaction(() => {
    const row = db
      .prepare(
        `INSERT INTO call_logs (lead_id, result, notes, next_follow_up_at)
         VALUES (@leadId, @result, @notes, @nextFollowUpAt)
         RETURNING id`,
      )
      .get({
        leadId: input.leadId,
        result: input.result,
        notes: input.notes?.trim() || null,
        nextFollowUpAt: input.nextFollowUpAt || null,
      }) as { id: number };

    db.prepare(
      `UPDATE leads
         SET call_count = call_count + 1,
             last_called_at = datetime('now'),
             updated_at = datetime('now')
       WHERE id = ?`,
    ).run(input.leadId);

    recordEvent(input.leadId, 'call_logged', {
      result: input.result,
      notes: input.notes?.trim() || null,
    });

    // Sonuc, lead'i otomatik olarak dogru satis durumuna tasir.
    setSalesStatus(input.leadId, RESULT_TO_STATUS[input.result]);

    if (input.nextFollowUpAt) {
      scheduleFollowUp(input.leadId, input.nextFollowUpAt, input.notes ?? null);
    }

    return row.id;
  })();
}

export function listCalls(leadId: number): CallLogRow[] {
  return getDb()
    .prepare('SELECT * FROM call_logs WHERE lead_id = ? ORDER BY called_at DESC, id DESC')
    .all(leadId) as CallLogRow[];
}

// --- takip ------------------------------------------------------------------

/**
 * Takip planlar. Bir lead'in ayni anda tek acik takibi olur — yenisi
 * eskisini iptal eder, boylece "bugun takip edilecekler" listesi cogalmaz.
 */
export function scheduleFollowUp(leadId: number, scheduledAt: string, notes?: string | null): void {
  const db = getDb();
  db.prepare("UPDATE follow_ups SET status = 'CANCELLED' WHERE lead_id = ? AND status = 'OPEN'").run(
    leadId,
  );
  db.prepare('INSERT INTO follow_ups (lead_id, scheduled_at, notes) VALUES (?, ?, ?)').run(
    leadId,
    scheduledAt,
    notes?.trim() || null,
  );
  db.prepare("UPDATE leads SET next_follow_up_at = ?, updated_at = datetime('now') WHERE id = ?").run(
    scheduledAt,
    leadId,
  );
  recordEvent(leadId, 'follow_up_scheduled', { scheduledAt });
}

export function completeFollowUp(followUpId: number): void {
  const db = getDb();
  const row = db.prepare('SELECT lead_id FROM follow_ups WHERE id = ?').get(followUpId) as
    | { lead_id: number }
    | undefined;
  if (!row) return;

  db.prepare(
    "UPDATE follow_ups SET status = 'DONE', completed_at = datetime('now') WHERE id = ?",
  ).run(followUpId);
  db.prepare('UPDATE leads SET next_follow_up_at = NULL WHERE id = ?').run(row.lead_id);
  recordEvent(row.lead_id, 'follow_up_completed', { followUpId });
}

export function listFollowUps(leadId: number): FollowUpRow[] {
  return getDb()
    .prepare('SELECT * FROM follow_ups WHERE lead_id = ? ORDER BY scheduled_at DESC, id DESC')
    .all(leadId) as FollowUpRow[];
}

// --- teklif -----------------------------------------------------------------

export interface CreateOfferInput {
  leadId: number;
  service: string;
  amount?: number | null;
  notes?: string | null;
}

export function createOffer(input: CreateOfferInput): number {
  const db = getDb();
  return db.transaction(() => {
    const row = db
      .prepare(
        `INSERT INTO offers (lead_id, service, amount, notes)
         VALUES (@leadId, @service, @amount, @notes) RETURNING id`,
      )
      .get({
        leadId: input.leadId,
        service: input.service,
        // Tutar girilmediyse NULL — tahmin edilmez.
        amount: input.amount ?? null,
        notes: input.notes?.trim() || null,
      }) as { id: number };

    recordEvent(input.leadId, 'offer_sent', { service: input.service, amount: input.amount ?? null });
    setSalesStatus(input.leadId, 'OFFER_SENT');
    return row.id;
  })();
}

export function closeOffer(offerId: number, outcome: 'WON' | 'LOST', notes?: string | null): void {
  const db = getDb();
  const row = db.prepare('SELECT lead_id FROM offers WHERE id = ?').get(offerId) as
    | { lead_id: number }
    | undefined;
  if (!row) return;

  db.transaction(() => {
    db.prepare(
      "UPDATE offers SET status = ?, closed_at = datetime('now'), notes = COALESCE(?, notes) WHERE id = ?",
    ).run(outcome, notes?.trim() || null, offerId);
    recordEvent(row.lead_id, 'offer_closed', { outcome });
    setSalesStatus(row.lead_id, outcome);
  })();
}

export function listOffers(leadId: number): OfferRow[] {
  return getDb()
    .prepare('SELECT * FROM offers WHERE lead_id = ? ORDER BY sent_at DESC, id DESC')
    .all(leadId) as OfferRow[];
}

export { isClosed };
