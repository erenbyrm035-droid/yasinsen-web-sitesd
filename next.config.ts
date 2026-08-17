import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 native bir modul; Next'in bundle etmesini engelliyoruz.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
