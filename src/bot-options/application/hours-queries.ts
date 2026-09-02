/**
 * F5.6 — Read model puro para horario semanal informativo del negocio.
 *
 * Consulta horarios regulares (BusinessHours) y excepciones operativas
 * (ScheduleBlock con professionalId = NULL) de los próximos 30 días.
 * NO crea draft, NO revela agenda, NO consulta slots ni profesionales.
 *
 * Este módulo es puro: no importa Prisma, Fastify, Meta ni relojes.
 */

// ─── Tipos del read model ────────────────────────────────────────────────────

/** Fila cruda de horario semanal del negocio (BusinessHours). */
export type BusinessWeeklyHourRow = {
  dayOfWeek: number
  startTime: string
  endTime: string
}

/** Excepción operativa a nivel negocio (ScheduleBlock sin profesional). */
export type BusinessOperationalException = {
  startAt: Date
  endAt: Date
  reason: string
  title: string | null
  note: string | null
}

// ─── F5.7: Professional hours read model ─────────────────────────────────────

/** Fila del catálogo activo de profesionales para el listado informativo. */
export type ProfessionalCatalogRow = {
  professionalId: string
  name: string
  acceptsBotBookings: boolean
}

/** Fila cruda de horario semanal de un profesional (ProfessionalHours). */
export type ProfessionalWeeklyHourRow = {
  dayOfWeek: number
  startTime: string
  endTime: string
}

/** Excepción operativa de un profesional (ScheduleBlock con professionalId).
 *  Sólo startAt/endAt — el copy es siempre genérico "No atiende". */
export type ProfessionalOperationalException = {
  startAt: Date
  endAt: Date
}

// ─── Constantes ──────────────────────────────────────────────────────────────

/** Nombres de día en español (índice = dayOfWeek JS: 0=domingo). */
export const DAY_NAMES: readonly string[] = [
  'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'
]

/** Reason labels para ScheduleBlockReason. */
const BLOCK_REASON_LABELS: Record<string, string> = {
  ABSENCE: 'Ausencia',
  VACATION: 'Vacaciones',
  LATE_ARRIVAL: 'Llegada tarde',
  SICK_LEAVE: 'Licencia médica',
  PERSONAL: 'Asunto personal',
  TRAINING: 'Capacitación',
  MAINTENANCE: 'Mantenimiento',
  HOLIDAY: 'Feriado',
  OTHER: 'Otro'
}

const PUBLIC_HOURS_DISCLAIMER = 'Los horarios pueden variar en fechas especiales. Para conocer la disponibilidad exacta, podés buscar un turno.'

// ─── Validación de inputs ─────────────────────────────────────────────────────

/** Regex estricto para HH:mm (00-23:00-59). */
const HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Valida una fila de BusinessWeeklyHourRow.
 * - dayOfWeek: entero 0..6 (0=domingo)
 * - startTime/endTime: formato HH:mm estricto
 * - startTime < endTime
 * Retorna { ok: true, row } o { ok: false, error }.
 */
export function validateBusinessWeeklyRow(row: BusinessWeeklyHourRow): {
  ok: true; row: BusinessWeeklyHourRow
} | { ok: false; error: string } {
  if (!Number.isInteger(row.dayOfWeek) || row.dayOfWeek < 0 || row.dayOfWeek > 6) {
    return { ok: false, error: `dayOfWeek must be integer 0..6, got ${row.dayOfWeek}` }
  }
  if (!HH_MM_RE.test(row.startTime)) {
    return { ok: false, error: `startTime must be HH:mm, got "${row.startTime}"` }
  }
  if (!HH_MM_RE.test(row.endTime)) {
    return { ok: false, error: `endTime must be HH:mm, got "${row.endTime}"` }
  }
  if (row.startTime >= row.endTime) {
    return { ok: false, error: `startTime "${row.startTime}" must be < endTime "${row.endTime}"` }
  }
  return { ok: true, row }
}

/**
 * Valida una excepción operativa.
 * - startAt/endAt: Date válido y finito
 * - endAt > startAt
 * - startAt.getTime() > 0 (no epoch 0)
 * Retorna { ok: true } o { ok: false, error }.
 */
