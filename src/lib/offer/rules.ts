import type { OfferCode } from '../types';

/**
 * OFFER ENGINE — kural tablosu.
 *
 * Tum teklif mantigi BU TABLODADIR. Bir kurali degistirmek icin tek satir
 * duzenlemek yeterlidir; motor (engine.ts) yalnizca tabloyu sirayla dener ve
 * ILK ESLESEN kurali uygular.
 *
 * NOT — sartname ornegi hakkinda:
 *   "Website Score = 42, Social Score = 81 → Social Media"
 * Bu kural bilincli olarak sartnamedeki gibi uygulanmistir (R3). Sezgisel
 * beklenti "zayif site → website sat" yonunde olurdu; sartnamedeki mantik ise
 * isletmenin zaten para harcadigi kanali buyutmek uzerine kurulu. Yon
 * degistirilmek istenirse yalnizca R3'un `offer` alani 'A' yapilmalidir.
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
  websiteScore: number;
  /** null = olculebilir sosyal sinyal yok. */
  socialScore: number | null;
  digitalGap: number;
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
    id: 'R3',
    description: 'Dijital olgunluk yüksek, boşluk düşük → büyütme hizmetleri',
    matches: (c) => c.websiteScore >= 80 && socialOrZero(c) >= 80 && c.digitalGap < 25,
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
    description: 'Site zayıf, sosyal güçlü → sosyal medyayı büyüt (şartname örneği)',
    matches: (c) => c.websiteScore < 55 && socialOrZero(c) >= 70,
    offer: () => 'C',
    rationale: (c) =>
      `Sosyal medyada güçlü bir varlık var (${c.socialScore}) ama website zayıf (${c.websiteScore}). ` +
      'İşletme pazarlamaya zaten bütçe ayırıyor; kazanç en hızlı bu kanalı büyüterek gelir.',
  },
  {
    id: 'R5',
    description: 'Site zayıf/yok, sosyal de güçlü değil → önce website',
    matches: (c) => c.websiteScore < 55,
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
    matches: (c) => c.websiteScore >= 55 && socialOrZero(c) < 50,
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
    matches: (c) => c.websiteScore >= 70 && (!c.hasBooking || !c.hasMembership),
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
      `Website (${c.websiteScore}) ve sosyal medya (${c.socialScore ?? 'ölçülemedi'}) ` +
      'her ikisi de orta seviyede. En yüksek getiri iki kanalı birlikte geliştirmekten gelir.',
  },
];
