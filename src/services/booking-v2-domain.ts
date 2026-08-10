import { prisma as defaultPrisma } from '../config/prisma.js'
import { InternalBookingProvider } from '../providers/internal-booking-provider.js'
import type { BookingProvider } from '../providers/booking-provider.js'
import {
  BookingAvailabilitySearchEngine,
  type BookingAvailabilitySearchInput,
  type BookingAvailabilitySearchMode,
  type BookingAvailabilitySearchResult
} from './booking-availability-search.js'
import type { BookingV2Catalog } from './booking-v2-interpreter.js'
import type { BookingV2CatalogOption } from './booking-v2-extractor.js'
import { ANY_PROFESSIONAL_ID, type BookingFlowOrder } from './booking-v2-state.js'
import { reservationDurationLimits } from './service-duration.js'

type PrismaClientLike = typeof defaultPrisma

export type BookingV2ServiceOption = {
  id: string
  name: string
  description?: string | null
  aliases: string[]
  duration: number
  customerDurationMin?: number | null
  customerDurationMax?: number | null
  price: number | null
  priceMode?: 'FIXED' | 'STARTING_AT'
  category: string | null
  categoryId?: string | null
  categoryAdviceEnabled?: boolean
  parentServiceId?: string | null
  parentServiceName?: string | null
  parentSelectionMode?: 'ONE_OF' | 'MULTIPLE' | null
  attentionMode?: 'DIRECT_BOOKING' | 'QUOTE' | 'ADVISOR' | 'GUIDED_ESTIMATE'
  requiresPhoto?: boolean
  estimateExplanation?: string | null
  estimateQuestion?: string | null
  estimateOptions?: BookingV2EstimateOption[]
  estimateDisclaimer?: string | null
  estimateAllowsBooking?: boolean
  validationEnabled?: boolean
  validationMessage?: string | null
  validationQuestion?: string | null
  depositMode?: 'NONE' | 'FIXED' | 'PERCENTAGE'
  depositValue?: number | null
  suggestedAddonIds?: string[]
  bookingOrderPriority?: number
}

export type BookingV2EstimateOption = {
  id: string
  label: string
  priceMin: number
  priceMax: number | null
  note: string | null
}

export type BookingV2ProfessionalOption = {
  id: string
  name: string
  serviceIds: string[]
}

export type BookingV2DomainCatalog = {
  displayMode: BookingV2CatalogDisplayMode
  bookingFlowOrder: BookingFlowOrder
  services: BookingV2ServiceOption[]
  professionals: BookingV2ProfessionalOption[]
  serviceIds: ReadonlySet<string>
  professionalIds: ReadonlySet<string>
  professionalServiceIds: ReadonlyMap<string, ReadonlySet<string>>
  combinationRules: ReadonlyMap<string, BookingV2CombinationRule>
}

export type BookingV2CatalogDisplayMode = 'ALL_SERVICES' | 'CATEGORIES_FIRST'

export type BookingV2AvailabilityOption = {
  time: string
  professionalId: string
  professionalName: string
}

export type BookingV2DatedAvailabilityOption = BookingV2AvailabilityOption & {
  date: string
}

export type BookingV2CombinationPolicy = 'ALLOWED' | 'REVIEW_REQUIRED' | 'BLOCKED'

export type BookingV2CombinationRule = {
  serviceAId: string
  serviceBId: string
  policy: BookingV2CombinationPolicy
  note: string | null
}

export type BookingV2CategoryOption = {
  key: string
  name: string
  serviceIds: string[]
}

export type BookingV2AvailabilityResult =
  | {
      ok: true
      options: BookingV2AvailabilityOption[]
    }
  | {
      ok: false
      message: string
    }

export class BookingV2DomainService {
  constructor(
    private readonly db: PrismaClientLike = defaultPrisma,
    private readonly bookingProvider: BookingProvider = new InternalBookingProvider()
  ) {}

