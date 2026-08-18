/**
 * VIVA SALES ENGINE — paylasilan alan modeli.
 *
 * Temel kural: olculemeyen her sey `null`. Bir alanin `null` olmasi
 * "veri yok" demektir, "sifir" demek degildir.
 */

export type Confidence = 'low' | 'medium' | 'high';
/** 'none' = hicbir sey olculemedi. "Kotu" degil, "bilinmiyor". */
export type AuditConfidence = 'none' | Confidence;
export type SocialConfidence = AuditConfidence;

/**
 * Website denetiminin ne ile karsilastigini soyler. Skorun anlamli olup
 * olmadigi buna bakilarak anlasilir:
 *
 *   ok          -> gercek isletme sayfasi analiz edildi, skor gecerli
 *   no_website  -> kayitli adres yok. Skor 0 ve bu GERCEK bir bulgudur.
 *   unreachable -> sunucu hata dondu ya da hic yanit vermedi. Skor null.
 *   blocked     -> bot korumasi / challenge sayfasi geldi. Skor null.
 *   unrendered  -> sayfa geldi ama icerigi sunucudan gelmiyor (JS ile render
 *                  edilen SPA) ya da neredeyse bos. Skor null.
 *
 * unreachable ve blocked durumlarinda sayfa ICERIGI ANALIZ EDILMEZ: gelen
 * HTML isletmenin sitesi degil, guvenlik duvarinin hata sayfasidir. Onu
 * denetlemek "siteniz kotu" hukmunu uydurmak olur.
 */
export type WebsiteAuditStatus =
  | 'ok'
  | 'no_website'
  | 'unreachable'
  | 'blocked'
  | 'unrendered';
export type Priority = 'HOT' | 'HIGH' | 'MEDIUM' | 'LOW';
export type LeadStatus = 'discovered' | 'analyzed' | 'scored';
export type OfferCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export type SocialPlatform = 'instagram' | 'facebook' | 'youtube' | 'tiktok';

/** Isletme segmentleri — offer ve business potential hesabinda kullanilir. */
export type Segment =
  | 'gym'
  | 'boutique_gym'
  | 'pilates_studio'
  | 'crossfit_box'
  | 'martial_arts'
  | 'personal_training'
  | 'fitness_other';

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Bir lead kaynagindan donen ham isletme kaydi. */
export interface DiscoveredCompany {
  name: string;
  website: string | null;
  domain: string | null;
  locationCity: string | null;
  locationDistrict: string | null;
  lat: number | null;
  lon: number | null;
  industry: string | null;
  segment: Segment;
  employeeCount: number | null;
  phone: string | null;
  /** Google puani — yalnizca Places kaynagi doldurur. */
  rating: number | null;
  /** Yorum sayisi — gercek musteri hacmi sinyali. Yalnizca Places. */
  reviewCount: number | null;
  /** Google Place ID — en guclu kimlik. Yalnizca Places kaynagi doldurur. */
  googlePlaceId: string | null;
  /** Places'in dondurdugu RESMI harita linki. Arama sorgusu degil, tam kayit. */
  mapsUri: string | null;
  source: string;
  /** Kaynak sistemdeki benzersiz kimlik — idempotent upsert icin. */
  sourceRef: string;
  raw: unknown;
  /** Kaynak karar verici veriyorsa; OSM vermez, Apollo verir. */
  contacts?: DiscoveredContact[];
}

export interface DiscoveredContact {
  fullName: string | null;
  title: string | null;
  /** Bulunamazsa null. Asla pattern'den tahmin edilmez. */
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  source: string;
}

export interface DiscoveryCriteria {
  city: string;
  limit: number;
  /** Apollo icin gecerli; OSM calisan sayisi vermez. */
  employeeRange?: [number, number];
  titles?: string[];
}