export function validateOperationalException(exc: BusinessOperationalException): {
  ok: true
} | { ok: false; error: string } {
  if (!(exc.startAt instanceof Date) || !Number.isFinite(exc.startAt.getTime())) {
    return { ok: false, error: 'startAt must be a valid Date' }
  }
  if (!(exc.endAt instanceof Date) || !Number.isFinite(exc.endAt.getTime())) {
    return { ok: false, error: 'endAt must be a valid Date' }
  }
  if (exc.startAt.getTime() <= 0) {
    return { ok: false, error: 'startAt must be after epoch' }
  }
  if (exc.endAt.getTime() <= exc.startAt.getTime()) {
    return { ok: false, error: `endAt must be > startAt` }
  }
  return { ok: true }
}

// ─── Funciones puras de formato ───────────────────────────────────────────────

/**
 * Formatea un rango horario: "09:00 a 18:00".
 * Precondición: startTime y endTime están en formato HH:mm y startTime < endTime.
 */
export function formatTimeRange(startTime: string, endTime: string): string {
  return `${startTime} a ${endTime}`
}

/**
 * Formatea el horario de un día: "09:00 a 12:00, 14:00 a 18:00" o "Cerrado".
 * Intervalos se ordenan por startTime de forma determinista.
 */
export function formatDayHours(hours: readonly BusinessWeeklyHourRow[]): string {
  if (hours.length === 0) return 'Cerrado'
  return hours
    .slice()
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((h) => formatTimeRange(h.startTime, h.endTime))
    .join(', ')
}

/**
 * Ordena días en semanal Lunes→Domingo (dayOfWeek 1..6,0).
 * Dentro de cada día, ordena por startTime.
 */
export function sortWeeklyHours(hours: readonly BusinessWeeklyHourRow[]): BusinessWeeklyHourRow[] {
  return [...hours].sort((a, b) => {
    const dayA = a.dayOfWeek === 0 ? 7 : a.dayOfWeek
    const dayB = b.dayOfWeek === 0 ? 7 : b.dayOfWeek
    return dayA - dayB || a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime)
  })
}

/**
 * Agrupa horarios por día de la semana, ordenados Lunes→Domingo.
 * Retorna un Map<dayOfWeek, BusinessWeeklyHourRow[]>.
 */
export function groupHoursByDay(hours: readonly BusinessWeeklyHourRow[]): Map<number, BusinessWeeklyHourRow[]> {
  const map = new Map<number, BusinessWeeklyHourRow[]>()
  const sorted = sortWeeklyHours(hours)
  for (const row of sorted) {
    const existing = map.get(row.dayOfWeek)
    if (existing) {
      existing.push(row)
    } else {
      map.set(row.dayOfWeek, [row])
    }
  }
  return map
}

/**
 * Formatea el label de una excepción operativa para el usuario.
 * "Feriado: 25 de Diciembre" o "Mantenimiento: el martes 26 desde las 10:00 hasta las 16:00"
 *
 * Regla de exclusión de `note`:
 * - `note` contiene información operativa interna (ej: "Reparación de equipamiento"),
 *   que el cliente no debería ver. Sólo se expone `title` (nombre público del evento)
 *   y `reason` (categoría legible del bloqueo).
 * - `title` es la etiqueta pública del evento (ej: "Día del Logger").
 * - `reason` es la categoría (Vacaciones, Feriado, etc.).
 */
export function formatExceptionLabel(exception: BusinessOperationalException, timezone: string): string {
  const reasonLabel = BLOCK_REASON_LABELS[exception.reason] ?? exception.reason
  const titlePart = exception.title ? `: ${exception.title}` : ''

  const startDate = formatDateInTimezone(exception.startAt, timezone)
  const endDate = formatDateInTimezone(exception.endAt, timezone)
  const startTime = formatTimeInTimezoneString(exception.startAt, timezone)
  const endTime = formatTimeInTimezoneString(exception.endAt, timezone)

  if (startDate === endDate) {
    return `${reasonLabel}${titlePart}: el ${startDate} de ${startTime} a ${endTime}`
  }
  return `${reasonLabel}${titlePart}: del ${startDate} ${startTime} al ${endDate} ${endTime}`
}

/**
 * Obtiene el label legible de un reason de ScheduleBlock.
 */
export function blockReasonLabel(reason: string): string {
  return BLOCK_REASON_LABELS[reason] ?? reason
}

