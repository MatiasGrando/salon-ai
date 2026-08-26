import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  admitProviderEvents,
  type AdmitProviderEventsInput
} from '../src/bot-options/application/admit-provider-events.js'
import {
  PrismaAdmissionRepository,
  type ShadowAdmissionRepository,
  type ShadowAdmissionTenant,
  type ShadowEventInsert
} from '../src/bot-options/infrastructure/prisma-admission.js'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const CURRENT_SECRET = 'current-secret'
const PREVIOUS_SECRET = 'previous-secret'

const payload = {
  object: 'whatsapp_business_account',
  entry: [{
    changes: [{
      value: {
        metadata: {
          phone_number_id: 'PN_TENANT_A',
          display_phone_number: '5491100000000'
        },
        messages: [{
          id: 'wamid.message-1',
          from: '5491144444444',
          timestamp: '1756080000',
          type: 'document',
          document: {
            id: 'private-media-id',
            mime_type: 'application/pdf',
            filename: 'private-name.pdf',
            caption: 'private text'
          }
        }],
        statuses: [{
          id: 'wamid.message-2',
          status: 'failed',
          timestamp: '1756080001',
          recipient_id: '5491155555555',
          errors: [{ message: 'private provider error' }]
        }]
      }
    }]
  }]
}

const rawBody = Buffer.from(JSON.stringify(payload), 'utf8')

function signature(secret: string, body = rawBody) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

function tenant(overrides: Partial<ShadowAdmissionTenant> = {}): ShadowAdmissionTenant {
  return {
    businessId: 'business-a',
    appSecret: CURRENT_SECRET,
    appSecretPrevious: PREVIOUS_SECRET,
    appSecretPreviousValidUntil: new Date(NOW.getTime() + 60_000),
    ...overrides
  }
}

class FakeRepository implements ShadowAdmissionRepository {
  readonly inserted: ShadowEventInsert[][] = []
  readonly keys = new Set<string>()
  lookupCount = 0
  forcedInsertCount: number | undefined

  constructor(readonly tenants: ShadowAdmissionTenant[]) {}

  async findConnectedTenantsByPhoneNumberId(phoneNumberId: string) {
    this.lookupCount += 1
    assert.equal(phoneNumberId, 'PN_TENANT_A')
    return this.tenants
  }

  async insertShadowEvents(events: ShadowEventInsert[]) {
    this.inserted.push(events)
    if (this.forcedInsertCount !== undefined) return this.forcedInsertCount

    let count = 0
    for (const event of events) {
      const key = `${event.provider}:${event.eventKey}`
      if (this.keys.has(key)) continue
      this.keys.add(key)
      count += 1
    }
    return count
  }
}

function input(secret: string, body = rawBody): AdmitProviderEventsInput {
  return {
    rawBody: body,
    signatureHeader: signature(secret, body),
    traceId: 'trace-1'
  }
}

async function admit(repository: ShadowAdmissionRepository, admissionInput: AdmitProviderEventsInput) {
  return admitProviderEvents(admissionInput, { repository, clock: () => NOW })
}

const currentRepository = new FakeRepository([tenant()])
assert.deepEqual(await admit(currentRepository, input(CURRENT_SECRET)), {
  status: 'admitted',
  eventCount: 2
})
assert.equal(currentRepository.inserted.length, 1)
assert.equal(currentRepository.inserted[0]?.every((event) => event.result === 'ADMITTED'), true)

const redacted = JSON.stringify(currentRepository.inserted[0]?.map((event) => event.payloadRedacted))
for (const forbidden of [
  '5491100000000',
  '5491144444444',
  '5491155555555',
  'private text',
  'private-name.pdf',
  'private-media-id',
  'private provider error'
]) {
  assert.equal(redacted.includes(forbidden), false, `redaction leaked ${forbidden}`)
}
assert.deepEqual(currentRepository.inserted[0]?.[0]?.payloadRedacted, {
  kind: 'message',
  messageType: 'document',
  hasInteractiveReply: false,
  mediaType: 'document',
  hasProviderTimestamp: true
})

assert.deepEqual(await admit(currentRepository, input(CURRENT_SECRET)), {
  status: 'duplicate',
  eventCount: 2
})

const previousRepository = new FakeRepository([tenant()])
assert.equal((await admit(previousRepository, input(PREVIOUS_SECRET))).status, 'admitted')

const boundaryRepository = new FakeRepository([tenant({ appSecretPreviousValidUntil: NOW })])
assert.equal((await admit(boundaryRepository, input(PREVIOUS_SECRET))).status, 'admitted')

