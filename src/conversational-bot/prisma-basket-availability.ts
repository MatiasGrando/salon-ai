import { Prisma } from '../generated/prisma/client.js'
import { PrismaCatalogRepository } from '../bot-options/infrastructure/prisma-catalog.js'
import { PrismaAvailabilityRepository } from '../bot-options/infrastructure/prisma-availability.js'
import { buildCartSnapshot, canAddService, type CartCombinationPolicy, type CartService } from '../bot-options/application/cart-operations.js'
import { localDateKey, type AvailabilitySettings } from '../bot-options/application/availability-queries.js'
import { reservationDurationLimits } from '../services/service-duration.js'
import type { DialogueBasketAvailability, DialogueContext, DialogueService } from './engine.js'
import type { CatalogServiceItem } from '../bot-options/application/catalog-queries.js'
import { parseServiceEstimates, resolveGuidance, serviceGuidance, type ServiceEstimates } from './service-guidance.js'

type BasketClient = ConstructorParameters<typeof PrismaCatalogRepository>[0] & ConstructorParameters<typeof PrismaAvailabilityRepository>[0]
const boundedId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value)
const positiveMinutes = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 1440
function validateDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid basket date')
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const value = new Date(Date.UTC(year, month - 1, day))
  if (year < 1900 || value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) throw new Error('invalid basket date')
}

