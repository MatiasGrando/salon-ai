import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { respondWithAiInterpreter, type AiInterpretationProvider, type InterpretationDiagnostics } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, parseDialogueState, type DialogueState, type DialogueService, type DialoguePort } from '../src/conversational-bot/engine.js'
import { basketServiceIds } from '../src/conversational-bot/service-basket.js'
import type { AvailabilitySlot } from '../src/bot-options/application/availability-queries.js'
import type { BusinessFacts } from '../src/conversational-bot/information.js'

export type EvaluationProviderProvenance = { kind: 'controlled' } | { kind: 'unverified_external' } |
  { kind: 'openai_responses'; endpoint: 'https://api.openai.com/v1/responses'; model: string; store: false }
export type EvaluationProviderOptions = { provider?: AiInterpretationProvider; timeoutMs?: number; providerProvenance?: EvaluationProviderProvenance }
/** Caller-attested transport evidence, not authorization. Injection by itself proves nothing about a real model. */
export function evaluationProviderProvenance(options: EvaluationProviderOptions): EvaluationProviderProvenance {
  const origin = options.providerProvenance ?? { kind: options.provider ? 'unverified_external' : 'controlled' }
  assert(['controlled','unverified_external','openai_responses'].includes(origin.kind), 'invalid provider provenance')
  if (origin.kind === 'openai_responses') {
    assert(options.provider && origin.endpoint === 'https://api.openai.com/v1/responses' && origin.store === false &&
      typeof origin.model === 'string' && origin.model.trim().length > 0, 'real provider transport evidence required')
  }
  return structuredClone(origin)
}

export type CorpusConversation = { conversationId: string; customerCode: string; cutoffExclusive: string; messages: Array<{
  messageId: string; direction: string; body: string; createdAt: string; hasMedia?: boolean; isInteractiveReply?: boolean
}> }
export type EvalFixture = { businessId: string; timezone: string; services: DialogueService[];
  professionals: Array<{ id: string; name: string; priority: number; serviceIds?: string[] }>;
  slots: AvailabilitySlot[]; information?: BusinessFacts }
export type Expected = { state?: Partial<Pick<DialogueState, 'pending' | 'serviceId' | 'date' | 'customerName' | 'requestedTime' | 'professionalNameHint' | 'professional'>>;
  basketServiceIds?: string[]; proposal?: boolean; action?: string; interpretationMode?: 'ai' | 'fallback'; replyIncludes?: string[]; replyExcludes?: string[] }
export type EvalCase = { id: string; fixtureId: string; sourceConversationId: string;
  initialState?: Partial<Omit<DialogueState, 'businessId' | 'engine' | 'schemaVersion'>>;
  turns: Array<{ sourceMessageId: string; oracle: Record<string, unknown>; expected: Expected }> }
