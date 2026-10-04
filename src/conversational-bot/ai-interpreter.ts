import { replyContract, validateReplyDraft, skippedReplyValidation, type ReplyContract, type ReplyValidationResult, type ReplyValidationTrace } from './reply-contract.js'
import { parseIncidentalArithmetic } from './incidental-arithmetic.js'
import { matchNamedItems } from './contextual-matching.js'
import { expectedDialogueAnswer, rememberDialogueQuestion } from './dialogue-context.js'
import { localDateKey } from '../bot-options/application/availability-queries.js'
import { readAiUsage, type AiUsage } from './ai-usage.js'
import { resolveConversationalAiTimeoutMs } from './ai-timeout.js'
import { providerFailure, type ProviderFailure } from './provider-error.js'
import { summarizeAvailability, summarizeProposal, summarizeValidation, summarizeState, type ProposalSummary, type ValidationSummary, type StateSummary } from './ai-diagnostics.js'
import { routeActions } from './actions.js'
import { parseTurnPlan, TurnPlanValidationError, type TurnPlan } from './turn-plan.js'
import { groundServicePlan, serviceEvidenceMeaning } from './service-evidence-grounding.js'
import { BASKET_LIMITS, applyBasketMutation, basketServiceIds, selectionBasket, type BasketMemberProposal } from './service-basket.js'
import { serviceGuidance, guidanceDelivery, resolveGuidance } from './service-guidance.js'
import { pendingQuestion, validateFacts } from './information.js'
import { parseInformationTarget } from './information-contract.js'
import { inferInformationTarget, readInformation, informationReply } from './information-read.js'
import { fallbackIndependentTurnPlan, finalizeDialogueIntroduction, parseDialogueState, respond, socialQuestion, hasActiveBooking, type DialogueContext, type DialoguePort, type DialogueResponse, type DialogueService, type DialogueState, type DialogueDecision, type InformationTarget } from './engine.js'

export type ReplyFact = import('./reply-contract.js').ReplyFact
export type AiInterpretationInput = { message: string; state: DialogueState; services: readonly DialogueService[]; businessDate?: string; timezone?: string; firstReplyFacts?: readonly ReplyFact[]; replyContract?: ReplyContract; intakeReplyAllowed?: boolean; expectedAnswer?: ReturnType<typeof expectedDialogueAnswer> }
export type AiResponseInput = { message: string; intent: Candidate['intent']; state: DialogueState; facts: readonly ReplyFact[]; replyContract?: ReplyContract }
export type AiResponseProvider = (input: AiResponseInput, signal: AbortSignal) => Promise<unknown>
export type AiInterpretationProvider = ((input: AiInterpretationInput, signal: AbortSignal) => Promise<unknown>) & { respond?: AiResponseProvider }
export type DecisionTrace = {
  proposedIntent: Candidate['intent'] | 'unknown'
  acceptedAction: 'select_service' | 'clarify_service' | 'no_service_change' | 'information_read' | 'pending_action_unavailable' | 'booking_proposal' | 'turn_plan_routed' | 'deterministic_fallback'
  candidateCount: number
  pendingBefore: DialogueState['pending']
  pendingAfter: DialogueState['pending']
  outcome: 'selected' | 'ambiguous' | 'corrected' | 'fallback' | 'unchanged'
  reason: 'validated_service' | 'multiple_catalog_candidates' | 'service_correction' | 'no_service_decision' | 'not_applied' |
    'information_route' | 'pending_action' | 'proposal_only' | 'turn_plan' | 'provider_error' | 'timeout' | 'invalid_output'
}

export type InterpretationDiagnostics = {
  decision: DecisionTrace
  replyValidation?: ReplyValidationTrace
  mode: 'ai' | 'fallback'
  reason: 'provider_error' | 'timeout' | 'invalid_output' | null
  providerMs: number
  validationMs: number
  totalMs: number
  deliveryOrigin?: 'forced' | 'prepared' | 'validated_framing' | 'validated_canonical' | 'server_fallback'
  copyMode: 'ai' | 'prepared' | 'fallback'
  copyReason: 'missing_draft' | 'unsafe_draft' | 'canonical_only' | 'response_error' | 'response_timeout' | 'invalid_response' | null
  proposal?: ProposalSummary
  validation?: ValidationSummary
  stateBefore?: StateSummary
  stateAfter?: StateSummary
  availability?: DialogueResponse['availability']
  turnOutcome?: DialogueResponse['turnOutcome']
  interpretationProviderError?: ProviderFailure | null
  responseProviderError?: ProviderFailure | null
  aiCalls?: number
  replyRoute?: 'first_call' | 'second_call' | 'motor'
  engineMs?: number
  responseMs?: number
  usage?: { interpretation: AiUsage | null; response: AiUsage | null }
}
export type InterpretedDialogueResponse = DialogueResponse & { interpretation: InterpretationDiagnostics }
type Candidate = { intent: 'booking' | 'information' | 'other'; serviceId: string | null; serviceEvidence: string | null; professionalMention: string | null; serviceConfidence?: 'certain' | 'uncertain'; serviceCandidateIds?: string[]; serviceCorrection?: boolean; firstReply?: unknown; intakeReply?: unknown; informationTarget?: InformationTarget | null; turnPlan?: TurnPlan | null }

