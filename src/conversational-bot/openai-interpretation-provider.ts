import { attachAiUsage } from './ai-usage.js'
import type { AiInterpretationProvider } from './ai-interpreter.js'

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'serviceId', 'serviceEvidence', 'professionalMention', 'serviceConfidence', 'serviceCandidateIds', 'serviceCorrection', 'firstReply', 'intakeReply'],
  properties: {
    intent: { type: 'string', enum: ['booking', 'information', 'other'] },
    serviceId: { type: ['string', 'null'] },
    serviceEvidence: { type: ['string', 'null'] },
    professionalMention: { type: ['string', 'null'] },
    serviceConfidence: { type: 'string', enum: ['certain', 'uncertain'] },
    serviceCandidateIds: { type: 'array', items: { type: 'string' } },
    serviceCorrection: { type: 'boolean' },
    intakeReply: {
      type: ['object', 'null'], additionalProperties: false,
      required: ['opening', 'closing', 'pending', 'serviceId', 'candidateIds'],
      properties: {
        opening: { type: ['string', 'null'] }, closing: { type: ['string', 'null'] },
        pending: { type: 'string', enum: ['service', 'date'] },
        serviceId: { type: ['string', 'null'] }, candidateIds: { type: 'array', items: { type: 'string' } }
      }
    },
    firstReply: {
      type: ['object', 'null'], additionalProperties: false,
      required: ['opening', 'factIds', 'closing'],
      properties: {
        opening: { type: ['string', 'null'] },
        factIds: { type: 'array', items: { type: 'string' } },
        closing: { type: ['string', 'null'] }
      }
    }
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
    if (input.message.length > 2000 || input.services.length > 200 ||
        input.firstReplyFacts && (input.firstReplyFacts.length > 100 || input.firstReplyFacts.some(fact => fact.text.length > 1000))) throw new Error('AI input too large')
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + options.apiKey, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model,
        ...(model === 'gpt-6-luna' ? { reasoning: { effort: 'none' } } : {}), // QA Luna experiment only.
        store: false,
        max_output_tokens: 600,
        instructions: 'Interpretá SOLO el mensaje actual para un bot del local. Devolvé serviceId únicamente de la lista, con serviceEvidence como fragmento textual exacto del cliente. Entendé sinónimos semánticos por contexto, no por coincidencia literal. Si el mensaje combina saludo con pedido de turno, intent es booking. serviceCandidateIds describe únicamente alternativas para un servicio particular pedido en el mensaje actual, nunca los servicios que vas a listar como información. En una consulta general de catálogo o precios, serviceCandidateIds es vacío. Si no se menciona un servicio particular, serviceId y serviceEvidence son null y serviceCorrection es false. No repitas el serviceId del estado sin evidencia literal en el mensaje actual. Si el servicio particular solicitado es ambiguo, devolvé serviceId null y los IDs plausibles en serviceCandidateIds; no elijas uno arbitrariamente. Si es inequívoco, devolvé serviceId y serviceCandidateIds vacío. serviceCorrection true indica que el cliente corrige o reemplaza el servicio anterior. serviceConfidence es certain solo si la equivalencia no es ambigua; si hay dudas usá uncertain o serviceId null. Nunca inventes IDs ni profesionales. professionalMention debe ser literal. Clasificá saludo, charla casual y pedidos ajenos al negocio como other; consultas del local como information. Si firstReplyFacts está presente y es information u other, podés redactar firstReply breve en español rioplatense. Incluí cada fact exactamente una vez por factIds; el servidor insertará sus textos literalmente. opening y closing contienen solo charla social o transiciones, nunca hechos del negocio, precios, horarios, direcciones, servicios, profesionales ni afirmaciones de reservas o acciones. Si firstReplyFacts es [] y es other, respondé al saludo o charla casual sin menú; ante pedidos ajenos ofrecé ayuda del local. Para booking firstReply es null. Si intakeReplyAllowed es true y no hay corrección, podés anticipar intakeReply únicamente para preguntar servicio o día, sin resultados de agenda. pending y serviceId deben describir el próximo estado esperado; candidateIds incluye todas las alternativas ambiguas de serviceCandidateIds o es vacío. El servidor verificará el estado y agregará literalmente preguntas y datos del catálogo; opening y closing solo saludo o transición social, sin cifras, servicios ni afirmaciones del negocio. Si no podés anticipar ese resultado, intakeReply es null. Para other o information intakeReply es null. Las preguntas incidentales sencillas solo se responden mediante hechos verificados de firstReplyFacts; pedidos largos o ajenos se encauzan brevemente a la ayuda del local, conservando la pregunta pendiente. Ante intent other no completes ni modifiques una reserva. No inventes hechos ni confirmes reservas.',
        input: JSON.stringify({
          message: input.message,
          pending: input.state.pending,
          serviceId: input.state.serviceId,
          professionalNameHint: input.state.professionalNameHint,
          date: input.state.date,
          intakeReplyAllowed: input.intakeReplyAllowed === true,
          ...(input.firstReplyFacts !== undefined ? { firstReplyFacts: input.firstReplyFacts } : {}),
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
