import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * SAFETY TESTLERI
 *
 * Sartnamedeki kisitlar burada makine tarafindan dogrulanir:
 *   - hicbir lead'e otomatik mesaj/e-posta gonderilmez
 *   - Apollo'da hicbir kayit olusturulmaz/guncellenmez
 *   - hicbir sequence baslatilmaz
 *
 * Bu testler kod tabanini tarar; yasak bir cagri eklenirse CI kirilir.
 */

const ROOT = resolve(import.meta.dirname, '..');
const SCAN_DIRS = ['src', 'scripts'];

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const SOURCE_FILES = SCAN_DIRS.flatMap((d) => collectSourceFiles(join(ROOT, d)));

/** Kaynak dosyayi yorum satirlari cikarilmis halde dondurur. */
function codeWithoutComments(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

describe('Gonderim yasagi', () => {
  test('package.json hicbir e-posta/SMS gonderim bagimliligi icermez', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

    const forbidden = [
      'nodemailer', 'sendgrid', '@sendgrid/mail', 'mailgun', 'mailgun.js',
      'postmark', 'resend', 'twilio', 'aws-sdk-ses', '@aws-sdk/client-ses',
      'emailjs', 'smtp', 'mailchimp', 'sib-api-v3-sdk',
    ];

    const found = deps.filter((d) => forbidden.some((f) => d.toLowerCase().includes(f)));
    assert.deepEqual(found, [], `Gönderim bağımlılığı bulundu: ${found.join(', ')}`);
  });

  test('kod tabaninda SMTP/mail gonderim cagrisi yok', () => {
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const code = codeWithoutComments(file);
      if (/createTransport|sendMail|nodemailer|sgMail|\.messages\(\)\.send\(/.test(code)) {
        offenders.push(file.replace(`${ROOT}/`, ''));
      }
    }
    assert.deepEqual(offenders, [], `Gönderim çağrısı bulundu: ${offenders.join(', ')}`);
  });
});

