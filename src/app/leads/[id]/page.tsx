import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLeadDetail } from '@/lib/db/repositories/views';
import { getSalesLead } from '@/lib/db/repositories/sales-views';
import { listCalls, listEvents, listOffers } from '@/lib/db/repositories/sales';
import { SalesPanel } from './SalesPanel';
import { Timeline, toEntries } from './Timeline';
import { StatusBadge } from '../../components/ui';
import { buildAnalysis } from '@/lib/ai/reasoner';
import { PriorityBadge, ScoreCell, Section, NoData } from '../../components/ui';
import { ManualSocialForm } from './ManualSocialForm';
import type { SocialDataAvailability } from '@/lib/types';

export const dynamic = 'force-dynamic';

const DATA_LABELS: Record<keyof SocialDataAvailability, string> = {
  followers: 'Takipçi sayısı',
  postFrequency: 'İçerik sıklığı',
  reelsUsage: 'Reels kullanımı',
  visualQuality: 'Görsel kalite',
  bio: 'Bio',
  engagement: 'Etkileşim',
  salesContent: 'Satışa yönelik içerik',
  websiteLinkInBio: "Bio'da site linki",
};

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leadId = Number.parseInt(id, 10);
  if (Number.isNaN(leadId)) notFound();

  const detail = getLeadDetail(leadId);
  if (!detail) notFound();

  const { company, contacts, websiteAudit, socialAudits, manualInputs, score, offer } = detail;

  // Satis tarafi: mevcut analiz verisine DOKUNMADAN ayri okunur.
  const sales = getSalesLead(leadId);
  const calls = listCalls(leadId);
  const offers = listOffers(leadId);
  const timeline = toEntries(listEvents(leadId));

  // Form varsayilani: elle veri girilmis ilk platform, yoksa tespit edilen ilk
  // platform, o da yoksa Instagram.
  const defaultPlatform = manualInputs[0]?.platform ?? socialAudits[0]?.platform ?? 'instagram';
  const defaultExisting = manualInputs[0] ?? null;

  // Deterministik gerekce sayfa render'inda uretilir (AI anahtari varsa Claude yazar).
  const analysis =
    score && offer && websiteAudit
      ? await buildAnalysis({
          companyName: company.name,
          industry: company.industry,
          district: company.location_district,
          websiteAudit,
          socialAudits,
          score,
          offer,
        })
      : null;

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-10">
      <Link
        href="/"
        className="text-xs text-[#8b94ad] underline-offset-4 hover:text-[#5b8cff] hover:underline"
      >
        ← Lead listesi
      </Link>

      <header className="mt-4 mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
          <p className="mt-1 text-sm text-[#8b94ad]">
            {[company.industry, company.location_district, company.location_city]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {offer && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-[#8b94ad]">Önerilen hizmet</div>
              <div className="text-sm font-medium text-[#e8ecf5]">{offer.offerLabel}</div>
            </div>
          )}
          {score && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-[#8b94ad]">Purchase Score</div>
              <div className="text-3xl font-semibold tabular-nums">{score.purchaseScore}</div>
            </div>
          )}
          <PriorityBadge priority={score?.priority ?? null} />
          {sales ? <StatusBadge status={sales.salesStatus} /> : null}
        </div>
      </header>

      {/* Hizli kunye — aramadan once bakilacak her sey tek satirda. */}
      <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-[#232b45] bg-[#11172a] px-4 py-3 text-sm">
        {company.phone ? (
          <span className="font-mono text-[#e8ecf5]">{company.phone}</span>
        ) : (
          <span className="text-xs text-[#6b7592]">telefon yok</span>
        )}
        {company.website ? (
          <a href={company.website} target="_blank" rel="noreferrer noopener"
             className="text-[#5b8cff] underline-offset-4 hover:underline">website ↗</a>
        ) : (
          <span className="text-xs text-[#6b7592]">website yok</span>
        )}
        {sales?.socialProfile ? (
          <a href={sales.socialProfile} target="_blank" rel="noreferrer noopener"
             className="text-[#5b8cff] underline-offset-4 hover:underline">sosyal profil ↗</a>
        ) : (
          <span className="text-xs text-[#6b7592]">sosyal profil yok</span>
        )}
        {sales ? (
          <a
            href={sales.mapsUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[#5b8cff] underline-offset-4 hover:underline"
            title={
              sales.mapsExact
                ? 'Google Place ID ile tam kayda gider'
                : 'Bu kaynakta Place ID yok — ad ve ilçeyle arama açar, doğru işletme olduğunu kontrol edin'
            }
          >
            Google Maps {sales.mapsExact ? '↗' : '(arama) ↗'}
          </a>
        ) : null}
        {company.rating !== null && company.rating !== undefined ? (
          <span className="text-[#b8c0d4]">
            ★ {company.rating}
            <span className="ml-1 text-xs text-[#6b7592]">({company.review_count ?? 0} yorum)</span>
          </span>
        ) : (
          <span className="text-xs text-[#6b7592]">Google puanı yok</span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* --- Sol kolon --------------------------------------------------- */}
        <div className="space-y-6 lg:col-span-2">
          {analysis && (
            <Section title="AI Reasoning" subtitle="Yalnızca aşağıdaki denetim bulgularına dayanır">
              <p className="text-sm leading-relaxed text-[#c8d0e2]">{analysis.reasoning}</p>
              {offer && (
                <div className="mt-5 rounded-lg border border-[#5b8cff]/25 bg-[#5b8cff]/5 p-4">
                  <div className="text-xs uppercase tracking-wider text-[#8b94ad]">
                    Recommended Service
                  </div>
                  <div className="mt-1 text-lg font-medium">
                    <span className="mr-2 rounded bg-[#232b45] px-1.5 py-0.5 font-mono text-xs text-[#8b94ad]">
                      {offer.offerCode}
                    </span>
                    {offer.offerLabel}
                  </div>
                  <p className="mt-2 text-sm text-[#8b94ad]">{offer.rationale}</p>
                  <div className="mt-2 text-xs text-[#6b7592]">Teklif güveni: {offer.confidence}</div>
                </div>
              )}
            </Section>
          )}

          <Section
            title="Website Audit"
            subtitle={
              websiteAudit
                ? `Skor ${websiteAudit.score}/100 · güven ${websiteAudit.confidence} · ${
                    websiteAudit.hasWebsite
                      ? `HTTP ${websiteAudit.httpStatus ?? 'yanıt yok'}`
                      : 'website yok'
                  }`
                : 'Denetim yapılmadı'
            }
          >
            {!websiteAudit ? (
              <NoData reason="Bu şirket için website denetimi çalıştırılmadı" />
            ) : (
              <>
                {websiteAudit.notes && (
                  <p className="mb-4 rounded-lg bg-[#161d33] px-3 py-2 text-xs text-[#8b94ad]">
                    {websiteAudit.notes}
                  </p>
                )}
                <ul className="space-y-2">
                  {websiteAudit.checks.map((c) => (
                    <li key={c.key} className="flex gap-3 text-sm">
                      <span className="mt-0.5 w-4 shrink-0 text-center">
                        {c.passed === null ? (
                          <span className="text-[#6b7592]" title="Ölçülemedi">
                            ?
                          </span>
                        ) : c.passed ? (
                          <span className="text-[#4ade80]">✓</span>
                        ) : (
                          <span className="text-[#ff5a4d]">✕</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-[#e8ecf5]">{c.label}</span>
                        {c.ratio !== null && c.ratio > 0 && c.ratio < 1 && (
                          <span className="ml-2 text-xs text-[#8b94ad]">
                            (%{Math.round(c.ratio * 100)})
                          </span>
                        )}
                        <span className="mt-0.5 block text-xs text-[#6b7592]">{c.evidence}</span>
                      </span>
                      <span className="shrink-0 text-xs text-[#4a536b]">ağırlık {c.weight}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>

          <Section
            title="Social Media Audit"
            subtitle="Instagram login duvarı nedeniyle metrikler ölçülemiyor — yalnızca doğrulanabilir sinyaller"
          >
            {socialAudits.length === 0 ? (
              <p className="text-sm text-[#8b94ad]">
                Doğrulanabilir sosyal medya profili bulunamadı. Sitede sosyal link yoksa handle
                tahmin edilmez.
              </p>
            ) : (
              <div className="space-y-5">
                {socialAudits.map((s) => (
                  <div key={s.platform} className="rounded-lg border border-[#232b45] bg-[#0e1424] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-medium capitalize">{s.platform}</span>
                        {s.handle && <span className="ml-2 text-sm text-[#8b94ad]">@{s.handle}</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        <ScoreCell score={s.score} />
                        <span className="rounded bg-[#232b45] px-2 py-0.5 text-xs text-[#8b94ad]">
                          güven: {s.confidence}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2">
                      <Signal
                        label="Sitede link var"
                        value={s.signals.linkOnSite}
                      />
                      <Signal
                        label="Profil çözülüyor"
                        value={s.signals.handleResolves}
                      />
                      <Signal
                        label="Sitede gömülü feed"
                        value={s.signals.feedEmbedOnSite}
                      />
                      <Signal
                        label="Link öne çıkan konumda"
                        value={s.signals.linkPlacementProminent}
                      />
                    </div>

                    {s.manual && (
                      <div className="mt-3 rounded-md border border-[#4ade80]/20 bg-[#4ade80]/5 p-3">
                        <div className="mb-2 flex items-center justify-between text-xs">
                          <span className="font-medium text-[#86efac]">
                            Manuel veri · rubrik skoru {s.manual.score}/100
                          </span>
                          <span className="text-[#6b7592]">
                            kapsam %{Math.round(s.manual.coverage * 100)}
                          </span>
                        </div>
                        <ul className="space-y-1 text-xs">
                          {s.manual.components.map((c) => (
                            <li key={c.key} className="flex justify-between gap-3">
                              <span className="text-[#b8c0d4]">{c.label}</span>
                              <span className="text-right text-[#6b7592]">
                                {c.detail} · {Math.round(c.value)}/100
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {(() => {
                      const missing = (Object.keys(DATA_LABELS) as (keyof SocialDataAvailability)[])
                        .filter((k) => !s.dataAvailable[k]);
                      if (missing.length === 0) {
                        return (
                          <div className="mt-3 border-t border-[#232b45] pt-3 text-xs text-[#86efac]">
                            Tüm alanlar dolu — bu platform için tam rubrik uygulandı.
                          </div>
                        );
                      }
                      return (
                        <div className="mt-3 border-t border-[#232b45] pt-3">
                          <div className="mb-2 text-xs text-[#6b7592]">
                            Ölçülemeyen alanlar (aşağıdaki formdan elle girilebilir):
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {missing.map((k) => (
                              <span
                                key={k}
                                className="rounded bg-[#161d33] px-2 py-0.5 text-xs text-[#6b7592] ring-1 ring-[#232b45]"
                              >
                                {DATA_LABELS[k]}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Manuel Sosyal Medya Girişi"
            subtitle="Instagram login duvarı nedeniyle otomatik ölçülemeyen metrikler — girilince lead anında yeniden skorlanır"
          >
            <ManualSocialForm
              companyId={company.id}
              leadId={detail.leadId}
              platform={defaultPlatform}
              existing={defaultExisting}
            />

            {manualInputs.length > 1 && (
              <div className="mt-5 border-t border-[#232b45] pt-4">
                <div className="mb-2 text-xs text-[#8b94ad]">
                  Bu şirket için girilmiş diğer platformlar:
                </div>
                <ul className="space-y-1 text-xs text-[#6b7592]">
                  {manualInputs.slice(1).map((m) => (
                    <li key={m.id}>
                      <span className="capitalize text-[#b8c0d4]">{m.platform}</span>
                      {m.followers !== null && ` · ${m.followers.toLocaleString('tr-TR')} takipçi`}
                      {` · ${m.updatedAt}`}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-[#4a536b]">
                  Düzenlemek için formdaki platformu değiştirip kaydedin.
                </p>
              </div>
            )}
          </Section>
        </div>

        {/* --- Sag kolon --------------------------------------------------- */}
        <div className="space-y-6">
          <Section title="Şirket Bilgileri">
            <dl className="space-y-3 text-sm">
              <Row label="Website">
                {company.website ? (
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="break-all text-[#5b8cff] underline-offset-4 hover:underline"
                  >
                    {company.website}
                  </a>
                ) : (
                  <NoData reason="Kaynakta website kaydı yok" />
                )}
              </Row>
              <Row label="Telefon">{company.phone ?? <NoData />}</Row>
              <Row label="Segment">{company.segment ?? <NoData />}</Row>
              <Row label="Çalışan sayısı">
                {company.employee_count ?? <NoData reason="OSM çalışan sayısı taşımaz" />}
              </Row>
              <Row label="Kaynak">
                <span className="font-mono text-xs">
                  {company.source} / {company.source_ref}
                </span>
              </Row>
            </dl>
          </Section>

          <Section title="Karar Verici">
            {contacts.length === 0 ? (
              <p className="text-sm text-[#8b94ad]">
                Karar verici bilgisi yok.{' '}
                <span className="text-[#6b7592]">
                  Apollo People Search açıldığında bu alan dolar (docs/APOLLO.md).
                </span>
              </p>
            ) : (
              <div className="space-y-4">
                {contacts.map((c) => (
                  <dl key={c.id} className="space-y-2 text-sm">
                    <Row label="İsim">{c.full_name ?? <NoData />}</Row>
                    <Row label="Ünvan">{c.title ?? <NoData />}</Row>
                    <Row label="E-posta">
                      {c.email ?? <NoData reason="Bulunamadı — tahmin edilmez" />}
                    </Row>
                    <Row label="Telefon">{c.phone ?? <NoData />}</Row>
                    <Row label="LinkedIn">
                      {c.linkedin_url ? (
                        <a
                          href={c.linkedin_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-[#5b8cff] underline-offset-4 hover:underline"
                        >
                          profil
                        </a>
                      ) : (
                        <NoData />
                      )}
                    </Row>
                  </dl>
                ))}
              </div>
            )}
          </Section>

          {score && (
            <Section title="Skor Kırılımı">
              <div className="space-y-3">
                <Bar label="Digital Gap" value={score.digitalGap} />
                <Bar label="Business Potential" value={score.businessPotential} />
                <Bar label="Buying Intent" value={score.estimatedBuyingIntent} />
                <Bar label="Website Score" value={score.websiteScore} />
                <Bar label="Social Score" value={score.socialScore} />
              </div>
              <p className="mt-4 border-t border-[#232b45] pt-3 font-mono text-xs leading-relaxed text-[#6b7592]">
                {score.breakdown.purchase?.formula}
              </p>
              {score.breakdown.digitalGap?.formula && (
                <p className="mt-2 font-mono text-xs leading-relaxed text-[#6b7592]">
                  {score.breakdown.digitalGap.formula}
                </p>
              )}
            </Section>
          )}

          {sales ? (
            <SalesPanel
              leadId={leadId}
              company={company.name}
              phone={company.phone}
              status={sales.salesStatus}
              callCount={sales.callCount}
              lastCalledAt={sales.lastCalledAt}
              nextFollowUpAt={sales.nextFollowUpAt}
              calls={calls.map((c) => ({
                id: c.id,
                calledAt: c.called_at,
                result: c.result,
                notes: c.notes,
                nextFollowUpAt: c.next_follow_up_at,
              }))}
              offers={offers.map((o) => ({
                id: o.id,
                service: o.service,
                amount: o.amount,
                sentAt: o.sent_at,
                status: o.status,
                notes: o.notes,
              }))}
              suggestedService={offer?.offerLabel ?? null}
            />
          ) : null}

          <Section title="Satış zaman çizelgesi" subtitle="Tamamen veritabanından üretilir">
            <Timeline entries={timeline} />
          </Section>

          {offer && offer.digitalGaps.length > 0 && (
            <Section title="Digital Gaps" subtitle="Denetimde kalan maddeler, ağırlık sırasıyla">
              <ol className="space-y-1.5 text-sm">
                {offer.digitalGaps.map((gap, i) => (
                  <li key={gap} className="flex gap-2">
                    <span className="w-4 shrink-0 text-xs text-[#4a536b]">{i + 1}.</span>
                    <span className="text-[#c8d0e2]">{gap}</span>
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </div>
      </div>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-[#8b94ad]">{label}</dt>
      <dd className="text-right text-[#e8ecf5]">{children}</dd>
    </div>
  );
}

function Signal({ label, value }: { label: string; value: boolean | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-3 text-center">
        {value === null ? (
          <span className="text-[#6b7592]">?</span>
        ) : value ? (
          <span className="text-[#4ade80]">✓</span>
        ) : (
          <span className="text-[#ff5a4d]">✕</span>
        )}
      </span>
      <span className={value === null ? 'text-[#6b7592]' : 'text-[#b8c0d4]'}>{label}</span>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-[#8b94ad]">{label}</span>
        <span className="tabular-nums text-[#e8ecf5]">{value ?? 'veri yok'}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#232b45]">
        <div
          className="h-full rounded-full bg-[#5b8cff]"
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
    </div>
  );
}
