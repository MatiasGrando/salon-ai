import assert from 'node:assert/strict'
import { parseWorkshopJob, parseWorkshopShortcut } from '../src/services/workshop-job-domain.js'
const input = { vehicleId: 'v', date: '2026-09-07', mileage: 85000, performerId: 'performer-a', lines: [{ description: 'Aceite', quantity: 2, parts: '10,50', labor: '' }] }
const job = parseWorkshopJob(input)
assert.equal(job.performerId, 'performer-a')
assert.equal(job.lines[0]?.partsCents, 1050)
assert.equal(job.totalCents, 2100)
assert.equal(job.lines[0]?.laborCents, null)
for (const invalid of [{date:'2026-02-30'}, {mileage:-1}, {performerId:''}, {lines:[]}, {lines:[{description:'x',quantity:0}]}, {lines:[{description:'x',quantity:1,parts:'abc'}]}]) assert.throws(() => parseWorkshopJob({...input,...invalid}))
assert.equal(parseWorkshopShortcut({name:' Filtro ',description:'Cambio de filtro',quantity:1}).name,'Filtro')
assert.throws(() => parseWorkshopShortcut({name:'',description:'x'}))
console.log('Workshop jobs domain: OK')
