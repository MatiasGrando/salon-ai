import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { serializeProfessional } from '../src/routes/professional.js'

const source = readFileSync(new URL('../src/routes/professional.ts', import.meta.url), 'utf8')
assert.match(source, /businessAccessWhere\(resolveBusinessScope\(request\.auth!\.user\), query\.businessId\)/)
assert.match(source, /serializeProfessional\(professional, request\.auth\?\.user\.role !== 'STAFF'\)/)
const detailRoute = source.slice(source.indexOf("app.get('/professionals/:id'"), source.indexOf("app.get('/professionals/:id/appointments-impact'"))
assert.match(detailRoute, /return serializeProfessional\(professional, request\.auth\?\.user\.role !== 'STAFF'\)/, 'el detalle no debe revelar comisiones a STAFF')
const professional = {
  id: 'professional-a', name: 'Ana', avatarUrl: null, serviceLinks: [],
  commissionMode: 'PERCENTAGE', commissionPercentage: 50, commissionFixedAmount: null
}
const limited = serializeProfessional(professional, false)
assert.equal(limited.id, professional.id)
assert.equal('commissionMode' in limited, false)
assert.equal('commissionPercentage' in limited, false)
assert.equal('commissionFixedAmount' in limited, false)
const admin = serializeProfessional(professional, true)
assert.equal(admin.commissionPercentage, 50)
console.log('OK profesionales: alcance tenant y comisiones excluidas para personal')
