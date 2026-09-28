import { parseDialogueState, respond, type DialogueContext, type DialoguePort, type DialogueResponse, type DialogueService, type DialogueState } from './engine.js'

export type AiInterpretationInput = { message: string; state: DialogueState; services: readonly DialogueService[] }
export type AiInterpretationProvider = (input: AiInterpretationInput, signal: AbortSignal) => Promise<unknown>
export type InterpretationDiagnostics = {
  mode: 'ai' | 'fallback'
  reason: 'provider_error' | 'timeout' | 'invalid_output' | null
  providerMs: number
  validationMs: number
  totalMs: number
  copyMode: 'ai' | 'fallback'
  copyReason: 'missing_draft' | 'unsafe_draft' | 'canonical_only' | null
}
export type InterpretedDialogueResponse = DialogueResponse & { interpretation: InterpretationDiagnostics }
type Candidate = { intent: 'booking' | 'information' | 'other'; serviceId: string | null; serviceEvidence: string | null; professionalMention: string | null; replyDraft?: string | null }

const ms = (value: number) => Math.round(value * 10) / 10
const normalized = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
const evidenceWords = (value: string) => ' ' + normalized(value).replace(/[^a-z0-9]+/g, ' ').trim() + ' '
const containsEvidence = (message: string, evidence: string) => evidenceWords(message).includes(evidenceWords(evidence))
function validateCandidate(value: unknown, message: string, services: readonly DialogueService[]): Candidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid AI output')
  const item = value as Record<string, unknown>
  if (!['intent,professionalMention,serviceEvidence,serviceId', 'intent,professionalMention,replyDraft,serviceEvidence,serviceId'].includes(Object.keys(item).sort().join(','))) throw new Error('invalid AI output keys')
  if (!['booking', 'information', 'other'].includes(String(item.intent))) throw new Error('invalid AI intent')
  for (const key of ['serviceId', 'serviceEvidence', 'professionalMention'] as const) {
    if (item[key] !== null && (typeof item[key] !== 'string' || item[key].length < 1 || item[key].length > 128 || /[\u0000-\u001f]/.test(item[key]))) throw new Error('invalid AI field')
  }
  if (item.replyDraft !== undefined && item.replyDraft !== null && (typeof item.replyDraft !== 'string' || item.replyDraft.length < 1 || item.replyDraft.length > 180 || /[\u0000-\u001f]/.test(item.replyDraft))) throw new Error('invalid AI draft')
  if (item.serviceId !== null && item.serviceEvidence === null) throw new Error('missing service evidence')
  if (item.serviceId === null && item.serviceEvidence !== null && !containsEvidence(message, item.serviceEvidence as string)) throw new Error('ungrounded service evidence')
  if (item.serviceId !== null && (!services.some(s => s.id === item.serviceId) || !containsEvidence(message, item.serviceEvidence as string))) throw new Error('ungrounded AI service')
  if (item.professionalMention !== null && !containsEvidence(message, item.professionalMention as string)) throw new Error('ungrounded AI professional')
  return item as Candidate
}

/** A unique near-match may only produce a question; it is never a service selection. */
function suggestedService(evidence: string, services: readonly DialogueService[]): DialogueService | null {
  const tokens = (value: string) => evidenceWords(value).trim().split(' ').filter(word => word && !['quiero', 'un', 'una', 'de', 'del', 'el', 'la', 'para', 'turno', 'servicio'].includes(word))
  const input = tokens(evidence)
  if (!input.length) return null
  const distance = (left: string, right: string) => {
    let row = [...Array(right.length + 1).keys()]
    for (let i = 1; i <= left.length; i++) {
      const next = [i]
      for (let j = 1; j <= right.length; j++) next[j] = Math.min(next[j - 1]! + 1, row[j]! + 1, row[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1))
      row = next
    }
    return row[right.length]!
  }
  const candidates = services.filter(service => {
    const name = tokens(service.name)
    return name.length === input.length && name.some((word, index) => word !== input[index]) &&
      name.every((word, index) => distance(word, input[index]!) <= 2) &&
      name.reduce((sum, word, index) => sum + distance(word, input[index]!), 0) <= 2
  })
  return candidates.length === 1 ? candidates[0]! : null
}

/** Permit a short social draft only; all business facts remain in canonical engine text. */
function safeCopy(draft: string | null | undefined, reply: string, state: DialogueState, message: string, services: readonly DialogueService[]): string | null {
  if (!draft) return null
  const text = normalized(draft).replace(/^[^a-z]+/, '')
  // A date question may repeat only the service already selected by the local catalog engine.
  const selected = state.pending === 'date' && /^¿Para qué día querés/.test(reply) ? services.find(service => service.id === state.serviceId) : undefined
  const safeText = selected && evidenceWords(text).includes(evidenceWords(selected.name))
    ? text.replace(normalized(selected.name), ' ').replace(/\s+/g, ' ').trim() : text
  const safeWords = new Set('hola buenas buen buenos dia dias tardes noches todo muy como estas que te gustaria queres quieres necesitas servicio turno reservar para tu con gusto claro dale perfecto entiendo bien ayudo vamos gracias por supuesto cuento el la un una fecha queda cual preferis seria a nombre de quien llamas podemos ver buscar lo siguiente decime contame puedo'.split(' '))
  if ((safeText.match(/[a-z]+/g) ?? []).some(word => !safeWords.has(word))) return null
  if (/\d|[$€]|https?:|www\.|\b(?:reservad[oa]|confirmad[oa]|confirmamos|agendad[oa]|agendamos|agende|disponible|agotad[oa]|precio|cuesta|sale|gratis|manana|hoy)\b/i.test(text) ||
      services.some(service => evidenceWords(safeText).includes(evidenceWords(service.name)))) return null
  const question = /[?¿]/.test(draft)
  const factualRead = /\b(?:precio|cuanto|sale|servicios|catalogo|horarios|direccion|donde|web|pagina|instagram|facebook|telefono)\b/.test(normalized(message))
  if (!factualRead && state.pending === 'service' && !state.serviceId && services.length && /¿qué servicio necesitás\?/i.test(reply)) {
    if (!/^(?:hola|buenas|buen dia|claro|dale|te ayudo|que servicio)/.test(text)) return null
    if (question) return /\b(?:servicio|turno)\b/.test(text) ? draft : null
    return /^(?:hola|buenas)/.test(text) && /^(?:hola|buenas)/.test(normalized(message)) ? `${draft}\n¿Qué servicio necesitás?` : null
  }
  if (state.pending === 'date' && /^¿Para qué día querés/.test(reply)) {
    return question && /\b(?:dia|fecha)\b/.test(text) && /^(?:claro|dale|perfecto|que dia|para que dia)/.test(text) ? draft : null
  }
  if (state.pending === 'name' && /^¿A nombre de quién/.test(reply)) {
    return question && /\b(?:nombre|llamas)\b/.test(text) ? draft : null
  }
  if (draft.length > 90 || question || !/^(?:hola|claro|dale|perfecto|entiendo|bien|te ayudo|vamos|con gusto|gracias|por supuesto)\b/.test(text)) return null
  return `${draft}\n${reply}`
}

