import { attachAiUsage } from './ai-usage.js'
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
        instructions: 'Sos la asistente amable del local. Respondé breve y natural en español rioplatense. opening y closing contienen solo charla social o transiciones, nunca hechos del negocio, precios, horarios, direcciones, disponibilidad, nombres de servicios/profesionales ni afirmaciones de reservas o acciones. Incluí cada fact verificado exactamente una vez por factIds, en orden natural. El servidor insertará literalmente esos textos; no los copies ni cambies. Ante saludo o charla casual respondé como persona en una o dos frases sin menú. Ante pedidos ajenos al local, decliná brevemente y ofrecé ayuda del negocio. No repitas siempre la misma pregunta. Si no hay facts, factIds es [].',
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
    if (!response.ok) throw new Error('OpenAI response unavailable')
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object' || (body as { status?: unknown }).status !== 'completed') throw new Error('OpenAI response incomplete')
    const output = (body as { output?: unknown }).output
    if (!Array.isArray(output)) throw new Error('OpenAI response missing output')
    const contents = output.filter(item => item && typeof item === 'object' && (item as { type?: unknown }).type === 'message')
      .flatMap(item => Array.isArray((item as { content?: unknown }).content) ? (item as { content: unknown[] }).content : [])
    if (contents.some(part => part && typeof part === 'object' && (part as { type?: unknown }).type === 'refusal')) throw new Error('OpenAI refusal')
    const texts = contents.filter(part => part && typeof part === 'object' && (part as { type?: unknown }).type === 'output_text')
      .map(part => (part as { text?: unknown }).text)
    if (texts.length !== 1 || typeof texts[0] !== 'string' || texts[0].length > 4096) throw new Error('OpenAI response invalid')
    return attachAiUsage(JSON.parse(texts[0]), body)
  }
}
