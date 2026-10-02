import { buildCartSnapshot, cartChangeInvalidatesAvailability, type CartService } from '../bot-options/application/cart-operations.js'
import type { DialogueService } from './engine.js'

export type BasketMemberProposal = { mode: 'single' | 'alternatives' | 'unresolved'; serviceIds: readonly string[]; evidence: string; confidence: number }
export type BasketMutation = {
  kind: 'basket'; mutation: 'set' | 'add' | 'remove' | 'replace'; scope: 'all' | 'members'
  targetMemberIds: readonly string[]; members: readonly BasketMemberProposal[]; evidence: string; confidence: number
}
export type BasketMember = { memberId: string; mode: BasketMemberProposal['mode']; serviceIds: string[]; evidence: string }
export type ServiceBasket = { version: 1; nextMemberId: number; members: BasketMember[] }
export const BASKET_LIMITS = { members: 10, candidates: 10, serialized: 12000 } as const
type Selection = { serviceId: string | null; basket?: ServiceBasket }
const signature = (member: { mode: BasketMember['mode']; serviceIds: readonly string[]; evidence: string }) =>
  JSON.stringify([member.mode, member.serviceIds, member.mode === 'unresolved' ? member.evidence.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim() : null])
function error(reason: string): never { throw new Error('invalid basket: ' + reason) }
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
export function selectionBasket(state: Selection): ServiceBasket {
  return state.basket ? structuredClone(state.basket) : { version: 1, nextMemberId: state.serviceId ? 2 : 1, members: state.serviceId ? [{ memberId: 'm1', mode: 'single', serviceIds: [state.serviceId], evidence: 'legacy selection' }] : [] }
}
export function basketServiceIds(state: Selection): string[] {
  const members = selectionBasket(state).members
  return members.every(member => member.mode === 'single') ? members.flatMap(member => member.serviceIds) : []
}
export function hasBasketSelection(state: Selection): boolean { return Boolean(state.serviceId || state.basket?.members.length) }
export function basketIsResolved(state: Selection): boolean { return basketServiceIds(state).length > 0 }
/** Snapshots do not authorize catalog membership; that is freshly checked before agenda/proposal use. */
export function parseServiceBasket(value: unknown): ServiceBasket {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'members,nextMemberId,version' || value.version !== 1 ||
      !Number.isSafeInteger(value.nextMemberId) || Number(value.nextMemberId) < 1 || Number(value.nextMemberId) > 1000000 ||
      !Array.isArray(value.members) || value.members.length > BASKET_LIMITS.members || JSON.stringify(value).length > BASKET_LIMITS.serialized) error('snapshot')
  const ids = new Set<string>(), services = new Set<string>()
  for (const raw of value.members) {
    if (!record(raw) || Object.keys(raw).sort().join(',') !== 'evidence,memberId,mode,serviceIds' || typeof raw.memberId !== 'string' || !/^m[1-9][0-9]*$/.test(raw.memberId) ||
        Number(raw.memberId.slice(1)) >= Number(value.nextMemberId) || ids.has(raw.memberId) ||
        typeof raw.evidence !== 'string' || !raw.evidence.trim() || raw.evidence.length > 300 || /[\u0000-\u001f]/.test(raw.evidence) ||
        !['single','alternatives','unresolved'].includes(String(raw.mode)) || !Array.isArray(raw.serviceIds) ||
        raw.serviceIds.length > BASKET_LIMITS.candidates || (raw.mode === 'single' ? raw.serviceIds.length !== 1 : raw.mode === 'alternatives' ? raw.serviceIds.length < 2 : raw.serviceIds.length !== 0)) error('member')
    ids.add(raw.memberId)
    for (const id of raw.serviceIds) {
      if (typeof id !== 'string' || !id || id.length > 128 || /[\u0000-\u001f]/.test(id) || services.has(id)) error('duplicate or invalid service')
      services.add(id)
    }
  }
  return structuredClone(value) as unknown as ServiceBasket
}
/** Operations refer to stable existing member IDs, not guessed catalog offsets or parser state. */
export function applyBasketMutation(previous: ServiceBasket, op: BasketMutation): { basket: ServiceBasket; changed: boolean } {
  const targets = new Set(op.targetMemberIds)
  if (targets.size !== op.targetMemberIds.length || op.targetMemberIds.some(id => !previous.members.some(member => member.memberId === id))) error('unknown target')
  const additions = op.members
  let next: BasketMember[]
  let counter = previous.nextMemberId
  const materialize = (member: BasketMemberProposal) => {
    const unchanged = previous.members.find(old => signature(old) === signature(member))
    return unchanged ? structuredClone(unchanged) : { memberId: 'm' + counter++, mode: member.mode, serviceIds: [...member.serviceIds], evidence: member.evidence }
  }
  if (op.mutation === 'add') {
    next = [...previous.members]
    for (const member of additions) if (!next.some(old => signature(old) === signature(member))) next.push(materialize(member))
  } else if (op.mutation === 'remove') next = op.scope === 'all' ? [] : previous.members.filter(member => !targets.has(member.memberId))
  else if (op.scope === 'all') next = additions.map(materialize)
  else {
    const first = previous.members.findIndex(member => targets.has(member.memberId))
    next = previous.members.flatMap((member, index) => index === first ? additions.map(materialize) : targets.has(member.memberId) ? [] : [member])
  }
  // Choosing a group member already selected elsewhere resolves the group without duplicating a service.
  next = next.filter((member,index) => member.mode !== 'single' || next.findIndex(other => other.mode === 'single' && other.serviceIds[0] === member.serviceIds[0]) === index)
  const basket = parseServiceBasket({ version: 1, nextMemberId: counter, members: next })
  const changed = cartChangeInvalidatesAvailability(previous.members.map(signature), next.map(signature))
  return { basket: changed ? basket : structuredClone(previous), changed }
}
export function selectionSummary(services: readonly DialogueService[]): { durationMinutes: number; totalPrice: number | null } {
  const inputs: CartService[] = services.map(service => ({
    id: service.id, name: service.name, durationMinutes: service.durationMinutes!, priceMinor: service.price,
    priceMode: service.priceMode ?? 'FIXED', professionalIds: []
  }))
  const summary = buildCartSnapshot(inputs)
  // The aggregate can exceed the number contract even when each fixed price was representable.
  const totalPrice = summary.totalPriceMinor !== null && Number.isSafeInteger(summary.totalPriceMinor) && summary.totalPriceMinor >= 0
    ? summary.totalPriceMinor : null
  return { durationMinutes: summary.totalDurationMinutes, totalPrice }
}
