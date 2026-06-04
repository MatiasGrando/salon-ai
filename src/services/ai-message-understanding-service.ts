import { openAiConfig } from '../config/openai.js'
import { getOpenAiClient } from '../integrations/openai-client.js'

type MatchableOption = {
  id: string
  name: string
  category?: string | null
  aliases?: Array<{ name: string }>
}

type AiOptionResult = {
  selectedIndex: number | null
  confidence: number
}

type AiDateResult = {
  date: string | null
  confidence: number
}

type AiTimeResult = {
  time: string | null
  confidence: number
}

export type AiCustomerIntroResult = {
  name: string | null
  remainingMessage: string | null
  wantsBooking: boolean
  confidence: number
}

export type AiBookingIntentResult = {
  selectedServiceIndex: number | null
  selectedProfessionalIndex: number | null
  anyProfessional: boolean
  date: string | null
  time: string | null
  timePreference: 'morning' | 'afternoon' | 'evening' | 'any' | null
  confidence: number
}

const minimumConfidence = 0.65

export class AiMessageUnderstandingService {
  isEnabled() {
    return Boolean(getOpenAiClient())
  }

  async findOptionByMessage<T extends MatchableOption>(input: {
    message: string
    options: T[]
    optionType: 'service' | 'professional'
  }) {
    if (input.options.length === 0) {
      return null
    }

    const result = await this.askJson<AiOptionResult>({
      instructions: [
        'Sos una capa de interpretacion para un bot de turnos llamado Cami.',
        'Elegis una opcion de una lista cerrada.',
        'El cliente puede escribir con errores, abreviaturas o frases mezcladas.',
        'Devolve selectedIndex usando el numero 1-based de la opcion elegida.',
        'Si no estas seguro, selectedIndex debe ser null.'
      ].join('\n'),
      input: {
        optionType: input.optionType,
        customerMessage: input.message,
        options: input.options.map((option, index) => ({
          index: index + 1,
          name: option.name,
          category: option.category ?? null,
          aliases: option.aliases?.map((alias) => alias.name) ?? []
        }))
      },
      schemaName: 'booking_option_understanding',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['selectedIndex', 'confidence'],
        properties: {
          selectedIndex: {
            anyOf: [
              { type: 'integer' },
              { type: 'null' }
            ]
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1
          }
        }
      }
    })

    if (!result || result.confidence < minimumConfidence || result.selectedIndex === null) {
      return null
    }

