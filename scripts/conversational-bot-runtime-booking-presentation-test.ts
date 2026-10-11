/// <reference types="node" />
import assert from 'node:assert/strict'
import { runtimeBookingSummary, runtimeBookingReceiptReply, runtimeBookingFingerprint, type RuntimePresentedBooking, type RuntimeBookingTerms, type RuntimeBookingReservation } from '../src/conversational-bot/prisma-conversational-booking.js'
import { calculateBookingDepositTerms } from '../src/services/deposit-operations.js'
import { issueChoiceQuestion } from '../src/conversational-bot/choices.js'
import { planConversationChoiceView, resolveConversationChoicePayload } from '../src/conversational-bot/runtime-choice-persistence.js'

const choiceScope = { businessId: 'fiction', conversationKey: 'session', policyKey: 'configuration', policyGeneration: 1, revision: '4' }
const draft = { businessId: 'fiction', pending: 'proposal', customerName: 'Eva' }
function proposal(multiple = false, deposit = false, estimated = false): RuntimePresentedBooking {
  const segments: RuntimeBookingTerms['segments'][number][] = [{
    serviceId: 'light', serviceName: multiple ? 'Iluminación' : 'Corte', professionalId: 'ana', professionalName: 'Ana',
    startAt: '2026-10-13T19:00:00.000Z', endAt: multiple ? '2026-10-13T21:00:00.000Z' : '2026-10-13T19:30:00.000Z',
    durationMinutes: multiple ? 120 : 30, customerDurationMinutes: multiple ? 120 : 30,
    priceMinor: estimated ? 80000 : 15000, priceMode: estimated ? 'STARTING_AT' : 'FIXED', configurationHash: 'a'.repeat(64),
    ...(estimated ? { estimate: { optionId: 'long', optionLabel: '30 cm', priceMin: 80000, priceMax: null } } : {})
  }]
  if (multiple) segments.push({ ...segments[0]!, serviceId: 'cut', serviceName: 'Corte', professionalId: 'gas', professionalName: 'Gaspar',
    startAt: '2026-10-13T21:00:00.000Z', endAt: '2026-10-13T21:30:00.000Z', durationMinutes: 30, customerDurationMinutes: 30,
    priceMinor: 15000, priceMode: 'FIXED' })
  if (multiple) delete segments[1]!.estimate
  const terms: RuntimeBookingTerms = { version: 1, businessId: 'fiction', timezone: 'America/Argentina/Buenos_Aires', date: '2026-10-13',
    customerName: 'Eva', preference: { kind: 'any' }, segments, totalPriceMinor: estimated ? null : multiple ? 30000 : 15000 }
  if (deposit) terms.deposit = { financial: calculateBookingDepositTerms({ services: segments.map((s, index) => ({
    id: s.serviceId, name: s.serviceName, price: s.priceMinor, priceMode: s.priceMode, depositMode: index ? 'NONE' : 'FIXED', depositValue: index ? null : 5000
  })), businessDepositHoldMinutes: 120 }), payment: { transferEnabled: true, alias: 'alias.ficticio', cbu: null, cvu: null, paymentLinkEnabled: false, paymentLink: null } }
  return { version: 1, scope: { businessId: 'fiction', sessionId: 'session', deploymentId: 'deployment', generation: 1, revision: '3',
    configurationId: 'configuration', dispatchFenceEpoch: 1, handoffFenceEpoch: 1 }, nonce: '12345678-1234-4234-8234-123456789abc',
    fingerprint: runtimeBookingFingerprint(terms), conditionsPresented: true, terms }
}
function reservation(p: RuntimePresentedBooking, depositStatus: 'PENDING_PROOF' | 'PROOF_RECEIVED' | 'APPROVED' | 'EXPIRED' = 'PENDING_PROOF'): RuntimeBookingReservation {
  return { presented: p, receipt: { kind: 'HELD', operationKey: 'fiction-operation', depositId: 'fiction-deposit', coordinationGroupId: 'fiction-group',
    proposalNonce: p.nonce, fingerprint: p.fingerprint, amount: p.terms.deposit!.financial.amount, expiresAt: '2026-10-10T23:00:00.000Z',
    depositStatus, appointments: p.terms.segments.map((_, index) => ({ segmentIndex: index, appointmentId: 'appointment-' + index, visitId: 'visit-' + index })) } }
}
const bodies = (plan: ReturnType<typeof planConversationChoiceView>) => plan.outboxRows.map(row => row.item.body).join('\n')
let passed = 0, failed = 0
function test(name: string, run: () => void) { try { run(); passed++; console.log('PASS ' + name) } catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error as Error).message) } }