  async loadCatalog(businessId: string): Promise<BookingV2DomainCatalog> {
    const settingsModel = (this.db as unknown as {
      businessFeatureSettings?: {
        findUnique(input: unknown): Promise<{
          serviceCatalogDisplayMode?: string
          bookingFlowOrder?: string
        } | null>
      }
    }).businessFeatureSettings
    const [services, professionals, featureSettings, combinationRules] = await Promise.all([
      this.db.service.findMany({
        where: {
          businessId,
          isBookable: true
        },
        include: {
          aliases: true,
          suggestedAddons: {
            select: { addonServiceId: true },
            orderBy: { sortOrder: 'asc' }
          },
          catalogCategory: true,
          parentService: {
            include: {
              aliases: true
            }
          }
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
      }),
      this.db.professional.findMany({
        where: {
          businessId,
          isActive: true,
          acceptsBotBookings: true
        },
        include: {
          serviceLinks: {
            select: { serviceId: true }
          }
        },
        orderBy: { name: 'asc' }
      }),
      settingsModel?.findUnique
        ? settingsModel.findUnique({
            where: { businessId },
            select: { serviceCatalogDisplayMode: true, bookingFlowOrder: true }
          })
        : Promise.resolve(null),
      (this.db as unknown as {
        serviceCombinationRule?: {
          findMany(input: unknown): Promise<Array<{
            serviceAId: string
            serviceBId: string
            policy: BookingV2CombinationPolicy
            note: string | null
          }>>
        }
      }).serviceCombinationRule?.findMany
        ? (this.db as unknown as {
            serviceCombinationRule: {
              findMany(input: unknown): Promise<BookingV2CombinationRule[]>
            }
          }).serviceCombinationRule.findMany({ where: { businessId } })
        : Promise.resolve([])
    ])

    return createBookingV2DomainCatalog({
      displayMode: normalizeCatalogDisplayMode(featureSettings?.serviceCatalogDisplayMode),
      bookingFlowOrder: normalizeBookingFlowOrder(featureSettings?.bookingFlowOrder),
      services: services.map((service) => {
        const category = service.catalogCategory?.name ?? service.category
        return {
          id: service.id,
          name: service.parentService
            ? `${service.parentService.name} — ${service.name}`
            : service.name,
          description: service.description,
          aliases: Array.from(new Set([
            service.name,
            ...service.aliases.map((alias) => alias.name),
            ...(category ? [category] : []),
            ...(service.parentService
              ? [
                  service.parentService.name,
                  `${service.parentService.name} ${service.name}`,
                  ...service.parentService.aliases.map((alias) =>
                    `${alias.name} ${service.name}`
                  )
                ]
              : [])
          ])),
          duration: service.duration,
          customerDurationMin: service.customerDurationMin,
          customerDurationMax: service.customerDurationMax,
          price: service.price,
          priceMode: service.priceMode,
          category,
          categoryId: service.catalogCategoryId,
          categoryAdviceEnabled: service.catalogCategory?.adviceEnabled === true,
          parentServiceId: service.parentServiceId,
          parentServiceName: service.parentService?.name ?? null,
          parentSelectionMode: service.parentService?.variantSelectionMode ?? null,
          attentionMode: service.attentionMode,
          requiresPhoto: service.requiresPhoto,
          estimateExplanation: service.estimateExplanation,
          estimateQuestion: service.estimateQuestion,
          estimateOptions: readEstimateOptions(service.estimateOptions),
          estimateDisclaimer: service.estimateDisclaimer,
          estimateAllowsBooking: service.estimateAllowsBooking,
          validationEnabled: service.validationEnabled,
          validationMessage: service.validationMessage,
          validationQuestion: service.validationQuestion,
          depositMode: service.depositMode,
          depositValue: service.depositValue,
          suggestedAddonIds: (service.suggestedAddons ?? []).map((addon) => addon.addonServiceId),
          bookingOrderPriority: service.bookingOrderPriority
        }
      }),
      professionals: professionals.map((professional) => ({
        id: professional.id,
        name: professional.name,
        serviceIds: professional.serviceLinks.map((link) => link.serviceId)
      })),
      combinationRules
    })
  }

  toExtractionCatalog(catalog: BookingV2DomainCatalog): {
    services: BookingV2CatalogOption[]
    professionals: BookingV2CatalogOption[]
  } {
    return {
      services: catalog.services.map((service) => ({
        id: service.id,
        name: service.name,
        aliases: service.aliases,
        ...(service.description === undefined ? {} : { description: service.description })
      })),
      professionals: catalog.professionals.map((professional) => ({
        id: professional.id,
        name: professional.name
      }))
    }
  }

  toInterpreterCatalog(catalog: BookingV2DomainCatalog): BookingV2Catalog {
    return {
      bookingFlowOrder: catalog.bookingFlowOrder,
      serviceIds: catalog.serviceIds,
      professionalIds: catalog.professionalIds,
      professionalServiceIds: catalog.professionalServiceIds
    }
  }

  professionalOffersService(
    catalog: BookingV2DomainCatalog,
    professionalId: string,
    serviceId: string
  ) {
    return catalog.professionalServiceIds.get(professionalId)?.has(serviceId) ?? false
  }

  async findAvailabilityOptions(input: {
    catalog: BookingV2DomainCatalog
    serviceId: string
    serviceIds?: string[]
    date: string
    professionalId?: string | null
  }): Promise<BookingV2AvailabilityResult> {
    const result = await this.searchAvailability({
      catalog: input.catalog,
      serviceId: input.serviceId,
      ...(input.serviceIds === undefined ? {} : { serviceIds: input.serviceIds }),
      mode: { type: 'DATE', date: input.date },
      assignmentMode: 'SINGLE_PROFESSIONAL',
      ...(input.professionalId === undefined ? {} : { professionalId: input.professionalId })
    })
    if (result.status === 'NO_COMPATIBLE_PROFESSIONAL') {
      return { ok: false, message: 'Ese profesional no realiza ese servicio' }
    }
    if (result.status === 'PROVIDER_ERROR') {
      return { ok: false, message: result.errors[0]?.message ?? 'No pude consultar la agenda' }
    }
    return {
      ok: true,
      options: result.options.flatMap((option) => {
        const firstSegment = option.segments[0]
        return firstSegment
          ? [{
              time: option.startTime,
              professionalId: firstSegment.professionalId,
              professionalName: firstSegment.professionalName
            }]
          : []
      })
    }
  }

  async findNextAvailabilityOptions(input: {
    catalog: BookingV2DomainCatalog
    serviceId: string
    serviceIds?: string[]
    afterDate: string
    professionalId?: string | null
    horizonDays?: number
    maxDates?: number
    maxSlotsPerDate?: number
  }): Promise<BookingV2DatedAvailabilityOption[]> {
    const maxDates = Math.max(1, Math.min(input.maxDates ?? 3, 5))
    const maxSlotsPerDate = Math.max(1, Math.min(input.maxSlotsPerDate ?? 3, 5))
    const result = await this.searchAvailability({
      catalog: input.catalog,
      serviceId: input.serviceId,
      ...(input.serviceIds === undefined ? {} : { serviceIds: input.serviceIds }),
      mode: {
        type: 'NEXT_DAYS',
        afterDate: input.afterDate,
        horizonDays: input.horizonDays ?? 14,
        maxDates
      },
      assignmentMode: 'SINGLE_PROFESSIONAL',
      maxResults: maxDates * maxSlotsPerDate,
      ...(input.professionalId === undefined ? {} : { professionalId: input.professionalId })
    })
    const countByDate = new Map<string, number>()
    return result.options.flatMap((option) => {
      const count = countByDate.get(option.date) ?? 0
      const firstSegment = option.segments[0]
      if (!firstSegment || count >= maxSlotsPerDate) return []
      countByDate.set(option.date, count + 1)
      return [{
        date: option.date,
        time: option.startTime,
        professionalId: firstSegment.professionalId,
        professionalName: firstSegment.professionalName
      }]
    })
  }

  async searchAvailability(input: {
    catalog: BookingV2DomainCatalog
    serviceId: string
    serviceIds?: string[]
    mode: BookingAvailabilitySearchMode
    assignmentMode?: BookingAvailabilitySearchInput['assignmentMode']
    professionalId?: string | null
    preferredProfessionalId?: string | null
    maxResults?: number
  }): Promise<BookingAvailabilitySearchResult> {
    const serviceIds = Array.from(new Set([
      input.serviceId,
      ...(input.serviceIds ?? [])
    ]))
    const services = serviceIds.flatMap((serviceId) => {
      const service = input.catalog.services.find((candidate) => candidate.id === serviceId)
      if (!service) return []
      const duration = reservationDurationLimits(service)
      return [{
        id: service.id,
        name: service.name,
        durationMinutes: duration.professional,
        customerDurationMinutes: duration.business,
        professionalIds: input.catalog.professionals
          .filter((professional) => professional.serviceIds.includes(service.id))
          .map((professional) => professional.id)
      }]
    })
    const searchEngine = new BookingAvailabilitySearchEngine(async (request) => {
      const availability = await this.bookingProvider.getAvailability({
        professionalId: request.professionalId,
        serviceId: request.serviceIds[0] ?? input.serviceId,
        serviceIds: request.serviceIds,
        date: request.date
      })
      return availability.ok
        ? { ok: true, slots: availability.slots }
        : { ok: false, message: availability.message }
    })
    return searchEngine.search({
      mode: input.mode,
      services,
      professionals: input.catalog.professionals.map((professional) => ({
        id: professional.id,
        name: professional.name
      })),
      assignmentMode: input.assignmentMode ?? 'SINGLE_PROFESSIONAL',
      requiredProfessionalId: input.professionalId && input.professionalId !== ANY_PROFESSIONAL_ID
        ? input.professionalId
        : null,
      preferredProfessionalId: input.preferredProfessionalId ?? null,
      ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults })
    })
  }
}

