import type { Metadata, Viewport } from 'next';
import { Footer, Header, MobileTabBar } from '@/components/header';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'Лоток — объявления о продаже товаров, недвижимости, авто, работе и услугах', template: '%s — Лоток' },
  description: 'Покупайте и продавайте товары, недвижимость и транспорт, находите работу и услуги рядом с вами.',
  openGraph: { siteName: 'Лоток', locale: 'ru_RU', type: 'website' },
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = { themeColor: '#0E8C76', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2">
          Перейти к содержимому
        </a>
        <Providers>
          <Header />
          <main id="main" className="min-h-[60vh]">
            {children}
          </main>
          <Footer />
          <MobileTabBar />
        </Providers>
      </body>
    </html>
  );
}
