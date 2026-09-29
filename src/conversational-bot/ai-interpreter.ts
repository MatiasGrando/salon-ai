import { readAiUsage, type AiUsage } from './ai-usage.js'
import { routeActions } from './actions.js'
import { pendingQuestion } from './information.js'
import { parseDialogueState, respond, type DialogueContext, type DialoguePort, type DialogueResponse, type DialogueService, type DialogueState, type DialogueDecision } from './engine.js'

export type AiInterpretationInput = { message: string; state: DialogueState; services: readonly DialogueService[] }
export type AiResponseInput = { message: string; intent: Candidate['intent']; state: DialogueState; facts: readonly { id: string; text: string }[] }
export type AiResponseProvider = (input: AiResponseInput, signal: AbortSignal) => Promise<unknown>
export type AiInterpretationProvider = ((input: AiInterpretationInput, signal: AbortSignal) => Promise<unknown>) & { respond?: AiResponseProvider }
export type DecisionTrace = {
  proposedIntent: Candidate['intent'] | 'unknown'
  acceptedAction: 'select_service' | 'clarify_service' | 'no_service_change' | 'information_read' | 'pending_action_unavailable' | 'booking_proposal' | 'deterministic_fallback'
  candidateCount: number
  pendingBefore: DialogueState['pending']
  pendingAfter: DialogueState['pending']
  outcome: 'selected' | 'ambiguous' | 'corrected' | 'fallback' | 'unchanged'
  reason: 'validated_service' | 'multiple_catalog_candidates' | 'service_correction' | 'no_service_decision' | 'not_applied' |
    'information_route' | 'pending_action' | 'proposal_only' | 'provider_error' | 'timeout' | 'invalid_output'
}

export type InterpretationDiagnostics = {
  decision: DecisionTrace
  mode: 'ai' | 'fallback'
  reason: 'provider_error' | 'timeout' | 'invalid_output' | null
  providerMs: number
  validationMs: number
  totalMs: number
  copyMode: 'ai' | 'fallback'
  copyReason: 'missing_draft' | 'unsafe_draft' | 'canonical_only' | 'response_error' | 'response_timeout' | 'invalid_response' | null
  engineMs?: number
  responseMs?: number
  usage?: { interpretation: AiUsage | null; response: AiUsage | null }
}
export type InterpretedDialogueResponse = DialogueResponse & { interpretation: InterpretationDiagnostics }
type Candidate = { intent: 'booking' | 'information' | 'other'; serviceId: string | null; serviceEvidence: string | null; professionalMention: string | null; serviceConfidence?: 'certain' | 'uncertain'; serviceCandidateIds?: string[]; serviceCorrection?: boolean }

const ms = (value: number) => Math.round(value * 10) / 10
const normalized = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
const evidenceWords = (value: string) => ' ' + normalized(value).replace(/[^a-z0-9]+/g, ' ').trim() + ' '
const containsEvidence = (message: string, evidence: string) => evidenceWords(message).includes(evidenceWords(evidence))
function validateCandidate(value: unknown, message: string, services: readonly DialogueService[]): Candidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid AI output')
  const item = value as Record<string, unknown>
  if (Object.keys(item).some(key => !['intent','professionalMention','serviceEvidence','serviceId','serviceConfidence','serviceCandidateIds','serviceCorrection'].includes(key)) || !['intent','professionalMention','serviceEvidence','serviceId'].every(key => Object.hasOwn(item,key))) throw new Error('invalid AI output keys')
  if (!['booking', 'information', 'other'].includes(String(item.intent))) throw new Error('invalid AI intent')
  for (const key of ['serviceId', 'serviceEvidence', 'professionalMention'] as const) {
    if (item[key] !== null && (typeof item[key] !== 'string' || item[key].length < 1 || item[key].length > 128 || /[\u0000-\u001f]/.test(item[key]))) throw new Error('invalid AI field')
  }
  if (item.serviceConfidence !== undefined && !['certain', 'uncertain'].includes(String(item.serviceConfidence))) throw new Error('invalid AI confidence')
  if (item.serviceCorrection !== undefined && typeof item.serviceCorrection !== 'boolean') throw new Error('invalid AI correction')
  if (item.serviceCandidateIds !== undefined && (!Array.isArray(item.serviceCandidateIds) || item.serviceCandidateIds.length > 10 || item.serviceCandidateIds.length === 1 ||
      new Set(item.serviceCandidateIds).size !== item.serviceCandidateIds.length ||
      item.serviceCandidateIds.some(id => typeof id !== 'string' || !services.some(s => s.id === id)))) throw new Error('invalid AI candidates')
  if (Array.isArray(item.serviceCandidateIds) && item.serviceCandidateIds.length && (item.serviceId !== null || item.serviceEvidence === null)) throw new Error('invalid AI candidate evidence')
  if (item.serviceCorrection === true && item.serviceEvidence === null) throw new Error('invalid AI correction evidence')
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

