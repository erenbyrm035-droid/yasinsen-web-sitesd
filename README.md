# VIVA SALES ENGINE

İstanbul'daki fitness, pilates, CrossFit ve dövüş sporları işletmelerini
otomatik keşfeden, dijital durumlarını denetleyen, satın alma potansiyellerini
puanlayan ve hangi hizmetin satılacağını öneren araştırma sistemi.

```
DISCOVER → ANALYZE → SCORE → RECOMMEND
```

Sistem **yalnızca araştırma yapar.** Hiçbir lead'e mesaj göndermez, hiçbir
e-posta atmaz, Apollo'da hiçbir kayıt oluşturmaz. Bu sınırlar testle
doğrulanır — bkz. [`docs/SAFETY.md`](docs/SAFETY.md).

## Hızlı başlangıç

```bash
npm install
npm run setup        # veritabanı + 25 lead, uçtan uca (~1-2 dk)
npm run dev          # → http://localhost:3000
```

Hiçbir API anahtarı gerekmez. Anahtarsız çalışırken sistem OSM discovery, yerel
performans ölçümü ve deterministik gerekçe üretimi kullanır.

Bilgisayarınıza kurmak için adım adım rehber: **[KURULUM.md](KURULUM.md)**

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run setup` | Veritabanı + 25 lead, tek komutta |
| `npm run db:init` | Şemayı uygular (idempotent) |
| `npm run discover -- --limit 10 --city istanbul` | İşletmeleri keşfeder |
| `npm run audit -- --limit 10` | Website + sosyal denetim |
| `npm run score -- --limit 10` | Skor + teklif + gerekçe |
| `npm run pipeline -- --limit 10` | Üçünü sırayla |
| `npm run dev` | Dashboard |
| `npm test` | Skorlama, teklif ve güvenlik testleri |

Pipeline idempotenttir — tekrar çalıştırmak kayıt çoğaltmaz.

## Dashboard

- **`/`** — KPI satırı (Total Leads · Analyzed · Hot Leads · High Potential ·
  Average Score) ve purchase score'a göre sıralı lead tablosu
- **`/leads/[id]`** — şirket bilgileri, karar verici, kanıtlı website denetimi,
  sosyal denetim (ölçülemeyen alanlar "veri yok" rozetiyle), AI gerekçesi,
  digital gaps, önerilen hizmet, skor kırılımı
- **`/api/leads`** — JSON export (`?id=3` ile tek lead detayı)

## Mevcut durum

100 gerçek İstanbul işletmesiyle uçtan uca doğrulandı (151 saniye):

| Metrik | Değer |
|---|---|
| Lead | 100 |
| Denetlenen | 100 |
| Erişilebilir site | 35 |
| Site yok / açılmıyor | 65 |
| Bulunan sosyal profil | 47 |
| Öncelik dağılımı | HIGH 10 · MEDIUM 35 · LOW 55 |

**Kalibrasyon yapıldı.** İlk çalıştırmada 100 lead'in 85'i MEDIUM çıkıyordu —
öncelik etiketi hiçbir şey ayırt etmiyordu. Sebep: hiçbir iletişim kanalı
olmayan 50 işletme `digital_gap = 100` alıp "devasa fırsat" gibi görünüyordu.
Ulaşılabilirlik çarpanı eklendi (0 kanal ×0.55, 1 kanal ×0.85); dağılım açıldı
ve sıralamanın üstü artık gerçekten aranacak liste. Ayrıntı:
[`docs/SCORING.md`](docs/SCORING.md#kalibrasyon-100-lead-üzerinde-gerçek-dağılım)

## Bilinen sınırlar

Bunlar gizlenmez — sistem ölçemediği şeyi `null` bırakır ve dashboard'da açıkça
işaretler.

| Sınır | Etki | Çözüm |
|---|---|---|
| **Apollo Free plan** — People Search API kapalı | Karar verici alanları `NULL` | Plan yükseltilip `APOLLO_API_KEY` verilir → [`docs/APOLLO.md`](docs/APOLLO.md) |
| **Instagram login duvarı** | Otomatik takipçi/etkileşim/Reels ölçümü yok | **Çözüldü (kısmen):** dashboard'da lead başına manuel metrik girişi var — girilince tam rubrik devreye girer, güven `high`'a çıkar, lead anında yeniden skorlanır. Tam otomasyon için Instagram Graph API |
| **PageSpeed anahtarı yok** | Lighthouse yerine yerel performans sezgiselleri (kanıt alanında açıkça belirtilir) | Ücretsiz `PAGESPEED_API_KEY` eklenir |
| **OSM çalışan sayısı vermez** | `employee_count` `NULL`; skorlamada bileşen olarak hiç sayılmaz | Apollo açılınca dolar |

### Şartnameden bilinçli sapma

Şartnamedeki `Website 42 / Social 81 → Social Media` örneği **kullanıcı onayıyla
ters çevrildi**: artık aynı durum `Website` önerir. Gerekçe — sosyalde zaten
güçlü olan bir işletmenin darboğazı trafiğin indiği yerdir; zayıf site,
sosyalden gelen ilgiyi üyeye çevirmeden kaybeder. Geri almak için
`src/lib/offer/rules.ts` içindeki **R4** kuralının `offer` alanı `'C'` yapılır.

### Komut seçenekleri

```bash
npm run pipeline -- --limit 100 --city istanbul --concurrency 5
```

| Bayrak | Ne yapar |
|---|---|
| `--limit N` | Kaç lead işlenecek |
| `--city` | Şu an `istanbul` tanımlı |
| `--source` | `osm` (varsayılan) · `places` (Google, daha zengin) · `apollo` |
| `--concurrency N` | Eş zamanlı website denetimi (1–12, varsayılan 4). Her lead farklı bir alan adına gittiği için tek siteyi yormaz. |
| `--quiet` | Lead başına gerekçe çıktısını susturur (25+ lead'de otomatik) |

## Otomatik çalışma

`.github/workflows/lead-radar.yml` her sabah 09:00'da (TR saati) çalışır:
yeni işletmeleri keşfeder, sitelerini denetler, puanlar ve **"bugün ne değişti"**
raporunu `reports/latest.md` dosyasına işler.

Rapor şunları içerir: aranacak listeye yeni giren leadler, yeni keşfedilen
işletmeler, skoru belirgin değişenler ve güncel aranacak liste. Değişimi bir
önceki çalıştırmanın anlık görüntüsüyle karşılaştırarak bulur — tam listeyi her
gün baştan okumaya gerek kalmaz.

GitHub'da **Actions** sekmesinden elle de tetiklenebilir (lead sayısı ve kaynak
seçilebilir). Rapor iş özetinde de görünür.

API anahtarları depo ayarlarından **Settings → Secrets and variables → Actions**
altına eklenebilir (`PAGESPEED_API_KEY`, `GOOGLE_MAPS_API_KEY`, `ANTHROPIC_API_KEY`).
Hiçbiri tanımlı değilse iş akışı yine çalışır — OSM ve yerel ölçümlerle.

## Teknoloji

Next.js 15 · TypeScript · Tailwind v4 · better-sqlite3 · tsx · node:test

Veri katmanı repository arayüzü üzerinden yazıldı; Supabase/Postgres şeması
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) içinde
hazır — geçiş yalnızca `src/lib/db/client.ts` ve repository gövdelerini etkiler.

> Not: `npm audit`, Next.js 15'in bundle ettiği `postcss` ve `sharp` için yüksek
> önem dereceli uyarılar veriyor. Bunlar build-time bağımlılıkları ve düzeltmesi
> Next 16'ya kırıcı yükseltme gerektiriyor; MVP için Next 15'te kalındı.

## Dokümanlar

| Belge | İçerik |
|---|---|
| [`docs/SCORING.md`](docs/SCORING.md) | Her puanın nereden geldiği — formüller, ağırlıklar, eşikler, kural tablosu |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Akış, dosya yapısı, tasarım kararları, ortam değişkenleri |
| [`docs/APOLLO.md`](docs/APOLLO.md) | Apollo kısıtı ve açma adımları |
| [`docs/SAFETY.md`](docs/SAFETY.md) | Gönderim/yazma yasakları ve nasıl doğrulandıkları |
