import { prisma as defaultPrisma } from '../config/prisma.js'
import type { BusinessInformationTopic } from './conversation-router.js'

type PrismaClientLike = typeof defaultPrisma

export type BusinessKnowledge = {
  name: string
  slug: string | null
  landingEnabled: boolean
  publicWhatsapp: string | null
  contactEmail: string | null
  publicAddress: string | null
  publicAddressArea: string | null
  publicMapsUrl: string | null
  instagramUrl: string | null
  facebookUrl: string | null
  businessHours: Array<{
    dayOfWeek: number
    startTime: string
    endTime: string
  }>
  services: Array<{
    name: string
    duration: number
    price: number | null
  }>
}

export class BusinessKnowledgeService {
  constructor(private readonly db: PrismaClientLike = defaultPrisma) {}

  async answer(input: {
    businessId: string
    topics: BusinessInformationTopic[]
  }) {
    const business = await this.db.business.findUnique({
      where: { id: input.businessId },
      select: {
        name: true,
        slug: true,
        landingEnabled: true,
        publicWhatsapp: true,
        contactEmail: true,
        publicAddress: true,
        publicAddressArea: true,
        publicMapsUrl: true,
        instagramUrl: true,
        facebookUrl: true,
        businessHours: {
          orderBy: { dayOfWeek: 'asc' },
          select: { dayOfWeek: true, startTime: true, endTime: true }
        },
        services: {
          orderBy: { name: 'asc' },
          select: { name: true, duration: true, price: true }
        }
      }
    })

    if (!business) return null
    return renderBusinessKnowledgeAnswers(business, input.topics).join('\n\n') || null
  }
}

export function renderBusinessKnowledgeAnswers(
  business: BusinessKnowledge,
  topics: BusinessInformationTopic[],
  baseDomain = process.env.PUBLIC_BASE_DOMAIN || 'weex.com.ar'
) {
  return Array.from(new Set(topics)).map((topic) => answerTopic(business, topic, baseDomain))
}

function answerTopic(business: BusinessKnowledge, topic: BusinessInformationTopic, baseDomain: string) {
  if (topic === 'opening_hours') {
    if (!business.businessHours.length) return missingInformation('los horarios del local')
    return `Los horarios de ${business.name} son:\n${formatBusinessHours(business.businessHours)}`
  }

  if (topic === 'address') {
    const address = [business.publicAddress, business.publicAddressArea].filter(Boolean).join(', ')
    if (!address && !business.publicMapsUrl) return missingInformation('la dirección exacta')
    return [
      address ? `${business.name} queda en ${address}.` : null,
      business.publicMapsUrl ? `Te dejo el mapa: ${business.publicMapsUrl}` : null
    ].filter(Boolean).join('\n')
  }

  if (topic === 'website') {
    const website = business.landingEnabled ? publicWebsiteUrl(business.slug, baseDomain) : null
    return website
      ? `La página de ${business.name} es ${website}`
      : missingInformation('la página web')
  }

  if (topic === 'booking_channels') {
    const bookingUrl = business.landingEnabled ? publicBookingUrl(business.slug, baseDomain) : null
    if (bookingUrl) return `Podés reservar por este chat o desde ${bookingUrl}`
    return 'Podés reservar directamente por este chat. Decime qué servicio necesitás y te ayudo.'
  }

  if (topic === 'phone') {
    return business.publicWhatsapp
      ? `El WhatsApp de ${business.name} es ${business.publicWhatsapp}.`
      : missingInformation('el teléfono público del local')
  }

  if (topic === 'email') {
    return business.contactEmail
      ? `El email de ${business.name} es ${business.contactEmail}.`
      : missingInformation('el email del local')
  }

  if (topic === 'instagram') {
    return business.instagramUrl
      ? `El Instagram de ${business.name} es ${business.instagramUrl}`
      : missingInformation('el Instagram del local')
  }

  if (topic === 'facebook') {
    return business.facebookUrl
      ? `El Facebook de ${business.name} es ${business.facebookUrl}`
      : missingInformation('el Facebook del local')
  }

  if (topic === 'services' || topic === 'prices') {
    if (!business.services.length) return missingInformation('el catálogo de servicios')
    const lines = business.services.map((service) => {
      const price = service.price === null ? 'precio a consultar' : formatMoney(service.price)
      return `• ${service.name} (${service.duration} min)${topic === 'prices' ? ` — ${price}` : ''}`
    })
    return [
      topic === 'prices' ? 'Estos son los precios cargados actualmente:' : 'Estos son los servicios disponibles:',
      ...lines
    ].join('\n')
  }

  return 'No tengo esa información confirmada. Si querés, puedo derivarte con una persona del local.'
}

function formatBusinessHours(hours: BusinessKnowledge['businessHours']) {
  return hours
    .slice()
    .sort((left, right) => dayOrder(left.dayOfWeek) - dayOrder(right.dayOfWeek))
    .map((hoursForDay) => `${dayLabel(hoursForDay.dayOfWeek)}: ${hoursForDay.startTime} a ${hoursForDay.endTime}`)
    .join('\n')
}

function publicWebsiteUrl(slug: string | null, baseDomain: string) {
  if (!slug) return null
  return `https://${slug}.${cleanBaseDomain(baseDomain)}`
}

function publicBookingUrl(slug: string | null, baseDomain: string) {
  const website = publicWebsiteUrl(slug, baseDomain)
  return website ? `${website}/reservar` : null
}

function cleanBaseDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

function missingInformation(label: string) {
  return `No tengo ${label} cargado de forma confiable. Si querés, te derivo con una persona del local.`
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(value)
}

function dayOrder(dayOfWeek: number) {
  return dayOfWeek === 0 ? 7 : dayOfWeek
}

function dayLabel(dayOfWeek: number) {
  return [
    'Domingo',
    'Lunes',
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes',
    'Sábado'
  ][dayOfWeek] ?? `Día ${dayOfWeek}`
}
