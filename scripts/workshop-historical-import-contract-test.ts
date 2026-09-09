import assert from 'node:assert/strict'
import {
  buildWorkshopHistoricalImportPlan,
  splitLegacyWorkshopVehicle
} from './workshop-historical-import.js'

assert.deepEqual(splitLegacyWorkshopVehicle('RENAILT KANGOO'), { brandName: 'Renault', model: 'KANGOO' })
assert.deepEqual(splitLegacyWorkshopVehicle('VOLSKWAGENGOL TREND'), { brandName: 'Volkswagen', model: 'GOL TREND' })

const plan = buildWorkshopHistoricalImportPlan([
  {
    source: 'F:\\tMecanica',
    vehicles: [{ PATENTE: 'AA123AA', MODELO: 'RENAILT KANGOO', CLIENTE: 'Ana', TELEFONO: '15-1234-5678', EMAIL: '' }],
    headers: [{ PATENTE: 'AA123AA', FECHA: '20240110', KM: '12000', ACEITE: '1' }],
    lines: [{ PATENTE: 'AA123AA', FECHA: '20240110', CANTIDAD: '1', DESCRIP: 'Cambio de aceite', REPUESTO: '10.5', MANOOBRA: '2.5' }]
  },
  {
    source: 'F:\\tMecanica 1',
    vehicles: [{ PATENTE: 'AA123AA', MODELO: 'RENAULT KANGOO', CLIENTE: 'Ana Pérez', TELEFONO: '11-1234-5678', EMAIL: 'ana@example.com' }, { PATENTE: 'AB123CD', MODELO: 'MODELO SIN MARCA', CLIENTE: '', TELEFONO: '', EMAIL: '' }],
    headers: [{ PATENTE: 'AA123AA', FECHA: '20240110', KM: '12000', ACEITE: '1' }, { PATENTE: 'AB123CD', FECHA: '20240201', KM: '', FAIRE: '1' }],
    lines: [{ PATENTE: 'AA123AA', FECHA: '20240110', CANTIDAD: '1', DESCRIP: 'Cambio de aceite', REPUESTO: '10.5', MANOOBRA: '2.5' }]
  }
])

assert.equal(plan.vehicles.length, 2, 'deduplica vehículos por patente')
assert.equal(plan.jobs.length, 2, 'deduplica una ficha repetida entre instalaciones')
assert.equal(plan.vehicles.find(vehicle => vehicle.plate === 'AA123AA')?.contact.name, 'Ana Pérez')
assert.equal(plan.vehicles.find(vehicle => vehicle.plate === 'AA123AA')?.contact.phone, '11-1234-5678')
assert.equal(plan.vehicles.find(vehicle => vehicle.plate === 'AB123CD')?.contact.phone, '')
assert.equal(plan.jobs.find(job => job.plate === 'AA123AA')?.lines[0]?.partsCents, 1050)
assert.equal(plan.jobs.find(job => job.plate === 'AB123CD')?.mileage, 0)
assert.deepEqual(plan.jobs.find(job => job.plate === 'AB123CD')?.lines.map(line => line.description), ['Filtro de aire'])
console.log('Workshop historical import plan: OK')
