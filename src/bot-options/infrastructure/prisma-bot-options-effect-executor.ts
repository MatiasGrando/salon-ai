import type { Prisma } from '../../generated/prisma/client.js'
import { resolveBotOptionsConfig } from '../../config/bot-options.js'
import {
  confirmBookingWithoutDeposit,
  type ConfirmBookingWithoutDepositResult
} from '../../services/booking-operations.js'
import type { BotOptionsEffect } from '../domain/effects.js'
import { prismaHandoffEffectExecutor } from './prisma-handoff-effect-executor.js'

export type BotOptionsEffectExecutionResult =
  | { kind: 'APPLIED' }
  | ConfirmBookingWithoutDepositResult

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

  await prismaHandoffEffectExecutor(tx, input)
  return { kind: 'APPLIED' }
}
