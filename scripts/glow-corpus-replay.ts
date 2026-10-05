import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState } from '../src/conversational-bot/engine.js'
import { basketServiceIds } from '../src/conversational-bot/service-basket.js'
import { evaluateCases, evaluationProviderProvenance, fixturePort, type CorpusConversation, type EvalBundle, type EvaluationProviderOptions } from './glow-offline-eval.js'

type ReplayMessage = CorpusConversation['messages'][number] & { sequence?: number; contextBeforeFirstVerifiedV2Event?: boolean }
type ReviewFinding = { category?: string; sourceMessageIds: string[]; expectedAction?: string; suggestedResponse?: string }
type Review = { conversationId: string; replaySuitability: string; privacyMessageIds: string[]; findings: ReviewFinding[] }
type CandidateCase = { caseId: string; conversationId: string; sourceMessageIds: string[]; expectedAction?: string }
export type ReplayInput = { corpus: Array<Omit<CorpusConversation,'messages'> & {messages: ReplayMessage[]}>;
  reviews: Review[]; candidateCases: CandidateCase[]; annotations: EvalBundle; fixtureVersion: string;
  fixtureIdByCustomerCode: Record<string,string> }
type IndependentExpectation = { id: string; kind: 'review_finding' | 'candidate'; conversationId: string;
  sourceMessageIds: string[]; expectedAction: string | null; suggestedResponse: string | null }
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const object = (value: unknown): value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const supportedTenants = ['WX-NPP7HE','WX-QG5FQA']
const limitations = [
  'Historical outbound messages and old bot state never seed the new motor or the provider.',
  'Synthetic versioned catalog/agenda, not historical facts, pricing, capacity or confirmed bookings.',
  'Pure dialogue state follows the historical input clock; runtime expiry/consolidation are not reproduced or invented.',
  'Interactive IDs are absent; plain-text interactive replay is optional and explicitly counterfactual.',
  'Reviews provide partial independent criteria, not a complete executable oracle; observations are not automatic passes.',
  'Reserved regression holdout was chosen after prior corpus review; it is not a blind evaluation.',
  'No training, database, WhatsApp or server effects; real-provider authorization is a separate caller responsibility.'
]
function validate(input: ReplayInput) {
  assert(object(input) && Array.isArray(input.corpus) && input.corpus.length && Array.isArray(input.reviews) &&
    Array.isArray(input.candidateCases), 'invalid replay input')
  assert(typeof input.fixtureVersion === 'string' && input.fixtureVersion.trim() && object(input.fixtureIdByCustomerCode), 'fixture version required')
  assert(object(input.annotations) && input.annotations.schemaVersion === 1 && object(input.annotations.fixtures) &&
    Array.isArray(input.annotations.cases), 'annotations required')
  const conversationIds = new Set(input.corpus.map(c => c.conversationId))
  assert(conversationIds.size === input.corpus.length, 'duplicate conversation')
  assert(input.reviews.length === input.corpus.length && new Set(input.reviews.map(r => r.conversationId)).size === input.reviews.length &&
    input.reviews.every(r => conversationIds.has(r.conversationId)), 'exact review coverage required')
  for (const source of input.corpus) {
    assert(supportedTenants.includes(source.customerCode) && typeof source.conversationId === 'string', 'unauthorized source tenant')
    const cutoff = Date.parse(source.cutoffExclusive)
    assert(Number.isFinite(cutoff) && Array.isArray(source.messages), 'source cutoff/messages')
    const fixtureId = input.fixtureIdByCustomerCode[source.customerCode]
    const fixture = fixtureId && Object.hasOwn(input.annotations.fixtures, fixtureId) ? input.annotations.fixtures[fixtureId] : undefined
    assert(fixture && fixture.businessId.startsWith('qa-') && Array.isArray(fixture.services) &&
      Array.isArray(fixture.professionals) && Array.isArray(fixture.slots), 'QA fixture required')
    new Intl.DateTimeFormat('en', {timeZone: fixture.timezone})
    assert(new Set(fixture.services.map(s => s.id)).size === fixture.services.length &&
      fixture.slots.every(s => Number.isFinite(Date.parse(s.startAt)) && fixture.professionals.some(p => p.id === s.professionalId)), 'fixture integrity')
    if (fixture.information) assert(fixture.information.businessId === fixture.businessId, 'fixture information tenant')
    const messageIds = new Set<string>()
    let previousTime = -Infinity, previousSequence = -Infinity
    for (const message of source.messages) {
      const time = Date.parse(message.createdAt)
      assert(Number.isFinite(time) && time < cutoff, 'source violates cutoff')
      assert(time >= previousTime && (message.sequence === undefined || message.sequence > previousSequence), 'source must be chronological')
      previousTime = time; previousSequence = message.sequence ?? previousSequence
      assert(typeof message.messageId === 'string' && !messageIds.has(message.messageId), 'duplicate message')
      messageIds.add(message.messageId)
      assert(['INBOUND','OUTBOUND'].includes(message.direction) && typeof message.body === 'string', 'message shape')
      if (message.direction === 'INBOUND') assert(message.body.trim() && message.body.length <= 2000, 'unsupported input body')
    }
    const review = input.reviews.find(r => r.conversationId === source.conversationId)!
    assert(['directa','adaptacion','no_evaluable'].includes(review.replaySuitability) &&
      Array.isArray(review.findings) && Array.isArray(review.privacyMessageIds), 'review shape')
    assert(review.privacyMessageIds.every(id => messageIds.has(id)), 'privacy reference missing')
    for (const finding of review.findings) assert(Array.isArray(finding.sourceMessageIds) &&
      finding.sourceMessageIds.every(id => messageIds.has(id)), 'review message reference missing')
  }
  const validateReferences = (conversationId: string, ids: string[]) => {
    const source = input.corpus.find(c => c.conversationId === conversationId)
    assert(source && Array.isArray(ids) && ids.every(id => source.messages.some(m => m.messageId === id)), 'candidate/oracle source reference')
  }
  assert(new Set(input.candidateCases.map(c => c.caseId)).size === input.candidateCases.length, 'duplicate candidate')
  for (const candidate of input.candidateCases) validateReferences(candidate.conversationId, candidate.sourceMessageIds)
  for (const scenario of input.annotations.cases) validateReferences(scenario.sourceConversationId, scenario.turns.map(t => t.sourceMessageId))
}
export function buildCorpusReplayPlan(input: ReplayInput) {
  validate(input)
  const expectations: IndependentExpectation[] = input.reviews.flatMap<IndependentExpectation>(review => review.findings.map((finding,index) => ({
    id: review.conversationId+'-finding-'+(index+1), kind: 'review_finding' as const, conversationId: review.conversationId,
    sourceMessageIds: [...finding.sourceMessageIds], expectedAction: finding.expectedAction ?? null, suggestedResponse: finding.suggestedResponse ?? null
  }))).concat(input.candidateCases.map(candidate => ({ id: candidate.caseId, kind: 'candidate' as const,
    conversationId: candidate.conversationId, sourceMessageIds: [...candidate.sourceMessageIds],
    expectedAction: candidate.expectedAction ?? null, suggestedResponse: null })))
  const conversations = input.corpus.map(source => {
    const review = input.reviews.find(r => r.conversationId === source.conversationId)!
    // Stable reservation, selected without inspecting messages or outcomes; previously exposed corpus is not blind.
    const split = parseInt(sha('e223-regression-holdout-v1:'+source.conversationId).slice(0,8),16) % 5 === 0
      ? 'reserved_holdout' as const : 'evaluation' as const
    let previousInbound: ReplayMessage | undefined
    const turns = source.messages.filter(m => m.direction === 'INBOUND').map(message => {
      const reasons = [
        ...(review.replaySuitability === 'no_evaluable' ? ['historical_context_insufficient'] : []),
        ...(review.privacyMessageIds.includes(message.messageId) ? ['privacy_omitted'] : []),
        ...(message.hasMedia ? ['media_unavailable'] : []),
        ...(message.isInteractiveReply ? ['historical_choice_not_bound'] : [])
      ]
      const gapMs = previousInbound ? Date.parse(message.createdAt)-Date.parse(previousInbound.createdAt) : null
      previousInbound = message
      return { messageId: message.messageId, createdAt: message.createdAt, sourceBodySha256: sha(message.body), gapSincePreviousInboundMs: gapMs,
        contextBeforeV2Evidence: !!message.contextBeforeFirstVerifiedV2Event,
        counterfactualContinuation: source.messages.slice(0,source.messages.indexOf(message)).some(m => m.direction === 'OUTBOUND'), reasons,
        expectedIds: expectations.filter(e => e.conversationId === source.conversationId && e.sourceMessageIds.includes(message.messageId)).map(e => e.id),
        structuredCaseIds: input.annotations.cases.filter(c => c.sourceConversationId === source.conversationId &&
          c.turns.some(t => t.sourceMessageId === message.messageId)).map(c => c.id),
        evaluation: reasons.length ? 'no_evaluable' as const : 'no_scored' as const }
    })
    return { conversationId: source.conversationId, customerCode: source.customerCode, split, replaySuitability: review.replaySuitability,
      fixtureId: input.fixtureIdByCustomerCode[source.customerCode]!, expectedIds: expectations.filter(e => e.conversationId === source.conversationId).map(e => e.id), turns }
  })
  const turns = conversations.flatMap(c => c.turns)
  return { schemaVersion: 1, purpose: 'independent-criteria-ordered-replay', blindEvaluation: false,
    fixtureVersion: input.fixtureVersion, fixtureSha256: sha(JSON.stringify(input.annotations.fixtures)),
    holdoutPolicy: 'sha256(e223-regression-holdout-v1:conversationId) first 8 hex modulo 5 equals 0',
    limitations: [...limitations], expectations, conversations,
    counts: { conversations: conversations.length, potentialConversations: conversations.filter(c => c.replaySuitability !== 'no_evaluable').length,
      noEvaluableConversations: conversations.filter(c => c.replaySuitability === 'no_evaluable').length,
      messages: input.corpus.reduce((n,c) => n+c.messages.length,0), inbound: turns.length,
      findings: input.reviews.reduce((n,r) => n+r.findings.length,0), candidateCases: input.candidateCases.length,
      structuredCases: input.annotations.cases.length, structuredTurns: input.annotations.cases.reduce((n,c) => n+c.turns.length,0),
      privacyInbound: turns.filter(t => t.reasons.includes('privacy_omitted')).length,
      mediaInbound: turns.filter(t => t.reasons.includes('media_unavailable')).length,
      interactiveInbound: turns.filter(t => t.reasons.includes('historical_choice_not_bound')).length,
      holdoutConversations: conversations.filter(c => c.split === 'reserved_holdout').length,
      holdoutInbound: conversations.filter(c => c.split === 'reserved_holdout').reduce((n,c) => n+c.turns.length,0),
      inboundWithIndependentCriteria: turns.filter(t => t.expectedIds.length > 0).length }
  }
}
const runtimeFingerprints = () => readdirSync(new URL('../src/conversational-bot/',import.meta.url)).filter(name => name.endsWith('.ts')).sort()
  .map(name => ({path:'src/conversational-bot/'+name,sha256:sha(readFileSync(new URL('../src/conversational-bot/'+name,import.meta.url),'utf8'))}))
