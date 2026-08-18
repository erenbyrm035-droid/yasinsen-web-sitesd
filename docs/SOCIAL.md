# Sosyal Medya Denetimi

## Şu an ne ölçülüyor

Instagram ve Facebook profil sayfaları **kazınmıyor**. İki nedenle:

1. **İşe yaramıyor.** Instagram public profilleri login duvarının arkasında.
   Anonim istek HTTP 200 dönüyor ama sayfada ne takipçi sayısı, ne post
   sayısı, ne de `og:description` var.
2. **Platform koşullarına aykırı.** Otomatik profil kazıma Instagram ve
   Facebook kullanım koşullarının ihlali.

Bu yüzden şu metrikler **ölçülemiyor** ve `data_available` içinde `false`
olarak işaretleniyor — değerleri asla uydurulmuyor:

profil aktifliği · içerik sıklığı · Reels kullanımı · görsel kalite · bio ·
etkileşim · satışa yönelik içerik · bio'daki site linki

**Ölçülebilenler** (skor yalnızca bunlardan üretilir):

| Sinyal | Ağırlık | Nasıl ölçülüyor |
|---|---|---|
| Sitede profil linki var mı | 30 | işletmenin kendi HTML'i |
| Profil URL'i çözülüyor mu | 35 | HTTP durum kontrolü (200 / 404) |
| Kaç platformda varlık | 20 | bulunan profil sayısı |
| Sitede gömülü feed | 10 | Elfsight, LightWidget, IG embed |
| Link öne çıkan konumda mı | 5 | fold üstü / header bölgesi |

Skor daima `confidence: 'low'` ile saklanır. Gerçek metrik için Instagram
Graph API bağlanmalı ya da dashboard'daki **manuel giriş formu** kullanılmalı
(elle girilen veri `confidence: 'medium'` alır ve otomatik tahmini yener).

---

## Profil nasıl bulunuyor

Üç kaynak, güven sırasına göre:

### 1. İşletmenin kendi sitesindeki link
En güçlü kanıt — doğrulama gerektirmez. `status: 'on_site'`.

### 2. Sitenin iç sayfaları
Ana sayfada link yoksa `/iletisim`, `/contact`, `/hakkimizda`, `/about`,
`/bize-ulasin` denenir. Çoğu site sosyal linkleri iletişim sayfasına koyuyor.
Yine `status: 'on_site'`.

### 3. Web araması + kimlik doğrulama
Site okunamıyorsa (bot koruması) ya da hiç site yoksa tek yol bu.
`status: 'verified'` — **yalnızca doğrulama eşiğini geçerse.**

---

## Kimlik doğrulama

Arama sonucundaki her Instagram linki o işletmeye ait değildir.
`"X Pilates" istanbul instagram` araması onlarca başka stüdyo döndürür.

**Yanlış profil eklemek, profil hiç eklememekten daha zararlıdır** — müşteriye
"sosyal medyanız zayıf" derken başkasının hesabına bakıyor oluruz.

Doğrulama yalnızca arama sonucunun **başlığı ve özeti** üzerinden yapılır;
profil sayfası açılmaz. Puanlama:

| Sinyal | Puan | Neden |
|---|---|---|
| İşletme adının ayırt edici kelimeleri handle içinde | 0.45 × oran | en güçlü isim kanıtı |
| İşletme adı sonuç metninde | 0.25 × oran | destekleyici |
| İşletmenin alan adı profil metninde | 0.30 | bio'suna sitesini yazmış |
| İlçe / şehir eşleşmesi | 0.12 | tek başına yetersiz |
| Telefon numarası eşleşmesi | 0.35 | neredeyse kesin kanıt |

**Eşik: 0.55.** Altında kalan aday kaydedilmez, `rejected` listesine yazılır.

`fitness`, `pilates`, `spor`, `salonu`, `studio`, `istanbul` gibi sektör ve
konum kelimeleri **stopword** — tek başlarına eşleşme sayılmaz. Yoksa
"pilatesstudio" hesabı her pilates stüdyosuyla eşleşirdi.

---

## Kurulum: arama sağlayıcısı

Arama **Google Programmable Search (Custom Search JSON API)** ile yapılır.
Günde 100 sorgu ücretsiz. Yapılandırılmamışsa arama atlanır ve sonuç
`not_searched` olarak işaretlenir — tahmin üretilmez.

Neden arama motoru HTML'i kazınmıyor: Bing ve DuckDuckGo denendi ve bilinçli
olarak reddedildi. Bing'in RSS çıktısı telif metninde açıkça "yalnızca
kişisel, ticari olmayan RSS okuyucu kullanımı" diyor. HTML kazıma da koşullara
aykırı ve her arayüz değişiminde kırılgan. Her gün çalışacak bir sistemi bunun
üzerine kurmak doğru değil.

### Adımlar

1. **Arama motoru oluştur:** https://programmablesearchengine.google.com/controlpanel/create
   - "Search the entire web" seçeneğini işaretle
   - Oluşturduktan sonra **Search engine ID** değerini kopyala (`cx`)

2. **Custom Search API'yi etkinleştir:**
   Google Cloud Console → APIs & Services → Library → "Custom Search API" → Enable

3. **API anahtarı:** Mevcut anahtarın Maps API'lerine kısıtlıysa Custom
   Search'e erişemez. Ya kısıtlamayı genişlet ya da yeni bir anahtar oluştur.

4. **`.env` dosyasına ekle:**

```bash
GOOGLE_CSE_ID=buraya_search_engine_id
GOOGLE_SEARCH_API_KEY=buraya_api_anahtari
```

GitHub Actions için aynı değerleri repo Secrets'a ekle.

### Doğrulama

```bash
npm run audit -- --limit 5
```

Çıktıda `sosyal yok (not_searched)` yerine `instagram:72*` görüyorsan
(yıldız = arama ile doğrulandı) çalışıyor demektir.
