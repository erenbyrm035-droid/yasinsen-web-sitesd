import { getDb } from '../client';

export type RunKind = 'discover' | 'audit' | 'score' | 'pipeline';

/** Calisma kaydi acar — hangi asamanin ne zaman, ne uretti izlenebilsin. */
export function startRun(kind: RunKind): number {
  const row = getDb()
    .prepare('INSERT INTO audit_runs (kind) VALUES (?) RETURNING id')
    .get(kind) as { id: number };
  return row.id;
}

export function finishRun(runId: number, stats: unknown): void {
  getDb()
    .prepare("UPDATE audit_runs SET finished_at = datetime('now'), stats = ? WHERE id = ?")
    .run(JSON.stringify(stats), runId);
}
