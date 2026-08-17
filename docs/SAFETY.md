# Güvenlik ve Kontrol Sınırları

Bu sistem **yalnızca araştırma** yapar:

```
DISCOVER → ANALYZE → SCORE → RECOMMEND
```

Sonrasında hiçbir şey. Bu sınırlar yazılı bir söz değil, **makine tarafından
doğrulanan** kısıtlardır — `tests/safety.test.ts` her test çalıştırmasında kod
tabanını tarar ve ihlal bulursa CI kırılır.

## Yapılmayanlar

| Yasak | Nasıl garanti altına alındı |
|---|---|
| Hiçbir lead'e otomatik mesaj gönderilmez | Outreach/messaging modülü yok; testi dizinlerin varlığını kontrol eder |
| Hiçbir e-posta gönderilmez | `package.json`'da SMTP/mailer bağımlılığı yok (nodemailer, sendgrid, mailgun, resend, postmark, twilio…); kodda `createTransport`/`sendMail` çağrısı yok |
| Hiçbir WhatsApp mesajı gönderilmez | `wa.me` yalnızca **denetim sinyali** olarak aranır; Graph API'ye POST atan kod yok |
| Apollo'da kayıt oluşturulmaz/güncellenmez | Yazma uçlarına referans yok (liste: `docs/APOLLO.md`) |
| Hiçbir sequence başlatılmaz | `apollo_sequences_*`, `apollo_emailer_*` referansı yok |
| E-posta tahmin edilmez | `info@` + domain gibi üretim kalıpları testle yasak; bulunamayan e-posta `NULL` kalır |

## Veri dürüstlüğü kuralları

Bu sistemde **"bilinmiyor" ile "sıfır" farklı şeylerdir** ve şema seviyesinde
ayrılırlar:

- Ölçülemeyen denetim maddesi → `passed: null`, skor paydasından **düşülür**
- Ölçülemeyen sosyal metrik → `null` + `data_available: false` bayrağı
- Bulunamayan e-posta → `NULL` (asla tahmin edilmez)
- Apollo'nun kilitli e-posta placeholder'ı → `NULL`'a çevrilir
- Website adresi yoksa → `has_website: false`, skor `0`, güven `high`
- Website açılmadıysa → `has_website: true`, skor `0`, güven **`low`** (geçici olabilir)

Dashboard bu ayrımı görünür kılar: ölçülemeyen alanlar boş bırakılmaz,
**"veri yok" rozetiyle** işaretlenir.

## Dış sistemlere yapılan istekler

| Hedef | Yöntem | Amaç |
|---|---|---|
| `overpass-api.de` | POST (sorgu) | İşletme keşfi — açık veri (ODbL) |
| İşletmelerin kendi siteleri | GET | Website denetimi — herkese açık sayfa |
| Sosyal medya profil URL'leri | GET | Profilin çözülüp çözülmediği (200/404) |
| `googleapis.com/pagespeedonline` | GET | Yalnızca `PAGESPEED_API_KEY` tanımlıysa |
| `api.apollo.io/.../search` | POST | Yalnızca `APOLLO_API_KEY` tanımlıysa — **sadece arama** |
| `api.anthropic.com` | POST | Yalnızca `ANTHROPIC_API_KEY` tanımlıysa — gerekçe metni |

Hepsi okuma amaçlıdır. Hiçbiri veri yazmaz, hiçbiri mesaj iletmez.

### İstek nezaketi

- Website denetimleri **sırayla** yapılır — hedef siteler eşzamanlı isteklerle yorulmaz
- Her istekte 20 saniye timeout
- Overpass'in kendi `/api/status` ucu okunur ve boş slot beklenir (rate limit'e saygı)
- Gerçek bir tarayıcı User-Agent'ı kullanılır, `robots.txt` yoklanır

## AI kullanımı

`ANTHROPIC_API_KEY` tanımlıysa gerekçe metni Claude ile yazılır. Sistem promptu
modele şunları **açıkça yasaklar**:

- Verilen bulguların dışında yeni olgu, sayı veya metrik üretmek
- "Ölçülemedi" işaretli alanlar hakkında tahmin yürütmek
- İşletme hakkında bilinmeyen şeyleri varsaymak (ciro, müşteri sayısı, rakip vb.)

Model reddederse (`stop_reason: 'refusal'`) veya API hata verirse sessizce
deterministik metne düşülür — üretim durmaz, uydurma da olmaz.

## Testi çalıştırma

```bash
npm test
```

`tests/safety.test.ts` şunları doğrular: gönderim bağımlılığı yok · SMTP çağrısı
yok · Apollo yazma referansı yok · Apollo adapter yalnızca `/search` ucuna gider ·
outreach modülü yok · WhatsApp gönderim çağrısı yok · e-posta tahmin kalıbı yok ·
Apollo placeholder e-postası gerçek gibi saklanmıyor.