export type ReplayOptions = EvaluationProviderOptions & { provider: NonNullable<EvaluationProviderOptions['provider']>;
  includeHoldout?: boolean; allowHistoricalInteractiveText?: boolean; maxTurns?: number }
export async function replayCorpus(input: ReplayInput, options: ReplayOptions) {
  // Validate the entire source and provenance before the first externally injectable call.
  const plan = buildCorpusReplayPlan(input), provenance = evaluationProviderProvenance(options), before = runtimeFingerprints()
  assert(typeof options.provider === 'function', 'explicit replay provider required; inventory is the default')
  assert(options.maxTurns === undefined || Number.isInteger(options.maxTurns) && options.maxTurns > 0, 'invalid turn budget')
  type Observed = { pending: string; serviceIds: string[]; date: string|null; requestedTime: string|null;
    professionalId: string|null; hasCustomerName: boolean; proposal: boolean; action: string; interpretationMode: string;
    reason: string|null; copyMode: string; aiCalls: number|null; reply: string }
  const turns: Array<{conversationId:string;messageId:string;createdAt:string;contextIncomplete:boolean;counterfactualContinuation:boolean;reasons:string[];
    expected:IndependentExpectation[];structuredCaseIds:string[];evaluation:'no_scored'|'no_evaluable';observed:Observed|null}> = []
  const skipped: Array<{conversationId:string;messageId:string;reasons:string[]}> = []
  let holdoutSkipped = 0, budgetSkipped = 0
  for (const conversation of plan.conversations) {
    const source = input.corpus.find(c => c.conversationId === conversation.conversationId)!
    const fixture = input.annotations.fixtures[conversation.fixtureId]!
    const port = fixturePort(fixture)
    let state = initialDialogueState(fixture.businessId), contextIncomplete = false
    for (const turn of conversation.turns) {
      const reasons = turn.reasons.filter(reason => reason !== 'historical_choice_not_bound' || !options.allowHistoricalInteractiveText)
      if (reasons.length) { skipped.push({conversationId:source.conversationId,messageId:turn.messageId,reasons}); contextIncomplete = true; continue }
      if (conversation.split === 'reserved_holdout' && !options.includeHoldout) { holdoutSkipped++; continue }
      if (options.maxTurns !== undefined && turns.length >= options.maxTurns) { budgetSkipped++; continue }
      const message = source.messages.find(m => m.messageId === turn.messageId)!
      const result: (typeof turns)[number] = { conversationId: source.conversationId, messageId: message.messageId, createdAt: message.createdAt,
        contextIncomplete, counterfactualContinuation:turn.counterfactualContinuation, reasons: message.isInteractiveReply ? ['counterfactual_interactive_text'] : [],
        expected: plan.expectations.filter(e => turn.expectedIds.includes(e.id)), structuredCaseIds: turn.structuredCaseIds,
        evaluation: 'no_scored' as 'no_scored'|'no_evaluable', observed: null as Observed|null }
      if (message.isInteractiveReply) contextIncomplete = result.contextIncomplete = true
      try {
        const response = await respondWithAiInterpreter({businessId:fixture.businessId,timezone:fixture.timezone,dbNow:new Date(message.createdAt)},
          structuredClone(state), message.body, port, options.provider, options)
        state = response.state
        result.observed = { pending: state.pending, serviceIds: [...basketServiceIds(state)], date: state.date,
          requestedTime: state.requestedTime, professionalId: state.professional?.kind === 'specific' ? state.professional.id : null, hasCustomerName: !!state.customerName,
          proposal: response.proposal !== null, action: response.interpretation.decision.acceptedAction,
          interpretationMode: response.interpretation.mode, reason: response.interpretation.reason, copyMode: response.interpretation.copyMode,
          aiCalls: response.interpretation.aiCalls ?? null, reply: response.reply }
      } catch {
        result.evaluation = 'no_evaluable'; result.reasons.push('runtime_error'); contextIncomplete = true
      }
      turns.push(result)
    }
  }
  const after = runtimeFingerprints()
  return { schemaVersion:1, mode:'ordered-new-motor-observations', providerProvenance:provenance,
    comprehensionEvaluated: provenance.kind === 'openai_responses' && turns.some(t => t.observed?.interpretationMode === 'ai'),
    fixtureVersion:plan.fixtureVersion,fixtureSha256:plan.fixtureSha256,blindEvaluation:false,
    runtimeSources:before,runtimeStable:JSON.stringify(before)===JSON.stringify(after),limitations:plan.limitations,
    counts:{ inboundPlanned:plan.counts.inbound,turnsRun:turns.length,passed:0,
      noScored:turns.filter(t => t.evaluation === 'no_scored').length,noEvaluable:skipped.length+turns.filter(t => t.evaluation === 'no_evaluable').length,
      fallback:turns.filter(t => t.observed?.interpretationMode === 'fallback').length,holdoutSkipped,budgetSkipped },
    turns,skipped }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [corpusPath, canitasReviewPath, glowReviewPath, annotationsPath, outputPath] = process.argv.slice(2)
  assert(corpusPath && canitasReviewPath && glowReviewPath && annotationsPath && outputPath,
    'Usage: tsx scripts/glow-corpus-replay.ts corpus.jsonl canitas-review.json glow-review.json annotations.json private-output-dir')
  const allowed = resolve('tmp/e223-corpus-replay'), output = resolve(outputPath)
  assert(output === allowed || output.startsWith(allowed+sep), 'output must remain inside private tmp/e223-corpus-replay')
  const raw = [corpusPath,canitasReviewPath,glowReviewPath,annotationsPath].map(path => readFileSync(path,'utf8'))
  const reviews = raw.slice(1,3).map(text => JSON.parse(text) as {conversations:Review[];candidateCases:CandidateCase[]})
  const annotations = JSON.parse(raw[3]!) as EvalBundle
  const input: ReplayInput = {corpus:raw[0]!.trim().split(/\r?\n/).map(line => JSON.parse(line)),reviews:reviews.flatMap(r => r.conversations),
    candidateCases:reviews.flatMap(r => r.candidateCases),annotations,fixtureVersion:'existing-glow-synthetic-fixtures-v1',
    fixtureIdByCustomerCode:{'WX-NPP7HE':'all','WX-QG5FQA':'all'}}
  const plan = buildCorpusReplayPlan(input)
  const fingerprintsBefore = runtimeFingerprints()
  // These selected scenarios deliberately use their explicit adapted QA context, never masquerading as full transcript replay.
  const isolated = await evaluateCases(annotations,input.corpus)
  const isolatedReport = {...isolated,contextMode:'explicit-isolated-adapted-context-not-full-replay',
    runtimeStable:JSON.stringify(fingerprintsBefore)===JSON.stringify(runtimeFingerprints()),runtimeSources:fingerprintsBefore}
  mkdirSync(output,{recursive:true})
  const save = (name:string,value:unknown) => writeFileSync(resolve(output,name),JSON.stringify(value,null,2)+'\n',{encoding:'utf8',flag:'wx'})
  save('plan.json',{...plan,inputHashes:raw.map(sha)})
  save('resultado-estructurado-controlado.json',isolatedReport)
  const summary = '# Corpus replay: inventario y evidencia controlada\n\n'+
    'Conversaciones '+plan.counts.conversations+'; potenciales '+plan.counts.potentialConversations+'; no evaluables históricas '+plan.counts.noEvaluableConversations+
    '; entradas '+plan.counts.inbound+'.\nHallazgos '+plan.counts.findings+'; candidatos '+plan.counts.candidateCases+
    '; holdout reservado '+plan.counts.holdoutConversations+' conversaciones (no ciego).\n\n'+
    'Sólo se ejecutaron '+isolated.turnsRun+' entradas de '+isolated.casesPlanned+' escenarios aislados con contexto QA explícitamente adaptado: '+
    isolated.passed+' expectativas cumplidas, '+isolated.failed+' fallidas. Comprensión IA real NO evaluada.\n'+
    'Casos fallidos conservados: '+isolated.cases.filter(c => c.turns.some(t => !t.passed)).map(c => c.caseId+': '+c.turns.filter(t => !t.passed).flatMap(t => t.failures).join(', ')).join('; ')+'.\n'+
    'Replay completo preparado, NO ejecutado. Esperado frente a observado por entrada pendiente de proveedor autorizado y revisión independiente.\n\n'+
    plan.limitations.map(line => '- '+line).join('\n')+'\n'
  writeFileSync(resolve(output,'RESUMEN.md'),summary,{encoding:'utf8',flag:'wx'})
  console.log(JSON.stringify({inventory:plan.counts,isolated:{turns:isolated.turnsRun,passed:isolated.passed,failed:isolated.failed},
    comprehensionEvaluated:false,fullReplayExecuted:false,runtimeStable:isolatedReport.runtimeStable,output}))
}
