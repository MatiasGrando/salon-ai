import assert from 'node:assert/strict'
import { initialDialogueState, parseDialogueState, respond, respondConversationChoice, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { attachReferralOffer } from '../src/conversational-bot/conversational-referral.js'
import { parseTurnPlan } from '../src/conversational-bot/turn-plan.js'
import { runConversationalPreview } from '../src/conversational-bot/demo-preview.js'
import { projectConversationDraft, readConversationDraft } from '../src/conversational-bot/session-state.js'

const context = { businessId: 'tenant', timezone: 'UTC', dbNow: new Date('2026-10-04T12:00:00Z') }
const services: DialogueService[] = [
  { id: 'cut', name: 'Corte', price: 100, durationMinutes: 30, requiresConsultation: false },
  { id: 'review', name: 'Coloración', price: 200, durationMinutes: 60, requiresConsultation: true }
]
let agenda = 0
const port: DialoguePort = {
  catalog: async () => services,
  availability: async () => { agenda++; return { professionals: [], slots: [] } },
  information: async () => ({ businessId: 'tenant', name: 'Local', address: 'Calle 123', area: null, mapsUrl: null,
    website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null,
    description: null, hours: '9 a 20' })
}
const base = { intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null,
  serviceConfidence: 'certain', serviceCandidateIds: [], serviceCorrection: false, informationTarget: null, firstReply: null, intakeReply: null }
const operation = (kind: string, evidence: string, fields: object = {}) => ({ kind, evidence, confidence: 1, ...fields })
const provider = (operations: object[]) => (async () => ({ ...base, turnPlan: { version: 1, operations } })) as AiInterpretationProvider
const say = (state: DialogueState, message: string, operations: object[]) => respondWithAiInterpreter(context, state, message, port, provider(operations))
const initial = { ...initialDialogueState('tenant'), customerName: 'Matías', date: '2026-10-05' }
const unknownOp = operation('service_request', 'corte francés', {
  purpose: 'booking', disposition: 'unverified_variant', serviceIds: [], correction: false,
  continuation: false, basis: 'related_category', sourceQuote: null
})
const unknown = await say(initial, 'corte francés', [unknownOp])
assert.equal((unknown.state as any).referral?.status, 'offered', 'an actual offer to consult the team is recoverable state')
assert.equal((unknown.state as any).referral?.request, 'corte francés')
const consulting = await say(unknown.state, 'consultar al equipo', [operation('referral', 'consultar al equipo', { action: 'consult' })])
assert.equal(consulting.interpretation.mode, 'ai')
assert.equal((consulting.state as any).referral?.status, 'pending')
assert.equal(consulting.state.customerName, 'Matías')
assert.equal(consulting.state.date, '2026-10-05')
assert.equal(consulting.proposal, null)
assert.doesNotMatch(consulting.reply, /te derivé|ya.*(?:derivad|enviad)|transferid|foto recibida/i)
const lateral = await say(consulting.state, 'dónde están', [operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })])
assert.match(lateral.reply, /Calle 123/)
assert.equal((lateral.state as any).referral?.status, 'pending', 'lateral reads do not cancel consultation')
assert.doesNotMatch(lateral.reply, /¿Querés consultarlo/)
const resume = await say(lateral.state, 'quiero seguir con el bot', [operation('referral', 'quiero seguir con el bot', { action: 'resume' })])
assert.equal((resume.state as any).referral, undefined)
assert.equal(resume.state.serviceRequest?.request, 'corte francés')
assert.equal(resume.state.customerName, 'Matías')
assert.equal(resume.state.date, '2026-10-05')
assert.equal(resume.proposal, null)
assert.doesNotMatch(resume.reply, /¿Querés consultarlo|transferid|reservado/)
const fallbackResume = await respond(context, consulting.state, 'sacar la derivación', port)
assert.equal((fallbackResume.state as any).referral, undefined, 'explicit return works without AI')
assert.equal(agenda, 0, 'unknown consultation and return cannot load agenda')
const blocked = await say(initial, 'Coloración', [operation('service', 'Coloración', { mode: 'single', serviceIds: ['review'], correction: false })])
assert.equal((blocked.state as any).referral?.status, 'offered')
assert.equal((blocked.state as any).referral?.serviceId, 'review')
const pendingBlock = await say(blocked.state, 'consultar al equipo', [operation('referral', 'consultar al equipo', { action: 'consult' })])
const same = await say(pendingBlock.state, 'sí', [])
assert.equal((same.state as any).referral?.status, 'pending')
assert.equal(same.proposal, null, 'consultation yes never means booking consent')
assert.equal(same.bookingCommand, undefined)
const blockedReturn = await say(pendingBlock.state, 'volver al bot', [operation('referral', 'volver al bot', { action: 'resume' })])
assert.equal((blockedReturn.state as any).referral, undefined)
assert.equal(blockedReturn.state.serviceId, 'review')
assert.equal(blockedReturn.proposal, null, 'return does not bypass review policy')
assert.match(blockedReturn.reply, /consulta|equipo/)
assert.equal(agenda, 0)
const changed = await say(pendingBlock.state, 'mejor Corte', [operation('service', 'Corte', { mode: 'single', serviceIds: ['cut'], correction: true })])
assert.equal((changed.state as any).referral, undefined, 'valid service replacement leaves consultation')
assert.equal(changed.state.serviceId, 'cut')
assert.equal(changed.state.customerName, 'Matías')
assert.equal(changed.state.date, '2026-10-05')
assert.ok(agenda > 0, 'changed valid draft resumes normal progression')
const basket = await say(initial, 'Corte y Coloración', [operation('basket', 'Corte y Coloración', {
  mutation: 'set', scope: 'all', targetMemberIds: [], members: [
    { mode: 'single', serviceIds: ['cut'], evidence: 'Corte', confidence: 1 },
    { mode: 'single', serviceIds: ['review'], evidence: 'Coloración', confidence: 1 }
  ]
})])
const basketPending = await say(basket.state, 'consultar al equipo', [operation('referral', 'consultar al equipo', { action: 'consult' })])
const member = basketPending.state.basket!.members.find(item => item.serviceIds.includes('review'))!
const removed = await say(basketPending.state, 'quitar Coloración', [operation('basket', 'quitar Coloración', {
  mutation: 'remove', scope: 'members', targetMemberIds: [member.memberId], members: []
})])
assert.equal((removed.state as any).referral, undefined)
assert.deepEqual(removed.state.basket?.members.flatMap(item => item.serviceIds), ['cut'], 'removal preserves companion')
const roundtrip = parseDialogueState(JSON.parse(JSON.stringify(consulting.state)), 'tenant')
assert.deepEqual((roundtrip as any).referral, (consulting.state as any).referral)
assert.throws(() => parseDialogueState({ ...consulting.state, referral: { ...(consulting.state as any).referral, businessId: 'foreign' } }, 'tenant'), /referral|scope/)
assert.throws(() => parseDialogueState({ ...consulting.state, referral: { ...(consulting.state as any).referral, queueId: 'fake' } }, 'tenant'), /referral|scope/)
const policy = { businessId: 'tenant', deploymentId: 'deployment', generation: 1, configurationId: 'config' }
const projected = projectConversationDraft(consulting.state, policy)
assert.deepEqual((readConversationDraft(JSON.parse(JSON.stringify(projected)), policy, 'UTC') as any).referral, (consulting.state as any).referral)
assert.equal(projected.handoff, 'NONE', 'conversational referral does not fabricate CRM ownership')
assert.throws(() => parseTurnPlan({ version: 1, operations: [
  operation('referral', 'sí', { action: 'consult' }), operation('confirm_proposal', 'sí')
] }, 'sí'), /consent|conflict|duplicate/)
const saved = new Map<string, DialogueState>()
const dependencies = {
  load: async (phone: string) => saved.get(phone) ?? null,
  save: async (phone: string, _message: string, _reply: string, state: DialogueState) => { saved.set(phone, JSON.parse(JSON.stringify(state))) },
  createPort: async () => ({ context, port })
}
await runConversationalPreview({ ...dependencies, interpretationProvider: provider([unknownOp]) }, 'tenant', 'preview', 'corte francés')
await runConversationalPreview({ ...dependencies, interpretationProvider: provider([operation('referral', 'consultar al equipo', { action: 'consult' })]) }, 'tenant', 'preview', 'consultar al equipo')
const previewReturn = await runConversationalPreview({ ...dependencies, interpretationProvider: provider([operation('referral', 'volver al bot', { action: 'resume' })]) }, 'tenant', 'preview', 'volver al bot')
assert.equal((previewReturn.state as any).referral, undefined)
assert.equal(previewReturn.state.serviceRequest?.request, 'corte francés')


