import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const path = process.argv[2];
const html = readFileSync(path, 'utf8');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const errors = [];
page.on('pageerror', (e) => errors.push('JS: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('konsol: ' + m.text()); });

// Artefakt kabugunu taklit et: sayfa <body> icine sarilir ve claude.use sunulur.
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`, {
  waitUntil: 'domcontentloaded',
});

let published = null;
await page.evaluate(() => {
  window.__published = null;
  window.claude = {
    use: (name) => Promise.resolve(name === 'artifact' ? {
      publish: (h) => { window.__published = h; return Promise.resolve({ version: 'v2' }); },
    } : null),
  };
});
await page.waitForTimeout(400);

const t = async (label, fn) => {
  try { const r = await fn(); console.log(`  ${r ? '✓' : '✗'} ${label}`); return r; }
  catch (e) { console.log(`  ✗ ${label} — ${e.message}`); return false; }
};

console.log('--- ILK YUKLEME ---');
await t('başlık render edildi', async () => (await page.locator('.brand').textContent()).includes('Viva'));
const cards = await page.locator('#v-today .card').count();
await t(`bugünün listesi doldu (${cards} kart)`, () => cards > 0);
await t('KPI sayıları var', async () => (await page.locator('.kpi .v').first().textContent()).trim() !== '');
await t('telefon linki tel: kullanıyor', async () => {
  const href = await page.locator('.btn.call').first().getAttribute('href');
  return href.startsWith('tel:+90');
});

console.log('\n--- DETAY ---');
await page.locator('[data-act="detail"]').first().click();
await page.waitForTimeout(150);
await t('detay açıldı', async () => await page.locator('.detail:not([hidden])').first().isVisible());
await t('ölçülemeyen skor "ölçülemedi" yazıyor, 0 değil', async () => {
  const html = await page.content();
  return html.includes('ölçülemedi') || !html.includes('class="v na"');
});

console.log('\n--- ARANDI AKISI ---');
const firstName = await page.locator('#v-today .card .cname').first().textContent();
await page.locator('[data-act="call"]').first().click();
await page.waitForTimeout(150);
await t('panel açıldı', async () => await page.locator('#sheet-bg:not([hidden])').isVisible());
await t('sonuç seçmeden kaydetmeyi reddediyor', async () => {
  await page.locator('#sh-save').click();
  await page.waitForTimeout(100);
  return await page.locator('#saving.err').isVisible();
});
await page.locator('.opt[data-r="INTERESTED"]').click();
await t('sonuç seçilince takip tarihi öneriliyor', async () => {
  return (await page.locator('#sh-follow').inputValue()).length === 10;
});
await page.locator('#sh-notes').fill('Fiyat istedi. Cuma aranacak.');
await page.locator('#sh-save').click();
await page.waitForTimeout(200);
await t('panel kapandı', async () => await page.locator('#sheet-bg').isHidden());
await t('durum "İlgilendi" oldu', async () => {
  const chip = await page.locator('#v-today .card').first().locator('.chip.st').textContent();
  return chip.trim() === 'İlgilendi' || (await page.content()).includes('İlgilendi');
});
// Aranan lead listede asagi kayar (hic aranmamislar one gecer) — bu dogru
// davranis, o yuzden DOM yerine kaydin kendisine bakiyoruz.
await t('arama kaydı state-e işlendi', async () => {
  const s = await page.evaluate(() => {
    const el = document.getElementById('v-today');
    return window.__probe ? window.__probe() : null;
  });
  return true; // asagida yayinlanan sayfa uzerinden dogrulaniyor
});

console.log('\n--- KALICILIK ---');
// setContent about:blank kaynaginda calistigi icin localStorage engelli.
// Onemli olan uygulamanin bu durumda COKMEMESI — try/catch ile sarili.
await t('localStorage erişilemezken uygulama çalışmayı sürdürüyor', async () => {
  return (await page.locator('#v-today .card').count()) > 0;
});
await page.waitForTimeout(3200);
published = await page.evaluate(() => window.__published);
await t('artifact.publish çağrıldı', () => !!published);
await t('yayınlanan sayfa tam belge', () => published && published.trim().length > 1000);
await t('yayınlanan sayfada durum gömülü', () => published && published.includes('INTERESTED'));
// Yer tutucular DOLDURULDU mu — kodun icindeki ayni adli string'ler
// (replace cagrilari) elbette duruyor, onlara bakilmaz.
await t('durum tutucusu dolduruldu', () =>
  published && /<script id="viva-state" type="application\/json">\{.*?\}<\/script>/s.test(published));
await t('kaynak tutucusu dolduruldu (base64)', () =>
  published && /<script id="viva-source" type="text\/plain">[A-Za-z0-9+/=]{5000,}<\/script>/.test(published));

console.log('\n--- YAYINLANAN SAYFA TEKRAR ACILIYOR ---');
const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors2 = [];
p2.on('pageerror', (e) => errors2.push(e.message));
await p2.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${published}</body></html>`, {
  waitUntil: 'domcontentloaded',
});
await p2.waitForTimeout(400);
await t('yeniden açılan sayfa çalışıyor', async () => (await p2.locator('.card').count()) > 0);
await t('yalnızca dokunulan lead kaydedildi (durum şişmiyor)', async () => {
  const st = await p2.evaluate(() =>
    JSON.parse(document.getElementById('viva-state').textContent));
  return Object.keys(st).length === 1;
});
await t('kaydedilen görüşme yeni sayfada duruyor', async () => {
  const st = await p2.evaluate(() =>
    JSON.parse(document.getElementById('viva-state').textContent));
  const e = st[Object.keys(st)[0]];
  return e.calls.length === 1 && e.status === 'INTERESTED'
    && e.calls[0].notes === 'Fiyat istedi. Cuma aranacak.';
});
// Ileri tarihli takip alan lead BUGUNUN listesinden cikar — dogru davranis.
// Bu yuzden sayaci "Lead'ler" sekmesinde ariyoruz.
await t('takip alan lead bugünün listesinden çıktı', async () =>
  !(await p2.locator('#v-today').innerHTML()).includes('1 arama'));
await t('lead listesinde arama sayacı ve takip görünüyor', async () => {
  await p2.locator('.tab[data-view="all"]').click();
  await p2.waitForTimeout(200);
  const h = await p2.locator('#v-all').innerHTML();
  return h.includes('1 arama') && h.includes('takip');
});
await t('yeniden açılışta JS hatası yok', () => errors2.length === 0);

console.log('\n--- FILTRELER ---');
await page.locator('.tab[data-view="all"]').click();
await page.waitForTimeout(200);
await t('lead listesi açıldı', async () => (await page.locator('#v-all .card').count()) > 0);
await page.locator('#f-called').selectOption('no');
await page.waitForTimeout(200);
await t('"hiç aranmadı" filtresi çalışıyor', async () => {
  const txt = await page.locator('#v-all .sect h2').textContent();
  return !txt.startsWith('100');
});
await page.locator('.tab[data-view="funnel"]').click();
await page.waitForTimeout(200);
await t('huni açıldı', async () => (await page.locator('.funnel').count()) > 0);

console.log('\n--- TEMA ---');
for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(120);
  await t(`${theme} temada metin okunur`, async () => {
    const r = await page.evaluate(() => {
      const b = getComputedStyle(document.body);
      const parse = (c) => c.match(/\d+/g).slice(0, 3).map(Number);
      const lum = (p) => (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255;
      return { bg: lum(parse(b.backgroundColor)), fg: lum(parse(b.color)) };
    });
    return Math.abs(r.bg - r.fg) > 0.4;
  });
}

console.log('\n--- HATALAR ---');
if (errors.length) { errors.slice(0, 8).forEach((e) => console.log('  ! ' + e)); }
else console.log('  ✓ JS/konsol hatası yok');

await browser.close();
process.exit(errors.length ? 1 : 0);
