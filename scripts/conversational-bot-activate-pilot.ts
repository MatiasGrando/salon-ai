import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js'
import { resolveConversationPolicy } from '../src/conversational-bot/runtime-policy.js'
import { preflightExclusiveActivation, abortExclusiveActivationPreflight, recoverExclusiveActivationPreflight } from '../src/bot-options/application/activation-operations.js'
import { assertActivatableConfiguration, switchPausedRouting, type DispatchPauseHandle } from '../src/bot-options/infrastructure/prisma-activation.js'

export type PilotClient = Pick<PrismaClient, '$transaction'>
export type PilotProtocol = {
  assertReady: typeof assertActivatableConfiguration
  preflight: typeof preflightExclusiveActivation
  switch: typeof switchPausedRouting
  recover: typeof recoverExclusiveActivationPreflight
  abort: typeof abortExclusiveActivationPreflight
}
const protocol: PilotProtocol = { assertReady: assertActivatableConfiguration, preflight: preflightExclusiveActivation, switch: switchPausedRouting, recover: recoverExclusiveActivationPreflight, abort: abortExclusiveActivationPreflight }
const customerCode = 'WX-38N6UG'
const marker = { schemaVersion: 1, engine: 'conversational-booking-v1' } as const
export type PilotOptions = { apply?: boolean; businessId?: string; sourceConfigurationId?: string; expectedGeneration?: number; actorId?: string; legacyCoverageComplete?: boolean }
const configSelect = { id: true, businessId: true, botKey: true, name: true, version: true, mode: true, status: true, channel: true, routingMode: true, phoneNumberId: true, displayPhoneNumber: true, definition: true } as const
function objectDefinition(value: unknown): Record<string, Prisma.InputJsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('source definition must be an object')
  return value as Record<string, Prisma.InputJsonValue>
}
function sameJson(a: unknown, b: unknown): boolean {
  function ordered(value: unknown): unknown { return Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, ordered(value)])) : value }
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b))
}
function assertApply(options: PilotOptions): void {
  if (!options.businessId?.trim() || !options.sourceConfigurationId?.trim() || !options.actorId?.trim() || !Number.isSafeInteger(options.expectedGeneration) || options.expectedGeneration! < 1 || options.legacyCoverageComplete !== true) throw new Error('apply requires business-id, source-config-id, expected-generation, actor-id and legacy-coverage-complete')
}
async function read(client: PilotClient, options: PilotOptions, pausedHandle?: DispatchPauseHandle, prepare = false) {
  return client.$transaction(async tx => {
    if (!prepare && !pausedHandle) await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`)
    if (prepare) await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bot-cutover:${options.businessId}:WHATSAPP`}, 0))`)
    const business = await tx.business.findUnique({ where: { customerCode }, select: { id: true, customerCode: true, botEnabled: true, aiEnabled: true } })
    if (!business || business.customerCode !== customerCode || (options.businessId !== undefined && business.id !== options.businessId)) throw new Error('pilot business scope mismatch')
    const pointer = await tx.botChannelDeployment.findUnique({ where: { businessId_channel: { businessId: business.id, channel: 'WHATSAPP' } }, select: { id: true, businessId: true, engineKey: true, activeConfigurationId: true, generation: true, claimsPausedAt: true, legacyDispatchCoverageVersion: true, dispatchFenceEpoch: true } })
    if (!pointer || pointer.businessId !== business.id || pointer.engineKey !== 'deterministic-options' || !pointer.activeConfigurationId || pointer.generation < 1) throw new Error('unsupported pilot pointer')
    if (options.expectedGeneration !== undefined && pointer.generation !== options.expectedGeneration) throw new Error('pilot generation changed')
    if (options.sourceConfigurationId !== undefined && pointer.activeConfigurationId !== options.sourceConfigurationId) throw new Error('pilot source pointer changed')
    if (pausedHandle ? pointer.id !== pausedHandle.deploymentId || pointer.generation !== pausedHandle.generation || pointer.dispatchFenceEpoch !== pausedHandle.fenceEpoch || pointer.claimsPausedAt?.getTime() !== pausedHandle.pausedAt.getTime() : pointer.claimsPausedAt !== null) throw new Error('pilot pause fence mismatch; manual recovery required')
    if (prepare) await tx.$executeRaw(Prisma.sql`SELECT "id" FROM "BusinessBotConfiguration" WHERE "businessId"=${business.id} AND "id"=${pointer.activeConfigurationId} FOR SHARE`)
    const source = await tx.businessBotConfiguration.findFirst({ where: { id: pointer.activeConfigurationId, businessId: business.id }, select: configSelect })
    if (!source || source.businessId !== business.id || source.status !== 'ACTIVE' || source.routingMode !== 'EXCLUSIVE' || !source.phoneNumberId || !source.displayPhoneNumber) throw new Error('pilot source is not fully prepared')
    const definition = objectDefinition(source.definition)
    const alreadyActive = resolveConversationPolicy({ businessId: business.id, deploymentId: pointer.id, generation: pointer.generation, configurationId: source.id, configurationBusinessId: source.businessId, configurationStatus: source.status, engineKey: pointer.engineKey, customerCode, definition }) !== null
    if (options.apply && (!business.botEnabled || pointer.legacyDispatchCoverageVersion < 1)) throw new Error('pilot disabled or legacy coverage not attested')
    if (!prepare || alreadyActive) return { business, pointer, source, alreadyActive, targetId: null }
    const data = { businessId: business.id, botKey: marker.engine, name: 'Bot conversacional IA · Barber Demo', version: source.version, mode: source.mode, status: 'ACTIVE', channel: 'UNASSIGNED', routingMode: 'EXCLUSIVE', phoneNumberId: source.phoneNumberId, displayPhoneNumber: source.displayPhoneNumber, definition: { ...definition, conversation: marker } }
    await tx.$executeRaw(Prisma.sql`SELECT "id" FROM "BusinessBotConfiguration" WHERE "businessId"=${business.id} AND "botKey"=${marker.engine} FOR SHARE`)
    const candidate = await tx.businessBotConfiguration.findUnique({ where: { businessId_botKey: { businessId: business.id, botKey: marker.engine } }, select: configSelect })
    if (candidate && (!Object.entries(data).every(([key, value]) => sameJson(candidate[key as keyof typeof candidate], value)) || candidate.id === source.id)) throw new Error('existing pilot candidate differs from strict copy')
    const target = candidate ?? await tx.businessBotConfiguration.create({ data, select: configSelect })
    return { business, pointer, source, alreadyActive, targetId: target.id }
  })
}
/** Offline-injectable operator. No env loading, connection creation or remote IO on import. */
export async function activateBarberPilot(input: PilotOptions & { client: PilotClient; protocol?: PilotProtocol }) {
  const ops = input.protocol ?? protocol
  if (input.apply) assertApply(input)
  const initial = await read(input.client, input)
  if (input.apply) await ops.assertReady({ client: input.client, businessId: initial.business.id, configurationId: initial.source.id })
  const summary = { customerCode, businessId: initial.business.id, deploymentId: initial.pointer.id, generation: initial.pointer.generation, configurationId: initial.source.id, legacyDispatchCoverageVersion: initial.pointer.legacyDispatchCoverageVersion, botEnabled: initial.business.botEnabled, aiEnabled: initial.business.aiEnabled, markerActive: initial.alreadyActive, readinessChecked: Boolean(input.apply) }
  if (!input.apply) return { kind: 'INSPECT' as const, ...summary }
  if (initial.alreadyActive) return { kind: 'ALREADY_ACTIVE' as const, ...summary }
  const prepared = await read(input.client, input, undefined, true)
  if (prepared.alreadyActive) return { kind: 'ALREADY_ACTIVE' as const, ...summary }
  const activation = { client: input.client, businessId: prepared.business.id, expectedGeneration: prepared.pointer.generation, actorId: input.actorId!, legacyCoverageComplete: true }
  let handle: DispatchPauseHandle | undefined
  let recoveryAttempted = false
  try {
    await ops.assertReady({ client: input.client, businessId: prepared.business.id, configurationId: prepared.targetId! })
    const result = await ops.preflight(activation)
    handle = result.handle
    if (result.kind === 'BLOCKED') {
      if (result.reason !== 'UNKNOWN') { recoveryAttempted = true; await ops.abort({ client: input.client, handle, actorId: input.actorId! }) }
      return { kind: 'BLOCKED' as const, ...summary, reason: result.reason, paused: result.reason === 'UNKNOWN' }
    }
    const switched = await input.client.$transaction(async tx => {
      // Reuse the native final switch in this transaction: copy validation and
      // row locks must remain authoritative until the pointer/generation commit.
      const scoped = { $transaction: (fn: (transaction: Prisma.TransactionClient) => Promise<unknown>) => fn(tx) } as unknown as PilotClient
      const checked = await read(scoped, input, handle!, true)
      if (checked.targetId !== prepared.targetId) throw new Error('pilot candidate changed')
      await ops.assertReady({ client: scoped, businessId: prepared.business.id, configurationId: checked.targetId! })
      return ops.switch({ client: scoped, handle: handle!, actorId: input.actorId!, action: 'ACTIVATE', targetConfigurationId: checked.targetId! })
    })
    return { kind: 'ACTIVATED' as const, ...summary, markerActive: switched.activeConfigurationId === prepared.targetId && switched.generation === prepared.pointer.generation + 1, configurationId: switched.activeConfigurationId, previousConfigurationId: switched.previousConfigurationId, generation: switched.generation }
  } catch (error) {
    if (recoveryAttempted) throw new Error('pilot abort refused; manual recovery required', { cause: error })
    try {
      handle ??= (await ops.recover(activation)) ?? undefined
      if (handle) await ops.abort({ client: input.client, handle, actorId: input.actorId! })
    } catch (recovery) { throw new Error('pilot failed; fenced pause may remain; manual recovery required', { cause: new AggregateError([error, recovery]) }) }
    throw error
  }
}
export function parsePilotArguments(args: string[]) {
  const result: PilotOptions & { apply: boolean; loadEnv: boolean; legacyCoverageComplete: boolean } = { apply: false, loadEnv: false, legacyCoverageComplete: false }
  const values = { '--business-id': 'businessId', '--source-config-id': 'sourceConfigurationId', '--actor-id': 'actorId' } as const
  const seen = new Set<string>()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (seen.has(arg)) throw new Error('duplicate argument'); seen.add(arg)
    if (arg === '--apply') result.apply = true
    else if (arg === '--load-env') result.loadEnv = true
    else if (arg === '--legacy-coverage-complete') result.legacyCoverageComplete = true
    else if (arg === '--expected-generation') { const value = args[++i]; if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('invalid generation'); result.expectedGeneration = Number(value) }
    else if (Object.hasOwn(values, arg)) { const value = args[++i]; if (!value?.trim() || value.startsWith('--')) throw new Error('missing argument value'); result[values[arg as keyof typeof values]] = value }
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (result.apply) assertApply(result)
  return result
}
async function main() {
  const args = parsePilotArguments(process.argv.slice(2))
  if (args.loadEnv) (await import('dotenv')).config({ quiet: true })
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')
  if (args.apply && process.env.BOT_OPTIONS_LEGACY_DISPATCH_COVERAGE_COMPLETE !== 'true') throw new Error('deployed legacy dispatch coverage flag must be true')
  const { createPrismaClient } = await import('../src/config/prisma-client.js')
  const client = createPrismaClient({ connectionString, max: 2, idleTimeoutMillis: 1000, connectionTimeoutMillis: 10000 })
  try { const result = await activateBarberPilot({ ...args, client }); console.log(JSON.stringify(result)); if (result.kind === 'BLOCKED') process.exitCode = 2 } finally { await client.$disconnect() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Pilot operation failed. No credentials or SQL are printed. Inspect the exact deployment and use F11 recovery before retrying.'); process.exitCode = 1 })
}
