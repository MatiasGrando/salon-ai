export const CATALOG_CONTEXTUAL_PAGE_SIZE = 7

export type CatalogPage<T> = {
  items: T[]
  page: number
  hasPrevious: boolean
  hasNext: boolean
}

export type CatalogCategoryItem = {
  id: string
  name: string
}

export type CatalogServiceItem = {
  id: string
  categoryId: string
  parentServiceId: string | null
  kind: 'SERVICE' | 'SUBCATEGORY'
  name: string
  description: string | null
  durationMinutes: number | null
  durationMinMinutes: number | null
  durationMaxMinutes: number | null
  price: number | null
  priceMode: 'FIXED' | 'STARTING_AT'
  isBookable: boolean
  requiresConsultation: boolean
}

export function normalizeCatalogPage(page: number): number {
  if (!Number.isInteger(page) || page < 0) throw new Error('catalog page must be a non-negative integer')
  return page
}

export function catalogPageOffset(page: number): number {
  return normalizeCatalogPage(page) * CATALOG_CONTEXTUAL_PAGE_SIZE
}

export function toCatalogPage<T>(rows: readonly T[], page: number): CatalogPage<T> {
  const normalizedPage = normalizeCatalogPage(page)
  return {
    items: rows.slice(0, CATALOG_CONTEXTUAL_PAGE_SIZE),
    page: normalizedPage,
    hasPrevious: normalizedPage > 0,
    hasNext: rows.length > CATALOG_CONTEXTUAL_PAGE_SIZE
  }
}
