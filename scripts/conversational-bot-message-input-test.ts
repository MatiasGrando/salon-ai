import assert from 'node:assert/strict'
import { fallbackIndependentTurnPlan, initialDialogueState, parseDialogueState, respond, type DialogueDecision, type DialoguePort } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { parseTurnPlan, type TurnPlan } from '../src/conversational-bot/turn-plan.js'
import { matchContextualItems, matchNamedItems } from '../src/conversational-bot/contextual-matching.js'
import { parseServiceBasket } from '../src/conversational-bot/service-basket.js'
import { parseServiceRequestContext } from '../src/conversational-bot/service-request.js'
import { groundServicePlan } from '../src/conversational-bot/service-evidence-grounding.js'

const context = { businessId: 'message-input-qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-05T12:00:00Z') }
const service = { id: 'cut', name: 'Corte', durationMinutes: 30, requiresConsultation: false, price: 100 }
let agendaCalls = 0
const port: DialoguePort = {
  catalog: async () => [service],
  availability: async () => { agendaCalls++; return { professionals: [], slots: [] } }
}
const plan: TurnPlan = { version: 1, operations: [
  { kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, evidence: 'Corte', confidence: 1 },
  { kind: 'name', value: 'Alma', evidence: 'Alma', confidence: 1 }
] }
const decision: DialogueDecision = { serviceId: null, candidateIds: [], correction: false, intent: 'booking', turnPlan: plan }
const failures: string[] = []
let checks = 0
async function check(label: string, run: () => void | Promise<void>) {
  checks++
  try { await run() } catch (error) { failures.push(label + ': ' + (error instanceof Error ? error.message : String(error))) }
}

// Public text, semantic and sandbox paths all traverse their existing external-input gates.
for (const [label, separator] of [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r'], ['TAB', '\t'], ['combined', '\n\r\n\t']] as const) {
  for (const route of ['text', 'semantic', 'sandbox'] as const) {
    await check(label + '/' + route, async () => {
      const message = 'Corte' + separator + 'soy Alma'
      const before = initialDialogueState(context.businessId)
      const result = await respond({ ...context, ...(route === 'sandbox' ? { sandboxBooking: true } : {}) }, before,
        message, port, route === 'text' ? undefined : decision)
      assert.equal(result.state.serviceId, 'cut')
      if (route !== 'text') assert.equal(result.state.customerName, 'Alma')
      assert.equal(result.state.pending, 'date')
      assert.equal(result.proposal, null)
      assert.equal(result.bookingCommand, undefined)
      assert.equal(result.state.sandboxReservation, undefined)
      assert.deepEqual(before, initialDialogueState(context.businessId), 'caller draft is not mutated')
      assert.deepEqual(plan.operations.map(operation => operation.evidence), ['Corte', 'Alma'])
    })
  }
  await check(label + '/original-provider-input', async () => {
    const message = 'Corte' + separator + 'soy Alma'
    let observed: string | undefined
    let calls = 0
    const provider: AiInterpretationProvider = async input => {
      observed = input.message; calls++
      return { intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: plan }
    }
    const result = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), message, port, provider)
    assert.equal(observed, message, 'normal whitespace must not be stripped or substituted')
    assert.equal(calls, 1)
    assert.equal(result.interpretation.mode, 'ai')
    assert.equal(result.state.serviceId, 'cut')
    assert.equal(result.state.customerName, 'Alma')
    assert.equal(result.proposal, null)
  })
}

