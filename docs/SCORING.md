# Skorlama Mantığı

Bu belge sistemdeki **her puanın nereden geldiğini** açıklar. Amaç, bir lead'in
neden HOT ya da LOW çıktığı sorusuna kod okumadan cevap verebilmek.

**Temel ilke:** ölçülemeyen hiçbir şey uydurulmaz. Ölçülemeyen bir bileşen
`null` kalır ve **paydadan da düşülür** — yani "bilinmiyor", "sıfır" gibi
cezalandırılmaz.

---

## 1. Website Score (0–100)

Kaynak: `src/lib/audit/website.ts`

15 maddelik ağırlıklı bir denetim. Her madde `{passed, ratio, evidence, weight}`
üretir; `evidence` alanı kararın dayandığı somut bulgudur.

| # | Madde | Ağırlık | Nasıl ölçülür |
|---|---|---|---|
| 1 | Website erişilebilir | 8 | HTTP isteği tamamlandı mı |
| 2 | HTTPS güvenli bağlantı | 5 | Final URL `https://` mi, HSTS başlığı var mı |
| 3 | Mobil uyumluluk (viewport) | 8 | `<meta name="viewport">` var mı |
| 4 | Responsive tasarım işaretleri | 4 | Media query / grid / Tailwind / Bootstrap izleri |
| 5 | Net çağrı-aksiyon (CTA) | 8 | TR+EN CTA kalıpları (*üye ol, deneme dersi, randevu al, book now*) |
| 6 | WhatsApp ile iletişim | 5 | `wa.me` / `api.whatsapp.com` bağlantısı |
| 7 | Online rezervasyon / randevu | 8 | Rezervasyon kelimeleri veya Calendly/Setmore/SimplyBook |
| 8 | Online üyelik / satın alma | 6 | Sepet, ödeme, checkout, abonelik kalıpları |
| 9 | Paket ve fiyat bilgisi | 6 | Fiyat/paket/tarife/₺/TL kalıpları |
| 10 | İletişim kolaylığı | 7 | 4 alt madde: `tel:` linki, `mailto:`, adres, harita |
| 11 | SEO temel durumu | 9 | 6 alt madde: title uzunluğu, meta description, tek H1, OG, canonical, `lang` |
| 12 | Google görünürlüğü (indekslenebilirlik) | 4 | 3 alt madde: `noindex` yok, `robots.txt`, `sitemap.xml` |
| 13 | Sayfa performansı | 9 | Lighthouse (anahtar varsa) veya TTFB + HTML boyutu + render-blocking sayısı |
| 14 | Güven unsurları | 7 | 5 alt madde: HTTPS, adres, hakkımızda, yorum/referans, KVKK |
| 15 | Dönüşüm optimizasyonu | 6 | 4 alt madde: fold üstü CTA, form, sabit buton, canlı sohbet/WhatsApp |

**Formül:**

```
website_score = round( Σ(ratio × weight) / Σ(weight) × 100 )
```

Toplama **yalnızca ölçülebilen maddeler** girer (`ratio !== null`). Site
açılmadıysa 14 madde ölçülemez ve skor 0, `confidence: 'low'` olur.

**Website yoksa:** skor `0`, `has_website: false`, `confidence: 'high'`.
Bu kesin bir bulgudur ve güçlü bir satış sinyalidir.

### Performans neden Lighthouse değil?

`PAGESPEED_API_KEY` tanımlıysa gerçek Lighthouse mobil performans skoru
kullanılır. Tanımlı değilse **Lighthouse skoru uydurulmaz**; bunun yerine yerel
ölçümlerden bir oran üretilir ve kanıt alanında *"Yerel ölçüm (Lighthouse
anahtarı yok)"* olarak açıkça belirtilir:

| Sinyal | 1.0 | 0.7 | 0.4 | 0.1 |
|---|---|---|---|---|
| TTFB | ≤400ms | ≤900ms | ≤2000ms | üzeri |
| HTML boyutu | ≤150KB | ≤500KB | ≤1500KB | üzeri |
| Render-blocking kaynak | ≤3 | ≤8 | ≤15 | üzeri |

