import type {
  LeadAnalysisJson,
  LeadScoreResult,
  OfferRecommendation,
  SocialAuditResult,
  WebsiteAuditResult,
} from '../types';

/**
 * AI ANALYSIS
 *
 * Her lead icin sartnamedeki JSON'u uretir. Iki mod vardir ve ikisi de ayni
 * KANIT SETINI kullanir:
 *
 *   1) Deterministik (varsayilan) — gerekce dogrudan audit bulgularindan
 *      kurulur. Hicbir sey uydurulmaz, API anahtari gerekmez, ciktisi
 *      tekrarlanabilir.
 *   2) ANTHROPIC_API_KEY set ise — ayni kanit seti Claude'a verilip dogal dil
 *      gerekce yazdirilir. Model YALNIZCA verilen kanitlari yorumlar; yeni
 *      olgu uretmesi sistem promptunda yasaklanmistir.
 *
 * Arayuz iki modda da aynidir; cagiran katman farki gormez.
 */

const DEFAULT_MODEL = 'claude-opus-5';

export interface ReasonerInput {
  companyName: string;
  industry: string | null;
  district: string | null;
  websiteAudit: WebsiteAuditResult;
  socialAudits: SocialAuditResult[];
  score: LeadScoreResult;
  offer: OfferRecommendation;
}

