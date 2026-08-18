import type { OfferCode } from '../types';

/**
 * OFFER ENGINE — kural tablosu.
 *
 * Tum teklif mantigi BU TABLODADIR. Bir kurali degistirmek icin tek satir
 * duzenlemek yeterlidir; motor (engine.ts) yalnizca tabloyu sirayla dener ve
 * ILK ESLESEN kurali uygular.
 *
 * NOT — sartname ornegindeki bilincli sapma (R4):
 *   Sartname "Website 42 / Social 81 → Social Media" diyordu.
 *   Kullanici onayiyla bu kural TERS CEVRILDI: artik ayni durum "Website"
 *   onerir. Gerekce: sosyalde zaten guclu olan bir isletmenin darbogazi
 *   trafigin indigi yerdir — zayif site, sosyalden gelen ilgiyi uyeye
 *   cevirmeden kaybeder. Once o zemin duzeltilir.
 *   Geri almak icin yalnizca R4'un `offer` alani 'C' yapilir.
 */

export const OFFER_LABELS: Record<OfferCode, string> = {
  A: 'Website',
  B: 'Website + Social Media',
  C: 'Social Media',
  D: 'Website + Automation',
  E: 'Custom Software',
  F: 'Ads / Conversion Optimization',
  G: 'No Offer',
};

export interface OfferRuleContext {
  /** null = site denetlenemedi (bot korumasi / HTTP hatasi). Sifir DEGIL. */
  websiteScore: number | null;
  /** null = olculebilir sosyal sinyal yok. */
  socialScore: number | null;
  /** null = dijital acik hesaplanamadi. */
  digitalGap: number | null;
  businessPotential: number;
  hasWebsite: boolean;
  hasSocialPresence: boolean;
  hasPhone: boolean;
  hasBooking: boolean;
  hasMembership: boolean;
  employeeCount: number | null;
  isInstitutional: boolean;
}

export interface OfferRule {
  id: string;
  description: string;
  matches: (ctx: OfferRuleContext) => boolean;
  offer: (ctx: OfferRuleContext) => OfferCode;
  rationale: (ctx: OfferRuleContext) => string;
}

const socialOrZero = (ctx: OfferRuleContext) => ctx.socialScore ?? 0;

/**
 * Website skoruna dayanan kurallar yalnizca skor GERCEKTEN OLCULDUYSE
 * calisabilir. Olculemeyen skoru 0 gibi ele almak, bot korumasi arkasindaki
 * saglam bir siteye "website satalim" dedirtirdi.
 */
const webMeasured = (ctx: OfferRuleContext): ctx is OfferRuleContext & { websiteScore: number } =>
  ctx.websiteScore !== null;

