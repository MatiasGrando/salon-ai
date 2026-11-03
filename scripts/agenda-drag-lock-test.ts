import assert from 'node:assert/strict'
import vm from 'node:vm'
import ts from 'typescript'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

process.env.DOTENV_CONFIG_PATH = '__offline_agenda_drag_lock_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_agenda_drag_lock'
const { renderCrmHtml } = await import('../src/routes/crm-ui.js')
const { DISABLED_POLLING_MARKER } = await import('../src/observability/egress-baseline/types.js')
const html = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER, cashRegisterEnabled: false })
const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1] || '').find(value => value.includes('function startAgendaPointerDrag'))!
const ast = ts.createSourceFile('agenda.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const sources = new Map<string, string>()
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node)) sources.set(node.name?.text || '', node.getText(ast))
  ts.forEachChild(node, collect)
}
collect(ast)
function functions(names: string[]) { return names.map(name => sources.get(name) || '').join('\n') }
const dragFunctions = ['agendaDragLockPreferenceKey', 'restoreAgendaDragLock', 'canDragAgendaAppointments', 'setAgendaDragLocked', 'syncAgendaDragLockControl', 'startAgendaPointerDrag', 'handleAgendaPointerMove', 'handleAgendaPointerEnd', 'handleAgendaPointerCancel', 'handleAgendaVisibilityChange', 'clearAgendaPointerDrag', 'removeOrphanAgendaDragGhosts', 'clearAgendaDragTargets', 'clearAgendaDropPreview', 'moveAgendaAppointment']
function node() {
  const classes = new Set<string>()
  const handlers: Record<string, Function> = {}
  return { handlers, dataset: {} as any, checked: true, disabled: false, removed: false, captured: false,
    classList: { add: (...values: string[]) => values.forEach(value => classes.add(value)), remove: (...values: string[]) => values.forEach(value => classes.delete(value)), contains: (value: string) => classes.has(value), toggle(value: string, on: boolean) { on ? classes.add(value) : classes.delete(value) } },
    addEventListener: (name: string, handler: Function) => { handlers[name] = handler }, querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 150, height: 80 }),
    setPointerCapture() { this.captured = true }, releasePointerCapture() { this.captured = false }, remove() { this.removed = true } }
}
function harness(storage = new Map<string, string>()) {
  const state: any = { currentUser: { id: 'user-1', role: 'BUSINESS_ADMIN' }, businessId: 'shop-1', business: { id: 'shop-1' }, agendaDragLocked: true, agendaDragLockScope: null, agendaDragLockRevision: 0,
    agendaPointerDrag: null, agendaPendingAppointmentIds: new Set(), agendaAppointments: [{ id: 'appointment', customerId: 'customer', professionalId: 'p1', serviceId: 's1', serviceItems: [], startAt: '2026-10-17T09:00:00' }], professionals: [{ id: 'p1', name: 'One' }], agendaDidDrag: false }
  const listeners = new Map<string, Function>(), checkbox = node(), grid = node(), eventNode = node(), calls: any[] = []
  const els: any = { agendaGridWrap: grid }
  grid.querySelector = ((selector: string) => selector === '[data-agenda-drag-lock]' ? checkbox : null) as any
  const context: any = vm.createContext({ state, els, localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    window: { addEventListener: (type: string, handler: Function) => listeners.set(type, handler), removeEventListener: (type: string) => listeners.delete(type) },
    document: { hidden: false, body: { appendChild() {} }, addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [] }, setTimeout: (callback: Function) => callback(),
    canEditAppointments: () => state.currentUser?.canEditAppointments !== false, showCrmToast() {}, createAgendaDragGhost: () => node(), moveAgendaDragGhost() {}, updateAgendaPointerTarget() {},
    appointmentServiceIds: () => ['s1'], parseDateKey: (value: string) => new Date(value + 'T00:00:00'), renderAgenda() {}, formatDateTime: (value: Date) => value.toISOString(), canForceAppointmentOverrides: () => true,
    requestCrmConfirmation: async () => true, getJson: async (url: string, input: any) => { calls.push({ url, payload: JSON.parse(input.body) }); return {} } })
  vm.runInContext(functions([...dragFunctions, 'bindAgendaMobileControls']), context)
  context.bindAgendaMobileControls(88, { start: 480, end: 1200 })
  const pointer = (type = 'mouse') => ({ button: 0, pointerId: 1, pointerType: type, clientX: 10, clientY: 10, preventDefault() {} })
  const choose = (locked: boolean) => checkbox.handlers.change!({ target: { checked: locked } })
  return { state, storage, context, eventNode, checkbox, listeners, calls, pointer, choose }
}

