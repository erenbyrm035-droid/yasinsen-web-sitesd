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
npm run db:init
npm run pipeline -- --limit 10 --city istanbul
npm run dev          # → http://localhost:3000
```

Hiçbir API anahtarı gerekmez. Anahtarsız çalışırken sistem OSM discovery, yerel
performans ölçümü ve deterministik gerekçe üretimi kullanır.

## Komutlar

| Komut | Ne yapar |
|---|---|
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

10 gerçek İstanbul işletmesiyle uçtan uca doğrulandı:

| Metrik | Değer |
|---|---|
| Lead | 10 |
| Denetlenen | 10 |
| Erişilebilir site | 6 |
| Site yok / açılmıyor | 4 |
| Bulunan sosyal profil | 6 |
| HIGH öncelikli | 2 |

## Bilinen sınırlar

Bunlar gizlenmez — sistem ölçemediği şeyi `null` bırakır ve dashboard'da açıkça
işaretler.

| Sınır | Etki | Çözüm |
|---|---|---|
| **Apollo Free plan** — People Search API kapalı | Karar verici alanları `NULL` | Plan yükseltilip `APOLLO_API_KEY` verilir → [`docs/APOLLO.md`](docs/APOLLO.md) |
| **Instagram login duvarı** | Takipçi/etkileşim/Reels ölçülemiyor; sosyal skor sadece doğrulanabilir sinyallerden, `confidence: low` | Instagram Graph API bağlanabilir |
| **PageSpeed anahtarı yok** | Lighthouse yerine yerel performans sezgiselleri (kanıt alanında açıkça belirtilir) | Ücretsiz `PAGESPEED_API_KEY` eklenir |
| **OSM çalışan sayısı vermez** | `employee_count` `NULL`; skorlamada bileşen olarak hiç sayılmaz | Apollo açılınca dolar |

### Teyit bekleyen tasarım kararı

Şartnamedeki `Website 42 / Social 81 → Social Media` örneği sezgisel beklentinin
tersi yönde (zayıf site varken sosyal satmak). **Şartnamede yazdığı gibi
uygulandı** ve fixture testiyle kilitlendi. Yön değiştirilmek istenirse yalnızca
`src/lib/offer/rules.ts` içindeki **R4** kuralının `offer` alanı `'A'` yapılır.

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
