import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  appointmentDialogLayoutScript,
  appointmentDialogStyles,
  appointmentCheckoutMarkup,
  renderAppointmentDialogMarkup,
} from '../src/routes/crm-ui/appointment-dialog.js'

const fixture = await readFile(new URL('./fixtures/weex-appointment-reference-v2.html', import.meta.url))
assert.equal(createHash('sha256').update(fixture).digest('hex'), '3efeec518d599e03bc5c45b0d5c1296c6c894a47715eef19c1f40c4b8d95aa7b')

const markup = renderAppointmentDialogMarkup({ cashRegisterEnabled: true, financeCreateMarkup: '<div id="create-slot"></div>', financeEditMarkup: '<div id="finance-slot"></div>', productsMarkup: '<div id="products-slot"></div>', correctionMarkup: '<div id="correction-slot"></div>' })
const ids = [...(markup + appointmentCheckoutMarkup).matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
assert.equal(new Set(ids).size, ids.length, 'editor and checkout must not duplicate IDs')
for (const id of ['appointment-form', 'appointment-start', 'appointment-service', 'appointment-professional', 'appointment-customer', 'appointment-customer-search', 'appointment-customer-results', 'appointment-customer-name', 'appointment-customer-phone', 'appointment-customer-technical-profile-input', 'appointment-notes', 'appointment-submit', 'appointment-complete', 'appointment-no-show', 'appointment-delete', 'appointment-add-service-submit', 'appointment-attention-color', 'create-slot', 'finance-slot', 'products-slot', 'correction-slot']) assert.ok(ids.includes(id), 'missing real editor control: ' + id)
assert.match(markup, /id="appointment-start" type="datetime-local"/)
assert.match(markup, /data-appointment-tabpanel="turno"/)
assert.match(markup, /data-appointment-tabpanel="cliente"/)
assert.match(markup, /data-appointment-tabpanel="pago"/)
assert.match(markup, /id="appointment-mobile-charge"/)
assert.match(markup, /id="appointment-dirty-note" hidden/)
assert.match(appointmentDialogStyles, /980px/)
assert.match(appointmentDialogStyles, /600px/)
assert.match(appointmentDialogStyles, /410px/)
assert.match(appointmentDialogStyles, /1\.35fr/)
assert.match(appointmentDialogStyles, /max-width:\s*700px/)
assert.match(appointmentDialogStyles, /max-width:\s*380px/)
assert.match(appointmentCheckoutMarkup, /role="dialog" aria-modal="true"/)
assert.match(appointmentCheckoutMarkup, /id="appointment-checkout-methods"/)
assert.match(appointmentCheckoutMarkup, /id="appointment-checkout-mixed" hidden/)
assert.match(appointmentCheckoutMarkup, /Marcar este turno como realizado/)
assert.doesNotMatch(markup + appointmentCheckoutMarkup, /appointment-finance-history|<form[^>]*>[\s\S]*<form/)
assert.doesNotMatch(appointmentDialogLayoutScript, /\b(fetch|api|confirm|alert|prompt)\s*\(/)
assert.doesNotMatch(markup + appointmentCheckoutMarkup, /Mat[ií]as|Carolina|Gaspar|10000/)
assert.doesNotMatch(renderAppointmentDialogMarkup({ cashRegisterEnabled: false }), /id="appointment-mobile-charge"/)
console.log('OK: approved appointment reference composition preserves real controls without duplicate IDs or fake business data.')