/**
 * Formatea el label de una excepción de un profesional para el PÚBLICO.
 * Reglas 179–184: NO expone motivos internos (reason/title/note).
 * Sólo muestra copy operativo genérico + fecha/hora.
 *
 * "No atiende: el martes 26 de Agosto de 10:00 a 16:00"
 */
export function formatProfessionalExceptionLabel(exception: ProfessionalOperationalException, timezone: string): string {
  const startDate = formatDateInTimezone(exception.startAt, timezone)
  const endDate = formatDateInTimezone(exception.endAt, timezone)
  const startTime = formatTimeInTimezoneString(exception.startAt, timezone)
  const endTime = formatTimeInTimezoneString(exception.endAt, timezone)

  if (startDate === endDate) {
    return `No atiende: el ${startDate} de ${startTime} a ${endTime}`
  }
  return `No atiende: del ${startDate} ${startTime} al ${endDate} ${endTime}`
}

// ─── Funciones de fecha/timezone ──────────────────────────────────────────────

/**
 * Formatea una fecha como "lunes 25 de Agosto" en la timezone dada.
 * Usando Intl para interpretar la fecha en la timezone real del negocio.
 */
export function formatDateInTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: timezone
  })
  return formatter.format(date)
}

/**
 * Formatea la hora como "09:00" en la timezone dada.
 */
export function formatTimeInTimezone(date: Date, timezone: string): {
  hours: string
  minutes: string
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone
  }).formatToParts(date)
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return { hours: hour, minutes: minute }
}

/**
 * Formatea la hora como "09:00" en la timezone dada.
 */
export function formatTimeInTimezoneString(date: Date, timezone: string): string {
  const { hours, minutes } = formatTimeInTimezone(date, timezone)
  return `${hours}:${minutes}`
}

// ─── Ventana de excepciones ───────────────────────────────────────────────────

/** Horizonte de excepciones: 30 días. */
export const EXCEPTION_WINDOW_DAYS = 30

// ─── Timezone helpers (puros, testables, sin Prisma) ──────────────────────────

/**
 * Extrae year/month/day de un Date en la timezone dada usando Intl.
 * Precisión: segundos (formatToParts resuelve contra el reloj local del runtime).
 */
export function decomposeDateInTimezone(date: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone
  }).formatToParts(date)
  const y = parseInt(parts.find((p) => p.type === 'year')?.value ?? '0', 10)
  const m = parseInt(parts.find((p) => p.type === 'month')?.value ?? '1', 10)
  const d = parseInt(parts.find((p) => p.type === 'day')?.value ?? '1', 10)
  return { year: y, month: m, day: d }
}

/**
 * Calcula el offset UTC en milisegundos de una timezone para un Date dado.
 *
 * Algoritmo: construye el "wall time" completo (year/month/day/hour/min/sec)
 * en la timezone y lo compara con el UTC del mismo instante.
 * Itera hasta convergencia para manejar cruces de fecha y DST.
 *
 * Rango soportado: UTC-12:00 a UTC+14:00 (incluye Kiritimati +14,
 * Chatham +12:45, Katmandú +5:45, Lord Howe +10:30/+11).
 *
 * Normaliza hour=24 de Intl usando hourCycle h23 con fallback.
 */
export function calcularOffsetUtcMs(date: Date, timezone: string): number {
  // Paso 1: obtener wall time completo en la timezone
  const wall = getWallTime(date, timezone)
  // Paso 2: construir ese mismo wall time como UTC
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, 0)
  // Paso 3: diferencia inicial
  let offsetMs = asUtc - date.getTime()

  // Paso 4: iterar hasta convergencia (máx 3 iteraciones)
  // Necesario porque el wall time puede cruzar fecha al ajustar offset
  for (let i = 0; i < 3; i++) {
    const adjusted = new Date(date.getTime() + offsetMs)
    const wall2 = getWallTime(adjusted, timezone)
    const asUtc2 = Date.UTC(wall2.year, wall2.month - 1, wall2.day, wall2.hour, wall2.minute, wall2.second, 0)
    const newOffset = asUtc2 - adjusted.getTime()
    if (newOffset === offsetMs) return offsetMs
    offsetMs = newOffset
  }
  return offsetMs
}

/**
 * Extrae year/month/day/hour/minute/second de un Date en la timezone dada.
 * Usa hourCycle: 'h23' para obtener 0-23 en vez de 1-12 o el outlier 24.
 */
