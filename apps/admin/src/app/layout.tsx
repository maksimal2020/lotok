import type { Metadata } from 'next';
import { Shell } from '@/components/shell';
import { AdminProviders } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = { title: 'Лоток · Администрирование', robots: { index: false, follow: false }, icons: { icon: '/favicon.svg' } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <AdminProviders>
          <Shell>{children}</Shell>
        </AdminProviders>
      </body>
    </html>
  );
}