export const OFFER_RULES: OfferRule[] = [
  {
    id: 'R1',
    description: 'Kamu/üniversite tesisi — ticari satın alma süreci yok',
    matches: (c) => c.isInstitutional,
    offer: () => 'G',
    rationale: () =>
      'Belediye/üniversite tesisi. Ticari satın alma süreci bulunmadığından teklif önerilmiyor.',
  },
  {
    id: 'R2',
    description: 'Hiçbir iletişim kanalı yok — ulaşılamaz lead',
    matches: (c) => !c.hasPhone && !c.hasWebsite && !c.hasSocialPresence,
    offer: () => 'G',
    rationale: () =>
      'Telefon, website ve sosyal medya kanallarının hiçbiri bulunamadı. ' +
      'İletişim bilgisi doğrulanmadan teklif üretmek anlamsız.',
  },
  {
    id: 'R2b',
    description: 'Dijital varlık ölçülemedi → otomatik teklif üretilmez, elle incelenmeli',
    matches: (c) => c.websiteScore === null && c.socialScore === null,
    offer: () => 'G',
    rationale: () =>
      'İşletmenin sitesi otomatik denetime kapalı (bot koruması ya da sunucu hatası) ve ' +
      'doğrulanabilir sosyal medya profili de bulunamadı. Elimizde teklif üretecek ölçüm yok. ' +
      'Bu lead ELLE İNCELENMELİ — siteyi tarayıcıda açıp bakmak gerekiyor. ' +
      'Ölçemediğimiz için "kötü" varsaymıyoruz.',
  },
  {
    id: 'R3',
    description: 'Dijital olgunluk yüksek, boşluk düşük → büyütme hizmetleri',
    matches: (c) =>
      webMeasured(c) && c.websiteScore >= 80 && socialOrZero(c) >= 80 && (c.digitalGap ?? 100) < 25,
    offer: (c) => {
      if (!c.hasBooking || !c.hasMembership) return 'D';
      if ((c.employeeCount ?? 0) >= 20) return 'E';
      return 'F';
    },
    rationale: (c) =>
      `Website (${c.websiteScore}) ve sosyal medya (${c.socialScore}) güçlü, dijital boşluk düşük (${c.digitalGap}). ` +
      (!c.hasBooking || !c.hasMembership
        ? 'Eksik olan tek şey online rezervasyon/üyelik otomasyonu — asıl kazanç burada.'
        : (c.employeeCount ?? 0) >= 20
          ? 'Temel altyapı tamam; ölçek bu büyüklükte özel yazılım yatırımını karşılar.'
          : 'Temel altyapı tamam; büyüme artık trafik ve dönüşüm optimizasyonundan gelir.'),
  },
  {
    id: 'R4',
    description: 'Site zayıf, sosyal güçlü → önce siteyi düzelt (dönüşüm darboğazı)',
    matches: (c) => webMeasured(c) && c.websiteScore < 55 && socialOrZero(c) >= 70,
    offer: () => 'A',
    rationale: (c) =>
      `Sosyal medyada güçlü bir varlık var (${c.socialScore}) ama website zayıf (${c.websiteScore}). ` +
      'İşletme trafiği zaten üretiyor; darboğaz o trafiğin indiği yer. ' +
      'Sosyalden gelen ilgi üyeye dönüşmeden kayboluyor — önce bu zemin düzeltilmeli.',
  },
  {
    id: 'R5',
    description: 'Site zayıf/yok, sosyal de güçlü değil → önce website',
    matches: (c) => webMeasured(c) && c.websiteScore < 55,
    offer: () => 'A',
    rationale: (c) =>
      c.hasWebsite
        ? `Website skoru ${c.websiteScore}/100 — temel dijital altyapı yetersiz. ` +
          'Diğer her yatırımın döneceği bir zemin olmadığı için önce website.'
        : 'Hiç website yok. Tüm dijital kazanımların dayanacağı temel eksik; başlangıç noktası website.',
  },
  {
    id: 'R6',
    description: 'Site yeterli, sosyal zayıf veya yok → sosyal medya',
    matches: (c) => webMeasured(c) && c.websiteScore >= 55 && socialOrZero(c) < 50,
    offer: () => 'C',
    rationale: (c) =>
      `Website yeterli seviyede (${c.websiteScore}) ama sosyal medya ` +
      (c.socialScore === null
        ? 'varlığı tespit edilemedi'
        : `zayıf (${c.socialScore})`) +
      '. Fitness sektöründe müşteri kazanımı ağırlıkla sosyal medyadan geliyor.',
  },
  {
    id: 'R7',
    description: 'Site iyi ama rezervasyon/üyelik otomasyonu yok',
    matches: (c) => webMeasured(c) && c.websiteScore >= 70 && (!c.hasBooking || !c.hasMembership),
    offer: () => 'D',
    rationale: (c) =>
      `Website skoru iyi (${c.websiteScore}) fakat ` +
      [!c.hasBooking ? 'online rezervasyon' : null, !c.hasMembership ? 'online üyelik' : null]
        .filter(Boolean)
        .join(' ve ') +
      ' akışı yok. Otomasyon eklendiğinde mevcut trafik doğrudan satışa döner.',
  },
  {
    id: 'R8',
    description: 'Varsayılan — her iki kanalda da orta seviye',
    matches: () => true,
    offer: () => 'B',
    rationale: (c) =>
      c.websiteScore === null
        ? `Website denetlenemedi; elde yalnızca sosyal medya ölçümü var (${c.socialScore}). ` +
          'Site tarayıcıda kontrol edilmeden teklif kesinleştirilmemeli.'
        : `Website (${c.websiteScore}) ve sosyal medya (${c.socialScore ?? 'ölçülemedi'}) ` +
          'her ikisi de orta seviyede. En yüksek getiri iki kanalı birlikte geliştirmekten gelir.',
  },
];
