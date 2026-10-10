import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import { replyContract, validateReplyDraft, projectValidatedReplyFrame, type ReplyRejection } from '../src/conversational-bot/reply-contract.js'
import { initialDialogueState, type DialoguePort, type DialogueService } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { selectionBasket } from '../src/conversational-bot/service-basket.js'

// All model outputs are controlled doubles. This suite has no external transport.
const original = { fetch: globalThis.fetch, request: http.request, httpsRequest: https.request, get: http.get, httpsGet: https.get }
const forbidden = () => { throw new Error('external transport forbidden in reply isolation regression') }
globalThis.fetch = forbidden; http.request = forbidden as typeof http.request; https.request = forbidden as typeof https.request
http.get = forbidden as typeof http.get; https.get = forbidden as typeof https.get
const facts = [{ id: 'catalog', text: 'Información publicada:\nKeratina: suavidad.' }, { id: 'next', text: '¿Qué más querés saber sobre este servicio?' }]
const policy = replyContract('information', true, false, facts)
const description = 'Keratina aporta suavidad. El resultado depende del cabello.'
const generalText = 'Los nombres de los tratamientos pueden variar entre productos y salones; conviene comparar sus objetivos.'
const publishedText = 'Keratina aporta suavidad y sus resultados dependen del cabello.'
const catalog = { aspect: 'comparison' as const, generalKnowledgeAllowed: true as const,
  services: [{ id: 'keratin', name: 'Keratina', description }] }
const blocks = [
  { kind: 'general', text: generalText, sources: [] },
  { kind: 'published', text: publishedText, sources: [{ serviceId: 'keratin', field: 'description', quote: description }] }
]
const draft = (opening: string | null) => ({ salutation: null, opening, factIds: null, closing: null, variantChoices: null,
  catalogAnswer: { blocks: structuredClone(blocks) } })
