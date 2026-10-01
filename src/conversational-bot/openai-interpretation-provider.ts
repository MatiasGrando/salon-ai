import { attachAiUsage } from './ai-usage.js'
import { providerError } from './provider-error.js'
import { parseDialogueState } from './engine.js'
import { TURN_PLAN_JSON_SCHEMA } from './turn-plan.js'
import type { AiInterpretationProvider } from './ai-interpreter.js'

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'serviceId', 'serviceEvidence', 'professionalMention', 'serviceConfidence', 'serviceCandidateIds', 'serviceCorrection', 'firstReply', 'intakeReply', 'informationTarget', 'turnPlan'],
  properties: {
    turnPlan: { anyOf: [TURN_PLAN_JSON_SCHEMA, { type: 'null' }] },
    intent: { type: 'string', enum: ['booking', 'information', 'other'] },
    serviceId: { type: ['string', 'null'] },
    serviceEvidence: { type: ['string', 'null'] },
    professionalMention: { type: ['string', 'null'] },
    serviceConfidence: { type: 'string', enum: ['certain', 'uncertain'] },
    serviceCandidateIds: { type: 'array', items: { type: 'string' } },
    serviceCorrection: { type: 'boolean' },
    informationTarget: {
      type: ['object', 'null'], additionalProperties: false, required: ['kind', 'actions'],
      properties: {
        kind: { type: 'string', enum: ['business', 'presented_offer'] },
        actions: { type: 'array', items: { type: 'string', enum: ['SERVICES', 'PRICES', 'HOURS', 'ADDRESS', 'BUSINESS_INFO'] } }
      }
    },
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
    const state = parseDialogueState(input.state, input.state.businessId)
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
        max_output_tokens: 2000,
        instructions: 'Interpretá todas las peticiones combinables del mensaje actual junto al contexto compacto, sin inventar historial. turnPlan version 1 con operations es la representación principal; intent es sólo clasificación compatible y nunca bloquea operaciones. Cada operación tiene evidence literal del mensaje y confidence numérica de 0 a 1; incertidumbre de servicio se expresa en alternativas, no eligiendo arbitrariamente. Extraé servicio, fecha, profesional, hora y nombre independientemente de la pregunta pendiente, aunque aparezcan temprano o como correcciones, y conservá simultáneamente consultas de información. kind service usa mode single para un ID inequívoco del catálogo, alternatives para opciones posibles de un único servicio, multiple para varios servicios pedidos juntos y unresolved con serviceIds [] cuando no podés identificar el servicio solicitado en el catálogo: conserva su evidencia y las demás peticiones sin inventar IDs ni afirmar que el local no lo ofrece. Distinguir alternativas de múltiples, sin descartar servicios porque la cesta no esté implementada. serviceIds sólo contiene IDs de la lista y correction indica reemplazo. kind professional usa specific con mention literal, any cuando expresa cualquiera y clear para quitar preferencia. kind date lleva expression literal y value fecha YYYY-MM-DD propuesta o null; businessDate/timezone son el reloj y zona del servidor, nunca inventes hoy. Una expresión ambigua no exige inventar value. kind time lleva value HH:mm normalizado semánticamente, también para horas escritas con palabras, sin exigir dígitos ni frases de una lista. kind name lleva value literal del nombre incluso si es la respuesta breve al paso anterior. kind information conserva target business/actions SERVICES, PRICES, HOURS, ADDRESS, BUSINESS_INFO o presented_offer/actions [] para consultar la oferta ya mostrada; pueden combinarse ambas lecturas. Una referencia a horarios mostrados no cambia fecha ni confirma agenda fresca; una nueva fecha sólo en esa consulta se contrasta con la oferta. Para atención/apertura del local usá business HOURS aunque haya reserva en curso. Si no hay oferta mostrada el motor pedirá aclaración. kind unsupported_action representa CANCEL, RESCHEDULE o HUMAN_HANDOFF sin afirmar efectos ejecutados. No dupliques una entidad con valores contradictorios ni repitas operaciones del mismo campo; agrupa acciones de información del mismo target. Si sólo hay saludo, charla casual o pedido ajeno, operations es []. Ante solicitud nueva de reservar sin entidades explícitas usá turnPlan null e intent booking para el inicio compatible del motor. Ante reset o control compatible usá turnPlan null. Con turnPlan no null, los campos legacy serviceId/serviceEvidence/professionalMention/informationTarget son null, serviceCandidateIds es [], serviceCorrection false y serviceConfidence certain: no repitas datos en dos representaciones. Para adaptadores legacy sin plan, serviceCandidateIds describe únicamente alternativas para un servicio particular pedido en el mensaje actual, nunca un listado de información; en una consulta general de catálogo o precios serviceCandidateIds es vacío. Si no se menciona un servicio particular, serviceId y serviceEvidence son null. No repitas el serviceId del estado sin evidencia literal en el mensaje actual. Si firstReplyFacts está presente y sólo hay información o charla sin cambios, podés redactar firstReply breve rioplatense mediante factIds, cada hecho exactamente una vez. Si hay next debe ser último y closing null; el servidor inserta los textos literalmente. opening/closing sólo charla o transición, nunca hechos del negocio, cifras, servicios, profesionales ni afirmaciones de reservas. No uses firstReply para operaciones que cambian datos. intakeReply se conserva sólo para el adaptador sin plan: si intakeReplyAllowed y no hay corrección podés anticipar pregunta de servicio o fecha, con pending/serviceId/candidateIds del próximo estado esperado; el servidor verificará e insertará hechos. Si no podés anticiparlo, intakeReply null. Con plan, intakeReply null. Ante charla conservá la pregunta pendiente; pedidos ajenos se encauzan brevemente a ayuda del local. No inventes disponibilidad ni confirmes reservas: el motor valida y únicamente genera propuestas.',
        input: JSON.stringify({
          message: input.message,
          ...(input.businessDate ? { businessDate: input.businessDate } : {}),
          ...(input.timezone ? { timezone: input.timezone } : {}),
          pending: input.state.pending,
          serviceId: input.state.serviceId,
          professionalNameHint: input.state.professionalNameHint,
          date: input.state.date,
          professional: input.state.professional,
          requestedTime: input.state.requestedTime,
          customerName: input.state.customerName,
          dialogueContext: state.dialogueContext ?? null,
          intakeReplyAllowed: input.intakeReplyAllowed === true,
          ...(input.firstReplyFacts !== undefined ? { firstReplyFacts: input.firstReplyFacts } : {}),
          services: input.services.map(s => ({ id: s.id, name: s.name }))
        }),
        text: { format: { type: 'json_schema', name: 'conversational_turn_interpretation', strict: true, schema } }
      })
    })
    if (!response.ok) throw providerError('http', response)
    let body: unknown
    try { body = await response.json() } catch { throw providerError('json', response) }
    if (!body || typeof body !== 'object' || (body as { status?: unknown }).status !== 'completed') throw providerError('incomplete', response)
    const output = (body as { output?: unknown }).output
    if (!Array.isArray(output)) throw providerError('shape', response)
    const contents = output.filter(item => item && typeof item === 'object' && (item as { type?: unknown }).type === 'message')
      .flatMap(item => Array.isArray((item as { content?: unknown }).content) ? (item as { content: unknown[] }).content : [])
    if (contents.some(part => part && typeof part === 'object' && (part as { type?: unknown }).type === 'refusal')) throw providerError('refusal', response)
    const texts = contents.filter(part => part && typeof part === 'object' && (part as { type?: unknown }).type === 'output_text')
      .map(part => (part as { text?: unknown }).text)
    if (texts.length !== 1 || typeof texts[0] !== 'string' || texts[0].length > 8192) throw providerError('shape', response)
    let parsed: unknown
    try { parsed = JSON.parse(texts[0]) } catch { throw providerError('json', response) }
    return attachAiUsage(parsed, body)
  }
}
