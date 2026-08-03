import { openAiConfig } from '../config/openai.js'
import { getOpenAiClient } from '../integrations/openai-client.js'
import { isAiExecutionEnabled } from './ai-execution-context.js'

export type BookingV2ChoiceExtraction = {
  choiceId: string | null
  confidence: number
}

export class BookingV2ChoiceExtractor {
  async extract(input: {
    message: string
    question: string
    choices: Array<{ id: string; meaning: string }>
  }): Promise<BookingV2ChoiceExtraction> {
    if (!isAiExecutionEnabled()) return { choiceId: null, confidence: 0 }
    const client = getOpenAiClient()
    if (!client) return { choiceId: null, confidence: 0 }

    try {
      const response = await client.responses.create({
        model: openAiConfig.model,
        instructions: [
          'Sos un extractor semantico de decisiones para un flujo de reservas.',
          'Interpreta la intencion completa de la respuesta usando la pregunta y las opciones disponibles.',
          'No dependas de palabras exactas: comprende afirmaciones, rechazos, reformulaciones y lenguaje informal.',
          'Las decisiones indirectas pero claras tambien cuentan: expresiones de que algo no sirve, es demasiado caro, quiere dejarlo o no desea avanzar deben asociarse a la opcion de rechazo disponible.',
          'Expresiones como me cierra, hagamoslo, avancemos o quedamos asi deben asociarse a la opcion de aceptacion o confirmacion disponible.',
          'Devolve el ID exacto de una opcion solo si la eleccion es clara y unica.',
          'Usa choiceId null solamente si pregunta otra cosa, quiere cambiar de tema o la decision realmente admite mas de una opcion.',
          'No respondas al cliente ni inventes opciones.'
        ].join('\n'),
        input: JSON.stringify(input),
        text: {
          format: {
            type: 'json_schema',
            name: 'booking_flow_choice',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['choiceId', 'confidence'],
              properties: {
                choiceId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                confidence: { type: 'number', minimum: 0, maximum: 1 }
              }
            }
          }
        },
        store: false
      })
      const parsed = JSON.parse(response.output_text) as BookingV2ChoiceExtraction
      const choiceId = input.choices.some((choice) => choice.id === parsed.choiceId)
        ? parsed.choiceId
        : null
      return {
        choiceId,
        confidence: Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0
      }
    } catch (error) {
      console.warn('Booking V2 choice extraction failed', error)
      return { choiceId: null, confidence: 0 }
    }
  }
}
