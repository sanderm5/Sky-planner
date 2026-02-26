import type { Metadata } from 'next';
import Schema from '@/components/seo/Schema';
import Hero from '@/components/sections/Hero';
import Features from '@/components/sections/Features';
import HowItWorks from '@/components/sections/HowItWorks';
import Showcase from '@/components/sections/Showcase';
import PricingPreview from '@/components/sections/PricingPreview';
import FaqPreview from '@/components/sections/FaqPreview';
import CTA from '@/components/sections/CTA';

export const metadata: Metadata = {
  title: 'Hjem',
  description: 'Skyplanner - Kundeadministrasjon og ruteplanlegging for servicebedrifter. Start din gratis prøveperiode i dag.',
};

export default function HomePage() {
  return (
    <>
      <Schema type="software" />
      <Hero />
      <Features />
      <HowItWorks />
      <Showcase />
      <PricingPreview />
      <FaqPreview />
      <CTA />
    </>
  );
}
