import { formatDeliveryDate, standardDateTimeQuestion, standardProfessionalChoices, standardSlotOffer, standardManySlots } from './standard-delivery.js'
import { BOOKING_DATE_PAGE_SIZE, BOOKING_SLOT_PAGE_SIZE, formatDateChoice, formatSlotOffset, localDateKey, parseMinutes, type AvailabilitySlot } from '../bot-options/application/availability-queries.js'
import { filterTimePreference, parseTimePreference, type TimePreference } from './time-preference.js'
import { resolveDialogueDate } from './dialogue-date.js'

/** Reuses the existing domain's eight-slot adaptive boundary and seven-row pages. */
export const ADAPTIVE_SLOT_THRESHOLD = 8
export type PresentationScope = { businessId: string; serviceIds: readonly string[]; date: string | null; professionalId: string | null }
/** Internal fresh-port result, not a client authorization token or a persisted availability cache. */
export type AvailabilityRead = { fresh: boolean; scope: PresentationScope; slots: readonly AvailabilitySlot[] }
export type AvailabilityPresentationInput = {
  scope: PresentationScope; read: AvailabilityRead; timezone: string; now: Date
  preference?: TimePreference; requestedTime?: string | null; cursor?: number
}
export type PresentationChoice =
  | { kind: 'slot'; label: string; slot: AvailabilitySlot }
  | { kind: 'preference'; label: string; preference: TimePreference }
  | { kind: 'date'; label: string; date: string }
  | { kind: 'professional'; label: string; professionalId: string }
  | { kind: 'any_professional'; label: string }
