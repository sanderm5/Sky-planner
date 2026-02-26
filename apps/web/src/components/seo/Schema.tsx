interface SchemaProps {
  type: 'software' | 'faq';
  faqItems?: { question: string; answer: string }[];
}

const softwareSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Skyplanner',
  description: 'Kundeadministrasjon og ruteplanlegging for servicebedrifter',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: 'https://skyplanner.no',
  inLanguage: 'nb',
  offers: [
    {
      '@type': 'Offer',
      name: 'Standard',
      price: '499',
      priceCurrency: 'NOK',
      billingIncrement: 'P1M',
    },
    {
      '@type': 'Offer',
      name: 'Premium',
      price: '999',
      priceCurrency: 'NOK',
      billingIncrement: 'P1M',
    },
  ],
  provider: {
    '@type': 'Organization',
    name: 'Efffekt AS',
    url: 'https://skyplanner.no',
  },
};

export default function Schema({ type, faqItems = [] }: SchemaProps) {
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };

  const schema = type === 'software' ? softwareSchema : faqSchema;

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