for (const type of ['mouse', 'touch', 'pen']) {
  const h = harness()
  h.context.startAgendaPointerDrag(h.pointer(type), h.eventNode, 'appointment')
  assert.equal(h.state.agendaPointerDrag, null, 'el bloqueo inicial impide comenzar el arrastre con ' + type)
  assert.equal(h.listeners.size, 0)
  await h.context.moveAgendaAppointment('appointment', '2026-10-17', 600)
  assert.equal(h.calls.length, 0, 'el último camino de movimiento tampoco puede enviar con bloqueo')
}

for (const type of ['mouse', 'touch', 'pen']) {
  const h = harness()
  h.choose(false)
  h.context.startAgendaPointerDrag(h.pointer(type), h.eventNode, 'appointment')
  h.context.handleAgendaPointerMove({ ...h.pointer(type), clientY: 50 })
  assert.equal(h.state.agendaPointerDrag.dragging, true)
  h.state.agendaPointerDrag.targetCell = { dataset: { cellDate: '2026-10-17', cellMinute: '600', cellProfessionalId: 'p1' } }
  h.context.handleAgendaPointerEnd(h.pointer(type))
  for (let i = 0; i < 10; i++) await Promise.resolve()
  assert.equal(h.calls.length, 1, 'desbloquear permite mover con ' + type)
  assert.equal(h.calls[0].payload.startAt, new Date('2026-10-17T10:00:00').toISOString())
  assert.equal(h.eventNode.captured, false)
}

{
  const h = harness()
  h.choose(false)
  h.context.startAgendaPointerDrag(h.pointer(), h.eventNode, 'appointment')
  h.context.handleAgendaPointerMove({ ...h.pointer(), clientY: 50 })
  const ghost = h.state.agendaPointerDrag.ghost
  h.choose(true)
  assert.equal(h.state.agendaPointerDrag, null)
  assert.equal(h.eventNode.classList.contains('dragging'), false)
  assert.equal(ghost.removed, true)
  assert.equal(h.listeners.size, 0)
  assert.equal(h.eventNode.captured, false)
  h.context.handleAgendaPointerEnd(h.pointer())
  assert.equal(h.calls.length, 0, 'activar cancela un arrastre en curso')
}

{
  const h = harness()
  h.choose(false)
  assert.equal(h.checkbox.checked, false)
  const reopened = harness(h.storage)
  reopened.context.syncAgendaDragLockControl()
  assert.equal(reopened.checkbox.checked, false, 'se recuerda la elección al reabrir para el mismo actor/local')
  reopened.choose(true)
  const locked = harness(h.storage)
  assert.equal(locked.context.canDragAgendaAppointments(), false, 'también se recuerda marcar de nuevo')
  for (const kind of ['user', 'role', 'profile', 'business']) {
    const c = harness(new Map(h.storage))
    c.choose(false)
    if (kind === 'user') c.state.currentUser.id = 'user-2'
    if (kind === 'role') c.state.currentUser.role = 'STAFF'
    if (kind === 'profile') c.state.currentUser.staffProfile = 'SECRETARY'
    if (kind === 'business') { c.state.businessId = 'shop-2'; c.state.business.id = 'shop-2' }
    assert.equal(c.context.canDragAgendaAppointments(), false, 'otra cuenta/rol/perfil/local comienza bloqueado: ' + kind)
  }
}

