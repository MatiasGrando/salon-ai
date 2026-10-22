import assert from 'node:assert/strict'
import Fastify from 'fastify'
import vm from 'node:vm'
import { crmUiRoutes } from '../src/routes/crm-ui.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'

process.env.DOTENV_CONFIG_PATH = '__offline_reminder_offsets_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline'
process.env.DIRECT_URL = process.env.DATABASE_URL
const { prisma } = await import('../src/config/prisma.js')
const { campaignRoutes } = await import('../src/routes/campaign.js')
const { prepareDueReminders } = await import('../src/services/reminder-service.js')
const { WhatsAppCloudApi } = await import('../src/integrations/whatsapp-cloud-api.js')
const p = prisma as any
const originalFetch = globalThis.fetch
const originalSend = WhatsAppCloudApi.prototype.sendTemplateMessage
let externalCalls = 0
const denyExternal = async () => { externalCalls++; throw new Error('Unexpected external reminder call') }
globalThis.fetch = denyExternal as typeof fetch
WhatsAppCloudApi.prototype.sendTemplateMessage = denyExternal as any
const offsets = [60, 120, 240, 360, 480, 720, 1440, 2880]
const failures: string[] = []
let passed = 0
async function test(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); passed++; console.log('PASS ' + name) }
  catch (error) { failures.push(name + ': ' + (error instanceof Error ? error.message : String(error))); console.error('FAIL ' + failures.at(-1)) }
}
const handlers = new Map<string, (request: any, reply: any) => any>()
await campaignRoutes(Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (path: string, callback: any) => handlers.set(method + path, callback)])) as any)
let stored: any = null
let writes = 0
let serial = 0
p.reminderAutomation.create = async ({ data }: any) => { writes++; stored = { id: 'reminder-' + ++serial, ...data }; return { ...stored } }
p.reminderAutomation.update = async ({ where, data }: any) => { assert.equal(where.id, stored.id); writes++; stored = { ...stored, ...data }; return { ...stored } }
p.reminderAutomation.findFirst = async ({ where }: any) => where.id === stored?.id ? { ...stored } : null
p.reminderAutomation.findMany = async () => stored ? [{ ...stored }] : []
p.whatsAppTemplate.findFirst = async ({ where }: any) => where.id === 'template' && where.businessId === 'business' ? { id: 'template', status: 'APPROVED', category: 'UTILITY', body: 'Hola {{nombre_cliente}}' } : null
async function request(method: string, path: string, body: any, id = stored?.id) {
  let status = 200
  let payload: any
  const reply = { status(code: number) { status = code; return this }, send(value: any) { payload = value; return value } }
  const result = await handlers.get(method + path)!({ body, params: { id }, query: { businessId: 'business' }, auth: { user: { id: 'admin', role: 'SUPER_ADMIN' } } }, reply)
  return { status, body: payload ?? result }
}
const base = { businessId: 'business', name: 'Recordatorio', channel: 'WHATSAPP', mode: 'PAUSED' }
try {
  for (const minutes of offsets) {
    await test('POST accepts ' + minutes, async () => {
      const response = await request('post', '/reminder-automations', { ...base, sendBeforeMinutes: minutes })
      assert.equal(response.status, 200); assert.equal(response.body.sendBeforeMinutes, minutes)
    })
    await test('PATCH accepts string ' + minutes, async () => {
      stored = { id: 'patch-fixture', ...base, sendBeforeMinutes: 1440 }
      const response = await request('patch', '/reminder-automations/:id', { sendBeforeMinutes: String(minutes), businessId: 'other-business' })
      assert.equal(response.status, 200); assert.equal(response.body.sendBeforeMinutes, minutes)
      assert.equal(response.body.businessId, 'business', 'editing cannot replace the authorized tenant')
    })
  }
  await test('default and unchanged PATCH preserve 24 hours', async () => {
    const created = await request('post', '/reminder-automations', base)
    assert.equal(created.body.sendBeforeMinutes, 1440)
    const edited = await request('patch', '/reminder-automations/:id', { name: 'Nuevo nombre' })
    assert.equal(edited.body.sendBeforeMinutes, 1440)
  })
  for (const value of [0, -60, 180, 300, 240.5, 720.1, 2881, Infinity, -Infinity, NaN, 'NaN', 'abc', '']) {
    await test('POST/PATCH reject ' + String(value), async () => {
      stored = { id: 'invalid-fixture', ...base, sendBeforeMinutes: 1440 }
      const before = writes
      for (const method of ['post', 'patch']) {
        const response = await request(method, method === 'post' ? '/reminder-automations' : '/reminder-automations/:id', { ...base, sendBeforeMinutes: value })
        assert.equal(response.status, 400); assert.match(response.body.message, /tiempo de recordatorio valido/)
      }
      assert.equal(writes, before, 'invalid offsets cannot persist')
    })
  }
  await test('new offsets preserve approval and activation guards', async () => {
    const response = await request('post', '/reminder-automations', { ...base, mode: 'AUTOMATIC_API', sendBeforeMinutes: 240 })
    assert.equal(response.status, 400); assert.match(response.body.message, /plantilla/)
    const valid = await request('post', '/reminder-automations', { ...base, mode: 'AUTOMATIC_API', templateId: 'template', sendBeforeMinutes: 240 })
    assert.equal(valid.status, 200); assert.equal(valid.body.enabled, true)
  })
  const app = Fastify()
  await app.register(crmUiRoutes, { pollingMarker: DISABLED_POLLING_MARKER })
  const response = await app.inject('/crm')
  await app.close()
  assert.equal(response.statusCode, 200)
  const select = response.body.match(/<select id="reminder-before">([\s\S]*?)<\/select>/)![1]!
  await test('rendered selector has ordered eight choices and unchanged default', () => {
    assert.deepEqual([...select.matchAll(/<option value="(\d+)"([^>]*)>([^<]+)<\/option>/g)].map(match => [Number(match[1]), match[3]]), offsets.map(minutes => [minutes, (minutes / 60) + (minutes === 60 ? ' hora antes' : ' horas antes')]))
    assert.match(select, /value="1440" selected/)
    assert.equal([...select.matchAll(/\bselected\b/g)].length, 1)
  })
  function source(name: string) {
    const match = response.body.match(new RegExp('    (?:async )?function ' + name + '\\([^]*?\\n    \\}'))?.[0]
    assert.ok(match, 'rendered production function ' + name)
    return match
  }
  const functions = ['reminderTimeLabel', 'reminderTemplatesForMode', 'reminderModeLabel', 'reminderChannelLabel', 'currentReminderDraft', 'renderReminderSettings', 'updateReminderDraftFromForm', 'loadReminderDeliveries', 'loadReminderSettings', 'saveReminderSettings'].map(source).join('\n')
  for (const minutes of offsets) await test('UI save/reopen and all labels ' + minutes, async () => {
    stored = null
    const elements: any = {}
    const els = new Proxy(elements, { get(target, key) { return target[key] ??= { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, className: '' } } })
    const template = { id: 'template', status: 'APPROVED', category: 'UTILITY', internalName: 'Recordatorio', body: 'Hola' }
    const state: any = { businessId: 'business', selectedReminderId: null, reminderAutomations: [], reminderDraft: { ...base, templateId: 'template', sendBeforeMinutes: 1440 }, whatsappTemplates: [template], templatesLoaded: true, campaignSearch: '', reminderDeliveryData: {}, reminderDetailTab: 'pending' }
    const requests: any[] = []
    const context = vm.createContext({ state, els, escapeHtml: String, templateStatusLabel: (value: string) => value, templateStatusBadge: () => '<span>Aprobada</span>', setButtonLoading: () => true, getJson: async (url: string, options?: any) => {
      requests.push({ url, options })
      if (url.includes('/deliveries?')) return { deliveries: [] }
      if (!options) return (await request('get', '/reminder-automations', {})).body
      const result = await request(options.method.toLowerCase(), options.method === 'POST' ? '/reminder-automations' : '/reminder-automations/:id', JSON.parse(options.body))
      if (result.status !== 200) throw new Error(result.body.message)
      return result.body
    } })
    vm.runInContext(functions, context)
    vm.runInContext('renderReminderSettings()', context)
    els.reminderBefore.value = String(minutes)
    vm.runInContext('updateReminderDraftFromForm()', context)
    assert.equal(state.reminderDraft.sendBeforeMinutes, minutes)
    const label = minutes === 60 ? '1 hora' : minutes <= 720 ? minutes / 60 + ' horas' : minutes / 60 + ' hs'
    assert.equal(els.reminderTimeLabel.textContent, label)
    await vm.runInContext('saveReminderSettings()', context)
    const payload = JSON.parse(requests.find(item => item.options?.method === 'POST').options.body)
    assert.equal(payload.sendBeforeMinutes, String(minutes))
    assert.equal(stored.sendBeforeMinutes, minutes)
    els.reminderBefore.value = '120'
    await vm.runInContext('loadReminderSettings()', context)
    assert.equal(els.reminderBefore.value, String(minutes))
    assert.equal(els.reminderTimeLabel.textContent, label)
    assert.ok(els.reminderList.innerHTML.includes(label + ' antes'))
    assert.ok(els.reminderDetailPanel.innerHTML.includes(label + ' antes'))
  })
  const RealDate = Date
  const fixedNow = RealDate.parse('2026-10-22T12:00:00Z')
  class FixedDate extends RealDate { constructor(value?: any) { super(value === undefined ? fixedNow : value) } static now() { return fixedNow } }
  const originalAuto = p.reminderAutomation.findMany
  globalThis.Date = FixedDate as DateConstructor
  try {
    p.business.findUnique = async () => ({ accountStatus: 'ACTIVE' })
    p.reminderDelivery.updateMany = async () => ({ count: 0 })
    p.reminderDelivery.findUnique = async () => null
    p.whatsAppTemplate.findFirst = async () => ({ body: 'Hola {{nombre_cliente}}' })
    for (const minutes of offsets) await test('scheduler exact due boundary ' + minutes, async () => {
      p.reminderAutomation.findMany = async () => [{ id: 'automation', businessId: 'business', templateId: 'template', mode: 'MANUAL_ASSISTED', sendBeforeMinutes: minutes }]
      const captured: any[] = []
      const appointments = [fixedNow, fixedNow + minutes * 60_000 - 1, fixedNow + minutes * 60_000, fixedNow + minutes * 60_000 + 1].map((value, index) => ({ id: 'appointment-' + index, startAt: new RealDate(value), customer: { id: 'customer', name: 'Cliente', phone: '5491100000000' }, service: { name: 'Corte' }, professional: { name: 'Profesional' } }))
      p.appointment.findMany = async ({ where }: any) => {
        assert.equal(where.startAt.gt.getTime(), fixedNow)
        assert.equal(where.startAt.lte.getTime(), fixedNow + minutes * 60_000)
        assert.equal(where.status, 'CONFIRMED')
        return appointments.filter(appointment => appointment.startAt > where.startAt.gt && appointment.startAt <= where.startAt.lte)
      }
      p.reminderDelivery.createMany = async ({ data }: any) => { captured.push(...data); return { count: data.length } }
      const result = await prepareDueReminders({ businessId: 'business' })
      assert.equal(result.prepared, 2)
      assert.deepEqual(captured.map(item => item.appointmentId), ['appointment-1', 'appointment-2'])
      assert.deepEqual(captured.map(item => item.scheduledFor.getTime()), [fixedNow - 1, fixedNow])
      assert.ok(captured.every(item => item.status === 'PENDING' && item.mode === 'WHATSAPP_MANUAL'))
    })
  } finally { globalThis.Date = RealDate; p.reminderAutomation.findMany = originalAuto }
  assert.equal(externalCalls, 0, 'no real network or message sending')
} finally {
  globalThis.fetch = originalFetch
  WhatsAppCloudApi.prototype.sendTemplateMessage = originalSend
  await prisma.$disconnect()
}
console.log(JSON.stringify({ passed, failed: failures.length, failures }))
if (failures.length) process.exitCode = 1