export type EvalBundle = { schemaVersion: 1; fixtures: Record<string, EvalFixture>; cases: EvalCase[] }
const stateKeys = ['pending','serviceId','date','customerName','requestedTime','professionalNameHint','professional']
const expectationKeys = ['state','basketServiceIds','proposal','action','interpretationMode','replyIncludes','replyExcludes']
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const digest = (x: string | Buffer) => createHash('sha256').update(x).digest('hex')
function validate(bundle: EvalBundle, corpus: CorpusConversation[]) {
  assert(object(bundle) && bundle.schemaVersion === 1 && object(bundle.fixtures) && Array.isArray(bundle.cases) && bundle.cases.length, 'invalid annotations')
  assert(Array.isArray(corpus) && new Set(corpus.map(x => x.conversationId)).size === corpus.length, 'duplicate source conversations')
  const ids = new Set<string>()
  for (const scenario of bundle.cases) {
    assert(scenario.id && !ids.has(scenario.id), 'duplicate case'); ids.add(scenario.id)
    const fixture = Object.hasOwn(bundle.fixtures, scenario.fixtureId) ? bundle.fixtures[scenario.fixtureId] : undefined
    assert(fixture && fixture.businessId.startsWith('qa-') && Array.isArray(fixture.services) && Array.isArray(fixture.professionals) && Array.isArray(fixture.slots), 'invalid fixture')
    new Intl.DateTimeFormat('en', { timeZone: fixture.timezone })
    assert(new Set(fixture.services.map(x => x.id)).size === fixture.services.length, 'duplicate fixture services')
    assert(fixture.professionals.every(p => typeof p.id === 'string' && typeof p.name === 'string'), 'fixture professionals')
    assert(fixture.slots.every(s => fixture.professionals.some(p => p.id === s.professionalId) && Number.isFinite(Date.parse(s.startAt))), 'fixture slots')
    if (fixture.information) assert.equal(fixture.information.businessId, fixture.businessId, 'fixture information tenant')
    if (scenario.initialState) assert(!['businessId','engine','schemaVersion'].some(k => Object.hasOwn(scenario.initialState!, k)), 'invalid initial state tenant')
    const source = corpus.find(x => x.conversationId === scenario.sourceConversationId)
    assert(source && ['WX-NPP7HE','WX-QG5FQA'].includes(source.customerCode), 'source conversation missing or unauthorized')
    assert(Number.isFinite(Date.parse(source.cutoffExclusive)), 'invalid cutoff')
    assert(new Set(source.messages.map(m => m.messageId)).size === source.messages.length, 'duplicate source messages')
    assert(Array.isArray(scenario.turns) && scenario.turns.length, 'empty scenario')
    let previous = -1
    for (const turn of scenario.turns) {
      const index = source.messages.findIndex(x => x.messageId === turn.sourceMessageId)
      assert(index >= 0, 'source message missing'); assert(index > previous, 'turns must be chronological'); previous = index
      const message = source.messages[index]!
      assert(message.direction === 'INBOUND', 'only inbound messages may feed the evaluator')
      assert(Number.isFinite(Date.parse(message.createdAt)) && Date.parse(message.createdAt) < Date.parse(source.cutoffExclusive), 'source violates cutoff')
      assert(!message.hasMedia, 'media content is unavailable; annotate an unevaluable case instead')
      assert(typeof message.body === 'string' && message.body.trim().length > 0 && message.body.length <= 2000, 'invalid input body')
      assert(object(turn.oracle), 'missing annotated oracle')
      assert(object(turn.expected) && Object.keys(turn.expected).length && Object.keys(turn.expected).every(k => expectationKeys.includes(k)), 'missing or unknown expectations')
      if (turn.expected.state) assert(object(turn.expected.state) && Object.keys(turn.expected.state).length && Object.keys(turn.expected.state).every(k => stateKeys.includes(k)), 'unknown state expectations')
      for (const key of ['replyIncludes','replyExcludes','basketServiceIds'] as const) if (turn.expected[key]) assert(Array.isArray(turn.expected[key]) && turn.expected[key]!.every(x => typeof x === 'string'), 'invalid expectations')
      assert(Object.entries(turn.expected).some(([k,v]) => Array.isArray(v) ? v.length > 0 : object(v) ? Object.keys(v).length > 0 : v !== undefined), 'empty expectations')
    }
  }
}
export function fixturePort(fixture: EvalFixture): DialoguePort {
  const professionalsFor = (ids: string[]) => fixture.professionals.filter(p => !p.serviceIds || ids.every(id => p.serviceIds!.includes(id)))
  const slotsFor = (ids: string[], date: string, professionalId?: string) => {
    const professionals = professionalsFor(ids).filter(p => !professionalId || p.id === professionalId)
    return { professionals: structuredClone(professionals), slots: structuredClone(fixture.slots.filter(s => s.date === date && professionals.some(p => p.id === s.professionalId))) }
  }
  return {
    catalog: async () => structuredClone(fixture.services),
    ...(fixture.information ? { information: async () => structuredClone(fixture.information!) } : {}),
    availability: async (service, date, professionalId) => slotsFor([service.id], date, professionalId),
    availabilityBasket: async (services, date, professionalId) => {
      if (services.some(s => s.requiresConsultation)) return { ok: false, reason: 'DOMAIN_REVIEW' }
      if (services.some(s => !Number.isInteger(s.durationMinutes) || s.durationMinutes! <= 0)) return { ok: false, reason: 'INVALID_DURATION' }
      const available = slotsFor(services.map(s => s.id), date, professionalId)
      if (!available.professionals.length) return { ok: false, reason: 'NO_COMMON_PROFESSIONAL' }
      return { ok: true, services, durationMinutes: services.reduce((n,s) => n+s.durationMinutes!,0),
        totalPrice: services.some(s => s.price === null) ? null : services.reduce((n,s) => n+s.price!,0), ...available }
    }
  }
}
export async function evaluateCases(input: unknown, corpus: CorpusConversation[], options: EvaluationProviderOptions = {}) {
  const provenance = evaluationProviderProvenance(options)
  const bundle = structuredClone(input) as EvalBundle
  validate(bundle, corpus)
  const cases: Array<{ caseId: string; sourceConversationId: string; explicitInitialContext: boolean; turns: Array<{
    messageId: string; passed: boolean; failures: string[]; reply: string | null; state: DialogueState | null; proposal: boolean; action: string | null; interpretationMode: string | null; diagnostics?: InterpretationDiagnostics
  }> }> = []
  for (const scenario of bundle.cases) {
    const fixture = bundle.fixtures[scenario.fixtureId]!
    const source = corpus.find(x => x.conversationId === scenario.sourceConversationId)!
    let state = parseDialogueState({ ...initialDialogueState(fixture.businessId), ...scenario.initialState }, fixture.businessId, fixture.timezone)
    const port = fixturePort(fixture)
    const result: (typeof cases)[number] = { caseId: scenario.id, sourceConversationId: source.conversationId, explicitInitialContext: !!scenario.initialState, turns: [] }
    for (const turn of scenario.turns) {
      const message = source.messages.find(x => x.messageId === turn.sourceMessageId)!
      const provider: AiInterpretationProvider = options.provider ?? Object.assign(async (request: { firstReplyFacts?: readonly { id: string }[] }) => ({
        ...structuredClone(turn.oracle), firstReply: { opening: null, factIds: request.firstReplyFacts?.map(f => f.id) ?? [], closing: null }
      }), { respond: async (request: { facts: readonly { id: string }[] }) => ({ opening: null, factIds: request.facts.map(f => f.id), closing: null }) })
      const failures: string[] = []
      try {
        const response = await respondWithAiInterpreter({ businessId: fixture.businessId, timezone: fixture.timezone, dbNow: new Date(message.createdAt) }, state, message.body, port, provider, options)
        for (const [key, value] of Object.entries(turn.expected.state ?? {})) if (!isDeepStrictEqual(response.state[key as keyof DialogueState], value)) failures.push('state.'+key)
        if (turn.expected.basketServiceIds && !isDeepStrictEqual([...basketServiceIds(response.state)].sort(), [...turn.expected.basketServiceIds].sort())) failures.push('basketServiceIds')
        if (turn.expected.proposal !== undefined && (response.proposal !== null) !== turn.expected.proposal) failures.push('proposal')
        if (turn.expected.action && response.interpretation.decision.acceptedAction !== turn.expected.action) failures.push('action')
        if (response.interpretation.mode !== (turn.expected.interpretationMode ?? 'ai')) failures.push('interpretationMode')
        if (turn.expected.replyIncludes?.some(s => !response.reply.includes(s))) failures.push('replyIncludes')
        if (turn.expected.replyExcludes?.some(s => response.reply.includes(s))) failures.push('replyExcludes')
        state = response.state
        result.turns.push({ messageId: message.messageId, passed: !failures.length, failures, reply: response.reply, state: structuredClone(state), proposal: response.proposal !== null, action: response.interpretation.decision.acceptedAction, interpretationMode: response.interpretation.mode, ...(options.provider ? { diagnostics: structuredClone(response.interpretation) } : {}) })
      } catch {
        result.turns.push({ messageId: message.messageId, passed: false, failures: ['runtime_error'], reply: null, state: null, proposal: false, action: null, interpretationMode: null })
        break // Later turns would inherit a state that was never produced.
      }
    }
    cases.push(result)
  }
  const turns = cases.flatMap(c => c.turns)
  const sourceFiles = ['ai-interpreter.ts','engine.ts','turn-plan.ts','service-basket.ts']
  return { schemaVersion: 1, mode: options.provider ? 'external_provider_real_motor' : 'controlled_interpretation_real_motor', providerProvenance: provenance, comprehensionEvaluated: provenance.kind === 'openai_responses' && turns.some(t => t.interpretationMode === 'ai'),
    limitations: [options.provider ? 'External provider evaluated; fallback turns do not establish model comprehension.' : 'Annotated interpretation oracle; no real-model comprehension or style measurement.', 'Synthetic catalog and agenda; no production pricing, booking, batching or session-expiry proof.'],
    runtimeSources: sourceFiles.map(name => ({ path: 'src/conversational-bot/'+name, sha256: digest(readFileSync(new URL('../src/conversational-bot/'+name, import.meta.url))) })),
    casesPlanned: bundle.cases.length, turnsPlanned: bundle.cases.reduce((n,c) => n+c.turns.length,0), turnsRun: turns.length,
    passed: turns.filter(t => t.passed).length, failed: turns.filter(t => !t.passed).length, cases }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [annotationsPath, corpusPath, reportPath] = process.argv.slice(2)
  assert(annotationsPath && corpusPath && reportPath, 'Usage: tsx scripts/glow-offline-eval.ts annotations.json corpus.jsonl report.json (new file only)')
  const annotations = readFileSync(annotationsPath, 'utf8'), rawCorpus = readFileSync(corpusPath, 'utf8')
  const report = await evaluateCases(JSON.parse(annotations), rawCorpus.trim().split(/\r?\n/).map(line => JSON.parse(line)))
  writeFileSync(reportPath, JSON.stringify({ ...report, inputHashes: { annotations: digest(annotations), corpus: digest(rawCorpus) } }, null, 2)+'\n', { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ mode: report.mode, comprehensionEvaluated: false, cases: report.casesPlanned, turns: report.turnsRun, passed: report.passed, failed: report.failed, reportPath }))
}
