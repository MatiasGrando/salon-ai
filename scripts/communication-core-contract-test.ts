import assert from 'node:assert/strict'
import { ManualCampaignCommunicationService, type CampaignDeliveryRecorder } from '../src/application/campaigns/manual-campaign-communication-service.js'
import { CommunicationService, type CommunicationRecipientRecord, type CommunicationRepository, type StartCommunicationExecutionInput } from '../src/application/communications/communication-service.js'
import { assertCommunicationTransition, buildManualWhatsAppAppUrl, buildManualWhatsAppUrl, isExecutionComplete, isWithinCommunicationCooldown } from '../src/domain/communications/communication.js'
import { toManualCommunicationExecutionSummary } from '../src/routes/view-models/communication-view-model.js'

const tests: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'genera un enlace manual seguro con mensaje personalizado',
    run: () => {
      assert.equal(buildManualWhatsAppUrl('+54 9 11 1234-5678', 'Hola María'), 'https://wa.me/5491112345678?text=Hola%20Mar%C3%ADa')
      assert.equal(buildManualWhatsAppUrl('11-2690-1753', 'Hola'), 'https://wa.me/5491126901753?text=Hola')
      assert.equal(buildManualWhatsAppAppUrl('11-2690-1753', 'Hola'), 'whatsapp://send?phone=5491126901753&text=Hola')
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
    name: 'la vista de una cola grande devuelve sólo el siguiente contacto',
    run: () => {
      const view = toManualCommunicationExecutionSummary({
        id: 'execution-1', businessId: 'business-1', sourceType: 'CAMPAIGN', sourceId: 'campaign-1',
        purpose: 'PROMOTIONAL', mode: 'WHATSAPP_MANUAL', status: 'RUNNING',
        candidateCount: 4606, eligibleCount: 4606, excludedCount: 0, metadata: null,
        startedAt: new Date('2026-09-23T00:00:00Z'), completedAt: null
      }, [
        { status: 'PENDING', count: 4604 },
        { status: 'OPENED', count: 1 },
        { status: 'SENT', count: 1 }
      ], {
        id: 'recipient-2', executionId: 'execution-1', customerId: 'customer-1',
        recipientKey: 'workshop:vehicle-2', status: 'OPENED',
        phoneSnapshot: '+5491112345678', messageSnapshot: 'Hola María',
        customerNameSnapshot: 'María', openedAt: new Date('2026-09-23T00:01:00Z'),
        sentAt: null, skipReason: null, failureReason: null, metadata: { plate: 'AB123CD' }
      })
      assert.equal(view.completedCount, 1)
      assert.equal(view.recipients.length, 1)
      assert.equal(view.recipients[0]?.recipientKey, 'workshop:vehicle-2')
      assert.match(view.recipients[0]?.whatsappUrl || '', /wa.me/)
      assert.match(view.recipients[0]?.whatsappAppUrl || '', /^whatsapp:\/\/send\?phone=549/)
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
      await assert.rejects(
        () => service.transition({ executionId: execution.id, recipientId: 'recipient-1', businessId: 'business-1', sourceId: 'campaign-other', status: 'SENT' }),
        /ejecución manual/
      )
      assert.equal(deliveryRecorder.calls.length, 0)
      await service.transition({ executionId: execution.id, recipientId: 'recipient-1', businessId: 'business-1', sourceId: 'campaign-1', status: 'OPENED' })
      assert.equal(deliveryRecorder.calls.length, 0)
      await service.transition({ executionId: execution.id, recipientId: 'recipient-1', businessId: 'business-1', status: 'SENT' })
      assert.equal(deliveryRecorder.calls.length, 1)
      assert.equal(deliveryRecorder.calls[0]?.campaignId, 'campaign-1')
      assert.equal(repository.execution.status, 'COMPLETED')
      assert.equal(repository.fullExecutionReads, 0, 'cada cambio de estado debe evitar cargar toda la cola')
      assert.equal(repository.headerReads, 3, 'cada acción debe leer la cabecera una sola vez')
      assert.equal(repository.recipientReads, 3, 'cada acción debe leer el destinatario una sola vez')
    }
  }
]

class FakeCommunicationRepository implements CommunicationRepository {
  execution: any = null
  fullExecutionReads = 0
  headerReads = 0
  recipientReads = 0

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
    this.fullExecutionReads++
    return this.execution?.id === id ? this.execution : null
  }

  async findExecutionHeader(id: string) {
    this.headerReads++
    if (this.execution?.id !== id) return null
    const { recipients: _recipients, ...header } = this.execution
    return header
  }

  async hasPendingRecipients(executionId: string) {
    return this.execution?.id === executionId && this.execution.recipients.some((recipient: CommunicationRecipientRecord) => ['PENDING', 'OPENED'].includes(recipient.status))
  }

  async findRecipient(id: string): Promise<CommunicationRecipientRecord | null> {
    this.recipientReads++
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
