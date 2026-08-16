import { openAiConfig } from '../config/openai.js'
import { createTrackedOpenAiResponse, getOpenAiClient } from '../integrations/openai-client.js'
import { isAiExecutionEnabled } from './ai-execution-context.js'
import { normalizeText } from './message-understanding-service.js'
import { detectDeterministicConfirmation } from './conversation-confirmation-intent.js'

export type EstimateDecision = 'continue_booking' | 'request_exact_quote' | 'unclear'

export type EstimateDecisionExtraction = {
  decision: EstimateDecision
  confidence: number
}

export class BookingV2EstimateDecisionExtractor {
  async extract(input: {
    message: string
    serviceName: string
    allowsBooking: boolean
    requiresPhoto: boolean
  }): Promise<EstimateDecisionExtraction> {
    const deterministicDecision = detectDeterministicEstimateDecision(input.message)
    if (deterministicDecision) return deterministicDecision

    if (!isAiExecutionEnabled()) return { decision: 'unclear', confidence: 0 }
    const client = getOpenAiClient()
    if (!client) return { decision: 'unclear', confidence: 0 }

    try {
      const response = await createTrackedOpenAiResponse(client, 'booking_estimate_decision', {
        model: openAiConfig.model,
        instructions: [
          'Sos un extractor semantico para una decision dentro de un flujo de reservas.',
          'El cliente acaba de recibir un precio estimativo y debe elegir entre continuar con la reserva o pedir un presupuesto exacto.',
          'Clasifica por significado, no por coincidencia literal de palabras.',
          'Usa continue_booking cuando quiere avanzar, reservar, sacar el turno o seguir con el proceso.',
          'Usa request_exact_quote cuando quiere una cotizacion precisa, revision del equipo, evaluacion humana o confirmar el precio final.',
          'Usa unclear cuando no expresa una eleccion, hace otra pregunta o la respuesta puede significar ambas opciones.',
          'No respondas al cliente, no cambies datos y no inventes contexto.'
        ].join('\n'),
        input: JSON.stringify(input),
        text: {
          format: {
            type: 'json_schema',
            name: 'booking_estimate_decision',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['decision', 'confidence'],
              properties: {
                decision: {
                  type: 'string',
                  enum: ['continue_booking', 'request_exact_quote', 'unclear']
                },
                confidence: { type: 'number', minimum: 0, maximum: 1 }
              }
            }
          }
        },
        store: false
      })

      const parsed = JSON.parse(response.output_text) as EstimateDecisionExtraction
      return {
        decision: isEstimateDecision(parsed.decision) ? parsed.decision : 'unclear',
        confidence: Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0
      }
    } catch (error) {
      console.warn('Booking V2 estimate decision extraction failed', error)
      return { decision: 'unclear', confidence: 0 }
    }
  }
}

export function detectDeterministicEstimateDecision(
  message: string
): EstimateDecisionExtraction | null {
  const normalized = normalizeText(message)
  if (!normalized) return null

  if (
    /^(no|nop|mejor no|no me|no quiero|no sigamos|no continuemos)\b/.test(normalized) ||
    /\b(?:sin presupuesto|no (?:quiero|necesito|hace falta|me interesa)(?: el| un)? presupuesto|no (?:quiero|necesito|me interesa)(?: la| una)? cotizacion)\b/.test(normalized)
  ) {
    return null
  }

  const explicitExactQuote = [
    'presupuesto exacto',
    'pedir presupuesto',
    'consultar presupuesto',
    'quiero un presupuesto',
    'quiero presupuesto',
    'prefiero presupuesto',
    'vamos con el presupuesto',
    'vamos con presupuesto',
    'dale con el presupuesto',
    'cotizacion exacta',
    'cotizacion precisa',
    'quiero una cotizacion',
    'quiero cotizacion',
    'precio exacto',
    'precio final',
    'valor exacto',
    'valor final',
    'monto exacto',
    'total exacto',
    'que lo revise el equipo',
    'que lo revise una profesional',
    'quiero que me asesoren'
  ].some((phrase) => normalized.includes(phrase))
  const bareQuoteChoice = /^(?:(?:si|dale|bueno|ok|okay|perfecto)\s+)?(?:el\s+|un\s+|una\s+)?(?:presupuesto|cotizacion)(?:\s+(?:exact[oa]|precis[oa]))?$/.test(normalized)
  const exactShortcut = /^(?:(?:si|dale|bueno|ok|okay|perfecto)\s+)?(?:(?:quiero|prefiero|dame|pasame|vamos con)\s+)?(?:el\s+|la\s+)?exact[oa]$/.test(normalized)

  if (explicitExactQuote || bareQuoteChoice || exactShortcut) {
    return { decision: 'request_exact_quote', confidence: 0.98 }
  }

  if (/\b(?:continuar|continuo|continuemos|seguir|sigamos|reservar|reservo|avanzar|avancemos)\b/.test(normalized)) {
    return { decision: 'continue_booking', confidence: 0.98 }
  }

  const confirmation = detectDeterministicConfirmation(message)
  if (confirmation?.intent === 'confirm') {
    return { decision: 'continue_booking', confidence: confirmation.confidence }
  }

  return null
}

function isEstimateDecision(value: unknown): value is EstimateDecision {
  return value === 'continue_booking' ||
    value === 'request_exact_quote' ||
    value === 'unclear'
}