for (const value of ['{broken', 'null', '0', '"false"', '{}', '[]']) {
  const h = harness()
  h.storage.set(h.context.agendaDragLockPreferenceKey(), value)
  assert.equal(h.context.canDragAgendaAppointments(), false, 'dato inválido falla cerrado: ' + value)
}
for (const change of ['missingUser', 'missingId', 'missingRole', 'missingBusiness', 'businessMismatch', 'noPermission']) {
  const h = harness()
  h.choose(false)
  if (change === 'missingUser') h.state.currentUser = null
  if (change === 'missingId') h.state.currentUser.id = null
  if (change === 'missingRole') h.state.currentUser.role = null
  if (change === 'missingBusiness') h.state.businessId = null
  if (change === 'businessMismatch') h.state.business.id = 'old-business'
  if (change === 'noPermission') h.state.currentUser.canEditAppointments = false
  h.context.syncAgendaDragLockControl()
  assert.equal(h.checkbox.checked, true, change)
  assert.equal(h.checkbox.disabled, true, change)
  h.context.startAgendaPointerDrag(h.pointer(), h.eventNode, 'appointment')
  assert.equal(h.state.agendaPointerDrag, null, change)
}
{
  const h = harness()
  h.context.localStorage.getItem = () => { throw new Error('blocked') }
  assert.equal(h.context.canDragAgendaAppointments(), false)
  h.context.localStorage.setItem = () => { throw new Error('quota') }
  assert.doesNotThrow(() => h.choose(false))
  assert.equal(h.context.canDragAgendaAppointments(), true, 'fallo al guardar no rompe la elección actual')
}
for (const action of ['handleAgendaPointerMove', 'handleAgendaPointerEnd']) {
  const h = harness()
  h.choose(false)
  h.context.startAgendaPointerDrag(h.pointer(), h.eventNode, 'appointment')
  h.state.agendaPointerDrag.dragging = true
  h.state.agendaPointerDrag.targetCell = { dataset: { cellDate: '2026-10-17', cellMinute: '600' } }
  h.state.currentUser.canEditAppointments = false
  h.context[action](h.pointer())
  assert.equal(h.state.agendaPointerDrag, null, 'revocar permiso cancela ' + action)
  assert.equal(h.calls.length, 0)
}
{
  const h = harness()
  h.choose(false)
  h.context.startAgendaPointerDrag(h.pointer(), h.eventNode, 'appointment')
  h.state.currentUser.id = 'user-2'
  h.storage.set(h.context.agendaDragLockPreferenceKey(), 'false')
  h.context.handleAgendaPointerMove({ ...h.pointer(), clientY: 60 })
  assert.equal(h.state.agendaPointerDrag, null, 'un gesto anterior no se transfiere a otro usuario incluso si ese usuario permite arrastre')
  assert.equal(h.calls.length, 0)
}

