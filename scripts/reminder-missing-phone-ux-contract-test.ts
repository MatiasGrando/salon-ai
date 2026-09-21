import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const uiSource = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

const reminderRender = uiSource.slice(
  uiSource.indexOf('function renderReminderSettings'),
  uiSource.indexOf('function updateReminderDraftFromForm')
)
const phoneEditor = uiSource.slice(
  uiSource.indexOf('function openReminderPhoneDialog'),
  uiSource.indexOf('async function deleteSelectedReminder')
)

assert.match(
  reminderRender,
  /Sin tel(?:&eacute;|é)fono v(?:&aacute;|á)lido/,
  'un recordatorio sin enlace debe explicar que falta un telefono valido'
)
assert.match(
  reminderRender,
  /data-reminder-phone[^>]*>Cargar tel(?:&eacute;|é)fono</,
  'la tarjeta bloqueada debe ofrecer cargar el telefono sin quitar Omitir'
)
assert.match(
  uiSource,
  /id="reminder-phone-dialog"[\s\S]*aria-modal="true"[\s\S]*id="reminder-phone-input"[\s\S]*id="reminder-phone-feedback"[\s\S]*id="reminder-phone-submit"/,
  'la carga debe usar un dialogo integrado con campo, feedback y acciones propias'
)
assert.match(
  uiSource,
  /\.reminder-phone-dialog[\s\S]*\.reminder-phone-form[\s\S]*@media \(max-width: 767px\)/,
  'el formulario debe tener contenedor visual propio y adaptacion movil'
)
assert.match(
  phoneEditor,
  /getJson\('\/customers\/' \+ editor\.customerId[\s\S]*businessId: state\.businessId/,
  'guardar debe reutilizar la actualizacion tenant-scoped del cliente'
)
assert.match(
  phoneEditor,
  /deliveries: currentData\.deliveries\.map[\s\S]*whatsappUrl: manualReminderWhatsappUrl\(updated\.phone, delivery\.messageSnapshot\)/,
  'la entrega local debe recibir el telefono normalizado y el enlace preparado'
)
assert.doesNotMatch(
  phoneEditor,
  /loadReminder(?:Settings|Deliveries)|processDueReminders/,
  'cargar el telefono no debe recargar ni reprocesar toda la cola'
)
assert.match(
  uiSource,
  /data-reminder-phone[\s\S]*openReminderPhoneDialog/,
  'el panel debe delegar la apertura del editor de telefono'
)

console.log('OK: recordatorios sin telefono explican el bloqueo y permiten corregirlo sin reprocesar la cola.')
