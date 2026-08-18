import { getDb } from '../client';
import type { LeadStatus } from '../../types';

export interface LeadRow {
  id: number;
  company_id: number;
  primary_contact_id: number | null;
  status: LeadStatus;
  discovered_at: string;
  updated_at: string;
}

/** Sirket icin lead kaydini olusturur ya da mevcudu dondurur (idempotent). */
export function ensureLead(companyId: number): number {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM leads WHERE company_id = ?').get(companyId) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;

  const row = db
    .prepare('INSERT INTO leads (company_id) VALUES (?) RETURNING id')
    .get(companyId) as { id: number };
  return row.id;
}

export function setLeadStatus(leadId: number, status: LeadStatus): void {
  getDb()
    .prepare("UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, leadId);
}

export function setPrimaryContact(leadId: number, contactId: number): void {
  getDb()
    .prepare("UPDATE leads SET primary_contact_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(contactId, leadId);
}

export function getLead(leadId: number): LeadRow | undefined {
  return getDb().prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as LeadRow | undefined;
}

export function getLeadByCompany(companyId: number): LeadRow | undefined {
  return getDb().prepare('SELECT * FROM leads WHERE company_id = ?').get(companyId) as
    | LeadRow
    | undefined;
}

export function listLeads(status?: LeadStatus): LeadRow[] {
  const db = getDb();
  return status
    ? (db.prepare('SELECT * FROM leads WHERE status = ? ORDER BY id').all(status) as LeadRow[])
    : (db.prepare('SELECT * FROM leads ORDER BY id').all() as LeadRow[]);
}

/** Veritabanindaki toplam lead sayisi. */
export function countLeads(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM leads').get() as { n: number };
  return row.n;
}
