import { Prisma } from '../../generated/prisma/client.js'
import { resolveBotOptionsConfig } from '../../config/bot-options.js'
import {
  confirmBookingWithoutDeposit,
  type ConfirmBookingWithoutDepositResult
} from '../../services/booking-operations.js'
import type { BotOptionsEffect } from '../domain/effects.js'
import { prismaHandoffEffectExecutor } from './prisma-handoff-effect-executor.js'
import {
  cancelManageableAppointmentInTransaction,
  rescheduleManageableAppointmentInTransaction
} from '../application/appointment-management.js'
import { normalizePhone } from '../../services/phone-normalization-service.js'
import type { ConversationUpdatedEvent } from '../../services/crm-realtime-events.js'

export type AppointmentManagementEffectExecutionResult =
  | { kind: 'APPOINTMENT_CANCELLED'; appointmentId: string }
  | { kind: 'APPOINTMENT_RESCHEDULED'; appointmentId: string; newStartAt: string }
  | { kind: 'APPOINTMENT_SLOT_CONFLICT'; appointmentId: string }
  | { kind: 'APPOINTMENT_HANDOFF'; appointmentId: string }
  | { kind: 'APPOINTMENT_STALE'; appointmentId: string }

export type BotOptionsEffectExecutionResult =
  | { kind: 'APPLIED' }
  | ConfirmBookingWithoutDepositResult
  | AppointmentManagementEffectExecutionResult

/**
 * Executor compuesto del runtime. CONFIRM_VISIT mantiene su resultado tipado
 * para que el caller pueda persistir una recuperación de slot sin residuos.
 */
export async function prismaBotOptionsEffectExecutor(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string
    sessionId: string
    operationKey: string
    effects: readonly BotOptionsEffect[]
    pendingConversationUpdates?: Array<Omit<ConversationUpdatedEvent, 'type'>>
  }
): Promise<BotOptionsEffectExecutionResult> {
  const bookingEffects = input.effects.filter((effect) => effect.kind === 'CONFIRM_VISIT')
  if (bookingEffects.length > 0) {
    if (input.effects.length !== 1 || bookingEffects.length !== 1) {
      throw new Error('CONFIRM_VISIT must be the only transition effect')
    }
    const effect = bookingEffects[0]!
    return confirmBookingWithoutDeposit(tx, {
      businessId: input.businessId,
      sessionId: input.sessionId,
      operationKey: input.operationKey,
      newBookingAllowed: resolveBotOptionsConfig(process.env).bookingCapabilityEnabled,
      services: effect.services,
      professional: effect.professional,
      date: effect.date,
      slotStartAt: effect.slotStartAt,
      totalDurationMinutes: effect.totalDurationMinutes,
      totalPriceMinor: effect.totalPriceMinor
    })
  }

  const appointmentEffects = input.effects.filter((effect) => effect.kind === 'CANCEL_BOOKING' || effect.kind === 'SWAP_APPOINTMENT_SLOT')
  if (appointmentEffects.length > 0) {
    if (input.effects.length !== 1 || appointmentEffects.length !== 1) {
      throw new Error('appointment management effect must be the only transition effect')
    }
    const identity = await tx.$queryRaw<Array<{ phone: string }>>(Prisma.sql`
      SELECT c."phone" FROM "BotSession" s
      JOIN "Conversation" c ON c."id" = s."conversationId" AND c."businessId" = s."businessId"
      WHERE s."id" = ${input.sessionId} AND s."businessId" = ${input.businessId}
      FOR UPDATE OF s
    `)
    const normalizedPhone = identity[0]?.phone ? normalizePhone(identity[0].phone) : ''
    if (!normalizedPhone) throw new Error('appointment management identity is unavailable in tenant')
    const effect = appointmentEffects[0]!
    if (effect.kind === 'CANCEL_BOOKING') {
      const result = await cancelManageableAppointmentInTransaction(tx, {
        businessId: input.businessId, normalizedPhone, sessionId: input.sessionId,
        appointmentId: effect.appointmentId, operationKey: input.operationKey, confirmed: true
      })
      if (result.outcome === 'CANCELLED') return { kind: 'APPOINTMENT_CANCELLED', appointmentId: effect.appointmentId }
      return result.outcome === 'HANDOFF'
        ? { kind: 'APPOINTMENT_HANDOFF', appointmentId: effect.appointmentId }
        : { kind: 'APPOINTMENT_STALE', appointmentId: effect.appointmentId }
    }
    const result = await rescheduleManageableAppointmentInTransaction(tx, {
      businessId: input.businessId, normalizedPhone, sessionId: input.sessionId,
      appointmentId: effect.appointmentId, operationKey: input.operationKey,
      actor: `bot-session:${input.sessionId}`, confirmed: true, newStartAt: effect.newSlotStartAt
    })
    if (result.outcome === 'RESCHEDULED') {
      return { kind: 'APPOINTMENT_RESCHEDULED', appointmentId: effect.appointmentId, newStartAt: result.newStartAt }
    }
    if (result.outcome === 'SLOT_CONFLICT') return { kind: 'APPOINTMENT_SLOT_CONFLICT', appointmentId: effect.appointmentId }
    return result.outcome === 'HANDOFF'
      ? { kind: 'APPOINTMENT_HANDOFF', appointmentId: effect.appointmentId }
      : { kind: 'APPOINTMENT_STALE', appointmentId: effect.appointmentId }
  }

  await prismaHandoffEffectExecutor(tx, input)
  return { kind: 'APPLIED' }
}
