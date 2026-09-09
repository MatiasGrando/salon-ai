import assert from 'node:assert/strict'
import {
  normalizeWorkshopBrand,
  normalizeWorkshopContactPhone,
  normalizeWorkshopPlate,
  parseWorkshopVehicleInput,
  WORKSHOP_DEFAULT_BRAND_NAMES,
  WorkshopVehicleValidationError
} from '../src/services/workshop-vehicle-domain.js'

assert.equal(normalizeWorkshopPlate(' ab-123-cd '), 'AB123CD')
assert.equal(normalizeWorkshopPlate('AH M980'), 'AHM980')
assert.throws(() => normalizeWorkshopPlate('AB44'), WorkshopVehicleValidationError)
assert.throws(() => normalizeWorkshopPlate('123456'), WorkshopVehicleValidationError)

assert.deepEqual(normalizeWorkshopBrand('  Renault  '), { name: 'Renault', normalizedName: 'renault' })
assert.equal(normalizeWorkshopBrand('RENAULT').normalizedName, 'renault')
assert.equal(normalizeWorkshopBrand('Citroën').normalizedName, 'citroen')
assert.throws(() => normalizeWorkshopBrand('   '), WorkshopVehicleValidationError)
assert.ok(WORKSHOP_DEFAULT_BRAND_NAMES.length >= 40)
for (const brand of ['Alfa Romeo', 'Chevrolet', 'Citroën', 'Fiat', 'Ford', 'Honda', 'Hyundai', 'Mercedes-Benz', 'Peugeot', 'Renault', 'Toyota', 'Volkswagen']) {
  assert.ok(WORKSHOP_DEFAULT_BRAND_NAMES.includes(brand), brand)
}

assert.deepEqual(normalizeWorkshopContactPhone('11-6431-2712'), {
  normalizedPhone: '5491164312712',
  storedPhone: '11-6431-2712'
})
assert.deepEqual(normalizeWorkshopContactPhone('15-6431-2742'), {
  normalizedPhone: '5491164312742',
  storedPhone: '11-6431-2742'
})
assert.throws(() => normalizeWorkshopContactPhone('351-555-1212'), WorkshopVehicleValidationError)

assert.deepEqual(parseWorkshopVehicleInput({
  plate: ' ab 123 cd ',
  brandId: ' brand-1 ',
  model: ' Kangoo ',
  year: '2020',
  engine: ' 1.6 ',
  currentMileage: '82.400',
  usage: 'PROFESSIONAL',
  contactName: ' Juan Pérez ',
  contactPhone: '11 5555-5555',
  contactEmail: ' JUAN@EXAMPLE.COM '
}), {
  plate: 'AB123CD',
  brandId: 'brand-1',
  model: 'Kangoo',
  year: 2020,
  engine: '1.6',
  currentMileage: 82400,
  usage: 'PROFESSIONAL',
  contactName: 'Juan Pérez',
  contactPhone: '11 5555-5555',
  contactEmail: 'juan@example.com'
})

assert.equal(parseWorkshopVehicleInput({
  plate: 'ABC123', brandId: 'brand', model: 'Gol', year: '',
  engine: '1.6', currentMileage: 1000, usage: 'PARTICULAR',
  contactName: 'Ana', contactPhone: '1155555555'
}).year, null)

for (const usage of ['PARTICULAR', 'FREQUENT', 'PROFESSIONAL']) {
  assert.equal(parseWorkshopVehicleInput({
    plate: 'ABC123', brandId: 'brand', model: 'Gol', year: 2018,
    engine: '1.6', currentMileage: 1000, usage,
    contactName: 'Ana', contactPhone: '1155555555'
  }).usage, usage)
}

for (const bad of [
  { year: 1800 }, { year: 2200 }, { currentMileage: -1 }, { usage: 'TAXI' },
  { brandId: '' }, { model: '' }, { engine: '' }, { contactName: '' }, { contactPhone: '' }
]) {
  assert.throws(() => parseWorkshopVehicleInput({
    plate: 'ABC123', brandId: 'brand', model: 'Gol', year: 2018,
    engine: '1.6', currentMileage: 1000, usage: 'PARTICULAR',
    contactName: 'Ana', contactPhone: '1155555555', ...bad
  }), WorkshopVehicleValidationError)
}

console.log('Workshop vehicle domain contracts passed')
