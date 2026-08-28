import assert from 'node:assert/strict'
import { assertF10PgContractDatabaseUrl } from './f10-pg-contract-database.js'

const valid = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f10_handoff_contract'
assert.doesNotThrow(() => assertF10PgContractDatabaseUrl(valid, 'safety contract'))
for (const unsafe of [
  'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f9_handoff_contract',
  'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f10_UPPER',
  `${valid}?sslmode=require`, `${valid}#fragment`,
  'postgresql://postgres:postgres@localhost:54322/salon_ai_f10_handoff_contract',
  'postgresql://postgres:postgres@127.0.0.1:54322/arbitrary_database'
]) assert.throws(() => assertF10PgContractDatabaseUrl(unsafe, 'safety contract'), /Refusing unsafe/)
console.log('OK F10 PG contract URL safety: explicit local F10 scratch only.')
