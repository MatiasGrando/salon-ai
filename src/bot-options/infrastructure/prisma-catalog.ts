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

function uncategorizedRootServiceWhere(businessId: string): Prisma.ServiceWhereInput {
  return {
    businessId,
    catalogCategoryId: null,
    parentServiceId: null,
    OR: [
      { isBookable: true },
      { isBookable: false, variants: { some: { businessId, catalogCategoryId: null, isBookable: true } } }
    ]
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
    const where: Prisma.ServiceCategoryWhereInput = {
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
    }
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
  }

  async getCategory(input: { businessId: string; categoryId: string }): Promise<CatalogCategoryItem | null> {
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
  }

  async listServices(input: {
    businessId: string
    categoryId: string
    parentServiceId?: string | null
    page: number
  }): Promise<CatalogPage<CatalogServiceItem> | null> {
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
          isBookable: false
        },
        select: { id: true }
      })
      if (!parent) return null
    }
    const rows = await this.#client.service.findMany({
      where: {
        businessId: input.businessId,
        catalogCategoryId,
        parentServiceId: input.parentServiceId ?? null,
        ...(input.parentServiceId
          ? { isBookable: true }
          : {
              OR: [
                { isBookable: true },
                { isBookable: false, variants: { some: { businessId: input.businessId, isBookable: true } } }
              ]
            })
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      skip: catalogPageOffset(input.page),
      take: CATALOG_CONTEXTUAL_PAGE_SIZE + 1,
      select: serviceSelect
    })
    return toCatalogPage(rows.map(serviceItem), input.page)
  }

  async getSubcategory(input: {
    businessId: string
    categoryId: string
    subcategoryId: string
  }): Promise<{ id: string; categoryId: string; name: string } | null> {
    const uncategorized = input.categoryId === UNCATEGORIZED_CATEGORY_ID
    const catalogCategoryId = uncategorized ? null : input.categoryId
    const row = await this.#client.service.findFirst({
      where: {
        id: input.subcategoryId,
        businessId: input.businessId,
        catalogCategoryId,
        parentServiceId: null,
        isBookable: false,
        ...(uncategorized ? {} : { catalogCategory: { is: { businessId: input.businessId, isActive: true } } }),
        variants: { some: {
          businessId: input.businessId,
          catalogCategoryId,
          isBookable: true
        } }
      },
      select: { id: true, catalogCategoryId: true, name: true }
    })
    return row ? { id: row.id, categoryId: input.categoryId, name: row.name } : null
  }

  async getService(input: { businessId: string; serviceId: string }): Promise<CatalogServiceItem | null> {
    const row = await this.#client.service.findFirst({
      where: {
        id: input.serviceId,
        businessId: input.businessId,
        isBookable: true,
        OR: [
          { catalogCategoryId: null },
          { catalogCategory: { is: { businessId: input.businessId, isActive: true } } }
        ]
      },
      select: serviceSelect
    })
    return row ? serviceItem(row) : null
  }
}
