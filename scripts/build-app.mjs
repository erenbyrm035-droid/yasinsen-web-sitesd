import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Telefon surumunu derler.
 *
 * Sayfa kendi kaynagini base64 olarak tasir: yayinlarken canli DOM
 * serilestirilmez (calisma zamani betikleri ve bu goruntuye ozel durum
 * oraya sizardi), kaynak sablonu cozulup yalnizca durum yerine konur.
 * Boylece her yayin ilk yayinla birebir ayni sayfayi uretir.
 */

const [shellPath, dataPath, outPath] = process.argv.slice(2);
if (!shellPath || !dataPath || !outPath) {
  console.error('Kullanım: node scripts/build-app.mjs <kabuk.html> <veri.json> <çıktı.html>');
  process.exit(1);
}

const shell = readFileSync(resolve(shellPath), 'utf8');
const data = readFileSync(resolve(dataPath), 'utf8');

// </script> dizisi gomulu JSON'u erken kapatir.
const safeData = data.replace(/<\//g, '<\\/');

// Sablon: veri gomulu, durum ve kaynak yer tutucusu duruyor.
const template = shell.replace('__LEADS__', safeData);

if (!template.includes('__SOURCE__') || !template.includes('__STATE__')) {
  console.error('HATA: __SOURCE__ ya da __STATE__ yer tutucusu kayboldu.');
  process.exit(1);
}

const encoded = Buffer.from(template, 'utf8').toString('base64');
const page = template.replace('__SOURCE__', encoded).replace('__STATE__', '{}');

writeFileSync(resolve(outPath), page, 'utf8');

// Yayin dongusunun kapali oldugunu dogrula: sayfanin tasidigi kaynak,
// tekrar cozuldugunde ayni sablonu vermeli.
const roundTrip = Buffer.from(encoded, 'base64').toString('utf8');
if (roundTrip !== template) {
  console.error('HATA: kaynak şablonu gidip gelirken bozuldu.');
  process.exit(1);
}

console.log(
  `[build-app] ${outPath} — ${(page.length / 1024).toFixed(0)}KB ` +
    `(veri ${(data.length / 1024).toFixed(0)}KB, kaynak ${(encoded.length / 1024).toFixed(0)}KB)`,
);
