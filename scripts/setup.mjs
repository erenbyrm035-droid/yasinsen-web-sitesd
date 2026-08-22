#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * TEK KOMUTLA KURULUM — `npm run kur`
 *
 * Amaci: kullanicinin tek yapmasi gereken sey bu komut olsun. Node surumunu
 * dogrular, veritabanini hazirlar, .env yoksa olusturur ve neyin eksik
 * oldugunu ACIKCA soyler.
 *
 * Hicbir seyi sessizce yapmaz: her adim ne yaptigini yazar, basarisiz olursa
 * ne yapilmasi gerektigini soyler.
 */

const ROOT = process.cwd();
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const fail = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

let blocked = false;

head('1. Node.js sürümü');
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) {
  ok(`Node ${process.versions.node}`);
} else {
  fail(`Node ${process.versions.node} — en az 20 gerekli.`);
  console.log('    nodejs.org adresinden LTS sürümünü kurun, sonra bu komutu tekrar çalıştırın.');
  blocked = true;
}

head('2. Bağımlılıklar');
if (existsSync(resolve(ROOT, 'node_modules/next'))) {
  ok('Kurulu');
} else {
  console.log('  Kuruluyor, bu birkaç dakika sürebilir…');
  try {
    execSync('npm install', { stdio: 'inherit' });
    ok('Kuruldu');
  } catch {
    /**
     * En sik karsilasilan basarisizlik: better-sqlite3 gibi yerel (native)
     * bir modul icin hazir ikili bulunamamasi. npm o zaman kaynaktan
     * derlemeye calisiyor ve Python + C++ derleyicisi istiyor.
     *
     * Kullaniciya "internet baglantinizi kontrol edin" demek burada YANLIS
     * yonlendirme olur — sorun ag degil, Node surumu ile paket surumunun
     * uyusmamasi. Gercek nedeni ve cozumu soyluyoruz.
     */
    const nativeBuildFailed = existsSync(resolve(ROOT, 'node_modules/better-sqlite3')) &&
      !existsSync(resolve(ROOT, 'node_modules/better-sqlite3/build'));

    if (nativeBuildFailed) {
      fail('Veritabanı modülü (better-sqlite3) kurulamadı.');
      console.log('');
      console.log(`    Node ${process.versions.node} için hazır ikili dosya bulunamadı ve npm`);
      console.log('    kaynaktan derlemeye çalıştı — bunun için Python ve C++ derleyicisi gerekiyor.');
      console.log('');
      console.log('    \x1b[1mÇözüm (sırayla deneyin):\x1b[0m');
      console.log('');
      console.log('    1. Projeyi güncelleyin — büyük ihtimalle bu yeter:');
      console.log('       \x1b[36mgit pull\x1b[0m');
      console.log('       \x1b[36mnpm run kur\x1b[0m');
      console.log('');
      console.log('    2. Yine olmazsa Node 22 LTS kurun (nodejs.org → Önceki Sürümler).');
      console.log('       Node 22 için hazır ikili her zaman mevcut, derleme gerekmez.');
      console.log('');
    } else {
      fail('npm install başarısız. Yukarıdaki hata mesajına bakın.');
      console.log('    Ağ hatasıysa tekrar deneyin: \x1b[36mnpm run kur\x1b[0m');
    }
    blocked = true;
  }
}

head('3. Ayar dosyası');
const envPath = resolve(ROOT, '.env');
if (existsSync(envPath)) {
  ok('.env mevcut — dokunulmadı');
} else {
  writeFileSync(
    envPath,
    `# Google Places — yeni işletme keşfi için.
# Tanımlı değilse sistem OpenStreetMap'e düşer (telefon/yorum verisi olmadan).
GOOGLE_MAPS_API_KEY=

# PageSpeed — gerçek Lighthouse performans skoru için.
# Tanımlı değilse yerel performans ölçümü kullanılır.
PAGESPEED_API_KEY=

# Claude — doğal dil satış gerekçesi için.
# Tanımlı değilse gerekçe denetim bulgularından deterministik üretilir.
ANTHROPIC_API_KEY=
`,
    'utf8',
  );
  ok('.env oluşturuldu (anahtarlar boş — sistem onlarsız da çalışır)');
}

head('4. Veritabanı');
if (blocked) {
  warn('Bağımlılıklar kurulmadan veritabanı hazırlanamaz — atlandı.');
} else try {
  mkdirSync(resolve(ROOT, 'data'), { recursive: true });
  const fresh = !existsSync(resolve(ROOT, 'data/viva.db'));
  execSync('npm run db:init', { stdio: 'pipe' });
  ok(fresh ? 'Oluşturuldu' : 'Güncellendi — mevcut verileriniz korundu');
} catch (err) {
  fail(`Veritabanı hazırlanamadı: ${err.message}`);
  blocked = true;
}

head('5. Kendi kendini sınama');
if (blocked) {
  warn('Atlandı.');
} else try {
  execSync('npm test', { stdio: 'pipe' });
  ok('Testler geçti');
} catch {
  warn('Testler geçmedi — sistem yine de çalışır ama bir sorun olabilir.');
}

head('6. Mevcut veri');
if (blocked) {
  warn('Atlandı.');
} else try {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(resolve(ROOT, 'data/viva.db'), { readonly: true });
  const n = (q) => { try { return db.prepare(q).get().n; } catch { return 0; } };
  const leads = n('SELECT COUNT(*) n FROM leads');
  if (leads === 0) {
    warn('Henüz lead yok. Aşağıdaki 2. adımı çalıştırın.');
  } else {
    ok(`${leads} lead · ${n('SELECT COUNT(*) n FROM call_logs')} görüşme kaydı · ${n('SELECT COUNT(*) n FROM offers')} teklif`);
  }
  db.close();
} catch {
  warn('Veritabanı okunamadı.');
}

console.log('\n' + '─'.repeat(58));
if (blocked) {
  console.log('\x1b[31mKurulum tamamlanamadı.\x1b[0m Yukarıdaki ✗ satırlarını çözüp tekrar deneyin.\n');
  process.exit(1);
}

console.log('\x1b[32m\x1b[1mKurulum tamam.\x1b[0m\n');
console.log('Şimdi ne yapabilirsiniz:\n');
console.log('  \x1b[1mnpm start\x1b[0m');
console.log('    Uygulamayı açar → http://localhost:3000\n');
console.log('  \x1b[1mnpm run tara\x1b[0m');
console.log('    Yeni işletme keşfeder, analiz eder, puanlar.');
console.log('    (Google Places anahtarı .env dosyasında tanımlıysa daha iyi veri gelir)\n');
console.log('  \x1b[1mnpm run verify\x1b[0m');
console.log('    Sistemin kendi kurallarına uyduğunu denetler.\n');
