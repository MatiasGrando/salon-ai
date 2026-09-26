import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { operationalResetConfirmationMatches } from '../src/services/business-operational-reset.js'

assert.equal(operationalResetConfirmationMatches({
  businessName: 'Barber Demo',
  confirmation: 'Barber Demo',
  phrase: 'BORRAR DATOS DE PRUEBA'
}), true)
assert.equal(operationalResetConfirmationMatches({
  businessName: 'Barber Demo',
  confirmation: 'barber demo',
  phrase: 'BORRAR DATOS DE PRUEBA'
}), false)
assert.equal(operationalResetConfirmationMatches({
  businessName: 'Barber Demo',
  confirmation: 'Barber Demo',
  phrase: 'borrar datos de prueba'
}), false)

const service = readFileSync(new URL('../src/services/business-operational-reset.ts', import.meta.url), 'utf8')
assert.ok(service.includes("prisma.$transaction"))
assert.match(service, /getBusinessOperationalResetPreview/)
assert.match(service, /bookingDepositReviewOutbox.deleteMany/)
assert.match(service, /bookingDepositLateProofHandoff.deleteMany/)
assert.match(service, /bookingDepositExpiryAudit.deleteMany/)
assert.match(service, /bookingDepositProof.deleteMany/)
assert.match(service, /bookingDepositLine.deleteMany/)
assert.match(service, /appointmentChangeHistory.deleteMany/)
assert.match(service, /professionalAccountEntry.deleteMany/)
assert.match(service, /treasuryMovement.deleteMany/)
assert.match(service, /cashEntry.deleteMany/)
assert.match(service, /productSaleAudit.deleteMany/)
assert.match(service, /productSaleLine.deleteMany/)
assert.match(service, /productSale.deleteMany/)
assert.match(service, /appointmentTotalAdjustment.deleteMany/)
assert.match(service, /appointmentAccountLink.deleteMany/)
assert.match(service, /bookingDeposit.deleteMany/)
assert.match(service, /reminderDelivery.deleteMany/)
assert.match(service, /postSaleDelivery.deleteMany/)
assert.match(service, /appointmentServiceItem.deleteMany/)
assert.match(service, /appointment.deleteMany/)
assert.match(service, /bookingVisit.deleteMany/)
assert.match(service, /appointmentAccount.deleteMany/)
assert.match(service, /cashSession.deleteMany/)
assert.match(service, /cashRegisterDay.deleteMany/)
assert.match(service, /staffAuditLog.create/)
assert.doesNotMatch(service, /professional.deleteMany/)
assert.doesNotMatch(service, /service.deleteMany/)
assert.doesNotMatch(service, /customer.deleteMany/)
assert.doesNotMatch(service, /product.deleteMany/)
assert.doesNotMatch(service, /businessPaymentMethod.deleteMany/)
assert.doesNotMatch(service, /cashExpenseCategory.deleteMany/)
assert.doesNotMatch(service, /treasuryAccount.deleteMany/)

const routes = readFileSync(new URL('../src/routes/business.ts', import.meta.url), 'utf8')
assert.ok(routes.includes("app.get('/businesses/:id/operational-reset-preview'"))
assert.ok(routes.includes("app.post('/businesses/:id/operational-reset'"))
assert.match(routes, /BUSINESS_ADMIN[\s\S]*ACCOUNT_ADMIN[\s\S]*SUPER_ADMIN/)
assert.match(routes, /verifyPassword/)
assert.match(routes, /operationalResetConfirmationMatches/)
assert.match(routes, /resetBusinessOperationalData/)

const ui = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
assert.match(ui, /Borrar datos de prueba/)
assert.match(ui, /operational-reset-dialog/)
assert.match(ui, /operational-reset-business-name/)
assert.match(ui, /operational-reset-phrase/)
assert.match(ui, /operational-reset-password/)
assert.match(ui, /BORRAR DATOS DE PRUEBA/)
assert.ok(ui.includes("'/businesses/' + encodeURIComponent(state.businessId) + '/operational-reset'"))
assert.ok(ui.includes("setButtonLoading(els.operationalResetSubmit"))
assert.doesNotMatch(ui, /window[.]confirm/)

console.log('business operational reset contract: OK')
