import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CashService } from '../src/services/cash-service.js'

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../prisma/migrations/20260924020000_cash_admin_responsible/migration.sql', import.meta.url), 'utf8')
assert.match(schema, /responsibleAdministratorUserId\s+String\?/)
assert.match(schema, /responsibleUser\s+User\?\s+@relation\("CashSessionLocalResponsible", fields: \[businessId, responsibleUserId\]/)
assert.match(migration, /ADD CONSTRAINT "CashSession_responsibleAdministratorUserId_fkey"/)
assert.match(migration, /FOREIGN KEY \("responsibleAdministratorUserId"\) REFERENCES "User"\("id"\)/)
assert.doesNotMatch(migration, /DROP CONSTRAINT "CashSession_businessId_responsibleUserId_fkey"/)
assert.match(migration, /CHECK \(\("responsibleUserId" IS NOT NULL\) <> \("responsibleAdministratorUserId" IS NOT NULL\)\)/)

const tx = {
  lockBusiness: async () => ({ businessId: 'shop', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-24T12:00:00Z') }),
  findResponsible: async () => null,
  findOpenDay: async () => null,
  findPreviousCountedCash: async () => 20_000,
  createDay: async (input: Record<string, unknown>) => input,
  createSession: async (input: Record<string, unknown>) => input
}
const service = new CashService({ transaction: async (work: (repository: unknown) => Promise<unknown>) => work(tx) } as never)
const opened = await service.openRegisterDay({
  businessId: 'shop', responsibleUserId: 'admin-global',
  actingAdministrator: { id: 'admin-global', name: 'Dueño' }
} as never)
assert.equal(opened.session.responsibleUserId, null)
assert.equal(opened.session.responsibleAdministratorUserId, 'admin-global')
assert.equal(opened.session.responsibleName, 'Dueño')
assert.equal(opened.day.openingCash, 20_000)
await assert.rejects(service.openRegisterDay({
  businessId: 'shop', responsibleUserId: 'other',
  actingAdministrator: { id: 'admin-global', name: 'Dueño' }
} as never), { code: 'RESPONSIBLE_NOT_FOUND' })
console.log('OK administrador autenticado puede ser responsable de Caja sin cuenta local duplicada')