---

## 2. Social Score (0–100) — ve neden güveni düşük

Kaynak: `src/lib/audit/social.ts`

**Doğrulanmış kısıt (2026-08):** Instagram public profil sayfaları login
duvarının arkasında. Anonim istek HTTP 200 döner ama sayfada ne takipçi sayısı,
ne post sayısı, ne de `og:description` bulunur.

Bu nedenle şartnamedeki şu maddeler **şu an ölçülemez** ve `data_available`
içinde `false` olarak işaretlenir, değerleri `null` kalır:

> profil aktifliği · içerik sıklığı · Reels kullanımı · görsel kalite · bio ·
> etkileşim sinyalleri · satışa yönelik içerik · bio'daki site linki

**Ölçülebilen sinyaller** (skor yalnızca bunlardan üretilir):

| Sinyal | Ağırlık | Nasıl ölçülür |
|---|---|---|
| Sitede profil linki var | 30 | Site HTML'inden çıkarılır |
| Profil URL'i çözülüyor | 35 | Profil sayfasına istek: 200 → geçer, 404 → kalır, diğer → **hesaba katılmaz** |
| Platform sayısı | 20 | 3 platform = tam puan (doğrusal) |
| Sitede gömülü feed | 10 | Elfsight / LightWidget / IG embed vb. |
| Link öne çıkan konumda | 5 | Fold üstü / header bölgesinde mi |

Skor yalnızca **ölçülebilen sinyallerin ağırlığı üzerinden normalize** edilir ve
daima `confidence: 'low'` ile saklanır.

**Şirket geneli social score** = platformlar arasındaki en yüksek skor.
Hiç doğrulanabilir sinyal yoksa **`null` döner — `0` değil.** "Sosyal medyası
yok" ile "sosyal medyası ölçülemedi" farklı şeylerdir ve skorlamada farklı
davranırlar.

### Manuel giriş — duvarı aşmanın anahtarsız yolu

Dashboard'da her lead için **elle metrik girilebilir** (lead detay sayfası →
"Manuel Sosyal Medya Girişi"). Girilen alanlar tam rubriği devreye sokar:

| Alan | Ağırlık | Puanlama |
|---|---|---|
| Takipçi sayısı | 20 | ≥10k:100 · ≥5k:85 · ≥2k:70 · ≥500:50 · ≥100:30 · altı:15 |
| İçerik sıklığı (son 30 gün) | 20 | ≥20:100 · ≥12:85 · ≥8:70 · ≥4:50 · ≥1:25 · 0:0 |
| Reels kullanımı (son 30 gün) | 15 | ≥8:100 · ≥4:80 · ≥2:60 · ≥1:40 · 0:10 |
| Etkileşim oranı | 20 | ort. beğeni ÷ takipçi → ≥%6:100 · ≥%3:85 · ≥%1.5:65 · ≥%0.5:40 · altı:20 |
| Görsel kalite (1–5) | 10 | doğrusal |
| Satışa yönelik içerik (1–5) | 10 | doğrusal |
| Bio içeriği | 5 | site linki + iletişim |

**Birleşik skor** = %30 otomatik sinyal + %70 manuel rubrik.
**Güven**, girilen alanların ağırlık kapsamına göre yükselir: ≥%80 → `high`,
≥%40 → `medium`, altı → `low`.

Boş bırakılan her alan `null` kalır ve **paydadan da düşülür** — "girilmedi"
asla "kötü" anlamına gelmez.

### Şirket geneli sosyal skor: önce güven, sonra skor

Birden fazla platform varsa seçim **önce güvene, sonra skora** göre yapılır.
Bu sıralama bilinçli: elle ölçülmüş 86 ile yalnızca *"sitede link var + profil
açılıyor"* sinyalinden üretilmiş 90 aynı şey değildir. Yüksek güvenli ölçüm,
düşük güvenli tahmini daima yener — aksi halde gerçek veri girmek skoru
düşürebilir ve kullanıcı veri girmekten caydırılırdı.

