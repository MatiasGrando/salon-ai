import assert from 'node:assert/strict'
import { Prisma } from '../src/generated/prisma/client.js'
import { recoverStaleTakeOperations } from '../src/bot-options/application/handoff-operations.js'
import { botWorkerScopeFromEnv, tenantScopeSql } from '../src/bot-options/infrastructure/tenant-scope.js'

const barber = 'cmpvr0oqo0000o0vcnhgyv054'
assert.equal(botWorkerScopeFromEnv({}), undefined, 'ordinary deployments retain their existing global behavior')
assert.deepEqual(botWorkerScopeFromEnv({ BOT_WORKER_SCOPE_MODE: 'include', BOT_WORKER_SCOPE_BUSINESS_ID: barber }),
  { mode: 'include', businessId: barber })
assert.deepEqual(botWorkerScopeFromEnv({ BOT_WORKER_SCOPE_MODE: 'exclude', BOT_WORKER_SCOPE_BUSINESS_ID: barber }),
  { mode: 'exclude', businessId: barber })
for (const env of [
  { BOT_WORKER_SCOPE_MODE: 'include' },
  { BOT_WORKER_SCOPE_BUSINESS_ID: barber },
  { BOT_WORKER_SCOPE_MODE: 'invalid', BOT_WORKER_SCOPE_BUSINESS_ID: barber },
  { BOT_WORKER_SCOPE_MODE: 'exclude', BOT_WORKER_SCOPE_BUSINESS_ID: '  ' }
]) assert.throws(() => botWorkerScopeFromEnv(env), /BOT_WORKER_SCOPE/)

for (const mode of ['include', 'exclude'] as const) {
  const sql = Prisma.sql`SELECT 1 FROM "BotJob" j WHERE true ${tenantScopeSql({ mode, businessId: barber }, 'j')}`
  assert.match(sql.text, mode === 'include' ? /j\."businessId" = \$1/ : /j\."businessId" <> \$1/)
  assert.deepEqual(sql.values, [barber])
}
const ordinary = Prisma.sql`SELECT 1 ${tenantScopeSql(undefined, 'j')}`
assert.deepEqual(ordinary.values, [])
for (const mode of ['include', 'exclude'] as const) {
  let captured: Prisma.Sql | undefined
  const result = await recoverStaleTakeOperations({
    client: { async $queryRaw(query: Prisma.Sql) { captured = query; return [] } } as never,
    scope: { mode, businessId: barber }
  })
  assert.deepEqual(result, { completed: 0, waiting: 0, blockedUnknown: 0, aborted: 0 })
  assert.match(captured!.text, mode === 'include'
    ? /op\."businessId" = \$1/
    : /op\."businessId" <> \$1/)
  assert.equal(captured!.values[0], barber)
}
console.log('bot-worker tenant scope contracts passed')
