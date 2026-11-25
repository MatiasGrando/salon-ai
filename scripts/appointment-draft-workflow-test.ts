import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { renderCrmHtml } from '../src/routes/crm-ui.js'
const source = renderCrmHtml({ cashRegisterEnabled: true, pollingMarker: {} as any })
const functionSource = (name: string) => {
  const start = source.indexOf('    function ' + name + '(')
  const asyncStart = source.indexOf('    async function ' + name + '(')
  const from = start < 0 ? asyncStart : start
  assert.ok(from >= 0, name + ' must exist')
  const end = source.indexOf('\n    }', from)
  return source.slice(from, end + 6)
}
const field = (value = '') => ({ value, checked: false })
const els: any = { appointmentStart: field('2026-01-01T10:00'), appointmentProfessional: field('pro'), appointmentService: field('svc'), appointmentCustomer: field('customer'), appointmentCustomerName: field(' Ana '), appointmentCustomerPhone: field(''), appointmentNotes: field(' note '), appointmentAttentionColor: field('NONE'), appointmentDepositPaid: field(), appointmentDepositAmount: field(), appointmentCustomerTechnicalProfileEditor: { hidden: true }, appointmentCustomerTechnicalProfileInput: field(), appointmentDialog: { hidden: false }, appointmentFeedback: { textContent: '' } }
const state: any = { appointmentDraftSnapshot: null, customers: [], currentUser: { id: 'staff' }, businessId: 'business' }
let confirmations = 0
let saves = 0
let confirm = false
const context = vm.createContext({ document: { getElementById: () => null }, els, state, JSON, Number, Date, Boolean, String, setAppointmentDialogMode() {}, readPendingAppointmentPayment: () => null, requestCrmConfirmation: async () => { confirmations++; return confirm }, saveManualAppointment: async () => { saves++; return { id: 'appointment' } }, editingAgendaAppointment: () => ({ id: 'appointment' }) })
for (const name of ['readAppointmentDraft', 'captureAppointmentDraft', 'appointmentDraftIsDirty', 'ensureAppointmentDraftSaved']) vm.runInContext(functionSource(name), context)
vm.runInContext('captureAppointmentDraft()', context)
assert.equal(vm.runInContext('appointmentDraftIsDirty()', context), false)
els.appointmentNotes.value = 'note'
assert.equal(vm.runInContext('appointmentDraftIsDirty()', context), false, 'whitespace normalization is not a write')
els.appointmentCustomerName.value = 'Bea'
assert.equal(vm.runInContext('appointmentDraftIsDirty()', context), true)
assert.equal(await vm.runInContext('ensureAppointmentDraftSaved()', context), false)
assert.equal(saves, 0, 'cancel must not save or charge')
confirm = true
assert.equal(await vm.runInContext('ensureAppointmentDraftSaved()', context), true)
assert.equal(saves, 1)
assert.equal(confirmations, 2)
const save = functionSource('persistManualAppointment')
assert.ok(save.indexOf('if (appointment && !appointmentChanged && !customerChanges.changed)') < save.indexOf("'/appointments/check-availability'"), 'unchanged details exit before availability')
assert.match(save, /options\.keepOpen/)
assert.match(save, /finishSavedManualAppointment/)
assert.match(source, /async function requestCloseAppointmentDialog/)
assert.match(source, /appointmentDraftIsDirty\(\)/)
console.log('OK: normalized appointment draft, protected actions and no-op save.')
