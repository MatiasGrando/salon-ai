import assert from 'node:assert/strict'
import { buildPublicWorkshopVehicle, workshopMaintenancePolicy } from '../src/services/public-workshop-history.js'

const vehicle = {
  plate: 'AB123CD',
  model: 'Kangoo',
  year: null,
  engine: '--',
  currentMileage: 120_000,
  usage: 'PROFESSIONAL',
  brand: { name: 'Renault' },
  customer: { name: 'Dato privado', phone: '11-5555-5555', email: 'privado@example.com' }
}

const jobs = [
  {
    id: 'job-new',
    date: '2026-08-15',
    mileage: 120_000,
    responsible: 'Dato privado',
    performerId: 'performer-private',
    totalCents: 99_999,
    notes: 'Observación interna',
    lines: [
      { description: 'Cambio de aceite', quantity: 1, partsCents: 20_000, laborCents: 10_000 },
      { description: 'Filtro de aceite', quantity: 2, partsCents: null, laborCents: null }
    ]
  },
  {
    id: 'job-old',
    date: '2026-02-10',
    mileage: 114_500,
    responsible: null,
    totalCents: 50_000,
    notes: '',
    lines: [{ description: 'Filtro de aire', quantity: 1, partsCents: 5_000, laborCents: 2_000 }]
  }
]

const result = buildPublicWorkshopVehicle({ vehicle, jobs, hasMore: true, nextOffset: 10 })

assert.equal(result.plate, 'AB123CD')
assert.equal(result.brand, 'Renault')
assert.equal(result.year, null)
assert.equal(result.lastService?.date, '2026-08-15')
assert.equal(result.lastService?.mileage, 120_000)
assert.equal(result.recommendation?.nextMileage, 125_000)
assert.equal(result.recommendation?.nextDate, '2026-11-15')
assert.equal(result.history.items.length, 2)
assert.equal(result.history.items[0].items[1].quantity, 2)
assert.equal(result.history.hasMore, true)
assert.equal(result.history.nextOffset, 10)

const serialized = JSON.stringify(result)
for (const privateValue of ['Dato privado', '11-5555-5555', 'privado@example.com', 'performer-private', '99999', 'Observación interna']) {
  assert.equal(serialized.includes(privateValue), false, `La respuesta pública no debe contener ${privateValue}`)
}
for (const privateKey of ['customer', 'responsible', 'performerId', 'totalCents', 'partsCents', 'laborCents', 'notes']) {
  assert.equal(serialized.includes(`"${privateKey}"`), false, `La respuesta pública no debe contener la propiedad ${privateKey}`)
}

assert.deepEqual(workshopMaintenancePolicy('PARTICULAR'), { months: 6, kilometers: 10_000 })
assert.deepEqual(workshopMaintenancePolicy('FREQUENT'), { months: 4, kilometers: 7_500 })
assert.deepEqual(workshopMaintenancePolicy('PROFESSIONAL'), { months: 3, kilometers: 5_000 })

const withoutJobs = buildPublicWorkshopVehicle({ vehicle, jobs: [], hasMore: false, nextOffset: null })
assert.equal(withoutJobs.lastService, null)
assert.equal(withoutJobs.recommendation, null)
assert.deepEqual(withoutJobs.history, { items: [], hasMore: false, nextOffset: null })

console.log('Public workshop history contract: OK')
