import assert from 'node:assert/strict'
import { runConversationalPreview } from '../src/conversational-bot/demo-preview.js'
import { initialDialogueState, type DialogueState } from '../src/conversational-bot/engine.js'

const businessId = 'qa-business'
const context = { businessId, timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-28T15:00:00Z') }
const stored = new Map<string, DialogueState>()
const saved: Array<{ phone: string; inbound: string; reply: string }> = []
const port = { catalog: async () => [{ id: 'cut', name: 'Corte Hombre', durationMinutes: 30, price: 5000, requiresConsultation: false }], availability: async () => ({ professionals: [{ id: 'ana', name: 'Ana', priority: 0 }], slots: [{ startAt: '2026-09-29T20:00:00.000Z', date: '2026-09-29', time: '17:00', professionalId: 'ana', professionalName: 'Ana', band: 'AFTERNOON' as const, occupiedMinutes: 0 }] }) }
const dependencies = {
  load: async (phone: string) => stored.get(phone) ?? null,
  save: async (phone: string, inbound: string, reply: string, state: DialogueState) => { saved.push({ phone, inbound, reply }); stored.set(phone, state) },
  createPort: async () => ({ context, port })
}
const first = await runConversationalPreview(dependencies, businessId, 'demo:preview:user:session1', 'Hola, quiero Corte Hombre')
assert.equal(first.state.serviceId, 'cut')
assert.equal(first.state.pending, 'date')
assert.equal(first.proposalReady, false)
assert.equal(first.interpretation.mode, 'deterministic', 'AI disabled is explicit')
assert.equal(first.interpretation.reason, 'disabled')
assert.equal(first.timings.totalMs >= 0, true)
assert.equal(first.timings.engineMs >= 0, true)
const second = await runConversationalPreview(dependencies, businessId, 'demo:preview:user:session1', 'mañana')
assert.equal(second.state.serviceId, 'cut', 'preview context survives multiple turns')
assert.equal(second.state.date, '2026-09-29')
assert.equal(saved.length, 2)
assert.deepEqual(saved.map(item => item.inbound), ['Hola, quiero Corte Hombre', 'mañana'])
const separate = await runConversationalPreview(dependencies, businessId, 'demo:preview:user:session2', 'hola')
assert.equal(separate.state.serviceId, null, 'new chat is isolated')
assert.equal(stored.get('demo:preview:user:session2')?.schemaVersion, initialDialogueState(businessId).schemaVersion)
await assert.rejects(() => runConversationalPreview({ ...dependencies, load: async () => ({ ...first.state, businessId: 'another' }) }, businessId, 'demo:preview:user:session1', 'hola'), /invalid dialogue scope/)
assert.equal(saved.length, 3, 'invalid cross-tenant state must not be persisted')
const earlyPhone = 'demo:preview:user:early-professional'
const earlyPreference = await runConversationalPreview(dependencies, businessId, earlyPhone, 'un turno con Ana mañana')
assert.equal(earlyPreference.state.professionalNameHint, 'ana')
const earlyRoundtrip = await runConversationalPreview(dependencies, businessId, earlyPhone, 'Corte Hombre')
assert.equal(earlyRoundtrip.state.professional?.kind === 'specific' ? earlyRoundtrip.state.professional.id : null, 'ana', 'QA preview persists early preference between turns')
assert.equal(earlyRoundtrip.state.pending, 'time')

let previewAiCalls = 0
const aiPreview = await runConversationalPreview({ ...dependencies, interpretationProvider: async () => { previewAiCalls++; return { intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null } } }, businessId, 'demo:preview:user:ai-test', 'hola')
assert.equal(previewAiCalls, 1)
assert.equal(aiPreview.interpretation?.mode, 'ai')
assert.ok('decision' in aiPreview.interpretation)
assert.equal(aiPreview.interpretation.decision.proposedIntent, 'booking')
assert.equal(aiPreview.interpretation.decision.pendingBefore, 'service')
assert.equal(aiPreview.interpretation.decision.pendingAfter, 'service')

const fallbackPreview = await runConversationalPreview({ ...dependencies, interpretationProvider: async () => { throw new Error('secret must not leak') } }, businessId, 'demo:preview:user:fallback-test', 'hola')
assert.equal(fallbackPreview.interpretation.mode, 'fallback')
assert.equal(fallbackPreview.interpretation.reason, 'provider_error')
assert.equal(JSON.stringify(fallbackPreview).includes('secret must not leak'), false)
console.log('conversational preview: OK')
