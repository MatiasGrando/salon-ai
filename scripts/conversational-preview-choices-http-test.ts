import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { PreviewChoiceError } from '../src/conversational-bot/preview-choice.js'

const source = readFileSync('src/routes/demo-profile.ts', 'utf8')
const start = source.indexOf("  app.post('/admin/demo-profiles/:id/chat'")
const end = source.indexOf('\n  })', start) + '\n  })'.length
assert.ok(start >= 0 && end > start)
const registration = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let handler: any
const calls: any[][] = []
let failSelection = false
const runPrismaDemoPreview = async (...args: any[]) => { calls.push(args); if (failSelection) throw new PreviewChoiceError(); return { reply: 'Server reply' } }
new Function('app', 'canUseCommercialDemos', 'cleanSessionId', 'findAccessibleDemo', 'runPrismaDemoPreview', 'prisma', 'resolveQaPreviewAi', 'resolveQaPreviewAiTimeoutMs', 'SimulatorBookingScopeError', 'PreviewChoiceError', 'process', registration)(
  { post: (_path: string, callback: any) => { handler = callback } }, () => true,
  (value: unknown) => typeof value === 'string' && /^[a-z0-9-]+$/.test(value) ? value : null,
  async () => ({ id: 'qa', demoType: 'QA_SANDBOX' }), runPrismaDemoPreview,
  { businessBotConfiguration: { findFirst: () => { throw new Error('do not enter another engine') } } }, () => undefined, () => 15000,
  class SimulatorBookingScopeError extends Error {}, PreviewChoiceError, { env: {} })
async function request(body: unknown, role = 'SUPER_ADMIN') {
  const response: any = { statusCode: 200, payload: null, status(code: number) { this.statusCode = code; return this }, send(payload: any) { this.payload = payload; return this } }
  const result = await handler({ auth: { user: { id: 'admin', role } }, params: { id: 'qa' }, body }, response)
  return { response, result }
}
const id = 'c1.server_nonce_123456.server_choice_123456'
await request({ message: 'Client label is not authority', sessionId: 'one', mode: 'conversational-preview', interactiveReplyId: id })
assert.equal(calls[0]?.[9], id, 'HTTP preview branch actually passes selection to its own backend')
assert.deepEqual(calls[0]?.[8], { sandboxBooking: true }, 'existing scope capability remains separate from selection')
await request({ sessionId: 'one', mode: 'conversational-preview', interactiveReplyId: id })
assert.equal(calls.length, 2, 'choice-only requests do not require a client-generated message')
assert.equal((await request({ sessionId: 'one', mode: 'conversational-preview', interactiveReplyId: id }, 'ACCOUNT_ADMIN')).response.statusCode, 403)
assert.equal((await request({ message: 'x', sessionId: 'one', mode: 'existing', interactiveReplyId: id })).response.statusCode, 400, 'conversational tokens never enter legacy engine')
for (const body of [null, [], { message: 4, sessionId: 'one' }, { message: 'x', sessionId: 'one', interactiveReplyId: {} }]) {
  assert.equal((await request(body)).response.statusCode, 400)
}
failSelection = true
const stale = await request({ sessionId: 'one', mode: 'conversational-preview', interactiveReplyId: id })
assert.equal(stale.response.statusCode, 409)
assert.match(stale.response.payload.message, /última respuesta/)
assert.deepEqual(stale.response.payload.choiceDiagnostic, { gate: 'ledger_resolve', reason: 'not_current' })
assert.equal(JSON.stringify(stale.response.payload).includes(id), false)
console.log('conversational preview choice HTTP: OK')
