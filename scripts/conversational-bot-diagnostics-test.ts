import assert from 'node:assert/strict'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { createOpenAiResponseProvider } from '../src/conversational-bot/openai-response-provider.js'
import { initialDialogueState, type DialoguePort } from '../src/conversational-bot/engine.js'

const context = { businessId: 'tenant', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-01T12:00:00Z') }
const services = [
  { id: 'cut', name: 'Corte hombre', durationMinutes: 30, requiresConsultation: false, price: 100 },
  { id: 'other', name: 'Corte y barba', durationMinutes: 45, requiresConsultation: false, price: 200 }
]
const port: DialoguePort = { catalog: async () => services, availability: async () => ({ professionals: [], slots: [] }) }
const state = initialDialogueState('tenant')
const candidate = { intent: 'booking', serviceId: 'cut', serviceEvidence: 'corte hombre',
  professionalMention: null, serviceConfidence: 'certain', serviceCandidateIds: [], serviceCorrection: false,
  firstReply: null, intakeReply: null }
const request = (output: unknown, status = 200, requestId = 'req_safe-123') => async (_url: any, _init: any) =>
  new Response(JSON.stringify(output), { status, headers: { 'x-request-id': requestId } })
const completion = (text: string) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] })
const provider = (fetchImpl: typeof fetch) => createOpenAiInterpretationProvider({ apiKey: 'fake-key', fetchImpl })
const say = (message: string, ai: ReturnType<typeof provider>, previous = state) =>
  respondWithAiInterpreter(context, previous, message, port, ai)

const selected = await say('quiero corte hombre', async () => candidate)
assert.equal(selected.interpretation.proposal.service, true)
assert.equal(selected.interpretation.validation.service, 'accepted')
assert.equal(selected.interpretation.stateBefore.service, false)
assert.equal(selected.interpretation.stateAfter.service, true)
assert.equal(selected.interpretation.decision.acceptedAction, 'select_service')
assert.doesNotMatch(JSON.stringify(selected.interpretation), /corte hombre|tenant|fake-key/i)

const rejected = await say('quiero corte hombre', async () => ({ ...candidate, serviceId: 'foreign' }))
assert.equal(rejected.interpretation.proposal.service, true)
assert.equal(rejected.interpretation.validation.service, 'rejected')
assert.equal(rejected.interpretation.validation.reason, 'service_not_in_catalog')
assert.equal(rejected.interpretation.reason, 'invalid_output')
assert.equal(rejected.interpretation.stateAfter.service, true)
assert.doesNotMatch(JSON.stringify(rejected.interpretation), /foreign|corte hombre|tenant/i)

const http = await say('hola', provider(request({ error: { message: 'PRIVATE NAME' } }, 429) as typeof fetch))
assert.equal(http.interpretation.reason, 'provider_error')
assert.deepEqual(http.interpretation.interpretationProviderError, { code: 'http', httpStatus: 429, requestId: 'req_safe-123' })
assert.doesNotMatch(JSON.stringify(http.interpretation), /PRIVATE NAME|fake-key/i)
const unsafeId = await say('hola', provider(request({ error: 'secret' }, 503, 'person@example.com') as typeof fetch))
assert.equal(unsafeId.interpretation.interpretationProviderError?.requestId, null)
const transport = await say('hola', async () => { throw new Error('PRIVATE PHONE 123') })
assert.equal(transport.interpretation.interpretationProviderError?.code, 'transport')
assert.doesNotMatch(JSON.stringify(transport.interpretation), /PRIVATE PHONE/i)
const incomplete = await say('hola', provider(request({ status: 'incomplete', output: [] }) as typeof fetch))
assert.equal(incomplete.interpretation.interpretationProviderError?.code, 'incomplete')
const refused = await say('hola', provider(request({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'PRIVATE' }] }] }) as typeof fetch))
assert.equal(refused.interpretation.interpretationProviderError?.code, 'refusal')
const badJson = await say('hola', provider(request(completion('{broken')) as typeof fetch))
assert.equal(badJson.interpretation.interpretationProviderError?.code, 'json')
const badShape = await say('hola', provider(request({ status: 'completed', output: [] }) as typeof fetch))
assert.equal(badShape.interpretation.interpretationProviderError?.code, 'shape')

const responseProvider = createOpenAiResponseProvider({ apiKey: 'fake-key', fetchImpl: request({ status: 'completed', output: [] }) as typeof fetch })
const responseFailure = await respondWithAiInterpreter(context, state, 'hola', port,
  async () => ({ ...candidate, intent: 'other', serviceId: null, serviceEvidence: null }), { responseProvider })
assert.equal(responseFailure.interpretation.copyReason, 'response_error')
assert.equal(responseFailure.interpretation.responseProviderError?.code, 'shape')
assert.doesNotMatch(JSON.stringify(responseFailure.interpretation), /fake-key|tenant/i)
console.log('conversational diagnostics: offline PASS')