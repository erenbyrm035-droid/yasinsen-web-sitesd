import type { AuditCheck } from './types';

/**
 * ARAMA BRIFINGI — "bu işletmeyi arayınca ne yapacağım?"
 *
 * Skor bir lead'i siraya koyar ama telefonu elinize aldiginizda ne
 * soyleyeceginizi soylemez. Bu modul, elde OLCULMUS olan seylerden bir
 * konusma plani cikarir.
 *
 * TEK KURAL: her cumle bir olcume dayanir.
 * Olculemeyen site icin "siteniz kotu" denmez — "bakamadik, once siz bakin"
 * denir. Uydurma bir acilis cumlesi, ilk 10 saniyede guveni yok eder:
 * karsi taraf sitesinin iyi oldugunu bilir.
 */

export interface BriefInput {
  name: string;
  segment: string | null;
  district: string | null;
  rating: number | null;
  reviewCount: number | null;
  hasWebsite: boolean;
  websiteScore: number | null;
  websiteStatus: string;
  websiteReason: string | null;
  socialScore: number | null;
  socialUrl: string | null;
  offerLabel: string | null;
  offerRationale: string | null;
  checks: AuditCheck[];
  callCount?: number;
  lastCallResult?: string | null;
  lastCallNotes?: string | null;
}

export interface Brief {
  /** Tek cumlelik durum ozeti. */
  headline: string;
  /** Aramaya nasil baslanir — gozleme dayali, iltifat degil. */
  opening: string;
  /** Kanitiyla birlikte konusulacak maddeler. */
  findings: { label: string; evidence: string }[];
  /** Ne satilir ve neden. */
  pitch: string | null;
  /** Karsi tarafi konusturacak sorular. */
  questions: string[];
  /** Uyarilar — soylenmemesi gerekenler. */
  cautions: string[];
}

/**
 * Tekil ve COGUL ayri tutulur.
 *
 * Turkce cogul eki unlu uyumuna ve kelimenin son harfine gore degisiyor;
 * `${seg}leri` gibi bir birlestirme "spor salonuleri" uretiyordu. Ek
 * turetmeye calismak yerine dogru bicim dogrudan yazildi.
 */
const SEGMENT_WORD: Record<string, { one: string; many: string }> = {
  gym: { one: 'spor salonu', many: 'spor salonları' },
  boutique_gym: { one: 'butik salon', many: 'butik salonlar' },
  pilates_studio: { one: 'pilates stüdyosu', many: 'pilates stüdyoları' },
  crossfit_box: { one: 'CrossFit salonu', many: 'CrossFit salonları' },
  martial_arts: { one: 'dövüş sporları salonu', many: 'dövüş sporları salonları' },
  personal_training: { one: 'kişisel antrenman stüdyosu', many: 'kişisel antrenman stüdyoları' },
  fitness_other: { one: 'fitness işletmesi', many: 'fitness işletmeleri' },
};

/** Denetim maddesinin satista karsiligi olan somut soru. */
const QUESTION_BY_CHECK: Record<string, string> = {
  booking: 'Şu anda randevuları nasıl alıyorsunuz — telefonla mı, WhatsApp\'tan mı?',
  membership: 'Üyelik satışı yüz yüze mi oluyor, online ödeme alabiliyor musunuz?',
  pricing: 'Fiyatlarınızı sitede paylaşmama tercihiniz mi, yoksa hiç eklenmedi mi?',
  whatsapp: 'İnsanlar size en çok hangi kanaldan ulaşıyor?',
  seoBasics: 'Google\'da "' + '{ilçe} pilates" aratınca kaçıncı sırada çıkıyorsunuz, hiç baktınız mı?',
  cta: 'Siteye gelen biri deneme dersi almak isterse ne yapıyor?',
  conversion: 'Siteye gelen ziyaretçilerin kaçı size ulaşıyor, ölçebiliyor musunuz?',
  performance: 'Siteniz telefonda size de yavaş açılıyor mu?',
  mobileViewport: 'Müşterileriniz siteye çoğunlukla telefondan mı giriyor?',
  trust: 'Yeni gelen üyeler size nasıl güveniyor — tavsiye mi, Google yorumları mı?',
};

