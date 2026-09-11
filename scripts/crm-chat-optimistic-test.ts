import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync('src/routes/crm-ui.ts', 'utf8')
const start = source.indexOf('    function visibleChatMessages()')
const end = source.indexOf('    async function toggleGlobalAi()', start)
assert.ok(start >= 0, 'Optimistic chat implementation exists')
const requests: any[] = []
const state: any = { selected: { id: 'a' }, businessId: 'biz', messages: [], manualReplyQueue: [] }
const els = { replyText: { value: 'primero', focus() {} } }
const context = vm.createContext({ state, els, crypto: { randomUUID: () => String(Math.random()) },
  whatsappReplyWindowState: () => ({ canReply: true }), updateComposerAvailability() {}, renderMessages() {},
  showCrmToast() {}, getJson: (url: string, options: any) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })) })
vm.runInContext(source.slice(start, end), context)
const run = (code: string) => vm.runInContext(code, context)
run('sendReply({preventDefault(){}})')
assert.equal(els.replyText.value, '')
els.replyText.value = 'segundo'
run('sendReply({preventDefault(){}})')
assert.equal(run('visibleChatMessages().length'), 2)
assert.equal(requests.length, 1, 'Network sends preserve order without locking composer')
els.replyText.value = 'borrador nuevo'
requests[0].resolve({ message: { id: 'server1', status: 'sent', body: 'primero' }, delivery: { sent: true } })
await new Promise(resolve => setImmediate(resolve))
assert.equal(requests.length, 2)
assert.equal(els.replyText.value, 'borrador nuevo')
state.messages = [{ id: 'server1', metadata: { clientMessageId: state.manualReplyQueue[0].clientMessageId } }]
assert.equal(run('visibleChatMessages().length'), 2, 'Reconcile server echo without duplicate')
state.selected = { id: 'b' }
requests[1].reject(new Error('network uncertain'))
await new Promise(resolve => setImmediate(resolve))
assert.equal(state.selected.id, 'b')
assert.equal(state.manualReplyQueue[1].status, 'failed')
state.messages = []
assert.equal(run('visibleChatMessages().length'), 0, 'Pending messages stay in their own conversation')
state.selected = { id: 'a' }
assert.equal(run('visibleChatMessages().length'), 2)
console.log('Optimistic chat: OK')
