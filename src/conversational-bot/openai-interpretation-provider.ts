import { attachAiUsage } from './ai-usage.js'
import type { AiInterpretationProvider } from './ai-interpreter.js'

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'serviceId', 'serviceEvidence', 'professionalMention', 'serviceConfidence'],
  properties: {
    intent: { type: 'string', enum: ['booking', 'information', 'other'] },
    serviceId: { type: ['string', 'null'] },
    serviceEvidence: { type: ['string', 'null'] },
    professionalMention: { type: ['string', 'null'] },
    serviceConfidence: { type: 'string', enum: ['certain', 'uncertain'] }
  }
} as const

/** No ambient credentials or global model setting: the caller explicitly enables this QA-only provider. */
export function createOpenAiInterpretationProvider(options: {
  apiKey: string
  model?: string
  fetchImpl?: typeof fetch
}): AiInterpretationProvider {
  if (!options.apiKey || options.apiKey.length > 4096) throw new Error('OpenAI key required')
  const fetchImpl = options.fetchImpl ?? fetch
  const model = options.model ?? 'gpt-6-luna'
  return async (input, signal) => {
    if (input.message.length > 2000 || input.services.length > 200) throw new Error('AI input too large')
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + options.apiKey, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model,
        ...(model === 'gpt-6-luna' ? { reasoning: { effort: 'none' } } : {}), // QA Luna experiment only.
        store: false,
        max_output_tokens: 400,
        instructions: 'Interpretá SOLO el mensaje actual para un bot del local. Devolvé serviceId únicamente de la lista, con serviceEvidence como fragmento textual exacto del cliente. Entendé sinónimos semánticos por contexto, no por coincidencia literal. serviceConfidence es certain solo si la equivalencia no es ambigua; si hay dudas usá uncertain o serviceId null. Nunca inventes IDs ni profesionales. professionalMention debe ser literal. Clasificá saludo, charla casual y pedidos ajenos al negocio como other; consultas del local como information. Una segunda llamada redactará la respuesta tras verificar resultados del motor. No inventes hechos ni confirmes reservas.',
        input: JSON.stringify({
          message: input.message,
          pending: input.state.pending,
          serviceId: input.state.serviceId,
          professionalNameHint: input.state.professionalNameHint,
          services: input.services.slice(0, 100).map(s => ({ id: s.id, name: s.name }))
        }),
        text: { format: { type: 'json_schema', name: 'conversational_turn_interpretation', strict: true, schema } }
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