function responseFacts(reply: string, state: DialogueState, intent: Candidate['intent'] | null, message: string): { id: string; text: string }[] {
  if (intent === 'other' && state.pending === 'service' && !state.serviceId &&
      reply === '¿En qué te puedo ayudar con el local?') return []
  const lines = reply.split('\n').map(line => line.trim()).filter(Boolean)
  const catalogRequested = /\b(?:servicios|cat[aá]logo|lista|precios)\b/i.test(message)
  // The deterministic menu is a fallback, not a fact that must be dumped after social messages.
  if (state.pending === 'service' && !state.serviceId && !catalogRequested && (reply.startsWith('¿Qué servicio necesitás?\n') || reply.startsWith('Hola. Te ayudo con tu turno.\n¿Qué servicio necesitás?') || reply === 'Hola, ¿qué servicio necesitás?'))
    return intent === 'other' ? [] : [{ id: 'next', text: '¿Qué servicio necesitás?' }]
  const pending = pendingQuestion(state)
  if (lines.at(-1) === pending && lines.length > 1) lines.pop()
  return lines.map((text, index) => ({ id: String(index), text }))
}
function assembledReply(raw: unknown, facts: readonly { id: string; text: string }[], services: readonly DialogueService[]): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).sort().join(',') !== 'closing,factIds,opening' || !Array.isArray(value.factIds)) return null
  if (value.factIds.length !== facts.length || new Set(value.factIds).size !== facts.length ||
      value.factIds.some(id => typeof id !== 'string' || !facts.some(fact => fact.id === id))) return null
  const framing = [value.opening, value.closing]
  if (framing.some(part => part !== null && (typeof part !== 'string' || part.length > 180 ||
      /[\u0000-\u001f\d$€]|https?:|www\./i.test(part)))) return null
  // Catalog entities may appear only in server-inserted facts, never in free model text.
  if (framing.some(part => typeof part === 'string' && services.some(service => evidenceWords(part).includes(evidenceWords(service.name))))) return null
  // Free style is allowed, but unverified business assertions and actions are never accepted in the frame.
  if (framing.some(part => typeof part === 'string' && /\b(?:reserve|agende|confirme|guarde|reservado|agendado|confirmado|disponible|agotado|gratis)\b/.test(normalized(part)))) return null
  const text = [value.opening, ...value.factIds.map(id => facts.find(fact => fact.id === id)!.text), value.closing]
    .filter(part => typeof part === 'string' && part.trim()).join('\n')
  return text.length > 0 && text.length <= 5000 ? text : null
}

