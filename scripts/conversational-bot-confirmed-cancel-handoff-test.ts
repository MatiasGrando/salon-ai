import assert from 'node:assert/strict'
import { initialDialogueState, respond, type DialogueContext, type DialoguePort } from '../src/conversational-bot/engine.js'
import type { CancellationSnapshot } from '../src/conversational-bot/appointment-management.js'
import { runtimeBookingFingerprint, type RuntimeBookingTerms } from '../src/conversational-bot/prisma-conversational-booking.js'
import { coordinationKey } from '../src/conversational-bot/coordinated-booking.js'
import { projectConversationDraft } from '../src/conversational-bot/session-state.js'
import { transition } from '../src/bot-options/domain/transition.js'
import { routeActions } from '../src/conversational-bot/actions.js'

const scope = { businessId: 'barber', sessionId: 'own-session', deploymentId: 'deployment', generation: 1,
  revision: '8', configurationId: 'configuration', dispatchFenceEpoch: 1, handoffFenceEpoch: 0 }
const snapshot: CancellationSnapshot = { scope: { businessId: 'barber', customerId: 'own-customer', sessionId: 'own-session', normalizedPhone: '5491112345678' },
  groupId: 'own-group', dbNow: '2026-10-11T12:00:00.000Z', members: [
    { appointmentId: 'light', version: 0, status: 'CONFIRMED', visitId: 'light-visit', visitVersion: 0, visitStatus: 'CONFIRMED', professionalId: 'tamara', serviceIds: ['illumination'], startAt: '2026-10-13T16:00:00.000Z', durationMinutes: 120, quotedPrice: 80000, depositId: null, depositStatus: null, manualDepositPaid: false, manualDepositAmount: null },
    { appointmentId: 'cut', version: 0, status: 'CONFIRMED', visitId: 'cut-visit', visitVersion: 0, visitStatus: 'CONFIRMED', professionalId: 'gaspar', serviceIds: ['cut'], startAt: '2026-10-13T18:00:00.000Z', durationMinutes: 30, quotedPrice: 15000, depositId: null, depositStatus: null, manualDepositPaid: false, manualDepositAmount: null }
  ] }
const state = initialDialogueState('barber')
const terms: RuntimeBookingTerms = { version: 1, businessId: 'barber', timezone: 'UTC', date: '2026-10-13', customerName: 'Matías', preference: { kind: 'any' }, totalPriceMinor: 95000,
  segments: snapshot.members.map((member, index) => ({ serviceId: member.serviceIds[0]!, serviceName: index ? 'Corte Hombre' : 'Iluminación', professionalId: member.professionalId,
    professionalName: index ? 'Gaspar' : 'Tamara', startAt: member.startAt, endAt: new Date(Date.parse(member.startAt) + member.durationMinutes * 60000).toISOString(),
    durationMinutes: member.durationMinutes, customerDurationMinutes: member.durationMinutes, priceMinor: member.quotedPrice, priceMode: 'FIXED' as const, configurationHash: null })) }
const fingerprint = runtimeBookingFingerprint(terms)
state.bookingReservation = { presented: { scope, version: 1, nonce: '11111111-1111-4111-8111-111111111111', fingerprint, conditionsPresented: true, terms,
}, receipt: { kind: 'COMMITTED', coordinationGroupId: 'own-group', proposalNonce: '11111111-1111-4111-8111-111111111111', fingerprint,
  appointments: [{ segmentIndex: 0, appointmentId: 'light', visitId: 'light-visit' }, { segmentIndex: 1, appointmentId: 'cut', visitId: 'cut-visit' }] } }
state.customerName = terms.customerName
state.date = terms.date
state.pending = 'proposal'
state.professional = terms.preference
state.basket = { version: 1, nextMemberId: 3, members: terms.segments.map((segment, index) => ({ memberId: `m${index + 1}`, mode: 'single' as const,
  serviceIds: [segment.serviceId], evidence: segment.serviceName })) }
const coordinatedSegments = terms.segments.map(({ priceMinor, priceMode, configurationHash, estimate, ...segment }) => segment)
state.slot = { date: terms.date, time: '16:00', startAt: terms.segments[0]!.startAt, professionalId: terms.segments[0]!.professionalId,
  professionalName: terms.segments[0]!.professionalName, band: 'AFTERNOON', occupiedMinutes: 150,
  coordination: { key: coordinationKey('barber', coordinatedSegments), segments: coordinatedSegments } } as typeof state.slot
