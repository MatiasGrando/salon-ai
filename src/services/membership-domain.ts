import { BookingProgramError, addDateDays } from './booking-program-domain.js'

export type MembershipServiceInput = { serviceId: string; uses: number; pricingMode: 'FIXED' | 'PERCENTAGE'; fixedPrice?: number; discountPercent?: number }
export type MembershipService = { serviceId: string; name: string; uses: number; pricingMode: 'FIXED' | 'PERCENTAGE'; fixedPrice: number | null; discountPercent: number | null; listPrice: number; unitPrice: number }
export type MembershipAllocation = { serviceId: string; originalPrice: number; unitPrice: number }
type Use = { state: string; allocations?: unknown }
const integer = (value: unknown, min: number, max = 2147483647): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
function invalid(message: string): never { throw new BookingProgramError('INVALID_MEMBERSHIP', message, 400) }

export function membershipServices(value: unknown): MembershipService[] { return Array.isArray(value) ? value as MembershipService[] : [] }
export function membershipAllocations(value: unknown): MembershipAllocation[] { return Array.isArray(value) ? value as MembershipAllocation[] : [] }
export function validateMembershipItems(value: unknown): asserts value is MembershipServiceInput[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) invalid('Agrega al menos un servicio a la membresia.')
  const ids = new Set<string>()
  for (const item of value) {
    if (!item || typeof item.serviceId !== 'string' || !item.serviceId || ids.has(item.serviceId) || !integer(item.uses, 1, 10000)) invalid('Revisa los servicios y sus cantidades. Cada servicio debe aparecer una sola vez.')
    if (item.pricingMode === 'FIXED' ? !integer(item.fixedPrice, 0) : item.pricingMode !== 'PERCENTAGE' || !integer(item.discountPercent, 0, 100)) invalid('Indica un precio fijo o un descuento entre 0 y 100 para cada servicio.')
    ids.add(item.serviceId)
  }
}
export function priceMembership(items: MembershipServiceInput[], services: Array<{ id: string; name: string; price: number | null; priceMode: string }>) {
  validateMembershipItems(items)
  const rules = items.map(item => {
    const service = services.find(s => s.id === item.serviceId)
    if (!service || !integer(service.price, 0) || service.priceMode !== 'FIXED') invalid('Los servicios incluidos deben estar activos y tener un precio definido.')
    const listPrice = service.price!
    const unitPrice = item.pricingMode === 'FIXED' ? item.fixedPrice! : Math.round(listPrice * (100 - item.discountPercent!) / 100)
    return { serviceId: item.serviceId, name: service.name, uses: item.uses, pricingMode: item.pricingMode, fixedPrice: item.pricingMode === 'FIXED' ? unitPrice : null, discountPercent: item.pricingMode === 'PERCENTAGE' ? item.discountPercent! : null, listPrice, unitPrice }
  })
  const totalUses = rules.reduce((sum, row) => sum + row.uses, 0)
  const commissionBase = rules.reduce((sum, row) => sum + row.uses * row.unitPrice, 0)
  if (!integer(totalUses, 1, 10000)) invalid('La membresia admite hasta 10000 usos en total.')
  if (!integer(commissionBase, 0)) invalid('La base total para comisiones supera el importe maximo permitido.')
  return { rules, totalUses }
}
export function membershipEnd(startsOn: string, validityDays: number) { return addDateDays(startsOn, validityDays - 1) }

export function membershipBalances(rulesValue: unknown, uses: Use[], startsOn: string, endsOn: string, today: string, revoked = false) {
  return membershipServices(rulesValue).map(rule => {
    const count = (state: string) => uses.filter(u => u.state === state).reduce((sum, u) => sum + membershipAllocations(u.allocations).filter(a => a.serviceId === rule.serviceId).length, 0)
    const used = count('CONSUMED'), reserved = count('RESERVED')
    const remaining = Math.max(0, rule.uses - used - reserved)
    return { ...rule, used, reserved, available: revoked || today < startsOn || today > endsOn ? 0 : remaining, expiredUses: today > endsOn ? remaining : 0 }
  })
}
export function allocateMembership(grant: { serviceRules?: unknown; serviceIds: string[]; totalUses: number | null; uses: Use[] }, items: Array<{ serviceId: string; price: number | null }>): MembershipAllocation[] {
  const rules = membershipServices(grant.serviceRules)
  if (!rules.length) return []
  return items.flatMap(item => {
    const rule = rules.find(r => r.serviceId === item.serviceId)
    if (!rule || item.price === null) return []
    const taken = grant.uses.filter(u => u.state === 'RESERVED' || u.state === 'CONSUMED').reduce((sum, u) => sum + membershipAllocations(u.allocations).filter(a => a.serviceId === item.serviceId).length, 0)
    return taken < rule.uses ? [{ serviceId: item.serviceId, originalPrice: item.price, unitPrice: rule.unitPrice }] : []
  })
}
export function hasServiceBenefit(grant: { serviceRules?: unknown; serviceIds: string[]; totalUses: number | null; uses: Use[] }, serviceId: string) {
  return membershipServices(grant.serviceRules).length ? allocateMembership(grant, [{ serviceId, price: 0 }]).length > 0 : grant.serviceIds.includes(serviceId) && (grant.totalUses === null || grant.uses.filter(u => u.state === 'RESERVED' || u.state === 'CONSUMED').length < grant.totalUses)
}
