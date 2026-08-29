import assert from 'node:assert/strict'
import { assertF9PgContractDatabaseUrl } from './f9-pg-contract-database.js'

const valid = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f9_query_contract'
assert.doesNotThrow(() => assertF9PgContractDatabaseUrl(valid, 'safety contract'))
for (const unsafe of [
  'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f8_baseline_contract',
  'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f9_UPPER',
  `${valid}?sslmode=require`, `${valid}#fragment`,
  'postgresql://postgres:postgres@localhost:54322/salon_ai_f9_query_contract',
  'postgresql://postgres:postgres@127.0.0.1:54322/arbitrary_database'
]) assert.throws(() => assertF9PgContractDatabaseUrl(unsafe, 'safety contract'), /Refusing unsafe/)
console.log('OK F9 PG contract URL safety: explicit local F9 scratch only.')