// Queries derived from customer text keep words separated, without changing semantic metadata.
const emptyDecision: DialogueDecision = { serviceId: null, candidateIds: [], correction: false, intent: 'booking', turnPlan: { version: 1, operations: [] } }
const multiwordService = { ...service, name: 'Corte hombre' }
const professional = { id: 'ana', name: 'Ana Luz', priority: 0 }
const professionalState = { ...initialDialogueState(context.businessId), serviceId: 'cut', date: '2026-10-05', pending: 'professional' as const, customerName: 'Alma' }
const professionalPort: DialoguePort = {
  catalog: async () => [service],
  professionalInformation: async () => ({ businessId: context.businessId, complete: true, professionals: [{ ...professional, services: [service], schedule: 'Lunes 09:00 a 18:00' }] }),
  availability: async (_service, date) => ({ professionals: [professional], slots: [{ startAt: '2026-10-05T20:00:00.000Z', date, time: '17:00', band: 'AFTERNOON', professionalId: professional.id, professionalName: professional.name, occupiedMinutes: 30 }] })
}
for (const separator of ['\n', '\r\n', '\r', '\t', '\n\r\n\t']) {
  for (const semantic of [false, true]) {
    await check('separated-service/' + JSON.stringify(separator) + '/' + semantic, async () => {
      const before = { ...initialDialogueState(context.businessId), ...(semantic ? { editRequest: { fields: ['service' as const] } } : {}) }
      const result = await respond(context, before, 'Corte' + separator + 'hombre', { ...port, catalog: async () => [multiwordService] }, semantic ? emptyDecision : undefined)
      assert.equal(result.state.serviceId, 'cut', 'formatting whitespace must separate words, not merge them')
      assert.equal(result.state.pending, 'date')
      assert.equal(result.proposal, null)
    })
    await check('separated-professional/' + JSON.stringify(separator) + '/' + semantic, async () => {
      const result = await respond(context, professionalState, 'Ana' + separator + 'Luz', professionalPort, semantic ? emptyDecision : undefined)
      assert.deepEqual(result.state.professional, { kind: 'specific', id: professional.id })
      assert.equal(result.state.customerName, 'Alma')
      assert.equal(result.proposal, null)
      assert.equal(result.bookingCommand, undefined)
      assert.deepEqual(professionalState.professional, null, 'caller draft is not mutated')
    })
  }
  await check('professional-provider-fallback/' + JSON.stringify(separator), async () => {
    const message = 'Ana' + separator + 'Luz'
    let observed: string | undefined
    const result = await respondWithAiInterpreter(context, professionalState, message, professionalPort, async input => { observed = input.message; throw new Error('synthetic unavailable interpreter') })
    assert.equal(observed, message)
    assert.equal(result.interpretation.mode, 'fallback')
    assert.deepEqual(result.state.professional, { kind: 'specific', id: professional.id })
    assert.equal(result.state.customerName, 'Alma')
    assert.equal(result.proposal, null)
  })
  await check('professional-information/' + JSON.stringify(separator), async () => {
    const informationTarget = { kind: 'professional' as const, actions: [] as const, mention: 'Ana Luz', serviceIds: [], date: null, weekday: null, aspect: 'overview' as const }
    const informationPlan: TurnPlan = { version: 1, operations: [{ kind: 'information', target: informationTarget, evidence: 'Ana Luz', confidence: 1 }] }
    const result = await respond(context, professionalState, '¿Quién es' + separator + 'Ana Luz?', professionalPort, { ...emptyDecision, intent: 'information', turnPlan: informationPlan })
    assert.match(result.reply, /Ana Luz/)
    assert.equal(result.state.professional, null, 'information is not booking preference')
    assert.equal(result.state.customerName, 'Alma')
    assert.equal(result.proposal, null)
    assert.equal(informationPlan.operations[0]!.evidence, 'Ana Luz')
  })
}
// Quotes are original customer text, not names or IDs. Formatting never adds catalog authority.
const requestBase = { purpose: 'inquiry' as const, disposition: 'needs_detail' as const, serviceIds: [], correction: false, continuation: false, basis: 'related_category' as const, sourceQuote: null }
const matchingScope = { businessId: context.businessId, category: 'service' as const }
const matchingItem = { ...matchingScope, id: 'cut', label: multiwordService.name }
for (const separator of ['\n', '\r\n', '\r', '\t', '\n\r\n\t']) {
  const quote = 'Corte' + separator + 'hombre'
  await check('query-original/' + JSON.stringify(separator), () => {
    assert.deepEqual(matchNamedItems(matchingScope, quote, [multiwordService]), matchNamedItems(matchingScope, 'Corte hombre', [multiwordService]))
    assert.notEqual(matchNamedItems(matchingScope, 'cor' + separator + 'te', [service]).kind, 'exact', 'formatting must not concatenate word fragments')
  })
  await check('quote-roundtrip/' + JSON.stringify(separator), () => {
    const quotedPlan: TurnPlan = { version: 1, operations: [{ kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, evidence: quote, confidence: 1 }] }
    assert.deepEqual(parseTurnPlan(quotedPlan, quote, ['cut']), quotedPlan)
    assert.deepEqual(groundServicePlan(quotedPlan, quote, [multiwordService]), quotedPlan, 'grounding preserves an already original quote')
    const basket = { version: 1, nextMemberId: 2, members: [{ memberId: 'm1', mode: 'single', serviceIds: ['cut'], evidence: quote }] }
    assert.deepEqual(parseServiceBasket(JSON.parse(JSON.stringify(basket))), basket)
    const state = { ...initialDialogueState(context.businessId), serviceId: 'cut', basket }
    assert.deepEqual(parseDialogueState(JSON.parse(JSON.stringify(state)), context.businessId).basket, basket)
    const request = { ...requestBase, businessId: context.businessId, request: quote }
    assert.deepEqual(parseServiceRequestContext(JSON.parse(JSON.stringify(request)), context.businessId), request)
    assert.deepEqual(parseDialogueState({ ...initialDialogueState(context.businessId), serviceRequest: request }, context.businessId).serviceRequest, request)
  })
  await check('request-intake/' + JSON.stringify(separator), async () => {
    const request = 'corte' + separator + 'francés'
    const requestPlan: TurnPlan = { version: 1, operations: [{ kind: 'service_request', ...requestBase, evidence: request, confidence: 1 }] }
    const result = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), request, port, async input => {
      assert.equal(input.message, request)
      return { intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: requestPlan }
    })
    assert.equal(result.interpretation.mode, 'ai')
    assert.equal(result.state.serviceRequest?.request, request)
    assert.equal(result.state.serviceId, null)
    assert.equal(result.proposal, null)
    assert.deepEqual(parseDialogueState(JSON.parse(JSON.stringify(result.state)), context.businessId).serviceRequest, result.state.serviceRequest)
  })
  await check('legacy-AI-quote/' + JSON.stringify(separator), async () => {
    let observed: string | undefined
    const result = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), quote, { ...port, catalog: async () => [multiwordService] }, async input => {
      observed = input.message
      return { intent: 'booking', serviceId: 'cut', serviceEvidence: quote, serviceConfidence: 'certain', professionalMention: null }
    })
    assert.equal(observed, quote)
    assert.equal(result.interpretation.mode, 'ai', 'legacy quote is validated separately from IDs and names')
    assert.equal(result.state.serviceId, 'cut')
    assert.equal(result.proposal, null)
  })
  await check('independent-fallback-quote/' + JSON.stringify(separator), () => {
    const message = 'con' + separator + 'Ana Luz'
    const result = fallbackIndependentTurnPlan(context, professionalState, message, [service])
    assert.deepEqual(result.operations, [{ kind: 'professional', mode: 'specific', mention: 'ana luz', evidence: message, confidence: 1 }])
  })
}
for (const quote of ['', ' \n\r\t ', 'x'.repeat(301), 'Corte\u0000hombre', 'Corte\u0007hombre', 'Corte\u000bhombre', 'Corte\u000chombre']) {
  await check('reject-quote/' + JSON.stringify(quote.slice(0, 15)), () => {
    assert.throws(() => parseTurnPlan({ version: 1, operations: [{ kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, evidence: quote, confidence: 1 }] }, quote, ['cut']), /evidence/)
    assert.throws(() => parseServiceBasket({ version: 1, nextMemberId: 2, members: [{ memberId: 'm1', mode: 'single', serviceIds: ['cut'], evidence: quote }] }), /invalid basket/)
    assert.throws(() => parseServiceRequestContext({ ...requestBase, businessId: context.businessId, request: quote }, context.businessId), /invalid service request/)
  })
}
await check('original-quote-limits', () => {
  const quote = 'Corte' + '\n'.repeat(295)
  const plan = { version: 1, operations: [{ kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, evidence: quote, confidence: 1 }] }
  assert.deepEqual(parseTurnPlan(plan, quote, ['cut']), plan)
  assert.throws(() => parseTurnPlan({ ...plan, operations: [{ ...plan.operations[0]!, evidence: quote + '\n' }] }, quote + '\n', ['cut']), /evidence/)
  const request = { ...requestBase, businessId: context.businessId, request: quote }
  assert.deepEqual(parseServiceRequestContext(request, context.businessId), request)
  assert.throws(() => parseServiceRequestContext({ ...request, request: quote + '\n' }, context.businessId), /scope/)
  assert.throws(() => parseServiceRequestContext(request, 'another-tenant'), /scope/)
  const query = 'Corte' + '\n'.repeat(1995)
  assert.equal(matchNamedItems(matchingScope, query, [service]).kind, 'exact')
  assert.throws(() => matchNamedItems(matchingScope, query + '\n', [service]), /invalid matching input/)
})
for (let code = 0; code < 32; code++) {
  if ([9, 10, 13].includes(code)) continue
  const quote = 'Corte' + String.fromCharCode(code) + 'hombre'
  await check('reject-quote-C0/' + code, () => {
    assert.throws(() => parseTurnPlan({ version: 1, operations: [{ kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, evidence: quote, confidence: 1 }] }, quote, ['cut']), /evidence/)
    assert.throws(() => parseServiceBasket({ version: 1, nextMemberId: 2, members: [{ memberId: 'm1', mode: 'single', serviceIds: ['cut'], evidence: quote }] }), /invalid basket/)
    assert.throws(() => parseServiceRequestContext({ ...requestBase, businessId: context.businessId, request: quote }, context.businessId), /invalid service request/)
    assert.throws(() => matchNamedItems(matchingScope, quote, [multiwordService]), /invalid matching input/)
  })
}
for (const confidence of [-0.1, 1.1, NaN, Infinity]) {
  await check('invalid-confidence/' + confidence, () => {
    assert.throws(() => parseTurnPlan({ version: 1, operations: [{ kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, evidence: 'Corte\nhombre', confidence }] }, 'Corte\nhombre', ['cut']), /confidence/)
  })
}
for (const separator of ['\n', '\r', '\t', '\u0000', '\u0007', '\u000b', '\u000c']) {
  for (const field of ['serviceId', 'professionalMention'] as const) {
    await check('legacy-metadata/' + field + '/' + separator.charCodeAt(0), async () => {
      const result = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'Corte hombre', { ...port, catalog: async () => [multiwordService] }, async () => ({ intent: 'booking', serviceId: 'cut', serviceEvidence: 'Corte hombre', professionalMention: null, [field]: (field === 'serviceId' ? 'cut' : 'Ana') + separator }))
      assert.equal(result.interpretation.mode, 'fallback', 'customer quote formatting cannot rescue corrupt metadata')
      assert.equal(result.proposal, null)
    })
  }
}
await check('foreign-evidence', () => {
  assert.throws(() => parseTurnPlan({ version: 1, operations: [{ kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, evidence: 'Corte\nhombre', confidence: 1 }] }, 'Corte mujer', ['cut']), /evidence/)
})
for (const separator of ['\n', '\r', '\t', '\u0000', '\u0007', '\u000b', '\u000c']) {
  await check('strict-matching-metadata/' + separator.charCodeAt(0), () => {
    assert.throws(() => matchContextualItems({ ...matchingScope, businessId: context.businessId + separator }, 'Corte hombre', [matchingItem]), /invalid matching input/)
    for (const item of [{ ...matchingItem, id: 'cut' + separator }, { ...matchingItem, label: 'Corte' + separator + 'hombre' }, { ...matchingItem, aliases: ['Corte' + separator + 'hombre'] }]) {
      assert.throws(() => matchContextualItems(matchingScope, 'Corte hombre', [item]), /invalid matching catalogue/)
    }
    assert.throws(() => parseServiceRequestContext({ ...requestBase, businessId: context.businessId, request: 'Corte hombre', sourceQuote: 'Corte' + separator + 'hombre' }, context.businessId), /invalid service request/)
    assert.throws(() => parseTurnPlan({ version: 1, operations: [{ kind: 'date', expression: 'hoy' + separator, evidence: 'hoy', value: '2026-10-05', confidence: 1 }] }, 'hoy'), /date/)
  })
}
for (const quote of [' ', 'x'.repeat(129), 'Corte\u0000hombre', 'Corte\u0007hombre', 'Corte\u000bhombre', 'Corte\u000chombre', 'Barba']) {
  await check('legacy-invalid-quote/' + JSON.stringify(quote.slice(0, 15)), async () => {
    const result = await respondWithAiInterpreter(context, initialDialogueState(context.businessId), 'Corte hombre', { ...port, catalog: async () => [multiwordService] }, async () => ({ intent: 'booking', serviceId: 'cut', serviceEvidence: quote, professionalMention: null }))
    assert.equal(result.interpretation.mode, 'fallback')
    assert.equal(result.proposal, null)
  })
}
for (const [label, message] of [
  ['empty', ''], ['whitespace', ' \n\r\t '], ['length', 'x'.repeat(2001)], ['original-length', 'Corte' + ' '.repeat(1996)],
  ['NUL', 'Corte\u0000Alma'], ['BEL', 'Corte\u0007Alma'], ['VT', 'Corte\u000bAlma'], ['FF', 'Corte\u000cAlma'],
  ['leading-NUL', '\u0000Corte'], ['trailing-BEL', 'Corte\u0007']
] as const) {
  await check('reject/' + label, async () => {
    for (const route of ['text', 'semantic', 'sandbox'] as const) {
      await assert.rejects(respond({ ...context, ...(route === 'sandbox' ? { sandboxBooking: true } : {}) }, initialDialogueState(context.businessId), message, port, route === 'text' ? undefined : decision), /invalid dialogue input/)
    }
  })
}
for (let code = 0; code < 32; code++) {
  if ([9, 10, 13].includes(code)) continue
  await check('reject-C0/' + code, async () => {
    for (const route of ['text', 'semantic', 'sandbox'] as const) {
      await assert.rejects(respond({ ...context, ...(route === 'sandbox' ? { sandboxBooking: true } : {}) }, initialDialogueState(context.businessId), 'Corte' + String.fromCharCode(code) + 'Alma', port, route === 'text' ? undefined : decision), /invalid dialogue input/)
    }
  })
}
await check('limit-2000', async () => {
  const result = await respond(context, initialDialogueState(context.businessId), 'x'.repeat(2000), port)
  assert.equal(result.proposal, null)
})
await check('invalid-clock', async () => {
  await assert.rejects(respond({ ...context, dbNow: new Date(NaN) }, initialDialogueState(context.businessId), 'Corte', port), /invalid dialogue input/)
})