const ms = (value: number) => Math.round(value * 10) / 10
const normalized = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
const evidenceWords = (value: string) => ' ' + normalized(value).replace(/[^a-z0-9]+/g, ' ').trim() + ' '
const containsEvidence = (message: string, evidence: string) => evidenceWords(message).includes(evidenceWords(evidence))
function validateCandidate(value: unknown, message: string, services: readonly DialogueService[], state: DialogueState): Candidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid AI output')
  const item = value as Record<string, unknown>
  if (Object.keys(item).some(key => !['intent','professionalMention','serviceEvidence','serviceId','serviceConfidence','serviceCandidateIds','serviceCorrection','firstReply','intakeReply','informationTarget','turnPlan'].includes(key)) || !['intent','professionalMention','serviceEvidence','serviceId'].every(key => Object.hasOwn(item,key))) throw new Error('invalid AI output keys')
  if (!['booking', 'information', 'other'].includes(String(item.intent))) throw new Error('invalid AI intent')
  let turnPlan: TurnPlan | null | undefined
  if (Object.hasOwn(item, 'turnPlan')) {
    if (item.turnPlan === null) turnPlan = null
    else {
      try {
        const parsed = parseTurnPlan(groundServicePlan(item.turnPlan, message, services), message, services.map(service => service.id))
        turnPlan = parseTurnPlan({ ...parsed, operations: parsed.operations.map(operation => {
          if (operation.kind === 'basket') {
            const current = selectionBasket(state)
            if (operation.targetMemberIds.some(id => !current.members.some(member => member.memberId === id))) throw new TurnPlanValidationError('conflict')
            return { ...operation, members: operation.members.map(member => groundedBasketMember(member, services, message, operation.mutation === 'replace' && operation.scope === 'all' && operation.members.length === 1 ? current.members.filter(member => member.mode === 'single').flatMap(member => member.serviceIds) : [])) }
          }
          if (operation.kind !== 'service' || operation.mode === 'multiple') return operation
          const matches = catalogEvidenceMatches(serviceEvidenceMeaning(operation.evidence, services), services)
          // A model-proposed single/subset cannot hide other matches for its grounded phrase.
          return matches.length > 1 ? { ...operation, mode: 'alternatives' as const, serviceIds: matches.map(service => service.id) } : operation
        }) }, message, services.map(service => service.id))
        validateEstimateOperations(turnPlan, state, services)
      } catch (error) { throw new TurnPlanValidationError(error instanceof TurnPlanValidationError ? error.validationCause : 'shape') }
    }
  }
  for (const key of ['serviceId', 'serviceEvidence', 'professionalMention'] as const) {
    if (item[key] !== null && (typeof item[key] !== 'string' || item[key].length < 1 || item[key].length > 128 || /[\u0000-\u001f]/.test(item[key]))) throw new Error('invalid AI field')
  }
  if (item.serviceConfidence !== undefined && !['certain', 'uncertain'].includes(String(item.serviceConfidence))) throw new Error('invalid AI confidence')
  if (item.serviceCorrection !== undefined && typeof item.serviceCorrection !== 'boolean') throw new Error('invalid AI correction')
  // Plan and legacy entities must not offer competing representations, even for an empty plan.
  if (turnPlan) {
    if (item.serviceId !== null || item.serviceEvidence !== null || item.professionalMention !== null ||
        item.serviceCorrection === true || item.informationTarget != null ||
        item.serviceCandidateIds !== undefined && (!Array.isArray(item.serviceCandidateIds) || item.serviceCandidateIds.length > 0)) throw new TurnPlanValidationError('conflict')
    return { ...item, turnPlan } as Candidate
  }
  if (item.serviceCandidateIds !== undefined && (!Array.isArray(item.serviceCandidateIds) || item.serviceCandidateIds.length > 10 || item.serviceCandidateIds.length === 1 ||
      new Set(item.serviceCandidateIds).size !== item.serviceCandidateIds.length ||
      item.serviceCandidateIds.some(id => typeof id !== 'string' || !services.some(s => s.id === id)))) throw new Error('invalid AI candidates')
  if (Array.isArray(item.serviceCandidateIds) && item.serviceCandidateIds.length && (item.serviceId !== null || item.serviceEvidence === null)) throw new Error('invalid AI candidate evidence')
  if (item.serviceCorrection === true && item.serviceEvidence === null) throw new Error('invalid AI correction evidence')
  if (item.serviceId !== null && item.serviceEvidence === null) throw new Error('missing service evidence')
  if (item.serviceId === null && item.serviceEvidence !== null && !containsEvidence(message, item.serviceEvidence as string)) throw new Error('ungrounded service evidence')
  if (item.serviceId !== null && !services.some(s => s.id === item.serviceId)) throw new Error('service not in catalog')
  if (item.serviceId !== null && !containsEvidence(message, item.serviceEvidence as string)) throw new Error('ungrounded AI service')
  if (item.professionalMention !== null && !containsEvidence(message, item.professionalMention as string)) throw new Error('ungrounded AI professional')
  if (item.informationTarget !== undefined && item.informationTarget !== null) {
    if (item.intent !== 'information') throw new Error('invalid AI information target')
    const target = parseInformationTarget(item.informationTarget, services.map(service => service.id))
    item.informationTarget = target
    if (target.kind === 'professional' && target.mention && !containsEvidence(message, target.mention)) throw new Error('ungrounded AI professional information')
    if (item.serviceId !== null || item.serviceEvidence !== null || item.professionalMention !== null ||
      item.serviceCorrection === true || Array.isArray(item.serviceCandidateIds) && item.serviceCandidateIds.length) throw new Error('conflicting AI information target')
  }
  return item as Candidate
}

