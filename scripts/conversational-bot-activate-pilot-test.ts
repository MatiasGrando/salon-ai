import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { activateBarberPilot, parsePilotArguments, type PilotClient, type PilotProtocol } from './conversational-bot-activate-pilot.js'
const marker = { schemaVersion: 1, engine: 'conversational-booking-v1' }
function fixture() {
  const business = { id: 'barber', customerCode: 'WX-38N6UG', botEnabled: true, aiEnabled: true }
  const source = { id: 'old', businessId: 'barber', botKey: 'deterministic-options', name: 'F11', version: 'v1', mode: 'OPTIONS_ONLY', status: 'ACTIVE', routingMode: 'EXCLUSIVE', channel: 'UNASSIGNED', phoneNumberId: 'phone', displayPhoneNumber: 'display', definition: { schemaVersion: 1, engineKey: 'deterministic-options' } }
  const pointer = { id: 'deployment', businessId: 'barber', engineKey: 'deterministic-options', activeConfigurationId: 'old', generation: 1, claimsPausedAt: null as Date | null, legacyDispatchCoverageVersion: 1, dispatchFenceEpoch: 2 }
  let target: typeof source | null = null
  const calls: string[] = []
  const handle = { businessId: 'barber', deploymentId: 'deployment', generation: 1, fenceEpoch: 2, pausedAt: new Date('2026-09-29T12:00:00Z') }
  const tx = {
    $executeRaw: async () => { calls.push('lock'); return 1 },
    business: { findUnique: async ({ where }: { where: { customerCode: string } }) => where.customerCode === business.customerCode ? structuredClone(business) : null },
    botChannelDeployment: { findUnique: async () => structuredClone(pointer) },
    businessBotConfiguration: {
      findFirst: async ({ where }: { where: { id: string; businessId: string } }) => where.businessId === source.businessId && where.id === source.id ? structuredClone(source) : target && where.businessId === target.businessId && where.id === target.id ? structuredClone(target) : null,
      findUnique: async () => target && structuredClone(target),
      create: async ({ data }: { data: Omit<typeof source, 'id'> }) => { calls.push('create'); target = { id: 'new', ...structuredClone(data) }; return structuredClone(target) }
    }
  }
  const client = { $transaction: async (fn: (arg: typeof tx) => unknown) => fn(tx) } as unknown as PilotClient
  const protocol: PilotProtocol = {
    assertReady: async () => { calls.push('ready') },
    preflight: async () => { calls.push('preflight'); pointer.claimsPausedAt = handle.pausedAt; return { kind: 'CLEAN', handle, snapshot: {} as never } },
    switch: async input => { calls.push('switch'); assert.deepEqual(input.handle, handle); assert.equal(input.targetConfigurationId, target!.id); pointer.activeConfigurationId = target!.id; pointer.generation++; pointer.claimsPausedAt = null; return { kind: 'SWITCHED', deploymentId: pointer.id, generation: pointer.generation, engineKey: 'deterministic-options', activeConfigurationId: target!.id, previousConfigurationId: 'old' } },
    recover: async () => { calls.push('recover'); return pointer.claimsPausedAt ? handle : null },
    abort: async () => { calls.push('abort'); pointer.claimsPausedAt = null }
  }
  const input = { client, protocol, apply: true, businessId: 'barber', sourceConfigurationId: 'old', expectedGeneration: 1, actorId: 'codex:authorized-2026-09-29', legacyCoverageComplete: true }
  return { business, source, pointer, calls, protocol, input, handle, get target() { return target }, set target(value) { target = value } }
}
assert.deepEqual(parsePilotArguments([]), { apply: false, loadEnv: false, legacyCoverageComplete: false })
assert.throws(() => parsePilotArguments(['--customer-code', 'other']), /unknown argument/)
assert.throws(() => parsePilotArguments(['--expected-generation', '1.2']), /generation/)
assert.throws(() => parsePilotArguments(['--apply']), /requires/)
{
  const f = fixture(); const result = await activateBarberPilot({ client: f.input.client, protocol: f.protocol })
  assert.equal(result.kind, 'INSPECT'); assert.equal(result.customerCode, 'WX-38N6UG'); assert.equal(f.target, null); assert.deepEqual(f.calls, ['lock'])
}
{
  const f = fixture(); const original = structuredClone(f.source)
  const activated = await activateBarberPilot(f.input); assert.equal(activated.kind, 'ACTIVATED'); assert.equal(activated.markerActive, true); assert.deepEqual(f.source, original)
  assert.deepEqual(f.target!.definition, { ...original.definition, conversation: marker }); assert.equal(f.target!.status, 'ACTIVE'); assert.equal(f.target!.routingMode, 'EXCLUSIVE'); assert.equal(f.target!.channel, 'UNASSIGNED')
  assert.equal(f.pointer.generation, 2); assert.equal(f.pointer.activeConfigurationId, 'new')
  assert.equal((await activateBarberPilot({ ...f.input, sourceConfigurationId: 'new', expectedGeneration: 2 })).kind, 'ALREADY_ACTIVE')
  assert.equal(f.calls.filter(x => x === 'preflight').length, 1)
}
for (const mutate of [
  (f: ReturnType<typeof fixture>) => { f.business.customerCode = 'other' },
  (f: ReturnType<typeof fixture>) => { f.business.id = 'other' },
  (f: ReturnType<typeof fixture>) => { f.business.botEnabled = false },
  (f: ReturnType<typeof fixture>) => { f.pointer.generation = 2 },
  (f: ReturnType<typeof fixture>) => { f.pointer.activeConfigurationId = 'other' },
  (f: ReturnType<typeof fixture>) => { f.pointer.engineKey = 'legacy-whatsapp' },
  (f: ReturnType<typeof fixture>) => { f.pointer.claimsPausedAt = new Date() },
  (f: ReturnType<typeof fixture>) => { f.pointer.legacyDispatchCoverageVersion = 0 },
  (f: ReturnType<typeof fixture>) => { f.source.status = 'DRAFT' },
  (f: ReturnType<typeof fixture>) => { f.source.routingMode = 'SHARED' },
  (f: ReturnType<typeof fixture>) => { f.source.definition = { conversation: { ...marker, extra: true } } as never }
]) { const f = fixture(); mutate(f); await assert.rejects(activateBarberPilot(f.input)); assert.equal(f.target, null); assert.ok(!f.calls.includes('preflight')) }
{
  const f = fixture(); f.target = { ...f.source, id: 'candidate', botKey: marker.engine, definition: { ...f.source.definition, conversation: marker } as never }; f.target.phoneNumberId = 'wrong'
  await assert.rejects(activateBarberPilot(f.input), /candidate/); assert.ok(!f.calls.includes('preflight'))
}
{
  const f = fixture(); f.protocol.assertReady = async () => { throw new Error('not wired') }; await assert.rejects(activateBarberPilot(f.input), /not wired/); assert.equal(f.target, null)
}
for (const reason of ['PROTECTED_STATE', 'QUIESCENCE_TIMEOUT', 'UNKNOWN'] as const) {
  const f = fixture(); f.protocol.preflight = async () => { f.calls.push('preflight'); f.pointer.claimsPausedAt = f.handle.pausedAt; return { kind: 'BLOCKED', handle: f.handle, snapshot: {} as never, reason } }
  assert.equal((await activateBarberPilot(f.input)).kind, 'BLOCKED'); assert.ok(!f.calls.includes('switch')); assert.equal(f.calls.includes('abort'), reason !== 'UNKNOWN'); assert.equal(Boolean(f.pointer.claimsPausedAt), reason === 'UNKNOWN')
}
{
  const f = fixture(); f.protocol.preflight = async () => { f.pointer.claimsPausedAt = f.handle.pausedAt; throw new Error('interrupted preflight') }
  await assert.rejects(activateBarberPilot(f.input), /interrupted preflight/); assert.ok(f.calls.includes('recover')); assert.ok(f.calls.includes('abort'))
}
{
  const f = fixture(); f.protocol.switch = async () => { throw new Error('protected state raced') }; f.protocol.abort = async () => { f.calls.push('abort'); throw new Error('BLOCKED_UNKNOWN') }
  await assert.rejects(activateBarberPilot(f.input), /manual recovery/); assert.ok(f.pointer.claimsPausedAt); assert.equal(f.pointer.generation, 1)
}
{
  const f = fixture(); const original = f.protocol.preflight; f.protocol.preflight = async input => { const result = await original(input); f.pointer.generation++; return result }
  await assert.rejects(activateBarberPilot(f.input), /generation|manual recovery/); assert.ok(!f.calls.includes('switch'))
}
{
  const f = fixture(); const original = f.protocol.preflight
  f.protocol.preflight = async input => { const result = await original(input); f.target!.definition = { conversation: { ...marker, extra: true } } as never; return result }
  await assert.rejects(activateBarberPilot(f.input), /candidate/); assert.ok(!f.calls.includes('switch'))
}
const text = readFileSync(new URL('./conversational-bot-activate-pilot.ts', import.meta.url), 'utf8')
assert.ok(!text.includes("import 'dotenv/config'")); assert.ok(!text.includes('config/prisma.js')); assert.ok(text.includes('DATABASE_URL')); assert.ok(text.includes('import.meta.url'))
console.log('conversational Barber pilot activation offline: PASS')
