import assert from 'node:assert/strict'
import type { RecordCommunicationAttemptInput } from '../src/application/communications/record-communication-attempt.js'

// Keep imports from loading local credentials; all database access below is simulated.
process.env.DOTENV_CONFIG_PATH = '__offline_communication_attempt_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_communication_attempt'
const { PrismaCommunicationAttemptRepository } = await import('../src/infrastructure/communications/prisma-communication-attempt-repository.js')

function inputFor(sourceType: 'REMINDER' | 'POST_SALE', status: 'SENT' | 'FAILED'): RecordCommunicationAttemptInput {
  return {
    businessId: 'business-1', customerId: 'customer-1', customerName: 'Cliente',
    phone: '5491100000000', message: 'Mensaje de prueba', sourceType,
    sourceId: 'automation-1', sourceDeliveryId: 'delivery-1',
    purpose: 'OPERATIONAL', mode: 'WHATSAPP_API', status,
    providerMessageId: status === 'SENT' ? 'provider-1' : null,
    failureReason: status === 'FAILED' ? 'Template unavailable' : null,
    occurredAt: new Date('2026-10-22T20:00:00.000Z'),
    metadata: { appointmentId: 'appointment-1' }
  }
}

function fixture(existing: Record<string, unknown> | null = null, persistenceError?: Error) {
  const calls = { creates: [] as any[], executionUpdates: [] as any[], recipientUpdates: [] as any[], events: [] as any[] }
  const tx = {
    communicationRecipient: {
      findUnique: async ({ where }: any) => {
        assert.deepEqual(where, { sourceDeliveryId: 'delivery-1' })
        return existing
      },
      update: async (args: any) => { calls.recipientUpdates.push(args) }
    },
    communicationExecution: {
      create: async (args: any) => {
        // Model Prisma's required field validation at the persistence boundary.
        assert.equal(typeof args.data.recipients.create.recipientKey, 'string', 'Argument recipientKey is missing')
        assert.notEqual(args.data.recipients.create.recipientKey, '')
        if (persistenceError) throw persistenceError
        calls.creates.push(args)
      },
      update: async (args: any) => { calls.executionUpdates.push(args) }
    },
    communicationEvent: { create: async (args: any) => { calls.events.push(args) } }
  }
  const database = { $transaction: async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx) }
  const repository = new PrismaCommunicationAttemptRepository(database as any)
  return { repository, calls }
}

for (const sourceType of ['REMINDER', 'POST_SALE'] as const) {
  for (const status of ['SENT', 'FAILED'] as const) {
    const input = inputFor(sourceType, status)
    const { repository, calls } = fixture()
    await repository.record(input)
    assert.equal(calls.creates.length, 1)
    const execution = calls.creates[0].data
    const recipient = execution.recipients.create
    assert.equal(execution.sourceType, sourceType)
    assert.equal(execution.sourceId, input.sourceId)
    assert.deepEqual(execution.metadata, input.metadata)
    assert.equal(execution.status, 'COMPLETED')
    assert.equal(recipient.recipientKey, input.customerId)
    assert.deepEqual(recipient.customer.connect, { id: input.customerId })
    assert.deepEqual(recipient.business.connect, { id: input.businessId })
    assert.equal(recipient.sourceDeliveryId, input.sourceDeliveryId)
    assert.equal(recipient.status, status)
    assert.equal(recipient.phoneSnapshot, input.phone)
    assert.equal(recipient.messageSnapshot, input.message)
    assert.equal(recipient.providerMessageId, input.providerMessageId)
    assert.equal(recipient.failureReason, input.failureReason)
    assert.equal(recipient[status === 'SENT' ? 'sentAt' : 'failedAt'], input.occurredAt)
    assert.equal(recipient[status === 'SENT' ? 'failedAt' : 'sentAt'], undefined)
    assert.deepEqual(recipient.events.create, { toStatus: status, actorType: 'SYSTEM', note: input.failureReason })
    console.log('PASS create ' + sourceType + ' ' + status)

    const retry = fixture({ id: 'recipient-1', executionId: 'execution-1', status: 'FAILED', recipientKey: input.customerId })
    await retry.repository.record(input)
    assert.equal(retry.calls.creates.length, 0, 'Retry must not create a duplicate execution')
    assert.equal(retry.calls.executionUpdates.length, 1)
    assert.deepEqual(retry.calls.executionUpdates[0].where, { id: 'execution-1' })
    assert.deepEqual(retry.calls.recipientUpdates[0].where, { id: 'recipient-1' })
    const updated = retry.calls.recipientUpdates[0].data
    assert.equal(updated.status, status)
    assert.equal(updated.providerMessageId, input.providerMessageId)
    assert.equal(updated.failureReason, input.failureReason)
    assert.equal(updated[status === 'SENT' ? 'sentAt' : 'failedAt'], input.occurredAt)
    if (status === 'SENT') assert.equal(updated.failedAt, null)
    assert.deepEqual(retry.calls.events, [{ data: { recipientId: 'recipient-1', fromStatus: 'FAILED', toStatus: status, actorType: 'SYSTEM', note: input.failureReason } }])
    console.log('PASS retry ' + sourceType + ' ' + status)
  }
}

const failure = new Error('Persistence failed')
const rejected = fixture(null, failure)
await assert.rejects(() => rejected.repository.record(inputFor('REMINDER', 'FAILED')), (error) => error === failure)
console.log('PASS persistence failures propagate')
