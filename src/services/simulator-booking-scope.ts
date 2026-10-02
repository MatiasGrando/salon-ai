import { createHash } from 'node:crypto'

// Namespace is a no-contact marker, never proof of permission to create a booking.
export const SIMULATOR_APPOINTMENT_PREFIX = 'simqa_appointment_'
export const SIMULATOR_CUSTOMER_PREFIX = 'simqa_customer_'
export const SIMULATOR_RECIPIENT_PREFIX = 'simqa:customer:'

export type SimulatorBookingIdentityInput = {
  businessId: string
  conversationId: string
  proposalRevision: string
  proposalFingerprint: string
}

export function createSimulatorBookingIdentity(input: SimulatorBookingIdentityInput) {
  for (const [key, limit] of [['businessId', 128], ['conversationId', 128], ['proposalRevision', 128], ['proposalFingerprint', 256]] as const) {
    const value = input[key]
    if (typeof value !== 'string' || !value || value.length > limit || value !== value.trim() || /[\u0000-\u001f]/u.test(value)) {
      throw new Error(`Invalid simulator booking ${key}`)
    }
  }
  const digest = (parts: readonly string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  const customerDigest = digest(['simulator-customer-v1', input.businessId, input.conversationId])
  return {
    appointmentId: SIMULATOR_APPOINTMENT_PREFIX + digest(['simulator-appointment-v1', input.businessId, input.conversationId, input.proposalRevision, input.proposalFingerprint]),
    customerId: SIMULATOR_CUSTOMER_PREFIX + customerDigest,
    customerPhone: SIMULATOR_RECIPIENT_PREFIX + customerDigest
  }
}

const hasReservedPrefix = (value: unknown, prefix: string) => typeof value === 'string' && value.trim().toLowerCase().startsWith(prefix)
export const isSimulatorAppointmentId = (value: unknown) => hasReservedPrefix(value, SIMULATOR_APPOINTMENT_PREFIX)
export const isSimulatorCustomerId = (value: unknown) => hasReservedPrefix(value, SIMULATOR_CUSTOMER_PREFIX)
export const isSimulatorRecipient = (value: unknown) => hasReservedPrefix(value, SIMULATOR_RECIPIENT_PREFIX)

export function isSimulatorBookingCommunication(input: { appointmentId?: unknown; customerId?: unknown; phone?: unknown }) {
  return isSimulatorAppointmentId(input.appointmentId) || isSimulatorCustomerId(input.customerId) || isSimulatorRecipient(input.phone)
}

// Query exclusion and the dispatch guard are both required: old pending rows may exist.
export function simulatorAppointmentCommunicationWhere() {
  return { NOT: [
    { id: { startsWith: SIMULATOR_APPOINTMENT_PREFIX, mode: 'insensitive' as const } },
    { customer: { id: { startsWith: SIMULATOR_CUSTOMER_PREFIX, mode: 'insensitive' as const } } },
    { customer: { phone: { startsWith: SIMULATOR_RECIPIENT_PREFIX, mode: 'insensitive' as const } } }
  ] }
}