/** QA only: interpret, let the deterministic engine establish facts, then compose from verified fact IDs. */
export async function respondWithAiInterpreter(
  context: DialogueContext, previous: unknown, message: string, port: DialoguePort,
  provider: AiInterpretationProvider, options: { timeoutMs?: number; responseProvider?: AiResponseProvider } = {}
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
    raw = await Promise.race([
      provider({ message, state, services }, controller.signal),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('interpreter timeout')) }, timeoutMs) })
    ])
  } catch { reason = controller.signal.aborted ? 'timeout' : 'provider_error' }
  finally { clearTimeout(timer) }
  const providerAt = performance.now()
  let candidate: Candidate | null = null
  if (!reason) {
    try { candidate = validateCandidate(raw, message, services) }
    catch { reason = 'invalid_output' }
  }
  const validationAt = performance.now()
  const selected = candidate?.serviceId ? services.find(s => s.id === candidate.serviceId) : undefined
  const evidence = candidate?.serviceEvidence ?? ''
  // Compare only grounded service evidence with catalog names, never the full utterance.
  const evidenceTerms = evidenceWords(evidence).trim().split(' ').filter(word => word && !['un', 'una', 'el', 'la', 'de', 'del'].includes(word))
  const overlap = evidenceTerms.length ? services.filter(service => {
    const nameTerms = evidenceWords(service.name).trim().split(' ')
    return evidenceTerms.every(term => nameTerms.includes(term))
  }) : []
  // A model-proposed subset cannot hide other catalog matches for the same grounded phrase.
  const candidates = overlap.length > 1 ? overlap : candidate?.serviceCandidateIds?.length
    ? services.filter(service => candidate.serviceCandidateIds!.includes(service.id)) : []
  const uncertain = Boolean(selected && !candidates.length &&
    candidate?.serviceConfidence !== 'certain' && normalized(evidence) !== normalized(selected.name))
  const decision: DialogueDecision | undefined = candidate ? {
    serviceId: uncertain || candidates.length ? null : selected?.id ?? null,
    candidateIds: candidates.map(service => service.id), correction: candidate.serviceCorrection === true ||
      Boolean(state.serviceId && (candidates.length && !candidates.some(service => service.id === state.serviceId) ||
        selected && selected.id !== state.serviceId))
  } : undefined
  const engineStarted = performance.now()
  let response = await respond(context, state, message, cachedPort, decision)
  if (uncertain && selected) response = { ...response, proposal: null,
    reply: '¿Te referís a ' + selected.name + '? Confirmame cuál servicio querés.' }
  const typoService = candidate?.serviceId || candidates.length ? null :
    candidate?.serviceEvidence ? suggestedService(candidate.serviceEvidence, services) :
    !candidate ? suggestedService(message, services) : null
  if (typoService && !response.state.serviceId) response = { ...response, proposal: null,
    reply: '¿Te referís a ' + typoService.name + '? Confirmame cuál servicio querés.' }
  const engineAt = performance.now()
  const simpleGreeting = /^(?:hola|buenas|buen dia|buenas tardes|buenas noches)(?:\b|$)/.test(normalized(message))
  const defaultServiceMenu = response.state.pending === 'service' && !response.state.serviceId &&
    !/\b(?:servicios|cat[aá]logo|lista|precios)\b/i.test(message) &&
    /^(?:Hola\. Te ayudo con tu turno\.\n)?¿Qué servicio necesitás\?\n/.test(response.reply)
  const safeReply = defaultServiceMenu && candidate?.intent === 'other' ? '¿En qué te puedo ayudar con el local?'
    : defaultServiceMenu ? (simpleGreeting ? 'Hola, ¿qué servicio necesitás?' : '¿Qué servicio necesitás?') : response.reply
  const canonicalOnly = response.proposal !== null || Boolean(typoService) || uncertain
  const responseProvider = options.responseProvider ?? provider.respond
  let authored: string | null = null
  let copyReason: InterpretationDiagnostics['copyReason'] = 'canonical_only'
  let responseMs = 0
  let responseUsage: AiUsage | null = null
  if (!reason && !canonicalOnly && responseProvider) {
    const facts = responseFacts(safeReply, response.state, candidate?.intent ?? null, message)
    const responseController = new AbortController()
    let responseTimer: ReturnType<typeof setTimeout> | undefined
    const responseStarted = performance.now()
    try {
      const output = await Promise.race([
        responseProvider({ message, intent: candidate!.intent, state: response.state, facts }, responseController.signal),
        new Promise<never>((_resolve, reject) => { responseTimer = setTimeout(() => { responseController.abort(); reject(new Error('response timeout')) }, timeoutMs) })
      ])
      responseUsage = readAiUsage(output)
      authored = assembledReply(output, facts, services)
      copyReason = authored ? null : 'invalid_response'
    } catch { copyReason = responseController.signal.aborted ? 'response_timeout' : 'response_error' }
    finally { clearTimeout(responseTimer); responseMs = ms(performance.now() - responseStarted) }
  } else if (!reason && !canonicalOnly && !responseProvider) {
    // Legacy one-call test callers retain the existing canonical fallback; QA runtime supplies a second call.
    copyReason = 'missing_draft'
  }
  // Only fixed codes, counts and workflow states leave this function as QA decision diagnostics.
  // Never copy model evidence, catalog IDs/names, chat text or provider output into metadata.
  const route = routeActions(message)
  const decisionTrace: DecisionTrace = {
    proposedIntent: candidate?.intent ?? 'unknown',
    candidateCount: candidates.length || (selected ? 1 : 0),
    pendingBefore: state.pending,
    pendingAfter: response.state.pending,
    acceptedAction: reason ? 'deterministic_fallback' : candidates.length > 1 || uncertain ? 'clarify_service'
      : decision?.serviceId && response.state.serviceId === decision.serviceId && state.serviceId !== response.state.serviceId
        ? 'select_service' : response.proposal ? 'booking_proposal' : route.pendingAction ? 'pending_action_unavailable'
          : route.information.length ? 'information_read' : 'no_service_change',
    outcome: reason ? 'fallback' : decision?.correction ? 'corrected' : candidates.length > 1 || uncertain ? 'ambiguous'
      : decision?.serviceId && response.state.serviceId === decision.serviceId && state.serviceId !== response.state.serviceId
        ? 'selected' : 'unchanged',
    reason: reason ?? (decision?.correction ? 'service_correction' : candidates.length > 1 ? 'multiple_catalog_candidates'
      : uncertain ? 'not_applied' : decision?.serviceId && response.state.serviceId === decision.serviceId
        ? 'validated_service' : decision?.serviceId ? 'not_applied' : response.proposal ? 'proposal_only'
          : route.pendingAction ? 'pending_action' : route.information.length ? 'information_route' : 'no_service_decision')
  }
  return { ...response, reply: authored ?? safeReply, interpretation: {
    decision: decisionTrace,
    mode: reason ? 'fallback' : 'ai', reason,
    providerMs: ms(providerAt - providerStarted), validationMs: ms(validationAt - providerAt),
    engineMs: ms(engineAt - engineStarted), responseMs, totalMs: ms(performance.now() - started),
    usage: { interpretation: readAiUsage(raw), response: responseUsage },
    copyMode: authored ? 'ai' : 'fallback', copyReason
  } }
}