const failures: string[] = []; let passed = 0
const check = async (name: string, run: () => void | Promise<void>) => {
  try { await run(); passed++; console.log('PASS reply isolation ' + name) }
  catch (error) { failures.push(name); console.error('RED reply isolation ' + name + ': ' + String(error)) }
}
const openings: readonly [string, ReplyRejection][] = [
  ['Soy Otra, de Otro Local.', 'identity_in_frame'],
  ['Cuesta $999.', 'unverified_value'],
  ['Ya reservé y confirmé el turno.', 'unverified_action'],
  ['Te explico Keratina.', 'catalog_in_frame'],
  ['Claro. ¿Y vos cómo venís?', 'continuation_conflict'],
  ['Claro. ¿Qué día querés reservar?', 'continuation_conflict']
]
try {
  await check('a valid explanatory body survives complete discard of unsafe optional opening', () => {
    for (const [opening, reason] of openings) {
      const raw = { ...draft(opening), salutation: 'greeting' }; const before = structuredClone(raw)
      const result = validateReplyDraft(raw, facts, { ...policy, introduction: 'server_complete' }, ['Keratina'], catalog)
      assert.equal(result.validation.status, 'accepted', reason + ': safe final assembly is accepted')
      assert.equal(result.validation.reason, null)
      assert.equal((result.validation as any).discardedFramingReason, reason)
      assert.ok(result.text!.includes(generalText)); assert.ok(result.text!.includes(publishedText))
      assert.ok(!result.text!.includes(opening), 'discard the entire unsafe opening, not selected words')
      assert.ok(!result.text!.includes('¡Hola!'), 'typed salutation is also part of the discarded original frame')
      assert.equal(result.text!.split(facts[1]!.text).length - 1, 1, 'one unchanged server continuation')
      assert.equal(result.validatedFraming, undefined, 'the original frame grants no projection authority')
      assert.equal(result.openingText, undefined)
      assert.equal(projectValidatedReplyFrame(result, facts[1]), null)
      assert.equal(result.modelFraming, true, 'the validated body remains AI-authored')
      assert.deepEqual(raw, before, 'validation does not rewrite an untrusted draft')
      assert.deepEqual(Object.keys(result.validation).sort(), ['discardedFramingReason', 'factCount', 'providedCount', 'reason', 'status'])
      assert.doesNotMatch(JSON.stringify(result.validation), /Otra|Local|999|Keratina|cómo venís/)
    }
  })
  await check('discarding an optional frame preserves every server fact and reviewed variant in order', () => {
    const condition = { id: 'condition', text: 'Precio publicado: $32.000.', variants: [{ id: 'reviewed', text: 'Valor publicado: $32.000.' }] }
    const next = { id: 'next', text: '¿Qué más querés saber?', variants: [{ id: 'reviewed', text: '¿Necesitás otro detalle?' }] }
    const material = [facts[0]!, condition, next]
    const raw = { ...draft('Cuesta $999.'), variantChoices: [{ factId: 'condition', variantId: 'reviewed' }, { factId: 'next', variantId: 'reviewed' }] }
    const result = validateReplyDraft(raw, material, replyContract('information', false, false, material), ['Keratina'], catalog)
    assert.equal(result.validation.status, 'accepted')
    assert.ok(result.text!.includes(generalText)); assert.ok(result.text!.includes(publishedText))
    assert.equal(result.text!.split(condition.variants[0]!.text).length - 1, 1)
    assert.equal(result.text!.split(next.variants[0]!.text).length - 1, 1)
    assert.ok(result.text!.indexOf(publishedText) < result.text!.indexOf(condition.variants[0]!.text))
    assert.ok(result.text!.indexOf(condition.variants[0]!.text) < result.text!.indexOf(next.variants[0]!.text))
    assert.ok(!result.text!.includes(raw.opening!)); assert.equal(result.validatedFraming, undefined)
  })
  await check('AI authorship counts a validated catalog body even without an opening', () => {
    const result = validateReplyDraft(draft(null), facts, policy, ['Keratina'], catalog)
    assert.equal(result.validation.status, 'accepted'); assert.equal(result.modelFraming, true)
    assert.equal((result.validation as any).discardedFramingReason, undefined)
    assert.ok(result.text!.includes(generalText)); assert.ok(result.text!.includes(publishedText))
  })
  await check('invalid body plus rejected opening never becomes a partial valid explanation', () => {
    for (const badBlocks of [
      [{ kind: 'general', text: 'Nuestro tratamiento garantiza resultados.', sources: [] }],
      [blocks[0], { ...blocks[1], sources: [{ serviceId: 'keratin', field: 'description', quote: 'Afirmación inventada.' }] }],
      [blocks[0]],
      [{ kind: 'general', text: 'El procedimiento cuesta $999.', sources: [] }],
      [{ ...blocks[1], sources: [{ serviceId: 'foreign', field: 'description', quote: description }] }]
    ]) {
      const raw = { ...draft('Soy Otra.'), catalogAnswer: { blocks: badBlocks } }
      const result = validateReplyDraft(raw, facts, policy, ['Keratina'], catalog)
      assert.equal(result.validation.status, 'rejected'); assert.equal(result.text, null)
      assert.equal((result.validation as any).discardedFramingReason, undefined)
      assert.equal(result.validatedFraming, undefined); assert.equal(result.modelFraming, false)
    }
  })
  await check('shape facts order variants closing neutral and resource limits remain fail-closed', () => {
    for (const [raw, contract, reason] of [
      [{ ...draft('Soy Otra.'), foreign: true }, policy, 'invalid_shape'],
      [{ ...draft('Soy Otra.'), salutation: 'Soy Otra' }, policy, 'invalid_shape'],
      [{ ...draft('Soy Otra.'), factIds: ['next'] }, policy, 'fact_membership'],
      [{ ...draft('Soy Otra.'), factIds: ['next', 'catalog'] }, policy, 'fact_order'],
      [{ ...draft('Soy Otra.'), variantChoices: [{ factId: 'catalog', variantId: 'foreign' }] }, policy, 'fact_membership'],
      [{ ...draft('Soy Otra.'), closing: 'Otra pregunta.' }, policy, 'continuation_conflict'],
      [draft('Soy Otra.'), { ...policy, neutral: true }, 'neutral_frame'],
      [draft('x'.repeat(181)), policy, 'frame_bounds'],
      [draft('texto\u0000'), policy, 'frame_bounds']
    ] as const) {
      const result = validateReplyDraft(raw, facts, contract, ['Keratina'], catalog)
      assert.equal(result.validation.status, 'rejected', reason)
      assert.equal(result.validation.reason, reason); assert.equal(result.text, null)
      assert.equal((result.validation as any).discardedFramingReason, undefined)
    }
  })
  await check('absence of a valid explanatory context preserves legacy rejection behavior', () => {
    for (const [opening, reason] of openings) {
      const raw = { ...draft(opening), catalogAnswer: null }
      const result = validateReplyDraft(raw, facts, policy, ['Keratina'])
      assert.equal(result.validation.status, 'rejected'); assert.equal(result.validation.reason, reason)
      assert.equal(result.text, null); assert.equal((result.validation as any).discardedFramingReason, undefined)
    }
    const noContext = validateReplyDraft(draft('Soy Otra.'), facts, policy, ['Keratina'])
    assert.equal(noContext.validation.status, 'rejected'); assert.equal(noContext.text, null)
  })
  await check('safe original framing remains present and projectable alongside valid catalog copy', () => {
    const opening = 'Claro, te explico.'
    const result = validateReplyDraft(draft(opening), facts, policy, ['Keratina'], catalog)
    assert.equal(result.validation.status, 'accepted'); assert.ok(result.text!.includes(opening))
    assert.equal(result.validatedFraming?.opening, opening)
    assert.equal((result.validation as any).discardedFramingReason, undefined)
    assert.equal(projectValidatedReplyFrame(result, facts[1])?.openingText, opening)
  })
  await check('isolated body reaches the first-call route without acquiring or querying an appointment', async () => {
    const context = { businessId: 'reply-isolation', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-10T15:00:00Z') }
    const state = initialDialogueState(context.businessId)
    const services: DialogueService[] = [{ id: 'keratin', name: 'Keratina', description, price: 32000, durationMinutes: 60, requiresConsultation: false }]
    let calls = 0, responseCalls = 0, availabilityCalls = 0
    const port: DialoguePort = { catalog: async () => services,
      identity: async () => ({ businessId: context.businessId, assistantName: 'Alba', businessName: 'Demo', treatment: 'vos', greetingEmoji: '😊' }),
      availability: async () => { availabilityCalls++; throw new Error('informative read cannot query appointments') },
      availabilityBasket: async () => { availabilityCalls++; throw new Error('informative read cannot coordinate appointments') } }
    const message = 'Explicame en general qué es Keratina y qué ofrece el local'
    const provider: AiInterpretationProvider = Object.assign(async () => {
      calls++
      return { intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null,
        turnPlan: { version: 1, operations: [{ kind: 'information', target: { kind: 'service', actions: [], serviceIds: ['keratin'], aspect: 'description' }, evidence: message, confidence: 1 }] },
        communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: message, confidence: 1, mention: 'Keratina', operationIndexes: [0] }] },
        firstReply: draft('Soy Otra, de Otro Local.') }
    }, { respond: async () => { responseCalls++; throw new Error('valid first-call body needs no extra composition') } })
    const result = await respondWithAiInterpreter(context, state, message, port, provider)
    assert.ok(result.reply.includes(generalText)); assert.ok(result.reply.includes(publishedText))
    assert.doesNotMatch(result.reply, /Soy Otra|Otro Local/)
    assert.equal(result.reply.split('Soy Alba').length - 1, 1, 'server introduction stays authoritative')
    assert.equal(result.interpretation.replyRoute, 'first_call'); assert.equal(result.interpretation.copyMode, 'ai')
    assert.equal(result.interpretation.replyValidation?.firstCall.status, 'accepted')
    assert.equal((result.interpretation.replyValidation?.firstCall as any).discardedFramingReason, 'identity_in_frame')
    assert.equal(calls, 1); assert.equal(responseCalls, 0); assert.equal(result.interpretation.aiCalls, 1)
    assert.equal(availabilityCalls, 0); assert.deepEqual(selectionBasket(result.state), selectionBasket(state))
    for (const key of ['serviceId', 'date', 'professional', 'customerName', 'pending', 'slot', 'referral', 'bookingReservation'] as const)
      assert.deepEqual(result.state[key], state[key], 'informative body preserves ' + key)
    assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined); assert.equal(result.handoffCommand, undefined)
  })
  console.log('reply isolation: ' + passed + ' PASS / ' + failures.length + ' FAIL (offline controlled proposals)')
  assert.deepEqual(failures, [], 'independent explanatory body and framing regressions')
} finally {
  globalThis.fetch = original.fetch; http.request = original.request; https.request = original.httpsRequest
  http.get = original.get; https.get = original.httpsGet
}
