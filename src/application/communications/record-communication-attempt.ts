import type { CommunicationMode, CommunicationPurpose, CommunicationSourceType } from '../../domain/communications/communication.js'

export type RecordCommunicationAttemptInput = {
  businessId: string
  customerId: string
  customerName: string
  phone: string
  message: string
  sourceType: CommunicationSourceType
  sourceId: string
  sourceDeliveryId: string
  purpose: CommunicationPurpose
  mode: CommunicationMode
  status: 'SENT' | 'FAILED'
  providerMessageId?: string | null
  failureReason?: string | null
  occurredAt: Date
  metadata?: Record<string, unknown>
}

export interface CommunicationAttemptRepository {
  record(input: RecordCommunicationAttemptInput): Promise<void>
}

export class RecordCommunicationAttempt {
  constructor(private readonly repository: CommunicationAttemptRepository) {}

  execute(input: RecordCommunicationAttemptInput) {
    if (!input.sourceDeliveryId) throw new Error('Falta vincular el envío de origen')
    if (!input.message.trim()) throw new Error('No se puede registrar una comunicación sin mensaje')
    return this.repository.record(input)
  }
}