> Tam otomasyon için Instagram Graph API bağlanabilir; bağlanınca manuel giriş
> gerekmeden aynı rubrik çalışır.

---

## 3. Business Potential (0–100)

Kaynak: `src/lib/scoring/business-potential.ts`

Ölçtüğü şey: **"Bu işletme bir dijital hizmet satın alabilecek büyüklükte ve
bütçede mi?"** — dijital olgunluk değil, ödeme gücü.

| Bileşen | Ağırlık | Değerler |
|---|---|---|
| Segment / ortalama ticket | 30 | boutique_gym & pilates 100 · crossfit & PT 95 · dövüş sporları 80 · gym 75 · diğer 60 |
| Lokasyon alım gücü | 25 | Tier-1 ilçe 100 · Tier-2 70 · diğer 50 · bilinmiyor 60 (nötr) |
| Dijital ayak izi (varlık) | 20 | site+sosyal 100 · biri 65 · hiçbiri 25 |
| Çalışan sayısı | 15 | ≥20 → 100 · ≥8 → 85 · ≥3 → 65 · <3 → 40 · **bilinmiyorsa bileşen hiç sayılmaz** |
| Ulaşılabilirlik | 10 | telefon var 100 · yok 40 |

**İlçe kademeleri** (dokümante sezgisel tablo, kesin veri değil):

- **Tier 1:** Beşiktaş, Kadıköy, Şişli, Sarıyer, Ataşehir, Bakırköy, Beyoğlu, Üsküdar, Beykoz
- **Tier 2:** Maltepe, Kartal, Pendik, Ümraniye, Bahçelievler, Başakşehir, Beylikdüzü, Büyükçekmece, Küçükçekmece, Avcılar, Zeytinburnu, Eyüpsultan, Kağıthane, Çekmeköy, Sancaktepe, Tuzla, Güngören

**Kurumsal/kamu cezası:** Belediye, üniversite veya kamu tesisi tespit edilirse
(`isInstitutional`) skordan **−35** düşülür ve bu ceza `breakdown` içinde
görünür. Bu tesislerin ticari satın alma süreci yoktur.

---

## 4. Digital Gap (0–100)

Kaynak: `src/lib/scoring/digital-gap.ts`

Ölçtüğü şey: **doldurabileceğimiz boşluk.** Yüksek gap = satılacak çok iş var.

```
gap = 100 − (wWebsite × website_score + wSocial × social_score)
```

Taban ağırlıklar `website 0.60 / social 0.40`. Sosyal skorun güveni düşük olduğu
için ağırlığı güvene göre çarpanla azaltılır ve **düşen ağırlık website'a
devredilir** (toplam daima 1.0 kalır):

| Sosyal güven | Çarpan | Etkin sosyal ağırlık |
|---|---|---|
| `none` (sinyal yok) | 0 | 0.00 → website 1.00 |
| `low` (bugünkü durum) | 0.5 | 0.20 → website 0.80 |
| `medium` | 0.8 | 0.32 → website 0.68 |
| `high` | 1.0 | 0.40 → website 0.60 |

Böylece ölçülemeyen sosyal medya, website skorunu haksız yere cezalandırmaz.

---

## 5. Estimated Buying Intent (0–100)

Kaynak: `src/lib/scoring/buying-intent.ts`

**Bu bir niyet beyanı değil, davranış sinyali çıkarımıdır.** İşletmenin bize
satın alma sinyali verdiğini iddia etmiyoruz; gözlemlenebilir dijital
davranışından "hizmet almaya yatkın olma" olasılığını tahmin ediyoruz.

Temel mantık: **en iyi alıcı, dijitale zaten yatırım yapmış ama sonucu eksik
kalmış işletmedir.** Hiçbir şey yapmamış işletme daha ucuz lead ama daha zor
satıştır; her şeyi yapmış işletmenin ise ihtiyacı yoktur.

