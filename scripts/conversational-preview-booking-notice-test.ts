import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync('src/routes/crm-ui.ts', 'utf8')
const noticeElement = ui.match(/<small id="demo-preview-notice"[^>]*>([^<]*)<\/small>/)
assert.ok(noticeElement, 'existing simulator needs an accessible booking-scope notice')
assert.match(noticeElement[1]!, /no se env&iacute;an por WhatsApp/)
const noticeSource = ui.match(/function updateDemoPreviewNotice\([^]*?\n    \}/)?.[0]
assert.ok(noticeSource, 'notice must follow current profile, authority and mode')
const state: any = { currentUser: { role: 'SUPER_ADMIN' }, demoProfiles: [
  { id: 'qa', demoType: 'QA_SANDBOX' },
  { id: 'commercial', demoType: 'BARBERSHOP' }
] }
const els: any = {
  demoProfileSelect: { value: 'qa' }, demoPreviewModeRow: { hidden: false },
  demoPreviewMode: { value: 'conversational-preview' }, demoPreviewNotice: { textContent: '' }
}
const update = new Function('state', 'els', noticeSource + '\nreturn updateDemoPreviewNotice')(state, els)
update()
assert.match(els.demoPreviewNotice.textContent, /confirmar explícitamente/)
assert.match(els.demoPreviewNotice.textContent, /turnos de prueba.*agenda de este perfil QA/)
assert.match(els.demoPreviewNotice.textContent, /No se envían.*WhatsApp/)
assert.doesNotMatch(els.demoPreviewNotice.textContent, /no reserva/)
const bookingNotice = els.demoPreviewNotice.textContent
for (const variant of ['existing', 'unknown']) {
  els.demoPreviewMode.value = variant
  update()
  assert.notEqual(els.demoPreviewNotice.textContent, bookingNotice)
  assert.match(els.demoPreviewNotice.textContent, /Simulador actual/)
  assert.match(els.demoPreviewNotice.textContent, /no se envían por WhatsApp/)
}
els.demoPreviewMode.value = 'conversational-preview'
for (const profileId of ['commercial', 'missing']) {
  els.demoProfileSelect.value = profileId
  update()
  assert.notEqual(els.demoPreviewNotice.textContent, bookingNotice, 'non-QA profile cannot advertise sandbox bookings')
}
els.demoProfileSelect.value = 'qa'
state.currentUser.role = 'ADMIN'
update()
assert.notEqual(els.demoPreviewNotice.textContent, bookingNotice)
state.currentUser.role = 'SUPER_ADMIN'
els.demoPreviewModeRow.hidden = true
update()
assert.notEqual(els.demoPreviewNotice.textContent, bookingNotice)
els.demoPreviewModeRow.hidden = false
update()
assert.equal(els.demoPreviewNotice.textContent, bookingNotice)
const modeSource = ui.match(/function updateDemoPreviewMode\([^]*?\n    \}/)?.[0]
assert.ok(modeSource)
const resetMode = new Function('state', 'els', noticeSource + '\n' + modeSource + '\nreturn updateDemoPreviewMode')(state, els)
for (let reopening = 0; reopening < 2; reopening++) {
  els.demoPreviewMode.value = 'conversational-preview'
  update()
  assert.equal(els.demoPreviewNotice.textContent, bookingNotice)
  resetMode()
  assert.equal(els.demoPreviewMode.value, 'existing', 'profile rendering/reopening resets selection')
  assert.notEqual(els.demoPreviewNotice.textContent, bookingNotice, 'reopening cannot leave stale booking notice')
}
assert.match(ui, /demoPreviewNotice: document\.getElementById\('demo-preview-notice'\)/)
assert.match(ui, /function updateDemoPreviewMode\([^]*?updateDemoPreviewNotice\(\)/)
assert.match(ui, /demoPreviewMode\?\.addEventListener\('change', \(\) => \{ updateDemoPreviewNotice\(\); startNewDemoChat\(\) \}\)/)
assert.doesNotMatch(noticeSource, /innerHTML|alert\(|confirm\(|prompt\(/)
console.log('conversational preview booking notice: OK')
