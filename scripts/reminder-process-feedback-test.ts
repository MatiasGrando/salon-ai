import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const start = source.indexOf('    async function processDueReminders()')
const end = source.indexOf('\n    async function updateManualReminderDelivery', start)
assert.ok(start > 0 && end > start, 'the shipped CRM processing function must be present')
const cases = [
  { result: { blocked: true, message: 'Los recordatorios estan desactivados.', total: 2, prepared: 2, sent: 0, failed: 0 }, text: 'Los recordatorios estan desactivados.', error: true },
  { result: { blocked: true, message: 'La cuenta no esta activa.', total: 0, prepared: 0, sent: 0, failed: 0 }, text: 'La cuenta no esta activa.', error: true },
  { result: { blocked: true, total: 0, prepared: 0, sent: 0, failed: 0 }, text: 'No se pudieron procesar los recordatorios. Revisá la conexión y los permisos de WhatsApp.', error: true },
  { result: { total: 3, prepared: 1, sent: 2, failed: 0 }, text: 'Procesado: 1 preparados · 2 enviados · 0 fallidos.', error: false },
  { result: { total: 1, prepared: 0, sent: 0, failed: 1 }, text: 'Procesado: 0 preparados · 0 enviados · 1 fallidos.', error: true },
  { result: { total: 0, prepared: 0, sent: 0, failed: 0 }, text: 'No hay recordatorios pendientes en este momento.', error: false },
  { errorMessage: 'No se pudo conectar con el servidor.', text: 'No se pudo conectar con el servidor.', error: true }
]
for (const testCase of cases) {
  const els = { reminderFeedback: { textContent: '', className: '' }, reminderProcess: { disabled: false, textContent: '' } }
  let reloads = 0
  const loading: boolean[] = []
  const context = vm.createContext({
    els,
    state: { businessId: 'offline-business', reminderAutomations: [{ channel: 'WHATSAPP', mode: 'AUTOMATIC_API' }] },
    setButtonLoading: (_button: unknown, enabled: boolean) => { loading.push(enabled); return true },
    currentReminderDraft: () => ({ mode: 'AUTOMATIC_API' }),
    loadReminderSettings: async () => { reloads++ },
    getJson: async (url: string, options: any) => {
      assert.equal(url, '/reminder-automations/process-due')
      assert.equal(options.method, 'POST')
      assert.deepEqual(JSON.parse(options.body), { businessId: 'offline-business', limit: 100 })
      if (testCase.errorMessage) throw new Error(testCase.errorMessage)
      return testCase.result
    }
  })
  vm.runInContext(source.slice(start, end), context)
  await vm.runInContext('processDueReminders()', context)
  assert.equal(els.reminderFeedback.textContent, testCase.text)
  assert.equal(els.reminderFeedback.className, 'campaign-form-feedback ' + (testCase.error ? 'error' : 'success'))
  assert.equal(reloads, testCase.errorMessage ? 0 : 1, 'resolved results must refresh the existing reminder list')
  assert.deepEqual(loading, [true, false], 'the action always restores its loading state')
  assert.equal(els.reminderProcess.textContent, 'Procesar pendientes')
  assert.equal(els.reminderProcess.disabled, false)
}
console.log(JSON.stringify({ passed: cases.length, externalCalls: 0 }))
