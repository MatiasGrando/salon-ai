import { AVAILABILITY_CAUSES, type AvailabilityCause } from './availability-evidence.js'
import { BOOKING_GRID_MINUTES, localDateKey, localDateTimeToInstants, parseMinutes, weekdayInTimezone, type AvailabilityProfessional, type AvailabilitySettings } from './availability-queries.js'
import { reservationFitsAvailabilityWindow } from '../../services/service-duration.js'

export type RequestedStartEvidence = {
  version: 1; businessId: string; serviceIds: string[]; date: string; time: string
  durationMinutes: number; customerDurationMinutes: number; checkedAt: string; timezone: string
  professionals: Array<{ professionalId: string; available: boolean; reasons: AvailabilityCause[] }>
}
export type RequestedStartExplanation = { date: string; time: string; available: boolean; reasons: AvailabilityCause[] }
export type RequestedStartScope = {
  businessId: string; serviceIds: readonly string[]; date: string; time: string
  durationMinutes: number; customerDurationMinutes: number; dbNow: Date; timezone: string
  professionals: readonly AvailabilityProfessional[]; professionalId?: string
}
type Hours = { ownerId: string; dayOfWeek: number; startTime: string; endTime: string }
type Busy = { professionalId: string; startAt: Date; duration: number }
type Block = { professionalId: string | null; startAt: Date; endAt: Date }
const bounded = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v)
const duration = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= 1440
const validDate = (v: unknown): v is Date => v instanceof Date && Number.isFinite(v.getTime())
function targetInstant(date: string, time: string, timezone: string): Date | undefined {
  const minute = parseMinutes(time)
  if (minute === null || minute % BOOKING_GRID_MINUTES) return undefined
  const instants = localDateTimeToInstants(date, minute, timezone)
  return instants.length === 1 ? instants[0] : undefined
}
/** Same loaded agenda snapshot only; ambiguous/non-grid targets are deliberately not proof. */
export function buildRequestedStartEvidence(input: {
  businessId: string; serviceIds: readonly string[]; durationMinutes: number; customerDurationMinutes: number
  requestedStart: { date: string; time: string }; dbNow: Date; settings: AvailabilitySettings
  professionals: readonly AvailabilityProfessional[]; businessHours: readonly Hours[]; professionalHours: readonly Hours[]
  blocks: readonly Block[]; busy: readonly Busy[]
}): RequestedStartEvidence | undefined {
  const { date, time } = input.requestedStart
  if (!bounded(date, 10) || !bounded(time, 5) || !validDate(input.dbNow) || !duration(input.durationMinutes) || !duration(input.customerDurationMinutes) ||
    !bounded(input.businessId, 128) || !input.serviceIds.length || input.serviceIds.some(id => !bounded(id, 128))) return undefined
  const instant = targetInstant(date, time, input.settings.timezone)
  const first = localDateKey(input.dbNow, input.settings.timezone), last = localDateKey(input.dbNow, input.settings.timezone, input.settings.horizonDays)
  if (!instant || date < first || date >= last || !input.professionals.length || input.professionals.length > 50) return undefined
  const ids = new Set(input.professionals.map(pro => pro.id))
  if (ids.size !== input.professionals.length || [...ids].some(id => !bounded(id, 128))) return undefined
  const validHours = (row: Hours) => Number.isInteger(row.dayOfWeek) && row.dayOfWeek >= 0 && row.dayOfWeek <= 6 &&
    parseMinutes(row.startTime) !== null && parseMinutes(row.endTime) !== null && row.startTime < row.endTime
  if (input.businessHours.some(row => row.ownerId !== input.businessId || !validHours(row)) ||
    input.professionalHours.some(row => !ids.has(row.ownerId) || !validHours(row)) ||
    input.busy.some(row => !ids.has(row.professionalId) || !validDate(row.startAt) || !duration(row.duration)) ||
    input.blocks.some(row => row.professionalId !== null && !ids.has(row.professionalId) || !validDate(row.startAt) || !validDate(row.endAt) || row.endAt <= row.startAt)) return undefined
  const weekday = weekdayInTimezone(instant, input.settings.timezone), minute = parseMinutes(time)!
  const businessWindows = input.businessHours.filter(row => row.dayOfWeek === weekday)
  const contains = (row: Hours) => parseMinutes(row.startTime)! <= minute && minute < parseMinutes(row.endTime)!
  const businessAtStart = businessWindows.filter(contains)
  const finish = new Date(instant.getTime() + input.durationMinutes * 60000)
  const customerFinish = new Date(instant.getTime() + input.customerDurationMinutes * 60000)
  const professionals = input.professionals.map(pro => {
    const proWindows = input.professionalHours.filter(row => row.ownerId === pro.id && row.dayOfWeek === weekday)
    const proAtStart = proWindows.filter(contains)
    let reasons: AvailabilityCause[] = !businessWindows.length ? ['BUSINESS_CLOSED']
      : !businessAtStart.length ? ['REQUESTED_START_OUTSIDE_BUSINESS_HOURS']
      : !proWindows.length ? ['PROFESSIONAL_NOT_WORKING']
      : !proAtStart.length ? ['REQUESTED_START_OUTSIDE_PROFESSIONAL_HOURS']
      : !businessAtStart.some(b => proAtStart.some(p => reservationFitsAvailabilityWindow({
        service: { duration: input.durationMinutes, customerDurationMin: input.customerDurationMinutes, customerDurationMax: input.customerDurationMinutes },
        startMinutes: minute, professionalEndMinutes: parseMinutes(p.endTime)!, businessEndMinutes: parseMinutes(b.endTime)!
      }))) ? ['DURATION_DOES_NOT_FIT'] : []
    if (!reasons.length) reasons = instant.getTime() < input.dbNow.getTime() + input.settings.leadTimeHours * 3600000 ? ['LEAD_TIME']
      : input.blocks.some(row => (row.professionalId === null || row.professionalId === pro.id) && row.startAt < (row.professionalId === null ? customerFinish : finish) && row.endAt > instant) ? ['BLOCKED']
      : input.busy.some(row => row.professionalId === pro.id && row.startAt < finish && row.startAt.getTime() + row.duration * 60000 > instant.getTime()) ? ['BUSY'] : []
    return { professionalId: pro.id, available: !reasons.length, reasons }
  })
  return { version: 1, businessId: input.businessId, serviceIds: [...new Set(input.serviceIds)].sort(), date, time,
    durationMinutes: input.durationMinutes, customerDurationMinutes: input.customerDurationMinutes,
    checkedAt: input.dbNow.toISOString(), timezone: input.settings.timezone, professionals }
}
/** This parser validates a fresh port result; it does not turn cached/provider data into authority. */
export function parseRequestedStartExplanation(value: unknown, scope: RequestedStartScope): RequestedStartExplanation {
  const fail = (): never => { throw Error('invalid requested start explanation') }
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) &&
    Object.values(Object.getOwnPropertyDescriptors(v)).every(p => Object.hasOwn(p, 'value'))
  const array = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max &&
    Object.keys(v).length === v.length && Object.keys(v).every((key, index) => key === String(index)) &&
    Object.values(Object.getOwnPropertyDescriptors(v)).every(p => Object.hasOwn(p, 'value'))
  const keys = (v: Record<string, unknown>, expected: string) => Object.keys(v).sort().join(',') === expected
  if (!record(value) || !keys(value, 'businessId,checkedAt,customerDurationMinutes,date,durationMinutes,professionals,serviceIds,time,timezone,version') ||
    value.version !== 1 || !bounded(scope.businessId, 128) || value.businessId !== scope.businessId ||
    value.date !== scope.date || value.time !== scope.time || value.timezone !== scope.timezone ||
    !duration(scope.durationMinutes) || !duration(scope.customerDurationMinutes) || scope.customerDurationMinutes < scope.durationMinutes ||
    value.durationMinutes !== scope.durationMinutes || value.customerDurationMinutes !== scope.customerDurationMinutes ||
    !validDate(scope.dbNow) || value.checkedAt !== scope.dbNow.toISOString() ||
    !array(value.serviceIds, 50) || !scope.serviceIds.length || scope.serviceIds.some(id => !bounded(id, 128)) ||
    JSON.stringify(value.serviceIds) !== JSON.stringify([...new Set(scope.serviceIds)].sort()) ||
    !array(value.professionals, 50) || !scope.professionals.length || scope.professionals.length > 50 ||
    value.professionals.length !== scope.professionals.length ||
    new Set(scope.professionals.map(p => p.id)).size !== scope.professionals.length) return fail()
  try { if (!targetInstant(scope.date, scope.time, scope.timezone)) return fail() } catch { return fail() }
  const seen = new Set<string>()
  const allowed: readonly AvailabilityCause[] = ['BUSINESS_CLOSED', 'PROFESSIONAL_NOT_WORKING', 'DURATION_DOES_NOT_FIT',
    'LEAD_TIME', 'BLOCKED', 'BUSY', 'REQUESTED_START_OUTSIDE_BUSINESS_HOURS', 'REQUESTED_START_OUTSIDE_PROFESSIONAL_HOURS']
  const rows = value.professionals.map(row => {
    if (!record(row) || !keys(row, 'available,professionalId,reasons') || !bounded(row.professionalId, 128) ||
      !scope.professionals.some(p => p.id === row.professionalId) || seen.has(row.professionalId) ||
      typeof row.available !== 'boolean' || !array(row.reasons, 1) || row.reasons.length !== (row.available ? 0 : 1) ||
      row.reasons.some(reason => !(AVAILABILITY_CAUSES as readonly unknown[]).includes(reason) || !(allowed as readonly unknown[]).includes(reason))) return fail()
    seen.add(row.professionalId)
    return { professionalId: row.professionalId, available: row.available, reasons: [...row.reasons] as AvailabilityCause[] }
  })
  const selected = scope.professionalId ? rows.filter(row => row.professionalId === scope.professionalId) : rows
  if (!selected.length) return fail()
  const available = selected.some(row => row.available)
  // A shared claim must hold for every eligible professional, not just one of them.
  const common = selected[0]!.reasons.filter(reason => selected.every(row => row.reasons.includes(reason)))
  return { date: scope.date, time: scope.time, available, reasons: available ? [] : common.length ? common : ['NO_SLOTS'] }
}