const expiredRepository = new FakeRepository([
  tenant({ appSecretPreviousValidUntil: new Date(NOW.getTime() - 1) })
])
assert.deepEqual(await admit(expiredRepository, input(PREVIOUS_SECRET)), { status: 'invalid_signature' })
assert.equal(expiredRepository.inserted.length, 0)

const wrongTenantRepository = new FakeRepository([tenant({ appSecret: 'tenant-a-only' })])
assert.deepEqual(await admit(wrongTenantRepository, input('tenant-b-secret')), { status: 'invalid_signature' })
assert.equal(wrongTenantRepository.inserted.length, 0)

const missingSignatureRepository = new FakeRepository([tenant()])
assert.deepEqual(await admit(missingSignatureRepository, {
  rawBody,
  signatureHeader: undefined
}), { status: 'invalid_signature' })
assert.equal(missingSignatureRepository.inserted.length, 0)

const ambiguousRepository = new FakeRepository([tenant(), tenant({ businessId: 'business-b' })])
assert.deepEqual(await admit(ambiguousRepository, input(CURRENT_SECRET)), { status: 'ambiguous' })
assert.equal(ambiguousRepository.inserted.length, 0)

const unmatchedRepository = new FakeRepository([])
assert.deepEqual(await admit(unmatchedRepository, input(CURRENT_SECRET)), { status: 'unmatched' })
assert.equal(unmatchedRepository.inserted.length, 0)

const missingSecretRepository = new FakeRepository([
  tenant({ appSecret: ' ', appSecretPrevious: null, appSecretPreviousValidUntil: null })
])
assert.deepEqual(await admit(missingSecretRepository, input(CURRENT_SECRET)), { status: 'missing_secret' })
assert.equal(missingSecretRepository.inserted.length, 0)

const malformedRepository = new FakeRepository([tenant()])
const malformedBody = Buffer.from('{', 'utf8')
assert.deepEqual(await admit(malformedRepository, input(CURRENT_SECRET, malformedBody)), {
  status: 'malformed_payload'
})
assert.equal(malformedRepository.lookupCount, 0)
assert.equal(malformedRepository.inserted.length, 0)

const partialRepository = new FakeRepository([tenant()])
partialRepository.forcedInsertCount = 1
assert.deepEqual(await admit(partialRepository, input(CURRENT_SECRET)), {
  status: 'partial',
  eventCount: 2,
  insertedCount: 1
})

const repositoryCapabilities: Record<keyof ShadowAdmissionRepository, true> = {
  findConnectedTenantsByPhoneNumberId: true,
  insertShadowEvents: true
}
assert.deepEqual(Object.keys(repositoryCapabilities).sort(), [
  'findConnectedTenantsByPhoneNumberId',
  'insertShadowEvents'
])

let tenantQuery: unknown
let shadowCreate: unknown
const prismaRepository = new PrismaAdmissionRepository({
  businessWhatsAppConfig: {
    findMany: async (query: unknown) => {
      tenantQuery = query
      return [tenant()]
    }
  },
  botProviderEventShadow: {
    createMany: async (query: unknown) => {
      shadowCreate = query
      return { count: 1 }
    }
  }
} as unknown as ConstructorParameters<typeof PrismaAdmissionRepository>[0])

await prismaRepository.findConnectedTenantsByPhoneNumberId('PN_TENANT_A')
assert.deepEqual(tenantQuery, {
  where: { phoneNumberId: 'PN_TENANT_A', connectionStatus: 'CONNECTED' },
  select: {
    businessId: true,
    appSecret: true,
    appSecretPrevious: true,
    appSecretPreviousValidUntil: true
  },
  take: 2
})
await prismaRepository.insertShadowEvents(currentRepository.inserted[0]!)
assert.equal((shadowCreate as { skipDuplicates?: boolean }).skipDuplicates, true)
assert.equal('botProviderEvent' in prismaRepository, false)
assert.equal('botActionInbox' in prismaRepository, false)
assert.deepEqual(Object.keys(prismaRepository), [])
assert.deepEqual(
  Object.getOwnPropertyNames(Object.getPrototypeOf(prismaRepository))
    .filter((name) => name !== 'constructor')
    .sort(),
  ['findConnectedTenantsByPhoneNumberId', 'insertShadowEvents']
)

console.log('OK bot-options shadow admission: tenant isolation, rotation, idempotency and redaction satisfy the contract.')
