import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  generateBusinessCustomerCode,
  isBusinessCustomerCode,
  normalizeBusinessCustomerCode
} from '../src/services/business-customer-code.js'

const [schema, migration, service, crm] = await Promise.all([
  readFile('prisma/schema.prisma', 'utf8'),
  readFile('prisma/migrations/20260811190000_add_business_customer_code/migration.sql', 'utf8'),
  readFile('src/services/business-service.ts', 'utf8'),
  readFile('src/routes/crm-ui.ts', 'utf8')
])

const generated = Array.from({ length: 500 }, () => generateBusinessCustomerCode())
assert.equal(new Set(generated).size, generated.length)
assert.ok(generated.every(isBusinessCustomerCode))
assert.equal(normalizeBusinessCustomerCode(' wx-7k4m92 '), 'WX-7K4M92')
assert.equal(isBusinessCustomerCode('WX-000001'), false)

assert.match(schema, /customerCode\s+String\s+@unique/)
assert.match(migration, /ALTER COLUMN "customerCode" SET NOT NULL/)
assert.match(migration, /CREATE UNIQUE INDEX "Business_customerCode_key"/)
assert.match(service, /generateBusinessCustomerCode/)
assert.match(service, /customerCodeExists/)
assert.match(crm, /business-customer-code/)
assert.match(crm, /N&uacute;mero de cliente/)

console.log('Business customer code contract: OK (aleatorio, público, único y visible en CRM)')