/** AI interprets each enabled QA turn; the deterministic engine remains the only factual and proposal authority. */
export async function respondWithAiInterpreter(
  context: DialogueContext, previous: unknown, message: string, port: DialoguePort,
  provider: AiInterpretationProvider, options: { timeoutMs?: number } = {}
): Promise<InterpretedDialogueResponse> {
  const started = performance.now()
  const state = parseDialogueState(previous, context.businessId, context.timezone)
  const services = await port.catalog()
  const cachedPort = { ...port, catalog: async () => services }
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 2500, 1), 5000)
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let raw: unknown
  let reason: InterpretationDiagnostics['reason'] = null
  const providerStarted = performance.now()
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('interpreter timeout')) }, timeoutMs)
    })
    raw = await Promise.race([provider({ message, state, services }, controller.signal), deadline])
  } catch {
    reason = controller.signal.aborted ? 'timeout' : 'provider_error'
  } finally {
    clearTimeout(timer)
  }
  const providerAt = performance.now()
  let candidate: Candidate | null = null
  if (!reason) {
    try { candidate = validateCandidate(raw, message, services) }
    catch { reason = 'invalid_output' }
  }
  const validationAt = performance.now()
  const professionalMention = candidate?.professionalMention
  const safeProfessionalMention = professionalMention && !/\bcon\s+[a-z]/i.test(normalized(message)) &&
    !/\b(?:no|nunca|sin|soy|llamo|nombre)\b/.test(normalized(message))
  const interpretedMessage = safeProfessionalMention ? message + ' con ' + professionalMention : message
  let response: DialogueResponse
  const typoService = candidate?.serviceId ? null :
    suggestedService(candidate?.serviceEvidence ?? '', services) ?? suggestedService(message, services)
  if (candidate?.serviceId && candidate.serviceEvidence) {
    const service = services.find(s => s.id === candidate.serviceId)!
    if (normalized(candidate.serviceEvidence) !== normalized(service.name)) {
      const partial = await respond(context, state, interpretedMessage, cachedPort)
      // Keep independently stated date/name/professional hint, but never accept a guessed service.
      if (partial.state.serviceId !== state.serviceId) {
        partial.state.serviceId = state.serviceId
        partial.state.professional = state.professional
        partial.state.slot = null
        partial.state.requestedTime = null
      }
      response = { state: partial.state, proposal: null, reply: '¿Te referís a ' + service.name + '? Escribí el nombre del servicio para confirmarlo.' }
    } else {
      response = await respond(context, state, interpretedMessage, cachedPort)
    }

  } else {
    response = await respond(context, state, interpretedMessage, cachedPort)
    if (typoService && !response.state.serviceId) response = { ...response, proposal: null, reply: '¿Te referís a ' + typoService.name + '? Escribí el nombre del servicio para confirmarlo.' }
  }
  const simpleGreeting = /^(?:hola|buenas|buen dia|buenas tardes|buenas noches)(?:\b|$)/.test(normalized(message)) &&
    !/\b(?:servicios|catalogo|precios|cuanto|sale|horarios|direccion)\b/.test(normalized(message))
  const safeReply = simpleGreeting && response.state.pending === 'service' && !response.state.serviceId &&
    /¿qué servicio necesitás\?/i.test(response.reply) && services.length ? 'Hola, ¿qué servicio necesitás?' : response.reply
  const canonicalOnly = response.proposal !== null || Boolean(typoService) || Boolean(candidate?.serviceId && candidate.serviceEvidence && normalized(candidate.serviceEvidence) !== normalized(services.find(s => s.id === candidate.serviceId)?.name ?? ''))
  const authored = !reason && !canonicalOnly ? safeCopy(candidate?.replyDraft, safeReply, response.state, message, services) : null
  const copyReason = reason ? 'canonical_only' : canonicalOnly ? 'canonical_only' : !candidate?.replyDraft ? 'missing_draft' : authored ? null : 'unsafe_draft'
  return { ...response, reply: authored ?? safeReply, interpretation: {
    mode: reason ? 'fallback' : 'ai', reason,
    providerMs: ms(providerAt - providerStarted), validationMs: ms(validationAt - providerAt), totalMs: ms(performance.now() - started),
    copyMode: authored ? 'ai' : 'fallback', copyReason
  } }
}
