import assert from 'node:assert/strict'
import { presentAvailability, presentProfessionals, presentDateTimeQuestion, presentVerifiedDates, type AvailabilityPresentationInput, type AvailabilityRead } from '../src/conversational-bot/availability-presentation.js'
import type { AvailabilitySlot } from '../src/bot-options/application/availability-queries.js'
import { resolveDialogueDate } from '../src/conversational-bot/dialogue-date.js'

globalThis.fetch = (() => { throw new Error('network forbidden') }) as typeof fetch
const scope = { businessId: 'tenant', serviceIds: ['cut', 'care'], date: '2026-10-03', professionalId: null }
function slot(time: string, id = 'p1', date = '2026-10-03'): AvailabilitySlot {
  return { startAt: date + 'T' + String(Number(time.slice(0, 2)) + 3).padStart(2, '0') + time.slice(2) + ':00Z', date, time, band: Number(time.slice(0, 2)) < 12 ? 'MORNING' : 'AFTERNOON', professionalId: id, professionalName: id === 'p1' ? 'Ana' : 'Bea', occupiedMinutes: 30 }
}
const input = (slots: AvailabilitySlot[]): AvailabilityPresentationInput => ({ scope, timezone: 'America/Argentina/Buenos_Aires', now: new Date('2026-10-02T12:00:00Z'), read: { fresh: true, scope, slots } })
const few = [slot('10:00'), slot('13:00'), slot('17:00', 'p2')]
const result = presentAvailability(input(few))
assert.equal(result.kind, 'slots'); assert.equal(result.choices.length, 3)
assert.match(result.text, /03[-\/]10/); assert.match(result.text, /Ana/); assert.match(result.text, /Bea/)
assert.match(result.text, /10:00/); assert.match(result.text, /17:00/)
assert.doesNotMatch(result.text, /10:00 a 17:00|asign|reservad|confirmad/i)
assert.deepEqual(few, input(few).read.slots, 'does not mutate availability')
const eight = Array.from({ length: 8 }, (_, i) => slot(String(9 + i).padStart(2, '0') + ':00'))
assert.equal(presentAvailability(input(eight)).kind, 'slots')
assert.equal(presentAvailability(input(eight)).choices.length, 7)
assert.equal(presentAvailability(input(eight)).hasMore, true)
assert.equal(presentAvailability({ ...input(eight), cursor: 1 }).choices.length, 1)
const many = [...eight, slot('17:00')]
const adaptive = presentAvailability(input(many))
assert.equal(adaptive.kind, 'preference'); assert.doesNotMatch(adaptive.text, /09:00/)
assert.equal(adaptive.choices.every(choice => choice.kind === 'preference'), true)
assert.match(adaptive.text, /prefer/i)
const after = presentAvailability({ ...input(many), preference: { kind: 'after', time: '13:00' } })
assert.equal(after.kind, 'slots'); assert.equal(after.choices.length, 5)
assert.equal(after.choices.every(choice => choice.kind === 'slot' && choice.slot.time >= '13:00'), true)
assert.match(after.text, /13:00/)
const one = presentAvailability({ ...input([slot('13:00')]), preference: { kind: 'after', time: '13:00' } })
assert.equal(one.choices.length, 1); assert.match(one.text, /¿Cuál/)
assert.equal('selectedSlot' in one, false)
assert.equal(presentAvailability({ ...input(many), preference: { kind: 'before', time: '13:00' } }).choices.length, 4)
assert.equal(presentAvailability({ ...input(many), preference: { kind: 'any' } }).choices.length, 3)
assert.equal(presentAvailability({ ...input(many), preference: { kind: 'earliest' } }).choices.length, 3)
assert.equal(presentAvailability({ ...input(many), preference: { kind: 'band', band: 'MORNING' } }).choices.length, 3)
const concentrated = presentAvailability(input([slot('13:00'), slot('15:00')]))
assert.match(concentrated.text, /tarde/); assert.doesNotMatch(concentrated.text, /13:00 a 15:00/)
const nearest = presentAvailability({ ...input([slot('09:00'), slot('12:30'), slot('13:30'), slot('17:00')]), requestedTime: '13:00' })
assert.equal(nearest.choices.length, 3)
assert.deepEqual(nearest.choices.filter(c => c.kind === 'slot').map(c => c.slot.time), ['12:30', '13:30', '09:00'])
assert.match(nearest.text, /13:00.*disponible/)
const exact = presentAvailability({ ...input(few), requestedTime: '13:00' })
assert.equal(exact.choices.length, 1); assert.equal('selectedSlot' in exact, false)
assert.throws(() => presentAvailability({ ...input(few), requestedTime: '13:00', preference: { kind: 'after', time: '15:00' } }), /conflicting temporal/)
assert.equal(presentAvailability(input([])).kind, 'unavailable')
assert.throws(() => presentAvailability({ ...input(few), read: { ...input(few).read, fresh: false } }), /fresh/)
assert.throws(() => presentAvailability({ ...input(few), read: { ...input(few).read, scope: { ...scope, businessId: 'foreign' } } }), /scope/)
assert.throws(() => presentAvailability({ ...input(few), read: { ...input(few).read, scope: { ...scope, serviceIds: ['cut'] } } }), /scope/)
assert.throws(() => presentAvailability(input([ { ...slot('13:00'), date: '2026-10-04' } ])), /slot/)
assert.throws(() => presentAvailability(input([ { ...slot('13:00'), time: '25:00' } ])), /slot/)
assert.throws(() => presentAvailability({ ...input(few), cursor: -1 }), /cursor/)
assert.equal(presentAvailability(input([slot('13:00'), slot('13:00')])).choices.length, 1)
const fold: AvailabilitySlot[] = ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z'].map(startAt => ({ ...slot('01:30'), date: '2026-11-01', startAt }))
const foldScope = { ...scope, date: '2026-11-01' }
const dst = presentAvailability({ scope: foldScope, timezone: 'America/New_York', now: new Date('2026-10-01T00:00:00Z'), read: { fresh: true, scope: foldScope, slots: fold } })
assert.equal(dst.choices.length, 2); assert.match(dst.text, /UTC-4/); assert.match(dst.text, /UTC-5/)
const prof = presentProfessionals([{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Bea' }])
assert.equal(prof.choices[0]?.kind, 'any_professional')
assert.match(prof.text, /Cualquier profesional[\s\S]*Ana[\s\S]*Bea/)
assert.doesNotMatch(prof.text, /más disponibilidad/)
assert.throws(() => presentProfessionals([{ id: 'p1', name: 'Ana' }, { id: 'p1', name: 'Bea' }]), /professional/)
assert.match(presentDateTimeQuestion({ date: null, hasTemporalRequest: false })!, /día y horario/)
assert.doesNotMatch(presentDateTimeQuestion({ date: scope.date, hasTemporalRequest: false })!, /Qué día/)
assert.doesNotMatch(presentDateTimeQuestion({ date: null, hasTemporalRequest: true })!, /horario/)
assert.equal(presentDateTimeQuestion({ date: scope.date, hasTemporalRequest: true }), null)
const dateScope = { ...scope, date: null }
const dateRead: AvailabilityRead = { fresh: true, scope: dateScope, slots: [slot('13:00'), slot('14:00', 'p2', '2026-10-04')] }
const dates = presentVerifiedDates({ ...input([]), scope: dateScope, read: dateRead })
assert.equal(dates.choices.length, 2); assert.equal(dates.choices[0]?.kind, 'date')
assert.match(dates.text, /13:00/); assert.doesNotMatch(dates.text, /Hoy|17:00/)
assert.deepEqual(resolveDialogueDate(dates.example!, '2026-10-02'), { kind: 'resolved', date: '2026-10-03', source: 'iso' })
assert.equal(presentVerifiedDates({ ...input([]), scope: dateScope, read: { ...dateRead, slots: [] } }).example, null)
assert.throws(() => presentVerifiedDates({ ...input([]), scope: dateScope, read: { ...dateRead, fresh: false } }), /fresh/)
// Page navigation must not skip undisplayed options, even when the adaptive offer is short.
const anySecond = presentAvailability({ ...input(many), preference: { kind: 'any' }, cursor: 1 })
assert.equal(anySecond.choices[0]?.kind === 'slot' ? anySecond.choices[0].slot.time : null, '12:00')
const proPages = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `Profesional ${i}` }))
const secondProfessional = presentProfessionals(proPages, 1).choices[1]
assert.equal(secondProfessional?.kind === 'professional' ? secondProfessional.professionalId : null, 'p6')
const daySlots = Array.from({ length: 5 }, (_, i) => slot('13:00', 'p1', `2026-10-0${3 + i}`))
const datePages = { ...input([]), scope: dateScope, read: { fresh: true, scope: dateScope, slots: daySlots }, cursor: 1 }
const secondDate = presentVerifiedDates(datePages).choices[0]
assert.equal(secondDate?.kind === 'date' ? secondDate.date : null, '2026-10-06')
assert.throws(() => presentAvailability({ ...input([]), scope: { ...scope, date: '2026-02-30' }, read: { fresh: true, scope: { ...scope, date: '2026-02-30' }, slots: [] } }), /scope/)
assert.throws(() => presentAvailability({ ...input(few), scope: { ...scope, professionalId: 'p2' }, read: { ...input(few).read, scope: { ...scope, professionalId: 'p2' } } }), /slot/)
assert.throws(() => presentAvailability(input([{ ...slot('13:00'), startAt: '2026-10-01T16:00:00Z', date: '2026-10-01' }])), /slot/)

assert.throws(() => presentAvailability({ ...input(few), preference: { kind: 'earliest', extra: 'untrusted' } as never }), /preference/)
console.log('PASS adaptive offers, inclusive boundaries, exact alternatives, scope/freshness, DST, professionals, verified dates and complete pagination')
