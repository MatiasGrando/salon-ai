import { createHash } from 'node:crypto'
import { localDateKey, parseMinutes, type AvailabilitySlot } from '../bot-options/application/availability-queries.js'

export type CoordinatedSegment = {
  serviceId: string; serviceName: string; professionalId: string; professionalName: string
  startAt: string; endAt: string; durationMinutes: number; customerDurationMinutes: number
}
export type SlotCoordination = { key: string; segments: CoordinatedSegment[] }
export type DialogueAvailabilitySlot = AvailabilitySlot & { coordination?: SlotCoordination }
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value)
const minutes = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 1440
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
/** Assignment identity binds the tenant and every ordered service/professional interval. */
export function coordinationKey(businessId: string, segments: readonly CoordinatedSegment[]): string {
  const canonical = segments.map(s => ({ serviceId: s.serviceId, serviceName: s.serviceName, professionalId: s.professionalId, professionalName: s.professionalName,
    startAt: s.startAt, endAt: s.endAt, durationMinutes: s.durationMinutes, customerDurationMinutes: s.customerDurationMinutes }))
  return createHash('sha256').update(JSON.stringify({ businessId, segments: canonical })).digest('hex')
}
/** Shape is not agenda authority: callers must still re-read the complete assignment. */
export function validateCoordinatedSlot(slot: DialogueAvailabilitySlot, scope: {
  businessId: string; serviceIds: readonly string[]; timezone?: string
  services?: readonly { id: string; name: string; durationMinutes: number | null; customerDurationMinutes?: number | null }[]
}): void {
  if (slot.coordination === undefined) return
  const c = slot.coordination
  if (!c || Object.keys(c).sort().join(',') !== 'key,segments' || !Array.isArray(c.segments) || c.segments.length < 2 || c.segments.length > 10 || !/^[a-f0-9]{64}$/.test(c.key)) throw Error('invalid coordinated assignment')
  if (JSON.stringify(c.segments.map(s => s?.serviceId)) !== JSON.stringify(scope.serviceIds) || new Set(scope.serviceIds).size !== scope.serviceIds.length) throw Error('invalid coordinated coverage')
  let preceding: CoordinatedSegment | undefined
  for (const s of c.segments) {
    if (!s || Object.keys(s).sort().join(',') !== 'customerDurationMinutes,durationMinutes,endAt,professionalId,professionalName,serviceId,serviceName,startAt' ||
      !text(s.serviceId,128) || !text(s.serviceName,200) || !text(s.professionalId,128) || !text(s.professionalName,200) || !instant(s.startAt) || !instant(s.endAt) || !minutes(s.durationMinutes) || !minutes(s.customerDurationMinutes) ||
      Date.parse(s.endAt) - Date.parse(s.startAt) !== Math.max(s.durationMinutes,s.customerDurationMinutes) * 60000 || preceding && preceding.endAt !== s.startAt) throw Error('invalid coordinated segment')
    if (scope.timezone && localDateKey(new Date(s.startAt),scope.timezone) !== slot.date) throw Error('invalid coordinated date')
    const service = scope.services?.find(service => service.id === s.serviceId)
    if (scope.services && (!service || service.name !== s.serviceName || service.durationMinutes !== s.durationMinutes || Math.max(service.durationMinutes ?? 0,service.customerDurationMinutes ?? service.durationMinutes ?? 0) !== s.customerDurationMinutes)) throw Error('invalid coordinated service snapshot')
    preceding = s
  }
  const first = c.segments[0]!, last = c.segments.at(-1)!
  if (slot.startAt !== first.startAt || slot.professionalId !== first.professionalId || slot.professionalName !== first.professionalName || slot.occupiedMinutes !== (Date.parse(last.endAt)-Date.parse(first.startAt))/60000 || parseMinutes(slot.time) === null || coordinationKey(scope.businessId,c.segments) !== c.key) throw Error('invalid coordinated anchor or key')
}
export function coordinationLabel(slot: DialogueAvailabilitySlot, timezone: string): string {
  return slot.coordination?.segments.map(s => {
    const time = new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(s.startAt))
    return time + ' ' + s.serviceName + ' con ' + s.professionalName
  }).join(' → ') ?? slot.professionalName
}
