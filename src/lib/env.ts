import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * .env dosyasini CLI script'leri icin yukler.
 *
 * Next.js .env'i kendisi okur; bu modul yalnizca `npm run discover|audit|score|
 * pipeline` gibi tsx ile calisan girisler icindir. Node 20.6+ yerlesik
 * `process.loadEnvFile` kullanilir — ek bagimlilik yok.
 *
 * Zaten tanimli olan ortam degiskenlerinin uzerine YAZMAZ: kabuktan verilen
 * deger (`PAGESPEED_API_KEY=... npm run audit`) daima .env'i yener.
 */
let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;

  try {
    const before = new Set(Object.keys(process.env));
    process.loadEnvFile(path);
    // loadEnvFile mevcut degiskenleri ezmez; yine de neyin yuklendigini bilelim.
    const added = Object.keys(process.env).filter((k) => !before.has(k));
    if (added.length > 0) {
      console.log(`[env] .env yüklendi: ${added.join(', ')}`);
    }
  } catch (err) {
    console.warn(`[env] .env okunamadı: ${err instanceof Error ? err.message : String(err)}`);
  }
}