| Bileşen | Ağırlık | 100 puan aldığı durum |
|---|---|---|
| Pazarlamaya yatırım var, altyapı eksik | 25 | social ≥ 60 **ve** website < 55 |
| Site eski / şablon / çalışmıyor | 15 | Site açılmıyor, telif yılı 2 yıldan eski, veya Wix/Squarespace/WordPress |
| Satış niyeti var, altyapı yok | 20 | Fiyat/paket yayınlanmış ama rezervasyon **ve** üyelik akışı yok |
| Dönüşüm unsurları zayıf | 15 | Dönüşüm maddelerinin <%50'si mevcut |
| İşletme aktif ama dijitalde yok | 25 | Telefon var, website **ve** sosyal yok |

---

## 6. Purchase Score (0–100) ve Priority

Kaynak: `src/lib/scoring/purchase-score.ts`

```
base = 0.35 × digital_gap
     + 0.35 × business_potential
     + 0.30 × estimated_buying_intent
```

**Ağırlıkların gerekçesi:** `digital_gap` (satılacak iş var mı) ve
`business_potential` (ödeyebilir mi) eşit ağırlıkta, çünkü biri olmadan diğeri
satışa dönmez. `buying_intent` en spekülatif bileşen olduğu için biraz daha
düşük ağırlıkta.

### Ulaşılabilirlik çarpanı

Ardından skor, işletmeye kaç kanaldan ulaşılabildiğine göre **çarpılır**
(`breakdown.purchase.modifiers` içinde görünür):

| Kanal sayısı (telefon / website / sosyal) | Çarpan |
|---|---|
| 0 — hiçbiri | ×0.55 |
| 1 | ×0.85 |
| 2 veya 3 | ×1.00 |

**Bu neden çarpan, neden sabit ceza değil:** 100 lead'lik kalibrasyon
çalışmasında ortaya çıktı ki hiçbir iletişim kanalı olmayan işletmeler
`digital_gap = 100` alıyor ve sistem bunu "devasa fırsat" sanıyordu. Oysa
ulaşamadığınız işletme fırsat değildir — boşluğu doldurmak için önce o
işletmeye ulaşmak gerekir. Önceki sabit −10 ceza bu etkiyi kapatmıyordu:
100 lead'in 85'i MEDIUM'a yığılmış, hiçbiri HOT çıkmamış, tüm aralık 39–74'e
sıkışmıştı. Çarpana geçildikten sonra dağılım açıldı (aşağıya bakın).

Sonuç 0–100 aralığına sıkıştırılır.

### Priority eşikleri

| Priority | Purchase score |
|---|---|
| 🔥 HOT | ≥ 80 |
| 🟢 HIGH | 65 – 79 |
| 🟡 MEDIUM | 45 – 64 |
| 🔴 LOW | < 45 |

Dashboard varsayılan sıralaması `purchase_score DESC` — en yüksek potansiyel
üstte.

### Kalibrasyon: 100 lead üzerinde gerçek dağılım

| | Kalibrasyon öncesi | Kalibrasyon sonrası |
|---|---|---|
| Aralık | 39 – 74 | 34 – 74 |
| Medyan | 54 | 39 |
| HOT / HIGH / MEDIUM / LOW | 0 / 11 / 85 / 4 | 0 / 10 / 35 / 55 |

Kalibrasyon öncesi 100 lead'in **85'i MEDIUM'du** — yani öncelik etiketi hiçbir
şey ayırt etmiyordu. Ulaşılabilirlik çarpanından sonra dağılım iki gruba
ayrıldı: ulaşılamayan 55 kayıt 34–39 bandına indi, çalışılabilir 45 lead
50–74 arasına yayıldı. Artık sıralamanın üstü gerçekten aranacak listedir.

### HOT neden 0?

HOT (≥80) için üç eksenin de birden yüksek olması gerekir. Şu an iki girdi
eksik veri yüzünden tavanlı:

- **Karar verici yok** (Apollo Free plan) → `business_potential` bileşenlerinden
  biri hiç ölçülemiyor
