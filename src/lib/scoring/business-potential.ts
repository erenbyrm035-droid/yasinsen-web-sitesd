import type { ScoreComponent, Segment } from '../types';

/**
 * BUSINESS POTENTIAL (0-100)
 * "Bu isletme bir dijital hizmet satin alabilecek buyuklukte ve butcede mi?"
 *
 * Dijital olgunluk BURADA olculmez — o digital_gap'in isi. Burada olculen
 * odeme gucu ve isletme olcegidir.
 *
 * Olculemeyen bilesenler (orn. OSM calisan sayisi vermez) paydadan dusulur;
 * bilinmeyen bir bilesen sifir gibi cezalandirilmaz.
 */

/** Segment basina ortalama uyelik bedeli ve pazarlama harcamasi egilimi. */
const SEGMENT_TIER: Record<Segment, { value: number; detail: string }> = {
  boutique_gym: { value: 100, detail: 'Boutique gym — yüksek üyelik bedeli, marka odaklı' },
  pilates_studio: { value: 100, detail: 'Pilates/reformer — yüksek seans ücreti, randevu bazlı' },
  crossfit_box: { value: 95, detail: 'CrossFit box — topluluk odaklı, yüksek aidat' },
  personal_training: { value: 95, detail: 'Personal training — kişi başı yüksek ciro' },
  martial_arts: { value: 80, detail: 'Dövüş sporları akademisi — düzenli kurs geliri' },
  gym: { value: 75, detail: 'Klasik fitness salonu — hacim odaklı, orta üyelik bedeli' },
  fitness_other: { value: 60, detail: 'Diğer fitness işletmesi' },
};

/**
 * Istanbul ilce kademeleri — kira/musteri alim gucu sezgiseli.
 * Bu bir tahmindir, kesin veri degildir; dokumante edilmesinin sebebi
 * skorun neden degistigi sorusuna cevap verebilmektir.
 */
const DISTRICT_TIER_1 = [
  'beşiktaş', 'besiktas', 'kadıköy', 'kadikoy', 'şişli', 'sisli', 'sarıyer', 'sariyer',
  'ataşehir', 'atasehir', 'bakırköy', 'bakirkoy', 'beyoğlu', 'beyoglu', 'üsküdar', 'uskudar',
  'beykoz',
];

const DISTRICT_TIER_2 = [
  'maltepe', 'kartal', 'pendik', 'ümraniye', 'umraniye', 'bahçelievler', 'bahcelievler',
  'başakşehir', 'basaksehir', 'beylikdüzü', 'beylikduzu', 'büyükçekmece', 'buyukcekmece',
  'küçükçekmece', 'kucukcekmece', 'avcılar', 'avcilar', 'zeytinburnu', 'eyüpsultan', 'eyupsultan',
  'kağıthane', 'kagithane', 'çekmeköy', 'cekmekoy', 'sancaktepe', 'tuzla', 'güngören', 'gungoren',
];

function districtScore(district: string | null): { value: number; detail: string } {
  if (!district) return { value: 60, detail: 'İlçe bilinmiyor — nötr değer' };

  const normalized = district.toLowerCase().trim();
  if (DISTRICT_TIER_1.some((d) => normalized.includes(d))) {
    return { value: 100, detail: `${district} — yüksek alım gücü bölgesi` };
  }
  if (DISTRICT_TIER_2.some((d) => normalized.includes(d))) {
    return { value: 70, detail: `${district} — orta alım gücü bölgesi` };
  }
  return { value: 50, detail: `${district} — standart bölge` };
}

function employeeScore(count: number | null): { value: number; detail: string } | null {
  // OSM calisan sayisi tasimaz. Bilinmiyorsa bilesen hic hesaba katilmaz.
  if (count === null) return null;

  if (count >= 20) return { value: 100, detail: `${count} çalışan — kurumsal ölçek` };
  if (count >= 8) return { value: 85, detail: `${count} çalışan — oturmuş işletme` };
  if (count >= 3) return { value: 65, detail: `${count} çalışan — küçük işletme` };
  return { value: 40, detail: `${count} çalışan — mikro işletme` };
}

export interface BusinessPotentialInput {
  segment: Segment;
  district: string | null;
  employeeCount: number | null;
  hasWebsite: boolean;
  hasSocialPresence: boolean;
  hasPhone: boolean;
  /** Belediye/universite tesisi — satis hedefi degil. */
  isInstitutional: boolean;
}

export interface BusinessPotentialResult {
  score: number;
  components: ScoreComponent[];
}

const WEIGHTS = {
  segment: 30,
  district: 25,
  digitalFootprint: 20,
  employees: 15,
  contactability: 10,
} as const;

export function computeBusinessPotential(
  input: BusinessPotentialInput,
): BusinessPotentialResult {
  const components: ScoreComponent[] = [];

  const segment = SEGMENT_TIER[input.segment];
  components.push({
    key: 'segment',
    label: 'Segment / ortalama ticket',
    value: segment.value,
    weight: WEIGHTS.segment,
    detail: segment.detail,
  });

  const district = districtScore(input.district);
  components.push({
    key: 'district',
    label: 'Lokasyon alım gücü',
    value: district.value,
    weight: WEIGHTS.district,
    detail: district.detail,
  });

  // Dijital ayak izi burada "kalite" degil "varlik" olarak okunur:
  // hicbir kanalda gorunmeyen isletme genelde daha kucuk ve daha az kurumsaldir.
  const footprintValue = input.hasWebsite && input.hasSocialPresence
    ? 100
    : input.hasWebsite || input.hasSocialPresence
      ? 65
      : 25;
  components.push({
    key: 'digitalFootprint',
    label: 'Dijital ayak izi (varlık)',
    value: footprintValue,
    weight: WEIGHTS.digitalFootprint,
    detail:
      input.hasWebsite && input.hasSocialPresence
        ? 'Hem website hem sosyal medya varlığı'
        : input.hasWebsite
          ? 'Yalnızca website'
          : input.hasSocialPresence
            ? 'Yalnızca sosyal medya'
            : 'Hiçbir dijital kanalda görünmüyor',
  });

  const employees = employeeScore(input.employeeCount);
  if (employees) {
    components.push({
      key: 'employees',
      label: 'Çalışan sayısı',
      value: employees.value,
      weight: WEIGHTS.employees,
      detail: employees.detail,
    });
  }

  components.push({
    key: 'contactability',
    label: 'Ulaşılabilirlik',
    value: input.hasPhone ? 100 : 40,
    weight: WEIGHTS.contactability,
    detail: input.hasPhone ? 'Telefon numarası kayıtlı' : 'Kayıtlı telefon yok',
  });

  const achievable = components.reduce((sum, c) => sum + c.weight, 0);
  const earned = components.reduce((sum, c) => sum + (c.value / 100) * c.weight, 0);
  let score = Math.round((earned / achievable) * 100);

  // Kamu/universite tesisleri ticari satis hedefi degil.
  if (input.isInstitutional) {
    const before = score;
    score = Math.max(0, score - 35);
    components.push({
      key: 'institutionalPenalty',
      label: 'Kurumsal/kamu tesisi cezası',
      value: -35,
      weight: 0,
      detail: `Belediye/üniversite tesisi — ticari satın alma süreci yok (${before} → ${score})`,
    });
  }

  return { score, components };
}
