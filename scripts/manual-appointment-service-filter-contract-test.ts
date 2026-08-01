import assert from 'node:assert/strict'
import { filterAssignedServices } from '../src/routes/crm-ui.js'

const services = [
  { id: 'haircut', name: 'Corte' },
  { id: 'color', name: 'Color' },
  { id: 'lighting', name: 'Iluminación' }
]

const lucasServices = filterAssignedServices({
  services: [{ id: 'haircut' }, { id: 'color' }]
}, services)
const tamaraServices = filterAssignedServices({
  services: [{ id: 'lighting' }]
}, services)

assert.deepEqual(lucasServices.map((service) => service.id), ['haircut', 'color'])
assert.deepEqual(tamaraServices.map((service) => service.id), ['lighting'])
assert.deepEqual(filterAssignedServices(null, services), [])

console.log('OK: el turno manual muestra únicamente los servicios asignados al profesional elegido.')
