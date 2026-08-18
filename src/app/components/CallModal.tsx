'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { saveCallAction, type ActionState } from '@/app/actions/sales';
import { CALL_RESULTS, CALL_RESULT_LABEL, type CallResult } from '@/lib/sales';

/**
 * "Arandı" paneli.
 *
 * Akis bilincli olarak iki adimli: once kullanici telefonla arar (Ara butonu
 * yalnizca telefon uygulamasini acar), sonra buraya sonucu girer. Boylece
 * arama sayaci tiklamalari degil gercek gorusmeleri sayar.
 */

/** Sonuc secilince mantikli bir takip tarihi onerilir — zorunlu degil. */
const SUGGESTED_DAYS: Partial<Record<CallResult, number>> = {
  NO_ANSWER: 1,
  CALLBACK: 3,
  INTERESTED: 3,
  ASKED_OFFER: 2,
};

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function CallModal({
  leadId,
  company,
  phone,
  onClose,
}: {
  leadId: number;
  company: string;
  phone: string | null;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    saveCallAction,
    null,
  );
  const [result, setResult] = useState<CallResult | ''>('');
  const [followUp, setFollowUp] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  // Basarili kayittan sonra panel kendiliginden kapanir.
  useEffect(() => {
    if (state?.ok) {
      const t = setTimeout(onClose, 700);
      return () => clearTimeout(t);
    }
  }, [state, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function pickResult(value: CallResult) {
    setResult(value);
    const days = SUGGESTED_DAYS[value];
    setFollowUp(days ? addDays(days) : '');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${company} görüşme kaydı`}
        className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-2xl border border-[#232b45] bg-[#11172a] p-5 shadow-2xl outline-none sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-[#e8ecf5]">Arama sonucu</h2>
            <p className="mt-0.5 text-sm text-[#8b94ad]">{company}</p>
            {phone ? <p className="mt-0.5 font-mono text-xs text-[#6b7592]">{phone}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-[#8b94ad] hover:bg-[#161d33]"
            aria-label="Kapat"
          >
            ✕
          </button>
        </div>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="result" value={result} />

          <fieldset>
            <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-[#8b94ad]">
              Görüşme sonucu
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {CALL_RESULTS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => pickResult(r)}
                  aria-pressed={result === r}
                  className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                    result === r
                      ? 'border-[#5b8cff] bg-[#5b8cff]/15 text-[#e8ecf5]'
                      : 'border-[#232b45] bg-[#161d33] text-[#b8c0d4] hover:border-[#313a5c]'
                  }`}
                >
                  {CALL_RESULT_LABEL[r]}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="notes" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b94ad]">
              Ne konuşuldu?
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={4}
              placeholder={'Örn. Web sitesi hakkında bilgi aldı.\nFiyat istedi.\nCuma günü tekrar aranacak.'}
              className="w-full resize-y rounded-lg border border-[#232b45] bg-[#0b0f19] px-3 py-2 text-sm text-[#e8ecf5] placeholder:text-[#4a536b] focus:border-[#5b8cff] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="nextFollowUpAt" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b94ad]">
              Sonraki takip <span className="normal-case text-[#4a536b]">(isteğe bağlı)</span>
            </label>
            <input
              id="nextFollowUpAt"
              name="nextFollowUpAt"
              type="date"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              className="w-full rounded-lg border border-[#232b45] bg-[#0b0f19] px-3 py-2 text-sm text-[#e8ecf5] focus:border-[#5b8cff] focus:outline-none"
            />
          </div>

          {state ? (
            <p className={`text-sm ${state.ok ? 'text-[#7ee8a5]' : 'text-[#ff8b81]'}`} role="status">
              {state.message}
            </p>
          ) : null}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={pending || result === ''}
              className="flex-1 rounded-lg bg-[#5b8cff] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#4a7bee] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#232b45] px-4 py-2.5 text-sm text-[#b8c0d4] hover:bg-[#161d33]"
            >
              Vazgeç
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
