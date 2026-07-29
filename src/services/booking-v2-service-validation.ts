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
    const deterministic = deterministicServiceValidationDecision(input.message)
    if (deterministic) return { decision: deterministic, confidence: 1 }
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

export function deterministicServiceValidationDecision(
  message: string
): ServiceValidationDecision | null {
  const normalized = normalize(message)

  if (
    [
      'no se',
      'no estoy seguro',
      'no estoy segura',
      'tengo dudas',
      'necesito ayuda',
      'necesito asesoramiento',
      'quiero asesoramiento',
      'que me recomiendan',
      'que me recomendas',
      'no se cual necesito',
      'no se si es'
    ].some((phrase) => normalized.includes(phrase))
  ) {
    return 'uncertain'
  }

  const exactRejections = [
    'no',
    'nop',
    'negativo',
    'mejor no'
  ]
  const rejectionPhrases = [
    'no es',
    'no era eso',
    'quiero cambiar',
    'elegir otro',
    'elegir otra',
    'volver a elegir'
  ]
  if (
    exactRejections.includes(normalized) ||
    rejectionPhrases.some((phrase) => normalized.includes(phrase))
  ) {
    return 'reject'
  }

  const confirmationPhrases = [
    'si',
    'dale',
    'ok',
    'okay',
    'correcto',
    'confirmo',
    'esta bien',
    'exacto',
    'ese',
    'esa',
    'ese quiero',
    'esa quiero',
    'sigamos',
    'seguimos',
    'continuar',
    'continuemos',
    'mandale'
  ]
  if (
    confirmationPhrases.includes(normalized) ||
    confirmationPhrases.some((phrase) =>
      phrase.length >= 4 && normalized.includes(phrase)
    ) ||
    /\bsi\b/.test(normalized)
  ) {
    return 'confirm'
  }

  return null
}

function isDecision(value: unknown): value is ServiceValidationDecision {
  return value === 'confirm' || value === 'reject' || value === 'uncertain'
}

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
}
