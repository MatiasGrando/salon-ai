import type { PrismaClient } from '../../generated/prisma/client.js'
import {
  attestLegacyDispatchCoverage,
  assertActivatableConfiguration,
  recoverPausedDispatchScope,
  resumeDispatchScope,
  startActivationPreflight,
  switchPausedRouting,
  type ActivationPreflightResult,
  type DispatchPauseHandle,
  type RoutingSwitchResult
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

export type ExclusiveRoutingResult = ActivationPreflightResult | RoutingSwitchResult

export async function activateExclusiveConfiguration(input: {
  client: ActivationClient
  businessId: string
  expectedGeneration: number
  configurationId: string
  actorId: string
  legacyCoverageComplete: boolean
  timeoutMs?: number
}): Promise<ExclusiveRoutingResult> {
  await assertActivatableConfiguration(input)
  const preflight = await preflightExclusiveActivation(input)
  if (preflight.kind !== 'CLEAN') return preflight
  return switchPausedRouting({
    client: input.client,
    handle: preflight.handle,
    actorId: input.actorId,
    action: 'ACTIVATE',
    targetConfigurationId: input.configurationId
  })
}

export async function rollbackExclusiveConfiguration(input: {
  client: ActivationClient
  businessId: string
  expectedGeneration: number
  actorId: string
  legacyCoverageComplete: boolean
  timeoutMs?: number
}): Promise<ExclusiveRoutingResult> {
  const preflight = await preflightExclusiveActivation(input)
  if (preflight.kind !== 'CLEAN') return preflight
  return switchPausedRouting({
    client: input.client,
    handle: preflight.handle,
    actorId: input.actorId,
    action: 'ROLLBACK',
    targetConfigurationId: null
  })
}
