'use client';

import { useActionState, useState } from 'react';
import {
  closeOfferAction,
  createOfferAction,
  scheduleFollowUpAction,
  setStatusAction,
  type ActionState,
} from '@/app/actions/sales';
import { CallModal } from '@/app/components/CallModal';
import {
  CALL_RESULT_LABEL,
  SALES_STATUSES,
  SALES_STATUS_LABEL,
  telHref,
  type CallResult,
  type SalesStatus,
} from '@/lib/sales';

/**
 * Lead detayindaki satis bolumu.
 *
 * Analiz kismina DOKUNMAZ — mevcut denetim ve AI gorunumu oldugu gibi kalir.
 * Burasi yalnizca satis surecini yonetir: durum, gorusme, takip, teklif.
 */

const INPUT =
  'w-full rounded-lg border border-[#232b45] bg-[#0b0f19] px-3 py-2 text-sm text-[#e8ecf5] placeholder:text-[#4a536b] focus:border-[#5b8cff] focus:outline-none';
const BTN =
  'rounded-lg bg-[#5b8cff] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#4a7bee] disabled:opacity-40';

function Feedback({ state }: { state: ActionState | null }) {
  if (!state) return null;
  return (
    <p className={`mt-2 text-xs ${state.ok ? 'text-[#7ee8a5]' : 'text-[#ff8b81]'}`} role="status">
      {state.message}
    </p>
  );
}

export interface CallEntry {
  id: number;
  calledAt: string;
  result: CallResult;
  notes: string | null;
  nextFollowUpAt: string | null;
}

export interface OfferEntry {
  id: number;
  service: string;
  amount: number | null;
  sentAt: string;
  status: 'SENT' | 'WON' | 'LOST';
  notes: string | null;
}