export type ChoicePresentation = { kind: 'slots' | 'preference' | 'unavailable' | 'dates' | 'professionals'; text: string; choices: PresentationChoice[]; hasMore: boolean }
const bounded = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f]/.test(value)
function validateScope(scope: PresentationScope): void {
  if (!bounded(scope.businessId, 128) || scope.serviceIds.length < 1 || scope.serviceIds.length > 10 || scope.serviceIds.some(id => !bounded(id, 128)) || new Set(scope.serviceIds).size !== scope.serviceIds.length ||
    scope.professionalId !== null && !bounded(scope.professionalId, 128) || scope.date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(scope.date) || resolveDialogueDate(scope.date, null).kind !== 'resolved')) throw new Error('invalid presentation scope')
}
function freshSlots(input: AvailabilityPresentationInput): AvailabilitySlot[] {
  validateScope(input.scope); validateScope(input.read.scope)
  if (input.read.fresh !== true) throw new Error('presentation requires fresh availability')
  const requested = input.scope, loaded = input.read.scope
  if (requested.businessId !== loaded.businessId || requested.date !== loaded.date || requested.professionalId !== loaded.professionalId ||
    [...requested.serviceIds].sort().join('\0') !== [...loaded.serviceIds].sort().join('\0')) throw new Error('invalid presentation scope')
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime()) || input.read.slots.length > 10000) throw new Error('invalid presentation clock or slots')
  // Intl validates the tenant IANA zone even for empty results.
  localDateKey(input.now, input.timezone)
  const unique = new Map<string, AvailabilitySlot>()
  for (const slot of input.read.slots) {
    const instant = new Date(slot.startAt)
    if (!Number.isFinite(instant.getTime()) || instant <= input.now || parseMinutes(slot.time) === null || !bounded(slot.professionalId, 128) || !bounded(slot.professionalName, 200) ||
      !['MORNING', 'AFTERNOON', 'EVENING'].includes(slot.band) || !Number.isSafeInteger(slot.occupiedMinutes) || slot.occupiedMinutes < 0 ||
      requested.date !== null && slot.date !== requested.date || requested.professionalId !== null && slot.professionalId !== requested.professionalId ||
      localDateKey(instant, input.timezone) !== slot.date || new Intl.DateTimeFormat('en-GB', { timeZone: input.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant) !== slot.time) throw new Error('invalid presentation slot')
    const key = `${instant.toISOString()}\0${slot.professionalId}`
    const prior = unique.get(key)
    if (prior && JSON.stringify(prior) !== JSON.stringify(slot)) throw new Error('conflicting presentation slot')
    unique.set(key, structuredClone(slot))
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.professionalId.localeCompare(b.professionalId))
}
function cursorStart(cursor: number | undefined, pageSize: number): number {
  if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > 10000)) throw new Error('invalid presentation cursor')
  return (cursor ?? 0) * pageSize
}
function slotChoices(slots: readonly AvailabilitySlot[], all: readonly AvailabilitySlot[], timezone: string): PresentationChoice[] {
  return slots.map(slot => {
    const fold = all.some(other => other.date === slot.date && other.time === slot.time && other.startAt !== slot.startAt)
    return { kind: 'slot', slot, label: `${formatDateChoice(slot.date, timezone)} a las ${slot.time}${fold ? ` (${formatSlotOffset(slot.startAt, timezone)})` : ''} con ${slot.professionalName}` }
  })
}
/** Offers are never choices already applied: even one exact/preference match remains an explicit option. */
export function presentAvailability(input: AvailabilityPresentationInput): ChoicePresentation {
  const all = freshSlots(input)
  if (input.preference) parseTimePreference(input.preference)
  cursorStart(input.cursor, BOOKING_SLOT_PAGE_SIZE)
  if (input.preference && input.requestedTime) throw new Error('conflicting temporal presentation')
  if (input.requestedTime && parseMinutes(input.requestedTime) === null) throw new Error('invalid exact time')
  let filtered = input.preference?.kind === 'earliest' ? all : input.preference ? filterTimePreference(all, input.preference) : all
  let nearest = false
  if (input.requestedTime) {
    const exact = all.filter(slot => slot.time === input.requestedTime)
    nearest = exact.length === 0
    filtered = exact.length ? exact : [...all].sort((a, b) => Math.abs(parseMinutes(a.time)! - parseMinutes(input.requestedTime!)!) - Math.abs(parseMinutes(b.time)! - parseMinutes(input.requestedTime!)!) || Date.parse(a.startAt) - Date.parse(b.startAt)).slice(0, 3)
  }
  if (!filtered.length) return { kind: 'unavailable', text: 'No encontré horarios disponibles para esa búsqueda. ¿Querés probar otra fecha o preferencia?', choices: [], hasMore: false }
  if (!input.preference && !input.requestedTime && filtered.length > ADAPTIVE_SLOT_THRESHOLD) {
    const choices: PresentationChoice[] = [
      { kind: 'preference', label: 'Por la mañana', preference: { kind: 'band', band: 'MORNING' } },
      { kind: 'preference', label: 'Por la tarde', preference: { kind: 'band', band: 'AFTERNOON' } },
      { kind: 'preference', label: 'Por la noche', preference: { kind: 'band', band: 'EVENING' } }
    ].filter(choice => choice.kind === 'preference' && choice.preference.kind === 'band' && filtered.some(slot => slot.band === choice.preference.band)) as PresentationChoice[]
    choices.push({ kind: 'preference', label: 'Cualquier horario', preference: { kind: 'any' } })
    return { kind: 'preference', text: standardManySlots(formatDeliveryDate(input.scope.date!), choices.map(choice => choice.label)), choices, hasMore: false }
  }
  const short = input.preference?.kind === 'any' || input.preference?.kind === 'earliest' || nearest
  const pageSize = short ? 3 : BOOKING_SLOT_PAGE_SIZE
  const start = cursorStart(input.cursor, pageSize)
  if (start >= filtered.length) throw new Error('invalid presentation cursor')
  const choices = slotChoices(filtered.slice(start, start + pageSize), all, input.timezone)
  const band = new Set(filtered.map(slot => slot.band))
  const concentration = band.size === 1 ? filtered[0]!.band === 'MORNING' ? 'por la mañana' : filtered[0]!.band === 'AFTERNOON' ? 'por la tarde' : 'por la noche' : null
  const professional = new Set(filtered.map(slot => slot.professionalId)).size === 1 ? filtered[0]!.professionalName : null
  const preference = input.preference?.kind === 'after' ? 'Después de las ' + input.preference.time
    : input.preference?.kind === 'before' ? 'Antes de las ' + input.preference.time
      : input.preference?.kind === 'band' ? concentration : null
  return { kind: 'slots', text: standardSlotOffer({ date: formatDeliveryDate(input.scope.date ?? filtered[0]!.date), professional, band: concentration,
    labels: choices.map(choice => choice.label), nearest: nearest ? input.requestedTime ?? null : null, preference }), choices, hasMore: start + choices.length < filtered.length }
}
export function presentProfessionals(professionals: readonly { id: string; name: string }[], cursor = 0): ChoicePresentation {
  if (professionals.some(pro => !bounded(pro.id, 128) || !bounded(pro.name, 200)) || new Set(professionals.map(pro => pro.id)).size !== professionals.length) throw new Error('invalid presentation professional')
  const start = cursorStart(cursor, BOOKING_SLOT_PAGE_SIZE - 1)
  if (!professionals.length) return { kind: 'unavailable', text: 'No encontré profesionales disponibles para esos servicios.', choices: [], hasMore: false }
  const choices: PresentationChoice[] = [{ kind: 'any_professional', label: 'Cualquier profesional' }, ...professionals.slice(start, start + BOOKING_SLOT_PAGE_SIZE - 1).map(pro => ({ kind: 'professional' as const, professionalId: pro.id, label: pro.name }))]
  return { kind: 'professionals', text: standardProfessionalChoices(choices.map(choice => choice.label)), choices, hasMore: start + choices.length - 1 < professionals.length }
}
export function presentDateTimeQuestion(input: { date: string | null; hasTemporalRequest: boolean; serviceName?: string }, timezone?: string): string | null {
  return standardDateTimeQuestion(input.date, input.hasTemporalRequest, input.date ? formatDeliveryDate(input.date) : undefined, input.serviceName)
}
/** Date shortcuts and the typed example come only from freshly checked actual slots. */
export function presentVerifiedDates(input: AvailabilityPresentationInput): ChoicePresentation & { example: string | null } {
  const slots = freshSlots(input)
  const start = cursorStart(input.cursor, Math.min(3, BOOKING_DATE_PAGE_SIZE))
  const dates = [...new Set(slots.map(slot => slot.date))]
  const today = localDateKey(input.now, input.timezone)
  const tomorrow = new Date(today + 'T12:00:00Z'); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const tomorrowKey = tomorrow.toISOString().slice(0, 10)
  const choices: PresentationChoice[] = dates.slice(start, start + 3).map(date => ({ kind: 'date', date,
    label: (date === today ? 'Hoy · ' : date === tomorrowKey ? 'Mañana · ' : '') + formatDateChoice(date, input.timezone) }))
  const first = slots.find(slot => slot.date === choices.find(choice => choice.kind === 'date')?.date)
  const example = first ? `${first.date} a las ${first.time}` : null
  const displayExample = first ? (first.date === today ? 'Hoy' : first.date === tomorrowKey ? 'Mañana' : formatDeliveryDate(first.date)) + ' a las ' + first.time : null
  return { kind: 'dates', text: `${choices.length ? `Hay disponibilidad:\n${choices.map(choice => '• ' + choice.label).join('\n')}` : 'No encontré fechas disponibles.'}${displayExample ? `\n\nPodés escribir, por ejemplo: ${displayExample}.` : ''}\n¿Qué día y horario te vendrían bien?`, choices, hasMore: start + choices.length < dates.length, example }
}
