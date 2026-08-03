import { openAiConfig } from '../config/openai.js'
import { getOpenAiClient } from '../integrations/openai-client.js'
import { isAiExecutionEnabled } from './ai-execution-context.js'

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
    if (!isAiExecutionEnabled()) return { decision: 'unclear', confidence: 0 }
    const client = getOpenAiClient()
    if (!client) return { decision: 'unclear', confidence: 0 }

    try {
      const response = await client.responses.create({
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

function isEstimateDecision(value: unknown): value is EstimateDecision {
  return value === 'continue_booking' ||
    value === 'request_exact_quote' ||
    value === 'unclear'
}
