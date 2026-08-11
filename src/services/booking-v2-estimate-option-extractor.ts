import { openAiConfig } from '../config/openai.js'
import { createTrackedOpenAiResponse, getOpenAiClient } from '../integrations/openai-client.js'
import { isAiExecutionEnabled } from './ai-execution-context.js'

export type EstimateOptionExtraction = {
  optionId: string | null
  confidence: number
}

export class BookingV2EstimateOptionExtractor {
  async extract(input: {
    message: string
    serviceName: string
    options: Array<{ id: string; label: string; note: string | null }>
  }): Promise<EstimateOptionExtraction> {
    if (!isAiExecutionEnabled()) return { optionId: null, confidence: 0 }
    const client = getOpenAiClient()
    if (!client) return { optionId: null, confidence: 0 }

    try {
      const response = await createTrackedOpenAiResponse(client, 'booking_estimate_option', {
        model: openAiConfig.model,
        instructions: [
          'Sos un extractor semantico para elegir una banda u opcion de un estimativo.',
          'Comprende numeros, descripciones aproximadas, sinonimos y lenguaje informal.',
          'Compara el significado completo de las opciones como rangos mutuamente excluyentes; no elijas por una palabra compartida ignorando calificadores, limites o negaciones.',
          'Respeta relaciones como hasta, menos de, mas de, supera, pasa, no llega y llega a para ubicar correctamente el caso dentro de una banda.',
          'Ejemplo de limite: si las opciones son Hasta los hombros y Mas largo que los hombros, me pasa los hombros o me llega a la espalda corresponde obligatoriamente a Mas largo que los hombros.',
          'Devolve exclusivamente el ID de una opcion recibida cuando haya una coincidencia unica.',
          'Si dos opciones son posibles o el mensaje es una pregunta distinta, usa optionId null.',
          'No respondas al cliente ni inventes opciones.'
        ].join('\n'),
        input: JSON.stringify(input),
        text: {
          format: {
            type: 'json_schema',
            name: 'booking_estimate_option',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['optionId', 'confidence'],
              properties: {
                optionId: {
                  anyOf: [{ type: 'string' }, { type: 'null' }]
                },
                confidence: { type: 'number', minimum: 0, maximum: 1 }
              }
            }
          }
        },
        store: false
      })
      const parsed = JSON.parse(response.output_text) as EstimateOptionExtraction
      const optionId = input.options.some((option) => option.id === parsed.optionId)
        ? parsed.optionId
        : null
      return {
        optionId,
        confidence: Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0
      }
    } catch (error) {
      console.warn('Booking V2 estimate option extraction failed', error)
      return { optionId: null, confidence: 0 }
    }
  }
}
