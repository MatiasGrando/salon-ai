import { prisma as defaultPrisma } from '../config/prisma.js'
import { InternalBookingProvider } from '../providers/internal-booking-provider.js'
import type { BookingProvider } from '../providers/booking-provider.js'
import type { BookingV2Catalog } from './booking-v2-interpreter.js'
import type { BookingV2CatalogOption } from './booking-v2-extractor.js'
import { ANY_PROFESSIONAL_ID, type BookingFlowOrder } from './booking-v2-state.js'

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
          suggestedAddonIds: (service.suggestedAddons ?? []).map((addon) => addon.addonServiceId)
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
    const serviceIds = Array.from(new Set([
      input.serviceId,
      ...(input.serviceIds ?? [])
    ]))
    if (serviceIds.some((serviceId) => !input.catalog.serviceIds.has(serviceId))) {
      return { ok: false, message: 'No encontre ese servicio para este comercio' }
    }

    const professionals = input.professionalId && input.professionalId !== ANY_PROFESSIONAL_ID
      ? input.catalog.professionals.filter((professional) => professional.id === input.professionalId)
      : input.catalog.professionals

    const compatibleProfessionals = professionals.filter((professional) =>
      serviceIds.every((serviceId) =>
        this.professionalOffersService(input.catalog, professional.id, serviceId)
      )
    )

    if (
      input.professionalId &&
      input.professionalId !== ANY_PROFESSIONAL_ID &&
      compatibleProfessionals.length === 0
    ) {
      return { ok: false, message: 'Ese profesional no realiza ese servicio' }
    }

    const options: BookingV2AvailabilityOption[] = []
    for (const professional of compatibleProfessionals) {
      const availability = await this.bookingProvider.getAvailability({
        professionalId: professional.id,
        serviceId: input.serviceId,
        serviceIds,
        date: input.date
      })
      if (!availability.ok) continue

      for (const time of availability.slots) {
        options.push({
          time,
          professionalId: professional.id,
          professionalName: professional.name
        })
      }
    }

    options.sort((left, right) =>
      left.time.localeCompare(right.time) ||
      left.professionalName.localeCompare(right.professionalName)
    )

    return { ok: true, options }
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
    const horizonDays = Math.max(1, Math.min(input.horizonDays ?? 14, 30))
    const maxDates = Math.max(1, Math.min(input.maxDates ?? 3, 5))
    const maxSlotsPerDate = Math.max(1, Math.min(input.maxSlotsPerDate ?? 3, 5))
    const result: BookingV2DatedAvailabilityOption[] = []
    let datesWithOptions = 0
    for (let offset = 1; offset <= horizonDays && datesWithOptions < maxDates; offset += 1) {
      const date = addIsoDays(input.afterDate, offset)
      if (!date) break
      const availability = await this.findAvailabilityOptions({
        catalog: input.catalog,
        serviceId: input.serviceId,
        ...(input.serviceIds === undefined ? {} : { serviceIds: input.serviceIds }),
        ...(input.professionalId === undefined ? {} : { professionalId: input.professionalId }),
        date
      })
      if (!availability.ok || availability.options.length === 0) continue
      datesWithOptions += 1
      result.push(...availability.options.slice(0, maxSlotsPerDate).map((option) => ({
        ...option,
        date
      })))
    }
    return result
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
