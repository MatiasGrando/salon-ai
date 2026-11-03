import assert from 'node:assert/strict'
import Fastify from 'fastify'

process.env.DOTENV_CONFIG_PATH = '__offline_reminder_internal_dispatch_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline'
process.env.DIRECT_URL = process.env.DATABASE_URL
process.env.NODE_ENV = 'test'
process.env.AUTOMATION_SCHEDULER_ENABLED = 'true'
process.env.WHATSAPP_ALLOW_INTERNAL_FALLBACK = 'false'
delete process.env.REMINDER_PROCESS_INTERVAL_MINUTES
delete process.env.AUTOMATED_CAMPAIGN_INTERVAL_HOURS

let externalCalls = 0
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { externalCalls++; throw new Error('External requests are forbidden') }
const { prisma } = await import('../src/config/prisma.js')
const { authGuard } = await import('../src/plugins/auth-guard.js')
const { campaignRoutes } = await import('../src/routes/campaign.js')
const { startMarketingScheduler } = await import('../src/services/marketing-scheduler.js')
const { WhatsAppCloudApi } = await import('../src/integrations/whatsapp-cloud-api.js')
const { PrismaCommunicationAttemptRepository } = await import('../src/infrastructure/communications/prisma-communication-attempt-repository.js')
const p = prisma as any
const originals: Array<() => void> = []
function replace(target: any, key: string, value: any) {
  const original = target[key]
  originals.push(() => { target[key] = original })
  target[key] = value
}
const NativeDate = Date
const now = NativeDate.parse('2026-10-28T15:42:00Z')
class FixedDate extends NativeDate {
  constructor(value?: any) { super(value === undefined ? now : value) }
  static now() { return now }
}
globalThis.Date = FixedDate as DateConstructor

const businessId = 'offline-reminder-business'
let automation: any
let template: any
let appointment: any
let delivery: any
let business: any
let claimAllowed = true
let providerThrows = false
let sends = 0
let records = 0
let campaignReads = 0
let postSaleReads = 0
let scheduledBusinesses = [businessId]
let holdCampaign: Promise<any[]> | null = null
function reset() {
  automation = { id: 'offline-automation', businessId, templateId: 'offline-template', mode: 'AUTOMATIC_API', enabled: true, sendBeforeMinutes: 240 }
  template = { id: 'offline-template', businessId, status: 'APPROVED', category: 'UTILITY', body: 'Hola {{nombre_cliente}}', metaName: 'offline_template', language: 'es_AR' }
  appointment = { id: 'offline-appointment', status: 'CONFIRMED', startAt: new NativeDate(now + 18 * 60_000), customer: { id: 'offline-customer', name: 'Cliente offline', phone: '5491100000000' }, service: { name: 'Servicio offline' }, professional: { name: 'Profesional offline' } }
  delivery = { id: 'offline-delivery', businessId, reminderAutomationId: automation.id, appointmentId: appointment.id, customerId: appointment.customer.id, customer: appointment.customer, appointment, scheduledFor: new NativeDate(appointment.startAt.getTime() - 240 * 60_000), status: 'PENDING', attemptNumber: 0 }
  business = { accountStatus: 'ACTIVE', whatsappConfig: { accessToken: 'offline-placeholder', phoneNumberId: 'offline-placeholder', wabaId: 'offline-placeholder', connectionStatus: 'CONNECTED' }, featureSettings: { realWhatsappEnabled: true, remindersEnabled: true, reminderSendingLocked: false } }
  claimAllowed = true
  providerThrows = false
}
reset()
replace(p.campaign, 'findMany', async () => { campaignReads++; return holdCampaign ?? [] })
replace(p.business, 'findUnique', async ({ where }: any) => {
  if (where.id === 'offline-failing-business') throw new Error('offline-provider-payload')
  return business
})
replace(p.userSession, 'findUnique', async () => { throw new Error('A browser session must not be queried') })
replace(p.reminderAutomation, 'findMany', async ({ where, distinct }: any) => {
  if (distinct) {
    assert.equal(where.business.accountStatus, 'ACTIVE')
    assert.equal(where.channel, 'WHATSAPP')
    return scheduledBusinesses.map(businessId => ({ businessId }))
  }
  assert.equal(where.businessId, businessId)
  const matches = typeof where.mode === 'string' ? automation.mode === where.mode : where.mode.in.includes(automation.mode)
  return matches ? [automation] : []
})
replace(p.whatsAppTemplate, 'findFirst', async ({ where }: any) => {
  assert.equal(where.businessId, businessId)
  return (!where.status || where.status === template.status) && (!where.category || where.category === template.category) ? template : null
})
replace(p.appointment, 'findMany', async ({ where }: any) => appointment.status === where.status && appointment.startAt > where.startAt.gt && appointment.startAt <= where.startAt.lte ? [appointment] : [])
replace(p.reminderDelivery, 'findUnique', async () => delivery)
replace(p.reminderDelivery, 'updateMany', async ({ where, data }: any) => {
  if (!where.id) return { count: 0 }
  if (!where.status.in.includes(delivery.status) || (data.status === 'PROCESSING' && !claimAllowed)) return { count: 0 }
  Object.assign(delivery, data)
  return { count: 1 }
})
replace(p.reminderDelivery, 'findMany', async ({ where }: any) => {
  assert.equal(where.reminderAutomationId, automation.id)
  assert.equal(where.attemptNumber.lt, 3)
  return where.status.in.includes(delivery.status) && delivery.attemptNumber < 3 && delivery.scheduledFor <= where.scheduledFor.lte && appointment.status === where.appointment.status && appointment.startAt > where.appointment.startAt.gt && appointment.startAt <= where.appointment.startAt.lte ? [{ ...delivery }] : []
})
replace(p.reminderDelivery, 'update', async ({ data }: any) => {
  Object.assign(delivery, { ...data, attemptNumber: delivery.attemptNumber + (data.attemptNumber?.increment ?? 0) })
  return delivery
})
replace(p.postSaleDelivery, 'updateMany', async () => ({ count: 0 }))
replace(p.postSaleAutomation, 'findMany', async () => { postSaleReads++; return [] })
replace(p, '$queryRaw', async () => [{ id: 'offline-conversation' }])
replace(p.message, 'create', async () => ({ id: 'offline-message' }))
replace(p.conversation, 'update', async () => ({ id: 'offline-conversation' }))
replace(p, '$transaction', async (operations: any[]) => Promise.all(operations))
replace(PrismaCommunicationAttemptRepository.prototype, 'record', async () => { records++ })
replace(WhatsAppCloudApi.prototype, 'sendTemplateMessage', async (input: any) => {
  sends++
  assert.equal(input.businessId, businessId)
  assert.equal(input.templateName, template.metaName)
  if (providerThrows) throw new Error('offline provider failure containing no real data')
  return { sent: true, response: { messages: [{ id: 'offline-provider-message' }] } }
})