- **Sosyal metrikler ölçülemiyor** (Instagram duvarı) → `digital_gap`'te sosyal
  ağırlığı 0.40 → 0.20'ye düşürülüyor

Bu eksikler kapandıkça HOT ulaşılabilir hale gelir. Eşikleri yapay olarak
düşürmedik — 80'i hak etmeyen bir lead'e HOT demek, etiketi işe yaramaz kılardı.
Şu an için **aranacak liste HIGH bandıdır** (10 lead).

---

## 7. Offer Engine (A–G)

Kaynak: `src/lib/offer/rules.ts` — **tüm teklif mantığı tek, düzenlenebilir
tablodadır.** Motor kuralları sırayla dener, **ilk eşleşen** kuralı uygular.

| Kod | Hizmet |
|---|---|
| A | Website |
| B | Website + Social Media |
| C | Social Media |
| D | Website + Automation |
| E | Custom Software |
| F | Ads / Conversion Optimization |
| G | No Offer |

| Kural | Koşul | Sonuç |
|---|---|---|
| R1 | Kurumsal/kamu tesisi | G |
| R2 | Hiçbir iletişim kanalı yok | G |
| R3 | website ≥ 80 **ve** social ≥ 80 **ve** gap < 25 | rezervasyon/üyelik eksikse **D**; ≥20 çalışan varsa **E**; değilse **F** |
| R4 | website < 55 **ve** social ≥ 70 | C |
| R5 | website < 55 | A |
| R6 | website ≥ 55 **ve** social < 50 (veya ölçülemedi) | C |
| R7 | website ≥ 70 **ve** rezervasyon veya üyelik yok | D |
| R8 | (varsayılan) | B |

### Şartname örnekleri — fixture testi olarak kilitli

`tests/offer.test.ts` bu üç örneği birebir doğrular:

| Örnek | Kural | Sonuç |
|---|---|---|
| Website 42 · Social 81 | R4 | **C** — Social Media |
| Website 48 · Social 45 | R5 | **A** — Website |
| Website 85 · Social 82 · düşük gap | R3 | **D / E / F** |

> **Teyide açık nokta:** İlk örnek (zayıf site + güçlü sosyal → Social Media)
> sezgisel beklentinin tersi yönde. Sezgi "zayıf site → website sat" derdi;
> şartnamedeki mantık ise işletmenin zaten para harcadığı kanalı büyütmek
> üzerine kurulu. **Şartnamede yazdığı gibi uygulandı.** Yön değiştirilmek
> istenirse yalnızca `rules.ts` içindeki R4 kuralının `offer` alanı `'A'`
> yapılmalıdır — başka hiçbir yer değişmez.

### Teklif güveni

Teklifin güveni, dayandığı ölçümlerin güveninden yüksek olamaz:

- Website denetimi `low` güvendeyse → teklif `low`
- Sosyal varlık var ama hiç ölçülemediyse → `low`
- Sosyal güven `low`/`none` ise → en fazla `medium`
- Aksi halde website denetiminin güveni

---

## 8. Analiz JSON'u

Her lead için `src/lib/ai/reasoner.ts` şartnamedeki şekli üretir:

```json
{
  "website_score": 72,
  "social_score": 81,
  "purchase_score": 87,
  "priority": "HOT",
  "recommended_offer": "Website + Social Media",
  "digital_gaps": ["Online rezervasyon / randevu", "Paket ve fiyat bilgisi"],
  "reasoning": "..."
}
```

`reasoning` iki modda üretilir, **ikisi de aynı kanıt setini kullanır**:

1. **Deterministik (varsayılan)** — gerekçe doğrudan audit bulgularından
   kurulur. API anahtarı gerekmez, çıktı tekrarlanabilir, hiçbir şey uydurulmaz.
2. **`ANTHROPIC_API_KEY` set ise** — aynı kanıt seti Claude'a verilir. Sistem
   promptu modele **yeni olgu, sayı veya metrik üretmeyi açıkça yasaklar** ve
   "ölçülemedi" işaretli alanlar hakkında tahmin yürütmeyi engeller. Hata
   durumunda sessizce deterministik metne düşülür.