// Customer-message whitespace is not permission to loosen metadata, state, IDs or literal evidence.
for (const separator of ['\n', '\r', '\t', '\u0000', '\u0007']) {
  await check('metadata/' + separator.charCodeAt(0), async () => {
    assert.throws(() => parseDialogueState({ ...initialDialogueState(context.businessId), serviceId: 'cut' + separator }, context.businessId), /invalid dialogue field/)
    assert.throws(() => parseDialogueState({ ...initialDialogueState(context.businessId), customerName: 'Alma' + separator }, context.businessId), /invalid dialogue field/)
    assert.throws(() => parseDialogueState(initialDialogueState('tenant' + separator), 'tenant' + separator), /invalid dialogue scope/)
    await assert.rejects(respond(context, initialDialogueState(context.businessId), 'Corte', {
      ...port, catalog: async () => [{ ...service, id: 'cut' + separator }]
    }), /invalid dialogue catalog/)
    await assert.rejects(respond(context, initialDialogueState(context.businessId), 'Corte', {
      ...port, catalog: async () => [{ ...service, name: 'Corte' + separator }]
    }), /invalid dialogue catalog/)
    assert.throws(() => parseTurnPlan({ version: 1, operations: [{
      kind: 'name', value: 'Alma' + separator, evidence: 'Alma', confidence: 1
    }] }, 'Alma'), /invalid turn plan/)
    const quotedPlan = { version: 1, operations: [{ kind: 'name', value: 'Alma', evidence: 'soy' + separator + 'Alma', confidence: 1 }] }
    if ([9, 10, 13].includes(separator.charCodeAt(0))) {
      assert.deepEqual(parseTurnPlan(quotedPlan, 'soy' + separator + 'Alma'), quotedPlan, 'ordinary quote formatting is accepted unchanged by explicit contract decision')
    } else assert.throws(() => parseTurnPlan(quotedPlan, 'soy' + separator + 'Alma'), /evidence/)
  })
}
assert.equal(agendaCalls, 0, 'input validation and draft intake cannot create availability or booking effects')
assert.deepEqual(failures, [], failures.join('\n'))
console.log('message-input: PASS (' + checks + ' checks; synthetic/offline only)')