/** Project only the bounded selection; the motor independently applies it and authorizes fresh agenda use. */
function validateEstimateOperations(plan: TurnPlan, state: DialogueState, services: readonly DialogueService[]): void {
  if (!plan.operations.some(operation => operation.kind === 'estimate')) return
  let basket = selectionBasket(state)
  const basketOp = plan.operations.find(operation => operation.kind === 'basket')
  const serviceOp = plan.operations.find(operation => operation.kind === 'service')
  if (basketOp?.kind === 'basket') basket = applyBasketMutation(basket, basketOp).basket
  else if (serviceOp?.kind === 'service' && (serviceOp.mode !== 'unresolved' || serviceOp.correction || !basket.members.length)) {
    const group = serviceOp.mode === 'single' && !serviceOp.correction ? basket.members.find(member => member.mode === 'alternatives' && member.serviceIds.includes(serviceOp.serviceIds[0]!)) : null
    const repeated = serviceOp.mode === 'single' && !serviceOp.correction && basket.members.length > 1 && basketServiceIds(state).includes(serviceOp.serviceIds[0]!)
    if (!repeated) basket = applyBasketMutation(basket, { kind: 'basket', mutation: group ? 'replace' : 'set', scope: group ? 'members' : 'all', targetMemberIds: group ? [group.memberId] : [],
      members: serviceOp.mode === 'multiple' ? serviceOp.serviceIds.map(id => ({ mode: 'single', serviceIds: [id], evidence: serviceOp.evidence, confidence: serviceOp.confidence }))
        : [{ mode: serviceOp.mode, serviceIds: serviceOp.serviceIds, evidence: serviceOp.evidence, confidence: serviceOp.confidence }], evidence: serviceOp.evidence, confidence: serviceOp.confidence }).basket
  }
  const exactIds = basket.members.filter(member => member.mode === 'single').flatMap(member => member.serviceIds)
  for (const operation of plan.operations) {
    if (operation.kind !== 'estimate') continue
    const service = services.find(item => item.id === operation.serviceId)
    if (!exactIds.includes(operation.serviceId) || !service) throw new TurnPlanValidationError('estimate')
    const guide = serviceGuidance(service)
    if (guide.kind !== 'guided' || operation.optionId !== null && !guide.policy.estimateOptions?.some(option => option.id === operation.optionId)) throw new TurnPlanValidationError('estimate')
  }
}
function catalogEvidenceMatches(evidence: string, services: readonly DialogueService[]): DialogueService[] {
  const terms = evidenceWords(evidence).trim().split(' ').filter(term => term && !['un', 'una', 'el', 'la', 'de', 'del'].includes(term))
  return terms.length ? services.filter(service => {
    const nameTerms = evidenceWords(service.name).trim().split(' ')
    return terms.every(term => nameTerms.includes(term))
  }) : []
}
/** Resolve ambiguity per member; an exact companion service is never swallowed by a generic phrase. */
function groundedBasketMember(member: BasketMemberProposal, services: readonly DialogueService[], message: string, retainedIds: readonly string[] = []): BasketMemberProposal {
  const meaning = serviceEvidenceMeaning(member.evidence, services)
  // Resolve an unambiguous retained-member reference before widening to catalog variants.
  const retained = catalogEvidenceMatches(meaning, services.filter(service => retainedIds.includes(service.id)))
  if (member.confidence >= 0.85 && retained.length === 1 && member.serviceIds.includes(retained[0]!.id) &&
      !/[?¿]/.test(message) && !/\b(no|ni|sin|o)\b/.test(normalized(message))) return { ...member, mode: 'single', serviceIds: [retained[0]!.id] }
  // Only a closed standalone full catalog label overrides a spurious model group.
  // A fragment inside negation, alternatives or a multi-entity request is not a closed selection.
  const exact = services.filter(service => evidenceWords(service.name) === evidenceWords(meaning))
  if (member.mode === 'alternatives' && member.confidence >= 0.85 && !/[?¿]/.test(message) && evidenceWords(serviceEvidenceMeaning(message, services)) === evidenceWords(meaning) &&
      exact.length === 1 && member.serviceIds.includes(exact[0]!.id)) return { ...member, mode: 'single', serviceIds: [exact[0]!.id] }
  let matches = catalogEvidenceMatches(meaning, services)
  // A genuinely ambiguous model group supplies catalog anchors, not a business-specific synonym table.
  // Unknown surrounding words cannot hide related variants sharing the grounded category anchor.
  if (matches.length < 2 && member.mode === 'alternatives') {
    const proposed = services.filter(service => member.serviceIds.includes(service.id))
    const evidence = evidenceWords(meaning).trim().split(' ')
    const meaningful = (name: string) => evidenceWords(name).trim().split(' ').filter(term => !['un', 'una', 'el', 'la', 'de', 'del', 'y'].includes(term))
    const anchors = [...new Set(proposed.flatMap(service => meaningful(service.name)))].filter(term => evidence.includes(term))
    if (anchors.length) matches = services.filter(service => anchors.every(term => meaningful(service.name).includes(term)))
  }
  if (matches.length > BASKET_LIMITS.candidates) throw new TurnPlanValidationError('catalog')
  return matches.length > 1 ? { ...member, mode: 'alternatives', serviceIds: matches.map(service => service.id) } : member
}
/** A unique near-match may only produce a question; it is never a service selection. */
function suggestedService(evidence: string, services: readonly DialogueService[]): DialogueService | null {
  const result = matchNamedItems({ businessId: 'retrieval', category: 'service' }, evidence, services)
  return result.kind === 'candidates' && result.items.length === 1 ? services.find(service => service.id === result.items[0]!.id) ?? null : null
}
function responseFacts(reply: string, state: DialogueState, intent: Candidate['intent'] | null, message: string): { id: string; text: string }[] {
  if (intent === 'other' && state.pending === 'service' && !state.serviceId &&
      reply === '¿En qué te puedo ayudar con el local?') return [{ id: 'next', text: reply }]
  // Build material labels and their exact delivery chunks together: whitespace-only rows
  // belong to the preceding chunk, never an extra fact that shifts later material IDs.
  const lines: string[] = [], chunks: string[] = []
  for (const row of reply.trim().split('\n')) {
    if (row.trim()) { lines.push(row.trim()); chunks.push(row) }
    else if (chunks.length) chunks[chunks.length - 1] += '\n' + row
  }
  const catalogRequested = /\b(?:servicios|cat[aá]logo|lista|precios)\b/i.test(message)
  // The deterministic menu is a fallback, not a fact that must be dumped after social messages.
  if (state.pending === 'service' && !state.serviceId && !catalogRequested && (reply.startsWith('¿Qué servicio necesitás?\n') || reply.startsWith('Hola. Te ayudo con tu turno.\n¿Qué servicio necesitás?') || reply === 'Hola, ¿qué servicio necesitás?'))
    return intent === 'other' ? [] : [{ id: 'next', text: '¿Qué servicio necesitás?' }]
  const lastQuestion = lines.at(-1)?.match(/¿[^?]+\?$/)?.[0]
  const pending = state.questionContext?.field === state.pending && lastQuestion === state.questionContext.question ? state.questionContext.question : pendingQuestion(state)
  if (lines.at(-1) === pending && lines.length > 1 && !hasActiveBooking(state)) lines.pop()
  return lines.map((text, index) => ({ id: text.endsWith(pending) && index === lines.length - 1 ? 'next' : String(index), text: chunks[index]! }))
}
/** Predict only an intake step; all questions and catalog alternatives remain server facts. */
function assembledIntakeReply(raw: unknown, facts: readonly ReplyFact[], state: DialogueState,
  candidates: readonly DialogueService[], services: readonly DialogueService[], contract: ReplyContract): ReplyValidationResult {
  const mismatch = (): ReplyValidationResult => ({ text: null, modelFraming: false, validation: { status: 'rejected', reason: 'intake_mismatch', factCount: Math.min(facts.length, 101), providedCount: 0 } })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return mismatch()
  const value = raw as Record<string, unknown>
  if (Object.keys(value).sort().join(',') !== 'candidateIds,closing,opening,pending,serviceId' ||
      !['service', 'date'].includes(String(value.pending)) || value.pending !== state.pending ||
      value.serviceId !== state.serviceId || !Array.isArray(value.candidateIds) ||
      value.candidateIds.some(id => typeof id !== 'string') ||
      JSON.stringify([...value.candidateIds].sort()) !== JSON.stringify(candidates.map(service => service.id).sort())) return mismatch()
  return validateReplyDraft({ opening: value.opening, closing: value.closing, factIds: facts.map(fact => fact.id) }, facts, contract, services.map(service => service.name))
}