/**
 * Kisaltmalar cumle icinde kucultulmez: "seo temel durumu" ozensiz okunur.
 * Etiketin ilk kelimesi tamami buyuk harfse (SEO, CTA) oldugu gibi birakilir.
 */
function softenLabel(label: string): string {
  return label
    .split(' ')
    .map((w) => (w.length > 1 && w === w.toUpperCase() && /[A-ZÇĞİÖŞÜ]/.test(w) ? w : w.toLowerCase()))
    .join(' ')
    .replace(/\s*\([^)]*\)/, '');
}

/**
 * Kismen gecen maddelerde kanit metni BULUNANLARI listeler ("Bulunan: adres").
 * Brifingde bu, olumlu bir bulgu gibi okunuyordu. Oranini yazip "kismen"
 * diyerek durumu oldugu gibi anlatiyoruz.
 */
function describeGap(check: AuditCheck): string {
  if (check.ratio !== null && check.ratio > 0 && /^Bulunan:/i.test(check.evidence)) {
    const pct = Math.round(check.ratio * 100);
    return `kısmen var (%${pct}) — ${check.evidence.replace(/^Bulunan:\s*/i, 'yalnızca ')}`;
  }
  return check.evidence;
}

/** Yorum sayisi bir isletmenin gercek musteri hacminin en iyi gostergesi. */
function volumeNote(reviews: number | null, rating: number | null): string | null {
  if (reviews === null || reviews < 30) return null;
  const strong = rating !== null && rating >= 4.5;
  if (reviews >= 300) {
    return `${reviews} Google yorumu${strong ? ` ve ${rating} puan` : ''} — bölgesinde oturmuş bir işletme`;
  }
  return `${reviews} Google yorumu${strong ? ` ve ${rating} puan` : ''} — düzenli müşteri akışı var`;
}