function getWallTime(date: Date, timezone: string): {
  year: number; month: number; day: number; hour: number; minute: number; second: number
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    timeZone: timezone
  }).formatToParts(date)
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second')
  }
}

/**
 * Suma N días calendario a una fecha descompuesta en year/month/day.
 * Meses con 28/30/31 días se manejan correctamente vía Date UTC.
 */
export function sumarDiasCalendario(
  year: number, month: number, day: number, dias: number
): { year: number; month: number; day: number } {
  const base = new Date(Date.UTC(year, month - 1, day + dias, 0, 0, 0, 0))
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate() }
}

/**
 * Valida que un string sea timezone IANA válida usando Intl.
 * Acepta UTC (case-insensitive) y cualquier zona que Intl reconozca.
 * Rechaza "", strings sin estructura, y zonas inventadas como "Foo/Bar".
 */
export function isValidTimezone(tz: string): boolean {
  if (typeof tz !== 'string') return false
  const trimmed = tz.trim()
  if (trimmed.length === 0) return false
  if (trimmed.toUpperCase() === 'UTC') return true
  try {
    // Si Intl no reconoce la timezone, formatToParts lanza RangeError
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).formatToParts(new Date())
    return true
  } catch {
    return false
  }
}

/**
 * Calcula la ventana [from, to) para excepciones operativas.
 *
 * Contrato:
 * - from = medianoche local en la timezone del negocio del día de dbNow.
 * - to  = medianoche local 30 días calendario después (no 720h).
 * - Robusto con DST, offsets fraccionarios (UTC+5:30), y timezones exóticas.
 *
 * Implementación:
 * 1. Descompone dbNow en la timezone → año/mes/día local.
 * 2. Calcula midnight UTC de ese día restando el offset UTC del instante.
 * 3. Para "to", suma 30 días calendario ANTES de calcular el UTC
 *    (porque el offset de la fecha destino puede ser distinto por DST).
 */
export function computeExceptionWindow(
  dbNow: Date,
  timezone: string
): { from: Date; to: Date } {
  if (!isValidTimezone(timezone)) {
    throw new Error(`Invalid IANA timezone: "${timezone}"`)
  }

  // Paso 1: descomponer dbNow en la timezone local
  const localDate = decomposeDateInTimezone(dbNow, timezone)

  // Paso 2: calcular midnight UTC de ese día local
  // Creamos un Date en midnight UTC del día local y medimos su offset en esa timezone
  const midnightUtcGuess = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day, 0, 0, 0, 0))
  const offsetMs = calcularOffsetUtcMs(midnightUtcGuess, timezone)
  const from = new Date(midnightUtcGuess.getTime() - offsetMs)

  // Paso 3: calcular la fecha "to" sumando 30 días calendario
  const toDate = sumarDiasCalendario(localDate.year, localDate.month, localDate.day, EXCEPTION_WINDOW_DAYS)
  const toMidnightUtcGuess = new Date(Date.UTC(toDate.year, toDate.month - 1, toDate.day, 0, 0, 0, 0))
  const toOffsetMs = calcularOffsetUtcMs(toMidnightUtcGuess, timezone)
  const to = new Date(toMidnightUtcGuess.getTime() - toOffsetMs)

  return { from, to }
}

// ─── Formato completo del horario semanal ─────────────────────────────────────

/**
 * Orquesta el formato completo del horario semanal del negocio.
 *
 * Reglas:
 * - Lunes a Domingo siempre en ese orden.
 * - Días sin intervalos se muestran "Cerrado".
 * - Intervalos múltiples se ordenan por startTime.
 * - Las excepciones operativas son privadas y no se muestran al cliente.
 * - NO crea draft ni revela agenda profesional.
 *
 * @param hours Horarios regulares del negocio (BusinessHours).
 * @param exceptions Excepciones operativas (ScheduleBlock professionalId=null) en la ventana.
 * @param dbNow Timestamp actual de la base de datos (UTC).
 * @param timezone Timezone IANA del negocio (ej: "America/Buenos_Aires").
 * @returns Texto formateado listo para enviar como informativeText.
 */
