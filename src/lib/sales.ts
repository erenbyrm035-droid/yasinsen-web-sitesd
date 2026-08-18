/**
 * SATIS SURECI — durum makinesi ve etiketler.
 *
 * Pipeline durumu (leads.status) ile SATIS durumu (leads.sales_status) ayri
 * kavramlardir:
 *   status       -> sistem bu lead'i isledi mi (discovered/analyzed/scored)
 *   sales_status -> satis sureci nerede (NEW ... WON/LOST)
 *
 * Ikisini ayni kolona sikistirmak, yeniden analiz calistirmanin satis
 * gecmisini silmesi anlamina gelirdi.
 */

export const SALES_STATUSES = [
  'NEW',
  'READY_TO_CALL',
  'CALLED',
  'NO_ANSWER',
  'CALLBACK',
  'INTERESTED',
  'NOT_INTERESTED',
  'OFFER_SENT',
  'NEGOTIATION',
  'WON',
  'LOST',
  'DO_NOT_CONTACT',
] as const;

export type SalesStatus = (typeof SALES_STATUSES)[number];

export const SALES_STATUS_LABEL: Record<SalesStatus, string> = {
  NEW: 'Yeni',
  READY_TO_CALL: 'Aranacak',
  CALLED: 'Arandı',
  NO_ANSWER: 'Ulaşılamadı',
  CALLBACK: 'Geri aranacak',
  INTERESTED: 'İlgilendi',
  NOT_INTERESTED: 'İlgilenmedi',
  OFFER_SENT: 'Teklif Gönderildi',
  NEGOTIATION: 'Görüşme / Pazarlık',
  WON: 'Kazanıldı',
  LOST: 'Kaybedildi',
  DO_NOT_CONTACT: 'İletişim Kurma',
};

/** Sureci kapanmis lead'ler — gunluk arama listesine girmez. */
export const CLOSED_STATUSES: SalesStatus[] = ['WON', 'LOST', 'NOT_INTERESTED', 'DO_NOT_CONTACT'];

export function isClosed(status: SalesStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

export function isSalesStatus(value: string): value is SalesStatus {
  return (SALES_STATUSES as readonly string[]).includes(value);
}

// --- gorusme sonuclari ------------------------------------------------------

export const CALL_RESULTS = [
  'REACHED',
  'NO_ANSWER',
  'INTERESTED',
  'NOT_INTERESTED',
  'ASKED_OFFER',
  'CALLBACK',
  'WRONG_NUMBER',
] as const;

export type CallResult = (typeof CALL_RESULTS)[number];

export const CALL_RESULT_LABEL: Record<CallResult, string> = {
  REACHED: 'Ulaşıldı',
  NO_ANSWER: 'Ulaşılamadı',
  INTERESTED: 'İlgilendi',
  NOT_INTERESTED: 'İlgilenmedi',
  ASKED_OFFER: 'Teklif istedi',
  CALLBACK: 'Geri aranacak',
  WRONG_NUMBER: 'Yanlış numara',
};

export function isCallResult(value: string): value is CallResult {
  return (CALL_RESULTS as readonly string[]).includes(value);
}

/**
 * Gorusme sonucunun lead'i hangi satis durumuna tasidigi.
 *
 * Tek yer: hem UI hem sunucu ayni tabloyu kullanir, boylece ekranda gorunen
 * durum ile kaydedilen durum ayrisamaz.
 */
export const RESULT_TO_STATUS: Record<CallResult, SalesStatus> = {
  REACHED: 'CALLED',
  NO_ANSWER: 'NO_ANSWER',
  INTERESTED: 'INTERESTED',
  NOT_INTERESTED: 'NOT_INTERESTED',
  ASKED_OFFER: 'INTERESTED',
  CALLBACK: 'CALLBACK',
  WRONG_NUMBER: 'DO_NOT_CONTACT',
};

// --- zaman cizelgesi --------------------------------------------------------

export const EVENT_LABEL: Record<string, string> = {
  lead_discovered: 'Lead bulundu',
  website_audited: 'Website analiz edildi',
  social_audited: 'Sosyal medya analiz edildi',
  lead_scored: 'Skorlandı',
  status_changed: 'Durum değişti',
  call_logged: 'Arandı',
  follow_up_scheduled: 'Takip planlandı',
  follow_up_completed: 'Takip tamamlandı',
  offer_sent: 'Teklif gönderildi',
  offer_closed: 'Teklif kapatıldı',
};

/** Telefonu tel: URI icin normalize eder. Turkiye numaralarini +90'a cevirir. */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return `tel:${digits}`;
  if (digits.startsWith('0')) return `tel:+90${digits.slice(1)}`;
  if (digits.length === 10) return `tel:+90${digits}`;
  return `tel:${digits}`;
}
