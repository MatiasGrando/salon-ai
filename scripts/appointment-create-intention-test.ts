import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const names = ['pendingManualAppointmentCreationKey', 'readPendingManualAppointmentCreation', 'writePendingManualAppointmentCreation', 'retryPendingManualAppointmentCreation', 'saveManualAppointment']
const fn = (name: string) => { const from = source.search(new RegExp('    (?:async )?function ' + name + '\\(')); assert.ok(from >= 0, name); return source.slice(from, source.indexOf('\n    }', from) + 6) }
const storage = new Map<string, string>()
let posts: any[] = [], saves = 0, finishes = 0, reject = false, rejectionStatus = 0
const state: any = { currentUser: { id: 'u' }, businessId: 'b', editingAppointmentId: null }
const context: any = vm.createContext({ state, JSON, Boolean, sessionStorage: { getItem: (k: string) => storage.get(k) || null, setItem: (k: string,v: string) => storage.set(k,v), removeItem: (k: string) => storage.delete(k) }, persistManualAppointment: async () => { saves++; return { id: 'new' } }, finishSavedManualAppointment: async () => { finishes++; return { id: 'new' } }, els: { appointmentFeedback: { textContent: '' }, appointmentSubmit: {} }, setButtonLoading() {}, crmWorkspaceVersion: 1, getJson: async (path: string, options: any) => { posts.push(JSON.parse(options.body)); if (reject) throw Object.assign(new Error('timeout'), { status: rejectionStatus }); return { id: 'new', replayed: true } } })
vm.runInContext(names.map(fn).join('\n'), context)
const original = { payload: { customerId: 'c', requestId: 'stable', force: false, payment: { lines: [{ amount: 20, paymentMethodId: 'cash' }] } }, draft: '{}' }
context.writePendingManualAppointmentCreation(original)
reject = true
await context.saveManualAppointment()
assert.equal(posts.length, 1)
assert.deepEqual(JSON.parse(JSON.stringify(context.readPendingManualAppointmentCreation())), original)
reject = false
await context.saveManualAppointment()
assert.deepEqual(posts[1], posts[0])
assert.equal(saves, 0, 'retry bypasses customer creation, availability and new intention')
assert.equal(finishes, 1)
assert.equal(context.readPendingManualAppointmentCreation(), null)
context.writePendingManualAppointmentCreation(original)
reject = true
rejectionStatus = 409
await context.saveManualAppointment()
assert.equal(context.readPendingManualAppointmentCreation(), null, 'a confirmed rejection releases the original intention')
assert.doesNotMatch(context.els.appointmentFeedback.textContent, /sigue pendiente/, 'a rejected operation must not be described as uncertain')
state.currentUser.id = 'other'
assert.equal(context.readPendingManualAppointmentCreation(), null)
assert.match(source, /requestId: creationIntent\.payload\.requestId/)
console.log('OK: create with initial payment retries the original stable request without repeating customer creation.')
