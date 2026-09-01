import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

assert.match(source, /function appointmentCustomerChanges\(customer, nameValue, phoneValue\)/)
const changesBody = source.match(/function appointmentCustomerChanges\(customer, nameValue, phoneValue\) \{([\s\S]*?)\n    \}/)?.[1] || ''
const changes = new Function('customer', 'nameValue', 'phoneValue', changesBody) as (
  customer: { name: string; phone: string },
  name: string,
  phone: string
) => { name: string; phone: string; changed: boolean }

assert.equal(
  changes({ name: 'Cliente provisional', phone: '' }, 'Nombre corregido', '').changed,
  true,
  'cambiar el nombre debe detectarse aunque el cliente no tenga telefono'
)
assert.equal(
  changes({ name: 'Cliente', phone: '5491112345678' }, 'Cliente', '5491112345678').changed,
  false,
  'los datos sin cambios no deben generar escrituras'
)

assert.doesNotMatch(source, /selectedCustomer && phone &&/)
assert.match(source, /function appointmentDetailsChanged\(/)
assert.match(source, /function applyUpdatedCustomerLocally\(/)
assert.match(source, /if \(appointment && customerChanges\.changed && !appointmentChanged\)/)
assert.match(source, /await updateAppointmentCustomer\(customerId, customerChanges\)/)

const customerOnlyBranch = source.match(/if \(appointment && customerChanges\.changed && !appointmentChanged\) \{([\s\S]*?)\n      \}/)?.[1] || ''
assert.match(customerOnlyBranch, /applyUpdatedCustomerLocally\(updatedCustomer\)/)
assert.match(customerOnlyBranch, /renderAgenda\(\)/)
assert.doesNotMatch(customerOnlyBranch, /loadAgenda\(/, 'editar solo el cliente no debe recargar toda la agenda')
assert.doesNotMatch(customerOnlyBranch, /check-availability/, 'editar solo el cliente no debe consultar disponibilidad')

console.log('OK: editar datos del cliente desde un turno actualiza solo lo necesario.')
