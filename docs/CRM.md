# Satış Takip Merkezi

Araştırma motorunun üstüne kurulu günlük satış uygulaması. Analiz katmanına
(Places → Website Audit → Social Discovery → Scoring → Offer Engine)
**dokunmaz**; onun ürettiği lead'leri satış sürecinde ilerletir.

## Ekranlar

| Yol | Ne yapar |
|---|---|
| `/` | Dashboard — KPI'lar, bugünün satış listesi, gecikmiş takipler, dönüşüm hunisi |
| `/leads` | Filtrelenebilir lead tablosu, satır içi hızlı aksiyonlar |
| `/leads/[id]` | Analiz + satış paneli + görüşme geçmişi + zaman çizelgesi |
| `/api/leads` | JSON export |

## İki ayrı durum alanı

Bu ayrım bilinçli ve önemli:

| Alan | Anlamı | Değerler |
|---|---|---|
| `leads.status` | **Sistem** bu lead'i işledi mi | `discovered` → `analyzed` → `scored` |
| `leads.sales_status` | **Satış** süreci nerede | `NEW` → `READY_TO_CALL` → … → `WON`/`LOST` |

Aynı kolona sıkıştırılsaydı, yeniden analiz çalıştırmak satış geçmişini
silerdi. Pipeline'ı istediğiniz kadar tekrar çalıştırabilirsiniz; görüşme
kayıtlarınız etkilenmez.

### Satış durumları

`NEW` Yeni · `READY_TO_CALL` Aranacak · `CALLED` Arandı · `NO_ANSWER` Ulaşılamadı ·
`CALLBACK` Geri aranacak · `INTERESTED` İlgilendi · `NOT_INTERESTED` İlgilenmedi ·
`OFFER_SENT` Teklif Gönderildi · `NEGOTIATION` Görüşme / Pazarlık ·
`WON` Kazanıldı · `LOST` Kaybedildi · `DO_NOT_CONTACT` İletişim Kurma

## "Ara" ile "Arandı" neden ayrı

**"📞 Ara"** yalnızca telefon uygulamasını açar (`tel:` URI). Sayaç **artmaz**.

**"Arandı"** paneli açar; kaydettiğinizde `call_count` artar, `last_called_at`
işlenir ve seçtiğiniz sonuç lead'i doğru duruma taşır.

Neden: butona tıklayıp vazgeçmek, meşgule düşmek, yanlış numara — bunların
hiçbiri "aradım" değildir. Sayacı tıklamaya bağlasaydık istatistikler
şişerdi. Sayaç `logCall()` içinde tek bir yerde artar ve bunu bir güvenlik
testi doğrular.

### Sonuç → durum eşlemesi

| Görüşme sonucu | Yeni durum |
|---|---|
| Ulaşıldı | CALLED |
| Ulaşılamadı | NO_ANSWER |
| İlgilendi | INTERESTED |
| Teklif istedi | INTERESTED |
| Geri aranacak | CALLBACK |
| İlgilenmedi | NOT_INTERESTED |
| Yanlış numara | DO_NOT_CONTACT |

Sonuç seçince mantıklı bir takip tarihi önerilir (ulaşılamadı → yarın,
geri aranacak → 3 gün). Öneri, zorunluluk değil.

## Bugünün satış listesi

Sıralama:

1. HOT → 2. HIGH → 3. purchase score → 4. hiç aranmamış → 5. adı

Listeye **girmeyenler**: telefonu olmayanlar, kapanmış lead'ler
(WON/LOST/ilgilenmedi/iletişim kurma), takip tarihi ileri olanlar.

Günlük liste yapılacak işi gösterir, arşivi değil.

## Filtreler

Filtreler URL'de tutulur — `?called=no&minPurchase=65` gibi bir sorgu yer
imine eklenebilir ve her sabah tek tıkla açılır.

Öncelik · durum · kategori · ilçe · purchase/website/social alt sınırı ·
arandı/aranmadı · takip · teklif · serbest arama (Türkçe karakter duyarsız).

> **Skor filtreleri ölçülemeyen lead'i eler ama "kötü" saymaz.** `minWebsite=50`
> filtresi bot koruması arkasındaki bir siteyi listeden çıkarır çünkü skoru
> yoktur — skoru düşük olduğu için değil.

## Takip

Bir lead'in aynı anda **tek açık takibi** olur; yeni takip eskisini iptal
eder. Aksi halde "bugün takip edilecekler" listesi aynı lead'le dolardı.

Tarihi geçmiş takipler dashboard'da ayrı ve üstte gösterilir.

## Teklif

`Hizmet` zorunlu, `tutar` **isteğe bağlı** — girilmezse `NULL` kalır, tahmin
edilmez. Açık teklif Kazanıldı/Kaybedildi ile kapatılır ve lead durumu
otomatik güncellenir.

## Zaman çizelgesi

Tamamen `sales_events` tablosundan üretilir. Kaydedilmemiş bir adım
çizelgede **görünmez** — varsayılan adım uydurulmaz.

Olaylar: `lead_discovered`, `website_audited`, `social_audited`,
`lead_scored`, `status_changed`, `call_logged`, `follow_up_scheduled`,
`follow_up_completed`, `offer_sent`, `offer_closed`.

## Dönüşüm oranları

Arama→Ulaşma · Ulaşma→İlgi · İlgi→Teklif · Teklif→Satış · Lead→Satış

Payda sıfırsa oran `null` döner ve ekranda `—` görünür. %0 yazmak "hiç
başaramadın" gibi okunurdu; oysa henüz veri yok.

## READY_TO_CALL kuralı

Otomatik tarama sonrası `npm run score` şu koşulları sağlayan lead'leri
aranmaya hazır işaretler:

- satış durumu hâlâ `NEW` (elle verdiğiniz kararlar korunur)
- **telefon numarası var**
- skorlama tamamlanmış

Telefonu olmayan lead arama listesine girerse liste kirlenir.

## Mükerrer kontrolü

Aynı işletme farklı kaynaklardan gelirse yeni satır açılmaz. Kimlik sırası:

1. kaynak + kaynak referansı (Google Place ID dahil) — kesin
2. website alan adı — çok güçlü
3. telefon (son 10 hane; `0533…`, `+90533…` aynı numaraya iner)
4. normalize edilmiş isim **+ aynı ilçe** — zayıf

4. adımda ilçe şartı bilinçli: "Fit Life" adında iki ayrı salon farklı
ilçelerde olabilir ve birleştirmek gerçek bir lead'i yok ederdi.

Mükerrer bulunduğunda mevcut kayıt **zenginleştirilir**; dolu alanlar
ezilmez.

## Güvenlik sınırı

Sistem **hiçbir iletişimi kendiliğinden başlatmaz**:

- otomatik e-posta yok
- otomatik SMS / WhatsApp yok
- otomatik arama yok
- Apollo'ya yazma yok

`src/app/actions/sales.ts` içinde tek bir dış istek yoktur ve
`tests/safety.test.ts` bunu her çalıştırmada doğrular. "Ara" butonu yalnızca
sizin telefon uygulamanızı açar.

## Çalıştırma

```bash
npm install
npm run db:init          # yeni tabloları ekler, mevcut veriyi korur
npm run dev              # http://localhost:3000

# araştırma tarafı (mevcut sistem, değişmedi)
npm run pipeline -- --limit 100 --city istanbul --source places
npm run verify           # uçtan uca doğrulama
```
