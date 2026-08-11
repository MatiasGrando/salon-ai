import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [schema, migration, service, assignment] = await Promise.all([
  readFile('prisma/schema.prisma', 'utf8'),
  readFile('prisma/migrations/20260811153000_add_business_bot_configuration/migration.sql', 'utf8'),
  readFile('src/services/business-bot-configuration-service.ts', 'utf8'),
  readFile('scripts/assign-weex-support-bot-v1.ts', 'utf8')
])

assert.match(schema, /model BusinessBotConfiguration/)
assert.match(schema, /@@unique\(\[businessId, botKey\]\)/)
assert.match(migration, /CREATE TABLE "BusinessBotConfiguration"/)
assert.match(service, /businessBotConfiguration\.upsert/)
assert.match(service, /status: 'DRAFT'/)
assert.match(service, /channel: 'UNASSIGNED'/)
assert.doesNotMatch(service, /whatsappConfig\.(update|upsert|create)/)
assert.doesNotMatch(service, /botEnabled:\s*true/)
assert.match(assignment, /activated: false/)

console.log('Business bot configuration contract: OK (borrador asignable sin activación de canal)')
