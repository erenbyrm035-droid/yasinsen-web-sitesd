'use server';

import { revalidatePath } from 'next/cache';
import {
  closeOffer,
  createOffer,
  logCall,
  scheduleFollowUp,
  setSalesStatus,
  completeFollowUp,
} from '@/lib/db/repositories/sales';
import { isCallResult, isSalesStatus } from '@/lib/sales';

/**
 * Satis aksiyonlari.
 *
 * GUVENLIK NOTU: bu dosyada hicbir dis iletisim yoktur. E-posta, SMS,
 * WhatsApp ya da otomatik arama BASLATILMAZ. "Ara" butonu yalnizca
 * kullanicinin telefon uygulamasini acar; sistem kimseye kendiliginden
 * ulasmaz. Buradaki her islem kullanicinin acik bir tiklamasiyla baslar.
 */

export interface ActionState {
  ok: boolean;
  message: string;
}

function refresh(leadId: number): void {
  revalidatePath('/');
  revalidatePath('/leads');
  revalidatePath(`/leads/${leadId}`);
}

/** Gorusme kaydi. call_count YALNIZCA burada artar. */
export async function saveCallAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const leadId = Number(formData.get('leadId'));
  const result = String(formData.get('result') ?? '');
  const notes = String(formData.get('notes') ?? '');
  const followUp = String(formData.get('nextFollowUpAt') ?? '').trim();

  if (!Number.isInteger(leadId) || leadId <= 0) {
    return { ok: false, message: 'Geçersiz lead.' };
  }
  if (!isCallResult(result)) {
    return { ok: false, message: 'Görüşme sonucu seçilmeli.' };
  }

  try {
    logCall({
      leadId,
      result,
      notes: notes || null,
      nextFollowUpAt: followUp || null,
    });
    refresh(leadId);
    return {
      ok: true,
      message: followUp ? `Kaydedildi. Takip: ${followUp}` : 'Görüşme kaydedildi.',
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Kaydedilemedi.' };
  }
}

export async function setStatusAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const leadId = Number(formData.get('leadId'));
  const status = String(formData.get('status') ?? '');

  if (!Number.isInteger(leadId) || !isSalesStatus(status)) {
    return { ok: false, message: 'Geçersiz durum.' };
  }

  setSalesStatus(leadId, status);
  refresh(leadId);
  return { ok: true, message: 'Durum güncellendi.' };
}

export async function scheduleFollowUpAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const leadId = Number(formData.get('leadId'));
  const date = String(formData.get('scheduledAt') ?? '').trim();
  const notes = String(formData.get('notes') ?? '');

  if (!Number.isInteger(leadId) || !date) {
    return { ok: false, message: 'Takip tarihi seçilmeli.' };
  }

  scheduleFollowUp(leadId, date, notes || null);
  refresh(leadId);
  return { ok: true, message: `Takip planlandı: ${date}` };
}

export async function completeFollowUpAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const followUpId = Number(formData.get('followUpId'));
  const leadId = Number(formData.get('leadId'));
  if (!Number.isInteger(followUpId)) return { ok: false, message: 'Geçersiz takip.' };

  completeFollowUp(followUpId);
  refresh(leadId);
  return { ok: true, message: 'Takip tamamlandı.' };
}

export async function createOfferAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const leadId = Number(formData.get('leadId'));
  const service = String(formData.get('service') ?? '').trim();
  const amountRaw = String(formData.get('amount') ?? '').trim();
  const notes = String(formData.get('notes') ?? '');

  if (!Number.isInteger(leadId) || !service) {
    return { ok: false, message: 'Hizmet adı gerekli.' };
  }

  // Tutar girilmediyse NULL kalir — uydurma rakam yazilmaz.
  const amount = amountRaw === '' ? null : Number(amountRaw.replace(/[^\d.,]/g, '').replace(',', '.'));
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
    return { ok: false, message: 'Tutar geçersiz.' };
  }

  createOffer({ leadId, service, amount, notes: notes || null });
  refresh(leadId);
  return { ok: true, message: 'Teklif kaydedildi.' };
}

export async function closeOfferAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const offerId = Number(formData.get('offerId'));
  const leadId = Number(formData.get('leadId'));
  const outcome = String(formData.get('outcome') ?? '');

  if (!Number.isInteger(offerId) || (outcome !== 'WON' && outcome !== 'LOST')) {
    return { ok: false, message: 'Geçersiz sonuç.' };
  }

  closeOffer(offerId, outcome, String(formData.get('notes') ?? '') || null);
  refresh(leadId);
  return { ok: true, message: outcome === 'WON' ? 'Satış kazanıldı.' : 'Teklif kaybedildi.' };
}
