import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createOrLinkCustomerFromConversation,
  ConversationCustomerLinkError
} from '../src/services/conversation-customer-link-service.js'
import { canStaffAccessRoute, resolveStaffPermissions } from '../src/services/staff-permission-service.js'

const instagramLead = {
  id: 'lead-a',
  businessId: 'business-a',
  instagramUserId: 'ig-user-123',
  username: 'maria.color',
  displayName: 'María Color'
}

function instagramClient(input: { existing?: Record<string, unknown> | null; duplicateOnce?: boolean } = {}) {
  let created: Record<string, unknown> | null = null
  let identity: Record<string, unknown> | null = input.existing
    ? { id: 'identity-existing', businessId: 'business-a', customerId: input.existing.id, channel: 'INSTAGRAM', externalUserId: 'ig-user-123', customer: input.existing }
    : null
  let createCalls = 0
  const client = {
    instagramLead: {
      findFirst: async ({ where }: any) => where.id === instagramLead.id && where.businessId === instagramLead.businessId
        ? instagramLead
        : null
    },
    customerChannelIdentity: {
      findFirst: async ({ where }: any) => where.businessId === instagramLead.businessId &&
        where.channel === 'INSTAGRAM' && where.externalUserId === instagramLead.instagramUserId
        ? identity
        : null,
      create: async ({ data }: any) => {
        if (input.duplicateOnce && createCalls === 1) {
          const error = new Error('duplicate') as Error & { code: string }
          error.code = 'P2002'
          identity = { id: 'identity-raced', ...data, customer: created }
          throw error
        }
        identity = { id: 'identity-new', ...data, customer: created }
        return identity
      },
      upsert: async ({ create }: any) => {
        identity ||= { id: 'identity-healed', ...create, customer: input.existing ?? created }
        return identity
      }
    },
    customer: {
      findFirst: async ({ where }: any) => {
        if (where.businessId !== instagramLead.businessId || where.instagramUserId !== instagramLead.instagramUserId) return null
        return input.existing ?? created
      },
      create: async ({ data }: any) => {
        createCalls += 1
        created = { id: 'customer-new', ...data }
        return created
      },
      update: async ({ where, data }: any) => {
        created = { id: where.id, ...data }
        return created
      }
    },
    $transaction: async (operation: (transaction: any) => unknown) => operation(client),
    get createCalls() { return createCalls }
  }
  return client
}

const authorizedUser = { id: 'user-a', role: 'BUSINESS_ADMIN', businessId: 'business-a' } as any

const readOnlyStaff = {
  role: 'STAFF',
  businessId: 'business-a',
  ...resolveStaffPermissions({ staffProfile: 'SECRETARY', permissionPreset: 'SECRETARY_READ_ONLY' }).permissions
}
const standardStaff = {
  role: 'STAFF',
  businessId: 'business-a',
  ...resolveStaffPermissions({ staffProfile: 'SECRETARY', permissionPreset: 'SECRETARY_STANDARD' }).permissions
}
const createOnlyStaff = {
  role: 'STAFF',
  businessId: 'business-a',
  ...resolveStaffPermissions({
    staffProfile: 'SECRETARY',
    permissionPreset: 'CUSTOM',
    canViewCustomers: true,
    canCreateCustomers: true,
    canEditCustomers: false
  }).permissions
}
assert.equal(canStaffAccessRoute(readOnlyStaff, 'POST', '/customers/from-conversation'), false)
assert.equal(canStaffAccessRoute(createOnlyStaff, 'POST', '/customers/from-conversation'), false)
assert.equal(canStaffAccessRoute(standardStaff, 'POST', '/customers/from-conversation'), true)
assert.equal(canStaffAccessRoute(standardStaff, 'PATCH', '/customers/customer-a'), true)
assert.equal(canStaffAccessRoute(standardStaff, 'POST', '/customers/customer-a/notes'), true)

let whatsappCreateInput: Record<string, unknown> | null = null
const whatsappResult = await createOrLinkCustomerFromConversation({
  conversationId: 'conversation-wa',
  businessId: 'business-a',
  requestedName: 'Ana desde chat',
  email: 'ANA@EXAMPLE.COM',
  user: authorizedUser,
  client: {
    conversation: {
      findFirst: async () => ({
        id: 'conversation-wa', businessId: 'business-a', phone: '+54 9 11 4444-5555', selectedCustomerName: null
      })
    }
  } as any,
  phoneCustomerCreator: async (input: any) => {
    whatsappCreateInput = input
    return { customer: { id: 'customer-wa', ...input }, wasExisting: false, nameConflict: null, canonicalPhone: '5491144445555' }
  }
})
assert.equal(whatsappResult.customer.id, 'customer-wa')
assert.deepEqual(whatsappCreateInput, {
  businessId: 'business-a',
  name: 'Ana desde chat',
  phone: '+54 9 11 4444-5555',
  email: 'ANA@EXAMPLE.COM'
})

const firstClient = instagramClient()
const first = await createOrLinkCustomerFromConversation({
  conversationId: 'instagram:lead-a',
  businessId: 'business-a',
  requestedName: '',
  email: null,
  user: authorizedUser,
  client: firstClient as any
})
assert.equal(first.wasExisting, false)
assert.equal(first.customer.name, 'María Color')
assert.equal(first.customer.phone, '')
assert.equal(first.customer.normalizedPhone, null)
assert.equal(first.customer.instagramUserId, 'ig-user-123')
assert.equal(first.customer.instagramUsername, 'maria.color')
assert.equal(first.customer.channelIdentities[0].channel, 'INSTAGRAM')
assert.equal(first.customer.channelIdentities[0].externalUserId, 'ig-user-123')

