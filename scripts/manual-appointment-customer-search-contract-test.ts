import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const route = readFileSync(new URL('../src/routes/customer.ts', import.meta.url), 'utf8')

assert.ok(ui.includes('id="appointment-customer-search"'), 'el turno manual debe tener una barra de búsqueda')
assert.ok(ui.includes('placeholder="Escrib&iacute; nombre o tel&eacute;fono"'), 'el texto del buscador debe conservar sus acentos')
assert.ok(ui.includes('<label for="appointment-customer-phone">Tel&eacute;fono</label>'), 'el campo de teléfono debe mostrarse sin texto redundante')
assert.ok(ui.includes('role="combobox"'), 'la búsqueda debe anunciarse como autocomplete accesible')
assert.ok(ui.includes('id="appointment-customer-results"'), 'los resultados deben mostrarse dentro del CRM')
assert.equal(ui.includes('<select id="appointment-customer">'), false, 'no debe renderizarse el select nativo con todos los clientes')
assert.ok(ui.includes("setTimeout(() => loadAppointmentCustomerResults(query), 250)"), 'la búsqueda debe usar debounce')
assert.ok(ui.includes("take: '12'"), 'el modal debe pedir una cantidad acotada de resultados')
assert.ok(ui.includes('data-create-appointment-customer'), 'si no existe debe poder crear un cliente nuevo')
assert.ok(ui.includes("loadAppointmentCustomerResults(els.appointmentCustomerSearch.value.trim())"), 'al enfocar debe mostrar clientes recientes')
assert.ok(ui.includes("event.key === 'Enter'"), 'el teclado debe poder seleccionar un resultado sin enviar el formulario')

const formOptionsStart = ui.indexOf('function renderAppointmentFormOptions()')
const formOptionsEnd = ui.indexOf('function appointmentCustomerLabel', formOptionsStart)
const formOptions = ui.slice(formOptionsStart, formOptionsEnd)
assert.equal(formOptions.includes('state.customers.map'), false, 'el formulario no debe construir una lista completa de clientes')
assert.equal(formOptions.includes('appointmentCustomer.innerHTML'), false, 'el cliente seleccionado debe guardarse sin un select nativo')

assert.ok(route.includes("app.get('/customers/search'"), 'debe existir una búsqueda liviana en servidor')
assert.ok(route.includes('Math.min(20'), 'el servidor nunca debe devolver más de 20 clientes')
assert.ok(route.includes("name: { contains: search, mode: 'insensitive'"), 'debe buscar por nombre sin distinguir mayúsculas')
assert.ok(route.includes('normalizedPhone: { contains: digits }'), 'debe buscar por teléfono normalizado')
assert.ok(route.includes('businessId,'), 'la búsqueda debe limitarse directamente al local propietario')

const overviewStart = route.indexOf("app.get('/customers/overview'")
const overviewEnd = route.indexOf("app.post('/customers'", overviewStart)
const overview = route.slice(overviewStart, overviewEnd)
assert.ok(overview.includes('where: { businessId }'), 'la vista principal de Clientes debe incluir todas las fichas del local')
assert.ok(overview.includes('prisma.appointment.findMany'), 'la vista principal de Clientes debe conservar los clientes con turnos')

const listStart = route.indexOf("app.get('/customers'", overviewEnd)
const listEnd = route.indexOf("app.patch('/customers/:id'", listStart)
const customerList = route.slice(listStart, listEnd)
assert.ok(customerList.includes('findMany({ where: { businessId } })'), 'la lista debe incluir todas las fichas y solo las del local')

console.log('Manual appointment customer search contract: OK (autocomplete, límites, teclado y aislamiento)')
