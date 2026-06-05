type MatchableOption = {
  name: string
  category?: string | null
  aliases?: Array<{ name: string }>
}

export class MessageUnderstandingService {
  isAnyProfessionalMessage(message: string) {
    const normalizedMessage = normalizeText(message)

    return [
      '0',
      'cualquiera',
      'me da igual',
      'el que tenga antes',
      'quien sea',
      'sin preferencia'
    ].includes(normalizedMessage)
  }

  findOptionByMessage<T extends MatchableOption>(message: string, options: T[]) {
    const selectedOption = Number(message)

    if (Number.isInteger(selectedOption) && selectedOption >= 1) {
      return options[selectedOption - 1] ?? null
    }

    const normalizedMessage = normalizeText(message)

    return options.find((option) => {
      const searchableValues = [
        option.name,
        option.category,
        ...(option.aliases?.map((alias) => alias.name) ?? [])
      ]
        .filter((value): value is string => Boolean(value))
        .map(normalizeText)

      return searchableValues.some((value) => {
        return (
          value === normalizedMessage ||
          value.includes(normalizedMessage) ||
          normalizedMessage.includes(value) ||
          matchesTokenPrefix(normalizedMessage, value) ||
          matchesCloseToken(normalizedMessage, value)
        )
      })
    }) ?? null
  }

  parseDate(message: string) {
    const normalizedMessage = normalizeText(message)
    const today = startOfDay(new Date())

    if (normalizedMessage === '1' || normalizedMessage.includes('hoy')) {
      return formatDate(today)
    }

    if (normalizedMessage === '2' || normalizedMessage.includes('manana')) {
      return formatDate(addDays(today, 1))
    }

    if (normalizedMessage === '3' || normalizedMessage.includes('pasado')) {
      return formatDate(addDays(today, 2))
    }

    const weekdayDate = parseWeekday(normalizedMessage, today)

    if (weekdayDate) {
      return formatDate(weekdayDate)
    }

    const shortDate = parseShortDate(normalizedMessage)

    if (shortDate && shortDate >= today) {
      return formatDate(shortDate)
    }

    const writtenDate = parseWrittenDate(normalizedMessage)

    if (writtenDate && writtenDate >= today) {
      return formatDate(writtenDate)
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(message)) {
      return null
    }

    const parsedDate = new Date(`${message}T00:00:00`)

    if (Number.isNaN(parsedDate.getTime()) || parsedDate < today) {
      return null
    }

    return message
  }

  parseTime(message: string) {
    const normalizedMessage = normalizeText(message)
    const directTime = normalizedMessage.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/)

    if (directTime) {
      let hours = Number(directTime[1])

      if (directTime[3] === 'pm' && hours < 12) {
        hours += 12
      }

      if (directTime[3] === 'am' && hours === 12) {
        hours = 0
      }

      return formatParsedTime(hours, Number(directTime[2]))
    }

    const hourOnly = normalizedMessage.match(/(?:a las\s*)?(\d{1,2})(?:\s*(am|pm|hs|h))?/)

    if (!hourOnly) {
      return null
    }

    let hours = Number(hourOnly[1])

    const marker = hourOnly[2]

    if (marker === 'pm' && hours < 12) {
      hours += 12
    }

    if (marker === 'am' && hours === 12) {
      hours = 0
    }

    if (!marker && normalizedMessage.includes('tarde') && hours < 12) {
      hours += 12
    }

    return formatParsedTime(hours, 0)
  }
}

export function normalizeText(text: string) {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function matchesTokenPrefix(normalizedMessage: string, normalizedValue: string) {
  const messageTokens = normalizedMessage.split(/\s+/).filter(Boolean)
  const valueTokens = normalizedValue.split(/\s+/).filter(Boolean)

  return valueTokens.some((valueToken) => {
    if (valueToken.length < 5) {
      return false
    }

    return messageTokens.some((messageToken) => {
      return messageToken.length >= 4 && valueToken.startsWith(messageToken)
    })
  })
}

function matchesCloseToken(normalizedMessage: string, normalizedValue: string) {
  const messageTokens = normalizedMessage.split(/\s+/).filter(Boolean)
  const valueTokens = normalizedValue.split(/\s+/).filter(Boolean)

  return valueTokens.some((valueToken) => {
    if (valueToken.length < 5) {
      return false
    }

    return messageTokens.some((messageToken) => {
      if (messageToken.length < 4) {
        return false
      }

      if (isFuzzyStopWord(messageToken)) {
        return false
      }

      const distance = levenshteinDistance(messageToken, valueToken)
      const allowedDistance = valueToken.length <= 5 ? 1 : 2

      return distance <= allowedDistance
    })
  })
}

function isFuzzyStopWord(token: string) {
  return [
    'nombre',
    'servicio',
    'turno',
    'horario',
    'fecha',
    'hola',
    'salir',
    'linda',
    'como',
    'cual',
    'quien',
    'podra',
    'puede',
    'podes',
    'quiero',
    'queres',
    'quieres',
    'hacer',
    'hacerte'
  ].includes(token)
}

function levenshteinDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  const current = Array.from({ length: right.length + 1 }, () => 0)

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1

      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost
      )
    }

    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index] ?? 0
    }
  }

  return previous[right.length] ?? 0
}

function parseWeekday(normalizedMessage: string, today: Date) {
  const weekdays = new Map([
    ['domingo', 0],
    ['lunes', 1],
    ['martes', 2],
    ['miercoles', 3],
    ['jueves', 4],
    ['viernes', 5],
    ['sabado', 6]
  ])

  const weekday = [...weekdays.entries()].find(([name]) => normalizedMessage.includes(name))

  if (!weekday) {
    return null
  }

  const targetDay = weekday[1]
  const daysUntilTarget = (targetDay - today.getDay() + 7) % 7
  const daysToAdd = daysUntilTarget === 0 ? 7 : daysUntilTarget

  return addDays(today, daysToAdd)
}

function parseShortDate(normalizedMessage: string) {
  const match = normalizedMessage.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/)

  if (!match) {
    return null
  }

  const day = Number(match[1])
  const month = Number(match[2])
  const currentYear = new Date().getFullYear()
  const year = match[3]
    ? normalizeYear(Number(match[3]))
    : currentYear

  const date = new Date(year, month - 1, day)

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }

  return startOfDay(date)
}

function parseWrittenDate(normalizedMessage: string) {
  const months = new Map([
    ['enero', 1],
    ['febrero', 2],
    ['marzo', 3],
    ['abril', 4],
    ['mayo', 5],
    ['junio', 6],
    ['julio', 7],
    ['agosto', 8],
    ['septiembre', 9],
    ['setiembre', 9],
    ['octubre', 10],
    ['noviembre', 11],
    ['diciembre', 12]
  ])

  const match = normalizedMessage.match(/(\d{1,2})\s+de\s+([a-z]+)/)

  if (!match) {
    return null
  }

  const day = Number(match[1])
  const monthName = match[2]

  if (!monthName) {
    return null
  }

  const month = months.get(monthName)

  if (!month) {
    return null
  }

  const currentYear = new Date().getFullYear()
  const date = new Date(currentYear, month - 1, day)

  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }

  return startOfDay(date)
}

function normalizeYear(year: number) {
  return year < 100 ? 2000 + year : year
}

function formatParsedTime(hours: number, minutes: number) {
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function startOfDay(date: Date) {
  const nextDate = new Date(date)

  nextDate.setHours(0, 0, 0, 0)

  return nextDate
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date)

  nextDate.setDate(nextDate.getDate() + days)

  return nextDate
}

function formatDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}
