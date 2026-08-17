import type { AuditCheck, ScoreComponent } from '../types';

/**
 * ESTIMATED BUYING INTENT (0-100)
 *
 * Dikkat: bu bir "niyet beyani" degil, DAVRANIS SINYALI cikarimidir. Isletmenin
 * bize satin alma sinyali verdigini iddia etmiyoruz; gozlemlenebilir dijital
 * davranisindan "hizmet almaya yatkin" olma olasiligini tahmin ediyoruz.
 *
 * Temel mantik: en iyi alici, dijitale ZATEN yatirim yapmis ama sonucu
 * eksik kalmis isletmedir. Hicbir sey yapmamis isletme daha ucuz lead ama
 * daha zor satistir; her seyi yapmis isletmenin ise ihtiyaci yoktur.
 */

const WEIGHTS = {
  investedButIncomplete: 25,
  outdatedSite: 15,
  sellsWithoutInfrastructure: 20,
  weakConversion: 15,
  activeButOffline: 25,
} as const;

export interface BuyingIntentInput {
  websiteScore: number;
  socialScore: number | null;
  hasWebsite: boolean;
  /** Site kayitli ama HTTP istegi basarisiz oldu. */
  websiteBroken: boolean;
  hasSocialPresence: boolean;
  hasPhone: boolean;
  checks: AuditCheck[];
  copyrightYear: number | null;
  platform: string | null;
}

export interface BuyingIntentResult {
  score: number;
  components: ScoreComponent[];
}

function checkPassed(checks: AuditCheck[], key: string): boolean | null {
  return checks.find((c) => c.key === key)?.passed ?? null;
}

export function computeBuyingIntent(input: BuyingIntentInput): BuyingIntentResult {
  const components: ScoreComponent[] = [];
  const currentYear = new Date().getFullYear();

  // 1) Sosyalde aktif ama sitesi zayif: pazarlamaya harcama istegi kanitli.
  const socialStrong = (input.socialScore ?? 0) >= 60;
  const investedButIncomplete = socialStrong && input.websiteScore < 55;
  components.push({
    key: 'investedButIncomplete',
    label: 'Pazarlamaya yatırım yapıyor, altyapı eksik',
    value: investedButIncomplete ? 100 : socialStrong ? 40 : 20,
    weight: WEIGHTS.investedButIncomplete,
    detail: investedButIncomplete
      ? `Sosyal varlık güçlü (${input.socialScore}) ama website zayıf (${input.websiteScore}) — bütçe var, sonuç eksik`
      : socialStrong
        ? 'Sosyal varlık güçlü, website de yeterli seviyede'
        : 'Belirgin bir dijital yatırım sinyali yok',
  });

  // 2) Site var ama eskimis / hazir sablon.
  const stale = input.copyrightYear !== null && input.copyrightYear < currentYear - 1;
  const templatePlatform = input.platform !== null && /wix|squarespace|wordpress/i.test(input.platform);
  const outdated = input.hasWebsite && (stale || templatePlatform || input.websiteBroken);
  components.push({
    key: 'outdatedSite',
    label: 'Site eski / şablon / çalışmıyor',
    value: outdated ? 100 : input.hasWebsite ? 25 : 0,
    weight: WEIGHTS.outdatedSite,
    detail: input.websiteBroken
      ? 'Kayıtlı site açılmıyor — acil yenileme ihtiyacı'
      : stale
        ? `Telif yılı ${input.copyrightYear} — site uzun süredir güncellenmemiş`
        : templatePlatform
          ? `Hazır şablon altyapısı (${input.platform}) — özelleştirme ihtiyacı`
          : input.hasWebsite
            ? 'Site güncel görünüyor'
            : 'Site yok',
  });

  // 3) Satmaya calisiyor ama altyapisi yok: fiyat/paket yayinliyor,
  //    online rezervasyon veya uyelik akisi yok. En net donusum firsati.
  const pricing = checkPassed(input.checks, 'pricing') === true;
  const booking = checkPassed(input.checks, 'booking') === true;
  const membership = checkPassed(input.checks, 'membership') === true;
  const sellsWithoutInfrastructure = pricing && !booking && !membership;
  components.push({
    key: 'sellsWithoutInfrastructure',
    label: 'Satış niyeti var, altyapı yok',
    value: sellsWithoutInfrastructure ? 100 : !booking && !membership && input.hasWebsite ? 60 : 15,
    weight: WEIGHTS.sellsWithoutInfrastructure,
    detail: sellsWithoutInfrastructure
      ? 'Fiyat/paket yayınlanmış ama online rezervasyon ve üyelik akışı yok'
      : booking || membership
        ? 'Online rezervasyon/üyelik altyapısı mevcut'
        : input.hasWebsite
          ? 'Ne fiyat bilgisi ne rezervasyon akışı var'
          : 'Değerlendirilecek site yok',
  });

  // 4) Donusum unsurlari zayif.
  const conversionCheck = input.checks.find((c) => c.key === 'conversion');
  const conversionRatio = conversionCheck?.ratio ?? null;
  const weakConversion = conversionRatio !== null && conversionRatio < 0.5;
  components.push({
    key: 'weakConversion',
    label: 'Dönüşüm unsurları zayıf',
    value: weakConversion ? 100 : conversionRatio === null ? 50 : 20,
    weight: WEIGHTS.weakConversion,
    detail:
      conversionRatio === null
        ? 'Ölçülemedi (site açılmadı)'
        : weakConversion
          ? `Dönüşüm unsurlarının yalnızca %${Math.round(conversionRatio * 100)}'i mevcut — ${conversionCheck?.evidence}`
          : 'Dönüşüm unsurları yeterli',
  });

  // 5) Isletme aktif ama dijitalde yok: telefonu var, sitesi/sosyali yok.
  //    Sifirdan kurulum firsati — yuksek gap ama satis daha zahmetli.
  const activeButOffline = !input.hasWebsite && !input.hasSocialPresence && input.hasPhone;
  components.push({
    key: 'activeButOffline',
    label: 'İşletme aktif ama dijitalde yok',
    value: activeButOffline ? 100 : !input.hasWebsite ? 60 : 10,
    weight: WEIGHTS.activeButOffline,
    detail: activeButOffline
      ? 'Telefon kayıtlı, website ve sosyal medya yok — sıfırdan kurulum fırsatı'
      : !input.hasWebsite
        ? 'Website yok'
        : 'Dijital varlık mevcut',
  });

  const achievable = components.reduce((sum, c) => sum + c.weight, 0);
  const earned = components.reduce((sum, c) => sum + (c.value / 100) * c.weight, 0);

  return { score: Math.round((earned / achievable) * 100), components };
}
