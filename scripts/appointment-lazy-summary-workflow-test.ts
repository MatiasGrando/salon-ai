import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const cash = await readFile(new URL('../src/routes/crm-ui/cash-register.ts', import.meta.url), 'utf8')
const ui = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const block = (s: string, name: string) => { const start = s.search(new RegExp('    (?:async )?function ' + name + '\\(')); assert.ok(start >= 0, name); return s.slice(start, s.indexOf('\n    }', start) + 6) }
assert.match(block(cash, 'fetchAppointmentFinanceSummary'), /finance\?view=summary/)
assert.doesNotMatch(block(cash, 'loadAppointmentFinance'), /loadCashPaymentMethods|payment-context/)
assert.doesNotMatch(block(cash, 'prepareCreateAppointmentPayment'), /loadCreateAppointmentCashState\(/)
assert.doesNotMatch(block(cash, 'prepareAppointmentProducts'), /loadCashProducts\(|loadAppointmentProductItems\(/)
assert.doesNotMatch(block(ui, 'syncAppointmentCustomerFields'), /loadAppointmentCustomerTechnicalProfile\(/)
assert.doesNotMatch(cash, /id="appointment-finance-history"/)
assert.doesNotMatch(block(cash, 'renderAppointmentFinance'), /finance\.entries|serviceCorrections|totalAdjustments/)
assert.doesNotMatch(block(ui, 'addServiceToAppointmentVisit'), /loadAgenda\(/)
assert.doesNotMatch(block(cash, 'submitCompletedServiceCorrection'), /loadAgenda\(/)
console.log('OK: appointment reads are lazy, summaries are pure, and updates target the visit.')