function fmtDateTime(value: string): string {
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtAmount(amount: number | null): string {
  // Tutar girilmediyse uydurulmaz.
  if (amount === null) return 'tutar girilmedi';
  return `${amount.toLocaleString('tr-TR')} TL`;
}

export function SalesPanel({
  leadId,
  company,
  phone,
  status,
  callCount,
  lastCalledAt,
  nextFollowUpAt,
  calls,
  offers,
  suggestedService,
}: {
  leadId: number;
  company: string;
  phone: string | null;
  status: SalesStatus;
  callCount: number;
  lastCalledAt: string | null;
  nextFollowUpAt: string | null;
  calls: CallEntry[];
  offers: OfferEntry[];
  suggestedService: string | null;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [statusState, statusAction, statusPending] = useActionState<ActionState | null, FormData>(setStatusAction, null);
  const [followState, followAction, followPending] = useActionState<ActionState | null, FormData>(scheduleFollowUpAction, null);
  const [offerState, offerAction, offerPending] = useActionState<ActionState | null, FormData>(createOfferAction, null);
  const [closeState, closeAction] = useActionState<ActionState | null, FormData>(closeOfferAction, null);

  const openOffer = offers.find((o) => o.status === 'SENT') ?? null;

  return (
    <div className="space-y-4">
      {/* --- Hizli aksiyonlar --- */}
      <section className="rounded-xl border border-[#232b45] bg-[#11172a] p-4">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[#8b94ad]">
          Satış aksiyonları
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          {phone ? (
            <a href={telHref(phone)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#5b8cff] px-4 py-2 text-sm font-medium text-white hover:bg-[#4a7bee]">
              📞 Ara
            </a>
          ) : (
            <span className="text-xs text-[#6b7592]">telefon yok</span>
          )}
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-lg border border-[#4ade80]/40 bg-[#4ade80]/10 px-4 py-2 text-sm font-medium text-[#7ee8a5] hover:bg-[#4ade80]/20"
          >
            Arandı
          </button>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-[#6b7592]">
          &ldquo;Ara&rdquo; yalnızca telefon uygulamasını açar ve sayacı artırmaz.
          Sayaç &ldquo;Arandı&rdquo; kaydını girdiğinizde artar.
        </p>

        <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-[#232b45] pt-3 text-xs">
          <div>
            <dt className="text-[#6b7592]">Arama sayısı</dt>
            <dd className="mt-0.5 tabular-nums text-[#e8ecf5]">{callCount}</dd>
          </div>
          <div>
            <dt className="text-[#6b7592]">Son arama</dt>
            <dd className="mt-0.5 text-[#e8ecf5]">{lastCalledAt ? fmtDateTime(lastCalledAt) : '—'}</dd>
          </div>
          <div>
            <dt className="text-[#6b7592]">Sonraki takip</dt>
            <dd className="mt-0.5 text-[#e8ecf5]">{nextFollowUpAt?.slice(0, 10) ?? '—'}</dd>
          </div>
        </dl>
      </section>

      {/* --- Durum --- */}
      <section className="rounded-xl border border-[#232b45] bg-[#11172a] p-4">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[#8b94ad]">
          Satış durumu
        </h2>
        <form action={statusAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="leadId" value={leadId} />
          <select name="status" defaultValue={status} className={`${INPUT} flex-1`} aria-label="Satış durumu">
            {SALES_STATUSES.map((s) => (
              <option key={s} value={s}>{SALES_STATUS_LABEL[s]}</option>
            ))}
          </select>
          <button type="submit" className={BTN} disabled={statusPending}>
            {statusPending ? '…' : 'Güncelle'}
          </button>
        </form>
        <Feedback state={statusState} />
      </section>

      {/* --- Takip --- */}
      <section className="rounded-xl border border-[#232b45] bg-[#11172a] p-4">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[#8b94ad]">
          Takip planla
        </h2>
        <form action={followAction} className="space-y-2">
          <input type="hidden" name="leadId" value={leadId} />
          <div className="flex gap-2">
            <input type="date" name="scheduledAt" required className={INPUT} aria-label="Takip tarihi" />
            <button type="submit" className={BTN} disabled={followPending}>
              {followPending ? '…' : 'Planla'}
            </button>
          </div>
          <input type="text" name="notes" placeholder="Not (isteğe bağlı)" className={INPUT} />
        </form>
        <Feedback state={followState} />
      </section>

      {/* --- Teklif --- */}
      <section className="rounded-xl border border-[#232b45] bg-[#11172a] p-4">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[#8b94ad]">
          Teklif
        </h2>

        {openOffer ? (
          <div className="mb-3 rounded-lg border border-[#a78bfa]/30 bg-[#a78bfa]/10 p-3">
            <div className="text-sm font-medium text-[#c4b0fd]">{openOffer.service}</div>
            <div className="mt-0.5 text-xs text-[#8b94ad]">
              {fmtAmount(openOffer.amount)} · {fmtDateTime(openOffer.sentAt)}
            </div>
            <div className="mt-2.5 flex gap-2">
              <form action={closeAction}>
                <input type="hidden" name="offerId" value={openOffer.id} />
                <input type="hidden" name="leadId" value={leadId} />
                <input type="hidden" name="outcome" value="WON" />
                <button type="submit" className="rounded-lg bg-[#4ade80]/20 px-3 py-1.5 text-xs font-medium text-[#7ee8a5] hover:bg-[#4ade80]/30">
                  Kazanıldı
                </button>
              </form>
              <form action={closeAction}>
                <input type="hidden" name="offerId" value={openOffer.id} />
                <input type="hidden" name="leadId" value={leadId} />
                <input type="hidden" name="outcome" value="LOST" />
                <button type="submit" className="rounded-lg border border-[#232b45] px-3 py-1.5 text-xs text-[#b8c0d4] hover:bg-[#161d33]">
                  Kaybedildi
                </button>
              </form>
            </div>
            <Feedback state={closeState} />
          </div>
        ) : null}

        <form action={offerAction} className="space-y-2">
          <input type="hidden" name="leadId" value={leadId} />
          <input
            type="text"
            name="service"
            required
            defaultValue={suggestedService ?? ''}
            placeholder="Hizmet (örn. Website + Social Media)"
            className={INPUT}
          />
          <input type="text" name="amount" inputMode="decimal" placeholder="Tutar TL (isteğe bağlı)" className={INPUT} />
          <input type="text" name="notes" placeholder="Not" className={INPUT} />
          <button type="submit" className={`${BTN} w-full`} disabled={offerPending}>
            {offerPending ? 'Kaydediliyor…' : 'Teklif gönderildi olarak kaydet'}
          </button>
        </form>
        <Feedback state={offerState} />

        {offers.filter((o) => o.status !== 'SENT').length > 0 ? (
          <ul className="mt-3 space-y-1.5 border-t border-[#232b45] pt-3">
            {offers.filter((o) => o.status !== 'SENT').map((o) => (
              <li key={o.id} className="flex items-center justify-between text-xs">
                <span className="text-[#b8c0d4]">{o.service}</span>
                <span className={o.status === 'WON' ? 'text-[#7ee8a5]' : 'text-[#ff8b81]'}>
                  {o.status === 'WON' ? 'Kazanıldı' : 'Kaybedildi'} · {fmtAmount(o.amount)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* --- Gorusme gecmisi --- */}
      <section className="rounded-xl border border-[#232b45] bg-[#11172a] p-4">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[#8b94ad]">
          Görüşme kaydı ({calls.length})
        </h2>
        {calls.length === 0 ? (
          <p className="text-xs text-[#6b7592]">Henüz görüşme kaydı yok.</p>
        ) : (
          <ul className="space-y-3">
            {calls.map((c) => (
              <li key={c.id} className="border-b border-[#232b45] pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-[#e8ecf5]">
                    {CALL_RESULT_LABEL[c.result]}
                  </span>
                  <span className="text-[11px] tabular-nums text-[#6b7592]">
                    {fmtDateTime(c.calledAt)}
                  </span>
                </div>
                {c.notes ? (
                  <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-[#b8c0d4]">
                    {c.notes}
                  </p>
                ) : null}
                {c.nextFollowUpAt ? (
                  <p className="mt-1 text-[11px] text-[#8b94ad]">
                    Sonraki takip: {c.nextFollowUpAt.slice(0, 10)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {modalOpen ? (
        <CallModal leadId={leadId} company={company} phone={phone} onClose={() => setModalOpen(false)} />
      ) : null}
    </div>
  );
}
