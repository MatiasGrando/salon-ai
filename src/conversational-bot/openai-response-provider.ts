import { attachAiUsage } from './ai-usage.js'
import { providerError } from './provider-error.js'
import { extractResponsesJson } from './responses-json.js'
import type { AiResponseProvider } from './ai-interpreter.js'

/** QA-only composition call: the engine supplies the only factual fragments. */
export function createOpenAiResponseProvider(options: { apiKey: string; model?: string; fetchImpl?: typeof fetch }): AiResponseProvider {
  if (!options.apiKey || options.apiKey.length > 4096) throw new Error('OpenAI key required')
  const fetchImpl = options.fetchImpl ?? fetch
  const model = options.model ?? 'gpt-6-luna'
  return async (input, signal) => {
    if (input.message.length > 2000 || input.facts.length > 100 || input.facts.some(fact => fact.text.length > 1000))
      throw new Error('AI response input too large')
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + options.apiKey, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model,
        ...(model === 'gpt-6-luna' ? { reasoning: { effort: 'none' } } : {}),
        store: false,
        max_output_tokens: 300,
        instructions: 'Al explicar la fecha de una oferta anterior, opening es null: el hecho verificado responde sin un sí/no inventado. Sos la asistente amable del local. Respondé breve y natural en español rioplatense. opening y closing contienen solo charla social o transiciones, nunca hechos del negocio, precios, horarios, direcciones, disponibilidad, nombres de servicios/profesionales ni afirmaciones de reservas o acciones. Si hay un fact con id next, es la pregunta obligatoria y su id debe ir al final de factIds con closing null. Incluí cada fact verificado exactamente una vez por factIds, en orden natural. El servidor insertará literalmente esos textos; no los copies ni cambies. Ante saludo o charla casual respondé como persona en una o dos frases sin menú. Ante pedidos ajenos al local, decliná brevemente y ofrecé ayuda del negocio. No repitas siempre la misma pregunta. Si no hay facts, factIds es [].',
        input: JSON.stringify({ message: input.message, intent: input.intent, pending: input.state.pending, facts: input.facts }),
        text: { format: { type: 'json_schema', name: 'grounded_qa_reply', strict: true, schema: {
          type: 'object', additionalProperties: false, required: ['opening', 'factIds', 'closing'],
          properties: {
            opening: { type: ['string', 'null'] },
            factIds: { type: 'array', items: { type: 'string' } },
            closing: { type: ['string', 'null'] }
          }
        } } }
      })
    })
    if (!response.ok) throw providerError('http', response)
    let body: unknown
    try { body = await response.json() } catch { throw providerError('json', response, { reason: 'response_json_invalid', responseStatus: 'unknown' }) }
    const result = extractResponsesJson(body, 4096)
    if (!result.ok) throw providerError(result.code, response, result.responseFormat)
    return attachAiUsage(result.value, body)
  }
}
