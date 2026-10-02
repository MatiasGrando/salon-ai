import assert from 'node:assert/strict'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { createOpenAiResponseProvider } from '../src/conversational-bot/openai-response-provider.js'
import { ProviderDiagnosticError, providerFailure } from '../src/conversational-bot/provider-error.js'
import { initialDialogueState, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { runConversationalPreview } from '../src/conversational-bot/demo-preview.js'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'

const privateText = 'PRIVATE_CLIENT_581 service-secret key-secret'
const state = initialDialogueState('tenant')
const interpretationInput = { message: 'hola', state, services: [] }
const responseInput = { message: 'hola', state, intent: 'other' as const, facts: [] }
const signal = new AbortController().signal
const text = (value: unknown) => ({ type: 'output_text', text: value })
const message = (parts: unknown[], extra: object = {}) => ({ type: 'message', role: 'assistant', status: 'completed', content: parts, ...extra })
const completed = (output: unknown) => ({ status: 'completed', output })
const envelope = (parts: unknown[]) => completed([message(parts)])
const fetchBody = (body: unknown, onCall?: () => void): typeof fetch => (async () => {
  onCall?.()
  return new Response(JSON.stringify(body), { status: 200, headers: { 'x-request-id': 'req_safe-123' } })
}) as typeof fetch
const readers = [
  { name: 'interpretation', limit: 20096, read: (fetchImpl: typeof fetch) => createOpenAiInterpretationProvider({ apiKey: 'fake-key', fetchImpl })(interpretationInput, signal) },
  { name: 'response', limit: 4096, read: (fetchImpl: typeof fetch) => createOpenAiResponseProvider({ apiKey: 'fake-key', fetchImpl })(responseInput, signal) }
]
const failure = async (read: () => Promise<unknown>) => {
  try { await read() } catch (error) { return providerFailure(error) }
  assert.fail('expected rejection')
}
const format = (value: unknown): Record<string, unknown> =>
  (value as { responseFormat: Record<string, unknown> }).responseFormat

if (process.argv.includes('--reason-only')) {
  const diagnostic = await failure(() => readers[0]!.read(fetchBody(completed(null))))
  assert.equal(format(diagnostic)?.reason, 'output_not_array', 'must identify the exact envelope rejection')
  console.log('Responses rejection metadata: PASS')
} else {
  for (const reader of readers) {
    const json = JSON.stringify({ value: 'coherent JSON', nested: [1, 2] })
    let calls = 0
    const fragmented = completed([{ type: 'reasoning', summary: [{ text: privateText }] },
      { type: 'function_call', arguments: privateText }, message([text(json.slice(0, 11)), text(json.slice(11, 29)), text(json.slice(29))])])
    assert.deepEqual(await reader.read(fetchBody(fragmented, () => { calls++ })), JSON.parse(json), reader.name + ': one coherent fragmented message')
    assert.equal(calls, 1, 'no automatic retries')
    assert.deepEqual(await reader.read(fetchBody(completed([{ type: 'message', content: [text(json)] }]))), JSON.parse(json), 'legacy omitted role/status stays compatible')
    assert.deepEqual(await reader.read(fetchBody(envelope([text(''), text(json), text('')]))), JSON.parse(json))
    assert.deepEqual(await reader.read(fetchBody(envelope([text(' '.repeat(62)), text(json)]))), JSON.parse(json))
    assert.deepEqual(await reader.read(fetchBody(completed([...Array.from({ length: 63 }, () => ({ type: 'reasoning', summary: privateText })), message([text('{}')])]))), {})
    assert.deepEqual(await reader.read(fetchBody(envelope(Array.from({ length: 64 }, (_, i) => text(i === 0 ? '{}' : ''))))), {})
    const exact = JSON.stringify('x'.repeat(reader.limit - 2))
    assert.equal(exact.length, reader.limit)
    assert.equal(await reader.read(fetchBody(envelope([text(exact.slice(0, 200)), text(exact.slice(200))]))), JSON.parse(exact), 'inclusive exact character limit')
    const cases: Array<{ body: unknown; reason: string; code?: string }> = [
      { body: null, reason: 'response_body_invalid', code: 'incomplete' },
      { body: [], reason: 'response_body_invalid', code: 'incomplete' },
      { body: { status: 'incomplete', output: [message([text(privateText)])], incomplete_details: { reason: 'max_output_tokens', error: privateText } }, reason: 'response_not_completed', code: 'incomplete' },
      { body: { status: privateText, output: [] }, reason: 'response_not_completed', code: 'incomplete' },
      { body: completed(null), reason: 'output_not_array' },
      { body: completed([]), reason: 'message_missing' },
      { body: completed(Array.from({ length: 65 }, () => ({ type: 'reasoning' }))), reason: 'output_items_limit' },
      { body: completed([null, message([text('{}')])]), reason: 'output_item_invalid' },
      { body: completed([{}, message([text('{}')])]), reason: 'output_item_invalid' },
      { body: completed([message([text('{')]), message([text('}')])]), reason: 'message_ambiguous' },
      { body: completed([message([text('{}')]), message([])]), reason: 'message_ambiguous' },
      { body: completed([message([text('{}')], { role: 'user' })]), reason: 'message_role_invalid' },
      { body: completed([message([text('{}')], { status: 'incomplete' })]), reason: 'message_not_completed', code: 'incomplete' },
      { body: completed([message([], { content: null })]), reason: 'content_not_array' },
      { body: envelope(Array.from({ length: 65 }, () => text(''))), reason: 'content_parts_limit' },
      { body: envelope([]), reason: 'text_missing' },
      { body: envelope([null, text('{}')]), reason: 'content_part_invalid' },
      { body: envelope([{}, text('{}')]), reason: 'content_part_invalid' },
      { body: envelope([{ type: 'reasoning', text: privateText }, text('{}')]), reason: 'content_part_unsupported' },
      { body: envelope([text(4)]), reason: 'text_not_string' },
      { body: envelope([text('{}'), text({ privateText })]), reason: 'text_not_string' },
      { body: envelope([text(exact), text(' ')]), reason: 'text_too_large' },
      { body: envelope([text('x'.repeat(reader.limit * 2))]), reason: 'text_too_large' },
      { body: envelope([{ type: 'refusal', refusal: privateText }]), reason: 'refusal', code: 'refusal' },
      { body: envelope([text('{}'), { type: 'refusal' }]), reason: 'refusal', code: 'refusal' },
      { body: envelope([text('{'), text(privateText)]), reason: 'invalid_json', code: 'json' },
      { body: envelope([text('{}'), text('{}')]), reason: 'invalid_json', code: 'json' },
      { body: envelope([text('```json\n{}\n```')]), reason: 'invalid_json', code: 'json' }
    ]
    for (const test of cases) {
      let rejectedCalls = 0
      const diagnostic = await failure(() => reader.read(fetchBody(test.body, () => { rejectedCalls++ })))
      assert.equal(diagnostic.code, test.code ?? 'shape', reader.name + ': ' + test.reason)
      assert.equal(format(diagnostic).reason, test.reason)
      assert.equal(diagnostic.httpStatus, 200)
      assert.equal(diagnostic.requestId, 'req_safe-123')
      assert.equal(rejectedCalls, 1)
      assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_CLIENT|service-secret|key-secret|fake-key|refusal.*PRIVATE/)
      assert.ok(Object.values(format(diagnostic)).every(value => typeof value === 'string' || typeof value === 'number'))
      if (test.reason === 'text_too_large') {
        assert.equal(format(diagnostic).textLength, reader.limit + 1, 'oversize length saturates without retaining text')
        assert.equal(format(diagnostic).maxTextLength, reader.limit)
      }
      if (test.reason === 'response_not_completed') {
        assert.ok(['incomplete', 'unknown'].includes(String(format(diagnostic).responseStatus)))
      }
    }
    const hugeOutput = await failure(() => reader.read(fetchBody(completed(Array.from({ length: 1000 }, () => ({ type: 'reasoning' }))))))
    assert.equal(format(hugeOutput).outputItems, 65)
    const hugeParts = await failure(() => reader.read(fetchBody(envelope(Array.from({ length: 1000 }, () => text(''))))))
    assert.equal(format(hugeParts).contentParts, 65)
    const invalidHttpJson = (async () => new Response(privateText, { status: 200 })) as typeof fetch
    const invalidBody = await failure(() => reader.read(invalidHttpJson))
    assert.equal(format(invalidBody).reason, 'response_json_invalid')
    console.log('Responses ' + reader.name + ': fragmented JSON, ' + cases.length + ' rejections, bounds, no retry/leak PASS')
  }

  const unsafe = new ProviderDiagnosticError({ code: 'shape', httpStatus: 200, requestId: 'req_safe-123',
    responseFormat: { reason: 'text_too_large', responseStatus: privateText, outputItems: 999999, messageCount: 999999,
      contentParts: 999999, textParts: 999999, textLength: 999999, maxTextLength: 999999,
      messageStatus: privateText, incompleteReason: privateText, rawBody: privateText, text: privateText }, secret: privateText
  } as never)
  const sanitized = providerFailure(unsafe)
  assert.deepEqual(format(sanitized), { reason: 'text_too_large', responseStatus: 'unknown', outputItems: 65,
    messageCount: 65, contentParts: 65, textParts: 65, textLength: 20097, maxTextLength: 20096,
    messageStatus: 'unknown', incompleteReason: 'unknown' })
  assert.doesNotMatch(JSON.stringify(unsafe.diagnostic), /PRIVATE_CLIENT|rawBody|secret|"text"/)
  Object.assign(unsafe.diagnostic, { rawBody: privateText })
  Object.assign(unsafe.diagnostic.responseFormat!, { text: privateText })
  assert.doesNotMatch(JSON.stringify(providerFailure(unsafe)), /PRIVATE_CLIENT|rawBody|secret|"text"/)
  const invalidReason = providerFailure(new ProviderDiagnosticError({ code: 'shape', httpStatus: 200, requestId: 'person@example.com',
    responseFormat: { reason: privateText, responseStatus: 'completed' } } as never))
  assert.deepEqual(invalidReason, { code: 'shape', httpStatus: 200, requestId: null })
  assert.deepEqual(providerFailure(new Error(privateText)), { code: 'transport', httpStatus: null, requestId: null })

  let agendaCalls = 0
  const port: DialoguePort = { catalog: async () => [], availability: async () => { agendaCalls++; return { professionals: [], slots: [] } } }
  const context = { businessId: 'tenant', timezone: 'UTC', dbNow: new Date('2026-10-02T12:00:00Z') }
  const retained = { ...state, customerName: 'PRIVATE_NAME', date: '2026-10-03' }
  let saved: DialogueState | undefined
  const preview = await runConversationalPreview({ load: async () => retained,
    save: async (_phone, _inbound, _reply, next) => { saved = next }, createPort: async () => ({ context, port }),
    interpretationProvider: createOpenAiInterpretationProvider({ apiKey: 'fake-key', fetchImpl: fetchBody(completed(null)) })
  }, 'tenant', 'demo:preview:user:shape', 'hola')
  assert.ok('interpretationProviderError' in preview.interpretation)
  assert.equal(format(preview.interpretation.interpretationProviderError).reason, 'output_not_array')
  assert.equal(preview.interpretation.reason, 'provider_error')
  assert.equal(preview.proposalReady, false)
  assert.equal(preview.state.customerName, retained.customerName)
  assert.equal(preview.state.date, retained.date)
  assert.equal(saved?.customerName, retained.customerName)
  assert.equal(agendaCalls, 0)
  assert.doesNotMatch(JSON.stringify(preview.interpretation), /PRIVATE_NAME|fake-key|tenant/)

  const candidate = { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null }
  const responseFailure = await respondWithAiInterpreter(context, state, 'hola', port, async () => candidate, {
    responseProvider: createOpenAiResponseProvider({ apiKey: 'fake-key', fetchImpl: fetchBody(envelope([text('{}'), text('{}')])) }) })
  assert.equal(format(responseFailure.interpretation.responseProviderError).reason, 'invalid_json')
  assert.equal(responseFailure.interpretation.copyReason, 'response_error')
  assert.equal(responseFailure.proposal, null)
  assert.equal(agendaCalls, 0)
  const validWrapperInvalidSchema = await respondWithAiInterpreter(context, state, 'hola', port,
    createOpenAiInterpretationProvider({ apiKey: 'fake-key', fetchImpl: fetchBody(envelope([text('{"intent":'), text('"invalid"}')])) }))
  assert.equal(validWrapperInvalidSchema.interpretation.reason, 'invalid_output', 'engine/schema validation remains authoritative')
  assert.equal(validWrapperInvalidSchema.interpretation.interpretationProviderError, null)
  assert.equal(agendaCalls, 0)
  console.log('Responses diagnostics: runtime whitelist, preview/response propagation, no agenda/schema bypass PASS')
}
