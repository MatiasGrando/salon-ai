import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyStatusCallbackTx, reconcileManualMessageReceipts } from '../src/bot-options/infrastructure/prisma-admission.js'

for (const status of ['sent', 'delivered', 'read', 'failed'] as const) {
  const queries: any[] = []
  const tx = {
    $executeRaw: async () => 0, // Manual messages have no BotOutbox row.
    $queryRaw: async (query: any) => { queries.push(query); return [{ conversationId: 'conversation', messageId: 'message' }] }
  }
  const result = await applyStatusCallbackTx(tx as any, 'business', 'provider-id', status, null)
  assert.equal(result.matched, true, status + ' must match a manual Message without BotOutbox')
  assert.equal(result.outboundMessage?.messageId, 'message')
  assert.ok(queries[0].values.includes('business'))
  assert.ok(queries[0].values.includes('provider-id'))
  assert.match(queries[0].sql, /m\."status" = 'read'/, 'Read receipt cannot regress')
  assert.match(queries[0].sql, /m\."status" = 'delivered'/, 'Delivered receipt cannot regress')
}
const absent = await applyStatusCallbackTx({ $executeRaw: async () => 0, $queryRaw: async () => [] } as any, 'other', 'missing', 'read', null)
assert.equal(absent.matched, false)
const source = readFileSync('src/routes/crm.ts', 'utf8')
assert.ok(source.includes('reconcileManualMessageReceipts'), 'Reconcile callbacks received before provider id was saved')
const processed: string[] = []
await reconcileManualMessageReceipts({
  botProviderEvent: {
    findMany: async (args: any) => {
      assert.equal(args.where.businessId, 'business')
      assert.equal(args.where.status, 'UNMATCHED')
      return [{ id: 'early', payload: { status: 'read' } }, { id: 'malformed', payload: null }]
    },
    updateMany: async (args: any) => { processed.push(args.where.id); return { count: 1 } }
  },
  $executeRaw: async () => 0,
  $queryRaw: async () => [{ conversationId: 'conversation', messageId: 'message' }]
} as any, 'business', 'provider-id')
assert.deepEqual(processed, ['early'])
console.log('Manual receipts: OK')