/** Modele ve deterministik metne verilen ortak kanit ozeti. */
function buildEvidence(input: ReasonerInput): string {
  const { websiteAudit, socialAudits, score, offer } = input;

  const failed = websiteAudit.checks
    .filter((c) => c.passed === false)
    .map((c) => `- ${c.label}: ${c.evidence}`);
  const passed = websiteAudit.checks
    .filter((c) => c.passed === true)
    .map((c) => `- ${c.label}: ${c.evidence}`);
  const unmeasured = websiteAudit.checks
    .filter((c) => c.passed === null)
    .map((c) => `- ${c.label}: ölçülemedi`);

  const socialLines =
    socialAudits.length > 0
      ? socialAudits.map(
          (s) =>
            `- ${s.platform} (@${s.handle ?? '?'}): skor ${s.score ?? 'yok'}, ` +
            `profil ${s.resolved === true ? 'çözülüyor' : s.resolved === false ? 'çözülmüyor' : 'kontrol edilemedi'}, ` +
            `güven ${s.confidence}`,
        )
      : ['- Doğrulanabilir sosyal medya profili bulunamadı'];

  return [
    `İşletme: ${input.companyName}`,
    `Sektör: ${input.industry ?? 'bilinmiyor'} · İlçe: ${input.district ?? 'bilinmiyor'}`,
    '',
    `WEBSITE (${websiteAudit.score}/100, güven: ${websiteAudit.confidence})`,
    websiteAudit.hasWebsite
      ? `HTTP ${websiteAudit.httpStatus ?? 'yanıt yok'} — ${websiteAudit.finalUrl ?? 'açılmadı'}`
      : 'Kayıtlı website adresi yok',
    passed.length > 0 ? `Geçen maddeler:\n${passed.join('\n')}` : 'Geçen madde yok',
    failed.length > 0 ? `Kalan maddeler:\n${failed.join('\n')}` : 'Kalan madde yok',
    unmeasured.length > 0 ? `Ölçülemeyenler:\n${unmeasured.join('\n')}` : '',
    '',
    `SOSYAL MEDYA (skor: ${score.socialScore ?? 'ölçülemedi'})`,
    ...socialLines,
    'NOT: Takipçi, etkileşim, içerik sıklığı ve Reels verisi Instagram login duvarı nedeniyle ÖLÇÜLEMEDİ.',
    '',
    `SKORLAR — business potential ${score.businessPotential}, digital gap ${score.digitalGap}, ` +
      `buying intent ${score.estimatedBuyingIntent}, purchase ${score.purchaseScore} (${score.priority})`,
    `Formül: ${score.breakdown.purchase?.formula ?? '—'}`,
    '',
    `ÖNERİLEN TEKLİF: ${offer.offerLabel} (${offer.offerCode})`,
    `Kural gerekçesi: ${offer.rationale}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Kanitlardan dogrudan kurulan gerekce — model gerekmez, uydurma icermez. */
function deterministicReasoning(input: ReasonerInput): string {
  const { websiteAudit, score, offer } = input;
  const parts: string[] = [];

  if (!websiteAudit.hasWebsite) {
    parts.push(`${input.companyName} için kayıtlı bir website bulunamadı.`);
  } else if (websiteAudit.status === 'blocked') {
    parts.push(
      `${input.companyName} sitesi otomatik denetime kapalı (${websiteAudit.reason ?? 'bot koruması'}). ` +
        'Site büyük olasılıkla sorunsuz çalışıyor; ölçemediğimiz için kalitesi hakkında ' +
        'HİÇBİR hüküm verilmedi. Aramadan önce siteyi tarayıcıda açıp bakın.',
    );
  } else if (websiteAudit.status === 'unreachable' && websiteAudit.httpStatus !== null) {
    parts.push(
      `${input.companyName} sitesi denetlenemedi (${websiteAudit.reason ?? `HTTP ${websiteAudit.httpStatus}`}). ` +
        'Sunucu yanıt verdi ama sayfayı vermedi — site skoru üretilmedi, elle bakılmalı.',
    );
  } else if (websiteAudit.httpStatus === null && websiteAudit.hasWebsite) {
    parts.push(
      `${input.companyName} sitesine hiç ulaşılamadı (${websiteAudit.reason ?? 'bağlantı kurulamadı'}) — ` +
        'sunucu yanıt vermiyor. Yayında olmayan bir site acil yenileme ihtiyacına işaret ediyor, ' +
        'ancak kalite skoru üretilmedi.',
    );
  } else {
    const topGaps = websiteAudit.checks
      .filter((c) => c.passed === false)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((c) => c.label.toLowerCase());
    parts.push(
      `Website skoru ${websiteAudit.score}/100.` +
        (topGaps.length > 0 ? ` En ağır eksikler: ${topGaps.join(', ')}.` : ' Belirgin bir eksik bulunmadı.'),
    );
  }

  parts.push(
    score.socialScore === null
      ? 'Doğrulanabilir sosyal medya sinyali bulunamadı; sosyal skor hesaplanmadı.'
      : `Sosyal sinyal skoru ${score.socialScore}/100 (yalnızca doğrulanabilir sinyaller; takipçi ve etkileşim verisi ölçülemedi).`,
  );

  // Olculemeyen bilesenler (value === null) gerekce olarak gosterilemez.
  const intentDriver = [...score.breakdown.buyingIntentComponents]
    .filter((c) => c.value !== null)
    .sort((a, b) => (b.value as number) * b.weight - (a.value as number) * a.weight)[0];
  if (intentDriver) {
    parts.push(`Satın alma sinyali ${score.estimatedBuyingIntent}/100; en güçlü etken: ${intentDriver.detail}`);
  }

  const potentialDriver = [...score.breakdown.businessPotentialComponents]
    .filter((c) => c.weight > 0 && c.value !== null)
    .sort((a, b) => (b.value as number) * b.weight - (a.value as number) * a.weight)[0];
  if (potentialDriver) {
    parts.push(`İşletme potansiyeli ${score.businessPotential}/100; başlıca dayanak: ${potentialDriver.detail}`);
  }

  parts.push(
    `Toplam purchase score ${score.purchaseScore}/100 → ${score.priority}. ` +
      `Önerilen hizmet: ${offer.offerLabel}.`,
  );

  return parts.join(' ');
}

const SYSTEM_PROMPT = [
  'Sen bir B2B satış araştırma asistanısın. Sana bir işletmenin dijital denetim bulguları verilecek.',
  'Görevin: bu bulgulara dayanarak 3-5 cümlelik Türkçe bir satış gerekçesi yazmak.',
  '',
  'KATI KURALLAR:',
  '- YALNIZCA sana verilen bulguları kullan. Yeni olgu, sayı, metrik veya iddia ÜRETME.',
  '- "Ölçülemedi" olarak işaretlenen alanlar hakkında tahmin yürütme; gerekiyorsa ölçülemediğini söyle.',
  '- İşletme hakkında bilmediğin hiçbir şeyi varsayma (ciro, müşteri sayısı, rakip vb.).',
  '- Abartılı satış dili kullanma. Somut eksiklere ve bunların iş sonucuna etkisine odaklan.',
  '- Sadece gerekçe metnini döndür; başlık, madde işareti veya ön söz ekleme.',
].join('\n');

/** ANTHROPIC_API_KEY varsa Claude ile gerekce uretir; her hatada null doner. */
async function claudeReasoning(input: ReasonerInput): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    // Dinamik import: anahtar yoksa SDK hic yuklenmez.
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
      // Dusuk efor + kisa cikti: gerekce birkac cumle. max_tokens dusunme
      // payini da kapsadigi icin metnin kesilmemesi adina pay birakiliyor.
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildEvidence(input) }],
    });

    // Guvenlik siniflandiricisi reddedebilir — icerigi okumadan once kontrol et.
    if (response.stop_reason === 'refusal') return null;

    const text = response.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    return text.length > 0 ? text : null;
  } catch (err) {
    // AI katmani opsiyonel: basarisiz olursa deterministik metne dusulur.
    console.warn(
      `  [ai] Claude gerekçesi alınamadı, deterministik metne düşülüyor: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** Sartnamedeki analiz JSON'unu uretir. */
export async function buildAnalysis(input: ReasonerInput): Promise<LeadAnalysisJson> {
  const reasoning = (await claudeReasoning(input)) ?? deterministicReasoning(input);

  return {
    website_score: input.score.websiteScore,
    social_score: input.score.socialScore,
    purchase_score: input.score.purchaseScore,
    priority: input.score.priority,
    recommended_offer: input.offer.offerLabel,
    digital_gaps: input.offer.digitalGaps,
    reasoning,
  };
}

export { deterministicReasoning, buildEvidence };
