import { calcularOffsetUtcMs, decomposeDateInTimezone, isValidTimezone, sumarDiasCalendario } from './hours-queries.js'
import type { SlotBand } from '../domain/actions.js'

export const BOOKING_DATE_PAGE_SIZE = 8
export const BOOKING_SLOT_PAGE_SIZE = 7
export const BOOKING_GRID_MINUTES = 30

export type AvailabilitySettings = {
  timezone: string
  horizonDays: number
  leadTimeHours: number
  morningCutTime: string
  eveningCutTime: string
}

export type AvailabilityProfessional = { id: string; name: string; priority: number }
export type AvailabilitySlot = {
  startAt: string
  date: string
  time: string
  band: SlotBand
  professionalId: string
  professionalName: string
  occupiedMinutes: number
}

export function parseMinutes(value: string): number | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null
  const [hours, minutes] = value.split(':').map(Number)
  return hours! * 60 + minutes!
}

export function validateAvailabilitySettings(settings: AvailabilitySettings): AvailabilitySettings {
  if (!isValidTimezone(settings.timezone)) throw new Error('bot availability timezone is missing or invalid')
  if (!Number.isInteger(settings.horizonDays) || settings.horizonDays < 1 || settings.horizonDays > 90) throw new Error('bot availability horizon must be 1..90 days')
  if (!Number.isInteger(settings.leadTimeHours) || settings.leadTimeHours < 0 || settings.leadTimeHours >= settings.horizonDays * 24) throw new Error('bot availability lead time is incompatible with horizon')
  const morning = parseMinutes(settings.morningCutTime)
  const evening = parseMinutes(settings.eveningCutTime)
  if (morning === null || evening === null || morning >= evening) throw new Error('bot availability cuts are invalid')
  return settings
}

export function bandForMinute(minute: number, settings: AvailabilitySettings): SlotBand {
  const morning = parseMinutes(settings.morningCutTime)!
  const evening = parseMinutes(settings.eveningCutTime)!
  return minute < morning ? 'MORNING' : minute < evening ? 'AFTERNOON' : 'EVENING'
}

export function paginate<T>(items: readonly T[], cursor: number, pageSize: number): { items: T[]; hasPrevious: boolean; hasNext: boolean } {
  const safeCursor = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0
  const start = safeCursor * pageSize
  return { items: items.slice(start, start + pageSize), hasPrevious: safeCursor > 0, hasNext: start + pageSize < items.length }
}

export function chooseBalancedProfessional(candidates: readonly {
  professional: AvailabilityProfessional
  occupiedMinutes: number
}[]): { professional: AvailabilityProfessional; occupiedMinutes: number } | null {
  return [...candidates].sort((left, right) =>
    left.occupiedMinutes - right.occupiedMinutes ||
    left.professional.priority - right.professional.priority ||
    left.professional.id.localeCompare(right.professional.id)
  )[0] ?? null
}

export function localDateKey(dbNow: Date, timezone: string, dayOffset = 0): string {
  const local = decomposeDateInTimezone(dbNow, timezone)
  const target = sumarDiasCalendario(local.year, local.month, local.day, dayOffset)
  return `${target.year.toString().padStart(4, '0')}-${target.month.toString().padStart(2, '0')}-${target.day.toString().padStart(2, '0')}`
}

export function weekdayInTimezone(instant: Date, timezone: string): number {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(instant)
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short)
  if (weekday < 0) throw new Error('cannot resolve weekday in tenant timezone')
  return weekday
}

/** Convierte wall time a todos los instantes válidos; 0 en un gap DST y 2 en un fold. */
export function localDateTimeToInstants(date: string, minute: number, timezone: string): Date[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match || minute < 0 || minute >= 1440) return []
  const y = Number(match[1]); const m = Number(match[2]); const d = Number(match[3])
  const hour = Math.floor(minute / 60); const min = minute % 60
  const wallUtc = Date.UTC(y, m - 1, d, hour, min)
  const offsets = new Set<number>()
  for (const deltaHours of [-36, -12, 0, 12, 36]) offsets.add(calcularOffsetUtcMs(new Date(wallUtc + deltaHours * 3_600_000), timezone))
  return [...offsets].map((offset) => new Date(wallUtc - offset)).filter((instant) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'
    }).formatToParts(instant)
    const part = (type: string) => parts.find((item) => item.type === type)?.value
    return part('year') === match[1] && part('month') === match[2] && part('day') === match[3] && Number(part('hour')) % 24 === hour && Number(part('minute')) === min
  }).sort((a, b) => a.getTime() - b.getTime())
}

export function formatDateChoice(date: string, timezone: string): string {
  const instant = localDateTimeToInstants(date, 12 * 60, timezone)[0]
  return instant ? new Intl.DateTimeFormat('es-AR', { timeZone: timezone, weekday: 'short', day: '2-digit', month: '2-digit' }).format(instant) : date
}

export function formatSlotOffset(startAt: string, timezone: string): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(startAt)).find((item) => item.type === 'timeZoneName')?.value
  return part?.replace('GMT', 'UTC') ?? 'UTC'
}
