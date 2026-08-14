import { prisma as defaultPrisma } from '../config/prisma.js'
import type { BusinessInformationTopic, CatalogQuery } from './conversation-router.js'
import { formatCustomerDuration } from './service-duration.js'
import { calculateBookingV2Deposit } from './booking-v2-deposit.js'

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
  tiktokUrl: string | null
  businessHours: Array<{
    dayOfWeek: number
    startTime: string
    endTime: string
  }>
  services: Array<{
    id?: string
    name: string
    category?: string | null
    description?: string | null
    duration: number
    customerDurationMin?: number | null
    customerDurationMax?: number | null
    price: number | null
    priceMode?: 'FIXED' | 'STARTING_AT'
    depositMode?: 'NONE' | 'FIXED' | 'PERCENTAGE'
    depositValue?: number | null
  }>
  professionals: Array<{
    name: string
    services: string[]
  }>
}

export class BusinessKnowledgeService {
  constructor(private readonly db: PrismaClientLike = defaultPrisma) {}

  async answer(input: {
    businessId: string
    topics: BusinessInformationTopic[]
    catalogQuery?: CatalogQuery | null
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
        tiktokUrl: true,
        businessHours: {
          orderBy: { dayOfWeek: 'asc' },
          select: { dayOfWeek: true, startTime: true, endTime: true }
        },
        services: {
          where: { isBookable: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            description: true,
            duration: true,
            customerDurationMin: true,
            customerDurationMax: true,
            price: true,
            priceMode: true,
            depositMode: true,
            depositValue: true,
            category: true,
            catalogCategory: {
              select: { name: true }
            },
            parentService: {
              select: { name: true }
            }
          }
        },
        professionals: {
          where: { isActive: true, acceptsBotBookings: true },
          orderBy: { name: 'asc' },
          select: {
            name: true,
            serviceLinks: {
              select: {
                service: {
                  select: { name: true }
                }
              }
            }
          }
        }
      }
    })

    if (!business) return null
    const knowledge: BusinessKnowledge = {
      ...business,
      services: business.services.map((service) => ({
        id: service.id,
        name: service.parentService
          ? `${service.parentService.name} — ${service.name}`
          : service.name,
        category: service.catalogCategory?.name ?? service.category,
        description: service.description,
        duration: service.duration,
        customerDurationMin: service.customerDurationMin,
        customerDurationMax: service.customerDurationMax,
        price: service.price,
        priceMode: service.priceMode,
        depositMode: service.depositMode,
        depositValue: service.depositValue
      })),
      professionals: business.professionals.map((professional) => ({
        name: professional.name,
        services: professional.serviceLinks.map((link) => link.service.name)
      }))
    }
    const catalogAnswer = input.catalogQuery
      ? renderCatalogServiceQuery(knowledge, input.catalogQuery)
      : null
    const handledTopics = new Set<BusinessInformationTopic>()
    if (catalogAnswer && input.catalogQuery) {
      if (input.catalogQuery.requestedInformation.includes('price')) handledTopics.add('prices')
      if (input.catalogQuery.requestedInformation.includes('deposit')) handledTopics.add('prices')
      if (input.catalogQuery.requestedInformation.includes('professionals')) handledTopics.add('professionals')
      if (input.catalogQuery.requestedInformation.some((item) => ['general', 'duration'].includes(item))) {
        handledTopics.add('services')
      }
    }
    return [
      catalogAnswer,
      ...renderBusinessKnowledgeAnswers(
        knowledge,
        input.topics.filter((topic) => !handledTopics.has(topic))
      )
    ].filter(Boolean).join('\n\n') || null
  }
}

