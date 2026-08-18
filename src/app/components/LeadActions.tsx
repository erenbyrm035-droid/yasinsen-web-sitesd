'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CallModal } from './CallModal';
import { telHref } from '@/lib/sales';

/**
 * Satir ici hizli aksiyonlar: Ara / Arandı / Detay.
 *
 * "Ara" telefon uygulamasini acar ve sayaci ARTIRMAZ.
 * "Arandı" paneli acar; sayac orada, kullanicinin onayiyla artar.
 */
export function LeadActions({
  leadId,
  company,
  phone,
  compact = false,
}: {
  leadId: number;
  company: string;
  phone: string | null;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyPhone() {
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const size = compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm';

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {phone ? (
        <>
          <a
            href={telHref(phone)}
            className={`inline-flex items-center gap-1 rounded-lg bg-[#5b8cff] font-medium text-white hover:bg-[#4a7bee] ${size}`}
            title={`${phone} — telefon uygulamasını açar`}
          >
            📞 Ara
          </a>
          {/* Masaustunde tel: link ise yaramayabilir; numara kopyalanabilmeli. */}
          <button
            type="button"
            onClick={copyPhone}
            className={`hidden rounded-lg border border-[#232b45] text-[#b8c0d4] hover:bg-[#161d33] sm:inline-flex ${size}`}
            title="Numarayı kopyala"
          >
            {copied ? '✓' : '⧉'}
          </button>
        </>
      ) : (
        <span className="text-xs text-[#6b7592]">telefon yok</span>
      )}

      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded-lg border border-[#4ade80]/40 bg-[#4ade80]/10 font-medium text-[#7ee8a5] hover:bg-[#4ade80]/20 ${size}`}
      >
        Arandı
      </button>

      <Link
        href={`/leads/${leadId}`}
        className={`rounded-lg border border-[#232b45] text-[#b8c0d4] hover:bg-[#161d33] ${size}`}
      >
        Detay
      </Link>

      {open ? (
        <CallModal leadId={leadId} company={company} phone={phone} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}
