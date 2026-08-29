import type { PrismaClient } from '../../generated/prisma/client.js'
import {
  attestLegacyDispatchCoverage,
  recoverPausedDispatchScope,
  resumeDispatchScope,
  startActivationPreflight,
  type ActivationPreflightResult,
  type DispatchPauseHandle
} from '../infrastructure/prisma-activation.js'

type ActivationClient = Pick<PrismaClient, '$transaction'>

/**
 * Application boundary for F11.1. It deliberately does not expose activation,
 * rollback, pointer mutation, generation mutation, or any runtime toggle.
 */
export async function preflightExclusiveActivation(input: {
  client: ActivationClient
  businessId: string
  expectedGeneration: number
  actorId: string
  legacyCoverageComplete: boolean
  timeoutMs?: number
}): Promise<ActivationPreflightResult> {
  if (!input.legacyCoverageComplete) throw new Error('activation preflight blocked: legacy dispatch coverage incomplete')
  await attestLegacyDispatchCoverage({
    client: input.client,
    businessId: input.businessId,
    actorId: input.actorId,
    protocolVersion: 1
  })
  return startActivationPreflight(input)
}

/** Explicit abort path. Resume itself rechecks quiescence and refuses UNKNOWN. */
export async function abortExclusiveActivationPreflight(input: {
  client: ActivationClient
  handle: DispatchPauseHandle
  actorId: string
}): Promise<void> {
  await resumeDispatchScope(input)
}

/** Lets an authorized operator recover an interruption before F11.2 exists. */
export async function recoverExclusiveActivationPreflight(input: {
  client: ActivationClient
  businessId: string
  expectedGeneration: number
}): Promise<DispatchPauseHandle | null> {
  return recoverPausedDispatchScope(input)
}
