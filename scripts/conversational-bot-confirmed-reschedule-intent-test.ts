import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { routeActions } from '../src/conversational-bot/actions.js'
import { initialDialogueState, respond, finalizeAppointmentManagement, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { runtimeBookingFingerprint, type RuntimeBookingTerms } from '../src/conversational-bot/prisma-conversational-booking.js'
import { confirmGroupReschedule, managementRescheduleOfferKey, parseAppointmentManagement, presentGroupReschedule, type CancellationSnapshot } from '../src/conversational-bot/appointment-management.js'
import { prepareGroupRescheduleOffers } from '../src/conversational-bot/prisma-appointment-management.js'

// Only a trusted, owned confirmed aggregate may be offered. None of these fixtures
// use the application's database or WhatsApp transport.
const scope = { businessId: 'business', customerId: 'customer', sessionId: 'session', normalizedPhone: '5491112345678' }
const failures: string[] = []
async function check(name: string, run: () => void | Promise<void>) {
  try { await run(); console.log('PASS ' + name) }
  catch (error) { failures.push(name); console.error('FAIL ' + name + ': ' + String(error)) }
}

await check('natural confirmed-booking request is reprogramming, not a draft edit', () => {
  for (const message of ['Tenía un turno el martes, quería reprogramarlo', 'Tengo un turno y quiero cambiarlo de fecha']) {
    assert.equal(routeActions(message).pendingAction, 'RESCHEDULE', message)
  }
})

const oldDate = '2030-10-08T15:00:00.000Z'
const nextDate = '2030-10-09T15:00:00.000Z'
const sample: CancellationSnapshot = { scope, groupId: 'joint-group', dbNow: '2030-10-01T12:00:00.000Z', members: [
  { appointmentId: 'a', version: 3, status: 'CONFIRMED', visitId: 'v-a', visitVersion: 2, visitStatus: 'CONFIRMED', professionalId: 'p-a', serviceIds: ['illumination'], startAt: oldDate, durationMinutes: 120, quotedPrice: null, depositId: 'deposit', depositStatus: 'APPROVED', manualDepositPaid: false, manualDepositAmount: null },
  { appointmentId: 'b', version: 3, status: 'CONFIRMED', visitId: 'v-b', visitVersion: 2, visitStatus: 'CONFIRMED', professionalId: 'p-b', serviceIds: ['cut'], startAt: '2030-10-08T17:00:00.000Z', durationMinutes: 30, quotedPrice: 15000, depositId: null, depositStatus: null, manualDepositPaid: false, manualDepositAmount: null }
] }
const moves = [
  { appointmentId: 'a', newStartAt: nextDate },
  { appointmentId: 'b', newStartAt: '2030-10-09T17:00:00.000Z' }
]
await check('paid proposal requires fresh explicit consent; old booking and deposit remain immutable', () => {
  const before = structuredClone(sample)
  const proposal = presentGroupReschedule(sample, moves)
  assert.throws(() => confirmGroupReschedule(proposal, { nonce: 'old-booking-consent', fingerprint: proposal.fingerprint }), /consent/)
  const confirmed = confirmGroupReschedule(proposal, { nonce: proposal.nonce, fingerprint: proposal.fingerprint })
  assert.equal(confirmed.kind, 'RESCHEDULE_APPOINTMENT_GROUP')
  assert.deepEqual(sample, before)
  assert.equal(confirmed.snapshot.members[0]!.depositStatus, 'APPROVED')
  assert.equal(confirmed.snapshot.members[0]!.quotedPrice, null, 'estimated price is not silently converted to fixed')
  assert.deepEqual(confirmed.moves, moves, 'date/time-only request preserves both original professional assignments')
  assert.deepEqual(confirmed.snapshot.members.map(member => member.professionalId), ['p-a', 'p-b'])
})
await check('explicit professional switch is signed in the paid group offer, never inferred for other members', () => {
  const withProfessional = [{ ...moves[0]!, newProfessionalId: 'p-c' }, moves[1]!]
  const proposal = presentGroupReschedule(sample, withProfessional)
  assert.throws(() => confirmGroupReschedule({ ...proposal, moves: [{ ...withProfessional[0]!, newProfessionalId: 'p-b' }, moves[1]!] },
    { nonce: proposal.nonce, fingerprint: proposal.fingerprint }), /fingerprint|consent/)
  const date = '2030-10-09'
  const offer = { key: managementRescheduleOfferKey(sample, date, withProfessional), date, moves: withProfessional }
  const parsed = parseAppointmentManagement({ version: 1, action: 'RESCHEDULE', snapshot: sample, offers: [offer], proposal }, scope.businessId, scope.sessionId)
  assert.equal(parsed.proposal?.kind, 'GROUP_RESCHEDULE_PROPOSAL')
  assert.equal(parsed.proposal.moves[0]?.newProfessionalId, 'p-c')
  assert.equal(parsed.proposal.moves[1]?.newProfessionalId, undefined)
})
await check('professional-only change may leave companion members unchanged, but never the whole group', () => {
  const professionalOnly = [
    { appointmentId: 'a', newStartAt: sample.members[0]!.startAt, newProfessionalId: 'p-c' },
    { appointmentId: 'b', newStartAt: sample.members[1]!.startAt }
  ]
  const proposal = presentGroupReschedule(sample, professionalOnly)
  const consent = { nonce: proposal.nonce, fingerprint: proposal.fingerprint }
  assert.deepEqual(confirmGroupReschedule(proposal, consent).moves, professionalOnly)
  const offer = { date: '2030-10-08', moves: professionalOnly,
    key: managementRescheduleOfferKey(sample, '2030-10-08', professionalOnly) }
  assert.equal(parseAppointmentManagement({ version: 1, action: 'RESCHEDULE', snapshot: sample,
    offers: [offer], proposal }, scope.businessId, scope.sessionId).proposal?.kind, 'GROUP_RESCHEDULE_PROPOSAL')
  assert.throws(() => presentGroupReschedule(sample, sample.members.map(member =>
    ({ appointmentId: member.appointmentId, newStartAt: member.startAt }))), /changed/)
  assert.throws(() => confirmGroupReschedule({ ...proposal, moves: professionalOnly.map(move =>
    ({ appointmentId: move.appointmentId, newStartAt: move.newStartAt })) }, consent), /changed|fingerprint/)
})
await check('fresh availability proves an explicitly changed professional for one service only', async () => {
  const seen: string[] = []
  const reader = async (member: CancellationSnapshot['members'][number], date: string, professionalId: string) => {
    seen.push(member.appointmentId + ':' + professionalId)
    return [{ date, professionalId, serviceIds: member.serviceIds, durationMinutes: member.durationMinutes,
      customerDurationMinutes: member.customerDurationMinutes ?? member.durationMinutes,
      startAt: date + member.startAt.slice(10) }]
  }
  const offers = await prepareGroupRescheduleOffers(sample, '2030-10-09', reader, { appointmentId: 'a', professionalId: 'p-c' })
  assert.deepEqual(seen, ['a:p-c', 'b:p-b'])
  assert.equal(offers.length, 1)
  assert.deepEqual(offers[0]!.moves, [{ ...moves[0]!, newProfessionalId: 'p-c' }, moves[1]!])
  const plain = await prepareGroupRescheduleOffers(sample, '2030-10-09', reader)
  assert.deepEqual(plain[0]!.moves, moves)
  const bad = await prepareGroupRescheduleOffers(sample, '2030-10-09', async (member, date, professionalId) =>
    member.appointmentId === 'a' ? [{ date, professionalId: 'p-a', serviceIds: member.serviceIds, durationMinutes: member.durationMinutes,
      customerDurationMinutes: member.customerDurationMinutes ?? member.durationMinutes, startAt: date + member.startAt.slice(10) }] : [],
  { appointmentId: 'a', professionalId: 'p-c' }).then(() => null, error => error)
  assert.match(String(bad), /availability proof mismatch/)
})

const terms: RuntimeBookingTerms = { version: 1, businessId: 'business', timezone: 'UTC', date: '2030-10-08', customerName: 'Ana',
    preference: { kind: 'any' }, totalPriceMinor: null, segments: [
      { serviceId: 'illumination', serviceName: 'Iluminacion', professionalId: 'p-a', professionalName: 'Tamara',
        startAt: oldDate, endAt: '2030-10-08T17:00:00.000Z', durationMinutes: 120, customerDurationMinutes: 120,
        priceMinor: null, priceMode: 'STARTING_AT', configurationHash: null },
      { serviceId: 'cut', serviceName: 'Corte Hombre', professionalId: 'p-b', professionalName: 'Juan',
        startAt: '2030-10-08T17:00:00.000Z', endAt: '2030-10-08T17:30:00.000Z', durationMinutes: 30, customerDurationMinutes: 30,
        priceMinor: 15000, priceMode: 'FIXED', configurationHash: null }
    ] }
  const presented = { scope: { businessId: 'business', sessionId: 'session', deploymentId: 'deployment', generation: 1,
    revision: '1', configurationId: 'config', dispatchFenceEpoch: 1, handoffFenceEpoch: 0 }, version: 1 as const,
    nonce: '11111111-1111-4111-8111-111111111111', fingerprint: runtimeBookingFingerprint(terms), conditionsPresented: true as const, terms }
  const state: DialogueState = { ...initialDialogueState('business'), completedBooking: { presented,
    receipt: { kind: 'COMMITTED', coordinationGroupId: 'joint-group', proposalNonce: presented.nonce,
      fingerprint: presented.fingerprint, appointments: [
        { segmentIndex: 0, appointmentId: 'a', visitId: 'v-a' }, { segmentIndex: 1, appointmentId: 'b', visitId: 'v-b' }
      ] } } }
  const unpaid = { ...sample, members: sample.members.map(member => ({ ...member, depositId: null, depositStatus: null })) }
  const context = { businessId: 'business', timezone: 'UTC', dbNow: new Date(sample.dbNow), serverManagementSnapshot: unpaid,
    serverRuntimeBookingScope: { ...presented.scope, revision: '3' } }
  const port: DialoguePort = { catalog: async () => [], availability: async () => ({ professionals: [], slots: [] }),
    professionalInformation: async () => ({ businessId: 'business', complete: true, professionals: [
      { id: 'p-a', name: 'Tamara', services: [], schedule: null }, { id: 'p-b', name: 'Juan', services: [], schedule: null },
      { id: 'p-c', name: 'Gaspar', services: [], schedule: null }
    ] }),
    managementRescheduleOffers: (group, date, professionalChange) => prepareGroupRescheduleOffers(group, date,
      async (member, d, professionalId) => [{ date: d, professionalId, serviceIds: member.serviceIds,
        durationMinutes: member.durationMinutes, customerDurationMinutes: member.customerDurationMinutes ?? member.durationMinutes,
        startAt: d + member.startAt.slice(10) }], professionalChange)
  }
await check('confirmed conversation asks only missing date and binds professional to requested service', async () => {
  const opened = await respond(context, state, 'Tenía un turno el martes, quería reprogramarlo', port)
  assert.equal(opened.state.appointmentManagement?.context.action, 'RESCHEDULE')
  assert.match(opened.reply, /horario|fecha/i, 'ask only the next missing value, not the service again')
  assert.equal(opened.managementCommand, undefined)
  const message = 'Quiero Corte Hombre con Gaspar'
  const changed = await respond({ ...context, serverRuntimeBookingScope: { ...presented.scope, revision: '4' } }, opened.state, message, port,
    { serviceId: null, candidateIds: [], correction: false, professionalMention: 'Gaspar',
      turnPlan: { version: 1, operations: [{ kind: 'professional', mode: 'specific', mention: 'Gaspar', evidence: message, confidence: 1 }] } })
  assert.deepEqual(changed.state.appointmentManagement?.professionalChange,
    { appointmentId: 'b', professionalId: 'p-c', professionalName: 'Gaspar' })
  assert.equal(changed.managementCommand, undefined)
  assert.deepEqual(changed.state.appointmentManagement?.context.snapshot.members.map(member => member.professionalId), ['p-a', 'p-b'])
})

await check('later date-only proposal without deposit displays the verified current professional', async () => {
  const currentState = structuredClone(state)
  const receipt = currentState.completedBooking!.receipt!
  assert.equal(receipt.kind, 'COMMITTED')
  receipt.currentSchedule = [
    { appointmentId: 'a', startAt: oldDate, professionalId: 'p-a', professionalName: 'Tamara' },
    { appointmentId: 'b', startAt: sample.members[1]!.startAt, professionalId: 'p-c', professionalName: 'Gaspar' }
  ]
  const currentSnapshot = { ...unpaid, members: unpaid.members.map(member => ({ ...member,
    professionalId: member.appointmentId === 'b' ? 'p-c' : member.professionalId })) }
  const currentContext = { ...context, serverManagementSnapshot: currentSnapshot }
  const opened = await respond(currentContext, currentState, 'Quiero reprogramar mi turno', port)
  const offered = await respond({ ...currentContext, serverRuntimeBookingScope: { ...presented.scope, revision: '4' } },
    opened.state, 'Para el 2030-10-09 a las 15:00', port)
  assert.equal(offered.state.appointmentManagement?.context.proposal?.kind, 'GROUP_RESCHEDULE_PROPOSAL')
  assert.match(offered.reply, /Corte Hombre con Gaspar/)
  assert.doesNotMatch(offered.reply, /Corte Hombre con Juan/)
  assert.match(offered.reply, /Iluminacion con Tamara/)
  assert.deepEqual(offered.state.completedBooking, currentState.completedBooking)
})

await check('verified approved joint deposit offers a new date and requires fresh reschedule consent', async () => {
  const paidTerms: RuntimeBookingTerms = { ...terms, deposit: {
    financial: { lines: [{ serviceId: 'illumination', sortOrder: 0, serviceName: 'Iluminacion', mode: 'FIXED',
      configuredValue: 5000, baseAmount: null, amount: 5000 }], amount: 5000, ttlMinutes: 120, ttlProvenance: 'DEFAULT_120' },
    payment: { transferEnabled: true, alias: 'prueba.alias', cbu: null, cvu: null, paymentLinkEnabled: false, paymentLink: null }
  } }
  const paidPresented = { ...presented, terms: paidTerms, fingerprint: runtimeBookingFingerprint(paidTerms) }
  const paidState: DialogueState = { ...initialDialogueState('business'), completedBooking: { presented: paidPresented,
    receipt: { kind: 'HELD', operationKey: 'joint-hold', coordinationGroupId: 'joint-group', proposalNonce: paidPresented.nonce,
      fingerprint: paidPresented.fingerprint, appointments: [
        { segmentIndex: 0, appointmentId: 'a', visitId: 'v-a' }, { segmentIndex: 1, appointmentId: 'b', visitId: 'v-b' }
      ], depositId: 'deposit', amount: 5000, expiresAt: '2030-10-20T15:00:00.000Z', depositStatus: 'APPROVED',
      coordinatedDepositGroup: { version: 1, groupId: 'joint-group', requestHash: 'a'.repeat(64) } } } }
  const paidContext = { ...context, serverManagementSnapshot: sample }
  const opened = await respond(paidContext, paidState, 'Tenía un turno el martes, quería reprogramarlo', port)
  assert.equal(opened.state.appointmentManagement?.context.action, 'RESCHEDULE')
  assert.equal(opened.managementCommand, undefined)
  const offered = await respond({ ...paidContext, serverRuntimeBookingScope: { ...presented.scope, revision: '4' } },
    opened.state, 'Para el 2030-10-09 a las 15:00', port)
  assert.equal(offered.state.appointmentManagement?.context.proposal?.kind, 'GROUP_RESCHEDULE_PROPOSAL')
  assert.equal(offered.managementCommand, undefined)
  assert.deepEqual(offered.state.completedBooking, paidState.completedBooking, 'no payment or booking mutation before consent')
  const confirmingContext = { ...paidContext, serverRuntimeBookingScope: { ...presented.scope, revision: '5' } }
  for (const message of ['Bueno te lo confirmo', 'Sí, confirmo el nuevo horario']) {
    const decision = { serviceId: null, candidateIds: [], correction: false, confirmationEvidence: message,
      turnPlan: { version: 1 as const, operations: [{ kind: 'confirm_proposal' as const, evidence: message, confidence: 1 }] } }
    const accepted = await respond(confirmingContext, offered.state, message, port, decision)
    assert.equal(accepted.managementCommand?.kind, 'RESCHEDULE_APPOINTMENT_GROUP', 'validated current AI confirmation follows the rescheduling circuit')
    assert.deepEqual(accepted.state.completedBooking, paidState.completedBooking)
    const withoutAdmission = await respond(confirmingContext, offered.state, message, port, { ...decision, confirmationEvidence: undefined })
    assert.equal(withoutAdmission.managementCommand, undefined, 'a proposed operation alone cannot replace current consent admission')
    const staleScope = await respond({ ...confirmingContext, serverRuntimeBookingScope: { ...presented.scope, revision: '7' } },
      offered.state, message, port, decision)
    assert.equal(staleScope.managementCommand, undefined, 'natural consent still requires the exact displayed proposal revision')
  }
  for (const message of ['¿Confirmo el nuevo horario?', 'Confirmo si tienen lugar', 'Sí, pero mejor mañana']) {
    const denied = await respond(confirmingContext, offered.state, message, port, { serviceId: null, candidateIds: [],
      correction: false, confirmationEvidence: message, turnPlan: { version: 1,
        operations: [{ kind: 'confirm_proposal', evidence: message, confidence: 1 }] } })
    assert.equal(denied.managementCommand, undefined, 'questions and conditional consent cannot move appointments')
    assert.deepEqual(denied.state.completedBooking, paidState.completedBooking)
  }
  const editMessage = 'Confirmo, pero mañana a las 16:00'
  const mixed = await respond(confirmingContext, offered.state, editMessage, port, { serviceId: null, candidateIds: [],
    correction: false, confirmationEvidence: editMessage, turnPlan: { version: 1, operations: [
      { kind: 'confirm_proposal', evidence: editMessage, confidence: 1 },
      { kind: 'time', value: '16:00', evidence: editMessage, confidence: 1 }
    ] } })
  assert.equal(mixed.managementCommand, undefined, 'new edits require a newly displayed offer and consent')
  const confirmed = await respond({ ...paidContext, serverRuntimeBookingScope: { ...presented.scope, revision: '5' } },
    offered.state, 'Confirmo la reprogramación', port)
  assert.equal(confirmed.managementCommand?.kind, 'RESCHEDULE_APPOINTMENT_GROUP')
  assert.equal(confirmed.managementCommand?.snapshot.members[0]?.depositStatus, 'APPROVED')
  assert.equal(confirmed.managementCommand?.snapshot.members[0]?.quotedPrice, null)
  assert.deepEqual(confirmed.state.completedBooking, paidState.completedBooking)
  for (const unverified of [
    undefined,
    { ...sample, members: sample.members.map(member => member.depositId ? { ...member, depositStatus: 'PENDING' } : member) },
    { ...sample, members: sample.members.map(member => member.depositId ? { ...member, depositId: 'foreign-deposit' } : member) }
  ]) {
    const denied = await respond({ ...paidContext, serverManagementSnapshot: unverified,
      serverRuntimeBookingScope: { ...presented.scope, revision: '5' } }, offered.state, 'Confirmo la reprogramación', port)
    assert.equal(denied.managementCommand, undefined, 'a paid receipt alone never replaces fresh owned server authority')
    assert.deepEqual(denied.state.completedBooking, paidState.completedBooking, 'denial preserves sealed payment and original booking')
  }
  const movedState = structuredClone(paidState)
  const movedReceipt = movedState.completedBooking!.receipt!
  assert.equal(movedReceipt.kind, 'HELD')
  if (movedReceipt.kind !== 'HELD') throw new Error('paid receipt required')
  movedReceipt.currentSchedule = [
    { appointmentId: 'a', startAt: nextDate, professionalId: 'p-c', professionalName: 'Gaspar' },
    { appointmentId: 'b', startAt: moves[1]!.newStartAt, professionalId: 'p-b', professionalName: 'Juan' }
  ]
  const movedSnapshot = { ...sample, members: sample.members.map(member => ({ ...member,
    startAt: moves.find(move => move.appointmentId === member.appointmentId)!.newStartAt,
    professionalId: member.appointmentId === 'a' ? 'p-c' : member.professionalId })) }
  const movedContext = { ...paidContext, serverManagementSnapshot: movedSnapshot }
  const secondOpened = await respond(movedContext, movedState, 'Quiero reprogramar mi turno', port)
  const secondOffer = await respond({ ...movedContext, serverRuntimeBookingScope: { ...presented.scope, revision: '4' } },
    secondOpened.state, 'Para el 2030-10-10 a las 15:00', port)
  assert.equal(secondOffer.state.appointmentManagement?.context.proposal?.kind, 'GROUP_RESCHEDULE_PROPOSAL')
  assert.match(secondOffer.reply, /Iluminacion con Gaspar/, 'a later date-only proposal names the current professional')
  assert.doesNotMatch(secondOffer.reply, /Iluminacion con Tamara/, 'sealed original terms cannot revert the displayed professional')
  assert.match(secondOffer.reply, /Corte Hombre con Juan/, 'unchanged companion assignment remains current')
  assert.deepEqual(secondOffer.state.completedBooking, movedState.completedBooking, 'a later proposal preserves payment and current assignment evidence')
  const secondConfirmed = await respond({ ...movedContext, serverRuntimeBookingScope: { ...presented.scope, revision: '5' } },
    secondOffer.state, 'Confirmo la reprogramación', port)
  assert.equal(secondConfirmed.managementCommand?.kind, 'RESCHEDULE_APPOINTMENT_GROUP')
  const completed = finalizeAppointmentManagement(secondConfirmed, { appointmentIds: ['a', 'b'],
    moves: secondConfirmed.managementCommand!.kind === 'RESCHEDULE_APPOINTMENT_GROUP' ? secondConfirmed.managementCommand!.moves : [] })
  assert.match(completed.reply, /reprogramado/i)
  const afterContext = { ...movedContext, serverRuntimeBookingScope: { ...presented.scope, revision: '6' } }
  const infoPort: DialoguePort = { ...port, information: async () => ({ businessId: 'business', name: 'Demo',
    address: 'Calle Prueba 123', area: null, mapsUrl: null, website: null, bookingUrl: null, whatsapp: null,
    email: null, instagram: null, facebook: null, tiktok: null, description: null, hours: null }) }
  const address = await respond(afterContext, completed.state, '¿Dónde quedan?', infoPort)
  assert.match(address.reply, /Calle Prueba 123/, 'completed rescheduling permits the next informative conversation turn')
  assert.equal(address.state.appointmentManagement, undefined, 'completed management does not keep intercepting messages')
  assert.deepEqual(address.state.completedBooking, completed.state.completedBooking, 'ordinary followup preserves paid receipt')
  const newBooking = await respond(afterContext, completed.state, 'Quiero otro turno', port)
  assert.equal(newBooking.state.appointmentManagement, undefined, 'another booking starts the normal draft flow')
  assert.doesNotMatch(newBooking.reply, /grupo de turnos fue reprogramado/i)
  assert.deepEqual(newBooking.state.completedBooking, completed.state.completedBooking, 'new draft keeps prior payment registered')
  assert.equal(newBooking.bookingCommand, undefined)
})

if (failures.length) { console.error(`${failures.length} confirmed reschedule intent regression(s) failed`); process.exitCode = 1 }
else console.log('confirmed reschedule intent regression: PASS')
