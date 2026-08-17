# Mimari

## Akış

```
┌─ DISCOVER ──────────────────────────────────────────────┐
│  LeadSource arayüzü                                      │
│    · overpass.ts  (aktif)  — OSM, İstanbul bbox          │
│    · apollo.ts    (kapalı) — Free plan kısıtı            │
│  → companies · contacts · leads                          │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌─ ANALYZE ───────────────────────────────────────────────┐
│  fetcher.ts   — tek fetch, TTFB + bytes + robots/sitemap │
│  website.ts   — 15 kanıtlı denetim maddesi               │
│  social.ts    — sinyal bazlı, confidence:'low'           │
│  → website_audits · social_audits                        │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌─ SCORE ─────────────────────────────────────────────────┐
│  business-potential · digital-gap · buying-intent        │
│  → purchase-score → priority                             │
│  → lead_scores                                           │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌─ RECOMMEND ─────────────────────────────────────────────┐
│  offer/rules.ts (tek düzenlenebilir tablo) → engine.ts   │
│  ai/reasoner.ts — deterministik veya Claude              │
│  → offer_recommendations                                 │
└──────────────────────┬───────────────────────────────────┘
                       ▼
              Dashboard (Next.js, SQLite'tan doğrudan okur)
```

## Dosya yapısı

```
src/lib/
  types.ts                 Paylaşılan alan modeli (tek doğruluk kaynağı)
  db/
    schema.sql             SQLite şeması
    client.ts              Bağlantı + güvenli JSON okuma
    repositories/          companies · leads · audits · scores · runs · views
  sources/
    types.ts               LeadSource arayüzü (types.ts içinde)
    overpass.ts            OSM adapter + slot-aware istemci
    apollo.ts              Apollo adapter (2 gerçek mod, sahte veri yok)
    index.ts               Kaynak seçimi (LEAD_SOURCE)
  audit/
    fetcher.ts             HTTP katmanı, probe, Lighthouse (opsiyonel)
    signals.ts             HTML sinyal çıkarma + TR/EN kalıpları
    website.ts             15 maddelik denetim + skor
    social.ts              Sinyal bazlı sosyal denetim
    index.ts               Tek fetch ile ikisini birden çalıştırır
  scoring/
    business-potential.ts  Ödeme gücü
    digital-gap.ts         Doldurulabilir boşluk
    buying-intent.ts       Davranış sinyali çıkarımı
    purchase-score.ts      Birleştirme + modifierlar + priority
  offer/
    rules.ts               A–G kural tablosu (tüm mantık burada)
    engine.ts              Tabloyu çalıştırır, gerekçe paketler
  ai/
    reasoner.ts            Analiz JSON'u (deterministik | Claude)

src/app/                   Dashboard: /, /leads/[id], /api/leads
scripts/                   db-init · discover · audit · score · pipeline
supabase/migrations/       Postgres karşılığı
tests/                     scoring · offer · safety
docs/                      SCORING · APOLLO · SAFETY · ARCHITECTURE
```

## Tasarım kararları

### Neden SQLite (şimdilik)

Sıfır konfigürasyon, container'da anında test edilebilir, dosya kopyalanabilir.
Repository katmanı arayüz üzerinden yazıldı; Supabase'e geçiş yalnızca
`src/lib/db/client.ts` ve repository gövdelerini etkiler. Postgres şeması
`supabase/migrations/0001_init.sql` içinde hazır bekliyor.

### Neden idempotent

`companies` tablosunda `UNIQUE(source, source_ref)` var ve upsert
`COALESCE` kullanıyor. Pipeline'ı tekrar çalıştırmak kayıt çoğaltmaz; yeni
kayıtta `null` olan bir alan varsa eski (muhtemelen elle girilmiş) değer korunur.

Denetimler ise **her çalıştırmada yeni satır** yazar — geçmiş korunur, dashboard
her zaman en güncel satırı gösterir. Bir sitenin zaman içindeki gelişimi
izlenebilir.

### Neden tek fetch

`audit/index.ts` sayfayı bir kez indirir; hem website denetimi hem sosyal link
çıkarımı aynı HTML'i kullanır. Hedef siteye iki istek atılmaz.

### Neden kanıt zorunlu

Her `AuditCheck` bir `evidence` string'i taşır. "İyi/kötü" hükmü her zaman
ölçülen somut bir şeye bağlıdır ve dashboard'da görünür. Bu, skorun neden o
değer olduğu sorusunu kod okumadan cevaplanabilir kılar.

### Neden Overpass slot-aware

`overpass-api.de` kullanıcı başına 2 eşzamanlı slot veriyor. Slot dolunca HTTP
503 veya bağlantı sıfırlaması dönüyor. İstemci her sorgudan önce `/api/status`
okur ve boş slot bekler, ardından üstel backoff ile 3 kez tekrar dener.

Denenip elenen aynalar ve elenme nedenleri `src/lib/sources/overpass.ts`
başındaki yorumda kayıtlı — özellikle `overpass.osm.ch` yanıt veriyor ama
yalnızca İsviçre verisi taşıdığı için **boş ama başarılı** yanıt dönüyordu;
yedek olarak eklenirse "veri yok" ile "sunucu yok" ayırt edilemez hale gelirdi.

## Ortam değişkenleri

Hiçbiri zorunlu değil. Hepsi boşken sistem OSM discovery + yerel performans
sezgiselleri + deterministik gerekçe ile çalışır.

| Değişken | Etkisi |
|---|---|
| `VIVA_DB_PATH` | SQLite yolu (varsayılan `./data/viva.db`) |
| `LEAD_SOURCE` | `osm` (varsayılan) veya `apollo` |
| `APOLLO_API_KEY` | Apollo People Search'ü açar (bkz. `docs/APOLLO.md`) |
| `PAGESPEED_API_KEY` | Gerçek Lighthouse skorları devreye girer |
| `ANTHROPIC_API_KEY` | Gerekçe metnini Claude yazar |
| `ANTHROPIC_MODEL` | Varsayılan `claude-opus-5` |

## Bilinen sınırlar

1. **Instagram metrikleri ölçülemiyor** — login duvarı. Sosyal skor yalnızca
   doğrulanabilir sinyallerden üretilir ve `confidence: 'low'` taşır.
2. **Karar verici bilgisi yok** — Apollo Free plan kısıtı. Alanlar `NULL`.
3. **Çalışan sayısı yok** — OSM bu veriyi taşımaz. Skorlamada bileşen olarak
   hiç sayılmaz (sıfır gibi cezalandırılmaz).
4. **Google sıralaması ölçülemiyor** — bu sistemden ölçülemez. Onun yerine
   "indekslenebilirlik" ölçülür ve madde bilinçli olarak öyle adlandırılmıştır.
5. **İlçe kademeleri sezgisel** — `business-potential.ts` içindeki tablo bir
   tahmindir, kesin veri değildir; dokümante edilmesinin sebebi skorun neden
   değiştiği sorusuna cevap verebilmektir.
