import assert from 'node:assert/strict'
import { buildCorpusReplayPlan, replayCorpus, type ReplayInput } from './glow-corpus-replay.js'
const fixture = { businessId: 'qa-corpus', timezone: 'America/Argentina/Buenos_Aires',
  services: [{ id: 'cut', name: 'Corte', durationMinutes: 30, price: 1000, requiresConsultation: false }],
  professionals: [{ id: 'staff', name: 'Profesional QA', priority: 0 }], slots: [] }
const corpus = Array.from({ length: 8 }, (_, index) => {
  const id = 'canitas-'+(index+1)
  return { conversationId: id, customerCode: 'WX-NPP7HE', cutoffExclusive: '2026-09-03T01:18:06.522Z', messages: [
    { messageId: id+'-m1', sequence: 1, createdAt: '2026-08-20T12:00:00Z', direction: 'INBOUND', body: 'Corte', hasMedia: false, isInteractiveReply: false },
    { messageId: id+'-m2', sequence: 2, createdAt: '2026-08-20T12:01:00Z', direction: 'OUTBOUND', body: 'OLD OUTBOUND NEVER USE', hasMedia: false, isInteractiveReply: false },
    { messageId: id+'-m3', sequence: 3, createdAt: '2026-08-20T12:02:00Z', direction: 'INBOUND', body: 'Gracias', hasMedia: false, isInteractiveReply: false }
  ] }
})
const input: ReplayInput = { corpus, fixtureVersion: 'synthetic-v1',
  fixtureIdByCustomerCode: { 'WX-NPP7HE': 'salon' },
  annotations: { schemaVersion: 1, fixtures: { salon: fixture }, cases: [] },
  reviews: corpus.map(c => ({ conversationId: c.conversationId, replaySuitability: 'directa',
    privacyMessageIds: [], findings: [{ category: 'contexto', sourceMessageIds: [c.messages[2]!.messageId],
      expectedAction: 'Conservar servicio', suggestedResponse: 'Agradecer sin cancelar' }] })),
  candidateCases: [{ caseId: 'candidate', conversationId: corpus[0]!.conversationId,
    sourceMessageIds: [corpus[0]!.messages[2]!.messageId], expectedAction: 'Conservar contexto' }] }
const plan = buildCorpusReplayPlan(input)
assert.equal(plan.counts.conversations, 8)
assert.equal(plan.counts.inbound, 16)
assert.equal(plan.counts.findings, 8)
assert.equal(plan.counts.candidateCases, 1)
assert.equal(plan.blindEvaluation, false)
assert.equal(plan.conversations[0]!.turns[0]!.counterfactualContinuation, false)
assert.equal(plan.conversations[0]!.turns[1]!.counterfactualContinuation, true, 'all continuations after old replies are counterfactual, not just detected ordinals')
assert.equal(JSON.stringify(plan).includes('OLD OUTBOUND'), false)
assert.equal(JSON.stringify(plan).includes('"body"'), false)
assert.deepEqual(buildCorpusReplayPlan(input), plan)
const reversed = structuredClone(input); reversed.corpus.reverse(); reversed.reviews.reverse()
assert.deepEqual(buildCorpusReplayPlan(reversed).conversations.map(c => [c.conversationId,c.split]).sort(),
  plan.conversations.map(c => [c.conversationId,c.split]).sort(), 'holdout is independent of array order')
