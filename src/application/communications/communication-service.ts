import {
  assertCommunicationTransition,
  buildManualWhatsAppUrl,
  communicationTimestampField,
  isExecutionComplete,
  type CommunicationMode,
  type CommunicationPurpose,
  type CommunicationSourceType,
  type CommunicationStatus
} from '../../domain/communications/communication.js'

export type StartCommunicationExecutionInput = {
  businessId: string
  sourceType: CommunicationSourceType
  sourceId: string
  purpose: CommunicationPurpose
  mode: CommunicationMode
  initiatedByUserId?: string | null
  candidateCount: number
  excludedCount: number
  metadata?: Record<string, unknown>
  recipients: Array<{
    customerId: string
    customerName: string
    phone: string
    message: string
    metadata?: Record<string, unknown>
  }>
}

export type CommunicationRecipientRecord = {
  id: string
  executionId: string
  customerId: string
  status: string
  phoneSnapshot: string
  messageSnapshot: string
  sourceDeliveryId?: string | null
  customerNameSnapshot: string
  openedAt: Date | null
  sentAt: Date | null
  skipReason: string | null
  failureReason: string | null
}

export type CommunicationExecutionRecord = {
  id: string
  businessId: string
  sourceType: string
  sourceId: string
  purpose: string
  mode: string
  status: string
  candidateCount: number
  eligibleCount: number
  excludedCount: number
  metadata: unknown
  startedAt: Date
  completedAt: Date | null
  recipients: CommunicationRecipientRecord[]
}

export interface CommunicationRepository {
  createExecution(input: StartCommunicationExecutionInput): Promise<CommunicationExecutionRecord>
  findExecution(id: string): Promise<CommunicationExecutionRecord | null>
  findRecipient(id: string): Promise<CommunicationRecipientRecord | null>
  transitionRecipient(input: {
    recipientId: string
    fromStatus: string
    toStatus: CommunicationStatus
    timestampField: string | null
    actorType: 'USER' | 'SYSTEM'
    actorId?: string | null
    note?: string | null
    skipReason?: string | null
    failureReason?: string | null
    sourceDeliveryId?: string | null
  }): Promise<unknown>
  recipientStatuses(executionId: string): Promise<string[]>
  completeExecution(executionId: string): Promise<void>
}

export class CommunicationService {
  constructor(private readonly repository: CommunicationRepository) {}

  startExecution(input: StartCommunicationExecutionInput) {
    if (!input.businessId || !input.sourceId) throw new Error('Falta identificar el origen de la comunicación')
    if (!input.recipients.length) throw new Error('No hay destinatarios habilitados')
    const customerIds = new Set(input.recipients.map((recipient) => recipient.customerId))
    if (customerIds.size !== input.recipients.length) throw new Error('La ejecución contiene destinatarios duplicados')
    for (const recipient of input.recipients) buildManualWhatsAppUrl(recipient.phone, recipient.message)
    return this.repository.createExecution(input)
  }

  async getExecution(id: string, businessId: string) {
    const execution = await this.repository.findExecution(id)
    if (!execution || execution.businessId !== businessId) return null
    return execution
  }

  async transitionRecipient(input: {
    recipientId: string
    businessId: string
    status: CommunicationStatus
    actorId?: string | null
    note?: string | null
    skipReason?: string | null
    failureReason?: string | null
    sourceDeliveryId?: string | null
  }) {
    const recipient = await this.repository.findRecipient(input.recipientId)
    if (!recipient) throw new Error('No encontré ese destinatario')
    const execution = await this.repository.findExecution(recipient.executionId)
    if (!execution || execution.businessId !== input.businessId) throw new Error('No encontré esa ejecución')
    assertCommunicationTransition(recipient.status, input.status)
    const updated = await this.repository.transitionRecipient({
      recipientId: recipient.id,
      fromStatus: recipient.status,
      toStatus: input.status,
      timestampField: communicationTimestampField(input.status),
      actorType: input.actorId ? 'USER' : 'SYSTEM',
      actorId: input.actorId ?? null,
      note: input.note ?? null,
      skipReason: input.skipReason ?? null,
      failureReason: input.failureReason ?? null,
      sourceDeliveryId: input.sourceDeliveryId ?? null
    })
    const statuses = await this.repository.recipientStatuses(recipient.executionId)
    if (isExecutionComplete(statuses)) await this.repository.completeExecution(recipient.executionId)
    return updated
  }
}