for (const pauseAt of [1, 2]) {
  for (const cancel of ['lock', 'lockThenUnlock', 'permission', 'scope']) {
    const h = harness()
    h.choose(false)
    let confirmCount = 0, resolve!: (value: boolean) => void
    h.context.getJson = async (url: string, input: any) => {
      h.calls.push({ url, payload: JSON.parse(input.body) })
      if (h.calls.length === 1) throw { body: { code: 'APPOINTMENT_AVAILABILITY_CONFLICT', forceable: true, conflicts: [{ message: 'Horario ocupado' }] } }
      return {}
    }
    h.context.requestCrmConfirmation = async () => ++confirmCount === pauseAt ? new Promise<boolean>(pass => { resolve = pass }) : true
    const pending = h.context.moveAgendaAppointment('appointment', '2026-10-17', 600)
    for (let step = 0; !resolve && step < 20; step++) await Promise.resolve()
    assert.ok(resolve, 'se alcanzó confirmación pendiente ' + pauseAt)
    if (cancel === 'lock' || cancel === 'lockThenUnlock') h.choose(true)
    if (cancel === 'lockThenUnlock') h.choose(false)
    if (cancel === 'permission') h.state.currentUser.canEditAppointments = false
    if (cancel === 'scope') { h.state.businessId = 'shop-2'; h.state.business.id = 'shop-2'; h.storage.set(h.context.agendaDragLockPreferenceKey(), 'false') }
    resolve(true)
    await pending
    assert.equal(h.calls.length, 1, 'no forzar tras cancelar en confirmación ' + pauseAt + ': ' + cancel)
    assert.equal(h.state.agendaPendingAppointmentIds.size, 0)
  }
}
{
  const h = harness()
  h.choose(false)
  h.context.getJson = async (url: string, input: any) => {
    const payload = JSON.parse(input.body)
    h.calls.push({ url, payload })
    if (!payload.force) throw { body: { code: 'APPOINTMENT_AVAILABILITY_CONFLICT', forceable: true, conflicts: [{ message: 'Horario ocupado' }] } }
    return payload
  }
  await h.context.moveAgendaAppointment('appointment', '2026-10-17', 600)
  assert.equal(h.calls.length, 2, 'sin cancelación la excepción conserva el flujo existente')
  assert.equal(h.calls[1].payload.force, true)
}
console.log('OK Agenda drag lock: punteros, preferencias aisladas, cancelación, permisos y continuaciones asíncronas')

