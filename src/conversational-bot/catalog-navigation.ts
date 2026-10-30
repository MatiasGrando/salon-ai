import { createHash } from 'node:crypto'
import type { DialogueService, DialogueState } from './engine.js'
import type { ConversationChoicePresentation } from './choices.js'

/** Public browsing metadata; categories never represent basket members. */
export type CatalogNavigation = { businessId: string; displayMode: 'ALL_SERVICES' | 'CATEGORIES_FIRST'; categories: readonly { id: string; name: string }[] }
export type CatalogNavigationState = { version: 1; businessId: string; configurationKey: string; view: 'categories' | 'services'; categoryId: string | null; page: number }
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value)
export function validateCatalogNavigation(value: CatalogNavigation, businessId: string, services: readonly DialogueService[]): CatalogNavigation {
  if (!value || value.businessId !== businessId || !['ALL_SERVICES', 'CATEGORIES_FIRST'].includes(value.displayMode) ||
      !Array.isArray(value.categories) || value.categories.length > 200 || new Set(value.categories.map(category => category.id)).size !== value.categories.length ||
      value.categories.some(category => !text(category.id) || category.id.length > 128 || !text(category.name))) throw new Error('invalid catalog navigation scope')
  return { businessId, displayMode: value.displayMode, categories: value.categories.filter(category => services.some(service => service.categoryId === category.id)).map(category => ({ ...category })) }
}
export function catalogNavigationKey(navigation: CatalogNavigation, services: readonly DialogueService[]): string {
  return createHash('sha256').update(JSON.stringify([navigation.businessId, navigation.displayMode, navigation.categories,
    services.map(service => [service.id, service.name, service.categoryId ?? null])])).digest('hex')
}
export function parseCatalogNavigationState(value: unknown, businessId: string): CatalogNavigationState {
  const row = value as CatalogNavigationState
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).sort().join(',') !== 'businessId,categoryId,configurationKey,page,version,view' ||
      row.version !== 1 || row.businessId !== businessId || !/^[a-f0-9]{64}$/.test(row.configurationKey) || !['categories', 'services'].includes(row.view) ||
      row.categoryId !== null && (!text(row.categoryId) || row.categoryId.length > 128) || row.view === 'categories' && row.categoryId !== null ||
      !Number.isSafeInteger(row.page) || row.page < 0 || row.page > 199) throw new Error('invalid catalog navigation state')
  return structuredClone(row)
}
/** Structural paging only. Text intent and category identity remain the interpreter's job. */
export function catalogNavigationPage(state: DialogueState, services: readonly DialogueService[], navigation: CatalogNavigation,
  target?: { view: 'categories' | 'services'; categoryId: string | null; page: number }): { question: string; options: { id: string; label: string }[]; presentation?: ConversationChoicePresentation } {
  const key = catalogNavigationKey(navigation, services)
  const view = target?.view ?? (navigation.categories.length && (navigation.displayMode === 'CATEGORIES_FIRST' || services.length > 9) ? 'categories' : 'services')
  const categoryId = target?.categoryId ?? null, page = target?.page ?? 0
  if (categoryId !== null && !navigation.categories.some(category => category.id === categoryId)) throw new Error('catalog category unavailable')
  const entries = view === 'categories' ? navigation.categories.map(category => ({ id: category.id, label: category.name }))
    : services.filter(service => categoryId === null || service.categoryId === categoryId).map(service => ({ id: service.id, label: service.name }))
  // Nine direct services fit one page; paged views reserve two rows for navigation.
  const size = entries.length <= 9 ? 9 : 8, offset = page * size
  if (!Number.isSafeInteger(page) || page < 0 || page > 0 && offset >= entries.length) throw new Error('catalog page unavailable')
  state.catalogNavigation = { version: 1, businessId: state.businessId, configurationKey: key, view, categoryId, page }
  const choices: { label: string; operation: import('./choices.js').ConversationChoiceOperation }[] = entries.slice(offset, offset + size).map(entry => ({ label: entry.label,
    operation: view === 'categories' ? { kind: 'category', categoryId: entry.id } : { kind: 'service', serviceId: entry.id } }))
  const questionKind = view === 'categories' ? 'categories' as const : 'catalog_services' as const
  if (page > 0) choices.push({ label: 'Página anterior', operation: { kind: 'page', questionKind, cursor: page - 1 } })
  if (offset + size < entries.length) choices.push({ label: 'Ver más opciones', operation: { kind: 'page', questionKind, cursor: page + 1 } })
  const question = view === 'categories' ? '¿Qué te gustaría hacerte?' : '¿Qué servicio estás buscando o qué te gustaría hacerte?'
  return { question, options: choices.map(choice => ({ id: choice.operation.kind === 'page' ? `page:${questionKind}:${choice.operation.cursor}` : choice.operation.kind === 'category' ? 'category:' + choice.operation.categoryId : choice.operation.kind === 'service' ? choice.operation.serviceId : '', label: choice.label })),
    ...(choices.length ? { presentation: { kind: view === 'categories' ? 'category' : 'service', title: view === 'categories' ? 'Categorías disponibles' : 'Servicios disponibles', choices } } : {}) }
}
