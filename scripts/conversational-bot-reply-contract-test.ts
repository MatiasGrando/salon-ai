import { runConversationalPreview } from '../src/conversational-bot/demo-preview.js'
import { replyContract, validateReplyDraft, projectValidatedReplyFrame, REPLY_CONTRACT_INSTRUCTIONS } from '../src/conversational-bot/reply-contract.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { createOpenAiResponseProvider } from '../src/conversational-bot/openai-response-provider.js'
import assert from 'node:assert/strict'
import { initialDialogueState, hasActiveBooking, type DialoguePort } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationInput, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
const context = { businessId: 'tenant', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-03T12:00:00Z') }
const port: DialoguePort = { catalog: async () => [], availability: async () => { throw new Error('agenda forbidden') }, identity: async () => ({ businessId: 'tenant', assistantName: 'Alba', businessName: 'Local', treatment: 'vos', greetingEmoji: '😊' }) }
const base = { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null }
globalThis.fetch = (() => { throw new Error('network forbidden') }) as typeof fetch
async function main() {
  for (const draft of ['null', 'empty', 'valid', 'unsafe'] as const) {
    let calls = 0
    const provider: AiInterpretationProvider = Object.assign(async (input: AiInterpretationInput) => { calls++; return { ...base, firstReply: draft === 'null' ? null : { opening: draft === 'unsafe' ? 'Reservado por $123' : null, closing: null, factIds: draft === 'empty' ? [] : input.firstReplyFacts!.map(fact => fact.id) } } }, { respond: async () => { calls++; throw new Error('unnecessary second call') } })
    const response = await respondWithAiInterpreter(context, initialDialogueState('tenant'), 'hola', port, provider)
    assert.equal(calls, 1, draft + ': stable social reply must not need a second call')
    assert.equal(response.interpretation.aiCalls, 1)
    assert.equal(response.reply, '¡Holaa! 😊 Soy Alba, de Local.\n\n¿En qué te puedo ayudar?')
    assert.equal(hasActiveBooking(response.state), false)
    assert.equal(response.state.introduced, true)
    assert.equal(response.interpretation.replyValidation?.firstCall.status, draft === 'valid' ? 'accepted' : 'rejected')
    assert.equal(response.interpretation.replyValidation?.secondCall.status, 'not_attempted')
    assert.doesNotMatch(JSON.stringify(response.interpretation.replyValidation), /Alba|Local|Reservado|123|tenant/)
    assert.equal(response.interpretation.copyMode, 'fallback', 'server-owned body without model framing is not AI copy')
  }
  const provider: AiInterpretationProvider = async input => ({ ...base, firstReply: { opening: 'Hola, ¿cómo estás?', factIds: input.firstReplyFacts!.map(fact => fact.id), closing: null } })
  const subsequent = await respondWithAiInterpreter(context, { ...initialDialogueState('tenant'), introduced: true }, 'hola de nuevo', port, provider)
  assert.match(subsequent.reply, /Hola, ¿cómo estás\?/)
  assert.doesNotMatch(subsequent.reply, /Soy Alba/)
  assert.equal(subsequent.interpretation.copyMode, 'ai')
  assert.equal(subsequent.interpretation.aiCalls, 1)
  const facts = [{ id: 'data', text: 'Dato verificado.' }, { id: 'next', text: '¿Qué día?' }]
  const policy = replyContract('continuation', true, true, facts)
  const draft = { opening: 'Hola, seguimos cuando quieras.', factIds: ['data', 'next'], closing: null }
  assert.equal(validateReplyDraft(draft, facts, policy, []).validation.status, 'accepted')
  const serverMaterial = validateReplyDraft({ ...draft, factIds: null }, facts, policy, [])
  assert.equal(serverMaterial.validation.status, 'accepted')
  assert.equal(serverMaterial.text, validateReplyDraft(draft, facts, policy, []).text)
  assert.equal(serverMaterial.validation.providedCount, 0, 'server assembly is not a model-provided list')
  for (const [bad, reason] of [
    [null, 'missing_draft'], [{ ...draft, factIds: ['next', 'data'] }, 'fact_order'], [{ ...draft, factIds: ['foreign', 'next'] }, 'fact_membership'],
    [{ ...draft, opening: 'Cuesta $999' }, 'unverified_value'], [{ ...draft, opening: 'Reservado' }, 'unverified_action'],
    [{ ...draft, opening: 'Soy otra asistente' }, 'identity_in_frame'], [{ ...draft, closing: '¿Otra pregunta?' }, 'continuation_conflict']
  ] as const) assert.equal(validateReplyDraft(bad, facts, policy, []).validation.reason, reason)
  let requests: Record<string, any>[] = []
  const fakeFetch: typeof fetch = async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(base) }] }] }), { status: 200 }) }
  await createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl: fakeFetch })({ message: 'hola', state: initialDialogueState('tenant'), services: [], firstReplyFacts: facts, replyContract: policy }, new AbortController().signal)
  await createOpenAiResponseProvider({ apiKey: 'fake-only', fetchImpl: fakeFetch })({ message: 'hola', intent: 'other', state: initialDialogueState('tenant'), facts, replyContract: policy }, new AbortController().signal)
  for (const request of requests) { assert.ok(request.instructions.includes(REPLY_CONTRACT_INSTRUCTIONS)); assert.deepEqual(JSON.parse(request.input).replyContract, policy); assert.equal(request.store, false) }
  assert.match(REPLY_CONTRACT_INSTRUCTIONS, /neutral.*opening.*null/i, 'neutral policy must be in the shared prompt')
  assert.equal(validateReplyDraft({ ...draft, opening: null }, facts, { ...policy, neutral: true }, []).validation.status, 'accepted')
  assert.equal(validateReplyDraft(draft, facts, { ...policy, neutral: true }, []).validation.reason, 'neutral_frame')
  const bookingPort: DialoguePort = { ...port, availability: async () => ({ professionals: [], slots: [] }), catalog: async () => [{ id: 'cut', name: 'Corte', price: 12000, priceMode: 'FIXED', durationMinutes: 30, requiresConsultation: false }] }
  const booking = { ...base, intent: 'booking', serviceId: 'cut', serviceEvidence: 'Corte', serviceConfidence: 'certain' }
  for (const failure of ['provider_error', 'timeout'] as const) {
    const result = await respondWithAiInterpreter(context, initialDialogueState('tenant'), 'Corte mañana', bookingPort, async () => booking, {
      timeoutMs: 20, responseProvider: async () => { if (failure === 'timeout') return new Promise(() => {}); throw new Error('PRIVATE_PROVIDER_TEXT') }
    })
    assert.equal(result.interpretation.aiCalls, 2, 'new motor facts alone permit another call')
    assert.equal(result.interpretation.replyValidation?.secondCall.status, 'rejected')
    assert.equal(result.interpretation.replyValidation?.secondCall.reason, failure)
    assert.doesNotMatch(JSON.stringify(result.interpretation.replyValidation), /PRIVATE|Corte|cut|tenant/)
  }
  const intakeMismatch = await respondWithAiInterpreter(context, initialDialogueState('tenant'), 'Corte', bookingPort,
    async () => ({ ...booking, intakeReply: { opening: null, closing: null, pending: 'service', serviceId: null, candidateIds: [] } }),
    { responseProvider: async input => ({ opening: null, closing: null, factIds: input.facts.map(fact => fact.id) }) })
  assert.equal(intakeMismatch.interpretation.replyValidation?.firstCall.status, 'rejected')
  assert.equal(intakeMismatch.interpretation.replyValidation?.firstCall.reason, 'intake_mismatch')
  const focusState = { ...initialDialogueState('tenant'), introduced: true, informationFocus: { version: 1 as const, businessId: 'tenant', topic: 'details' as const, aspect: 'overview' as const, serviceId: 'cut', awaitingChoice: false, candidateId: null, options: [{ id: 'cut', label: 'Corte' }] } }
  let followupCalls = 0, followupAgendaCalls = 0
  const followupPort: DialoguePort = { ...bookingPort, availability: async () => { followupAgendaCalls++; throw new Error('informational focus cannot query agenda') }, catalog: async () => [{ id: 'cut', name: 'Corte', description: 'Lavado verificado.', price: 12000, priceMode: 'FIXED', durationMinutes: 30, requiresConsultation: false }] }
  const followupProvider: AiInterpretationProvider = Object.assign(async (input: AiInterpretationInput) => {
    followupCalls++
    assert.equal(input.replyContract?.role, 'information', 'prepared focus read determines the reply role')
    assert.ok(input.firstReplyFacts?.some(fact => fact.text.includes('Lavado verificado.')))
    return { ...base, intent: 'information', firstReply: { opening: 'Claro, ¿cómo estás?', closing: null, factIds: input.firstReplyFacts!.map(fact => fact.id) } }
  }, { respond: async () => { throw new Error('prepared followup must not recompose') } })
  const followup = await respondWithAiInterpreter(context, focusState, '¿Qué incluye?', followupPort, followupProvider)
  assert.equal(followupCalls, 1)
  assert.equal(followupAgendaCalls, 0)
  assert.equal(followup.interpretation.copyMode, 'fallback', 'a published booking invitation keeps its canonical guard')
  assert.equal(followup.interpretation.replyRoute, 'motor')
  assert.equal(followup.interpretation.aiCalls, 1)
  assert.equal(followup.interpretation.replyValidation?.firstCall.reason, 'canonical_only')
  assert.deepEqual(followup.state.questionContext?.matchCandidateIds, ['cut'])
  assert.match(followup.reply, /¿Querés agendar Corte\?$/)
  assert.equal(followup.proposal, null)
  assert.equal(followup.bookingCommand, undefined)
  assert.match(followup.reply, /Lavado verificado\./)
  assert.equal(hasActiveBooking(followup.state), false)
  assert.equal(followup.state.serviceId, null)
  assert.equal(followup.state.informationFocus?.serviceId, 'cut')
  assert.equal(followup.state.basket, undefined)
  assert.equal(followup.state.serviceEstimates, undefined)
  const { questionContext: invitation, informationFocus: followupFocus, ...followupEntities } = followup.state
  const { informationFocus: originalFocus, ...originalEntities } = focusState
  assert.deepEqual(followupEntities, originalEntities)
  assert.deepEqual(followupFocus, { ...originalFocus, aspect: 'description' }, 'the read narrows only the informational aspect')
  assert.ok(invitation?.options.some(option => option.id === 'cut' && option.label === 'Corte'))
  let generalCalls = 0, generalAgendaCalls = 0
  const general = await respondWithAiInterpreter(context, focusState, 'horarios del local', { ...followupPort,
    information: async () => ({ businessId: 'tenant', name: 'Local', hours: 'Martes: 11:00 a 20:00', address: null, area: null, mapsUrl: null, website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null }),
    availability: async () => { generalAgendaCalls++; throw new Error('informational agenda forbidden') }
  }, async input => {
    generalCalls++
    return { ...base, intent: 'information', informationTarget: { kind: 'business', actions: ['HOURS'] }, firstReply: { opening: 'Claro, te cuento.', closing: null, factIds: input.firstReplyFacts!.map(fact => fact.id) } }
  })
  assert.equal(generalCalls, 1)
  assert.equal(generalAgendaCalls, 0)
  assert.equal(general.interpretation.copyMode, 'ai', 'unprotected information still reuses safe first-call framing')
  assert.equal(general.interpretation.replyRoute, 'first_call')
  assert.equal(general.interpretation.replyValidation?.firstCall.status, 'accepted')
  assert.match(general.reply, /Claro, te cuento\./)
  assert.match(general.reply, /Martes: 11:00 a 20:00/)
  assert.equal((general.reply.match(/¿En qué más te puedo ayudar\?/g) ?? []).length, 1)
  assert.deepEqual(general.state, focusState)
  assert.equal(general.proposal, null)
  assert.equal(typeof JSON.parse(requests[1]!.input).expectedAnswer, 'object', 'both providers receive the structured pending answer')
  let saved = 0
  const preview = await runConversationalPreview({ load: async () => ({ ...initialDialogueState('tenant'), introduced: true }), save: async () => { saved++ }, createPort: async () => ({ context, port }), interpretationProvider: provider }, 'tenant', 'fixture-only', 'hola')
  assert.equal(saved, 1)
  assert.ok('replyValidation' in preview.interpretation)
  assert.deepEqual(preview.interpretation.replyValidation, subsequent.interpretation.replyValidation)
  assert.doesNotMatch(JSON.stringify(preview.interpretation.replyValidation), /Alba|Local|fixture-only|tenant|hola/)
  const copyFailures: string[] = []
  const copyCheck = (name: string, body: () => void) => { try { body(); console.log('PASS continuation ' + name) }
    catch (error) { copyFailures.push(name); console.error('RED continuation ' + name + ': ' + (error instanceof Error ? error.message.split('\n')[0] : String(error))) } }
  for (const next of ['¿En qué te puedo ayudar con el local?', '¿Qué día preferís?', '¿Necesitás otra información?']) {
    const actual = [{ id: 'next', text: next }], rule = replyContract('social', true, true, actual)
    copyCheck('exact known suffix ' + next, () => {
      const raw = { salutation: null, opening: '¡De nada! ' + next, factIds: ['next'], closing: null }
      const saved = structuredClone(raw), result = validateReplyDraft(raw, actual, rule, [])
      assert.equal(result.validation.status, 'accepted'); assert.equal(result.openingText, '¡De nada!')
      assert.equal(result.text, '¡De nada!\n' + next); assert.deepEqual(raw, saved)
    })
    copyCheck('known question only ' + next, () => {
      const result = validateReplyDraft({ opening: next, factIds: ['next'], closing: null }, actual, rule, [])
      assert.equal(result.validation.status, 'accepted'); assert.equal(result.openingText, '')
      assert.equal(result.text, next)
    })
    copyCheck('ambiguous duplicates reject ' + next, () => {
      for (const opening of [next + ' Seguimos.', 'Dijiste «' + next + '»', 'No quiero ' + next, 'Gracias. ' + next + ' ' + next])
        assert.equal(validateReplyDraft({ opening, factIds: ['next'], closing: null }, actual, rule, []).validation.reason, 'continuation_conflict')
    })
    copyCheck('distinct social question remains ' + next, () => {
      const opening = 'Gracias, ¿cómo estás vos?'
      assert.equal(validateReplyDraft({ opening, factIds: ['next'], closing: null }, actual, rule, []).text, opening + '\n' + next)
    })
  }
  copyCheck('selected next variant is current, canonical next is not rewritten', () => {
    const actual = [{ id: 'next', text: '¿Qué día preferís?', variants: [{ id: 'gentle', text: '¿Para qué día te gustaría?' }] }]
    const raw = { salutation: 'greeting', opening: 'Gracias. ¿Para qué día te gustaría?', factIds: ['next'], closing: null,
      variantChoices: [{ factId: 'next', variantId: 'gentle' }] }
    const result = validateReplyDraft(raw, actual, replyContract('social', true, true, actual), [])
    assert.equal(result.text, '¡Hola!\nGracias.\n¿Para qué día te gustaría?')
    assert.equal(result.openingText, '¡Hola!\nGracias.')
    assert.equal(actual[0]!.text, '¿Qué día preferís?')
  })
  copyCheck('original safety guards run before any suffix removal', () => {
    const next = '¿Qué día preferís?', actual = [{ id: 'next', text: next }], rule = replyContract('social', true, true, actual)
    for (const [prefix, reason] of [['Cuesta $100.', 'unverified_value'], ['Reservado.', 'unverified_action'], ['Soy Otra.', 'identity_in_frame'], ['Corte mujer.', 'catalog_in_frame']] as const)
      assert.equal(validateReplyDraft({ opening: prefix + ' ' + next, factIds: ['next'], closing: null }, actual, rule, ['Corte mujer']).validation.reason, reason)
  })
  copyCheck('whole known acknowledgment retains one server copy despite outer punctuation', () => {
    for (const text of ['Gracias por avisar.', 'Entendido, seguimos por acá.']) {
      const actual = [{ id: 'next', text }], opening = '¡' + text.slice(0, -1) + '!'
      const result = validateReplyDraft({ opening, factIds: ['next'], closing: null }, actual, replyContract('continuation', true, true, actual), [])
      assert.equal(result.validation.status, 'accepted'); assert.equal(result.openingText, '')
      assert.equal(result.text, text)
      assert.equal(result.modelFraming, false, 'a deduplicated whole frame leaves only server facts')
    }
  })
  copyCheck('a known acknowledgment cannot hide an original material or action claim', () => {
    const actual = [{ id: 'next', text: 'Reservado por $100.' }]
    assert.equal(validateReplyDraft({ opening: '¡Reservado por $100!', factIds: ['next'], closing: null }, actual,
      replyContract('continuation', true, true, actual), []).validation.reason, 'unverified_value')
  })
  copyCheck('validated projection uses current sole fact without changing ownership or identity', () => {
    const original = [{ id: 'next', text: '¿Qué día preferís?' }], policy = replyContract('continuation', true, true, original)
    const current = { id: '0', text: 'Gracias por avisar.' }, snapshot = structuredClone(current)
    const frame = validateReplyDraft({ salutation: 'greeting', opening: '¡Gracias por avisar!', factIds: ['next'], closing: null }, original, policy, [])
    assert.equal(frame.validation.status, 'accepted')
    assert.deepEqual(projectValidatedReplyFrame(frame, current, true), { openingText: '¡Hola!', modelFraming: true })
    assert.deepEqual(current, snapshot); assert.deepEqual(original, [{ id: 'next', text: '¿Qué día preferís?' }])
    const exact = validateReplyDraft({ opening: '¿Cómo querés seguir?', factIds: ['next'], closing: null }, original, policy, [])
    assert.deepEqual(projectValidatedReplyFrame(exact, { id: '0', text: '¿Cómo querés seguir?' }, true), { openingText: '', modelFraming: false })
    const partial = validateReplyDraft({ opening: 'Gracias. ¿Cómo querés seguir?', factIds: ['next'], closing: null }, original, policy, [])
    assert.equal(projectValidatedReplyFrame(partial, { id: '0', text: '¿Cómo querés seguir?' }, true), null, 'id0 never enables suffix-question stripping')
    for (const opening of ['¡Reservado por $100!', 'Cuesta $100. ¿Qué día preferís?', 'Soy Otra.', 'Corte mujer.']) {
      const unsafe = validateReplyDraft({ opening, factIds: ['next'], closing: null }, original, policy, ['Corte mujer'])
      assert.equal(unsafe.validation.status, 'rejected'); assert.equal(unsafe.validatedFraming, undefined)
      assert.equal(projectValidatedReplyFrame(unsafe, { id: '0', text: opening }, true), null)
    }
    const incomplete = { ...frame }; delete incomplete.validatedFraming
    assert.equal(projectValidatedReplyFrame(incomplete, current, true), null)
  })
  assert.deepEqual(copyFailures, [], 'continuation ownership regressions')
  console.log('PASS contextual social contract, first-call viability, natural framing and honest canonical delivery')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