export function buildBrief(input: BriefInput): Brief {
  /**
   * TUTARLILIK KORUMASI
   *
   * Gercek vaka: telefon surumunde `hasWebsite` yanlis alandan okunuyordu ve
   * sitesi olan bir isletme icin brifing "web siteniz cikmiyor" diyordu.
   * Skor 45'ti, ekranda "Website ↗" linki duruyordu — yani veri dogruydu,
   * yalnizca bu fonksiyona yanlis tasinmisti.
   *
   * Boyle bir celiski musteriye soylenirse guveni bitirir. Girdiler kendi
   * icinde celisiyorsa OLCULEN veri kazanir: skor ya da denetim durumu bir
   * site oldugunu gosteriyorsa, hasWebsite dogru kabul edilir.
   */
  const websiteEvidence =
    input.websiteScore !== null || (input.websiteStatus !== 'no_website' && input.websiteStatus !== 'ok');
  const hasWebsite = input.hasWebsite || (websiteEvidence && input.websiteStatus !== 'no_website');
  input = { ...input, hasWebsite };

  const segWord = SEGMENT_WORD[input.segment ?? ''] ?? { one: 'işletme', many: 'işletmeler' };
  const seg = segWord.one;
  const place = input.district ?? 'İstanbul';
  const volume = volumeNote(input.reviewCount, input.rating);
  const cautions: string[] = [];
  const questions: string[] = [];

  // --- Olculemeyen site: iddia YOK ----------------------------------------
  const unmeasured =
    input.websiteScore === null && input.websiteStatus !== 'no_website' && input.hasWebsite;

  if (unmeasured) {
    cautions.push(
      'Sitesi otomatik denetlenemedi (' +
        (input.websiteReason ?? 'erişilemedi') +
        '). Site büyük olasılıkla sorunsuz çalışıyor — ARAMADAN ÖNCE tarayıcıda açıp bakın. ' +
        '"Sitenizde şu eksik" demeyin; elimizde ölçüm yok.',
    );
  }

  // --- Baslik ---------------------------------------------------------------
  let headline: string;
  if (!input.hasWebsite) {
    headline = volume
      ? `Sitesi olmayan, müşterisi olan bir ${seg}. ${volume}.`
      : `${place} bölgesinde web sitesi olmayan bir ${seg}.`;
  } else if (unmeasured) {
    headline = `Sitesi var ama denetlenemedi. ${volume ?? 'Aramadan önce elle bakılmalı.'}`;
  } else if ((input.websiteScore ?? 0) < 55) {
    headline = `Sitesi var ama zayıf (${input.websiteScore}/100). ${volume ?? ''}`.trim();
  } else {
    headline = `Sitesi yeterli seviyede (${input.websiteScore}/100). ${volume ?? ''}`.trim();
  }

  // --- Acilis ---------------------------------------------------------------
  let opening: string;
  if (!input.hasWebsite) {
    opening = volume
      ? `"${place}'de ${seg} arayınca sizi buluyorum, ${input.reviewCount} yorumunuz var — ama web siteniz çıkmıyor. Şu an yeni üye nereden geliyor?"`
      : `"${place}'de ${seg} arıyordum, Google'da sizi gördüm ama web siteniz yok. Bu bilinçli bir tercih mi?"`;
  } else if (unmeasured) {
    opening =
      '"' +
      `${place}'deki ${segWord.many}nı inceliyordum, sizin sitenize de baktım." ` +
      '(Aramadan önce siteyi gerçekten açın — somut bir gözlemle devam edin.)';
  } else {
    const worst = input.checks
      .filter((c) => c.passed === false)
      .sort((a, b) => b.weight - a.weight)[0];
    opening = worst
      ? `"Sitenize baktım — ${softenLabel(worst.label)} tarafı eksik görünüyor. Bu sizin için sorun oluyor mu?"`
      : `"Sitenize baktım, temeller yerinde. Asıl merak ettiğim, siteden ne kadar üye geliyor?"`;
  }

  // --- Bulgular: YALNIZCA olculmus olanlar ---------------------------------
  const findings = unmeasured || !input.hasWebsite
    ? []
    : input.checks
        .filter((c) => c.passed === false)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 4)
        .map((c) => ({ label: c.label, evidence: describeGap(c) }));

  // --- Sorular --------------------------------------------------------------
  if (!input.hasWebsite) {
    // Sitesi olmayan isletmede denetim maddelerini tek tek saymak anlamsiz:
    // hepsi ayni seyi soyler. Bulgu listesi bos birakilir, durum baslikta.
    questions.push('Şu anda yeni üyeleriniz ağırlıkla nereden geliyor?');
    questions.push('Daha önce web sitesi yaptırmayı düşündünüz mü, neden vazgeçtiniz?');
    questions.push('Randevu ve üyelik işlemlerini şu an nasıl yürütüyorsunuz?');
  } else {
    for (const c of input.checks.filter((x) => x.passed === false)) {
      const q = QUESTION_BY_CHECK[c.key];
      if (q && questions.length < 3) {
        questions.push(q.replace('{ilçe}', place));
      }
    }
    if (questions.length === 0) {
      questions.push('Siteden ayda kaç kişi size ulaşıyor?');
      questions.push('Sitenizi en son ne zaman güncellediniz?');
    }
  }
  if (input.socialUrl && (input.socialScore ?? 0) >= 60) {
    questions.push('Sosyal medyadan gelen ilgi üyeliğe dönüşüyor mu, takip edebiliyor musunuz?');
  }

  // --- Uyarilar -------------------------------------------------------------
  if (input.socialScore === null && !input.socialUrl) {
    cautions.push(
      'Sosyal medya hesabı bulunamadı — ama ARANMADI da. "Sosyal medyanız yok" demeyin; ' +
        'aramadan önce Instagram\'da işletme adını aratın.',
    );
  }
  if (input.callCount && input.callCount > 0) {
    cautions.push(
      `Bu işletme daha önce ${input.callCount} kez arandı` +
        (input.lastCallNotes ? `. Son not: "${input.lastCallNotes.split('\n')[0]}"` : '.'),
    );
  }

  return {
    headline,
    opening,
    findings,
    pitch: input.offerLabel
      ? `${input.offerLabel}${input.offerRationale ? ` — ${input.offerRationale.replace(/^\[[^\]]+\]\s*/, '')}` : ''}`
      : null,
    questions: questions.slice(0, 4),
    cautions,
  };
}