function readEstimateOptions(value: unknown): BookingV2EstimateOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const option = entry as Partial<BookingV2EstimateOption>
    if (
      typeof option.id !== 'string' ||
      typeof option.label !== 'string' ||
      typeof option.priceMin !== 'number' ||
      !Number.isFinite(option.priceMin)
    ) {
      return []
    }
    const priceMax = typeof option.priceMax === 'number' && Number.isFinite(option.priceMax)
      ? option.priceMax
      : null
    return [{
      id: option.id,
      label: option.label,
      priceMin: option.priceMin,
      priceMax,
      note: typeof option.note === 'string' ? option.note : null
    }]
  })
}

export function createBookingV2DomainCatalog(input: {
  displayMode?: BookingV2CatalogDisplayMode
  bookingFlowOrder?: BookingFlowOrder
  services: BookingV2ServiceOption[]
  professionals: BookingV2ProfessionalOption[]
  combinationRules?: BookingV2CombinationRule[]
}): BookingV2DomainCatalog {
  return {
    displayMode: input.displayMode ?? 'ALL_SERVICES',
    bookingFlowOrder: input.bookingFlowOrder ?? 'PROFESSIONAL_FIRST',
    services: input.services,
    professionals: input.professionals,
    serviceIds: new Set(input.services.map((service) => service.id)),
    professionalIds: new Set(input.professionals.map((professional) => professional.id)),
    professionalServiceIds: new Map(
      input.professionals.map((professional) => [
        professional.id,
        new Set(professional.serviceIds)
      ])
    ),
    combinationRules: new Map(
      (input.combinationRules ?? []).map((rule) => [
        combinationRuleKey(rule.serviceAId, rule.serviceBId),
        rule
      ])
    )
  }
}

