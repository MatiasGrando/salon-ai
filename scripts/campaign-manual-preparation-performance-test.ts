import assert from 'node:assert/strict'
import { PrismaCommunicationRepository } from '../src/infrastructure/communications/prisma-communication-repository.js'

const size = 4606
const recipientBatches: Array<any[]> = []
const eventBatches: Array<any[]> = []
let transactionCalls = 0
const fakeTransaction = {
  communicationExecution: {
    create: async ({ data, select }: any) => {
      assert.equal(data.eligibleCount, size)
      assert.deepEqual(select, { id: true })
      return { id: 'execution-1' }
    }
  },
  communicationRecipient: {
    createManyAndReturn: async ({ data, select }: any) => {
      assert.deepEqual(select, { id: true })
      recipientBatches.push(data)
      return data.map((_row: any, index: number) => ({ id: 'recipient-' + recipientBatches.length + '-' + index }))
    }
  },
  communicationEvent: {
    createMany: async ({ data }: any) => {
      eventBatches.push(data)
      return { count: data.length }
    }
  }
}
const fakeDatabase = {
  $transaction: async (callback: (transaction: typeof fakeTransaction) => Promise<unknown>, options: any) => {
    transactionCalls++
    assert.ok(options.timeout >= 60_000)
    return callback(fakeTransaction)
  }
}
const repository = new PrismaCommunicationRepository(fakeDatabase as any)
const result = await repository.createExecution({
  businessId: 'business-1',
  sourceType: 'CAMPAIGN',
  sourceId: 'campaign-1',
  purpose: 'PROMOTIONAL',
  mode: 'WHATSAPP_MANUAL',
  candidateCount: size,
  excludedCount: 0,
  recipients: Array.from({ length: size }, (_, index) => ({
    customerId: 'customer-' + Math.floor(index / 2),
    recipientKey: 'workshop:vehicle-' + index,
    customerName: 'Cliente ' + index,
    phone: '5491112345678',
    message: 'Hola ' + index
  }))
})
assert.deepEqual(result, { id: 'execution-1' })
assert.equal(transactionCalls, 1)
assert.equal(recipientBatches.length, Math.ceil(size / 500))
assert.equal(eventBatches.length, recipientBatches.length)
assert.equal(recipientBatches.reduce((sum, batch) => sum + batch.length, 0), size)
assert.equal(eventBatches.reduce((sum, batch) => sum + batch.length, 0), size)
assert.ok(recipientBatches.every((batch) => batch.length <= 500))
assert.equal(new Set(recipientBatches.flat().map((row) => row.recipientKey)).size, size)
assert.ok(eventBatches.flat().every((event) => event.toStatus === 'PENDING' && event.actorType === 'SYSTEM'))
console.log('Campaign manual bulk preparation: OK')