export function renderCatalogServiceQuery(
  business: BusinessKnowledge,
  query: CatalogQuery
) {
  const candidateServiceIds = query.serviceId
    ? [query.serviceId]
    : query.candidateServiceIds ?? []
  const candidateServices = candidateServiceIds
    .map((serviceId) => business.services.find((option) => option.id === serviceId))
    .filter((service): service is BusinessKnowledge['services'][number] => Boolean(service))
  if (!query.serviceId && candidateServices.length > 1) {
    const requested = new Set(query.requestedInformation)
    if (requested.size === 1 && requested.has('general')) {
      return [
        'Encontré varias opciones relacionadas con tu consulta:',
        ...candidateServices.map((service) => `• ${service.name}`),
        '¿Sobre cuál querés consultar?'
      ].join('\n')
    }
    return [
      'Encontré más de un servicio relacionado con tu consulta:',
      ...candidateServices.map((service) => {
        const details: string[] = []
        if (requested.has('general') && service.description?.trim()) {
          details.push(service.description.trim())
        }
        if (requested.has('general') || requested.has('duration')) {
          details.push(formatCustomerDuration(service))
        }
        if (requested.has('general') || requested.has('price')) {
          details.push(service.price === null
            ? 'precio a consultar'
            : `${service.priceMode === 'STARTING_AT' ? 'desde ' : ''}${formatMoney(service.price)}`)
        }
        return `• ${service.name}${details.length ? ` — ${details.join(' — ')}` : ''}`
      }),
      '¿Sobre cuál querés más información?'
    ].join('\n')
  }

  const service = business.services.find((option) => option.id === query.serviceId)
  if (!service) return null

  const requested = new Set(query.requestedInformation)
  const general = requested.has('general')
  const lines: string[] = []

  if (general && service.description?.trim()) {
    lines.push(service.description.trim())
  } else if (general) {
    lines.push('No tengo el detalle del procedimiento cargado de forma confiable. Si querés, te derivo con el equipo.')
  }
  if (general || requested.has('duration')) {
    lines.push(`Duración: ${formatCustomerDuration(service)}.`)
  }
  if (general || requested.has('price')) {
    const price = service.price === null
      ? 'Precio a consultar.'
      : service.priceMode === 'STARTING_AT'
        ? `Precio: desde ${formatMoney(service.price)}.`
        : `Precio: ${formatMoney(service.price)}.`
    lines.push(price)
  }
  if (requested.has('deposit')) {
    const deposit = calculateBookingV2Deposit({
      mode: service.depositMode ?? 'NONE',
      value: service.depositValue ?? null,
      servicePrice: service.price,
      estimateMinimum: service.priceMode === 'STARTING_AT' ? service.price : null
    })
    lines.push(deposit
      ? deposit.mode === 'PERCENTAGE'
        ? `Seña: ${formatMoney(deposit.amount)} (${formatPercentage(deposit.configuredValue)} del valor base).`
        : `Seña: ${formatMoney(deposit.amount)}.`
      : 'No tengo una seña configurada para este servicio.')
  }
  if (requested.has('professionals')) {
    const rawServiceName = service.name.split(' — ').at(-1)?.trim() ?? service.name
    const professionals = business.professionals.filter((professional) =>
      professional.services.some((serviceName) =>
        normalizeKnowledgeLabel(serviceName) === normalizeKnowledgeLabel(rawServiceName)
      )
    )
    lines.push(professionals.length
      ? `Profesionales: ${professionals.map((professional) => professional.name).join(', ')}.`
      : 'No tengo profesionales confirmados para este servicio.')
  }

  return [`Sobre ${service.name}:`, ...lines].join('\n')
}

export function renderBusinessKnowledgeAnswers(
  business: BusinessKnowledge,
  topics: BusinessInformationTopic[],
  baseDomain = process.env.PUBLIC_BASE_DOMAIN || 'weex.com.ar'
) {
  const uniqueTopics = Array.from(new Set(topics))
  const compactTopics = uniqueTopics.includes('prices')
    ? uniqueTopics.filter((topic) => topic !== 'services')
    : uniqueTopics
  return compactTopics.map((topic) => answerTopic(business, topic, baseDomain))
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

  if (topic === 'tiktok') {
    return business.tiktokUrl
      ? `El TikTok de ${business.name} es ${business.tiktokUrl}`
      : missingInformation('el TikTok del local')
  }

  if (topic === 'services' || topic === 'prices') {
    if (!business.services.length) return missingInformation('el catálogo de servicios')
    const serviceLine = (service: BusinessKnowledge['services'][number]) => {
      const price = service.price === null
        ? 'consultar precio'
        : `${service.priceMode === 'STARTING_AT' ? 'desde ' : ''}${formatMoney(service.price)}`
      return `• ${service.name}${topic === 'prices' ? ` — ${price}` : ''}`
    }
    const hasCategories = business.services.some((service) => service.category?.trim())
    const lines = hasCategories
      ? Array.from(groupKnowledgeServicesByCategory(business.services).entries()).flatMap(
          ([category, services]) => [
            `${category}:`,
            ...services.map(serviceLine)
          ]
        )
      : business.services.map(serviceLine)
    return [
      topic === 'prices' ? 'Estos son los precios de nuestros servicios:' : 'Estos son los servicios disponibles:',
      ...lines
    ].join('\n')
  }

  if (topic === 'professionals') {
    if (!business.professionals.length) return missingInformation('la lista de profesionales')
    return [
      'Estos son los profesionales disponibles:',
      ...business.professionals.map((professional) => {
        const services = professional.services.length
          ? ` — ${professional.services.join(', ')}`
          : ''
        return `• ${professional.name}${services}`
      }),
      'Si querés, también puedo ayudarte a buscar un horario con alguno de ellos 😊'
    ].join('\n')
  }

  return 'No tengo esa información confirmada. Si querés, puedo derivarte con una persona del local.'
}

function groupKnowledgeServicesByCategory(services: BusinessKnowledge['services']) {
  const groups = new Map<string, BusinessKnowledge['services']>()
  for (const service of services) {
    const category = service.category?.trim() || 'Otros'
    const group = groups.get(category) ?? []
    group.push(service)
    groups.set(category, group)
  }
  return groups
}

function formatBusinessHours(hours: BusinessKnowledge['businessHours']) {
  const hoursByDay = new Map<number, BusinessKnowledge['businessHours']>()
  for (const hour of hours) {
    const dayHours = hoursByDay.get(hour.dayOfWeek) || []
    dayHours.push(hour)
    hoursByDay.set(hour.dayOfWeek, dayHours)
  }

  return Array.from(hoursByDay.entries())
    .sort(([leftDay], [rightDay]) => dayOrder(leftDay) - dayOrder(rightDay))
    .map(([dayOfWeek, dayHours]) => {
      const ranges = dayHours
        .slice()
        .sort((left, right) => left.startTime.localeCompare(right.startTime))
        .map((hour) => `${hour.startTime} a ${hour.endTime}`)
        .join(' y ')
      return `${dayLabel(dayOfWeek)}: ${ranges}`
    })
    .join('\n')
}

function normalizeKnowledgeLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
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

function formatPercentage(value: number) {
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(value)}%`
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
