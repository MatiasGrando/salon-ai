export type WhatsAppPricingCountry = 'AR' | 'ES' | 'US'
export type WhatsAppPricingCategory = 'MARKETING' | 'MARKETING_LITE' | 'UTILITY' | 'AUTHENTICATION' | 'AUTHENTICATION_INTERNATIONAL' | 'AI_PROVIDER'

export type WhatsAppPricingRate = {
  country: WhatsAppPricingCountry
  countryLabel: string
  category: WhatsAppPricingCategory
  currency: 'ARS' | 'EUR' | 'USD'
  estimatedUnitPrice: number
  source: 'ESTIMATE'
  note: string
}

export const whatsappPricingRates: WhatsAppPricingRate[] = [
  {
    country: 'AR',
    countryLabel: 'Argentina',
    category: 'MARKETING',
    currency: 'ARS',
    estimatedUnitPrice: 89.56,
    source: 'ESTIMATE',
    note: 'Precio estimado informado por Meta para Argentina.'
  },
  {
    country: 'AR',
    countryLabel: 'Argentina',
    category: 'MARKETING_LITE',
    currency: 'ARS',
    estimatedUnitPrice: 0,
    source: 'ESTIMATE',
    note: 'Precio estimado informado por Meta para Argentina.'
  },
  {
    country: 'AR',
    countryLabel: 'Argentina',
    category: 'UTILITY',
    currency: 'ARS',
    estimatedUnitPrice: 37.68,
    source: 'ESTIMATE',
    note: 'Precio estimado informado por Meta para Argentina.'
  },
  {
    country: 'AR',
    countryLabel: 'Argentina',
    category: 'AUTHENTICATION',
    currency: 'ARS',
    estimatedUnitPrice: 0,
    source: 'ESTIMATE',
    note: 'Precio estimado informado por Meta para Argentina.'
  },
  {
    country: 'AR',
    countryLabel: 'Argentina',
    category: 'AUTHENTICATION_INTERNATIONAL',
    currency: 'ARS',
    estimatedUnitPrice: 0,
    source: 'ESTIMATE',
    note: 'Precio estimado informado por Meta para Argentina.'
  },
  {
    country: 'AR',
    countryLabel: 'Argentina',
    category: 'AI_PROVIDER',
    currency: 'ARS',
    estimatedUnitPrice: 0,
    source: 'ESTIMATE',
    note: 'Pendiente de cargar precio para Argentina.'
  },
  {
    country: 'ES',
    countryLabel: 'España',
    category: 'MARKETING',
    currency: 'EUR',
    estimatedUnitPrice: 0,
    source: 'ESTIMATE',
    note: 'Preparado para cargar tarifa estimada de España.'
  },
  {
    country: 'ES',
    countryLabel: 'España',
    category: 'UTILITY',
    currency: 'EUR',
    estimatedUnitPrice: 0,
    source: 'ESTIMATE',
    note: 'Preparado para cargar tarifa estimada de España.'
  },
  {
    country: 'US',
    countryLabel: 'Estados Unidos',
    category: 'MARKETING',
    currency: 'USD',
    estimatedUnitPrice: 0,
    source: 'ESTIMATE',
    note: 'Preparado para cargar tarifa estimada de Estados Unidos.'
  },
  {
    country: 'US',
    countryLabel: 'Estados Unidos',
    category: 'UTILITY',
    currency: 'USD',
    estimatedUnitPrice: 0,
    source: 'ESTIMATE',
    note: 'Preparado para cargar tarifa estimada de Estados Unidos.'
  }
]

export function findWhatsAppPricingRate(country: WhatsAppPricingCountry, category: WhatsAppPricingCategory) {
  return whatsappPricingRates.find((rate) => rate.country === country && rate.category === category)
}
