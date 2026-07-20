import { buildManualWhatsAppUrl } from '../../domain/communications/communication.js'
import type { CommunicationExecutionRecord } from '../../application/communications/communication-service.js'

export function toManualCommunicationExecutionViewModel(execution: CommunicationExecutionRecord) {
  const counts = execution.recipients.reduce<Record<string, number>>((result, recipient) => {
    result[recipient.status] = (result[recipient.status] || 0) + 1
    return result
  }, {})
  return {
    id: execution.id,
    businessId: execution.businessId,
    sourceType: execution.sourceType,
    sourceId: execution.sourceId,
    purpose: execution.purpose,
    mode: execution.mode,
    status: execution.status,
    candidateCount: execution.candidateCount,
    eligibleCount: execution.eligibleCount,
    excludedCount: execution.excludedCount,
    metadata: execution.metadata,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    counts,
    completedCount: execution.recipients.filter((recipient) => !['PENDING', 'OPENED'].includes(recipient.status)).length,
    recipients: execution.recipients.map((recipient) => ({
      id: recipient.id,
      customerId: recipient.customerId,
      customerName: recipient.customerNameSnapshot,
      phone: recipient.phoneSnapshot,
      message: recipient.messageSnapshot,
      whatsappUrl: buildManualWhatsAppUrl(recipient.phoneSnapshot, recipient.messageSnapshot),
      status: recipient.status,
      openedAt: recipient.openedAt,
      sentAt: recipient.sentAt,
      skipReason: recipient.skipReason,
      failureReason: recipient.failureReason,
      sourceDeliveryId: recipient.sourceDeliveryId
    }))
  }
}
