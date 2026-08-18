import Link from 'next/link';
import { listSalesLeads } from '@/lib/db/repositories/sales-views';
import { PriorityBadge, ScoreCell, StatusBadge, WebsiteScoreCell, EmptyState } from '../components/ui';
import { LeadActions } from '../components/LeadActions';
import { FilterBar } from './FilterBar';
import { applyFilters, parseFilters } from './filters';

export const dynamic = 'force-dynamic';

function shortDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
}

/** Takip tarihi gecmisse dikkat cekmeli. */
function FollowUpCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-xs text-[#6b7592]">—</span>;
  const overdue = value.slice(0, 10) < new Date().toISOString().slice(0, 10);
  return (
    <span className={`text-xs tabular-nums ${overdue ? 'font-medium text-[#ffc46b]' : 'text-[#b8c0d4]'}`}>
      {shortDate(value)}
      {overdue ? ' ⏰' : ''}
    </span>
  );
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const all = listSalesLeads();
  const leads = applyFilters(all, filters);

  const segments = [...new Set(all.map((l) => l.segment).filter(Boolean))].sort() as string[];
  const districts = [...new Set(all.map((l) => l.district).filter(Boolean))].sort() as string[];

  return (
    <main className="mx-auto max-w-[1700px] px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lead listesi</h1>
          <p className="mt-1 text-sm text-[#8b94ad]">
            Filtrele, ara, görüşmeyi kaydet. Filtreler adres çubuğunda tutulur — yer imine eklenebilir.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-[#232b45] bg-[#161d33] px-4 py-2 text-sm text-[#b8c0d4] hover:border-[#313a5c]"
        >
          ← Dashboard
        </Link>
      </header>

      <FilterBar
        segments={segments}
        districts={districts}
        resultCount={leads.length}
        total={all.length}
      />

      {leads.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? 'Henüz lead yok.' : 'Bu filtrelerle eşleşen lead yok.'}
          hint={all.length === 0 ? 'npm run pipeline -- --limit 100 --city istanbul --source places' : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#232b45] bg-[#11172a]">
          <div className="max-h-[72vh] overflow-auto">
            <table className="w-full min-w-[1450px] text-sm">
              <thead className="sticky top-0 z-10 bg-[#161d33] text-left text-xs uppercase tracking-wider text-[#8b94ad]">
                <tr>
                  <th className="px-4 py-3 font-medium">Şirket</th>
                  <th className="px-3 py-3 font-medium">Kategori</th>
                  <th className="px-3 py-3 font-medium">Lokasyon</th>
                  <th className="px-3 py-3 font-medium">Karar Verici</th>
                  <th className="px-3 py-3 font-medium">Telefon</th>
                  <th className="px-3 py-3 font-medium">Website</th>
                  <th className="px-3 py-3 font-medium">Social</th>
                  <th className="px-3 py-3 font-medium">Purchase</th>
                  <th className="px-3 py-3 font-medium">Önerilen Hizmet</th>
                  <th className="px-3 py-3 font-medium">Priority</th>
                  <th className="px-3 py-3 font-medium">Satış Durumu</th>
                  <th className="px-3 py-3 font-medium">Son Arama</th>
                  <th className="px-3 py-3 font-medium">Takip</th>
                  <th className="px-4 py-3 font-medium">Aksiyon</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#232b45]">
                {leads.map((lead) => (
                  <tr
                    key={lead.leadId}
                    className={`transition-colors hover:bg-[#161d33] ${
                      lead.priority === 'HOT' ? 'bg-[#ff5a4d]/[0.04]' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/leads/${lead.leadId}`}
                        className="font-medium text-[#e8ecf5] underline-offset-4 hover:text-[#5b8cff] hover:underline"
                      >
                        {lead.company}
                      </Link>
                      {lead.manualReview ? (
                        <span
                          className="ml-2 rounded bg-[#3a2a15] px-1.5 py-0.5 text-[10px] font-medium text-[#e0a458]"
                          title="Website otomatik denetlenemedi — tarayıcıda elle bakın"
                        >
                          elle inceleme
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-xs text-[#b8c0d4]">{lead.segment ?? '—'}</td>
                    <td className="px-3 py-3 text-xs text-[#b8c0d4]">{lead.location ?? '—'}</td>
                    <td className="px-3 py-3">
                      {lead.decisionMaker ? (
                        <>
                          <div className="text-xs text-[#b8c0d4]">{lead.decisionMaker}</div>
                          <div className="text-[11px] text-[#6b7592]">{lead.decisionMakerTitle}</div>
                        </>
                      ) : (
                        <span className="text-xs text-[#6b7592]" title="Apollo Free plan karar verici verisini kapatıyor">
                          veri yok
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {lead.phone ? (
                        <span className="font-mono text-xs text-[#b8c0d4]">{lead.phone}</span>
                      ) : (
                        <span className="text-xs text-[#6b7592]">veri yok</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <WebsiteScoreCell score={lead.websiteScore} status={lead.websiteStatus} />
                    </td>
                    <td className="px-3 py-3"><ScoreCell score={lead.socialScore} /></td>
                    <td className="px-3 py-3"><ScoreCell score={lead.purchaseScore} /></td>
                    <td className="px-3 py-3">
                      {lead.offerLabel ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="rounded bg-[#232b45] px-1.5 py-0.5 font-mono text-[10px] text-[#8b94ad]">
                            {lead.offerCode}
                          </span>
                          <span className="text-xs text-[#b8c0d4]">{lead.offerLabel}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-[#6b7592]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3"><PriorityBadge priority={lead.priority} /></td>
                    <td className="px-3 py-3"><StatusBadge status={lead.salesStatus} /></td>
                    <td className="px-3 py-3">
                      <span className="text-xs tabular-nums text-[#b8c0d4]">
                        {shortDate(lead.lastCalledAt)}
                      </span>
                      {lead.callCount > 0 ? (
                        <span className="ml-1 text-[11px] text-[#6b7592]">({lead.callCount})</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3"><FollowUpCell value={lead.nextFollowUpAt} /></td>
                    <td className="px-4 py-3">
                      <LeadActions
                        leadId={lead.leadId}
                        company={lead.company}
                        phone={lead.phone}
                        compact
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