---

## Ölçülemeyen veri nasıl ele alınır

**Temel kural: ölçülemeyen şey puanlanmaz.** Ne sıfır, ne yüz, ne de "ortalama
bir değer". Bileşen formülden tamamen çıkarılır ve kalan ağırlıklar 1'e
normalize edilir.

### Neden bu kural var

100 lead'lik çalıştırmada bulunan gerçek hata: MACFit'in sitesi HTTP 403
dönüyordu. Sistem Cloudflare'in "erişim engellendi" sayfasını gerçek ana sayfa
sanıp denetlemiş ve şunu üretmişti:

```
MACFit Mall of İstanbul → website skoru 33 · güven: YÜKSEK
  reachable ✓  kanıt: "HTTP 403"     ← kendi içinde çelişki
```

Türkiye'nin en büyük zincirinin sitesi gayet çalışıyor. Aranacak listedeki 32
lead'in 11'i bu yanlış ölçüme dayanıyordu. O işletmeyi arayıp "sitenizde şu
eksikler var" demek, karşı tarafın haklı olarak güvenini kaybetmesi demekti.

### Uygulanışı

| Durum | website_score | digital_gap | Sonuç |
|---|---|---|---|
| Site denetlendi | 0–100 | hesaplanır | normal |
| **Kayıtlı site yok** | **0** | hesaplanır | gerçek bulgu — güçlü satış sinyali |
| HTTP 4xx/5xx | **null** | null* | elle inceleme |
| Bot koruması / challenge | **null** | null* | elle inceleme |
| JS ile render edilen SPA | **null** | null* | elle inceleme |
| Sunucu yanıt vermedi | **null** | null* | elle inceleme |

\* Elde güvenilir (`medium`/`high`) bir sosyal ölçüm varsa gap yalnızca ondan
hesaplanır. Otomatik sosyal denetim `low` güvenle çalıştığı için tek başına
karar dayanağı sayılmaz.

**"Website yok" ile "website ölçülemedi" ayrı şeylerdir.** Birincisi ölçülmüş
bir bulgudur ve skoru 0'dır — hatta en net satış fırsatlarından biridir.
İkincisi bir bilgi eksikliğidir ve skor üretmez.

### digital_gap null olduğunda purchase score

```
purchase = 0.35·gap + 0.35·potansiyel + 0.30·niyet        (normal)
purchase = 0.54·potansiyel + 0.46·niyet                    (gap ölçülemedi)
```

Ağırlıklar kalan bileşenler üzerinden yeniden normalize edilir. Lead ne dibe
atılır ne tepeye çıkarılır — sadece bilmediğimiz bileşen hesaba katılmaz.

### Güven seviyesinin etkisi

`digital_gap` içinde website ve sosyal ağırlıkları güvene göre ayarlanır:

| Güven | Çarpan |
|---|---|
| `high` | 1.0 |
| `medium` | 0.8 |
| `low` | 0.5 |
| `none` | 0 (hesaba katılmaz) |

Website güveni `high` olduğunda ağırlıklar eskisiyle birebir aynı kalır —
yani doğru ölçülmüş lead'lerin skorları bu değişiklikten etkilenmez.

### Buying intent bileşenleri

Site okunamadığında şu bileşenler `null` döner ve normalizasyondan çıkar:

- `investedButIncomplete` — site kalitesi bilinmeden "altyapısı eksik" denemez
- `outdatedSite` — okunamayan sayfanın güncelliği bilinemez
- `sellsWithoutInfrastructure` — "rezervasyon yok" denemez, sadece bakılamadı
- `weakConversion` — önceden ölçülemeyen durum 50 puan alıyordu; bu uydurma
  bir orta değerdi, kaldırıldı

`activeButOffline` bileşeni ölçülmeye devam eder çünkü sitenin *varlığına*
bakar, kalitesine değil.
