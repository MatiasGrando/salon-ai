import assert from 'node:assert/strict'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline'
const { prisma } = await import('../src/config/prisma.js')
const { WhatsAppCloudApi } = await import('../src/integrations/whatsapp-cloud-api.js')
const { sendBookingConfirmationEmail } = await import('../src/services/booking-confirmation-email-service.js')
const { createGoogleCalendarEventForAppointment } = await import('../src/services/weex-account-service.js')
const reminders = await import('../src/services/reminder-service.js')
const postSales = await import('../src/services/post-sale-service.js')
const { createSimulatorBookingIdentity } = await import('../src/services/simulator-booking-scope.js')
const identity = createSimulatorBookingIdentity({ businessId: 'barber', conversationId: 'qa', proposalRevision: 'one', proposalFingerprint: 'terms' })
let databaseCalls = 0
let externalCalls = 0
const deny = async () => { databaseCalls += 1; throw new Error('offline unexpected database') }
const p = prisma as any
p.businessWhatsAppConfig.findUnique = deny
p.weexAccount.findUnique = deny
const { OAuth2Client } = await import('google-auth-library')
const originalCalendarRequest = OAuth2Client.prototype.request
const blockedCalendarTransport = (async () => { externalCalls += 1; throw new Error('offline unexpected Calendar transport') }) as typeof OAuth2Client.prototype.request
OAuth2Client.prototype.request = blockedCalendarTransport
assert.equal(OAuth2Client.prototype.request, blockedCalendarTransport, 'Calendar transport must be replaced before service calls')
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { externalCalls += 1; throw new Error('offline unexpected external') }
try {
  const api = new WhatsAppCloudApi()
  for (const to of [identity.customerPhone, ' SIMQA:CUSTOMER:5491112345678 ']) {
    const base = { businessId: 'barber', to, text: 'hola' }
    for (const result of [await api.sendTextMessage(base), await api.sendReplyButtonsMessage({ ...base, buttons: [{ id: 'one', title: 'one' }] }), await api.sendInteractiveListMessage({ ...base, rows: [{ id: 'one', title: 'one' }] }), await api.sendTemplateMessage({ businessId: 'barber', to, templateName: 'one', languageCode: 'es_AR' })]) {
      assert.equal(result.sent, false)
      assert.match('reason' in result ? result.reason ?? '' : '', /simulador/i)
    }
  }
  const credentials = { apiVersion: 'v25.0', phoneNumberMode: 'production_argentina' }
  const normal = await api.sendTextMessage({ to: '5491112345678', text: 'hola', credentials })
  assert.equal(normal.sent, false)
  assert.match('reason' in normal ? normal.reason ?? '' : '', /no configurado/)
  const email = await sendBookingConfirmationEmail({ appointmentId: identity.appointmentId, recipientEmail: 'nobody@example.invalid', recipientName: 'QA', businessName: 'Demo', serviceName: 'Corte', professionalName: 'Cin', startAt: new Date(), durationMinutes: 30 })
  assert.equal(email.ok, false)
  const calendar = await createGoogleCalendarEventForAppointment({ accountId: 'never-load', appointmentId: identity.appointmentId })
  assert.equal(calendar.ok, false)
  assert.equal(databaseCalls, 0)
  assert.equal(externalCalls, 0)

  const future = new Date(Date.now() + 60_000)
  let writes = 0
  p.business.findUnique = async () => ({ accountStatus: 'ACTIVE' })
  const automation = { id: 'automation', businessId: 'barber', channel: 'WHATSAPP', mode: 'MANUAL_ASSISTED', templateId: 'template', sendBeforeMinutes: 120, delayMinutes: 1, template: { body: 'hola' } }
  p.reminderAutomation.findMany = async () => [automation]
  p.postSaleAutomation.findMany = async () => [automation]
  p.whatsAppTemplate.findFirst = async () => ({ body: 'hola' })
  for (const model of ['reminderDelivery', 'postSaleDelivery']) {
    p[model].updateMany = async () => ({ count: 0 })
    p[model].findUnique = async () => null
    p[model].findMany = async () => []
    p[model].createMany = async () => { writes += 1; return { count: 1 } }
  }
  const customer = { id: 'real', name: 'Matias', phone: '5491112345678' }
  const baseAppointment = { id: 'normal', customerId: customer.id, startAt: future, customer, service: { id: 'service', name: 'Corte', duration: 30, customerDurationMin: 30, customerDurationMax: 30 }, professional: { id: 'cin', name: 'Cin' } }
  const forbidden = [
    { ...baseAppointment, id: identity.appointmentId },
    { ...baseAppointment, customerId: identity.customerId, customer: { ...customer, id: identity.customerId } },
    { ...baseAppointment, customer: { ...customer, phone: identity.customerPhone } },
    { ...baseAppointment, id: ' SIMQA_APPOINTMENT_bad ' }
  ]
  p.appointment.findMany = async () => forbidden
  await reminders.prepareDueReminders({ businessId: 'barber' })
  p.appointment.findMany = async () => forbidden.map(a => ({ ...a, startAt: new Date(Date.now() - 120 * 60_000) }))
  await postSales.prepareDuePostSales({ businessId: 'barber' })
  assert.equal(writes, 0, 'sandbox appointments must not prepare deliveries')
  p.appointment.findMany = async () => [baseAppointment]
  await reminders.prepareDueReminders({ businessId: 'barber' })
  assert.equal(writes, 1, 'ordinary Barber appointment preparation unchanged')

  for (const appointment of forbidden) {
    const delivery = { id: 'delivery', businessId: 'barber', appointmentId: appointment.id, customerId: appointment.customer.id, customer: appointment.customer, appointment: { ...appointment, status: 'CONFIRMED' }, mode: 'WHATSAPP_MANUAL', status: 'PENDING', reminderAutomation: { mode: 'MANUAL_ASSISTED', sendBeforeMinutes: 120 }, automation: { mode: 'MANUAL_ASSISTED' } }
    p.reminderDelivery.findFirst = async () => delivery
    p.postSaleDelivery.findFirst = async () => delivery
    await assert.rejects(reminders.transitionManualReminder({ businessId: 'barber', automationId: 'automation', deliveryId: 'delivery', status: 'OPENED' }), /simulador/i)
    await assert.rejects(postSales.transitionManualPostSale({ businessId: 'barber', deliveryId: 'delivery', status: 'OPENED' }), /simulador/i)
  }
  const staleDelivery = { id: 'stale', scheduledFor: new Date(Date.now() - 60_000), businessId: 'barber', appointmentId: 'ordinary-appointment', customerId: customer.id, customer, appointment: { ...baseAppointment, customer: { ...customer, id: identity.customerId, phone: identity.customerPhone } }, mode: 'WHATSAPP_MANUAL', status: 'PENDING', reminderAutomation: { mode: 'MANUAL_ASSISTED', sendBeforeMinutes: 120 }, automation: { mode: 'MANUAL_ASSISTED' } }
  p.reminderDelivery.findFirst = async () => staleDelivery
  p.postSaleDelivery.findFirst = async () => staleDelivery
  for (const status of ['OPENED', 'SENT'] as const) {
    await assert.rejects(reminders.transitionManualReminder({ businessId: 'barber', automationId: 'automation', deliveryId: 'stale', status }), /simulador/i)
    await assert.rejects(postSales.transitionManualPostSale({ businessId: 'barber', deliveryId: 'stale', status }), /simulador/i)
  }
  p.appointment.findMany = async () => []
  p.business.findUnique = async () => ({ accountStatus: 'ACTIVE', whatsappConfig: { accessToken: 'offline-token', phoneNumberId: 'offline-number', wabaId: 'offline-waba', connectionStatus: 'CONNECTED' }, featureSettings: { realWhatsappEnabled: true, remindersEnabled: true }, botEnabled: true })
  p.whatsAppTemplate.findFirst = async () => ({ body: 'hola', metaName: 'offline', language: 'es_AR' })
  const automatic = { ...automation, mode: 'AUTOMATIC_API', responseWindowDays: 7, template: { body: 'hola', status: 'APPROVED', category: 'UTILITY', metaName: 'offline', language: 'es_AR' } }
  p.reminderAutomation.findMany = async () => [automatic]
  p.postSaleAutomation.findMany = async () => [automatic]
  let claims = 0
  for (const model of ['reminderDelivery', 'postSaleDelivery']) p[model].updateMany = async ({ data }: any) => { if (data.status === 'PROCESSING') claims += 1; return { count: 0 } }
  for (const status of ['PENDING', 'FAILED']) {
    const deliveries = [staleDelivery, ...forbidden.map((appointment, index) => ({ id: 'blocked-' + index, businessId: 'barber', appointmentId: appointment.id, customerId: appointment.customer.id, customer: appointment.customer, appointment, status, scheduledFor: new Date(Date.now() - 60_000) }))]
    p.reminderDelivery.findMany = async () => deliveries
    p.postSaleDelivery.findMany = async () => deliveries
    await reminders.processDueReminders({ businessId: 'barber' })
    await postSales.processDuePostSales({ businessId: 'barber' })
  }
  assert.equal(claims, 0, 'previously prepared sandbox deliveries must not be claimed')
  assert.equal(databaseCalls, 0, 'blocked sends must not resolve credentials')
  assert.equal(externalCalls, 0)
  p.weexAccount.findUnique = async () => ({ id: 'account', googleCalendarAccessToken: 'offline-token', googleCalendarScope: 'https://www.googleapis.com/auth/calendar.events.owned' })
  p.appointment.findUnique = async () => ({ ...baseAppointment, customer: { ...customer, id: identity.customerId, phone: identity.customerPhone }, serviceItems: [], totalDurationMinutes: 30, professional: { name: 'Cin', business: { name: 'Demo' } } })
  const calendarRecipient = await createGoogleCalendarEventForAppointment({ accountId: 'account', appointmentId: 'ordinary-appointment' })
  assert.equal(calendarRecipient.ok, false)
  const { campaignRoutes } = await import('../src/routes/campaign.js')
  const { postSaleRoutes } = await import('../src/routes/post-sale.js')
  const handlers = new Map<string, (request: any, reply: any) => Promise<any>>()
  const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (url: string, handler: any) => handlers.set(method + url, handler)]))
  await campaignRoutes(app as any)
  await postSaleRoutes(app as any)
  let statusCode = 200
  const reply = { status(code: number) { statusCode = code; return this }, send(body: any) { return body } }
  const testSend = handlers.get('post/whatsapp-templates/:id/test-send')!
  const testSendResult = await testSend({ body: { phone: ' SIMQA:CUSTOMER:5491112345678 ', confirmed: true }, params: { id: 'template' } }, reply)
  assert.equal(statusCode, 409)
  assert.match(testSendResult.message, /simulador/i)
  p.reminderAutomation.findFirst = async () => ({ ...automation, mode: 'PAUSED' })
  p.postSaleAutomation.findUnique = async () => ({ ...automation, mode: 'PAUSED' })
  const routeDelivery = { ...staleDelivery, reminderAutomationId: 'automation', messageSnapshot: 'hola', attemptNumber: 0, rating: null, createdAt: new Date(), scheduledFor: new Date(Date.now() - 60_000), appointment: { ...staleDelivery.appointment, status: 'CONFIRMED' } }
  p.reminderDelivery.findMany = async () => [routeDelivery]
  p.postSaleDelivery.findMany = async () => [routeDelivery]
  const reminderView = await handlers.get('get/reminder-automations/:id/deliveries')!({ params: { id: 'automation' }, query: { businessId: 'barber' } }, reply)
  const postSaleView = await handlers.get('get/post-sale/settings')!({ query: { businessId: 'barber' } }, reply)
  assert.equal(reminderView.deliveries[0].whatsappUrl, null)
  assert.equal(postSaleView.deliveries[0].whatsappUrl, null)

  assert.equal(externalCalls, 0, 'synthetic customer cannot be exported to Calendar')
  console.log('simulator-booking-no-contact: PASS')
} finally { OAuth2Client.prototype.request = originalCalendarRequest; globalThis.fetch = originalFetch; await prisma.$disconnect() }
