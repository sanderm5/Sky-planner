import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Fraunces } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-body',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-heading',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Skyplanner',
    template: '%s | Skyplanner',
  },
  description: 'Kundeadministrasjon og ruteplanlegging for servicebedrifter',
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || 'https://skyplanner.no'),
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    siteName: 'Skyplanner',
    locale: 'nb_NO',
    type: 'website',
  },
  other: {
    'theme-color': '#0A0E16',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nb" className={`dark ${plusJakarta.variable} ${fraunces.variable}`}>
      <head>
        {/* Font Awesome — loaded async to avoid render blocking */}
        <link
          rel="preload"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
          as="style"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
        />
      </head>
      <body className="min-h-screen">
        <div className="body-glow" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
