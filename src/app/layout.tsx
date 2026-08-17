import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VIVA SALES ENGINE',
  description: 'AI lead-generation ve satış araştırma sistemi — İstanbul fitness sektörü',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