let instagramPhoneInput: Record<string, unknown> | null = null
const phoneLinkedClient = instagramClient()
const phoneLinked = await createOrLinkCustomerFromConversation({
  conversationId: 'instagram:lead-a',
  businessId: 'business-a',
  requestedName: 'María Color',
  requestedPhone: '11 5555-7777',
  email: 'maria@example.com',
  user: authorizedUser,
  client: phoneLinkedClient as any,
  phoneCustomerCreator: async (input: any) => {
    instagramPhoneInput = input
    return {
      customer: { id: 'customer-by-phone', businessId: 'business-a', name: input.name, phone: '5491155557777' },
      wasExisting: true,
      nameConflict: null,
      canonicalPhone: '5491155557777'
    }
  }
})
assert.equal(phoneLinked.customer.id, 'customer-by-phone')
assert.equal(phoneLinked.customer.channelIdentities[0].externalUserId, 'ig-user-123')
assert.deepEqual(instagramPhoneInput, {
  businessId: 'business-a',
  name: 'María Color',
  phone: '11 5555-7777',
  email: 'maria@example.com'
})

const existing = { id: 'customer-existing', businessId: 'business-a', instagramUserId: 'ig-user-123', name: 'María' }
const repeatClient = instagramClient({ existing })
const repeated = await createOrLinkCustomerFromConversation({
  conversationId: 'instagram:lead-a',
  businessId: 'business-a',
  requestedName: 'No debe duplicar',
  user: authorizedUser,
  client: repeatClient as any
})
assert.equal(repeated.wasExisting, true)
assert.equal(repeated.customer.id, existing.id)
assert.equal(repeated.customer.channelIdentities[0].externalUserId, 'ig-user-123')
assert.equal(repeatClient.createCalls, 0)

const raceClient = instagramClient({ duplicateOnce: true })
const raced = await createOrLinkCustomerFromConversation({
  conversationId: 'instagram:lead-a',
  businessId: 'business-a',
  requestedName: '',
  user: authorizedUser,
  client: raceClient as any
})
assert.equal(raced.wasExisting, true)
assert.equal(raced.customer.id, 'customer-new')

await assert.rejects(
  createOrLinkCustomerFromConversation({
    conversationId: 'instagram:lead-a',
    businessId: 'business-b',
    requestedName: '',
    user: { ...authorizedUser, businessId: 'business-b' },
    client: instagramClient() as any
  }),
  (error: unknown) => error instanceof ConversationCustomerLinkError && error.code === 'NOT_FOUND'
)

const channelSource = await readFile(new URL('../src/services/conversation-channel-service.ts', import.meta.url), 'utf8')
assert.match(channelSource, /instagramUserId:\s*lead\.instagramUserId/)
assert.match(channelSource, /instagramUsername:\s*lead\.username/)
assert.match(channelSource, /phone:\s*''/)
assert.doesNotMatch(channelSource, /phone:\s*lead\.username\s*\?/)

const customerRouteSource = await readFile(new URL('../src/routes/customer.ts', import.meta.url), 'utf8')
assert.match(customerRouteSource, /app\.post\('\/customers\/from-conversation'/)
assert.match(customerRouteSource, /createOrLinkCustomerFromConversation/)
assert.match(customerRouteSource, /requestedPhone:\s*body\.phone/)
assert.match(customerRouteSource, /channelIdentities:\s*true/)

const schemaSource = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
assert.match(schemaSource, /model CustomerChannelIdentity/)
assert.match(schemaSource, /@@unique\(\[businessId, channel, externalUserId\]\)/)

const identityMigration = await readFile(new URL('../prisma/migrations/20260919143000_add_customer_channel_identity/migration.sql', import.meta.url), 'utf8')
assert.match(identityMigration, /CREATE TABLE "CustomerChannelIdentity"/)
assert.match(identityMigration, /INSERT INTO "CustomerChannelIdentity"/)
assert.match(identityMigration, /"instagramUserId" IS NOT NULL/)

const appointmentRouteSource = await readFile(new URL('../src/routes/appointment.ts', import.meta.url), 'utf8')
const appointmentServiceSource = await readFile(new URL('../src/services/appointment-service.ts', import.meta.url), 'utf8')
assert.match(appointmentRouteSource, /customerId\?: string/)
assert.match(appointmentRouteSource, /query\.customerId \? \{ customerId: query\.customerId \}/)
assert.match(appointmentServiceSource, /input\.customerId \? \{ customerId: input\.customerId \}/)

const crmUiSource = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
assert.match(crmUiSource, /function customerForConversation\(conversation\)/)
assert.match(crmUiSource, /customer\.channelIdentities/)
assert.match(crmUiSource, /customer \? 'Editar' : 'Agregar cliente'/)
assert.match(crmUiSource, /params\.set\('customerId', customer\.id\)/)
assert.match(crmUiSource, /\/customers\/from-conversation/)
assert.match(crmUiSource, /conversation\?\.channel === 'WHATSAPP'[\s\S]*conversation\?\.phone/)
assert.match(crmUiSource, /instagramUsername/)
const externalRenderer = crmUiSource.slice(
  crmUiSource.indexOf('function renderExternalChannelSelected'),
  crmUiSource.indexOf('async function loadConversationMarketingStatus')
)
assert.doesNotMatch(externalRenderer, /els\.customerEdit\.disabled = true/)
assert.doesNotMatch(externalRenderer, /state\.appointments\s*=\s*\[\]/)
assert.match(externalRenderer, /renderAppointments\(\)/)

const permissionSource = await readFile(new URL('../src/services/staff-permission-service.ts', import.meta.url), 'utf8')
assert.match(permissionSource, /path\.startsWith\('\/customers'\)[\s\S]*verb === 'POST'\) return user\.canCreateCustomers/)

console.log('conversation-customer-link-contract-test: OK')
