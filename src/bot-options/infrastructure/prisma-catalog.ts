import { measureAttemptStage } from '../observability/attempt-metrics.js'
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import { parseEstimateOptions, serviceAllowsAutomaticBooking } from '../domain/service-booking.js'
import {
  CATALOG_CONTEXTUAL_PAGE_SIZE,
  catalogPageOffset,
  toCatalogPage,
  type CatalogCategoryItem,
  type CatalogPage,
  type CatalogServiceItem
} from '../application/catalog-queries.js'

type CatalogClient = Pick<PrismaClient, 'serviceCategory' | 'service'> | Prisma.TransactionClient

export const UNCATEGORIZED_CATEGORY_ID = 'uncategorized'
const UNCATEGORIZED_CATEGORY: CatalogCategoryItem = { id: UNCATEGORIZED_CATEGORY_ID, name: 'Otros' }

function eligibleBotProfessionalLinks(businessId: string) {
  return {
    some: {
      professional: { businessId, isActive: true, acceptsBotBookings: true }
    }
  }
}

function uncategorizedRootServiceWhere(businessId: string): Prisma.ServiceWhereInput {
  return {
    businessId,
    isActive: true,
    catalogCategoryId: null,
    parentServiceId: null,
    OR: [
      { isBookable: true, isActive: true, professionalLinks: eligibleBotProfessionalLinks(businessId) },
      { isBookable: false, isActive: true, variants: { some: { businessId, catalogCategoryId: null, isBookable: true, isActive: true, professionalLinks: eligibleBotProfessionalLinks(businessId) } } }
    ]
  }
}

function eligibleCategoryWhere(businessId: string): Prisma.ServiceCategoryWhereInput {
  return {
    businessId: businessId,
    isActive: true,
    services: { some: {
      businessId: businessId,
      parentServiceId: null,
      OR: [
        { isBookable: true, isActive: true, professionalLinks: eligibleBotProfessionalLinks(businessId) },
        { isBookable: false, isActive: true, variants: { some: { businessId: businessId, isBookable: true, isActive: true, professionalLinks: eligibleBotProfessionalLinks(businessId) } } }
      ]
    } }
  }
}

const serviceSelect = {
  id: true,
  businessId: true,
  catalogCategoryId: true,
  parentServiceId: true,
  name: true,
  description: true,
  duration: true,
  customerDurationMin: true,
  customerDurationMax: true,
  price: true,
  priceMode: true,
  isBookable: true,
  attentionMode: true,
  estimateAllowsBooking: true,
  estimateQuestion: true, estimateOptions: true, estimateExplanation: true, estimateDisclaimer: true,
  requiresPhoto: true, validationEnabled: true, validationMessage: true, validationQuestion: true
} as const

type ServiceRow = Prisma.ServiceGetPayload<{ select: typeof serviceSelect }>

function serviceItem(row: ServiceRow): CatalogServiceItem {
  const subcategory = !row.isBookable
  return {
    id: row.id,
    categoryId: row.catalogCategoryId ?? UNCATEGORIZED_CATEGORY_ID,
    parentServiceId: row.parentServiceId,
    kind: subcategory ? 'SUBCATEGORY' : 'SERVICE',
    name: row.name,
    description: row.description,
    durationMinutes: subcategory ? null : row.duration,
    durationMinMinutes: subcategory ? null : row.customerDurationMin,
    durationMaxMinutes: subcategory ? null : row.customerDurationMax,
    price: subcategory ? null : row.price,
    priceMode: row.priceMode,
    isBookable: row.isBookable,
    requiresConsultation: !subcategory && !serviceAllowsAutomaticBooking(row),
    bookingPolicy: { id: row.id, name: row.name, attentionMode: row.attentionMode,
      price: row.price, priceMode: row.priceMode, estimateAllowsBooking: row.estimateAllowsBooking,
      estimateOptions: parseEstimateOptions(row.estimateOptions), estimateQuestion: row.estimateQuestion,
      estimateExplanation: row.estimateExplanation, estimateDisclaimer: row.estimateDisclaimer,
      requiresPhoto: row.requiresPhoto, validationEnabled: row.validationEnabled,
      validationMessage: row.validationMessage, validationQuestion: row.validationQuestion }
  }
}

export class PrismaCatalogRepository {
  readonly #client: CatalogClient

  constructor(client: CatalogClient) {
    this.#client = client
  }

