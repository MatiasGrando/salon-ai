import assert from 'node:assert/strict'
import { assertF8PgContractDatabaseUrl } from './f8-pg-contract-database.js'

const valid = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f8_baseline_contract_safety'
assert.doesNotThrow(() => assertF8PgContractDatabaseUrl(valid, 'safety contract'))

for (const unsafe of [
  'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f7_snapshot',
  'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test',
  `${valid}?sslmode=require`,
  `${valid}#fragment`,
  'postgresql://postgres:postgres@db.example.test:54322/salon_ai_f8_baseline_remote',
  'postgresql://postgres:postgres@127.0.0.1:54322/arbitrary_database'
]) {
  assert.throws(() => assertF8PgContractDatabaseUrl(unsafe, 'safety contract'), /Refusing unsafe/)
}

const previous = process.env.F8_PG_CONTRACT_DATABASE_URL
delete process.env.F8_PG_CONTRACT_DATABASE_URL
const { resolveF8PgContractDatabase } = await import('./f8-pg-contract-database.js')
assert.throws(() => resolveF8PgContractDatabase('safety contract'), /is required/)
if (previous === undefined) delete process.env.F8_PG_CONTRACT_DATABASE_URL
else process.env.F8_PG_CONTRACT_DATABASE_URL = previous

console.log('OK F8 PG contract URL safety: explicit local disposable scratch only.')
