import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [routes, ui, cash] = await Promise.all([
  readFile(new URL('../src/routes/appointment.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/cash-service.ts', import.meta.url), 'utf8')
])

assert.match(routes, /app\.post\('\/appointments\/:id\/add-service'/, 'debe existir una operación específica para sumar servicios a una visita')
assert.match(routes, /hasAgendaPermission\(request\.auth, 'canCreateAppointments'\)[\s\S]*hasAgendaPermission\(request\.auth, 'canEditAppointments'\)/, 'sumar un servicio requiere permisos de alta y edición')
assert.match(routes, /accountLink[\s\S]*APPOINTMENT_FINANCE_ALREADY_STARTED/, 'no debe reagrupar una visita cuya cuenta financiera ya comenzó')
assert.match(routes, /service\.update\([\s\S]*serviceIds/, 'si el profesional coincide debe sumar el servicio al mismo turno')
assert.match(routes, /coordinationGroupId[\s\S]*randomUUID\(\)/, 'si cambia el profesional debe crear o reutilizar un grupo coordinado')
assert.match(routes, /afterCreateInTransaction[\s\S]*coordinationGroupId/, 'el nuevo segmento y el turno original deben enlazarse atómicamente')
assert.match(routes, /COORDINATION_GROUP_CONFLICT[\s\S]*reply\.status\(409\)/, 'un cambio concurrente del grupo debe responder como conflicto recuperable')

assert.match(ui, /id="appointment-visit-services"/, 'el modal debe mostrar los servicios de la visita')
assert.match(ui, /id="appointment-add-service-open"/, 'debe ofrecer una acción rápida para agregar otro servicio')
assert.match(ui, /id="appointment-add-service-panel"/, 'la carga rápida necesita un panel visual propio')
assert.match(ui, /'\/appointments\/' \+ appointment\.id \+ '\/add-service'/, 'la Agenda debe usar la operación coordinada')
assert.match(ui, /Agregar servicio a esta visita/, 'la acción debe explicar que no crea otro cliente')
assert.match(ui, /appointment-add-service-professional/, 'debe permitir elegir otro profesional')
assert.match(ui, /appointment-add-service-start/, 'debe permitir confirmar el horario del siguiente tramo')

assert.match(cash, /\['WEB', 'MANUAL'\]\.includes\(coordinationOrigin\)/, 'Caja debe aceptar grupos coordinados manuales homogéneos')

console.log('Manual appointment add-service contracts OK')