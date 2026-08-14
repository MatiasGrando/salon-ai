export type WeeklyHourInput = {
  dayOfWeek: number
  startTime: string
  endTime: string
}

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export function validateWeeklyHours(hours: WeeklyHourInput[]) {
  const invalidHour = hours.find((hour) => {
    return !Number.isInteger(hour.dayOfWeek) ||
      hour.dayOfWeek < 0 ||
      hour.dayOfWeek > 6 ||
      !timePattern.test(hour.startTime) ||
      !timePattern.test(hour.endTime) ||
      hour.startTime >= hour.endTime
  })

  if (invalidHour) {
    return {
      ok: false as const,
      message: 'Hay un horario invalido. Revisa el dia y que la hora de inicio sea anterior a la de cierre.'
    }
  }

  const uniqueKeys = new Set(hours.map((hour) => `${hour.dayOfWeek}:${hour.startTime}-${hour.endTime}`))
  if (uniqueKeys.size !== hours.length) {
    return {
      ok: false as const,
      message: 'Hay un horario repetido.'
    }
  }

  const normalized = normalizeWeeklyHours(hours)
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1]
    const current = normalized[index]
    if (!previous || !current) continue
    if (previous.dayOfWeek === current.dayOfWeek && current.startTime < previous.endTime) {
      return {
        ok: false as const,
        message: `Los horarios de ${dayLabel(current.dayOfWeek)} se superponen.`
      }
    }
  }

  return {
    ok: true as const,
    hours: normalized
  }
}

export function normalizeWeeklyHours(hours: WeeklyHourInput[]) {
  return Array.from(
    new Map(hours.map((hour) => [
      `${hour.dayOfWeek}:${hour.startTime}-${hour.endTime}`,
      {
        dayOfWeek: hour.dayOfWeek,
        startTime: hour.startTime,
        endTime: hour.endTime
      }
    ])).values()
  ).sort((left, right) => {
    return dayOrder(left.dayOfWeek) - dayOrder(right.dayOfWeek) ||
      left.startTime.localeCompare(right.startTime) ||
      left.endTime.localeCompare(right.endTime)
  })
}

function dayOrder(dayOfWeek: number) {
  return dayOfWeek === 0 ? 7 : dayOfWeek
}

function dayLabel(dayOfWeek: number) {
  return ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'][dayOfWeek] || 'ese dia'
}
