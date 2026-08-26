import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import {
  CATALOG_CONTEXTUAL_PAGE_SIZE,
  catalogPageOffset,
  toCatalogPage,
  type CatalogCategoryItem,
  type CatalogPage,
  type CatalogServiceItem
} from '../application/catalog-queries.js'

type CatalogClient = Pick<PrismaClient, 'serviceCategory' | 'service'> | Prisma.TransactionClient

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
  estimateAllowsBooking: true
} as const

type ServiceRow = Prisma.ServiceGetPayload<{ select: typeof serviceSelect }>

function serviceItem(row: ServiceRow): CatalogServiceItem {
  const subcategory = !row.isBookable
  return {
    id: row.id,
    categoryId: row.catalogCategoryId!,
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
    requiresConsultation: !subcategory && (row.attentionMode !== 'DIRECT_BOOKING' || row.estimateAllowsBooking === false)
  }
}

export class PrismaCatalogRepository {
  readonly #client: CatalogClient

  constructor(client: CatalogClient) {
    this.#client = client
  }

  async listCategories(input: { businessId: string; page: number }): Promise<CatalogPage<CatalogCategoryItem>> {
    const rows = await this.#client.serviceCategory.findMany({
      where: {
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
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      skip: catalogPageOffset(input.page),
      take: CATALOG_CONTEXTUAL_PAGE_SIZE + 1,
      select: { id: true, name: true }
    })
    return toCatalogPage(rows, input.page)
  }

  async getCategory(input: { businessId: string; categoryId: string }): Promise<CatalogCategoryItem | null> {
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
    const category = await this.#client.serviceCategory.findFirst({
      where: { id: input.categoryId, businessId: input.businessId, isActive: true },
      select: { id: true }
    })
    if (!category) return null
    if (input.parentServiceId) {
      const parent = await this.#client.service.findFirst({
        where: {
          id: input.parentServiceId,
          businessId: input.businessId,
          catalogCategoryId: input.categoryId,
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
        catalogCategoryId: input.categoryId,
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
    const row = await this.#client.service.findFirst({
      where: {
        id: input.subcategoryId,
        businessId: input.businessId,
        catalogCategoryId: input.categoryId,
        parentServiceId: null,
        isBookable: false,
        catalogCategory: { is: { businessId: input.businessId, isActive: true } },
        variants: { some: {
          businessId: input.businessId,
          catalogCategoryId: input.categoryId,
          isBookable: true
        } }
      },
      select: { id: true, catalogCategoryId: true, name: true }
    })
    return row?.catalogCategoryId
      ? { id: row.id, categoryId: row.catalogCategoryId, name: row.name }
      : null
  }

  async getService(input: { businessId: string; serviceId: string }): Promise<CatalogServiceItem | null> {
    const row = await this.#client.service.findFirst({
      where: {
        id: input.serviceId,
        businessId: input.businessId,
        isBookable: true,
        catalogCategory: { is: { businessId: input.businessId, isActive: true } }
      },
      select: serviceSelect
    })
    return row ? serviceItem(row) : null
  }
}