let calls = 0
const stateBefore: Array<string|null> = []
const clockDates: string[] = []
const provider = async (request: { message: string; state: {serviceId:string|null}; businessDate?: string; firstReplyFacts?: readonly {id:string}[] }) => {
  calls++; stateBefore.push(request.state.serviceId); clockDates.push(request.businessDate!)
  assert.equal(JSON.stringify(request).includes('OLD OUTBOUND'), false)
  assert.equal(JSON.stringify(request).includes('Conservar servicio'), false)
  return { intent: request.message === 'Corte' ? 'booking' : 'other', serviceId: request.message === 'Corte' ? 'cut' : null,
    serviceEvidence: request.message === 'Corte' ? 'Corte' : null, professionalMention: null,
    firstReply: { opening: null, factIds: request.firstReplyFacts?.map(f => f.id) ?? [], closing: null } }
}
const result = await replayCorpus(input, { provider, providerProvenance: { kind: 'controlled' } })
const active = plan.conversations.filter(c => c.split !== 'reserved_holdout')
assert.equal(calls, active.length * 2)
assert.deepEqual(stateBefore, active.flatMap(() => [null, 'cut']))
assert.ok(clockDates.every(date => date === '2026-08-20'))
assert.equal(result.comprehensionEvaluated, false)
assert.equal(result.counts.passed, 0)
assert.equal(result.counts.noScored, calls)
assert.ok(result.turns.every(t => t.evaluation === 'no_scored'))
assert.equal(result.counts.holdoutSkipped, plan.counts.holdoutInbound)
assert.ok(result.turns.some(t => t.expected.length > 0))
assert.ok(result.turns.some(t => t.counterfactualContinuation))
assert.ok(result.turns.every(t => t.observed && t.observed.pending !== undefined))
const full = await replayCorpus(input, { provider, includeHoldout: true })
assert.equal(full.counts.turnsRun, 16)
assert.equal(full.providerProvenance.kind, 'unverified_external')
assert.equal(full.comprehensionEvaluated, false)
const restricted = structuredClone(input)
restricted.corpus[0]!.messages[0]!.hasMedia = true
restricted.reviews[0]!.privacyMessageIds = [restricted.corpus[0]!.messages[2]!.messageId]
restricted.corpus[1]!.messages[0]!.isInteractiveReply = true
restricted.reviews[2]!.replaySuitability = 'no_evaluable'
const restrictedPlan = buildCorpusReplayPlan(restricted)
assert.equal(restrictedPlan.counts.noEvaluableConversations, 1)
const restrictedResult = await replayCorpus(restricted, { provider, includeHoldout: true })
assert.equal(restrictedResult.counts.noEvaluable, 5)
assert.ok(restrictedResult.skipped.some(t => t.reasons.includes('media_unavailable')))
assert.ok(restrictedResult.skipped.some(t => t.reasons.includes('privacy_omitted')))
assert.ok(restrictedResult.skipped.some(t => t.reasons.includes('historical_choice_not_bound')))
assert.ok(restrictedResult.turns.some(t => t.contextIncomplete))
const interactive = await replayCorpus(restricted, { provider, includeHoldout: true, allowHistoricalInteractiveText: true })
assert.ok(interactive.turns.some(t => t.reasons.includes('counterfactual_interactive_text')))
assert.equal(interactive.counts.passed, 0)
const mismatch = structuredClone(input); mismatch.reviews.pop()
assert.throws(() => buildCorpusReplayPlan(mismatch), /review coverage/)
const wrongRef = structuredClone(input); wrongRef.reviews[0]!.findings[0]!.sourceMessageIds = ['invented']
assert.throws(() => buildCorpusReplayPlan(wrongRef), /review message reference/)
const late = structuredClone(input); late.corpus[0]!.messages[0]!.createdAt = late.corpus[0]!.cutoffExclusive
let guardCalls = 0
await assert.rejects(replayCorpus(late, { provider: async () => { guardCalls++; return {} } }), /cutoff/)
assert.equal(guardCalls, 0)
const backwards = structuredClone(input); backwards.corpus[0]!.messages.reverse()
assert.throws(() => buildCorpusReplayPlan(backwards), /chronological/)
const foreign = structuredClone(input); foreign.annotations.fixtures.salon!.businessId = 'real-business'
assert.throws(() => buildCorpusReplayPlan(foreign), /QA fixture/)
const invalidPrivacy = structuredClone(input); invalidPrivacy.reviews[0]!.privacyMessageIds = ['unknown']
assert.throws(() => buildCorpusReplayPlan(invalidPrivacy), /privacy reference/)
const unchanged = JSON.stringify(input)
const fallback = await replayCorpus(input, { provider: async () => { throw new Error('SECRET must not leak') }, includeHoldout: true, maxTurns: 1 })
assert.equal(JSON.stringify(input), unchanged)
assert.equal(fallback.counts.fallback, 1)
assert.equal(fallback.comprehensionEvaluated, false)
assert.equal(JSON.stringify(fallback).includes('SECRET'), false)
console.log('Corpus replay: PASS (independent expectations, isolation, order, clock, provenance, holdout, privacy/media/choices, unscored)')
