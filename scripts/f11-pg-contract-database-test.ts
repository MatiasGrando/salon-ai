import assert from 'node:assert/strict'
import { assertF11PgContractDatabaseUrl } from './f11-pg-contract-database.js'

assert.doesNotThrow(() => assertF11PgContractDatabaseUrl(
  'postgresql://postgres:postgres@127.0.0.1:55434/salon_ai_f11_recovery',
  'custom-port contract',
  '55434'
))
assert.doesNotThrow(() => assertF11PgContractDatabaseUrl(
  'postgresql://supabase_admin:postgres@127.0.0.1:55434/salon_ai_f11_recovery',
  'restored Supabase scratch contract',
  '55434'
))

for (const [url, port] of [
  ['postgresql://postgres:postgres@db.example.com:55434/salon_ai_f11_recovery', '55434'],
  ['postgresql://postgres:secret@127.0.0.1:55434/salon_ai_f11_recovery', '55434'],
  ['postgresql://service_role:postgres@127.0.0.1:55434/salon_ai_f11_recovery', '55434'],
  ['postgresql://postgres:postgres@127.0.0.1:55435/salon_ai_f11_recovery', '55434'],
  ['postgresql://postgres:postgres@127.0.0.1:55434/production', '55434'],
  ['postgresql://postgres:postgres@127.0.0.1:55434/salon_ai_f11_recovery?schema=public', '55434'],
  ['postgresql://postgres:postgres@127.0.0.1:55434/salon_ai_f11_recovery', 'invalid']
] as const) {
  assert.throws(() => assertF11PgContractDatabaseUrl(url, 'unsafe contract', port), /Refusing unsafe/)
}

console.log('OK F11 PG target guard: postgres/Supabase scratch roles and custom loopback port are explicit; external hosts, other roles, credentials, databases, query parameters and mismatched ports are rejected.')