const activeUnknown = await say({ ...initial, serviceId: 'cut' }, 'corte francés', [unknownOp])
const activeConsult = await say(activeUnknown.state, 'consultar al equipo', [operation('referral', 'consultar al equipo', { action: 'consult' })])
const beforeLegacyAgenda = agenda
const legacyDate = await respondWithAiInterpreter(context, activeConsult.state, 'mañana', port, (async () => base) as AiInterpretationProvider)
assert.equal(agenda, beforeLegacyAgenda, 'legacy turns cannot advance agenda while consultation is pending')
assert.equal((legacyDate.state as any).referral?.status, 'pending')
const legacyChange = await respondWithAiInterpreter(context, activeConsult.state, 'Corte', port,
  (async () => ({ ...base, serviceId: 'cut', serviceEvidence: 'Corte' })) as AiInterpretationProvider)
assert.equal((legacyChange.state as any).referral, undefined, 'explicit known legacy service exits the unknown request even with the same valid draft')
assert.equal(legacyChange.state.serviceRequest, undefined)

const sandboxContext = { ...context, sandboxBooking: true }
const sandboxPort: DialoguePort = { ...port, availability: async () => ({
  professionals: [{ id: 'ana', name: 'Ana', priority: 0 }],
  slots: [{ date: '2026-10-05', time: '17:00', startAt: '2026-10-05T17:00:00.000Z',
    professionalId: 'ana', professionalName: 'Ana', band: 'AFTERNOON', occupiedMinutes: 0 }]
}) }
const shownProposal = await respond(sandboxContext, initial, 'Corte con cualquiera a las 17', sandboxPort,
  { serviceId: null, candidateIds: [], correction: false, turnPlan: { version: 1, operations: [
    { kind: 'service', mode: 'single', serviceIds: ['cut'], correction: false, evidence: 'Corte', confidence: 1 },
    { kind: 'professional', mode: 'any', evidence: 'cualquiera', confidence: 1 },
    { kind: 'time', value: '17:00', evidence: '17', confidence: 1 }
  ] } })
