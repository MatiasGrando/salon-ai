import assert from 'node:assert/strict'
import { prisma } from '../src/config/prisma.js'
import { withConversationProcessingLease } from '../src/services/conversation-processing-lease.js'

const db = prisma as any
const originals = {
  updateManyAndReturn: db.conversation.updateManyAndReturn,
  updateMany: db.conversation.updateMany
}
const leasedConversation = {
  id: 'conversation-1',
  businessId: 'business-1',
  phone: '5491112345678',
  botProcessingToken: 'lease-token'
}
let releaseCalls = 0

try {
  db.conversation.updateManyAndReturn = async () => [leasedConversation]
  db.conversation.updateMany = async () => {
    releaseCalls += 1
    return { count: 1 }
  }

  const result = await withConversationProcessingLease(
    leasedConversation.id,
    async (conversation) => {
      assert.equal(conversation, leasedConversation)
      return 'processed'
    },
    {
      async onAcquired() {
        await Promise.resolve()
        throw new Error('fallo de telemetría')
      }
    }
  )
  assert.equal(result, 'processed')
  assert.equal(releaseCalls, 1)

  await assert.rejects(
    withConversationProcessingLease(leasedConversation.id, async () => {
      throw new Error('fallo del procesamiento')
    }),
    /fallo del procesamiento/
  )
  assert.equal(releaseCalls, 2)
} finally {
  db.conversation.updateManyAndReturn = originals.updateManyAndReturn
  db.conversation.updateMany = originals.updateMany
}

console.log('conversation-processing-lease-contract-test: OK')
