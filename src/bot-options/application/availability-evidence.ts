import { localDateKey, parseMinutes, type AvailabilitySlot, type AvailabilityProfessional } from './availability-queries.js'
/** Internal fresh snapshot evidence. These finite causes contain no customer/provider text. */
export const AVAILABILITY_CAUSES = ['BUSINESS_CLOSED', 'PROFESSIONAL_NOT_WORKING', 'NO_COMPATIBLE_WINDOW', 'DURATION_DOES_NOT_FIT', 'LEAD_TIME', 'BLOCKED', 'BUSY', 'NO_SLOTS', 'DATE_PAST', 'OUTSIDE_HORIZON', 'PREFERENCE_NO_MATCH'] as const
export type AvailabilityCause = typeof AVAILABILITY_CAUSES[number]
export type ProfessionalAvailabilityEvidence = { professionalId: string; reasons: AvailabilityCause[]; slotCount: number }
export type DateAvailabilityEvidence = { date: string; reasons: AvailabilityCause[]; professionals: ProfessionalAvailabilityEvidence[] }
export type AvailabilitySearchEvidence = { version: 1; days: DateAvailabilityEvidence[] }
export type AvailabilityExplanation = {
  date: string; reasons: AvailabilityCause[]
  /** Real compatible slots; bounded alternatives are suggestions, not a preference change. */
  otherProfessionals: AvailabilitySlot[]; nextDates: AvailabilitySlot[]
}
export type AvailabilityRejections = { professionalId: string; hasWorkingHours: boolean; hasJointWindow: boolean; intervalCount: number; leadTime: number; blocked: number; busy: number; slotCount: number }
export function explainAvailabilityDay(date: string, businessOpen: boolean, rows: readonly AvailabilityRejections[]): DateAvailabilityEvidence {
  const professionals = rows.map(row => {
    const reasons: AvailabilityCause[] = row.slotCount ? [] : !businessOpen ? ['BUSINESS_CLOSED']
      : !row.hasWorkingHours ? ['PROFESSIONAL_NOT_WORKING'] : !row.hasJointWindow ? ['NO_COMPATIBLE_WINDOW']
        : !row.intervalCount ? ['DURATION_DOES_NOT_FIT'] : [
          ...(row.leadTime ? ['LEAD_TIME' as const] : []), ...(row.blocked ? ['BLOCKED' as const] : []), ...(row.busy ? ['BUSY' as const] : [])
        ]
    return { professionalId: row.professionalId, reasons: reasons.length || row.slotCount ? reasons : ['NO_SLOTS' as const], slotCount: row.slotCount }
  })
  const reasons = professionals.some(pro => pro.slotCount) ? [] : [...new Set(professionals.flatMap(pro => pro.reasons))]
  return { date, reasons: !businessOpen ? ['BUSINESS_CLOSED'] : reasons.length ? reasons : professionals.length ? [] : ['NO_SLOTS'], professionals }
}
/** Read the requested preference's evidence without discarding alternatives from the same snapshot. */
export function explanationForDate(evidence: AvailabilitySearchEvidence, date: string, professionalId: string | undefined,
  slots: readonly AvailabilitySlot[]): AvailabilityExplanation {
  const day = evidence.days.find(day => day.date === date)
  const reasons = professionalId ? day?.professionals.find(pro => pro.professionalId === professionalId)?.reasons ?? ['NO_SLOTS' as const] : day?.reasons ?? ['NO_SLOTS' as const]
  const otherProfessionals = professionalId ? slots.filter(slot => slot.date === date && slot.professionalId !== professionalId).slice(0, 3) : []
  const dates = new Set<string>()
  const nextDates = slots.filter(slot => slot.date > date && (!professionalId || slot.professionalId === professionalId) && !dates.has(slot.date) && Boolean(dates.add(slot.date))).slice(0, 3)
  return { date, reasons: [...reasons], otherProfessionals, nextDates }
}
/** Validate explanation alongside its fresh scoped port result; no arbitrary provider fields become facts. */
export function parseAvailabilityExplanation(value: unknown, scope: { date: string; professionalId?: string; professionals: readonly AvailabilityProfessional[]; dbNow: Date; timezone: string }): AvailabilityExplanation {
  const fail = (): never => { throw new Error('invalid availability explanation') }
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item) &&
    Object.values(Object.getOwnPropertyDescriptors(item)).every(property => Object.hasOwn(property, 'value'))
  if (!record(value) || Object.keys(value).sort().join(',') !== 'date,nextDates,otherProfessionals,reasons' || value.date !== scope.date ||
    !Array.isArray(value.reasons) || value.reasons.length > AVAILABILITY_CAUSES.length || new Set(value.reasons).size !== value.reasons.length ||
    value.reasons.some(reason => !AVAILABILITY_CAUSES.includes(reason))) return fail()
  const bounded = (item: unknown, max: number): item is string => typeof item === 'string' && item.length > 0 && item.length <= max && !/[\u0000-\u001f]/.test(item)
  const parseSlots = (raw: unknown, other: boolean): AvailabilitySlot[] => {
    if (!Array.isArray(raw) || raw.length > 3) return fail()
    const keys = new Set<string>(), dates = new Set<string>()
    return raw.map(slot => {
      if (!record(slot) || Object.keys(slot).sort().join(',') !== 'band,date,occupiedMinutes,professionalId,professionalName,startAt,time' ||
        !bounded(slot.startAt, 40) || !bounded(slot.date, 10) || !bounded(slot.time, 5) || !bounded(slot.professionalId, 128) || !bounded(slot.professionalName, 200) ||
        !['MORNING', 'AFTERNOON', 'EVENING'].includes(String(slot.band)) || !Number.isSafeInteger(slot.occupiedMinutes) || Number(slot.occupiedMinutes) < 0) return fail()
      const instant = new Date(slot.startAt)
      const professional = scope.professionals.find(pro => pro.id === slot.professionalId && pro.name === slot.professionalName)
      if (!professional || !Number.isFinite(instant.getTime()) || instant <= scope.dbNow || parseMinutes(slot.time) === null ||
        localDateKey(instant, scope.timezone) !== slot.date ||
        new Intl.DateTimeFormat('en-GB', { timeZone: scope.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant) !== slot.time ||
        (other ? !scope.professionalId || slot.date !== scope.date || slot.professionalId === scope.professionalId
          : slot.date <= scope.date || !!scope.professionalId && slot.professionalId !== scope.professionalId)) return fail()
      const key = slot.startAt + ':' + slot.professionalId
      if (keys.has(key) || !other && dates.has(slot.date)) return fail()
      keys.add(key); dates.add(slot.date)
      return structuredClone(slot) as AvailabilitySlot
    })
  }
  return { date: scope.date, reasons: [...value.reasons] as AvailabilityCause[], otherProfessionals: parseSlots(value.otherProfessionals, true), nextDates: parseSlots(value.nextDates, false) }
}