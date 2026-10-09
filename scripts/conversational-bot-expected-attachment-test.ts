import assert from 'node:assert/strict'
import { interpretConversationAttachment } from '../src/conversational-bot/attachment-intent.js'
import type { AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, type DialoguePort } from '../src/conversational-bot/engine.js'

// Metadata only: no API, media download, money interpretation or database.
const state = initialDialogueState('attachment-fixture')
let catalogReads = 0
const port = {
  catalog: async () => { catalogReads++; return [] },
  availability: async () => { throw new Error('attachment must not consult availability') },
  information: async () => { throw new Error('attachment must not consult information') }
} as DialoguePort
let failures = 0, passed = 0
async function check(name: string, run: () => Promise<void>) {
  try { await run(); passed++; console.log('PASS ' + name) }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + (error as Error).message) }
}
const classify = (payload: { messageType?: unknown; mediaMimeType?: unknown; textBody?: unknown }, proofExpected: boolean,
  provider?: AiInterpretationProvider) => interpretConversationAttachment({ state, port, payload, proofExpected, provider, timeoutMs: 10 })

for (const [messageType, mediaMimeType] of [
  ['image', 'image/jpeg'], ['image', 'image/png'], ['image', 'image/webp'],
  ['document', 'image/jpeg'], ['document', 'image/png'], ['document', 'image/webp'],
  ['document', 'application/pdf'], ['document', ' IMAGE/JPEG ; charset=binary']
] as const) {
  await check('expected captionless ' + messageType + '/' + mediaMimeType, async () => {
    const before = structuredClone(state), readsBefore = catalogReads
    let calls = 0
    const result = await classify({ messageType, mediaMimeType, textBody: ' \n\t ' }, true, async () => {
      calls++; throw new Error('redundant AI must not be called for a server-requested file')
    })
    assert.equal(result.intent, 'deposit_proof')
    assert.equal(result.aiCalls, 0)
    assert.equal(calls, 0)
    assert.equal(catalogReads, readsBefore)
    assert.deepEqual(state, before, 'classification must not change financial or dialogue state')
    assert.doesNotMatch(result.reply, /comprobante recibido|pago aprobado|reserva confirmada/i)
  })
}
await check('expected file without configured AI still enters technical validation', async () => {
  const result = await classify({ messageType: 'document', mediaMimeType: 'application/pdf', textBody: null }, true)
  assert.equal(result.intent, 'deposit_proof'); assert.equal(result.aiCalls, 0)
})
for (const mediaMimeType of ['image/gif', 'application/zip', '', null]) {
  await check('unsupported/unknown declared MIME never shortcuts ' + String(mediaMimeType), async () => {
    const result = await classify({ messageType: 'document', mediaMimeType, textBody: '' }, true)
    assert.equal(result.intent, 'unclear'); assert.equal(result.aiCalls, 0)
  })
}
await check('unsolicited captionless file cannot create payment purpose', async () => {
  const result = await classify({ messageType: 'image', mediaMimeType: 'image/jpeg', textBody: '' }, false,
    async () => ({ attachmentIntent: 'deposit_proof' }))
  assert.equal(result.intent, 'unclear'); assert.equal(result.aiCalls, 1)
  assert.doesNotMatch(result.reply, /comprobante recibido|pago aprobado|reserva confirmada/i)
})
await check('explicit service reference uses context instead of expected-proof shortcut', async () => {
  const caption = 'esta es una referencia del color que quiero'
  let calls = 0
  const result = await classify({ messageType: 'image', mediaMimeType: 'image/jpeg', textBody: caption }, true, async input => {
    calls++; assert.equal(input.message, caption)
    assert.deepEqual(input.attachment, { messageType: 'image', mimeType: 'image/jpeg', proofExpected: true })
    return { attachmentIntent: 'service_reference' }
  })
  assert.equal(result.intent, 'service_reference'); assert.equal(result.aiCalls, 1); assert.equal(calls, 1)
  assert.match(result.reply, /referencia/)
})
await check('ambiguous caption remains unclear and does not become a payment proof', async () => {
  const result = await classify({ messageType: 'document', mediaMimeType: 'application/pdf', textBody: 'te envío esto' }, true,
    async () => ({ attachmentIntent: 'unclear' }))
  assert.equal(result.intent, 'unclear'); assert.equal(result.aiCalls, 1)
  assert.match(result.reply, /Todavía no registré un pago/)
})
await check('explicit proof caption retains existing one-call interpretation', async () => {
  const result = await classify({ messageType: 'image', mediaMimeType: 'image/jpeg', textBody: 'comprobante de la seña' }, true,
    async () => ({ attachmentIntent: 'deposit_proof' }))
  assert.equal(result.intent, 'deposit_proof'); assert.equal(result.aiCalls, 1)
})
await check('caption provider failure cannot claim a proof was submitted', async () => {
  const result = await classify({ messageType: 'image', mediaMimeType: 'image/jpeg', textBody: 'te envío esto' }, true,
    async () => { throw new Error('PRIVATE_PROVIDER_ERROR') })
  assert.equal(result.intent, 'unclear'); assert.equal(result.aiCalls, 1)
  assert.doesNotMatch(result.reply, /PRIVATE_PROVIDER_ERROR|comprobante recibido|pago aprobado/i)
})
console.log('Expected attachment checks: ' + passed + ' passed, ' + failures + ' failed')
if (failures) process.exitCode = 1