if (process.env.CRM_QA_BROWSER_MODULE) {
  const { chromium } = await import(pathToFileURL(process.env.CRM_QA_BROWSER_MODULE).href)
  const browser = await chromium.launch({ channel: process.env.CRM_QA_BROWSER_CHANNEL || 'chrome', headless: true })
  const browserFunctions = [...dragFunctions, 'bindAgendaMobileControls', 'renderAgendaMobileThreeDay', 'renderAgendaProfessionalDateCorner', 'renderAgendaProfessionalDayHeader', 'renderAgendaProfessionalDayColumn', 'renderAgendaMobileDayHeader', 'renderAgendaMobileDayColumn', 'renderAgendaMobileEvent', 'scrollAgendaMobileToWorkingTime', 'bindAgendaProfessionalHorizontalDrag', 'agendaRangeGestureIntent', 'createAgendaDragGhost', 'moveAgendaDragGhost', 'updateAgendaPointerTarget']
  const styles = html.match(/<style>([\s\S]*?)<\/style>/)![1]
  const fixture = '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + styles + '</style><body data-current-section="agenda"><main style="height:100dvh;width:100%;min-width:0"><div id="agenda-qa" style="height:100%;width:100%"></div></main></body></html>'
  try {
    for (const width of [320, 390, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: width < 400 ? 700 : 900 }, hasTouch: true })
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error: Error) => errors.push(error.message))
      await page.route('**/*', (route: any) => route.request().url() === 'http://agenda-qa.invalid/' ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture }) : route.abort())
      await page.goto('http://agenda-qa.invalid/')
      await page.addScriptTag({ content: `
        const state = ${JSON.stringify(harness().state)};
        state.agendaSelectedDate = new Date('2026-10-17T00:00:00'); state.agendaMonthDate = new Date(state.agendaSelectedDate);
        state.agendaViewDays = 1; state.agendaPendingAppointmentIds = new Set(); state.agendaMobileScrollMinute = null;
        state.professionals[0].services = [{ id: 's1' }];
        state.agendaAppointments[0].totalDurationMinutes = 60;
        const els = { agendaGridWrap: document.getElementById('agenda-qa'), agendaProfessional: { value: '' }, agendaService: { value: '' }, agendaRange: {}, agendaToday: {} };
        const qa = { opens: 0, calls: [] };
        const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
        const startOfDay = day => new Date(day.getFullYear(), day.getMonth(), day.getDate());
        const addDays = (day, count) => { const next = new Date(day); next.setDate(next.getDate() + count); return next; };
        const dateKey = day => [day.getFullYear(), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0')].join('-');
        const parseDateKey = key => new Date(key + 'T00:00:00');
        const formatAgendaMobileTitle = day => new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(day);
        const formatAgendaRange = () => '17 de octubre'; const formatTimeOnly = day => day.getHours() + ':' + String(day.getMinutes()).padStart(2, '0');
        const formatDateTime = day => day.toISOString(); const getAgendaDisplayRange = () => ({ start: 480, end: 1200 });
        const activeProfessionals = () => state.professionals; const agendaProfessionalColor = () => '#2563eb';
        const filteredAgendaAppointmentsForRange = (start, end) => state.agendaAppointments.filter(item => new Date(item.startAt) >= start && new Date(item.startAt) < end);
        const filteredAgendaBlocksForRange = () => []; const buildAgendaEventLayout = () => new Map();
        const isClosedAgendaSlotForProfessional = () => false; const isClosedAgendaSlot = () => false;
        const agendaAttentionMeta = () => null; const agendaDepositIndicator = () => null; const agendaAttentionBadgeHtml = () => '';
        const appointmentOriginMeta = () => ({ label: 'Carga manual' }); const appointmentOriginBadgeHtml = () => '';
        const appointmentServiceLabel = () => 'Corte de prueba'; const appointmentServiceIds = () => ['s1'];
        const canEditAppointments = () => state.currentUser.canEditAppointments !== false; const canCreateAppointments = () => true; const canManageScheduleBlocks = () => true;
        const canForceAppointmentOverrides = () => true; const showCrmToast = () => {}; const requestCrmConfirmation = async () => true;
        const openAppointmentDialog = () => { qa.opens++; }; const openMobileDrawer = () => {}; const openAgendaBlockPopover = () => {};
        const renderAgendaDropPreview = () => {}; const renderAgendaMobileMonthPanel = () => ''; const renderAgendaMobileFilterPanel = () => '';
        const startAgendaRangeSelection = () => {}; const selectAgendaCellRange = () => {}; const deleteScheduleBlock = () => {};
        const renderAgendaProfessionalControls = () => {}; const rememberAgendaProfessionalFilter = () => {}; const loadAgenda = async () => {};
        const navigateAgendaToDate = async day => { state.agendaSelectedDate = day; renderAgenda(); };
        const getJson = async (url, input) => { qa.calls.push({ url, body: JSON.parse(input.body) }); return JSON.parse(input.body); };
        const renderAgenda = () => renderAgendaMobileThreeDay();
        ${functions(browserFunctions)}
        renderAgenda();
      ` })
      const checkbox = page.getByRole('checkbox', { name: 'Bloquear arrastre de turnos' })
      assert.equal(await checkbox.isChecked(), true)
      await checkbox.focus()
      const bounds = await checkbox.boundingBox()
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, 'el checkbox es alcanzable por foco a ' + width)
      const label = await checkbox.locator('..').boundingBox()
      assert.ok(label && label.x >= 0 && label.x + label.width <= width, 'la etiqueta completa entra a ' + width)
      assert.equal(await page.locator('.agenda-gcal-actions').evaluate((element: HTMLElement) => {
        const boxes = [...element.children].map(child => child.getBoundingClientRect())
        return boxes.some((a, i) => boxes.some((b, j) => i !== j && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top))
      }), false, 'controles de toolbar no se superponen')
      const event = page.locator('[data-appointment-id="appointment"]')
      assert.match(await event.evaluate((element: HTMLElement) => getComputedStyle(element).touchAction), /^(manipulation|pan-x pan-y pinch-zoom)$/)
      assert.equal(await event.evaluate((element: HTMLElement) => getComputedStyle(element).cursor), 'pointer')
      await event.locator('[data-agenda-edit-appointment]').click()
      assert.equal(await page.evaluate('qa.opens'), 1, 'click sigue abriendo el turno bloqueado')
      const drag = async () => {
        const rect = await event.boundingBox()
        await page.mouse.move(rect.x + 20, rect.y + 20)
        await page.mouse.down()
        await page.mouse.move(rect.x + 20, rect.y + 80, { steps: 6 })
        await page.mouse.up()
      }
      await drag()
      assert.equal(await page.evaluate('qa.calls.length'), 0, 'mouse bloqueado no cambia horario')
      const session = await context.newCDPSession(page)
      const swipe = async (x: number, y: number, dx: number, dy: number) => {
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
        for (let i = 1; i <= 8; i++) {
          await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 8, y: y + dy * i / 8 }] })
          await page.waitForTimeout(20)
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await page.waitForTimeout(120)
      }
      let rect = await event.boundingBox()
      await swipe(rect.x + 40, rect.y + 35, 0, -80)
      assert.equal(await page.evaluate('qa.calls.length'), 0, 'touch bloqueado no cambia horario')
      assert.ok(await page.locator('[data-agenda-mobile-scroll]').evaluate((element: HTMLElement) => element.scrollTop) > 10, 'scroll táctil puede comenzar sobre un turno')
      await page.locator('[data-agenda-mobile-scroll]').evaluate((element: HTMLElement) => { element.scrollTop = 0 })
      await checkbox.focus()
      await page.keyboard.press('Space')
      assert.equal(await checkbox.isChecked(), false, 'teclado desbloquea')
      assert.equal(await event.evaluate((element: HTMLElement) => getComputedStyle(element).touchAction), 'none')
      await drag()
      await page.waitForTimeout(250)
      assert.equal(await page.evaluate('qa.calls.length'), 1, 'mouse desbloqueado mueve una vez')
      await page.evaluate('renderAgenda()')
      assert.equal(await checkbox.isChecked(), false, 'reapertura conserva selección')
      await page.locator('[data-agenda-mobile-scroll]').evaluate((element: HTMLElement) => { element.scrollTop = 0 })
      rect = await event.boundingBox()
      await swipe(rect.x + 30, rect.y + 25, 0, 65)
      assert.equal(await page.evaluate('qa.calls.length'), 2, 'touch desbloqueado mueve una vez')
      await checkbox.check()
      await page.evaluate('state.professionals.push({ id: "p2", name: "Dos", services: [{ id: "s1" }] }, { id: "p3", name: "Tres", services: [{ id: "s1" }] }); renderAgenda()')
      await page.locator('[data-agenda-mobile-scroll]').evaluate((element: HTMLElement) => { element.scrollTop = 0 })
      if (width <= 768) {
        rect = await event.boundingBox()
        await swipe(rect.x + Math.min(120, rect.width - 20), rect.y + 25, -90, 0)
        assert.ok(await page.locator('.agenda-gcal-columns-viewport').evaluate((element: HTMLElement) => element.scrollLeft) > 10, 'scroll horizontal sobre turno bloqueado conserva acceso a profesionales')
      }
      assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), false, 'sin desborde global a ' + width)
      assert.deepEqual(errors, [])
      if (process.env.CRM_QA_OUTPUT_DIR) {
        await mkdir(process.env.CRM_QA_OUTPUT_DIR, { recursive: true })
        await checkbox.focus()
        await page.screenshot({ path: join(process.env.CRM_QA_OUTPUT_DIR, 'agenda-bloqueo-' + width + '.png') })
      }
      console.log('OK navegador Agenda ' + width + ': foco, click, mouse/touch, scroll y persistencia')
      await context.close()
    }
  } finally { await browser.close() }
}
