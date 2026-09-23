import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const start = source.indexOf('    const pendingServiceLifecycleIds')
const handlers = source.slice(start < 0 ? source.indexOf('    async function deleteService(id)') : start, source.indexOf('    function resetServiceForm()'))
function harness(answers = [true], failure?: any) {
  const calls: any[] = [], notices: any[] = []
  const service = { id: 's1', name: 'Mentoria', isActive: true }
  const context: any = { state: { services: [service] }, els: { serviceFeedback: {} }, Set,
    getServiceItemType: () => 'SERVICE', deleteServiceFamily: async () => {},
    requestCrmConfirmation: async (...args: any[]) => { calls.push(['confirm', ...args]); return answers.shift() },
    getJson: async (url: string, options: any) => { calls.push([url, options]); if (failure) { const error = failure; failure = undefined; throw error } return { archived: true } },
    reloadServiceCatalog: async () => { calls.push(['reload']) },
    showCrmToast: (...args: any[]) => notices.push(args)
  }
  vm.createContext(context); vm.runInContext(handlers, context)
  return { context, calls, notices, service }
}
const deleted = harness(); await deleted.context.deleteService('s1')
assert.ok(deleted.calls.some(([url, opts]) => url === '/services/s1' && opts.method === 'DELETE'))
assert.ok(deleted.notices.some(([message]) => message.includes('eliminado')), 'success must be visible outside collapsed editor')
const failed = harness([true], new Error('No autorizado')); await failed.context.deleteService('s1')
assert.deepEqual(failed.notices[0], ['No autorizado', 'error'])
assert.equal(failed.calls.filter(([type]) => type === 'confirm').length, 1)
assert.ok(deleted.notices.some(([message]) => message.includes('historial')), 'la UI debe aclarar que el historial se conserva al archivar')
assert.equal(deleted.calls.filter(([url]) => url.endsWith('/status')).length, 0, 'eliminar no debe convertirse silenciosamente en pausar')
const enabled = harness(); enabled.service.isActive = false; await enabled.context.setServiceActive('s1', true)
assert.ok(enabled.calls.some(([url, options]) => url === '/services/s1/status' && JSON.parse(options.body).isActive === true))
assert.ok(enabled.notices.some(([message]) => message.includes('reactivado')))
const denied = harness([true], new Error('Sin permisos')); await denied.context.setServiceActive('s1', true)
assert.deepEqual(denied.notices[0], ['Sin permisos', 'error'])
const duplicate = harness(); await Promise.all([duplicate.context.deleteService('s1'), duplicate.context.deleteService('s1')])
assert.equal(duplicate.calls.filter(([url]) => url === '/services/s1').length, 1)
assert.match(source, /data-toggle-service-active/)
assert.match(source, /Inactivo/)
console.log('Service lifecycle UI contracts OK')
