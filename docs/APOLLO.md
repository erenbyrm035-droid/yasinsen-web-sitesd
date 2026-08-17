# Apollo Entegrasyonu — Mevcut Durum ve Açma Adımları

## Özet

Apollo hesabı **bağlı ve çalışıyor**, ancak **Free plan** olduğu için şartnamedeki
ana Lead Discovery ucu kapalı. Bu yüzden MVP discovery OpenStreetMap üzerinden
çalışıyor; Apollo adapter yazıldı ama devre dışı.

**Sahte entegrasyon üretilmedi.** Apollo adapter'ı ya gerçek istek atar ya da
tipli bir hata fırlatır — hiçbir koşulda uydurma lead üretmez.

## Doğrulanan durum (2026-08-17)

| Kontrol | Sonuç |
|---|---|
| Hesap | Eren Bayram · `erenbyrm43@gmail.com` |
| Kalan kredi | 190 (lead 205, direct dial 160, AI 5000) |
| `mixed_people/api_search` | ❌ `API_INACCESSIBLE` |

Dönen hata, birebir:

```json
{
  "error": "The api/v1/mixed_people/api_search API is not included in your Free plan
            and is not accessible. All paid plans include full API access.
            Upgrade your plan from https://www.apollo.io/pricing",
  "error_code": "API_INACCESSIBLE"
}
```

## Bunun sisteme etkisi

| Alan | Durum |
|---|---|
| İşletme keşfi | OSM/Overpass üzerinden çalışıyor — gerçek İstanbul verisi |
| Şirket adı, adres, ilçe, telefon, website | OSM'den geliyor |
| **Karar verici (Owner / Founder / GM)** | **`NULL`** — dashboard'da "veri yok" olarak görünür |
| **Karar verici e-postası / LinkedIn** | **`NULL`** |
| Çalışan sayısı | `NULL` — OSM bu veriyi taşımaz |

Karar verici alanları boş kalır çünkü **e-posta tahmin edilmez.** `info@domain`
gibi kalıplarla adres üretmek yanlış veridir; `tests/safety.test.ts` bu kalıbın
kod tabanına girmesini engeller.

## Apollo'yu açmak

### 1. Plan yükseltme (önerilen yol)

Apollo planı ücretli bir seviyeye yükseltildikten sonra:

```bash
# .env
LEAD_SOURCE=apollo
APOLLO_API_KEY=<apollo api anahtarınız>
```

Ardından pipeline değişmeden çalışır:

```bash
npm run pipeline -- --limit 10 --city istanbul
```

Adapter `src/lib/sources/apollo.ts` şu filtrelerle arar:

- `person_locations`: verilen şehir
- `person_titles`: Owner, Founder, Co-Founder, General Manager, Business Owner, Studio Owner, Gym Owner
- `organization_num_employees_ranges`: `1,50`
- `q_organization_keyword_tags`: fitness, gym, pilates, crossfit, personal training

### 2. Anahtar olmadan — MCP çıktısını içe aktarma

Apollo'ya bu oturumdaki gibi MCP üzerinden erişilebiliyorsa, arama sonucu bir
dosyaya kaydedilip okutulabilir:

```bash
# Apollo MCP arama sonucunu bu dosyaya kaydedin:
#   data/apollo-import.json
# Kabul edilen şekiller: { "people": [...] } | { "contacts": [...] } | [...]

LEAD_SOURCE=apollo npm run discover -- --limit 10
```

Dosya `.gitignore`'dadır — kişisel veri içerebileceği için depoya girmez.

### 3. Hiçbiri yoksa

Adapter tipli `ApolloUnavailableError` fırlatır ve pipeline şu mesajla durur:

```
[discover] "apollo" kaynağı kullanılamıyor: APOLLO_API_KEY tanımlı değil ve
data/apollo-import.json yok. Apollo hesabı Free plan olduğu için People Search
API kapalı (docs/APOLLO.md).
```

Sessizce sahte veriye düşülmez.

## Güvenlik sınırı — Apollo'da ne YAPILMAZ

Adapter **yalnızca okuma** yapar. Kod tabanında şu uçlara referans bulunmadığı
`tests/safety.test.ts` tarafından her test çalıştırmasında doğrulanır:

- `apollo_contacts_create` · `apollo_contacts_bulk_create` · `apollo_contacts_update`
- `apollo_accounts_create` · `apollo_accounts_bulk_create` · `apollo_accounts_update`
- `apollo_sequences_create` · `apollo_sequences_update`
- `apollo_emailer_campaigns_add_contact_ids` · `apollo_emailer_messages_create` · `apollo_emailer_messages_send_now`
- `apollo_tasks_create` · `apollo_tasks_bulk_create`

Ayrıca test, adapter'ın istek attığı tüm `api.apollo.io` URL'lerinin `/search`
ile bitmesini zorunlu kılar.

## Kilitli e-posta davranışı

Apollo, açılmamış e-postaları `email_not_unlocked@domain.com` gibi bir
placeholder ile döner. Adapter bunu **gerçek e-posta olarak saklamaz** —
`null`'a çevirir (`realEmailOrNull`). Bu davranış da testle kilitlidir.
