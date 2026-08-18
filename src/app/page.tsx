import Link from 'next/link';
import {
  getSalesStats,
  listFollowUpsDue,
  listTodayCallList,
} from '@/lib/db/repositories/sales-views';
import type { SalesLeadRow } from '@/lib/db/repositories/sales-views';
import { PriorityBadge, StatusBadge, EmptyState } from './components/ui';
import { LeadActions } from './components/LeadActions';

// Pipeline her calistiginda SQLite degisir; sayfa her istekte yeniden okunur.
export const dynamic = 'force-dynamic';

function Kpi({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number | string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-[#232b45] bg-[#11172a] p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[#8b94ad]">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[11px] text-[#6b7592]">{hint}</div> : null}
    </div>
  );
}

/** Oran yoksa "—" gosterilir; payda sifirken %0 yazmak yaniltici olurdu. */
function Rate({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#232b45] py-2.5 last:border-0">
      <div>
        <div className="text-sm text-[#b8c0d4]">{label}</div>
        <div className="text-[11px] text-[#6b7592]">{detail}</div>
      </div>
      <div className="text-lg font-semibold tabular-nums text-[#e8ecf5]">
        {value === null ? <span className="text-sm text-[#6b7592]">—</span> : `%${value}`}
      </div>
    </div>
  );
}

function CallRow({ lead, index }: { lead: SalesLeadRow; index: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[#232b45] px-4 py-3 last:border-0 hover:bg-[#161d33]">
      <span className="w-5 shrink-0 text-sm tabular-nums text-[#6b7592]">{index}</span>
      <div className="min-w-[190px] flex-1">
        <Link
          href={`/leads/${lead.leadId}`}
          className="font-medium text-[#e8ecf5] underline-offset-4 hover:text-[#5b8cff] hover:underline"
        >
          {lead.company}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[#6b7592]">
          <span>{lead.location ?? '—'}</span>
          {lead.callCount > 0 ? <span>· {lead.callCount} kez arandı</span> : <span>· hiç aranmadı</span>}
          {lead.lastCallNotes ? (
            <span className="text-[#8b94ad]">· {lead.lastCallNotes.split('\n')[0].slice(0, 60)}</span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold tabular-nums text-[#e8ecf5]">
          {lead.purchaseScore ?? '—'}
        </span>
        <PriorityBadge priority={lead.priority} />
        <StatusBadge status={lead.salesStatus} />
      </div>
      <LeadActions leadId={lead.leadId} company={lead.company} phone={lead.phone} compact />
    </div>
  );
}

export default function DashboardPage() {
  const stats = getSalesStats();
  const callList = listTodayCallList(25);
  const { today, overdue } = listFollowUpsDue();

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">VIVA SALES ENGINE</h1>
          <p className="mt-1 text-sm text-[#8b94ad]">
            İstanbul · fitness &amp; wellness · günlük müşteri bulma ve satış takip merkezi
          </p>
        </div>
        <Link
          href="/leads"
          className="rounded-lg border border-[#232b45] bg-[#161d33] px-4 py-2 text-sm text-[#b8c0d4] hover:border-[#313a5c]"
        >
          Tüm lead&apos;ler →
        </Link>
      </header>

      {/* --- KPI --- */}
      <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Toplam Lead" value={stats.totalLeads} />
        <Kpi label="Bugün Aranacak" value={callList.length} accent="#5b8cff" />
        <Kpi label="Arandı" value={stats.called} hint={`${stats.contacted} ulaşıldı`} />
        <Kpi label="Takip Bekliyor" value={stats.followUpDue} accent={stats.followUpDue > 0 ? '#ffab2e' : undefined} />
        <Kpi label="Teklif Gönderildi" value={stats.offerSent} />
        <Kpi label="Kazanıldı" value={stats.won} accent={stats.won > 0 ? '#4ade80' : undefined} />
        <Kpi label="Kaybedildi" value={stats.lost} />
      </section>

      <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="🔥 HOT" value={stats.hot} accent="#ff8b81" />
        <Kpi label="🟢 HIGH" value={stats.high} accent="#ffc46b" />
        <Kpi label="🟡 MEDIUM" value={stats.medium} accent="#7fd8e8" />
        <Kpi label="🔴 LOW" value={stats.low} accent="#9aa4bd" />
      </section>

      {/* --- Gecikmis takipler: en ustte, cunku kaciyor --- */}
      {overdue.length > 0 ? (
        <section className="mb-6 overflow-hidden rounded-xl border border-[#ffab2e]/40 bg-[#11172a]">
          <div className="flex items-center justify-between border-b border-[#ffab2e]/30 bg-[#ffab2e]/10 px-4 py-3">
            <h2 className="text-sm font-semibold text-[#ffc46b]">
              ⏰ Gecikmiş takipler ({overdue.length})
            </h2>
            <span className="text-xs text-[#8b94ad]">takip tarihi geçmiş</span>
          </div>
          {overdue.map((lead, i) => (
            <CallRow key={lead.leadId} lead={lead} index={i + 1} />
          ))}
        </section>
      ) : null}

      {/* --- Bugun takip edilecekler --- */}
      {today.length > 0 ? (
        <section className="mb-6 overflow-hidden rounded-xl border border-[#232b45] bg-[#11172a]">
          <div className="border-b border-[#232b45] bg-[#161d33] px-4 py-3">
            <h2 className="text-sm font-semibold text-[#e8ecf5]">
              Bugün takip edilecekler ({today.length})
            </h2>
          </div>
          {today.map((lead, i) => (
            <CallRow key={lead.leadId} lead={lead} index={i + 1} />
          ))}
        </section>
      ) : null}

      {/* --- Bugunun satis listesi --- */}
      <section className="mb-8 overflow-hidden rounded-xl border border-[#5b8cff]/30 bg-[#11172a]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#5b8cff]/25 bg-[#5b8cff]/10 px-4 py-3">
          <h2 className="text-sm font-semibold text-[#8fb0ff]">
            BUGÜNÜN SATIŞ LİSTESİ — {callList.length} lead aranacak
          </h2>
          <span className="text-xs text-[#8b94ad]">
            sıra: HOT → HIGH → purchase score → hiç aranmamış
          </span>
        </div>
        {callList.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#8b94ad]">
            Aranacak lead yok. Telefonu olan ve kapanmamış lead kalmamış olabilir.
          </div>
        ) : (
          callList.map((lead, i) => <CallRow key={lead.leadId} lead={lead} index={i + 1} />)
        )}
      </section>

      {/* --- Donusum --- */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[#232b45] bg-[#11172a] p-5">
          <h2 className="mb-3 text-sm font-semibold text-[#e8ecf5]">Satış hunisi</h2>
          <Rate label="Arama → Ulaşma" value={stats.rates.callToContact} detail={`${stats.contacted} / ${stats.called}`} />
          <Rate label="Ulaşma → İlgi" value={stats.rates.contactToInterest} detail={`ulaşılan ${stats.contacted} lead içinden`} />
          <Rate label="İlgi → Teklif" value={stats.rates.interestToOffer} detail={`${stats.offerSent} teklif gönderildi`} />
          <Rate label="Teklif → Satış" value={stats.rates.offerToWon} detail={`${stats.won} / ${stats.offerSent}`} />
          <Rate label="Lead → Satış" value={stats.rates.leadToWon} detail={`${stats.won} / ${stats.totalLeads}`} />
        </div>

        <div className="rounded-xl border border-[#232b45] bg-[#11172a] p-5">
          <h2 className="mb-3 text-sm font-semibold text-[#e8ecf5]">Sistem sınırı</h2>
          <p className="text-sm leading-relaxed text-[#8b94ad]">
            Bu sistem yalnızca <b className="text-[#b8c0d4]">araştırma ve takip</b> yapar.
            Hiçbir işletmeye otomatik e-posta, SMS veya WhatsApp gönderilmez; otomatik arama
            başlatılmaz. &ldquo;Ara&rdquo; butonu yalnızca telefon uygulamanızı açar ve arama
            sayacını artırmaz — sayaç siz &ldquo;Arandı&rdquo; dediğinizde artar.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-[#8b94ad]">
            Ölçülemeyen veriler <b className="text-[#b8c0d4]">tahmin edilmez</b>. Bot koruması
            arkasındaki siteler skor almaz, &ldquo;ölçülemedi&rdquo; olarak işaretlenip elle
            incelemeye düşer.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Link href="/leads" className="rounded-lg border border-[#232b45] px-3 py-1.5 text-[#b8c0d4] hover:bg-[#161d33]">
              Lead listesi
            </Link>
            <Link href="/api/leads" className="rounded-lg border border-[#232b45] px-3 py-1.5 text-[#b8c0d4] hover:bg-[#161d33]">
              JSON export
            </Link>
          </div>
        </div>
      </section>

      {stats.totalLeads === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Henüz lead yok."
            hint="npm run pipeline -- --limit 100 --city istanbul --source places"
          />
        </div>
      ) : null}
    </main>
  );
}
