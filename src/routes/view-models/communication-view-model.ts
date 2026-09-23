import { buildManualWhatsAppUrl } from '../../domain/communications/communication.js'
import type { CommunicationExecutionRecord, CommunicationRecipientRecord } from '../../application/communications/communication-service.js'

export function toManualCommunicationExecutionSummary(
  execution: Pick<CommunicationExecutionRecord, 'id' | 'businessId' | 'sourceType' | 'sourceId' | 'purpose' | 'mode' | 'status' | 'candidateCount' | 'eligibleCount' | 'excludedCount' | 'metadata' | 'startedAt' | 'completedAt'>,
  statusCounts: Array<{ status: string; count: number }>,
  current: CommunicationRecipientRecord | null
) {
  const counts = Object.fromEntries(statusCounts.map((row) => [row.status, row.count]))
  return {
    ...execution,
    counts,
    completedCount: execution.eligibleCount - (counts.PENDING || 0) - (counts.OPENED || 0),
    recipients: current ? [{
      id: current.id,
      customerId: current.customerId,
      recipientKey: current.recipientKey,
      customerName: current.customerNameSnapshot,
      phone: current.phoneSnapshot,
      message: current.messageSnapshot,
      whatsappUrl: buildManualWhatsAppUrl(current.phoneSnapshot, current.messageSnapshot),
      status: current.status,
      openedAt: current.openedAt,
      sentAt: current.sentAt,
      skipReason: current.skipReason,
      failureReason: current.failureReason,
      sourceDeliveryId: current.sourceDeliveryId,
      metadata: current.metadata
    }] : []
  }
}
