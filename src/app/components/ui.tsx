import type { Priority } from '@/lib/types';

/** Dashboard genelinde paylasilan kucuk gorsel parcalar. */

const PRIORITY_STYLE: Record<Priority, { label: string; className: string }> = {
  HOT: { label: '🔥 HOT', className: 'bg-[#ff5a4d]/15 text-[#ff8b81] ring-[#ff5a4d]/40' },
  HIGH: { label: '🟢 HIGH', className: 'bg-[#ffab2e]/15 text-[#ffc46b] ring-[#ffab2e]/40' },
  MEDIUM: { label: '🟡 MEDIUM', className: 'bg-[#45c0d6]/15 text-[#7fd8e8] ring-[#45c0d6]/40' },
  LOW: { label: '🔴 LOW', className: 'bg-[#6b7592]/15 text-[#9aa4bd] ring-[#6b7592]/40' },
};

export function PriorityBadge({ priority }: { priority: Priority | null }) {
  if (!priority) {
    return <span className="text-xs text-[#6b7592]">—</span>;
  }
  const style = PRIORITY_STYLE[priority];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${style.className}`}
    >
      {style.label}
    </span>
  );
}

/** Skor rengi: yuksek = iyi (yesil), dusuk = kotu (kirmizi). */
function scoreColor(score: number): string {
  if (score >= 75) return '#4ade80';
  if (score >= 50) return '#ffab2e';
  if (score >= 25) return '#ff8b81';
  return '#ff5a4d';
}

export function ScoreCell({ score, invert = false }: { score: number | null; invert?: boolean }) {
  if (score === null) {
    return (
      <span className="text-xs text-[#6b7592]" title="Ölçülemedi — veri yok">
        veri yok
      </span>
    );
  }
  // Purchase score'da yuksek deger IYIDIR ama anlami "firsat buyuk"tur;
  // invert=true bu durumda ters renk skalasi kullanir.
  const color = scoreColor(invert ? 100 - score : score);
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="font-medium" style={{ color }}>
        {score}
      </span>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-[#232b45]">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.max(score, 3)}%`, background: color }}
        />
      </span>
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-[#232b45] bg-[#11172a] p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-[#8b94ad]">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-[#6b7592]">{hint}</div>}
    </div>
  );
}

/** Olculemeyen veri icin acik isaret — bos birakip belirsizlik uretmiyoruz. */
export function NoData({ reason }: { reason?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md bg-[#161d33] px-2 py-0.5 text-xs text-[#6b7592] ring-1 ring-[#232b45]"
      title={reason}
    >
      veri yok
    </span>
  );
}

export function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#232b45] bg-[#11172a]">
      <header className="border-b border-[#232b45] px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#8b94ad]">{title}</h2>
        {subtitle && <p className="mt-1 text-xs text-[#6b7592]">{subtitle}</p>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Satis takibi
// ---------------------------------------------------------------------------

import { SALES_STATUS_LABEL, telHref, type SalesStatus } from '@/lib/sales';

/**
 * Satis durumu rozeti.
 * Renkler surecin yonunu anlatir: notr -> ilerleme -> kazanc / kayip.
 * Bilincli olarak az renk: tabloda goz once HOT lead'lere gitmeli.
 */
const STATUS_STYLE: Record<SalesStatus, string> = {
  NEW: 'bg-[#232b45] text-[#9aa4bd]',
  READY_TO_CALL: 'bg-[#5b8cff]/15 text-[#8fb0ff]',
  CALLED: 'bg-[#45c0d6]/15 text-[#7fd8e8]',
  NO_ANSWER: 'bg-[#6b7592]/15 text-[#9aa4bd]',
  CALLBACK: 'bg-[#ffab2e]/15 text-[#ffc46b]',
  INTERESTED: 'bg-[#4ade80]/15 text-[#7ee8a5]',
  NOT_INTERESTED: 'bg-[#6b7592]/15 text-[#8b94ad]',
  OFFER_SENT: 'bg-[#a78bfa]/15 text-[#c4b0fd]',
  NEGOTIATION: 'bg-[#a78bfa]/20 text-[#d0c0fe]',
  WON: 'bg-[#4ade80]/25 text-[#8ff0b5]',
  LOST: 'bg-[#ff5a4d]/15 text-[#ff8b81]',
  DO_NOT_CONTACT: 'bg-[#ff5a4d]/10 text-[#c98a84]',
};

export function StatusBadge({ status }: { status: SalesStatus }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {SALES_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Telefon aksiyonu.
 *
 * Bu buton YALNIZCA telefon uygulamasini acar; arama sayacini ARTIRMAZ.
 * Kullanici telefonu gercekten actiktan sonra "Arandı" butonuna basar.
 * Boylece sayac gercek gorusmeleri sayar, tiklamalari degil.
 */
export function CallButton({ phone, compact = false }: { phone: string | null; compact?: boolean }) {
  if (!phone) {
    return <span className="text-xs text-[#6b7592]">telefon yok</span>;
  }
  return (
    <a
      href={telHref(phone)}
      className={`inline-flex items-center gap-1.5 rounded-lg bg-[#5b8cff] font-medium text-white transition-colors hover:bg-[#4a7bee] ${
        compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
      }`}
      title={`${phone} — telefon uygulamasını açar, arama sayacını artırmaz`}
    >
      📞 Ara
    </a>
  );
}

/** Skor yerine "ölçülemedi" gosterimi — 0 yazmak yanlis okunurdu. */
export function WebsiteScoreCell({
  score,
  status,
}: {
  score: number | null;
  status: string | null;
}) {
  if (score === null) {
    return (
      <span
        className="inline-flex whitespace-nowrap rounded bg-[#3a2a15] px-2 py-0.5 text-[11px] text-[#e0a458]"
        title={`Durum: ${status ?? 'bilinmiyor'} — otomatik denetim yapılamadı`}
      >
        ölçülemedi
      </span>
    );
  }
  return <ScoreCell score={score} />;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#232b45] bg-[#11172a] p-10 text-center">
      <p className="text-sm text-[#8b94ad]">{title}</p>
      {hint ? <p className="mt-2 text-xs text-[#6b7592]">{hint}</p> : null}
    </div>
  );
}
