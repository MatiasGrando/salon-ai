import { parseDialogueState, respond, type DialogueContext, type DialoguePort, type DialogueResponse, type DialogueService, type DialogueState } from './engine.js'

export type AiInterpretationInput = { message: string; state: DialogueState; services: readonly DialogueService[] }
export type AiInterpretationProvider = (input: AiInterpretationInput, signal: AbortSignal) => Promise<unknown>
export type InterpretationDiagnostics = {
  mode: 'ai' | 'fallback'
  reason: 'provider_error' | 'timeout' | 'invalid_output' | null
  providerMs: number
  validationMs: number
  totalMs: number
}
export type InterpretedDialogueResponse = DialogueResponse & { interpretation: InterpretationDiagnostics }
type Candidate = { intent: 'booking' | 'information' | 'other'; serviceId: string | null; serviceEvidence: string | null; professionalMention: string | null }

const ms = (value: number) => Math.round(value * 10) / 10
const normalized = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
const evidenceWords = (value: string) => ' ' + normalized(value).replace(/[^a-z0-9]+/g, ' ').trim() + ' '
const containsEvidence = (message: string, evidence: string) => evidenceWords(message).includes(evidenceWords(evidence))
function validateCandidate(value: unknown, message: string, services: readonly DialogueService[]): Candidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid AI output')
  const item = value as Record<string, unknown>
  if (Object.keys(item).sort().join(',') !== 'intent,professionalMention,serviceEvidence,serviceId') throw new Error('invalid AI output keys')
  if (!['booking', 'information', 'other'].includes(String(item.intent))) throw new Error('invalid AI intent')
  for (const key of ['serviceId', 'serviceEvidence', 'professionalMention'] as const) {
    if (item[key] !== null && (typeof item[key] !== 'string' || item[key].length < 1 || item[key].length > 128 || /[\u0000-\u001f]/.test(item[key]))) throw new Error('invalid AI field')
  }
  if ((item.serviceId === null) !== (item.serviceEvidence === null)) throw new Error('unpaired AI service')
  if (item.serviceId !== null && (!services.some(s => s.id === item.serviceId) || !containsEvidence(message, item.serviceEvidence as string))) throw new Error('ungrounded AI service')
  if (item.professionalMention !== null && !containsEvidence(message, item.professionalMention as string)) throw new Error('ungrounded AI professional')
  return item as Candidate
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
  }
  return { ...response, interpretation: {
    mode: reason ? 'fallback' : 'ai', reason,
    providerMs: ms(providerAt - providerStarted), validationMs: ms(validationAt - providerAt), totalMs: ms(performance.now() - started)
  } }
}
