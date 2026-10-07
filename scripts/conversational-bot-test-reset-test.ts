import { isTestResetCommand, isBarberTestReset } from '../src/conversational-bot/test-conversation-reset.js'
import type { AiInterpretationInput } from '../src/conversational-bot/ai-interpreter.js'
import assert from 'node:assert/strict'
import { runPrismaDemoPreview, SimulatorBookingScopeError } from '../src/conversational-bot/demo-preview-prisma.js'
import { initialDialogueState, type DialogueState } from '../src/conversational-bot/engine.js'
import { readPreviewChoiceState } from '../src/conversational-bot/preview-choice.js'
import { issueChoiceQuestion, publicChoiceQuestion } from '../src/conversational-bot/choices.js'
import { storePreviewChoiceState } from '../src/conversational-bot/preview-choice.js'

globalThis.fetch = (() => { throw new Error('network forbidden') }) as typeof fetch
let passed = 0, failed = 0
async function check(label: string, work: () => Promise<void>) {
  try { await work(); passed++; console.log('PASS ' + label) } catch (error) { failed++; console.error('FAIL ' + label + ': ' + error) }
}
function fixture() {
  const businessId = 'qa', phone = 'demo:preview:admin:session'
  const initial: DialogueState = { ...initialDialogueState(businessId), serviceId: 'cut', customerName: 'Ana', date: '2026-10-08', introduced: true,
    serviceRequest: { businessId, purpose: 'booking', disposition: 'unverified_variant', serviceIds: [], correction: false,
      continuation: false, basis: 'related_category', sourceQuote: null, request: 'procedimiento' },
    referral: { businessId, status: 'pending', reason: 'UNVERIFIED_SERVICE', request: 'procedimiento', serviceId: null } }
  const question = issueChoiceQuestion({ businessId, conversationKey: phone, policyKey: 'preview-sandbox:v1', policyGeneration: 1, revision: '3' }, initial,
    { kind: 'service', title: 'Servicios', choices: [{ label: 'Corte', operation: { kind: 'service', serviceId: 'cut' } }] })
  let row: any = { id: 'conversation', supportBotKey: 'conversational-preview', supportBotState: storePreviewChoiceState(initial, '3', question) }
  let allowed = true, ai = 0, reads = 0, saves = 0, aiAllowed = false
  let aiState: DialogueState | undefined
  const messages = [{ body: 'historial previo', direction: 'OUTBOUND' }]
  const appointments = [{ id: 'confirmed', status: 'CONFIRMED' }]
  const scope = {
    user: { findUnique: async () => allowed ? { id: 'admin', role: 'SUPER_ADMIN', isActive: true } : { id: 'admin', role: 'STAFF', isActive: true } },
    business: { findFirst: async () => ({ id: businessId, isDemo: true, demoType: 'QA_SANDBOX' }) }
  }
  const tx = { ...scope, $queryRaw: async (q: { sql: string }) => {
    if (q.sql.includes('FROM "User"')) return [await scope.user.findUnique()]
    if (q.sql.includes('FROM "Business"')) return [await scope.business.findFirst()]
    return [{ id: 'conversation' }]
  }, conversation: {
    upsert: async () => row, findUnique: async () => structuredClone(row),
    update: async ({ data }: any) => { saves++; row = { ...row, ...data }; return row }
  }, message: { create: async ({ data }: any) => { messages.push({ body: data.body, direction: data.direction }) } } }
  const client = { ...scope, conversation: { findUnique: async () => structuredClone(row) }, $transaction: async (work: (tx: any) => Promise<any>) => work(tx) }
  const port = { catalog: async () => { reads++; return [{ id: 'cut', name: 'Corte', durationMinutes: 30, price: 100, requiresConsultation: false }] },
    availability: async () => { throw new Error('reset agenda forbidden') } }
  const provider = async (input: AiInterpretationInput) => { ai++; aiState = structuredClone(input.state);
    if (!aiAllowed) throw new Error('reset AI forbidden')
    return { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null }
  }
  const run = (message = '/reset', choice?: string, group?: unknown) => runPrismaDemoPreview(client, businessId, 'admin', 'session', message,
    async () => ({ context: { businessId, timezone: 'UTC', dbNow: new Date('2026-10-07T12:00:00Z') }, port }), provider, undefined, { sandboxBooking: true }, choice, group)
  return { run, messages, appointments, question, get row() { return row }, get ai() { return ai }, get reads() { return reads }, get saves() { return saves },
    get aiState() { return aiState }, allowAi: () => { aiAllowed = true },
    deny: () => { allowed = false }, mutate: (fn: (state: any) => void) => fn(row.supportBotState) }
}
await check('QA reset clears dialogue and choices with zero AI; history and appointments remain', async () => {
  const f = fixture(), before = structuredClone(f.appointments), old = publicChoiceQuestion(f.question).choices[0]!.id
  const result = await f.run()
  assert.deepEqual(result.state, initialDialogueState('qa')); assert.equal(result.previewRevision, '4')
  assert.ok('aiCalls' in result.interpretation); assert.equal(result.interpretation.aiCalls, 0); assert.equal(result.interpretation.reason, 'test_reset')
  assert.equal(f.ai, 0); assert.equal(f.reads, 0); assert.equal(result.presentation, null)
  assert.match(result.reply, /no.*cancel|conserv/i)
  assert.deepEqual(f.appointments, before); assert.equal(f.messages[0]!.body, 'historial previo'); assert.equal(f.messages.length, 3)
  assert.equal(readPreviewChoiceState(f.row.supportBotState).question, null)
  await assert.rejects(f.run('', old), /vigente/); assert.equal(f.saves, 1)
})
await check('reset is a group barrier and cannot revive an older fragment snapshot', async () => {
  const f = fixture()
  const result = await f.run('/reset', undefined, { id: 'old', revision: '3', visibleRevision: '3', fragments: ['quiero corte', '/reset'] })
  assert.deepEqual(result.state, initialDialogueState('qa'))
  assert.equal(Object.hasOwn(f.row.supportBotState, 'previewTurnGroup'), false)
})
await check('QA scope denied before any reset write', async () => {
  const f = fixture(); f.deny(); await assert.rejects(f.run(), SimulatorBookingScopeError)
  assert.equal(f.saves, 0); assert.equal(f.messages.length, 1); assert.equal(f.ai, 0)
})
await check('pending appointment management cannot be erased', async () => {
  const f = fixture(); f.mutate(state => { state.appointmentManagement = { context: {} } })
  await assert.rejects(f.run())
  assert.equal(f.saves, 0); assert.equal(f.messages.length, 1)
})
await check('foreign stored dialogue cannot be erased', async () => {
  const f = fixture(); f.mutate(state => { state.businessId = 'foreign' })
  await assert.rejects(f.run(), /scope/); assert.equal(f.saves, 0)
})
await check('whole command only and Barber scope are explicit', async () => {
  assert.equal(isTestResetCommand(' /reset\n'), true)
  for (const text of ['quiero reservar /reset','/reset y corte','hola\n/reset','/RESET']) assert.equal(isTestResetCommand(text), false)
  assert.equal(isBarberTestReset('/reset','foreign'), false)
})
await check('next AI sees a clean dialogue, never the preserved CRM history', async () => {
  const f = fixture(); await f.run(); f.allowAi(); await f.run('hola')
  assert.deepEqual(f.aiState,initialDialogueState('qa'))
  assert.equal(f.messages[0]!.body,'historial previo'); assert.equal(f.messages.length,5)
})
console.log('test reset QA: ' + passed + ' PASS / ' + failed + ' FAIL (offline)')
if (failed) process.exitCode = 1
