import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const routeSource = await readFile(new URL('../src/routes/campaign.ts', import.meta.url), 'utf8')
const serviceSource = await readFile(new URL('../src/services/reminder-service.ts', import.meta.url), 'utf8')
const uiSource = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

const route = routeSource.slice(
  routeSource.indexOf("app.patch('/reminder-automations/:automationId/deliveries/:deliveryId/manual-status'"),
  routeSource.indexOf("app.post('/whatsapp/message-templates'")
)
const transition = serviceSource.slice(
  serviceSource.indexOf('export async function transitionManualReminder'),
  serviceSource.indexOf('async function recordReminderOutboundMessage')
)
const uiAction = uiSource.slice(
  uiSource.indexOf('async function updateManualReminderDelivery'),
  uiSource.indexOf('async function deleteSelectedReminder')
)

assert.doesNotMatch(
  route,
  /prisma\.reminderDelivery\.findFirst/,
  'la ruta no debe releer el recordatorio antes del servicio; el servicio ya valida tenant y automatizacion'
)
assert.match(
  route,
  /transitionManualReminder\(\{[\s\S]*automationId: params\.automationId/,
  'la ruta debe delegar la validacion de la automatizacion sin perder aislamiento'
)
assert.match(
  transition,
  /automationId: string/,
  'la transicion debe recibir la automatizacion para validar todo en una sola lectura'
)
assert.match(
  transition,
  /where: \{ id: input\.deliveryId, businessId: input\.businessId, reminderAutomationId: input\.automationId \}/,
  'la lectura unica debe quedar acotada por delivery, negocio y automatizacion'
)
assert.match(
  transition,
  /await Promise\.all\(\[[\s\S]*recordCommunicationAttempt\.execute\([\s\S]*recordReminderOutboundMessage\(/,
  'los dos registros observables independientes deben persistirse en paralelo'
)
assert.doesNotMatch(
  transition,
  /reminderDelivery\.findUniqueOrThrow/,
  'la respuesta no debe releer el estado que acaba de persistir'
)
assert.match(
  uiAction,
  /const previousDeliveryData = state\.reminderDeliveryData\[reminderId\]/,
  'la UI debe conservar el estado previo para poder revertir una actualizacion optimista'
)
assert.match(
  uiAction,
  /status: status,[\s\S]*renderReminderSettings\(\)[\s\S]*await getJson/,
  'la tarjeta debe reflejar el estado nuevo antes de esperar la red'
)
assert.doesNotMatch(
  uiAction,
  /await loadReminderDeliveries/,
  'marcar enviado no debe disparar la preparacion y recarga completa de pendientes'
)

console.log('OK: marcar un recordatorio manual evita lecturas duplicadas, paraleliza registros y actualiza la UI sin refresco global.')
