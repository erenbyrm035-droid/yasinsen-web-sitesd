'use client';

import { useActionState } from 'react';
import { saveManualSocial, type ManualSocialFormState } from './actions';
import type { SocialPlatform } from '@/lib/types';
import type { StoredSocialManualInput } from '@/lib/db/repositories/social-manual';

/**
 * Instagram login duvarini asmanin anahtarsiz yolu: metrikler elle girilir.
 * Kaydedildiginde lead aninda yeniden skorlanir.
 *
 * Bos birakilan her alan `null` kalir ve skorlamada HESABA KATILMAZ —
 * "girilmedi" asla "kotu" anlamina gelmez.
 */

const PLATFORMS: { value: SocialPlatform; label: string }[] = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'tiktok', label: 'TikTok' },
];

const initialState: ManualSocialFormState = { ok: false, message: '' };

export function ManualSocialForm({
  companyId,
  leadId,
  platform,
  existing,
}: {
  companyId: number;
  leadId: number;
  platform: SocialPlatform;
  existing: StoredSocialManualInput | null;
}) {
  const [state, formAction, pending] = useActionState(saveManualSocial, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="leadId" value={leadId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Platform">
          <select
            name="platform"
            defaultValue={existing?.platform ?? platform}
            className="w-full rounded-md border border-[#232b45] bg-[#0e1424] px-2.5 py-1.5 text-sm text-[#e8ecf5] outline-none focus:border-[#5b8cff]"
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <NumberField
          name="followers"
          label="Takipçi sayısı"
          defaultValue={existing?.followers}
          placeholder="örn. 3200"
        />
        <NumberField
          name="postsLast30d"
          label="Son 30 günde paylaşım"
          defaultValue={existing?.postsLast30d}
          placeholder="örn. 12"
        />
        <NumberField
          name="reelsLast30d"
          label="Son 30 günde Reels/video"
          defaultValue={existing?.reelsLast30d}
          placeholder="örn. 4"
        />
        <NumberField
          name="avgLikes"
          label="Ortalama beğeni"
          defaultValue={existing?.avgLikes}
          placeholder="örn. 85"
          hint="Takipçi ile birlikte etkileşim oranını verir"
        />
        <NumberField
          name="visualQuality"
          label="Görsel kalite (1–5)"
          defaultValue={existing?.visualQuality}
          placeholder="1–5"
          min={1}
          max={5}
        />
        <NumberField
          name="salesContent"
          label="Satışa yönelik içerik (1–5)"
          defaultValue={existing?.salesContent}
          placeholder="1–5"
          min={1}
          max={5}
        />

        <TristateField
          name="bioHasWebsite"
          label="Bio'da site linki"
          defaultValue={existing?.bioHasWebsite}
        />
        <TristateField
          name="bioHasContact"
          label="Bio'da iletişim bilgisi"
          defaultValue={existing?.bioHasContact}
        />
      </div>

      <Field label="Not (opsiyonel)">
        <textarea
          name="note"
          rows={2}
          defaultValue={existing?.note ?? ''}
          placeholder="Gözlemleriniz — skoru etkilemez, sadece kayıt için"
          className="w-full resize-y rounded-md border border-[#232b45] bg-[#0e1424] px-2.5 py-1.5 text-sm text-[#e8ecf5] outline-none placeholder:text-[#4a536b] focus:border-[#5b8cff]"
        />
      </Field>

      <Field label="Giren kişi (opsiyonel)">
        <input
          type="text"
          name="enteredBy"
          defaultValue={existing?.enteredBy ?? ''}
          placeholder="isim"
          className="w-full rounded-md border border-[#232b45] bg-[#0e1424] px-2.5 py-1.5 text-sm text-[#e8ecf5] outline-none placeholder:text-[#4a536b] focus:border-[#5b8cff]"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[#5b8cff] px-4 py-2 text-sm font-medium text-[#0b0f19] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Kaydediliyor…' : 'Kaydet ve yeniden skorla'}
        </button>
        {existing && (
          <span className="text-xs text-[#6b7592]">
            Son güncelleme: {existing.updatedAt}
            {existing.enteredBy ? ` · ${existing.enteredBy}` : ''}
          </span>
        )}
      </div>

      {state.message && (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            state.ok
              ? 'bg-[#4ade80]/10 text-[#86efac] ring-1 ring-[#4ade80]/25'
              : 'bg-[#ff5a4d]/10 text-[#ff8b81] ring-1 ring-[#ff5a4d]/25'
          }`}
        >
          {state.message}
        </p>
      )}

      <p className="text-xs leading-relaxed text-[#6b7592]">
        Boş bıraktığınız alanlar skorlamaya girmez — &quot;girilmedi&quot; ile &quot;kötü&quot;
        birbirinden ayrı tutulur. Tüm metrik alanlarını boşaltıp kaydederseniz manuel veri
        silinir ve skor otomatik sinyallere döner.
      </p>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[#8b94ad]">{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  name,
  label,
  defaultValue,
  placeholder,
  hint,
  min = 0,
  max,
}: {
  name: string;
  label: string;
  defaultValue?: number | null;
  placeholder?: string;
  hint?: string;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[#8b94ad]">{label}</span>
      <input
        type="number"
        name={name}
        min={min}
        max={max}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        className="w-full rounded-md border border-[#232b45] bg-[#0e1424] px-2.5 py-1.5 text-sm text-[#e8ecf5] outline-none placeholder:text-[#4a536b] focus:border-[#5b8cff]"
      />
      {hint && <span className="mt-1 block text-xs text-[#4a536b]">{hint}</span>}
    </label>
  );
}

function TristateField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue?: boolean | null;
}) {
  const value = defaultValue === true ? 'yes' : defaultValue === false ? 'no' : '';
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[#8b94ad]">{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="w-full rounded-md border border-[#232b45] bg-[#0e1424] px-2.5 py-1.5 text-sm text-[#e8ecf5] outline-none focus:border-[#5b8cff]"
      >
        <option value="">girilmedi</option>
        <option value="yes">var</option>
        <option value="no">yok</option>
      </select>
    </label>
  );
}