assert.ok(shownProposal.state.sandboxReservation, 'the consent regression uses an actually presented sandbox proposal')
const proposedInquiry = await respondWithAiInterpreter(sandboxContext, shownProposal.state, 'corte francés', sandboxPort, provider([unknownOp]))
const unsafeYes = await respond(sandboxContext, proposedInquiry.state, 'sí', sandboxPort,
  { serviceId: null, candidateIds: [], correction: false, turnPlan: { version: 1, operations: [
    { kind: 'confirm_proposal', evidence: 'sí', confidence: 1 }
  ] } })
assert.equal(unsafeYes.bookingCommand, undefined, 'a yes to consultation cannot reuse a previous booking consent context')
assert.equal(unsafeYes.proposal, null)
await assert.rejects(() => respondConversationChoice(sandboxContext, {
  ...proposedInquiry.state, sandboxReservation: shownProposal.state.sandboxReservation,
  questionContext: shownProposal.state.questionContext
}, { kind: 'confirm', nonce: shownProposal.state.sandboxReservation!.presented.nonce }, sandboxPort),
  /no longer available/, 'old stored confirmation cannot bypass an offered consultation')
const photoService: DialogueService = { ...services[1]!, requiresConsultation: false, bookingPolicy: {
  id: 'review', name: 'Coloración', attentionMode: 'DIRECT_BOOKING', price: 200, priceMode: 'FIXED',
  estimateAllowsBooking: false, estimateQuestion: null, estimateOptions: [], estimateExplanation: null, estimateDisclaimer: null,
  requiresPhoto: true, validationEnabled: false, validationMessage: null, validationQuestion: null
} }
const photoPort: DialoguePort = { ...port, catalog: async () => [services[0]!, photoService] }
const photo = await respond(context, initial, 'Coloración', photoPort, { serviceId: 'review', candidateIds: [], correction: false })
assert.equal((photo.state as any).referral?.reason, 'PHOTO_REQUIRED')
assert.match(photo.reply, /foto previa/)
assert.doesNotMatch(photo.reply, /capacidad todavía|foto.*(?:aceptada|recibida)|ya.*deriv/i)
assert.equal((photo.reply.match(/foto previa/g) ?? []).length, 1, 'server never repeats photo warning')
const photoResume = await respond(context, photo.state, 'volver al bot', photoPort)
assert.equal((photoResume.state as any).referral, undefined)
assert.equal(photoResume.proposal, null)
assert.equal(photoResume.state.serviceId, 'review')
assert.match(photoResume.reply, /foto previa/)
const missing = await say(initial, 'consultar al equipo', [operation('referral', 'consultar al equipo', { action: 'consult' })])
assert.equal((missing.state as any).referral, undefined, 'without a pending request no consultation is invented')
const pendingData = await say(consulting.state, 'mañana soy Ana', [
  operation('date', 'mañana', { expression: 'mañana', value: '2026-10-05' }),
  operation('name', 'Ana', { value: 'Ana' })
])
assert.equal(pendingData.state.customerName, 'Ana')
assert.equal((pendingData.state as any).referral?.status, 'pending')