/** Commercial and freshly authorized snapshots share the same policy shape, never an inferred direct mode. */
export function projectDialogueService(row: CatalogServiceItem): DialogueService {
  const duration = row.durationMinutes === null ? null : reservationDurationLimits({ duration: row.durationMinutes,
    customerDurationMin: row.durationMinMinutes, customerDurationMax: row.durationMaxMinutes })
  return { id: row.id, name: row.name, durationMinutes: row.durationMinutes, price: row.price, priceMode: row.priceMode,
    requiresConsultation: row.requiresConsultation, professionalDurationMinutes: duration?.professional ?? null,
    customerDurationMinutes: duration?.business ?? null, ...(row.bookingPolicy !== undefined ? { bookingPolicy: structuredClone(row.bookingPolicy) } : {}) }
}
/** Read-only proposal adapter. Cached descriptors supply IDs, never permission, price or duration. */
export async function loadPrismaBasketAvailability(
  client: BasketClient, context: DialogueContext, settings: AvailabilitySettings,
  requested: readonly DialogueService[], date: string, professionalId?: string, serviceEstimates: ServiceEstimates = {}
): Promise<DialogueBasketAvailability> {
  if (requested.length < 1 || requested.length > 10 || requested.some(service => !boundedId(service.id)) || new Set(requested.map(service => service.id)).size !== requested.length) return { ok: false, reason: 'SERVICE_UNAVAILABLE' }
  if (professionalId !== undefined && !boundedId(professionalId)) return { ok: false, reason: 'NO_COMMON_PROFESSIONAL' }
  validateDate(date)
  const catalog = new PrismaCatalogRepository(client)
  const availability = new PrismaAvailabilityRepository(client)
  // All rows are revalidated before any agenda query. No partial basket is returned.
  const loaded = await Promise.all(requested.map(service => catalog.getService({ businessId: context.businessId, serviceId: service.id })))
  if (loaded.some((service, index) => !service || service.id !== requested[index]!.id)) return { ok: false, reason: 'SERVICE_UNAVAILABLE' }
  const services: DialogueService[] = []
  for (const row of loaded) {
    if (!row) return { ok: false, reason: 'SERVICE_UNAVAILABLE' }
    if (!positiveMinutes(row.durationMinutes) || row.durationMinMinutes != null && !positiveMinutes(row.durationMinMinutes) ||
      row.durationMaxMinutes != null && (!positiveMinutes(row.durationMaxMinutes) || row.durationMinMinutes == null || row.durationMaxMinutes < row.durationMinMinutes)) return { ok: false, reason: 'INVALID_DURATION' }
    if (row.price !== null && (!Number.isSafeInteger(row.price) || row.price < 0) || !['FIXED', 'STARTING_AT'].includes(row.priceMode)) throw new Error('invalid basket service price')
    const service = projectDialogueService(row)
    const guidance = serviceGuidance(service)
    if (guidance.kind === 'blocked') return { ok: false, reason: guidance.reason }
    services.push(service)
  }
  const durationMinutes = services.reduce((sum, service) => sum + service.durationMinutes!, 0)
  const customerDurationMinutes = services.reduce((sum, service) => sum + service.customerDurationMinutes!, 0)
  if (!positiveMinutes(durationMinutes) || !positiveMinutes(customerDurationMinutes)) return { ok: false, reason: 'INVALID_DURATION' }
  let selections: ServiceEstimates
  try { selections = parseServiceEstimates(serviceEstimates, services.map(service => service.id)) }
  catch { return { ok: false, reason: 'INVALID_CONFIGURATION' } }
  const guidance = resolveGuidance(services, selections)
  if (guidance.blocked) return { ok: false, reason: guidance.blocked.reason }
  if (guidance.pending) return { ok: false, reason: 'GUIDANCE_REQUIRED', services }
  const ids = services.map(service => service.id)
  const rules = ids.length < 2 ? [] : await client.$queryRaw<Array<{ serviceAId: string; serviceBId: string; policy: CartCombinationPolicy }>>(Prisma.sql`
    SELECT "serviceAId", "serviceBId", "policy"::text AS "policy"
    FROM "ServiceCombinationRule"
    WHERE "businessId" = ${context.businessId} AND "serviceAId" IN (${Prisma.join(ids)}) AND "serviceBId" IN (${Prisma.join(ids)})
  `)
  const policies = new Map<string, CartCombinationPolicy>()
  const severity = { ALLOWED: 0, REVIEW_REQUIRED: 1, BLOCKED: 2 }
  for (const rule of rules) {
    if (!ids.includes(rule.serviceAId) || !ids.includes(rule.serviceBId) || rule.serviceAId === rule.serviceBId || !Object.hasOwn(severity, rule.policy)) throw new Error('invalid basket combination rule')
    const key = [rule.serviceAId, rule.serviceBId].sort().join(':')
    const previous = policies.get(key)
    if (!previous || severity[rule.policy] > severity[previous]) policies.set(key, rule.policy)
  }
  // Same verified common professionals feed the pure cart calculation; no cart repository bypasses policy.
  const professionals = await availability.compatibleProfessionals({ businessId: context.businessId, serviceIds: ids })
  if (professionals.length > 50 || new Set(professionals.map(professional => professional.id)).size !== professionals.length || professionals.some(professional => !boundedId(professional.id))) throw new Error('professional catalog exceeds supported bound')
  if (!professionals.length || professionalId && !professionals.some(professional => professional.id === professionalId)) return { ok: false, reason: 'NO_COMMON_PROFESSIONAL' }
  const professionalIds = professionals.map(professional => professional.id)
  let cart = buildCartSnapshot([])
  for (const service of services) {
    const item: CartService = { id: service.id, name: service.name, durationMinutes: service.durationMinutes!,
      priceMinor: service.price,
      priceMode: serviceGuidance(service).kind === 'guided' ? 'STARTING_AT' : service.priceMode!, professionalIds }
    const addition = canAddService({ current: cart, proposed: item, pairPolicies: policies })
    if (!addition.ok) return { ok: false, reason: addition.reason === 'BLOCKED' ? 'COMBINATION_BLOCKED' : addition.reason === 'REVIEW_REQUIRED' ? 'COMBINATION_REVIEW' : 'NO_COMMON_PROFESSIONAL' }
    cart = addition.snapshot
  }
  const totalPrice = cart.totalPriceMinor !== null && Number.isSafeInteger(cart.totalPriceMinor) ? cart.totalPriceMinor : null
  const today = localDateKey(context.dbNow, settings.timezone)
  const last = localDateKey(context.dbNow, settings.timezone, settings.horizonDays)
  if (date < today || date >= last) return { ok: true, services, durationMinutes, customerDurationMinutes, totalPrice, professionals, slots: [] }
  const selectedProfessionals = professionalId ? professionals.filter(professional => professional.id === professionalId) : professionals
  const slots = []
  // Preserve alternatives at the same hour rather than silently balancing them away.
  for (const professional of selectedProfessionals) {
    const result = await availability.search({ businessId: context.businessId, serviceIds: ids, durationMinutes, customerDurationMinutes, dbNow: context.dbNow, settings, professionalId: professional.id })
    slots.push(...result.slots.filter(slot => slot.date === date && slot.professionalId === professional.id))
    if (slots.length > 500) throw new Error('availability exceeds supported bound')
  }
  return { ok: true, services, durationMinutes, customerDurationMinutes, totalPrice, professionals, slots: slots.sort((left, right) => left.startAt.localeCompare(right.startAt) || left.professionalId.localeCompare(right.professionalId)) }
}
