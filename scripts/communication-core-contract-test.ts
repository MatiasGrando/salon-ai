import assert from 'node:assert/strict'
import { ManualCampaignCommunicationService, type CampaignDeliveryRecorder } from '../src/application/campaigns/manual-campaign-communication-service.js'
import { CommunicationService, type CommunicationRecipientRecord, type CommunicationRepository, type StartCommunicationExecutionInput } from '../src/application/communications/communication-service.js'
import { assertCommunicationTransition, buildManualWhatsAppUrl, isExecutionComplete, isWithinCommunicationCooldown } from '../src/domain/communications/communication.js'

const tests: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'genera un enlace manual seguro con mensaje personalizado',
    run: () => {
      assert.equal(buildManualWhatsAppUrl('+54 9 11 1234-5678', 'Hola María'), 'https://wa.me/5491112345678?text=Hola%20Mar%C3%ADa')
      assert.throws(() => buildManualWhatsAppUrl('123', 'Hola'), /teléfono/)
    }
  },
  {
    name: 'acepta transiciones válidas y rechaza saltos imposibles',
    run: () => {
      assert.doesNotThrow(() => assertCommunicationTransition('PENDING', 'OPENED'))
      assert.doesNotThrow(() => assertCommunicationTransition('OPENED', 'SENT'))
      assert.throws(() => assertCommunicationTransition('SKIPPED', 'SENT'), /No se puede/)
    }
  },
  {
    name: 'calcula descanso promocional sin mezclar fechas límite',
    run: () => {
      const now = new Date('2026-07-20T12:00:00Z')
      assert.equal(isWithinCommunicationCooldown(new Date('2026-07-01T12:00:00Z'), now, 30), true)
      assert.equal(isWithinCommunicationCooldown(new Date('2026-06-20T12:00:00Z'), now, 30), false)
      assert.equal(isWithinCommunicationCooldown(null, now, 30), false)
    }
  },
  {
    name: 'considera completa una ejecución sin pendientes ni abiertos',
    run: () => {
      assert.equal(isExecutionComplete(['SENT', 'SKIPPED']), true)
      assert.equal(isExecutionComplete(['SENT', 'OPENED']), false)
    }
  },
  {
    name: 'la campaña manual registra entrega solamente al marcar enviado',
    run: async () => {
      const repository = new FakeCommunicationRepository()
      const deliveryRecorder = new FakeCampaignDeliveryRecorder()
      const service = new ManualCampaignCommunicationService(new CommunicationService(repository), deliveryRecorder)
      const execution = await service.start({
        businessId: 'business-1',
        sourceId: 'campaign-1',
        candidateCount: 1,
        excludedCount: 0,
        recipients: [{ customerId: 'customer-1', customerName: 'María', phone: '+5491112345678', message: 'Hola María' }]
      }) as any
      await service.transition({ executionId: execution.id, recipientId: 'recipient-1', businessId: 'business-1', status: 'OPENED' })
      assert.equal(deliveryRecorder.calls.length, 0)
      await service.transition({ executionId: execution.id, recipientId: 'recipient-1', businessId: 'business-1', status: 'SENT' })
      assert.equal(deliveryRecorder.calls.length, 1)
      assert.equal(deliveryRecorder.calls[0]?.campaignId, 'campaign-1')
      assert.equal(repository.execution.status, 'COMPLETED')
    }
  }
]

class FakeCommunicationRepository implements CommunicationRepository {
  execution: any = null

  async createExecution(input: StartCommunicationExecutionInput) {
    this.execution = {
      id: 'execution-1',
      businessId: input.businessId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      mode: input.mode,
      status: 'RUNNING',
      recipients: input.recipients.map((recipient, index) => ({
        id: 'recipient-' + (index + 1),
        executionId: 'execution-1',
        customerId: recipient.customerId,
        status: 'PENDING',
        phoneSnapshot: recipient.phone,
        customerNameSnapshot: recipient.customerName,
        messageSnapshot: recipient.message,
        sourceDeliveryId: null,
        openedAt: null,
        sentAt: null,
        skipReason: null,
        failureReason: null
      }))
    }
    return this.execution
  }

  async findExecution(id: string) {
    return this.execution?.id === id ? this.execution : null
  }

  async findRecipient(id: string): Promise<CommunicationRecipientRecord | null> {
    return this.execution?.recipients.find((recipient: CommunicationRecipientRecord) => recipient.id === id) ?? null
  }

  async transitionRecipient(input: { recipientId: string; toStatus: string; sourceDeliveryId?: string | null }) {
    const recipient = this.execution.recipients.find((item: CommunicationRecipientRecord) => item.id === input.recipientId)
    recipient.status = input.toStatus
    recipient.sourceDeliveryId = input.sourceDeliveryId ?? recipient.sourceDeliveryId
    return recipient
  }

  async recipientStatuses() {
    return this.execution.recipients.map((recipient: CommunicationRecipientRecord) => recipient.status)
  }

  async completeExecution() {
    this.execution.status = 'COMPLETED'
  }
}

class FakeCampaignDeliveryRecorder implements CampaignDeliveryRecorder {
  calls: Array<{ businessId: string; campaignId: string; customerId: string; sentAt: Date }> = []

  async recordManualSent(input: { businessId: string; campaignId: string; customerId: string; sentAt: Date }) {
    this.calls.push(input)
    return { id: 'delivery-' + this.calls.length }
  }
}

for (const test of tests) {
  await test.run()
  console.log('OK:', test.name)
}
console.log('\n' + tests.length + ' pruebas del núcleo de comunicaciones pasaron.')
