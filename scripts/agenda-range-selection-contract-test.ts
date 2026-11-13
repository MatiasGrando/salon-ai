import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

process.env.DOTENV_CONFIG_PATH = '__offline_agenda_range_selection__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_agenda_range_selection'
const { renderCrmHtml } = await import('../src/routes/crm-ui.js')
const { DISABLED_POLLING_MARKER } = await import('../src/observability/egress-baseline/types.js')
const html = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER, cashRegisterEnabled: false })
const openBlock = html.match(/\n    function openAgendaBlockPopover\([\s\S]+?(?=\n    function closeAgendaBlockPopover\()/)?.[0]
const professionalOptions = html.match(/<select id="block-professional">([\s\S]*?)<\/select>/)?.[1]
assert.ok(openBlock && professionalOptions, 'el CRM renderiza el formulario y la apertura de bloqueos')

let professionalMarkup: string = professionalOptions
let selectedProfessional = ''
const blockProfessional = {
  get innerHTML() { return professionalMarkup },
  set innerHTML(value: string) { professionalMarkup = value; selectedProfessional = '' },
  get value() { return selectedProfessional },
  set value(value: string) {
    selectedProfessional = [...professionalMarkup.matchAll(/<option value="([^"]*)"/g)]
      .some((option) => option[1] === value) ? value : ''
  }
}
const professionals = [{ id: 'pro-a', name: 'Mauro' }, { id: 'pro-b', name: 'Blas' }]
let ownProfessionalId: string | null = null
const state = { businessId: 'test-business', agendaProfessionalCatalogScope: 'test-scope', agendaBlockOpen: false }
const els = {
  blockProfessional, agendaBlockPopover: { hidden: true },
  blockReason: { value: '' }, blockStart: { value: '', focus() {} }, blockEnd: { value: '' },
  blockRepeat: { checked: false }, blockRepeatUntil: { value: '' }
}
const feedback: string[] = []
const openPopover = runInNewContext(openBlock + '\nopenAgendaBlockPopover', {
  els, state, canManageScheduleBlocks: () => true,
  agendaProfessionalPreferenceKey: () => 'test-scope',
  activeProfessionals: () => professionals,
  agendaVisibleProfessionals: () => professionals.filter(({ id }) => ownProfessionalId === null || id === ownProfessionalId),
  agendaOwnProfessionalId: () => ownProfessionalId, isOwnAgendaScope: () => ownProfessionalId !== null,
  showCrmToast: (message: string) => feedback.push(message),
  syncBlockRepeatControls() {}, escapeHtml: (value: string) => value,
  toDatetimeLocalValue: (value: string) => value,
  getJson: () => assert.fail('abrir el panel no consulta la red')
}) as (input?: { professionalId?: string; startAt?: string; endAt?: string }) => void

openPopover({ professionalId: 'pro-b', startAt: '2026-11-13T10:00', endAt: '2026-11-13T10:30' })
assert.equal(els.agendaBlockPopover.hidden, false, 'se puede abrir en cuanto el catálogo de Agenda está listo')
assert.equal(blockProfessional.value, 'pro-b', 'la primera apertura conserva el profesional del rango elegido')
assert.match(blockProfessional.innerHTML, /value="pro-a">Mauro<\/option>/)
assert.equal(els.blockStart.value, '2026-11-13T10:00')
assert.equal(els.blockEnd.value, '2026-11-13T10:30')

els.agendaBlockPopover.hidden = true
state.agendaBlockOpen = false
openPopover({ professionalId: 'missing' })
assert.equal(els.agendaBlockPopover.hidden, true, 'un profesional inexistente no se convierte en todo el salón')

state.agendaProfessionalCatalogScope = 'old-scope'
openPopover()
assert.equal(els.agendaBlockPopover.hidden, true, 'el panel espera al catálogo del negocio activo')
assert.match(feedback.at(-1) ?? '', /profesionales/)

state.agendaProfessionalCatalogScope = 'test-scope'
ownProfessionalId = 'pro-a'
openPopover()
assert.equal(els.agendaBlockPopover.hidden, false)
assert.equal(blockProfessional.value, 'pro-a', 'el personal con alcance propio tiene su profesional preseleccionado')
assert.doesNotMatch(blockProfessional.innerHTML, /value="(?:pro-b)?"/, 'el alcance propio solo permite bloquear la propia agenda')

const source = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

assert.match(source, /function startAgendaRangeSelection\(/)
assert.match(source, /function updateAgendaRangeSelection\(/)
assert.match(source, /function finishAgendaRangeSelection\(/)
assert.match(source, /data-agenda-range-action="appointment"/)
assert.match(source, /data-agenda-range-action="block"/)
assert.match(source, /openAppointmentDialog\(\{[\s\S]*minute: selection\.startMinute/)
assert.match(source, /openAgendaBlockPopover\(\{[\s\S]*startAt:[\s\S]*endAt:/)
assert.match(source, /<option value="OTHER" selected>Otro<\/option>/)
assert.match(source, /function openAgendaBlockPopover\(input = \{\}\) \{[\s\S]*els\.blockReason\.value = input\.reason \|\| 'OTHER'/)
assert.match(source, /canCreateAppointments\(\)/)
assert.match(source, /canManageScheduleBlocks\(\)/)
assert.match(source, /cell\.dataset\.cellProfessionalId/)
assert.match(source, /agenda-range-selected/)
assert.match(source, /agenda-range-actions/)
assert.match(source, /pointerType === 'touch'/)
assert.match(source, /data-agenda-action-rail/)
assert.match(source, /function agendaActionRailCellAtPointer\(/)
assert.match(source, /function selectAgendaOccupiedRange\(/)
assert.match(source, /eventNode\.closest\('\[data-gcal-professional\]'\)/)
assert.match(source, /startAgendaRangeSelection\(event, cell\)/)
assert.match(source, /agenda-action-rail-marker/)

const occupiedActionHandler = source.match(/eventNode\.querySelector\('\[data-agenda-new-at\]'\)\?\.addEventListener\('click'[\s\S]*?eventNode\.addEventListener\('pointerdown'/)?.[0] || ''
assert.match(occupiedActionHandler, /selectAgendaOccupiedRange/)
assert.doesNotMatch(occupiedActionHandler, /openAppointmentDialog/)
assert.doesNotMatch(occupiedActionHandler, /serviceId:\s*appointment\.serviceId/)

const rangePointerStart = source.match(/function startAgendaRangeSelection\([\s\S]*?function updateAgendaRangeSelection\(/)?.[0] || ''
assert.doesNotMatch(rangePointerStart, /stopPropagation\(/)
assert.match(source, /const deltaX = pointerEvent\.clientX - pointer\.startX/)
assert.match(source, /const deltaY = pointerEvent\.clientY - pointer\.startY/)
assert.match(source, /function agendaRangeGestureIntent\(deltaX, deltaY\)/)
assert.match(source, /if \(horizontal >= 14 && horizontal > vertical \* 1\.5\) return 'horizontal'/)
assert.match(source, /if \(vertical >= 8 && vertical >= horizontal \* 0\.75\) return 'vertical'/)
assert.match(source, /if \(moved < 18\) return 'pending'/)
assert.match(source, /if \(intent === 'pending'\) return/)
assert.match(source, /if \(intent === 'horizontal'\)/)

const gestureIntentBody = source.match(/function agendaRangeGestureIntent\(deltaX, deltaY\) \{([\s\S]*?)\n    \}/)?.[1] || ''
const gestureIntent = new Function('deltaX', 'deltaY', gestureIntentBody) as (deltaX: number, deltaY: number) => string
assert.equal(gestureIntent(12, 9), 'vertical', 'un inicio diagonal debe conservar la intención vertical')
assert.equal(gestureIntent(12, 5), 'pending', 'un movimiento ambiguo no debe cancelarse prematuramente')
assert.equal(gestureIntent(20, 4), 'horizontal', 'un deslizamiento claramente horizontal debe paginar')

console.log('OK: la agenda permite seleccionar un rango y elegir entre agendar o bloquear según permisos.')