/** Interpret, let the deterministic engine establish facts, then compose from verified fact IDs. */
export async function respondWithAiInterpreter(
  context: DialogueContext, previous: unknown, message: string, port: DialoguePort,
  provider: AiInterpretationProvider, options: { timeoutMs?: number; responseProvider?: AiResponseProvider } = {}
): Promise<InterpretedDialogueResponse> {
  const started = performance.now()
  const state = parseDialogueState(previous, context.businessId, context.timezone)
  const services = await port.catalog()
  const route = routeActions(message)
  const pureInformation = route.information.length > 0 && !route.bookingMessage && !route.pendingAction
  const intakeReplyAllowed = !route.information.length && !route.pendingAction
  const arithmetic = intakeReplyAllowed ? parseIncidentalArithmetic(message)?.text ?? null : null
  const incidentalFacts: ReplyFact[] | null = arithmetic ? [{ id: 'calculation', text: arithmetic },
    { id: 'next', text: state.pending === 'service' && !hasActiveBooking(state) ? '¿En qué te puedo ayudar con el local?' : socialQuestion(state) }] : null
  let firstReplyFacts: ReplyFact[] | undefined = intakeReplyAllowed ? incidentalFacts ??
    (state.pending === 'service' && !hasActiveBooking(state) ? [{ id: 'next', text: '¿En qué te puedo ayudar con el local?' }] : [{ id: socialQuestion(state) === pendingQuestion(state) ? 'next' : '0', text: socialQuestion(state) }]) : undefined
  if (intakeReplyAllowed && state.pending === 'estimate' && !state.editRequest) {
    const target = state.questionContext?.targetServiceId ?? resolveGuidance(services.filter(service => basketServiceIds(state).includes(service.id)), state.serviceEstimates).pending?.id
    const guided = services.find(service => service.id === target)
    if (guided) firstReplyFacts = guidanceDelivery(guided, context.businessId).facts
  }
  let preparedInformation = false
  let informationPreparationFailed = false
  let availabilityCalls = 0
  const cachedPort: DialoguePort = { ...port, catalog: async () => services,
    availability: async (...args) => { availabilityCalls++; return port.availability(...args) },
    ...(port.availabilityBasket ? { availabilityBasket: async (...args: Parameters<NonNullable<DialoguePort['availabilityBasket']>>) => { availabilityCalls++; return port.availabilityBasket!(...args) } } : {}) }
  if (port.information) {
    const cache = new Map<string, Promise<import('./information.js').BusinessFacts>>()
    cachedPort.information = actions => {
      const key = JSON.stringify(actions ?? null)
      if (!cache.has(key)) cache.set(key, port.information!(actions).then(facts => { validateFacts(facts, context.businessId); return facts }).catch(error => {
        if (error instanceof Error && /scope|invalid public facts/.test(error.message)) throw new Error('public information unavailable')
        throw error
      }))
      return cache.get(key)!
    }
  }
  const informationTarget = inferInformationTarget(state, message, services)
  // A focus-only read can be inferred even when the clause router leaves the text unclassified.
  // inferInformationTarget already excludes explicit booking; mixed classified booking still waits for the motor.
  if ((pureInformation || informationTarget && !route.pendingAction && (!route.bookingMessage || !route.information.length)) && !(state.dialogueContext?.presentedOffer && route.information.includes('HOURS'))) {
    if (informationTarget && informationTarget.kind !== 'presented_offer') {
      const read = await readInformation(context, state, message, cachedPort, informationTarget, services)
      preparedInformation = !read.failed
      informationPreparationFailed = read.failed === true
      firstReplyFacts = read.failed ? undefined : responseFacts(informationReply(read, state, hasActiveBooking(state)), state, 'information', message)
      if (firstReplyFacts && (firstReplyFacts.length > 100 || firstReplyFacts.some(fact => fact.text.length > 1000))) firstReplyFacts = undefined
    }
  }
  const timeoutMs = resolveConversationalAiTimeoutMs(options.timeoutMs)
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let raw: unknown
  let reason: InterpretationDiagnostics['reason'] = null
  let interpretationProviderError: ProviderFailure | null = null
  const providerStarted = performance.now()
  try {
    raw = await Promise.race([
      provider({ message, state, services, expectedAnswer: expectedDialogueAnswer(state), businessDate: localDateKey(context.dbNow, context.timezone), timezone: context.timezone, replyContract: replyContract(preparedInformation || pureInformation ? 'information' : hasActiveBooking(state) ? 'continuation' : 'social', Boolean(port.identity), state.introduced === true, firstReplyFacts ?? []), intakeReplyAllowed, ...(firstReplyFacts !== undefined ? { firstReplyFacts } : {}) }, controller.signal),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('interpreter timeout')) }, timeoutMs) })
    ])
  } catch (error) {
    reason = controller.signal.aborted ? 'timeout' : 'provider_error'
    interpretationProviderError = controller.signal.aborted
      ? { code: 'timeout', httpStatus: null, requestId: null } : providerFailure(error)
  } finally { clearTimeout(timer) }
  const providerAt = performance.now()
  let candidate: Candidate | null = null
  let validationError: unknown
  if (!reason) {
    try { candidate = validateCandidate(raw, message, services, state) }
    catch (error) { validationError = error; reason = 'invalid_output' }
  }
  const proposal = summarizeProposal(raw)
  const validation = summarizeValidation(proposal, candidate !== null, validationError, interpretationProviderError === null)
  const validationAt = performance.now()
  const turnPlan = candidate?.turnPlan
  const serviceOperation = turnPlan?.operations.find(operation => operation.kind === 'service')
  const selectedId = turnPlan ? serviceOperation?.mode === 'single' ? serviceOperation.serviceIds[0] : null : candidate?.serviceId
  const selected = selectedId ? services.find(service => service.id === selectedId) : undefined
  const evidence = serviceOperation?.evidence ?? candidate?.serviceEvidence ?? ''
  // Compare only grounded service evidence with catalog names, never the full utterance.
  const overlap = turnPlan ? [] : catalogEvidenceMatches(evidence, services)
  // A model-proposed subset cannot hide other catalog matches for the same grounded phrase.
  const candidates = turnPlan ? serviceOperation?.mode === 'alternatives'
    ? services.filter(service => serviceOperation.serviceIds.includes(service.id)) : []
    : overlap.length > 1 ? overlap : candidate?.serviceCandidateIds?.length
    ? services.filter(service => candidate.serviceCandidateIds!.includes(service.id)) : []
  const uncertain = !turnPlan && Boolean(selected && !candidates.length &&
    candidate?.serviceConfidence !== 'certain' && normalized(evidence) !== normalized(selected.name))
  // A failed semantic turn must not lexically reinterpret or partially overwrite an existing basket.
  const safeBasketFallback = Boolean(reason && state.basket?.members.length)
  const decision: DialogueDecision | undefined = safeBasketFallback ? { serviceId: null, candidateIds: [], correction: false, turnPlan: fallbackIndependentTurnPlan(context, state, message, services) } : candidate ? turnPlan ? { intent: candidate.intent, turnPlan, serviceId: null, candidateIds: [], correction: false } : {
    intent: candidate.intent, serviceId: uncertain || candidates.length ? null : selected?.id ?? null,
    candidateIds: candidates.map(service => service.id), professionalMention: candidate.professionalMention, ...(candidate.informationTarget !== undefined ? { informationTarget: candidate.informationTarget } : {}), correction: candidate.serviceCorrection === true ||
      Boolean(state.serviceId && (candidates.length && !candidates.some(service => service.id === state.serviceId) ||
        selected && selected.id !== state.serviceId))
  } : undefined
  const engineStarted = performance.now()
  let response = await respond(context, state, message, cachedPort, decision, { deferIntroduction: true })
  if (uncertain && selected && !response.state.informationFocus) {
    const question = '¿Te referís a ' + selected.name + '?'
    response.state.pending = 'service'; response.state.slot = null
    rememberDialogueQuestion(response.state, question, [{ id: selected.id, label: selected.name }], null, { candidateIds: [selected.id] })
    response = { ...response, proposal: null, reply: question + ' Confirmame cuál servicio querés.' }
  }
  const typoService = safeBasketFallback || turnPlan || candidate?.serviceId || candidates.length ? null :
    candidate?.serviceEvidence ? suggestedService(candidate.serviceEvidence, services) :
    !candidate ? suggestedService(message, services) : null
  if (typoService && !response.state.serviceId && !response.state.informationFocus) {
    const question = '¿Te referís a ' + typoService.name + '?'
    response.state.pending = 'service'; response.state.slot = null
    rememberDialogueQuestion(response.state, question, [{ id: typoService.id, label: typoService.name }], null, { candidateIds: [typoService.id] })
    response = { ...response, proposal: null, reply: question + ' Confirmame cuál servicio querés.' }
  }
  const engineAt = performance.now()
  const defaultServiceMenu = response.state.pending === 'service' && !response.state.serviceId &&
    !/\b(?:servicios|cat[aá]logo|lista|precios)\b/i.test(message) &&
    /^(?:Hola\. Te ayudo con tu turno\.\n)?¿Qué servicio necesitás\?\n/.test(response.reply)
  const planHasUpdates = Boolean(turnPlan?.operations.some(operation => operation.kind !== 'information'))
  const planHasInformation = Boolean(turnPlan?.operations.some(operation => operation.kind === 'information'))
  const planHasBookingUpdates = Boolean(turnPlan?.operations.some(operation => operation.kind !== 'information' && operation.kind !== 'name'))
  const replyIntent = planHasBookingUpdates ? 'booking' : planHasInformation ? 'information' : candidate?.intent ?? null
  const presentedOfferRead = candidate?.informationTarget?.kind === 'presented_offer' || Boolean(turnPlan?.operations.some(operation => operation.kind === 'information' && operation.target.kind === 'presented_offer'))
  const safeReply = defaultServiceMenu && replyIntent === 'other' ? '¿En qué te puedo ayudar con el local?'
    : defaultServiceMenu ? '¿Qué servicio necesitás?' : response.reply
  const canonicalOnly = informationPreparationFailed || Boolean(port.identity && planHasUpdates && !hasActiveBooking(response.state)) || response.proposal !== null || Boolean(response.bookingCommand || response.state.sandboxReservation) || Boolean(typoService) || uncertain || Boolean(response.state.questionContext?.matchCandidateIds)
  const responseProvider = options.responseProvider ?? provider.respond
  let authored: string | null = null
  let modelFraming = false
  let intakeValidation: ReplyValidationResult['validation'] | undefined
  let aiCalls = 1
  let replyRoute: 'first_call' | 'second_call' | 'motor' = 'motor'
  const finalFacts = !planHasUpdates && !planHasInformation && replyIntent === 'other' && incidentalFacts ? incidentalFacts :
    response.replyFacts ?? responseFacts(safeReply, response.state, replyIntent, message)
  if (!turnPlan && !reason && !canonicalOnly && !decision?.correction && availabilityCalls === 0 &&
      intakeReplyAllowed && candidate?.intent === 'booking' &&
      !services.find(service => service.id === response.state.serviceId)?.requiresConsultation) {
    if (candidate.intakeReply != null) {
      const intake = assembledIntakeReply(candidate.intakeReply, finalFacts, response.state, candidates, services, replyContract('clarification', Boolean(port.identity), response.state.introduced === true, finalFacts))
      intakeValidation = intake.validation
      authored = intake.text
      modelFraming = intake.modelFraming
      if (authored) replyRoute = 'first_call'
    }
  }
  // Updating the last delivered question does not change the booking facts or the offer evidence.
  const bookingFacts = (value: DialogueState) => {
    const { informationFocus: _focus, ...booking } = value
    return { ...booking, ...(value.dialogueContext ? { dialogueContext: { ...value.dialogueContext, lastQuestion: null } } : {}) }
  }
  const sameState = JSON.stringify(bookingFacts(response.state)) === JSON.stringify(bookingFacts(state))
  const eligibleFirstReply = !planHasUpdates && !reason && !canonicalOnly && !decision?.correction && !candidates.length &&
    availabilityCalls === 0 && sameState && firstReplyFacts !== undefined &&
    ((preparedInformation || pureInformation) && replyIntent === 'information' || !route.information.length &&
      !route.pendingAction && replyIntent === 'other' && !candidate?.serviceId && !candidate?.serviceEvidence &&
      !candidate?.professionalMention) && JSON.stringify(finalFacts) === JSON.stringify(firstReplyFacts)
  const finalContract = replyContract(replyIntent === 'information' ? 'information' : hasActiveBooking(response.state) ? 'continuation' : 'social', Boolean(port.identity), response.state.introduced === true, finalFacts, presentedOfferRead || response.replyFacts?.[0]?.id === 'acknowledgment')
  const replyValidation: ReplyValidationTrace = { firstCall: skippedReplyValidation(finalFacts, canonicalOnly ? 'canonical_only' : 'new_facts'), secondCall: skippedReplyValidation(finalFacts, 'canonical_only') }
  if (intakeValidation) replyValidation.firstCall = intakeValidation
  if (reason) replyValidation.firstCall = { status: 'rejected', reason: reason === 'invalid_output' ? 'interpretation_invalid' : reason, factCount: Math.min(finalFacts.length, 101), providedCount: 0 }
  if (!authored && eligibleFirstReply) {
    const validated = validateReplyDraft(candidate?.firstReply, finalFacts, finalContract, services.map(service => service.name))
    replyValidation.firstCall = validated.validation
    authored = validated.text
    modelFraming = validated.modelFraming
    if (authored) replyRoute = 'first_call'
  }
  // Prepared body ownership never transfers to the model. Validate the whole draft
  // against its original facts, then reuse only a factual-free opening.
  // Final neutral facts remain immutable; they are not the model's frame contract.
  if (!authored && !intakeValidation && !reason && response.replyPrepared && candidate?.firstReply != null && firstReplyFacts !== undefined &&
      !response.proposal && !response.bookingCommand && !response.state.sandboxReservation && !uncertain && !typoService && !response.state.questionContext?.matchCandidateIds) {
    const originalContract = replyContract(finalContract.role, Boolean(port.identity), state.introduced === true, firstReplyFacts)
    const frame = validateReplyDraft(candidate.firstReply, firstReplyFacts, originalContract, services.map(service => service.name))
    replyValidation.firstCall = frame.validation
    if (frame.validation.status === 'accepted') {
      const opening = (candidate.firstReply as { opening: string | null }).opening
      if (opening?.trim()) {
        authored = [opening, ...finalFacts.map(fact => fact.text)].join('\n')
        modelFraming = true
        replyRoute = 'first_call'
      }
    }
  }
  let copyReason: InterpretationDiagnostics['copyReason'] = 'canonical_only'
  let responseMs = 0
  let responseUsage: AiUsage | null = null
  let responseProviderError: ProviderFailure | null = null
  const newVerifiedFacts = firstReplyFacts === undefined || JSON.stringify(finalFacts) !== JSON.stringify(firstReplyFacts)
  if (!authored && !reason && !canonicalOnly && responseProvider && newVerifiedFacts && !response.replyPrepared) {
    replyValidation.secondCall = skippedReplyValidation(finalFacts, 'new_facts')
    const facts = finalFacts
    aiCalls++
    replyRoute = 'second_call'
    const responseController = new AbortController()
    let responseTimer: ReturnType<typeof setTimeout> | undefined
    const responseStarted = performance.now()
    try {
      const output = await Promise.race([
        responseProvider({ message, intent: replyIntent!, state: response.state, facts, replyContract: finalContract }, responseController.signal),
        new Promise<never>((_resolve, reject) => { responseTimer = setTimeout(() => { responseController.abort(); reject(new Error('response timeout')) }, timeoutMs) })
      ])
      responseUsage = readAiUsage(output)
      const validated = validateReplyDraft(output, facts, finalContract, services.map(service => service.name))
      replyValidation.secondCall = validated.validation
      authored = validated.text
      modelFraming = validated.modelFraming
      copyReason = authored ? modelFraming ? null : 'canonical_only' : 'invalid_response'
    } catch (error) {
      copyReason = responseController.signal.aborted ? 'response_timeout' : 'response_error'
      replyValidation.secondCall = { status: 'rejected', reason: responseController.signal.aborted ? 'timeout' : 'provider_error', factCount: Math.min(facts.length, 101), providedCount: 0 }
      responseProviderError = responseController.signal.aborted
        ? { code: 'timeout', httpStatus: null, requestId: null } : providerFailure(error)
    }
    finally { clearTimeout(responseTimer); responseMs = ms(performance.now() - responseStarted) }
  } else if (authored) {
    copyReason = modelFraming || response.replyPrepared ? null : 'canonical_only'
  } else if (response.replyPrepared && !reason) {
    copyReason = null
  } else if (!reason && !canonicalOnly) {
    // Stable server facts are canonical fallback; only newly established facts justify another call.
    copyReason = replyValidation.firstCall.status === 'rejected' && replyValidation.firstCall.reason !== 'missing_draft' ? 'invalid_response' : 'missing_draft'
  }
  // Only fixed codes, counts and workflow states leave this function as QA decision diagnostics.
  // Never copy model evidence, catalog IDs/names, chat text or provider output into metadata.
  const decisionTrace: DecisionTrace = {
    proposedIntent: candidate?.intent ?? 'unknown',
    candidateCount: candidates.length || (selected ? 1 : 0),
    pendingBefore: state.pending,
    pendingAfter: response.state.pending,
    acceptedAction: reason ? 'deterministic_fallback' : turnPlan?.operations.length ? 'turn_plan_routed' : candidates.length > 1 || uncertain ? 'clarify_service'
      : decision?.serviceId && response.state.serviceId === decision.serviceId && state.serviceId !== response.state.serviceId
        ? 'select_service' : response.proposal ? 'booking_proposal' : route.pendingAction ? 'pending_action_unavailable'
          : candidate?.informationTarget || route.information.length ? 'information_read' : 'no_service_change',
    outcome: reason ? 'fallback' : serviceOperation?.correction ? 'corrected' : decision?.correction ? 'corrected' : candidates.length > 1 || uncertain ? 'ambiguous'
      : decision?.serviceId && response.state.serviceId === decision.serviceId && state.serviceId !== response.state.serviceId
        ? 'selected' : 'unchanged',
    reason: reason ?? (turnPlan?.operations.length ? 'turn_plan' : decision?.correction ? 'service_correction' : candidates.length > 1 ? 'multiple_catalog_candidates'
      : uncertain ? 'not_applied' : decision?.serviceId && response.state.serviceId === decision.serviceId
        ? 'validated_service' : decision?.serviceId ? 'not_applied' : response.proposal ? 'proposal_only'
          : route.pendingAction ? 'pending_action' : candidate?.informationTarget || route.information.length ? 'information_route' : 'no_service_decision')
  }
  const availability = summarizeAvailability(response.availability)
  return finalizeDialogueIntroduction(context, { ...response, reply: authored ?? (!newVerifiedFacts && finalFacts.length ? finalFacts.map(fact => fact.text).join('\n') : safeReply), interpretation: {
    decision: decisionTrace, replyValidation,
    mode: reason ? 'fallback' : 'ai', reason,
    providerMs: ms(providerAt - providerStarted), validationMs: ms(validationAt - providerAt),
    aiCalls, replyRoute,
    deliveryOrigin: authored ? modelFraming ? 'validated_framing' : 'validated_canonical' : response.replyPrepared ? 'prepared' : canonicalOnly ? 'forced' : 'server_fallback',
    engineMs: ms(engineAt - engineStarted), responseMs, totalMs: ms(performance.now() - started),
    usage: { interpretation: readAiUsage(raw), response: responseUsage },
    proposal, validation, stateBefore: summarizeState(state), stateAfter: summarizeState(response.state),
    interpretationProviderError, responseProviderError,
    ...(availability ? { availability } : {}),
    ...(response.turnOutcome ? { turnOutcome: response.turnOutcome } : {}),
    copyMode: authored && modelFraming ? 'ai' : response.replyPrepared && !reason ? 'prepared' : 'fallback', copyReason
  } }, cachedPort)
}
