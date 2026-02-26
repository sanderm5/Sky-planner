import Link from 'next/link';

const productLinks = [
  { href: '/funksjoner', label: 'Funksjoner' },
  { href: '/priser', label: 'Priser' },
  { href: '/demo', label: 'Demo' },
  { href: '/faq', label: 'FAQ' },
];

const companyLinks = [
  { href: '/kontakt', label: 'Kontakt oss' },
  { href: '/personvern', label: 'Personvern' },
  { href: '/vilkar', label: 'Vilkår' },
];

const authLinks = [
  { href: '/auth/login', label: 'Logg inn' },
  { href: '/auth/registrer', label: 'Opprett konto' },
];

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-dark-950 border-t border-dark-800/50" role="contentinfo">
      <div className="container-wide px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4" aria-label="Skyplanner - Gå til forsiden">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-500 to-accent-purple flex items-center justify-center">
                <svg className="w-4 h-4" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                  <rect x="5" y="18" width="5" height="10" rx="1" fill="white" opacity="0.5"/>
                  <rect x="13" y="12" width="5" height="16" rx="1" fill="white" opacity="0.75"/>
                  <rect x="21" y="6" width="5" height="22" rx="1" fill="white"/>
                  <path d="M6 16L15 9L24 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3"/>
                </svg>
              </div>
              <span className="text-lg font-bold text-white">Skyplanner</span>
            </Link>
            <p className="text-sm text-dark-400 max-w-xs">
              Kundeadministrasjon og ruteplanlegging for servicebedrifter.
            </p>
            <p className="text-sm text-dark-400 mt-4">
              Efffekt AS
            </p>
          </div>

          {/* Product Links */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">Produkt</h3>
            <ul className="space-y-3">
              {productLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-dark-400 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company Links */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">Bedrift</h3>
            <ul className="space-y-3">
              {companyLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-dark-400 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Auth Links */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">Konto</h3>
            <ul className="space-y-3">
              {authLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-dark-400 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-dark-800/50 mt-12 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-dark-400">
            &copy; {currentYear} Skyplanner. Alle rettigheter reservert.
          </p>
          <div className="flex items-center gap-6">
            <Link href="/personvern" className="text-sm text-dark-400 hover:text-dark-300 transition-colors">
              Personvern
            </Link>
            <Link href="/vilkar" className="text-sm text-dark-400 hover:text-dark-300 transition-colors">
              Vilkår
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