const app = Fastify()
const logs: Array<{ level: string; data: any; message: string }> = []
for (const level of ['info', 'warn', 'error'] as const) replace(app.log, level, (data: any, message: string) => { logs.push({ level, data, message }) })
await authGuard(app)
await app.register(campaignRoutes)
const requests: any[] = []
const inject = app.inject.bind(app)
replace(app, 'inject', (options: any) => { requests.push(options); return inject(options) })
type Timer = { callback: () => Promise<void> | void; delay: number; unref: () => void }
const intervals: Timer[] = []
const timeouts: Timer[] = []
const originalInterval = globalThis.setInterval
const originalTimeout = globalThis.setTimeout
try {
  globalThis.setInterval = ((callback: Timer['callback'], delay: number) => { const timer = { callback, delay, unref() {} }; intervals.push(timer); return timer }) as any
  globalThis.setTimeout = ((callback: Timer['callback'], delay: number) => { const timer = { callback, delay, unref() {} }; timeouts.push(timer); return timer }) as any
  startMarketingScheduler(app)
  globalThis.setInterval = originalInterval
  globalThis.setTimeout = originalTimeout
  const unauthenticated = await inject({ method: 'POST', url: '/reminder-automations/process-due', payload: { businessId, limit: 100 } })
  assert.equal(unauthenticated.statusCode, 401, 'the real manual HTTP endpoint remains protected')
  assert.equal(sends, 0)
  assert.deepEqual(intervals.map(timer => timer.delay), [12 * 60 * 60_000, 15 * 60_000])
  assert.equal(timeouts[0]?.delay, 30_000)
  const cycle = intervals[1]!.callback
  await cycle()
  assert.equal(sends, 1, 'an unattended scheduler cycle must reach the reminder service without a browser cookie')
  assert.equal(requests.length, 0, 'reminders must not use HTTP authentication as an internal execution mechanism')
  assert.equal(delivery.status, 'SENT')
  assert.equal(records, 1)
  await cycle()
  assert.equal(sends, 1, 'the next cycle cannot resend a completed delivery')
  let guardedCases = 0
  const cases: Array<[string, () => void]> = [
    ['inactive account', () => { business.accountStatus = 'SUSPENDED' }],
    ['real sends disabled', () => { business.featureSettings.realWhatsappEnabled = false }],
    ['reminders disabled', () => { business.featureSettings.remindersEnabled = false }],
    ['reminders locked', () => { business.featureSettings.reminderSendingLocked = true }],
    ['WhatsApp disconnected', () => { business.whatsappConfig.connectionStatus = 'NOT_CONNECTED' }],
    ['WhatsApp credentials missing', () => { business.whatsappConfig.accessToken = '' }],
    ['WhatsApp connection error', () => { business.whatsappConfig.lastError = 'offline-provider-payload' }],
    ['unapproved template', () => { template.status = 'DRAFT' }],
    ['marketing template', () => { template.category = 'MARKETING' }],
    ['paused automation', () => { automation.mode = 'PAUSED' }],
    ['manual automation', () => { automation.mode = 'MANUAL_ASSISTED' }],
    ['appointment not confirmed', () => { appointment.status = 'CANCELLED' }],
    ['appointment already started', () => { appointment.startAt = new NativeDate(now - 1) }],
    ['appointment not due', () => { appointment.startAt = new NativeDate(now + 241 * 60_000) }],
    ['retry limit', () => { delivery.attemptNumber = 3 }],
    ...['OPENED', 'SENT', 'DELIVERED', 'READ', 'PROCESSING'].map(status => [status, () => { delivery.status = status }] as [string, () => void]),
    ['lost claim', () => { claimAllowed = false }]
  ]
  for (const [name, configure] of cases) {
    reset(); configure()
    const before: number = sends
    await cycle()
    assert.equal(sends, before, name + ' must prevent automatic delivery')
    guardedCases++
  }
  assert.ok(logs.some(log => log.level === 'warn' && log.data.blocked === true), 'blocked internal runs must be observable')
  reset()
  providerThrows = true
  await cycle()
  assert.ok(logs.some(log => log.level === 'error' && log.data.businessId === businessId), 'internal failures must be logged for the affected business')
  reset()
  const beforeRecovery = sends
  await cycle()
  assert.equal(sends, beforeRecovery + 1, 'an exception cannot leave the scheduler overlap guard locked')
  reset()
  scheduledBusinesses = ['offline-failing-business', businessId]
  const beforeBusinessFailure = sends
  const beforePostSales = postSaleReads
  await cycle()
  assert.equal(sends, beforeBusinessFailure + 1, 'one business failure cannot skip the next business')
  assert.ok(postSaleReads > beforePostSales, 'one reminder failure cannot skip the existing post-sale processor')
  assert.ok(logs.some(log => log.level === 'error' && log.data.businessId === 'offline-failing-business'))
  assert.ok(logs.every(log => !JSON.stringify(log).includes('offline-placeholder') && !JSON.stringify(log).includes('5491100000000') && !JSON.stringify(log).includes('offline-provider-payload')), 'scheduler logs must not contain credentials, recipient phones or provider failures')
  scheduledBusinesses = [businessId]
  let release!: (value: any[]) => void
  holdCampaign = new Promise(resolve => { release = resolve })
  const running = cycle()
  const beforeOverlap = campaignReads
  await cycle()
  assert.equal(campaignReads, beforeOverlap, 'overlapping timer cycles must not run concurrently')
  holdCampaign = null
  release([])
  await running
  await app.close()
  const beforeClose = campaignReads
  await cycle()
  assert.equal(campaignReads, beforeClose, 'closing the app stops subsequent scheduler callbacks')
  assert.equal(externalCalls, 0)
  console.log(JSON.stringify({ passed: true, guardedCases, manualHttpStatus: unauthenticated.statusCode, externalCalls }))
} finally {
  globalThis.setInterval = originalInterval
  globalThis.setTimeout = originalTimeout
  globalThis.Date = NativeDate
  await app.close()
  for (const restore of originals.reverse()) restore()
  globalThis.fetch = originalFetch
  await prisma.$disconnect()
}
