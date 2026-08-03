import { openAiConfig } from '../config/openai.js'
import { getOpenAiClient } from '../integrations/openai-client.js'
import { isAiExecutionEnabled } from './ai-execution-context.js'

export type ServiceValidationDecision = 'confirm' | 'reject' | 'uncertain'

export type ServiceValidationClassification = {
  decision: ServiceValidationDecision | null
  confidence: number
}

export class BookingV2ServiceValidationClassifier {
  async classify(input: {
    message: string
    serviceName: string
    validationMessage: string
    validationQuestion: string
  }): Promise<ServiceValidationClassification> {
    if (!isAiExecutionEnabled()) return { decision: null, confidence: 0 }

    const client = getOpenAiClient()
    if (!client) return { decision: null, confidence: 0 }

    try {
      const response = await client.responses.create({
        model: openAiConfig.model,
        instructions: [
          'Clasifica la respuesta de un cliente que debe confirmar si el servicio elegido es correcto.',
          'Usa confirm cuando desea seguir con ese servicio.',
          'Usa reject cuando afirma que ese servicio no es lo que necesita o quiere volver a elegir.',
          'Usa uncertain cuando no sabe si es el servicio correcto, pide recomendacion o necesita asesoramiento.',
          'Usa null cuando el mensaje no permite determinar ninguna de esas decisiones.',
          'No respondas al cliente ni inventes datos.'
        ].join('\n'),
        input: JSON.stringify(input),
        text: {
          format: {
            type: 'json_schema',
            name: 'service_validation_decision',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['decision', 'confidence'],
              properties: {
                decision: {
                  anyOf: [
                    { type: 'string', enum: ['confirm', 'reject', 'uncertain'] },
                    { type: 'null' }
                  ]
                },
                confidence: { type: 'number', minimum: 0, maximum: 1 }
              }
            }
          }
        },
        store: false
      })

      const parsed = JSON.parse(response.output_text) as ServiceValidationClassification
      return {
        decision: isDecision(parsed.decision) ? parsed.decision : null,
        confidence: Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0
      }
    } catch (error) {
      console.warn('Booking V2 service validation classification failed', error)
      return { decision: null, confidence: 0 }
    }
  }
}

function isDecision(value: unknown): value is ServiceValidationDecision {
  return value === 'confirm' || value === 'reject' || value === 'uncertain'
}
