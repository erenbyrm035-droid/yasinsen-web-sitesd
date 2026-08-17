'use server';

import { revalidatePath } from 'next/cache';
import { initSchema } from '@/lib/db/client';
import { upsertManualInput, deleteManualInput } from '@/lib/db/repositories/social-manual';
import { rescoreCompanyById } from '@/lib/scoring/score-company';
import type { SocialPlatform } from '@/lib/types';

/**
 * Elle girilen sosyal medya metriklerini kaydeder ve lead'i yeniden skorlar.
 *
 * Bu sistemdeki TEK yazma islemidir ve yalnizca kullanicinin kendi girdigi
 * arastirma notlarini kaydeder — hicbir dis servise veri gondermez.
 */

const PLATFORMS: SocialPlatform[] = ['instagram', 'facebook', 'youtube', 'tiktok'];

/** Bos string -> null. Sayi degilse null. Negatif degerler reddedilir. */
function parseNumber(value: FormDataEntryValue | null, max?: number): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number.parseInt(value.trim(), 10);
  if (Number.isNaN(n) || n < 0) return null;
  if (max !== undefined && n > max) return max;
  return n;
}

/** Uc durumlu secim: '' -> null (girilmedi), 'yes' -> true, 'no' -> false. */
function parseTristate(value: FormDataEntryValue | null): boolean | null {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

function parseText(value: FormDataEntryValue | null, maxLength = 500): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, maxLength);
}

export interface ManualSocialFormState {
  ok: boolean;
  message: string;
}

export async function saveManualSocial(
  _prev: ManualSocialFormState,
  formData: FormData,
): Promise<ManualSocialFormState> {
  initSchema();

  const companyId = parseNumber(formData.get('companyId'));
  const leadId = parseNumber(formData.get('leadId'));
  const platformRaw = formData.get('platform');

  if (companyId === null || leadId === null) {
    return { ok: false, message: 'Geçersiz şirket bilgisi.' };
  }
  if (typeof platformRaw !== 'string' || !PLATFORMS.includes(platformRaw as SocialPlatform)) {
    return { ok: false, message: 'Geçersiz platform.' };
  }
  const platform = platformRaw as SocialPlatform;

  const input = {
    followers: parseNumber(formData.get('followers')),
    postsLast30d: parseNumber(formData.get('postsLast30d')),
    reelsLast30d: parseNumber(formData.get('reelsLast30d')),
    avgLikes: parseNumber(formData.get('avgLikes')),
    visualQuality: parseNumber(formData.get('visualQuality'), 5),
    salesContent: parseNumber(formData.get('salesContent'), 5),
    bioHasWebsite: parseTristate(formData.get('bioHasWebsite')),
    bioHasContact: parseTristate(formData.get('bioHasContact')),
    note: parseText(formData.get('note')),
    enteredBy: parseText(formData.get('enteredBy'), 80),
  };

  const hasMetric = Object.entries(input).some(
    ([key, value]) => key !== 'note' && key !== 'enteredBy' && value !== null,
  );

  if (!hasMetric) {
    // Tum metrik alanlari bosaltildiysa kayit silinir — sosyal skor otomatik
    // sinyallere geri doner.
    deleteManualInput(companyId, platform);
    rescoreCompanyById(companyId);
    revalidatePath(`/leads/${leadId}`);
    revalidatePath('/');
    return { ok: true, message: 'Manuel veri silindi, skor otomatik sinyallere döndü.' };
  }

  upsertManualInput(companyId, platform, input);

  const result = rescoreCompanyById(companyId);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/');

  if (!result) {
    return {
      ok: true,
      message: 'Veri kaydedildi. Skor için önce website denetimi çalıştırılmalı.',
    };
  }

  return {
    ok: true,
    message:
      `Kaydedildi. Purchase score: ${result.score.purchaseScore} (${result.score.priority}) · ` +
      `sosyal skor: ${result.score.socialScore ?? '—'} · teklif: ${result.offer.offerLabel}`,
  };
}
