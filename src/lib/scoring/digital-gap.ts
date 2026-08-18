import type { AuditConfidence, ScoreBreakdown, SocialConfidence } from '../types';

/**
 * DIGITAL GAP (0-100) — ya da olculemediyse null.
 *
 * "Bu isletmenin dijital varliginda ne kadar bosluk var?" — yani bizim
 * doldurabilecegimiz alan. Yuksek gap = satilacak cok is var.
 *
 * Temel formul:  gap = 100 − (wWeb · websiteScore + wSocial · socialScore)
 *
 * ANA KURAL: OLCULEMEYEN BILESEN SIFIR SAYILMAZ.
 * Bir bilesenin skoru null ise agirligi diger bilesene devredilir; ikisi de
 * null ise gap null doner. Aksi halde "olcemedik" otomatik olarak "gap 100,
 * devasa firsat" haline gelirdi — ki bu tam olarak MACFit vakasinda olan
 * seydi: bot korumasi yuzunden okunamayan site "kotu site" sanilmisti.
 *
 * Ayrica agirliklar GUVENE gore ayarlanir: dusuk guvenli bir olcum, yuksek
 * guvenli olcum kadar soz sahibi olmamalidir.
 */

const BASE_WEIGHTS = { website: 0.6, social: 0.4 } as const;

/** Guven seviyesine gore agirlik carpani. */
const CONFIDENCE_FACTOR: Record<AuditConfidence, number> = {
  none: 0, // hic olculebilir sinyal yok -> hesaba katilmaz
  low: 0.5, // yalnizca sinyal bazli (sosyalin bugunku durumu)
  medium: 0.8,
  high: 1,
};

export interface DigitalGapResult {
  /** Hicbir dijital sinyal olculemediyse null. */
  gap: number | null;
  detail: ScoreBreakdown['digitalGap'];
}

export function computeDigitalGap(
  websiteScore: number | null,
  socialScore: number | null,
  socialConfidence: SocialConfidence,
  websiteConfidence: AuditConfidence = 'high',
): DigitalGapResult {
  const websiteFactor = websiteScore === null ? 0 : CONFIDENCE_FACTOR[websiteConfidence];
  const socialFactor = socialScore === null ? 0 : CONFIDENCE_FACTOR[socialConfidence];

  /**
   * Sosyal skor TEK BASINA gap belirleyebilir mi?
   *
   * Hayir — yalnizca gercekten olculmus veriyse. Bugunku otomatik sosyal
   * denetim 'low' guvenle calisir (sitede link var mi, profil aciliyor mu);
   * bu, website hic okunamadigi bir durumda tek karar dayanagi olamayacak
   * kadar zayiftir. Elle girilmis metrik ('medium'/'high') ise olabilir.
   */
  const socialUsableAlone =
    socialScore !== null && (socialConfidence === 'medium' || socialConfidence === 'high');

  if (websiteScore === null && !socialUsableAlone) {
    return {
      gap: null,
      detail: {
        websiteWeight: 0,
        socialWeight: 0,
        socialConfidence,
        websiteConfidence,
        unmeasurable: true,
        formula:
          'Dijital açık hesaplanamadı: website ölçülemedi ve elde güvenilir sosyal ' +
          'ölçüm yok. Eksik veri "açık büyük" anlamına gelmez — bu lead elle incelenmeli.',
      },
    };
  }

  /**
   * Agirliklandirma.
   *
   * Once eski davranis korunur: sosyalin guven indirimi kadar agirlik
   * website'a devredilir (website guveni tam oldugunda toplam tam 1 kalir,
   * yani hali hazirda dogru olculmus lead'lerin skoru DEGISMEZ).
   *
   * Ardindan website'in kendi guveni uygulanir: denetim maddelerinin cogu
   * olculemediyse website'in sozu de azalir ve pay sosyale kayar.
   */
  const rawSocial = BASE_WEIGHTS.social * socialFactor;
  const rawWebsite = (1 - rawSocial) * websiteFactor;
  const total = rawWebsite + rawSocial;

  if (total === 0) {
    return {
      gap: null,
      detail: {
        websiteWeight: 0,
        socialWeight: 0,
        socialConfidence,
        websiteConfidence,
        unmeasurable: true,
        formula: 'Dijital açık hesaplanamadı: ölçülebilir hiçbir dijital sinyal yok.',
      },
    };
  }

  const websiteWeight = rawWebsite / total;
  const socialWeight = rawSocial / total;

  const combined = websiteWeight * (websiteScore ?? 0) + socialWeight * (socialScore ?? 0);
  const gap = Math.round(Math.max(0, Math.min(100, 100 - combined)));

  const parts: string[] = [];
  if (websiteWeight > 0) parts.push(`website(${websiteScore}) · ${websiteWeight.toFixed(2)}`);
  if (socialWeight > 0) parts.push(`social(${socialScore}) · ${socialWeight.toFixed(2)}`);

  const notes: string[] = [];
  if (websiteScore === null) {
    notes.push("website ölçülemedi, ağırlık tamamen ölçülmüş sosyal veriye devredildi");
  } else if (websiteConfidence !== 'high') {
    notes.push(`website güveni "${websiteConfidence}" — ağırlığı düşürüldü`);
  }
  if (socialScore === null) {
    notes.push("ölçülebilir sosyal sinyal yok, ağırlığı website'a devredildi");
  } else if (socialConfidence !== 'high') {
    notes.push(`sosyal güven "${socialConfidence}" — ağırlığı düşürüldü`);
  }

  return {
    gap,
    detail: {
      websiteWeight: Number(websiteWeight.toFixed(2)),
      socialWeight: Number(socialWeight.toFixed(2)),
      socialConfidence,
      websiteConfidence,
      unmeasurable: false,
      formula:
        `gap = 100 − (${parts.join(' + ')}) = ${gap}` +
        (notes.length > 0 ? `; ${notes.join('; ')}` : ''),
    },
  };
}
