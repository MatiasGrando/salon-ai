import assert from 'node:assert/strict'
import { appliedChangeAcknowledgment } from '../src/conversational-bot/draft-delivery.js'
import { initialDialogueState, type DialogueService, type DialogueTurnOutcome } from '../src/conversational-bot/engine.js'
const before = { ...initialDialogueState('tenant'), serviceId: 'first', customerName: 'Ana', date: '2026-10-04' }
const services: DialogueService[] = [{ id: 'first', name: 'Servicio A', price: 100, durationMinutes: 30, requiresConsultation: false }, { id: 'second', name: 'Servicio B', price: 200, durationMinutes: 30, requiresConsultation: false }]
const outcome: DialogueTurnOutcome = { changedFields: ['service', 'time'], appliedFields: ['service'], requestedChanges: [], rejectedProfessionalPreference: false }
const after = { ...before, serviceId: 'second', slot: null }
assert.equal(appliedChangeAcknowledgment(before, after, services, outcome), 'Perfecto, seguimos sólo con Servicio B.')
assert.equal(appliedChangeAcknowledgment(before, before, services, outcome), '', 'a claimed unchanged action is not acknowledged')
assert.equal(appliedChangeAcknowledgment(before, after, services, { ...outcome, appliedFields: [], requestedChanges: ['service'] }), '', 'requesting an edit is not applying one')
assert.doesNotMatch(appliedChangeAcknowledgment(before, after, services, outcome), /horario|reservad|confirmad/i, 'dependent invalidation is not an explicit time decision')
assert.equal(appliedChangeAcknowledgment(before, { ...after, serviceId: 'foreign' }, services, outcome), '', 'unknown catalog ID cannot be narrated as an applied selection')
assert.equal(appliedChangeAcknowledgment(before, { ...before, date: '2026-10-05' }, services, { ...outcome, changedFields: ['date', 'time'], appliedFields: ['date'] }), 'Perfecto, cambié la fecha al 05/10/2026.')
console.log('PASS applied-change acknowledgment grounded in actual state and explicit server outcome')
assert.equal(appliedChangeAcknowledgment(initialDialogueState('tenant'), { ...initialDialogueState('tenant'), serviceId: 'second' }, services, outcome), '', 'initial selection already has its verified introduction, not a duplicate change acknowledgment')