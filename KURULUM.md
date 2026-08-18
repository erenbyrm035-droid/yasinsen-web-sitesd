# Masaüstü Kurulumu

Bilgisayarınızda çalıştırmak için. Toplam süre ~5 dakika.

---

## 1. Node.js kurun (bir kez)

https://nodejs.org → **LTS** sürümünü indirin, kurun.

Kurulduğunu doğrulayın — terminal (Mac: Terminal, Windows: PowerShell) açıp:

```bash
node --version
```

`v20` ya da üstü görmelisiniz. Görmüyorsanız terminali kapatıp yeniden açın.

---

## 2. Projeyi indirin

```bash
git clone https://github.com/erenbyrm035-droid/yasinsen-web-sitesd.git
cd yasinsen-web-sitesd
git checkout claude/viva-sales-engine-leads-8vvpzu
```

> `git` yoksa: https://git-scm.com/downloads
> Alternatif: GitHub sayfasından **Code → Download ZIP** deyip klasörü açın, terminalde o klasöre `cd` ile girin.

---

## 3. Tek komutla kurun

Proje klasöründe terminal açın ve şunu yazın:

```bash
npm run kur
```

Bu komut her şeyi yapar ve ne yaptığını satır satır yazar:
bağımlılıkları kurar, `.env` dosyasını oluşturur, veritabanını hazırlar,
kendi testlerini çalıştırır ve elinizdeki veriyi özetler.

**Temiz bir kopyada 35 saniye sürüyor** (gerçekten ölçüldü, tahmin değil).

Bittiğinde:

```bash
npm start
```

→ Tarayıcıda **http://localhost:3000** açılır.

### Günlük kullanım

| Komut | Ne yapar |
|---|---|
| `npm start` | Uygulamayı açar |
| `npm run tara` | Yeni işletme keşfeder, analiz eder, puanlar |
| `npm run report` | Arama brifingli günlük rapor üretir (`reports/latest.md`) |
| `npm run app` | Telefonda açılacak tek dosyalık sürümü üretir |
| `npm run verify` | Sistemin kendi kurallarına uyduğunu denetler |

## 4. Daha fazla lead

```bash
npm run pipeline -- --limit 100 --city istanbul --concurrency 5
```

`--limit` kaç işletme işleneceğini belirler. 100 lead ~2,5 dakika sürer.
Tekrar çalıştırmak kayıt çoğaltmaz — aynı işletme güncellenir, denetim geçmişi korunur.

---

## 5. API anahtarları (opsiyonel)

Anahtarsız da tam çalışır. Eklerseniz veri kalitesi artar.

Proje klasöründe **`.env`** adında bir dosya oluşturun (`.env.example`'ı kopyalayabilirsiniz):

```bash
cp .env.example .env
```

Sonra `.env` dosyasını bir metin editörüyle açıp doldurun:

| Satır | Ne kazandırır | Nasıl alınır |
|---|---|---|
| `PAGESPEED_API_KEY=` | Gerçek Google Lighthouse performans skorları | console.cloud.google.com → APIs & Services → Library → **PageSpeed Insights API** → Enable → Credentials → Create Credentials → **API key** |
| `GOOGLE_MAPS_API_KEY=` | Telefon, website, puan ve **yorum sayısı** — çok daha zengin lead verisi | Aynı yerde **Places API (New)** → Enable. Aynı anahtarı kullanabilirsiniz; API restrictions listesine bu servisi de eklemeyi unutmayın |
| `ANTHROPIC_API_KEY=` | Gerekçe metinlerini Claude yazar | console.anthropic.com |
| `APOLLO_API_KEY=` | Karar verici adı, e-postası, LinkedIn'i | Apollo **ücretli plan** gerekir — Free plan bu ucu kapatıyor |

`.env` dosyası `.gitignore`'da; GitHub'a gitmez.

Places anahtarını ekledikten sonra Google verisiyle çalıştırmak için:

```bash
npm run pipeline -- --limit 100 --source places
```

---

## Sık karşılaşılanlar

**`npm: command not found`**
Node.js kurulmamış ya da terminal yenilenmemiş. 1. adıma dönün, terminali kapatıp açın.

**`better-sqlite3` kurulum hatası (Windows)**
Windows'ta derleme araçları gerekebilir. PowerShell'i **yönetici olarak** açıp:
```powershell
npm install --global windows-build-tools
```
Sonra `npm install` komutunu tekrarlayın.

**Port 3000 dolu**
```bash
npm run dev -- --port 3001
```

**Overpass "slot bekleniyor" yazıyor**
Normal. OpenStreetMap sunucusu kullanıcı başına 2 eşzamanlı sorgu veriyor; sistem
boş slot bekleyip otomatik devam ediyor.

**Bazı siteler "Sayfa alınamadı" diyor**
Doğru davranış — o siteler gerçekten açılmıyor. Bu bir hata değil, güçlü bir satış
sinyali: müşterinin sitesi yayında değil.

---

## Verilerinizi yedekleme

Her şey tek dosyada: **`data/viva.db`**

Yedeklemek için bu dosyayı kopyalamanız yeterli. Silerseniz `npm run setup` ile
sıfırdan oluşur (denetim geçmişi kaybolur).

---

## Ne nerede

| Klasör | İçerik |
|---|---|
| `data/viva.db` | Tüm lead verisi |
| `docs/SCORING.md` | Her puanın nereden geldiği |
| `docs/APOLLO.md` | Apollo kısıtı ve açma adımları |
| `docs/SAFETY.md` | Sistemin ne yapmadığı ve nasıl garanti altına alındığı |
| `src/lib/offer/rules.ts` | Teklif kuralları — tek dosyada, düzenlenebilir |