export function formatBusinessWeeklySchedule(
  hours: readonly BusinessWeeklyHourRow[],
  exceptions: readonly BusinessOperationalException[],
  dbNow: Date,
  timezone: string
): string {
  // Validar inputs — falla cerrado con error explícito para no mostrar horarios ambiguos
  for (const h of hours) {
    const v = validateBusinessWeeklyRow(h)
    if (!v.ok) throw new Error(`Invalid BusinessWeeklyRow: ${v.error}`)
  }
  for (const exc of exceptions) {
    const v = validateOperationalException(exc)
    if (!v.ok) throw new Error(`Invalid OperationalException: ${v.error}`)
  }

  const grouped = groupHoursByDay(hours)
  const lines: string[] = []

  // Orden: Lunes(1)→Martes(2)→Miércoles(3)→Jueves(4)→Viernes(5)→Sábado(6)→Domingo(0)
  const dayOrder = [1, 2, 3, 4, 5, 6, 0]

  for (const dow of dayOrder) {
    const dayName = DAY_NAMES[dow]!
    const dayHours = grouped.get(dow) ?? []
    const schedule = formatDayHours(dayHours)
    lines.push(`*${dayName}*: ${schedule}`)
  }

  lines.push('', PUBLIC_HOURS_DISCLAIMER)

  return lines.join('\n')
}

// ─── F5.7: Professional hours formatting ─────────────────────────────────────

/**
 * Label para el listado de profesionales.
 * Usa separador " — " para que el renderer WhatsApp lo divida en title/description.
 * "Ana García — No reservable por este medio" o "Ana García".
 */
export function formatProfessionalListLabel(professional: ProfessionalCatalogRow): string {
  if (professional.acceptsBotBookings) return professional.name
  return `${professional.name} — No reservable por este medio`
}

/**
 * Orquesta el formato completo del horario semanal de un profesional.
 *
 * Reglas (reglas-funcionales.md §4.1):
 * - Lunes a Domingo siempre en ese orden.
 * - Días sin intervalos se muestran "No atiende".
 * - Intervalos múltiples se ordenan por startTime.
 * - Las excepciones del profesional son privadas y no se muestran al cliente.
 * - NO expone motivos internos, notas ni datos de reservas.
 *
 * @param professionalName Nombre del profesional para el encabezado.
 * @param hours Horarios regulares del profesional (ProfessionalHours).
 * @param exceptions Excepciones del profesional (ScheduleBlock con professionalId).
 * @param dbNow Timestamp actual de la base de datos (UTC).
 * @param timezone Timezone IANA del negocio.
 * @returns Texto formateado listo para enviar como informativeText.
 */
export function formatProfessionalWeeklySchedule(
  professionalName: string,
  hours: readonly ProfessionalWeeklyHourRow[],
  exceptions: readonly ProfessionalOperationalException[],
  dbNow: Date,
  timezone: string
): string {
  // Validar inputs
  for (const h of hours) {
    const row: BusinessWeeklyHourRow = { dayOfWeek: h.dayOfWeek, startTime: h.startTime, endTime: h.endTime }
    const v = validateBusinessWeeklyRow(row)
    if (!v.ok) throw new Error(`Invalid ProfessionalWeeklyRow: ${v.error}`)
  }
  for (const exc of exceptions) {
    if (!(exc.startAt instanceof Date) || !Number.isFinite(exc.startAt.getTime())) {
      throw new Error('Invalid ProfessionalException: startAt must be a valid Date')
    }
    if (!(exc.endAt instanceof Date) || !Number.isFinite(exc.endAt.getTime())) {
      throw new Error('Invalid ProfessionalException: endAt must be a valid Date')
    }
    if (exc.endAt.getTime() <= exc.startAt.getTime()) {
      throw new Error('Invalid ProfessionalException: endAt must be > startAt')
    }
  }

  const grouped = groupHoursByDay(hours as readonly BusinessWeeklyHourRow[])
  const lines: string[] = []

  // Orden: Lunes(1)→Martes(2)→Miércoles(3)→Jueves(4)→Viernes(5)→Sábado(6)→Domingo(0)
  const dayOrder = [1, 2, 3, 4, 5, 6, 0]

  for (const dow of dayOrder) {
    const dayName = DAY_NAMES[dow]!
    const dayHours = grouped.get(dow) ?? []
    const schedule = dayHours.length === 0 ? 'No atiende' : formatDayHours(dayHours)
    lines.push(`*${dayName}*: ${schedule}`)
  }

  lines.push('', PUBLIC_HOURS_DISCLAIMER)

  return lines.join('\n')
}
