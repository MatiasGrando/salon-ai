import { getOpenAiClient } from '../integrations/openai-client.js'
import { openAiConfig } from '../config/openai.js'
import { isAiExecutionEnabled } from './ai-execution-context.js'
import type { BookingDraft, BookingField } from './booking-v2-state.js'

export type BookingV2CatalogOption = {
  id: string
  name: string
  aliases?: string[]
}

export type ExtractedBookingField = {
  value: string | null
  confidence: number
  evidence: string
}

export type BookingCorrectionIntent = {
  field: BookingField | null
  newValue: string | null
  confidence: number
  evidence: string
}

export type BookingV2Extraction = {
  name: ExtractedBookingField
  service: ExtractedBookingField
  professional: ExtractedBookingField
  date: ExtractedBookingField
  time: ExtractedBookingField
  correction: BookingCorrectionIntent
}

export type BookingV2ExtractionInput = {
  message: string
  draft: BookingDraft
  services: BookingV2CatalogOption[]
  professionals: BookingV2CatalogOption[]
  currentDate?: Date
}

export class BookingV2Extractor {
  async extract(input: BookingV2ExtractionInput): Promise<BookingV2Extraction | null> {
    if (!isAiExecutionEnabled()) return null
    const client = getOpenAiClient()
    if (!client) return null

    try {
      const response = await client.responses.create({
        model: openAiConfig.model,
        instructions: [
          'Sos una capa de comprension para un sistema de reservas por WhatsApp.',
          'Extrae datos sin decidir el flujo, sin responder al cliente y sin ejecutar acciones.',
          'Evalua cada campo por separado con value, confidence y evidence.',
          'Para service y professional usa exclusivamente IDs presentes en las listas recibidas.',
          'Si no hay evidencia de un campo, usa value null, confidence 0 y evidence vacio.',
          'No supongas datos por el paso actual ni copies datos existentes si no aparecen en el mensaje.',
          'Interpreta fechas relativas usando currentDate y timezone.',
          'date debe usar YYYY-MM-DD. time debe usar HH:mm.',
          'Detecta correction cuando el usuario quiere cambiar servicio, profesional, fecha u horario ya elegidos.',
          'Frases como mejor otro dia expresan correccion de date aunque no incluyan el nuevo valor.',
          'La confianza representa certeza semantica, no validez en la base.',
          'Un texto ambiguo entre varias opciones debe tener confianza media.',
          'Un texto corrupto o sin relacion clara debe tener confianza baja.'
        ].join('\n'),
        input: JSON.stringify({
          customerMessage: input.message,
          currentDraft: input.draft,
          currentDate: formatDate(input.currentDate ?? new Date()),
          timezone: 'America/Buenos_Aires',
          services: input.services,
          professionals: input.professionals
        }),
        text: {
          format: {
            type: 'json_schema',
            name: 'booking_v2_extraction',
            strict: true,
            schema: bookingExtractionSchema
          }
        },
        store: false
      })

      return normalizeExtraction(JSON.parse(response.output_text) as BookingV2Extraction)
    } catch (error) {
      console.warn('Booking V2 extraction failed', error)
      return null
    }
  }
}

export function normalizeExtraction(extraction: BookingV2Extraction): BookingV2Extraction {
  return {
    name: normalizeField(extraction.name),
    service: normalizeField(extraction.service),
    professional: normalizeField(extraction.professional),
    date: normalizeDateField(extraction.date),
    time: normalizeTimeField(extraction.time),
    correction: {
      field: isBookingField(extraction.correction.field) ? extraction.correction.field : null,
      newValue: cleanValue(extraction.correction.newValue),
      confidence: normalizeConfidence(extraction.correction.confidence),
      evidence: extraction.correction.evidence.trim()
    }
  }
}

const nullableStringSchema = {
  anyOf: [
    { type: 'string' },
    { type: 'null' }
  ]
}

const extractedFieldSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'confidence', 'evidence'],
  properties: {
    value: nullableStringSchema,
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence: { type: 'string' }
  }
}

const bookingExtractionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'service', 'professional', 'date', 'time', 'correction'],
  properties: {
    name: extractedFieldSchema,
    service: extractedFieldSchema,
    professional: extractedFieldSchema,
    date: extractedFieldSchema,
    time: extractedFieldSchema,
    correction: {
      type: 'object',
      additionalProperties: false,
      required: ['field', 'newValue', 'confidence', 'evidence'],
      properties: {
        field: {
          anyOf: [
            { type: 'string', enum: ['name', 'service', 'professional', 'date', 'time'] },
            { type: 'null' }
          ]
        },
        newValue: nullableStringSchema,
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        evidence: { type: 'string' }
      }
    }
  }
}

function normalizeField(field: ExtractedBookingField): ExtractedBookingField {
  return {
    value: cleanValue(field.value),
    confidence: normalizeConfidence(field.confidence),
    evidence: field.evidence.trim()
  }
}

function normalizeDateField(field: ExtractedBookingField): ExtractedBookingField {
  const normalized = normalizeField(field)
  if (!normalized.value || !/^\d{4}-\d{2}-\d{2}$/.test(normalized.value)) {
    return { ...normalized, value: null }
  }
  const date = new Date(`${normalized.value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? { ...normalized, value: null } : normalized
}

function normalizeTimeField(field: ExtractedBookingField): ExtractedBookingField {
  const normalized = normalizeField(field)
  if (!normalized.value || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized.value)) {
    return { ...normalized, value: null }
  }
  return normalized
}

function cleanValue(value: string | null) {
  const cleaned = value?.trim()
  return cleaned ? cleaned : null
}

function normalizeConfidence(confidence: number) {
  if (!Number.isFinite(confidence)) return 0
  return Math.max(0, Math.min(1, confidence))
}

function isBookingField(value: string | null): value is BookingField {
  return value === 'name' ||
    value === 'service' ||
    value === 'professional' ||
    value === 'date' ||
    value === 'time'
}

function formatDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