export interface LeadSource {
  readonly id: string;
  /** Kaynak su an kullanilabilir mi (plan/anahtar kontrolu). */
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  discover(criteria: DiscoveryCriteria): Promise<DiscoveredCompany[]>;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** Tek bir denetim maddesi. `evidence` neden gecti/kaldi sorusunun cevabi. */
export interface AuditCheck {
  key: string;
  label: string;
  /** null = bu madde olculemedi (site erisilemedi vb.) */
  passed: boolean | null;
  /**
   * Kismi puan: 0..1. Cok alt maddeli kontroller (SEO, guven unsurlari) icin
   * "yarim gecti" durumunu tasir. null = olculemedi.
   */
  ratio: number | null;
  /** Kararin dayandigi somut kanit. Uydurulmaz. */
  evidence: string;
  weight: number;
}

export interface WebsiteAuditResult {
  hasWebsite: boolean;
  httpStatus: number | null;
  finalUrl: string | null;
  checks: AuditCheck[];
  rawSignals: WebsiteRawSignals;
  /** Olculemediyse null — asla "dusuk skor" ile temsil edilmez. */
  score: number | null;
  confidence: AuditConfidence;
  status: WebsiteAuditStatus;
  /** Skor neden olculemedi: gercek HTTP kodu ya da tespit edilen engel. */
  reason: string | null;
  /** Otomatik hukum verilemedi; insan bakmali. Lead SILINMEZ. */
  manualReviewRequired: boolean;
  notes: string | null;
}

export interface WebsiteRawSignals {
  ttfbMs: number | null;
  htmlBytes: number | null;
  scriptCount: number | null;
  stylesheetCount: number | null;
  renderBlockingCount: number | null;
  imageCount: number | null;
  title: string | null;
  metaDescription: string | null;
  h1Count: number | null;
  lang: string | null;
  hasRobotsTxt: boolean | null;
  hasSitemap: boolean | null;
  platform: string | null;
  copyrightYear: number | null;
  socialLinks: string[];
  /** PageSpeed anahtari yoksa null — Lighthouse skoru uydurulmaz. */
  lighthousePerformance: number | null;
}

export interface SocialAuditResult {
  platform: SocialPlatform;
  handle: string | null;
  profileUrl: string | null;
  /** true = 200, false = 404, null = kontrol edilemedi */
  resolved: boolean | null;
  signals: SocialSignals;
  dataAvailable: SocialDataAvailability;
  /** Hicbir sinyal olculemediyse null. */
  score: number | null;
  confidence: SocialConfidence;
  status: SocialAuditStatus;
  /** Profil nasil bulundu ve neden bu isletmeye ait sayildi. */
  match: SocialMatch | null;
}

/**
 * Sosyal profilin nereden geldigi ve dogrulanip dogrulanmadigi.
 *
 *   on_site      -> isletmenin kendi sitesinde link veriliyor. En guclu kanit.
 *   verified     -> web aramasiyla bulundu ve kimlik sinyalleri dogrulandi.
 *   unverified   -> aday bulundu ama dogrulanamadi. KAYDEDILMEZ.
 *   not_found    -> arandi, bulunamadi.
 *   not_searched -> arama saglayicisi yapilandirilmamis.
 *   manual       -> elle girildi.
 */
export type SocialAuditStatus =
  | 'on_site'
  | 'verified'
  | 'unverified'
  | 'not_found'
  | 'not_searched'
  | 'manual';

export interface SocialMatch {
  source: 'website' | 'search' | 'manual';
  /** 0..1 — kimlik dogrulama guveni. Esigi gecmeyen aday kaydedilmez. */
  score: number;
  /** Hangi sinyaller eslesti (insan okunur, denetlenebilir). */
  signals: string[];
  /** Hangi arama sorgusuyla bulundu. */
  query: string | null;
}

export interface SocialSignals {
  linkOnSite: boolean;
  handleResolves: boolean | null;
  platformCount: number;
  feedEmbedOnSite: boolean;
  linkPlacementProminent: boolean | null;
}

/**
 * Instagram public profilleri login duvarinin arkasinda; asagidaki alanlar
 * su an hicbir lead icin olculemiyor. Bayraklar dashboard'da "veri yok"
 * rozetine donusur.
 */
export interface SocialDataAvailability {
  followers: boolean;
  postFrequency: boolean;
  reelsUsage: boolean;
  visualQuality: boolean;
  bio: boolean;
  engagement: boolean;
  salesContent: boolean;
  websiteLinkInBio: boolean;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoreComponent {
  key: string;
  label: string;
  /** null = bu bilesen olculemedi; paya da paydaya da girmez. */
  value: number | null;
  weight: number;
  /** Puanin nereden geldigini aciklayan kisa metin. */
  detail: string;
}

export interface LeadScoreResult {
  websiteScore: number | null;
  socialScore: number | null;
  businessPotential: number;
  /** Ne website ne sosyal olculebildiyse null. */
  digitalGap: number | null;
  estimatedBuyingIntent: number;
  purchaseScore: number;
  priority: Priority;
  breakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  businessPotentialComponents: ScoreComponent[];
  buyingIntentComponents: ScoreComponent[];
  digitalGap: {
    websiteWeight: number;
    socialWeight: number;
    socialConfidence: SocialConfidence;
    websiteConfidence: AuditConfidence;
    /** Hicbir dijital sinyal olculemediyse true — gap null olur. */
    unmeasurable: boolean;
    formula: string;
  };
  purchase: {
    base: number;
    modifiers: { key: string; label: string; delta: number }[];
    formula: string;
  };
}

// ---------------------------------------------------------------------------
// Offer
// ---------------------------------------------------------------------------

export interface OfferRecommendation {
  offerCode: OfferCode;
  offerLabel: string;
  rationale: string;
  digitalGaps: string[];
  confidence: Confidence;
}

// ---------------------------------------------------------------------------
// AI analiz ciktisi (sartnamedeki JSON sekli)
// ---------------------------------------------------------------------------

export interface LeadAnalysisJson {
  /** null = website denetlenemedi (bot korumasi / HTTP hatasi). */
  website_score: number | null;
  social_score: number | null;
  purchase_score: number;
  priority: Priority;
  recommended_offer: string;
  digital_gaps: string[];
  reasoning: string;
}