test('single fixed proposal separates service, timing, price and status', () => {
  const p = proposal(), before = structuredClone(p), body = runtimeBookingSummary(p)
  assert.match(body, /Corte con Ana\n/)
  assert.match(body, /Duración: 30 min\n/)
  assert.match(body, /Precio: \$15[.]000/)
  assert.match(body, /\n\nTotal: \$15[.]000/)
  assert.match(body, /Sin seña requerida/)
  assert.match(body, /La disponibilidad se verifica otra vez al confirmar/)
  assert.deepEqual(p, before)
})
test('coordinated estimate has readable blocks, shared date once and no invented total', () => {
  const body = runtimeBookingSummary(proposal(true, true, true))
  assert.equal((body.match(/13\/10\/2026/g) ?? []).length, 1)
  assert.match(body, /Iluminación con Ana\n[\s\S]*16:00[\s\S]*Duración: 120 min/)
  assert.match(body, /\n\nCorte con Gaspar\n[\s\S]*18:00[\s\S]*Duración: 30 min/)
  assert.match(body, /30 cm[\s\S]*Estimado desde \$80[.]000/)
  assert.match(body, /\n\nTotal a consultar/)
  assert.doesNotMatch(body, /Total: \$95[.]000/)
  assert.match(body, /Seña requerida: \$5[.]000/)
  assert.match(body, /120 minutos/)
  assert.match(body, /una seña conjunta[\s\S]*un único comprobante/)
  assert.match(body, /Todavía no está confirmado/)
})
test('held receipt preserves deadline, single proof instruction and payment state', () => {
  const p = proposal(true, true, true), held = reservation(p), before = structuredClone(held)
  const body = runtimeBookingReceiptReply(held)
  assert.match(body, /Iluminación con Ana\n/)
  assert.match(body, /\n\nCorte con Gaspar\n/)
  assert.equal((body.match(/Enviá el comprobante/g) ?? []).length, 1)
  assert.match(body, /único para todos los servicios.*antes de/)
  assert.match(body, /alias.ficticio/)
  assert.match(body, /todavía no está confirmada/i)
  assert.doesNotMatch(body, /La reserva fue confirmada/)
  assert.deepEqual(held, before)
  for (const status of ['PROOF_RECEIVED', 'APPROVED', 'EXPIRED'] as const) {
    assert.equal(runtimeBookingReceiptReply(reservation(p, status)).includes('La reserva fue confirmada'), status === 'APPROVED')
  }
})
test('unknown price and different dates remain explicit', () => {
  const p = proposal(true), second = p.terms.segments[1]!
  second.startAt = '2026-10-14T21:00:00.000Z'; second.endAt = '2026-10-14T21:30:00.000Z'
  second.priceMinor = null; p.terms.totalPriceMinor = null
  const body = runtimeBookingSummary(p)
  assert.match(body, /13\/10\/2026/)
  assert.match(body, /14\/10\/2026/)
  assert.match(body, /Precio a confirmar/)
  assert.match(body, /Total a consultar/)
})
test('actual confirm button with explicit question does not add a redundant Confirmar footer', () => {
  const p = proposal(true, true, true)
  const question = issueChoiceQuestion(choiceScope, draft, { kind: 'proposal', title: 'Confirmar turno',
    choices: [{ label: 'Confirmar', operation: { kind: 'confirm', nonce: p.nonce } }] })
  const reply = runtimeBookingSummary(p) + '\n¿Confirmás la reserva de todos estos servicios con la seña conjunta?'
  const plan = planConversationChoiceView({ question, reply, transitionId: 'confirmation' })
  assert.equal(bodies(plan), reply)
  assert.deepEqual(resolveConversationChoicePayload(plan.choiceRows[0]!.payload, choiceScope, draft).operation, { kind: 'confirm', nonce: p.nonce })
  assert.throws(() => resolveConversationChoicePayload(plan.choiceRows[0]!.payload, { ...choiceScope, revision: '5' }, draft), /scope/)
})
test('confirm label fallback remains when there is no explicit question', () => {
  const p = proposal()
  const question = issueChoiceQuestion(choiceScope, draft, { kind: 'proposal', title: 'Confirmar turno',
    choices: [{ label: 'Confirmar', operation: { kind: 'confirm', nonce: p.nonce } }] })
  const plan = planConversationChoiceView({ question, reply: 'Esta es la propuesta.', transitionId: 'fallback' })
  assert.match(bodies(plan), /\n\nConfirmar$/)
})
console.log(`runtime booking presentation: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
