import { assertCommunicationTransition, type CommunicationStatus } from '../../domain/communications/communication.js'
import { CommunicationService, type StartCommunicationExecutionInput } from '../communications/communication-service.js'

export interface CampaignDeliveryRecorder {
  recordManualSent(input: { businessId: string; campaignId: string; customerId: string; sentAt: Date }): Promise<{ id: string }>
}

export class ManualCampaignCommunicationService {
  constructor(
    private readonly communications: CommunicationService,
    private readonly deliveries: CampaignDeliveryRecorder
  ) {}

  start(input: Omit<StartCommunicationExecutionInput, 'sourceType' | 'purpose' | 'mode'>) {
    return this.communications.startExecution({
      ...input,
      sourceType: 'CAMPAIGN',
      purpose: 'PROMOTIONAL',
      mode: 'WHATSAPP_MANUAL'
    })
  }

  async transition(input: {
    executionId: string
    recipientId: string
    businessId: string
    status: CommunicationStatus
    actorId?: string | null
    note?: string | null
    skipReason?: string | null
  }) {
    const execution = await this.communications.getExecution(input.executionId, input.businessId)
    if (!execution || execution.sourceType !== 'CAMPAIGN' || execution.mode !== 'WHATSAPP_MANUAL') {
      throw new Error('No encontré esa ejecución manual')
    }
    const recipient = execution.recipients.find((item: { id: string }) => item.id === input.recipientId)
    if (!recipient) throw new Error('El destinatario no pertenece a esa ejecución')
    assertCommunicationTransition(recipient.status, input.status)

    let sourceDeliveryId = recipient.sourceDeliveryId as string | null
    if (input.status === 'SENT' && !sourceDeliveryId) {
      const delivery = await this.deliveries.recordManualSent({
        businessId: input.businessId,
        campaignId: execution.sourceId,
        customerId: recipient.customerId,
        sentAt: new Date()
      })
      sourceDeliveryId = delivery.id
    }

    return this.communications.transitionRecipient({
      recipientId: input.recipientId,
      businessId: input.businessId,
      status: input.status,
      actorId: input.actorId ?? null,
      note: input.note ?? null,
      skipReason: input.skipReason ?? null,
      sourceDeliveryId
    })
  }
}
