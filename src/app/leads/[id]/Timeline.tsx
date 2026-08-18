import { EVENT_LABEL } from '@/lib/sales';
import type { SalesEventRow } from '@/lib/db/repositories/sales';

/**
 * Satis zaman cizelgesi.
 *
 * Tamamen veritabanindan uretilir (sales_events + kesif/denetim tarihleri).
 * Hicbir adim varsayilmaz: olay kaydedilmediyse cizelgede gorunmez.
 */

export interface TimelineEntry {
  at: string;
  type: string;
  detail: string | null;
}

function fmt(value: string): { date: string; time: string } {
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return { date: value.slice(0, 10), time: '' };
  return {
    date: d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }),
    time: d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
  };
}

/** sales_events satirlarini okunur cizelge girdilerine cevirir. */
export function toEntries(events: SalesEventRow[]): TimelineEntry[] {
  return events.map((e) => {
    let detail: string | null = null;
    try {
      const data = e.event_data ? (JSON.parse(e.event_data) as Record<string, unknown>) : null;
      if (data) {
        if (typeof data.notes === 'string' && data.notes) detail = data.notes;
        else if (typeof data.to === 'string') detail = String(data.to);
        else if (typeof data.scheduledAt === 'string') detail = data.scheduledAt.slice(0, 10);
        else if (typeof data.service === 'string') detail = data.service;
        else if (typeof data.outcome === 'string') detail = data.outcome;
        else if (typeof data.result === 'string') detail = data.result;
      }
    } catch {
      detail = null; // Bozuk JSON cizelgeyi dusurmesin.
    }
    return { at: e.created_at, type: e.event_type, detail };
  });
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-xs text-[#6b7592]">Henüz kayıtlı olay yok.</p>;
  }

  return (
    <ol className="relative space-y-4 border-l border-[#232b45] pl-5">
      {entries.map((e, i) => {
        const { date, time } = fmt(e.at);
        return (
          <li key={`${e.at}-${i}`} className="relative">
            <span className="absolute -left-[23px] top-1.5 h-2 w-2 rounded-full bg-[#5b8cff] ring-4 ring-[#11172a]" />
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm text-[#e8ecf5]">{EVENT_LABEL[e.type] ?? e.type}</span>
              <span className="text-[11px] tabular-nums text-[#6b7592]">
                {date}
                {time ? ` · ${time}` : ''}
              </span>
            </div>
            {e.detail ? (
              <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-[#8b94ad]">
                {e.detail}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