  async listCategories(input: { businessId: string; page: number }): Promise<CatalogPage<CatalogCategoryItem>> {
    return measureAttemptStage('catalog_list_categories', async () => {
      const where = eligibleCategoryWhere(input.businessId)
      const offset = catalogPageOffset(input.page)
      const [rows, realCategoryCount, uncategorizedService] = await Promise.all([
        this.#client.serviceCategory.findMany({
          where,
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
          skip: offset,
          take: CATALOG_CONTEXTUAL_PAGE_SIZE + 1,
          select: { id: true, name: true }
        }),
        this.#client.serviceCategory.count({ where }),
        this.#client.service.findFirst({
          where: uncategorizedRootServiceWhere(input.businessId),
          select: { id: true }
        })
      ])
      if (
        uncategorizedService &&
        realCategoryCount >= offset &&
        realCategoryCount < offset + CATALOG_CONTEXTUAL_PAGE_SIZE + 1
      ) {
        rows.push(UNCATEGORIZED_CATEGORY)
      }
      return toCatalogPage(rows, input.page)
    })
  }

  /** Complete bounded public catalogue; called inside the existing read-only snapshot. */
  async loadPublicCatalogSnapshot(businessId: string): Promise<CatalogServiceItem[]> {
    return measureAttemptStage('catalog_list_services', async () => {
      const categories: CatalogCategoryItem[] = await this.#client.serviceCategory.findMany({
        where: eligibleCategoryWhere(businessId),
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        take: 201,
        select: { id: true, name: true }
      })
      const uncategorized = await this.#client.service.findFirst({
        where: uncategorizedRootServiceWhere(businessId), select: { id: true }
      })
      if (uncategorized) categories.push(UNCATEGORIZED_CATEGORY)
      if (categories.length > 200) throw new Error('catalog exceeds supported bound')
      if (!categories.length) return []
      const categoryIds = categories.filter(category => category.id !== UNCATEGORIZED_CATEGORY_ID).map(category => category.id)
      const roots = await this.#client.service.findMany({
        where: {
          businessId, isActive: true, parentServiceId: null,
          OR: [{ catalogCategoryId: { in: categoryIds } }, ...(uncategorized ? [{ catalogCategoryId: null }] : [])],
          AND: { OR: [
            { isBookable: true, professionalLinks: eligibleBotProfessionalLinks(businessId) },
            { isBookable: false, variants: { some: { businessId, isBookable: true, isActive: true, professionalLinks: eligibleBotProfessionalLinks(businessId) } } }
          ] }
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        // Each of at most 200 categories permits 200 roots; one extra detects overflow.
        take: 40001,
        select: serviceSelect
      })
      const groups = new Map<string, CatalogServiceItem[]>()
      for (const row of roots) {
        const item = serviceItem(row)
        const group = groups.get(item.categoryId) ?? []
        group.push(item)
        if (group.length > 200) throw new Error('catalog exceeds supported bound')
        groups.set(item.categoryId, group)
      }
      const childScopes = categories.flatMap(category => {
        const parentIds = (groups.get(category.id) ?? []).filter(item => item.kind === 'SUBCATEGORY').map(item => item.id)
        return parentIds.length ? [{ catalogCategoryId: category.id === UNCATEGORIZED_CATEGORY_ID ? null : category.id, parentServiceId: { in: parentIds } }] : []
      })
      const children = childScopes.length ? await this.#client.service.findMany({
        where: { businessId, isActive: true, isBookable: true, professionalLinks: eligibleBotProfessionalLinks(businessId), OR: childScopes },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        take: 201,
        select: serviceSelect
      }) : []
      if (children.length > 200) throw new Error('catalog exceeds supported bound')
      const byParent = new Map<string, CatalogServiceItem[]>()
      for (const row of children) {
        const parentId = row.parentServiceId!
        const group = byParent.get(parentId) ?? []
        group.push(serviceItem(row)); byParent.set(parentId, group)
      }
      const result: CatalogServiceItem[] = []
      for (const category of categories) {
        for (const root of groups.get(category.id) ?? []) {
          result.push(...(root.kind === 'SUBCATEGORY' ? byParent.get(root.id) ?? [] : [root]))
          if (result.length > 200) throw new Error('catalog exceeds supported bound')
        }
      }
      return result
    })
  }
  async getCategory(input: { businessId: string; categoryId: string }): Promise<CatalogCategoryItem | null> {
    return measureAttemptStage('catalog_get_category', async () => {
      if (input.categoryId === UNCATEGORIZED_CATEGORY_ID) {
        const service = await this.#client.service.findFirst({
          where: uncategorizedRootServiceWhere(input.businessId),
          select: { id: true }
        })
        return service ? UNCATEGORIZED_CATEGORY : null
      }
      return this.#client.serviceCategory.findFirst({
        where: {
          id: input.categoryId,
          businessId: input.businessId,
          isActive: true,
          services: { some: {
            businessId: input.businessId,
            parentServiceId: null,
            OR: [
              { isBookable: true },
              { isBookable: false, variants: { some: { businessId: input.businessId, isBookable: true } } }
            ]
          } }
        },
        select: { id: true, name: true }
      })
    })
  }

  async listServices(input: {
    businessId: string
    categoryId: string
    parentServiceId?: string | null
    page: number
  }): Promise<CatalogPage<CatalogServiceItem> | null> {
    return measureAttemptStage('catalog_list_services', async () => {
      const uncategorized = input.categoryId === UNCATEGORIZED_CATEGORY_ID
      const category = uncategorized
        ? await this.#client.service.findFirst({
            where: uncategorizedRootServiceWhere(input.businessId),
            select: { id: true }
          })
        : await this.#client.serviceCategory.findFirst({
            where: { id: input.categoryId, businessId: input.businessId, isActive: true },
            select: { id: true }
          })
      if (!category) return null
      const catalogCategoryId = uncategorized ? null : input.categoryId
      if (input.parentServiceId) {
        const parent = await this.#client.service.findFirst({
          where: {
            id: input.parentServiceId,
            businessId: input.businessId,
            catalogCategoryId,
            parentServiceId: null,
            isBookable: false,
            isActive: true
          },
          select: { id: true }
        })
        if (!parent) return null
      }
      const rows = await this.#client.service.findMany({
        where: {
          businessId: input.businessId,
          isActive: true,
          catalogCategoryId,
          parentServiceId: input.parentServiceId ?? null,
          ...(input.parentServiceId
            ? { isBookable: true, isActive: true, professionalLinks: eligibleBotProfessionalLinks(input.businessId) }
            : {
                OR: [
                  { isBookable: true, isActive: true, professionalLinks: eligibleBotProfessionalLinks(input.businessId) },
                  { isBookable: false, isActive: true, variants: { some: { businessId: input.businessId, isBookable: true, isActive: true, professionalLinks: eligibleBotProfessionalLinks(input.businessId) } } }
                ]
              })
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        skip: catalogPageOffset(input.page),
        take: CATALOG_CONTEXTUAL_PAGE_SIZE + 1,
        select: serviceSelect
      })
      return toCatalogPage(rows.map(serviceItem), input.page)
    })
  }

  async getSubcategory(input: {
    businessId: string
    categoryId: string
    subcategoryId: string
  }): Promise<{ id: string; categoryId: string; name: string } | null> {
    return measureAttemptStage('catalog_get_subcategory', async () => {
      const uncategorized = input.categoryId === UNCATEGORIZED_CATEGORY_ID
      const catalogCategoryId = uncategorized ? null : input.categoryId
      const row = await this.#client.service.findFirst({
        where: {
          id: input.subcategoryId,
          businessId: input.businessId,
          catalogCategoryId,
          parentServiceId: null,
          isBookable: false,
          isActive: true,
          ...(uncategorized ? {} : { catalogCategory: { is: { businessId: input.businessId, isActive: true } } }),
          variants: { some: {
            businessId: input.businessId,
            catalogCategoryId,
            isBookable: true,
            isActive: true,
            professionalLinks: eligibleBotProfessionalLinks(input.businessId)
          } }
        },
        select: { id: true, catalogCategoryId: true, name: true }
      })
      return row ? { id: row.id, categoryId: input.categoryId, name: row.name } : null
    })
  }

  async getService(input: { businessId: string; serviceId: string }): Promise<CatalogServiceItem | null> {
    return measureAttemptStage('catalog_get_service', async () => {
      const row = await this.#client.service.findFirst({
        where: {
          id: input.serviceId,
          businessId: input.businessId,
          isBookable: true,
          isActive: true,
          professionalLinks: eligibleBotProfessionalLinks(input.businessId),
          OR: [
            { catalogCategoryId: null },
            { catalogCategory: { is: { businessId: input.businessId, isActive: true } } }
          ]
        },
        select: serviceSelect
      })
      return row ? serviceItem(row) : null
    })
  }
}
