import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import ScrollAnimationObserver from '@/components/ScrollAnimationObserver';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <a href="#main-content" className="skip-to-content">Hopp til hovedinnhold</a>
      <Header />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <Footer />
      <ScrollAnimationObserver />
    </div>
  );
}
