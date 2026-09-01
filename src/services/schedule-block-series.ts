export const MAX_SCHEDULE_BLOCK_SERIES_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

export type ScheduleBlockSeriesOccurrenceInput = {
  startAt: string
  endAt: string
}

export type ValidatedScheduleBlockSeriesOccurrence = {
  startAt: Date
  endAt: Date
}

export function validateScheduleBlockSeriesOccurrences(
  occurrences: ScheduleBlockSeriesOccurrenceInput[]
): ValidatedScheduleBlockSeriesOccurrence[] {
  if (!Array.isArray(occurrences) || occurrences.length === 0) {
    throw new Error('La serie debe contener al menos un bloqueo')
  }
  if (occurrences.length > MAX_SCHEDULE_BLOCK_SERIES_DAYS) {
    throw new Error(`Una serie puede contener como maximo ${MAX_SCHEDULE_BLOCK_SERIES_DAYS} bloqueos`)
  }

  const parsed = occurrences.map((occurrence) => {
    const startAt = new Date(occurrence?.startAt)
    const endAt = new Date(occurrence?.endAt)
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new Error('La serie contiene una fecha invalida')
    }
    if (startAt >= endAt) {
      throw new Error('Cada bloqueo debe finalizar despues de comenzar')
    }
    return { startAt, endAt }
  }).sort((left, right) => left.startAt.getTime() - right.startAt.getTime())

  const firstOccurrence = parsed[0]
  if (!firstOccurrence) throw new Error('La serie debe contener al menos un bloqueo')
  const expectedDuration = firstOccurrence.endAt.getTime() - firstOccurrence.startAt.getTime()
  if (parsed.some((occurrence) => occurrence.endAt.getTime() - occurrence.startAt.getTime() !== expectedDuration)) {
    throw new Error('Todos los bloqueos de la serie deben tener la misma duracion')
  }

  const lastOccurrence = parsed[parsed.length - 1]
  if (!lastOccurrence) throw new Error('La serie debe contener al menos un bloqueo')
  const firstStart = firstOccurrence.startAt.getTime()
  const lastStart = lastOccurrence.startAt.getTime()
  if (lastStart - firstStart >= MAX_SCHEDULE_BLOCK_SERIES_DAYS * DAY_MS) {
    throw new Error(`El periodo de una serie no puede superar ${MAX_SCHEDULE_BLOCK_SERIES_DAYS} dias`)
  }

  const uniqueStarts = new Set(parsed.map((occurrence) => occurrence.startAt.toISOString()))
  if (uniqueStarts.size !== parsed.length) {
    throw new Error('La serie no puede contener bloqueos duplicados')
  }

  return parsed
}
