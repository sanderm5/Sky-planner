import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="nb" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;0,9..144,800;1,9..144,400;1,9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
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
