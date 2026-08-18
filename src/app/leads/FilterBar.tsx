'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { SALES_STATUSES, SALES_STATUS_LABEL } from '@/lib/sales';

/**
 * Filtre cubugu. Durum URL'de tutulur — "aranmadı + purchase > 70" gibi bir
 * gunluk arama listesi yer imine eklenebilir.
 */

const SELECT =
  'rounded-lg border border-[#232b45] bg-[#0b0f19] px-2.5 py-1.5 text-sm text-[#e8ecf5] focus:border-[#5b8cff] focus:outline-none';

export function FilterBar({
  segments,
  districts,
  resultCount,
  total,
}: {
  segments: string[];
  districts: string[];
  resultCount: number;
  total: number;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`/leads?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const value = (key: string) => params.get(key) ?? '';
  const hasFilters = [...params.keys()].length > 0;

  return (
    <div className="mb-4 rounded-xl border border-[#232b45] bg-[#11172a] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="İşletme, ilçe, telefon ara…"
          defaultValue={value('q')}
          onChange={(e) => setParam('q', e.target.value)}
          className={`${SELECT} min-w-[200px] flex-1`}
          aria-label="Ara"
        />

        <select className={SELECT} value={value('priority')} onChange={(e) => setParam('priority', e.target.value)} aria-label="Öncelik">
          <option value="">Tüm öncelikler</option>
          <option value="HOT">🔥 HOT</option>
          <option value="HIGH">🟢 HIGH</option>
          <option value="MEDIUM">🟡 MEDIUM</option>
          <option value="LOW">🔴 LOW</option>
        </select>

        <select className={SELECT} value={value('status')} onChange={(e) => setParam('status', e.target.value)} aria-label="Satış durumu">
          <option value="">Tüm durumlar</option>
          {SALES_STATUSES.map((s) => (
            <option key={s} value={s}>{SALES_STATUS_LABEL[s]}</option>
          ))}
        </select>

        <select className={SELECT} value={value('segment')} onChange={(e) => setParam('segment', e.target.value)} aria-label="Kategori">
          <option value="">Tüm kategoriler</option>
          {segments.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select className={SELECT} value={value('district')} onChange={(e) => setParam('district', e.target.value)} aria-label="İlçe">
          <option value="">Tüm ilçeler</option>
          {districts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>

        <select className={SELECT} value={value('called')} onChange={(e) => setParam('called', e.target.value)} aria-label="Arama durumu">
          <option value="">Arandı / aranmadı</option>
          <option value="no">Hiç aranmadı</option>
          <option value="yes">Arandı</option>
        </select>

        <select className={SELECT} value={value('followUp')} onChange={(e) => setParam('followUp', e.target.value)} aria-label="Takip">
          <option value="">Takip (hepsi)</option>
          <option value="due">Takip zamanı geldi</option>
          <option value="none">Takip planlanmamış</option>
        </select>

        <select className={SELECT} value={value('offer')} onChange={(e) => setParam('offer', e.target.value)} aria-label="Teklif">
          <option value="">Teklif (hepsi)</option>
          <option value="sent">Teklif gönderildi</option>
          <option value="none">Teklif yok</option>
        </select>

        <select className={SELECT} value={value('minPurchase')} onChange={(e) => setParam('minPurchase', e.target.value)} aria-label="Purchase score alt sınırı">
          <option value="">Purchase (hepsi)</option>
          <option value="80">≥ 80</option>
          <option value="70">≥ 70</option>
          <option value="65">≥ 65</option>
          <option value="50">≥ 50</option>
        </select>

        {hasFilters ? (
          <button
            type="button"
            onClick={() => router.replace('/leads', { scroll: false })}
            className="rounded-lg border border-[#232b45] px-2.5 py-1.5 text-sm text-[#8b94ad] hover:bg-[#161d33]"
          >
            Temizle
          </button>
        ) : null}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-[#6b7592]">
        <span>
          <b className="text-[#b8c0d4]">{resultCount}</b> / {total} lead
        </span>
        <button
          type="button"
          onClick={() => router.replace('/leads?called=no&minPurchase=65', { scroll: false })}
          className="text-[#5b8cff] underline-offset-4 hover:underline"
        >
          Hazır filtre: aranmadı + purchase ≥ 65
        </button>
        <span className="text-[#4a536b]">
          Skor filtreleri ölçülemeyen lead&apos;leri eler — &ldquo;ölçülemedi&rdquo; düşük skor sayılmaz.
        </span>
      </div>
    </div>
  );
}