const photoId = { ...photoService, id: 'photo', name: 'Foto revisión', bookingPolicy: {
  ...photoService.bookingPolicy!, id: 'photo', name: 'Foto revisión'
} }
const mixedState: DialogueState = { ...initial, basket: { version: 1, nextMemberId: 3, members: [
  { memberId: 'm1', mode: 'single', serviceIds: ['review'], evidence: 'Coloración' },
  { memberId: 'm2', mode: 'single', serviceIds: ['photo'], evidence: 'Foto revisión' }
] } }
for (const catalog of [[services[1]!, photoId], [photoId, services[1]!]]) {
  const mixedReason = { state: structuredClone(mixedState), reply: 'Hace falta revisar la foto.', proposal: null,
    availability: { outcome: 'blocked' as const, phase: 'preflight' as const, reason: 'PHOTO_REQUIRED' as const } }
  attachReferralOffer(mixedReason, catalog)
  assert.equal(mixedReason.state.referral?.serviceId, 'photo', 'fresh blocking reason selects its own basket service, independent of catalog order')
  assert.equal(mixedReason.state.referral?.reason, 'PHOTO_REQUIRED')
}
const missingReasonProof = { state: structuredClone(mixedState), reply: 'No pude verificar este pedido.', proposal: null,
  availability: { outcome: 'blocked' as const, phase: 'preflight' as const, reason: 'PHOTO_REQUIRED' as const } }
attachReferralOffer(missingReasonProof, [services[1]!])
assert.equal(missingReasonProof.state.referral, undefined, 'no matching photo proof must not fabricate a referral for a domain-review service')
const copyIndependent = { state: structuredClone(unknown.state), reply: 'No tengo datos confirmados sobre esa prestación.', proposal: null }
delete copyIndependent.state.referral
attachReferralOffer(copyIndependent, services)
assert.equal(copyIndependent.state.referral?.status, 'offered', 'typed unknown outcome creates an offer regardless of copy vocabulary')
assert.match(copyIndependent.reply, /¿Querés consultarlo/, 'offered state must actually present a consultation question')
const unchangedUnknown = { state: structuredClone(unknown.state), reply: unknown.reply, proposal: null }
delete unchangedUnknown.state.referral
attachReferralOffer(unchangedUnknown, services)
assert.equal((unchangedUnknown.reply.match(/¿Querés consultarlo/g) ?? []).length, 1, 'canonical server offer is not repeated')
console.log('conversational referral: scoped pending/resume, draft preservation, policy guard and preview roundtrip PASS')