    return input.options[result.selectedIndex - 1] ?? null
  }

  async parseDate(message: string) {
    const result = await this.askJson<AiDateResult>({
      instructions: [
        'Sos una capa de interpretacion de fechas para un bot de turnos en Argentina.',
        'Convertis mensajes naturales a una fecha YYYY-MM-DD.',
        'Usa la fecha actual y zona horaria recibidas para interpretar hoy, manana, pasado y dias de semana.',
        'Si el mensaje no contiene una fecha clara, date debe ser null.',
        'No inventes fechas.'
      ].join('\n'),
      input: {
        customerMessage: message,
        currentDate: formatDate(new Date()),
        timezone: 'America/Buenos_Aires'
      },
      schemaName: 'booking_date_understanding',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'confidence'],
        properties: {
          date: {
            anyOf: [
              { type: 'string' },
              { type: 'null' }
            ]
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1
          }
        }
      }
    })

    if (!result || result.confidence < minimumConfidence || !result.date || !/^\d{4}-\d{2}-\d{2}$/.test(result.date)) {
      return null
    }

    const parsedDate = new Date(`${result.date}T00:00:00`)

    if (Number.isNaN(parsedDate.getTime()) || parsedDate < startOfDay(new Date())) {
      return null
    }

    return result.date
  }

  async parseTime(message: string) {
    const result = await this.askJson<AiTimeResult>({
      instructions: [
        'Sos una capa de interpretacion de horarios para un bot de turnos en Argentina.',
        'Convertis mensajes naturales a una hora HH:mm en formato 24 horas.',
        'Ejemplos: "a las 4 de la tarde" => "16:00", "tipo 10 y media" => "10:30".',
        'Si el mensaje solo dice manana, tarde o noche sin hora concreta, time debe ser null.',
        'No inventes horarios.'
      ].join('\n'),
      input: {
        customerMessage: message
      },
      schemaName: 'booking_time_understanding',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['time', 'confidence'],
        properties: {
          time: {
            anyOf: [
              { type: 'string' },
              { type: 'null' }
            ]
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1
          }
        }
      }
    })

    if (!result || result.confidence < minimumConfidence || !result.time || !/^\d{2}:\d{2}$/.test(result.time)) {
      return null
    }

    const [hoursText, minutesText] = result.time.split(':')
    const hours = Number(hoursText)
    const minutes = Number(minutesText)

    if (
      Number.isNaN(hours) ||
      Number.isNaN(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null
    }

    return result.time
  }

  async extractBookingIntent(input: {
    message: string
    services: MatchableOption[]
    professionals: MatchableOption[]
  }) {
    const result = await this.askJson<AiBookingIntentResult>({
      instructions: [
        'Sos una capa de interpretacion para Cami, un bot de turnos por WhatsApp en Argentina.',
        'Tu trabajo es extraer datos de una frase completa de reserva.',
        'Elegis servicio y profesional solamente desde las listas cerradas recibidas.',
        'Usa indices 1-based para selectedServiceIndex y selectedProfessionalIndex.',
        'Si el cliente dice cualquier profesional, sin preferencia o parecido, anyProfessional debe ser true y selectedProfessionalIndex null.',
        'Interpreta fechas relativas con currentDate y timezone.',
        'time es solamente para una hora concreta. Si dice manana, tarde o noche sin hora exacta, usa timePreference.',
        'No inventes datos. Si algo no esta claro, dejalo en null.'
      ].join('\n'),
      input: {
        customerMessage: input.message,
        currentDate: formatDate(new Date()),
        timezone: 'America/Buenos_Aires',
        services: input.services.map((service, index) => ({
          index: index + 1,
          name: service.name,
          category: service.category ?? null,
          aliases: service.aliases?.map((alias) => alias.name) ?? []
        })),
        professionals: input.professionals.map((professional, index) => ({
          index: index + 1,
          name: professional.name
        }))
      },
      schemaName: 'booking_intent_understanding',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: [
          'selectedServiceIndex',
          'selectedProfessionalIndex',
          'anyProfessional',
          'date',
          'time',
          'timePreference',
          'confidence'
        ],
        properties: {
          selectedServiceIndex: {
            anyOf: [
              { type: 'integer' },
              { type: 'null' }
            ]
          },
          selectedProfessionalIndex: {
            anyOf: [
              { type: 'integer' },
              { type: 'null' }
            ]
          },
          anyProfessional: {
            type: 'boolean'
          },
          date: {
            anyOf: [
              { type: 'string' },
              { type: 'null' }
            ]
          },
          time: {
            anyOf: [
              { type: 'string' },
              { type: 'null' }
            ]
          },
          timePreference: {
            anyOf: [
              {
                type: 'string',
                enum: ['morning', 'afternoon', 'evening', 'any']
              },
              { type: 'null' }
            ]
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1
          }
        }
      }
    })

    if (!result || result.confidence < minimumConfidence) {
      return null
    }

    return {
      ...result,
      date: normalizeDateResult(result.date),
      time: normalizeTimeResult(result.time)
    }
  }

  async extractCustomerIntro(message: string) {
    const result = await this.askJson<AiCustomerIntroResult>({
      instructions: [
        'Sos una capa de interpretacion para Cami, un bot de turnos por WhatsApp.',
        'El bot acaba de pedir el nombre del cliente.',
        'Extrae solamente el nombre real de la persona.',
        'Si el mensaje tambien incluye un pedido de reserva, deja ese pedido limpio en remainingMessage.',
        'No incluyas saludos como hola, buenas, soy, me llamo en el nombre.',
        'No incluyas el pedido de turno en el nombre.',
        'Si no hay un nombre claro, name debe ser null.'
      ].join('\n'),
      input: {
        customerMessage: message
      },
      schemaName: 'customer_intro_understanding',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'remainingMessage', 'wantsBooking', 'confidence'],
        properties: {
          name: {
            anyOf: [
              { type: 'string' },
              { type: 'null' }
            ]
          },
          remainingMessage: {
            anyOf: [
              { type: 'string' },
              { type: 'null' }
            ]
          },
          wantsBooking: {
            type: 'boolean'
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1
          }
        }
      }
    })

    if (!result || result.confidence < minimumConfidence || !result.name) {
      return null
    }

    return {
      ...result,
      name: cleanExtractedName(result.name),
      remainingMessage: result.remainingMessage?.trim() || null
    }
  }

  private async askJson<T>(input: {
    instructions: string
    input: unknown
    schemaName: string
    schema: Record<string, unknown>
  }): Promise<T | null> {
    const client = getOpenAiClient()

    if (!client) {
      return null
    }

    try {
      const response = await client.responses.create({
        model: openAiConfig.model,
        instructions: input.instructions,
        input: JSON.stringify(input.input),
        text: {
          format: {
            type: 'json_schema',
            name: input.schemaName,
            strict: true,
            schema: input.schema
          }
        },
        store: false
      })

      return JSON.parse(response.output_text) as T
    } catch (error) {
      console.warn('OpenAI understanding failed', error)

      return null
    }
  }
}

function cleanExtractedName(name: string) {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/g, '')
}

function normalizeDateResult(date: string | null) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null
  }

  const parsedDate = new Date(`${date}T00:00:00`)

  if (Number.isNaN(parsedDate.getTime()) || parsedDate < startOfDay(new Date())) {
    return null
  }

  return date
}

function normalizeTimeResult(time: string | null) {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return null
  }

  const [hoursText, minutesText] = time.split(':')
  const hours = Number(hoursText)
  const minutes = Number(minutesText)

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null
  }

  return time
}

function formatDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function startOfDay(date: Date) {
  const nextDate = new Date(date)

  nextDate.setHours(0, 0, 0, 0)

  return nextDate
}