describe('Apollo yazma yasagi', () => {
  test('Apollo yazma/sequence uclarina referans yok', () => {
    // Bu uclar Apollo MCP'de mevcut ama sistem yalnizca OKUMA yapar.
    const forbiddenEndpoints = [
      'apollo_contacts_create',
      'apollo_contacts_bulk_create',
      'apollo_contacts_update',
      'apollo_accounts_create',
      'apollo_accounts_bulk_create',
      'apollo_accounts_update',
      'apollo_sequences_create',
      'apollo_sequences_update',
      'apollo_emailer_campaigns_add_contact_ids',
      'apollo_emailer_messages_create',
      'apollo_emailer_messages_send_now',
      'apollo_tasks_create',
      'apollo_tasks_bulk_create',
    ];

    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const code = codeWithoutComments(file);
      for (const endpoint of forbiddenEndpoints) {
        if (code.includes(endpoint)) {
          offenders.push(`${file.replace(`${ROOT}/`, '')} → ${endpoint}`);
        }
      }
    }
    assert.deepEqual(offenders, [], `Apollo yazma referansı bulundu:\n${offenders.join('\n')}`);
  });

  test('Apollo adapter yalnizca arama ucuna istek atar', () => {
    const apolloSource = readFileSync(join(ROOT, 'src/lib/sources/apollo.ts'), 'utf8');
    const urls = [...apolloSource.matchAll(/https:\/\/api\.apollo\.io[^\s'"`]*/g)].map((m) => m[0]);

    assert.ok(urls.length > 0, 'Apollo adapter bir uç tanımlamalı');
    for (const url of urls) {
      assert.match(url, /\/search$/, `Arama dışı Apollo ucu: ${url}`);
    }
  });
});

describe('Outreach yasagi', () => {
  test('mesajlasma/outreach modulu yok', () => {
    const forbiddenPaths = ['src/lib/outreach', 'src/lib/email', 'src/lib/messaging', 'src/lib/campaigns'];
    for (const path of forbiddenPaths) {
      let exists = true;
      try {
        statSync(join(ROOT, path));
      } catch {
        exists = false;
      }
      assert.equal(exists, false, `Yasak modül mevcut: ${path}`);
    }
  });

  test('WhatsApp tespiti yalnizca denetim sinyalidir, gonderim degildir', () => {
    // Kod tabaninda wa.me gecmesi normaldir (sitede WhatsApp linki var mi?),
    // ama WhatsApp Business API'sine POST atilmamalidir.
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const code = codeWithoutComments(file);
      if (/graph\.facebook\.com|whatsapp.*\/messages|api\.whatsapp\.com\/send\?.*text=/i.test(code)) {
        offenders.push(file.replace(`${ROOT}/`, ''));
      }
    }
    assert.deepEqual(offenders, [], `WhatsApp gönderim çağrısı: ${offenders.join(', ')}`);
  });
});

describe('Veri durustlugu', () => {
  test('e-posta tahmin/uretme kalibi yok', () => {
    // "info@" + domain gibi kaliplarla e-posta URETILMEZ.
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const code = codeWithoutComments(file);
      if (/['"`](?:info|contact|hello|iletisim)@['"`]\s*\+|@\$\{\s*domain\s*\}/i.test(code)) {
        offenders.push(file.replace(`${ROOT}/`, ''));
      }
    }
    assert.deepEqual(offenders, [], `E-posta tahmin kalıbı bulundu: ${offenders.join(', ')}`);
  });

  test('Apollo kilitli e-posta placeholder\'i gercek e-posta olarak saklanmaz', () => {
    const apolloSource = readFileSync(join(ROOT, 'src/lib/sources/apollo.ts'), 'utf8');
    assert.match(apolloSource, /email_not_unlocked/);
  });
});

describe('Sosyal medya kazima yasagi', () => {
  test('Instagram/Facebook profil sayfalari icerik icin CEKILMEZ', () => {
    // probeUrl yalnizca "bu URL 200 mu 404 mu" sorusunu sorar (HTTP durum
    // kontrolu). Profil HTML'ini indirip icerigini ayristirmak baska sey:
    // login duvari yuzunden zaten ise yaramaz ve platform kosullarina aykiri.
    for (const file of SOURCE_FILES) {
      const code = readFileSync(file, 'utf8');
      if (/fetchPage\(\s*[`'"][^`'"]*(?:instagram|facebook|tiktok)\.com/i.test(code)) {
        assert.fail(`${file}: sosyal medya profil sayfasi dogrudan indiriliyor`);
      }
      if (/graphql|__a=1|\?__d=|window\._sharedData/i.test(code)) {
        assert.fail(`${file}: sosyal medya ic API'sine erisim izi var`);
      }
    }
  });

  test('arama motoru HTML kazima kodu yok — yalnizca resmi API', () => {
    for (const file of SOURCE_FILES) {
      const code = readFileSync(file, 'utf8');
      // Yorum satirlarini ayikla: neden kazimadigimizi ACIKLAYAN yorumlar var.
      const withoutComments = code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      if (/https?:\/\/(?:www\.)?(?:bing|duckduckgo|google)\.[a-z.]+\/(?:search|html)/i.test(withoutComments)) {
        assert.fail(`${file}: arama motoru sonuc sayfasi kaziniyor`);
      }
    }
  });

  test('dogrulanmamis sosyal profil kaydedilmez', () => {
    const discovery = readFileSync(
      resolve(ROOT, 'src/lib/audit/social-discovery.ts'),
      'utf8',
    );
    assert.match(discovery, /MATCH_THRESHOLD/, 'dogrulama esigi tanimli olmali');
    assert.match(
      discovery,
      /verdict\.score\s*<\s*MATCH_THRESHOLD/,
      'esigin altindaki aday reddedilmeli',
    );
  });
});

describe('Satis CRM otomatik iletisim baslatmaz', () => {
  /**
   * Satis takibi eklenince yeni bir risk yuzeyi olustu: bir "Ara" butonu
   * gercekten arama BASLATABILIR, bir teklif akisi e-posta gonderebilirdi.
   * Bu testler o sinirin korundugunu dogrular.
   */
  const sources = SOURCE_FILES;

  test('tel: disinda otomatik cagri/mesaj protokolu kullanilmaz', () => {
    for (const file of sources) {
      const code = readFileSync(file, 'utf8');
      // sms: ve whatsapp: seması mesaj taslagi acar — kullanici onayi olmadan
      // iletisim baslatmaya en yakin sey budur, bu yuzden hic kullanilmaz.
      assert.ok(
        !/href=\{?["'`]sms:/i.test(code),
        `${file} sms: baglantisi iceriyor`,
      );
      assert.ok(
        !/wa\.me\/\d|api\.whatsapp\.com\/send/i.test(code) || file.includes('signals.ts'),
        `${file} WhatsApp gonderim baglantisi iceriyor`,
      );
    }
  });

  test('arama sayaci yalnizca kullanici kaydiyla artar', () => {
    const repo = readFileSync(join(ROOT, 'src/lib/db/repositories/sales.ts'), 'utf8');
    const increments = repo.match(/call_count\s*\+\s*1/g) ?? [];
    assert.equal(
      increments.length,
      1,
      'call_count tek bir yerde artmali (logCall) — "Ara" tiklamasi sayaci artirmamali',
    );

    // "Ara" butonu yalnizca tel: acar, sunucuya hicbir sey yazmaz.
    const actions = readFileSync(join(ROOT, 'src/app/components/LeadActions.tsx'), 'utf8');
    assert.ok(!/call_count|logCall|fetch\(/.test(actions), 'Ara butonu sayac yazmamali');
  });

  test('satis aksiyonlarinda dis servise istek yok', () => {
    const actions = readFileSync(join(ROOT, 'src/app/actions/sales.ts'), 'utf8');
    assert.ok(
      !/fetch\(|axios|http\.request|https:\/\//.test(actions),
      'satis aksiyonlari disari istek atmamali',
    );
  });
});
