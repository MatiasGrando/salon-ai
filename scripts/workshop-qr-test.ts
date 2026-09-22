import assert from 'node:assert/strict'
import {
  normalizeWorkshopPublicSiteUrl,
  workshopVehiclePublicUrl,
  workshopVehicleQrDataUrl
} from '../src/services/workshop-qr.js'

assert.equal(normalizeWorkshopPublicSiteUrl(' https://taller.example/historial/ '), 'https://taller.example/historial')
assert.throws(() => normalizeWorkshopPublicSiteUrl('http://taller.example'))
assert.throws(() => normalizeWorkshopPublicSiteUrl('https://user:pass@taller.example'))
assert.equal(
  workshopVehiclePublicUrl('https://taller.example/historial', 'AB123CD'),
  'https://taller.example/historial?patente=AB123CD#consulta-patente'
)
const qr = await workshopVehicleQrDataUrl('https://taller.example/historial?patente=AB123CD#consulta-patente')
assert.match(qr, /^data:image\/png;base64,/)
console.log('Workshop QR contract: OK')