export function combinationRuleKey(serviceAId: string, serviceBId: string) {
  return [serviceAId, serviceBId].sort().join(':')
}

export function combinationRuleFor(
  catalog: BookingV2DomainCatalog,
  serviceAId: string,
  serviceBId: string
) {
  return catalog.combinationRules.get(combinationRuleKey(serviceAId, serviceBId)) ?? null
}

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function normalizeCatalogDisplayMode(value: unknown): BookingV2CatalogDisplayMode {
  return value === 'CATEGORIES_FIRST' ? 'CATEGORIES_FIRST' : 'ALL_SERVICES'
}

export function normalizeBookingFlowOrder(value: unknown): BookingFlowOrder {
  return value === 'DATE_TIME_FIRST' ? 'DATE_TIME_FIRST' : 'PROFESSIONAL_FIRST'
}

export function catalogCategoryOptions(
  catalog: Pick<BookingV2DomainCatalog, 'services'>
): BookingV2CategoryOption[] {
  const categories = new Map<string, BookingV2CategoryOption>()
  for (const service of catalog.services) {
    const name = service.category?.trim() || 'Otros'
    const key = service.categoryId
      ? `id:${service.categoryId}`
      : name === 'Otros'
        ? 'uncategorized'
        : `name:${normalizeCategoryKey(name)}`
    const category = categories.get(key) ?? { key, name, serviceIds: [] }
    category.serviceIds.push(service.id)
    categories.set(key, category)
  }
  return Array.from(categories.values())
}

export function catalogServicesForCategory(
  catalog: Pick<BookingV2DomainCatalog, 'services'>,
  categoryKey: string
) {
  const category = catalogCategoryOptions(catalog).find((option) => option.key === categoryKey)
  if (!category) return []
  const serviceIds = new Set(category.serviceIds)
  return catalog.services.filter((service) => serviceIds.has(service.id))
}

function normalizeCategoryKey(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