const context: DialogueContext = { businessId: 'barber', timezone: 'UTC', dbNow: new Date(snapshot.dbNow), serverRuntimeBookingScope: scope, serverManagementSnapshot: snapshot }
const port: DialoguePort = { catalog: async () => [], availability: async () => ({ professionals: [], slots: [] }) }
const decision = { serviceId: null, candidateIds: [], correction: false, turnPlan: { version: 1 as const, operations: [{ kind: 'unsupported_action' as const,
  action: 'CANCEL' as const, evidence: 'Quiero cancelar mis turnos.', confidence: 1 }] } }
const before = structuredClone(state)
const sent = await respond(context, state, 'Quiero cancelar mis turnos.', port, decision)
assert.deepEqual(state, before, 'the confirmed booking and approved deposit remain untouched')
assert.equal(sent.managementCommand, undefined, 'customer cancellation must never authorize CANCEL_APPOINTMENT_GROUP')
assert.equal(sent.state.appointmentManagement, undefined, 'no automatic cancellation proposal')
assert.equal(sent.confirmedCancellationHandoff?.snapshot.groupId, 'own-group')
assert.deepEqual(sent.confirmedCancellationHandoff?.snapshot.members.map(member => member.appointmentId), ['light', 'cut'])
assert.match(sent.reply, /equipo/i)
assert.match(sent.reply, /sigue vigente/i)
const naturalPhrase = 'Quiero dar de baja mi reserva.'
assert.equal(routeActions(naturalPhrase).pendingAction, null, 'lexical router intentionally does not decide this wording')
const aiDetected = await respond(context, state, naturalPhrase, port, { ...decision, turnPlan: { version: 1,
  operations: [{ kind: 'unsupported_action', action: 'CANCEL', evidence: naturalPhrase, confidence: 1 }] } })
assert.equal(aiDetected.confirmedCancellationHandoff?.snapshot.groupId, 'own-group', 'AI intent must work without a matching routeActions verb')
const approvedSnapshot: CancellationSnapshot = { ...snapshot, members: snapshot.members.map((member, index) => index ? member : { ...member, depositId: 'approved-deposit', depositStatus: 'APPROVED' }) }
const approved = await respond({ ...context, serverManagementSnapshot: approvedSnapshot }, state, 'Quiero cancelar mis turnos.', port, decision)
assert.equal(approved.confirmedCancellationHandoff?.snapshot.members[0]?.depositStatus, 'APPROVED', 'approved deposit must be routed rather than changed')
const foreign = await respond({ ...context, serverManagementSnapshot: { ...snapshot, scope: { ...snapshot.scope, sessionId: 'foreign-session' } } }, state, 'Quiero cancelar mis turnos.', port, decision)
assert.equal(foreign.confirmedCancellationHandoff, undefined, 'foreign booking cannot cause handoff')
const absent = await respond({ ...context, serverManagementSnapshot: undefined }, state, 'Quiero cancelar mis turnos.', port, decision)
assert.equal(absent.confirmedCancellationHandoff, undefined, 'unverified booking cannot cause handoff')
const followup = await respond(context, sent.state, 'Confirmo la cancelación.', port)
assert.equal(followup.managementCommand, undefined, 'a follow-up must not revive automatic cancellation')
const projected = projectConversationDraft(sent.state, { businessId: 'barber', deploymentId: 'deployment', generation: 1, configurationId: 'configuration' })
const queued = transition(projected, { actionType: 'handoff.request', entityRef: null, payload: null }, { dbNowIso: snapshot.dbNow })
assert.equal(queued.outcome, 'HANDOFF')
assert.equal(queued.state.booking, 'CONFIRMED', 'handoff cannot change appointment state')
assert.equal(queued.state.deposit, 'NONE', 'handoff cannot change deposit state')
const approvedProjected = { ...projected, deposit: 'APPROVED' as const }
const queuedApproved = transition(approvedProjected, { actionType: 'handoff.request', entityRef: null, payload: null }, { dbNowIso: snapshot.dbNow })
assert.equal(queuedApproved.outcome, 'HANDOFF', 'approved deposit must not block staff cancellation request')
assert.equal(queuedApproved.state.deposit, 'APPROVED', 'approved deposit must remain approved')
assert.equal(queuedApproved.state.booking, 'CONFIRMED')
const repeat = transition(queued.state, { actionType: 'handoff.request', entityRef: null, payload: null }, { dbNowIso: snapshot.dbNow })
assert.equal(Boolean(repeat.effects?.some(effect => effect.kind === 'REQUEST_HUMAN_HANDOFF')), false, 'repeated request cannot create another queue effect')
console.log('confirmed cancellation requests a scoped human handoff without booking or deposit mutation: PASS')
