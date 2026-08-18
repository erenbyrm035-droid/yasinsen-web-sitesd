import Link from 'next/link';
import { getDashboardStats, listLeadTable } from '@/lib/db/repositories/views';
import { PriorityBadge, ScoreCell, StatCard } from './components/ui';

// Pipeline her calistiginda SQLite degisir; sayfa her istekte yeniden okunur.
export const dynamic = 'force-dynamic';

/** Bozuk URL tum sayfayi dusurmesin. */
function hostnameOf(url: string | null): string {
  if (!url) return 'website yok';
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default function DashboardPage() {
  const stats = getDashboardStats();
  const leads = listLeadTable();

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">VIVA SALES ENGINE</h1>
        <p className="mt-1 text-sm text-[#8b94ad]">
          İstanbul · fitness &amp; wellness sektörü · DISCOVER → ANALYZE → SCORE → RECOMMEND
        </p>
      </header>

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard label="Total Leads" value={stats.totalLeads} />
        <StatCard
          label="Analyzed"
          value={stats.analyzed}
          hint={
            stats.totalLeads > 0
              ? `%${Math.round((stats.analyzed / stats.totalLeads) * 100)} denetlendi`
              : undefined
          }
        />
        <StatCard label="Hot Leads" value={stats.hotLeads} hint="purchase ≥ 80" />
        <StatCard label="High Potential" value={stats.highPotential} hint="purchase 65–79" />
        <StatCard
          label="Average Score"
          value={stats.averageScore ?? '—'}
          hint={stats.averageScore === null ? 'henüz skor yok' : 'purchase score ortalaması'}
        />
      </div>

      {leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#232b45] bg-[#11172a] p-12 text-center">
          <p className="text-sm text-[#8b94ad]">Henüz lead yok.</p>
          <p className="mt-2 font-mono text-xs text-[#6b7592]">
            npm run pipeline -- --limit 10 --city istanbul
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#232b45] bg-[#11172a]">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-[#161d33] text-left text-xs uppercase tracking-wider text-[#8b94ad]">
                <tr>
                  <th className="px-5 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Telefon</th>
                  <th className="px-4 py-3 font-medium">Decision Maker</th>
                  <th className="px-4 py-3 font-medium">Industry</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Website</th>
                  <th className="px-4 py-3 font-medium">Social</th>
                  <th className="px-4 py-3 font-medium">Purchase</th>
                  <th className="px-4 py-3 font-medium">Recommended Offer</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#232b45]">
                {leads.map((lead) => (
                  <tr key={lead.leadId} className="transition-colors hover:bg-[#161d33]">
                    <td className="px-5 py-3">
                      <Link
                        href={`/leads/${lead.leadId}`}
                        className="font-medium text-[#e8ecf5] underline-offset-4 hover:text-[#5b8cff] hover:underline"
                      >
                        {lead.company}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-[#6b7592]">
                        <span>{hostnameOf(lead.website)}</span>
                        {lead.manualReview ? (
                          <span
                            className="rounded bg-[#3a2a15] px-1.5 py-0.5 text-[10px] font-medium text-[#e0a458]"
                            title={lead.websiteReason ?? 'Otomatik denetim yapılamadı'}
                          >
                            elle inceleme
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {lead.phone ? (
                        <a
                          href={`tel:${lead.phone.replace(/\s/g, '')}`}
                          className="font-mono text-sm text-[#5b8cff] underline-offset-4 hover:underline"
                        >
                          {lead.phone}
                        </a>
                      ) : (
                        <span className="text-xs text-[#6b7592]">veri yok</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {lead.decisionMaker ? (
                        <>
                          <div>{lead.decisionMaker}</div>
                          <div className="text-xs text-[#6b7592]">{lead.decisionMakerTitle}</div>
                        </>
                      ) : (
                        <span className="text-xs text-[#6b7592]" title="Apollo bağlantısı açılınca dolar">
                          veri yok
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#b8c0d4]">{lead.industry ?? '—'}</td>
                    <td className="px-4 py-3 text-[#b8c0d4]">{lead.location ?? '—'}</td>
                    <td className="px-4 py-3">
                      {lead.websiteScore === null && lead.websiteStatus !== 'no_website' ? (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-[#3a2a15] px-1.5 py-0.5 text-[11px] text-[#e0a458]"
                          title={lead.websiteReason ?? 'Site otomatik denetime kapalı'}
                        >
                          ölçülemedi
                        </span>
                      ) : (
                        <ScoreCell score={lead.websiteScore} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ScoreCell score={lead.socialScore} />
                    </td>
                    <td className="px-4 py-3">
                      <ScoreCell score={lead.purchaseScore} />
                    </td>
                    <td className="px-4 py-3">
                      {lead.offerLabel ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="rounded bg-[#232b45] px-1.5 py-0.5 font-mono text-[10px] text-[#8b94ad]">
                            {lead.offerCode}
                          </span>
                          <span className="text-[#b8c0d4]">{lead.offerLabel}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-[#6b7592]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={lead.priority} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <footer className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#6b7592]">
        <span>Purchase score azalan sırada — en yüksek potansiyel üstte.</span>
        <span className="text-[#4a536b]">·</span>
        <Link href="/api/leads" className="underline underline-offset-4 hover:text-[#8b94ad]">
          JSON export
        </Link>
        <span className="text-[#4a536b]">·</span>
        <span>
          Bu sistem yalnızca araştırma yapar: hiçbir lead&apos;e mesaj gönderilmez.
        </span>
      </footer>
    </main>
  );
}
