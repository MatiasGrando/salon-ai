import assert from 'node:assert/strict'
import { PrismaPg } from '@prisma/adapter-pg'
import Fastify from 'fastify'
import { PrismaClient } from '../src/generated/prisma/client.js'
import {
  businessAuthorizationFixture,
  businessAuthorizationFixtureCookie,
  cleanBusinessAuthorizationFixtures,
  createBusinessAuthorizationFixtures
} from './business-authorization-fixtures.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
assert.ok(testDatabaseUrl, 'TEST_DATABASE_URL is required')

const parsedTestDatabaseUrl = new URL(testDatabaseUrl)
assert.equal(parsedTestDatabaseUrl.protocol, 'postgresql:', 'TEST_DATABASE_URL must use PostgreSQL')
assert.equal(parsedTestDatabaseUrl.hostname, '127.0.0.1', 'TEST_DATABASE_URL must use the approved loopback host')
assert.equal(parsedTestDatabaseUrl.port, '54322', 'TEST_DATABASE_URL must use the approved local port')
assert.equal(parsedTestDatabaseUrl.pathname, '/salon_ai_test', 'Refusing any database except salon_ai_test')

process.env.DATABASE_URL = testDatabaseUrl
process.env.NODE_ENV = 'test'

const [{ buildApp }, { createAuthorizationProviderFakes }] = await Promise.all([
  import('../src/server.js'),
  import('../src/providers/authorization-provider-fakes.js')
])

assert.equal(typeof buildApp, 'function', 'src/server.ts must export buildApp')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) })
const originalFetch = globalThis.fetch
const originalQaBusinessId = process.env.QA_BUSINESS_ID

try {
  await createBusinessAuthorizationFixtures(prisma)

  const businesses = await prisma.business.findMany({
    where: { id: { in: [...businessAuthorizationFixture.businessIds] } },
    orderBy: { id: 'asc' },
    select: { id: true }
  })
  assert.deepEqual(
    businesses.map(({ id }) => id),
    [...businessAuthorizationFixture.businessIds]
  )

  const providerFakes = createAuthorizationProviderFakes()
  const app = await buildApp({
    authorizationProviders: providerFakes.providers,
    clock: businessAuthorizationFixture.createClock()
  })

  try {
    await app.ready()
    assert.equal(app.authorizationProviders, providerFakes.providers)
    assert.equal(app.clock().toISOString(), businessAuthorizationFixture.fixedNow.toISOString())
    assert.deepEqual(Object.fromEntries(
      Object.entries(providerFakes.calls).map(([provider, calls]) => [provider, calls.length])
    ), {
      whatsapp: 0,
      media: 0,
      email: 0,
      calendar: 0
    })

    const currentAdminOwnResponse = await app.inject({
      method: 'GET',
      url: `/businesses/${businessAuthorizationFixture.businessIds[0]}/payment-settings`,
      headers: { cookie: businessAuthorizationFixtureCookie('currentAccountAdmin') }
    })
    assert.equal(
      currentAdminOwnResponse.statusCode,
      200,
      'current ACCOUNT_ADMIN must access an assigned business'
    )
    const routeScopeCases = [
      { name: 'SUPER_ADMIN reaches the other tenant', user: 'superAdmin', businessId: businessAuthorizationFixture.businessIds[1], statusCode: 200 },
      { name: 'ACCOUNT_ADMIN enters a shared commercial demo workspace', user: 'currentAccountAdmin', businessId: businessAuthorizationFixture.businessIds[1], statusCode: 200 },
      { name: 'createdBy gives former ACCOUNT_ADMIN no access', user: 'formerAccountAdmin', businessId: businessAuthorizationFixture.businessIds[0], statusCode: 403 },
      { name: 'BUSINESS_ADMIN reaches assigned tenant', user: 'businessAdmin', businessId: businessAuthorizationFixture.businessIds[0], statusCode: 200 },
      { name: 'BUSINESS_ADMIN without creation capability cannot enter a shared demo', user: 'businessAdmin', businessId: businessAuthorizationFixture.businessIds[1], statusCode: 403 },
      { name: 'canCreateBusinesses enters only a shared commercial demo workspace', user: 'creatorOnly', businessId: businessAuthorizationFixture.businessIds[1], statusCode: 200 },
      { name: 'ACCOUNT_ADMIN cannot enter QA_SANDBOX', user: 'currentAccountAdmin', businessId: businessAuthorizationFixture.qaSandboxBusinessId, statusCode: 403 },
      { name: 'creator cannot enter QA_SANDBOX', user: 'creatorOnly', businessId: businessAuthorizationFixture.qaSandboxBusinessId, statusCode: 403 },
      { name: 'ACCOUNT_ADMIN cannot enter an unassigned real business', user: 'currentAccountAdmin', businessId: businessAuthorizationFixture.unassignedRealBusinessId, statusCode: 403 },
      { name: 'creator cannot enter an unassigned real business', user: 'creatorOnly', businessId: businessAuthorizationFixture.unassignedRealBusinessId, statusCode: 403 }
    ] as const
    for (const testCase of routeScopeCases) {
      const response = await app.inject({
        method: 'GET',
        url: `/businesses/${testCase.businessId}/payment-settings`,
        headers: { cookie: businessAuthorizationFixtureCookie(testCase.user) }
      })
      assert.equal(response.statusCode, testCase.statusCode, testCase.name)
    }

    for (const user of ['currentAccountAdmin', 'creatorOnly'] as const) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/businesses/${businessAuthorizationFixture.businessIds[1]}/payment-settings`,
        headers: { cookie: businessAuthorizationFixtureCookie(user) },
        payload: {
          transferEnabled: true,
          alias: `demo.${user}`,
          cbu: null,
          cvu: null,
          accountHolder: `Demo ${user}`,
          instructions: null
        }
      })
      assert.equal(response.statusCode, 200, `${user} edits an allowed shared commercial demo workspace: ${response.body}`)
      assert.equal((response.json() as { businessId: string }).businessId, businessAuthorizationFixture.businessIds[1])

      const professionalResponse = await app.inject({
        method: 'PATCH',
        url: `/professionals/${businessAuthorizationFixture.resources.professional[1]}/status`,
        headers: { cookie: businessAuthorizationFixtureCookie(user) },
        payload: { isActive: user === 'currentAccountAdmin' }
      })
      assert.equal(professionalResponse.statusCode, 200, `${user} edits a professional inside the shared demo workspace`)
      assert.equal((professionalResponse.json() as { businessId: string }).businessId, businessAuthorizationFixture.businessIds[1])

      const listResponse = await app.inject({
        method: 'GET',
        url: '/admin/demo-profiles',
        headers: { cookie: businessAuthorizationFixtureCookie(user) }
      })
      assert.equal(listResponse.statusCode, 200, `${user} lists shared commercial demos`)
      assert.equal(
        (listResponse.json() as Array<{ id: string }>).some(({ id }) => id === businessAuthorizationFixture.businessIds[1]),
        true,
        `${user} sees the shared commercial demo`
      )

      const accessResponse = await app.inject({
        method: 'GET',
        url: `/admin/demo-profiles/${businessAuthorizationFixture.businessIds[1]}/access`,
        headers: { cookie: businessAuthorizationFixtureCookie(user) }
      })
      assert.equal(accessResponse.statusCode, 200, `${user} enters the shared commercial demo`)

      const previewResponse = await app.inject({
        method: 'GET',
        url: `/admin/demo-profiles/${businessAuthorizationFixture.businessIds[1]}/preview`,
        headers: { cookie: businessAuthorizationFixtureCookie(user) }
      })
      assert.equal(previewResponse.statusCode, 200, `${user} previews the shared commercial demo`)
      assert.match(previewResponse.headers['content-type'] ?? '', /text\/html/)

      const chatResponse = await app.inject({
        method: 'POST',
        url: `/admin/demo-profiles/${businessAuthorizationFixture.businessIds[1]}/chat`,
        headers: { cookie: businessAuthorizationFixtureCookie(user) },
        payload: { message: 'Hola demo', sessionId: `authorization-${user}` }
      })
      assert.equal(chatResponse.statusCode, 200, `${user} chats in the shared commercial demo`)
      assert.deepEqual(chatResponse.json(), { reply: null, skipped: true, reason: 'Bot desactivado' })
    }

    const nonCreatorDemoList = await app.inject({
      method: 'GET',
      url: '/admin/demo-profiles',
      headers: { cookie: businessAuthorizationFixtureCookie('businessAdmin') }
    })
    assert.equal(nonCreatorDemoList.statusCode, 403, 'non-creator business roles do not gain commercial demo access')

    const accountAdminQaAccess = await app.inject({
      method: 'GET',
      url: `/admin/demo-profiles/${businessAuthorizationFixture.qaSandboxBusinessId}/access`,
      headers: { cookie: businessAuthorizationFixtureCookie('currentAccountAdmin') }
    })
    assert.equal(accountAdminQaAccess.statusCode, 404, 'ACCOUNT_ADMIN cannot enter QA_SANDBOX through demo routes')

    const superAdminQaAccess = await app.inject({
      method: 'GET',
      url: `/admin/demo-profiles/${businessAuthorizationFixture.qaSandboxBusinessId}/access`,
      headers: { cookie: businessAuthorizationFixtureCookie('superAdmin') }
    })
    assert.equal(superAdminQaAccess.statusCode, 200, 'SUPER_ADMIN retains explicit QA_SANDBOX access')

    const {
      canCreateBusiness,
      requireAuthorizedBusiness,
      resolveBusinessScope
    } = await import('../src/services/business-authorization.js')
    const {
      resolveStaffPermissions,
      staffCanUseProfessional
    } = await import('../src/services/staff-permission-service.js')
    const users = businessAuthorizationFixture.users
    const [businessA, businessB] = businessAuthorizationFixture.businessIds
    const scopeCases = [
      { name: 'SUPER_ADMIN accesses first tenant', user: users.superAdmin, businessId: businessA, allowed: true },
      { name: 'SUPER_ADMIN accesses second tenant', user: users.superAdmin, businessId: businessB, allowed: true },
      { name: 'current ACCOUNT_ADMIN accesses assigned tenant', user: users.currentAccountAdmin, businessId: businessA, allowed: true },
      { name: 'current ACCOUNT_ADMIN cannot use demo bypass', user: users.currentAccountAdmin, businessId: businessB, allowed: false },
      { name: 'former ACCOUNT_ADMIN gets no createdBy access', user: users.formerAccountAdmin, businessId: businessA, allowed: false },
      { name: 'BUSINESS_ADMIN accesses assigned tenant', user: users.businessAdmin, businessId: businessA, allowed: true },
      { name: 'BUSINESS_ADMIN cannot access another tenant', user: users.businessAdmin, businessId: businessB, allowed: false },
      { name: 'STAFF OWN accesses assigned tenant', user: users.staffOwn, businessId: businessA, allowed: true },
      { name: 'STAFF OWN cannot access another tenant', user: users.staffOwn, businessId: businessB, allowed: false },
      { name: 'STAFF ALL accesses assigned tenant', user: users.staffAll, businessId: businessA, allowed: true },
      { name: 'STAFF ALL cannot access another tenant', user: users.staffAll, businessId: businessB, allowed: false },
      { name: 'canCreateBusinesses does not widen reads', user: users.creatorOnly, businessId: businessB, allowed: false }
    ] as const

    for (const testCase of scopeCases) {
      const business = await requireAuthorizedBusiness(prisma, testCase.user, testCase.businessId)
      assert.equal(Boolean(business), testCase.allowed, testCase.name)
    }

    assert.deepEqual(resolveBusinessScope(users.superAdmin), { kind: 'all' })
    assert.deepEqual(resolveBusinessScope(users.currentAccountAdmin), {
      kind: 'assigned',
      userId: users.currentAccountAdmin.id
    })
    assert.deepEqual(resolveBusinessScope(users.businessAdmin), {
      kind: 'single',
      businessId: businessA
    })
    assert.equal(canCreateBusiness(users.creatorOnly), true, 'canCreateBusinesses authorizes creation')
    assert.equal(canCreateBusiness(users.businessAdmin), false, 'creation requires the explicit capability')
    const staffOwnPermissions = resolveStaffPermissions({
      staffProfile: 'PROFESSIONAL',
      permissionPreset: 'PROFESSIONAL_DEFAULT'
    })
    const staffOwnAuthorization = {
      role: 'STAFF',
      professionalId: 'professional-a',
      staffProfile: staffOwnPermissions.staffProfile,
      ...staffOwnPermissions.permissions
    } as const
    const staffAllPermissions = resolveStaffPermissions({
      staffProfile: 'SECRETARY',
      permissionPreset: 'SECRETARY_READ_ONLY'
    })
    const staffAllAuthorization = {
      role: 'STAFF',
      professionalId: null,
      staffProfile: staffAllPermissions.staffProfile,
      ...staffAllPermissions.permissions
    } as const
    assert.equal(staffCanUseProfessional(staffOwnAuthorization, 'professional-a'), true)
    assert.equal(staffCanUseProfessional(staffOwnAuthorization, 'professional-b'), false)
    assert.equal(staffCanUseProfessional(staffAllAuthorization, 'professional-b'), true)

    await prisma.business.update({
      where: { id: businessA },
      data: { accountAdminId: users.formerAccountAdmin.id }
    })
    assert.equal(
      Boolean(await requireAuthorizedBusiness(prisma, users.currentAccountAdmin, businessA)),
      false,
      'reassignment revokes the former current admin immediately'
    )
    assert.equal(
      Boolean(await requireAuthorizedBusiness(prisma, users.formerAccountAdmin, businessA)),
      true,
      'reassignment grants the new current admin immediately'
    )
    const reassignmentRouteCases = [
      { name: 'reassignment revokes route access immediately', user: 'currentAccountAdmin', statusCode: 403 },
      { name: 'reassignment grants route access immediately', user: 'formerAccountAdmin', statusCode: 200 }
    ] as const
    for (const testCase of reassignmentRouteCases) {
      const response = await app.inject({
        method: 'GET',
        url: `/businesses/${businessA}/payment-settings`,
        headers: { cookie: businessAuthorizationFixtureCookie(testCase.user) }
      })
      assert.equal(response.statusCode, testCase.statusCode, testCase.name)
    }

    const {
      loadAuthorizedAppointment,
      loadAuthorizedBookingDeposit,
      loadAuthorizedBusiness,
      loadAuthorizedConversation,
      loadAuthorizedCustomer,
      loadAuthorizedMessage,
      loadAuthorizedCampaign,
      loadAuthorizedCampaignDelivery,
      loadAuthorizedReminderAutomation,
      loadAuthorizedServiceCategory,
      loadAuthorizedStaffUser,
      loadAuthorizedWhatsAppTemplate,
      loadAuthorizedScheduleBlock
    } = await import('../src/services/tenant-resource-authorization.js')
    const { sendAuthorizationFailure } = await import('../src/services/authorization-response.js')
    const resources = businessAuthorizationFixture.resources
    type ResourceLoader = (
      client: Parameters<typeof loadAuthorizedBusiness>[0],
      user: Parameters<typeof loadAuthorizedBusiness>[1],
      id: string
    ) => Promise<unknown>
    const resourceCases: ReadonlyArray<{
      name: string
      loader: ResourceLoader
      own: string
      foreign: string
    }> = [
      { name: 'business', loader: loadAuthorizedBusiness, own: businessA, foreign: businessB },
      { name: 'conversation', loader: loadAuthorizedConversation, own: resources.conversation[0], foreign: resources.conversation[1] },
      { name: 'message through conversation', loader: loadAuthorizedMessage, own: resources.message[0], foreign: resources.message[1] },
      { name: 'appointment through professional', loader: loadAuthorizedAppointment, own: resources.appointment[0], foreign: resources.appointment[1] },
      { name: 'booking deposit', loader: loadAuthorizedBookingDeposit, own: resources.deposit[0], foreign: resources.deposit[1] },
      { name: 'customer', loader: loadAuthorizedCustomer, own: resources.customer[0], foreign: resources.customer[1] },
      { name: 'schedule block', loader: loadAuthorizedScheduleBlock, own: resources.scheduleBlock[0], foreign: resources.scheduleBlock[1] },
      { name: 'service category', loader: loadAuthorizedServiceCategory, own: resources.serviceCategory[0], foreign: resources.serviceCategory[1] },
      { name: 'campaign', loader: loadAuthorizedCampaign, own: resources.campaign[0], foreign: resources.campaign[1] },
      { name: 'WhatsApp template', loader: loadAuthorizedWhatsAppTemplate, own: resources.whatsAppTemplate[0], foreign: resources.whatsAppTemplate[1] },
      { name: 'reminder automation', loader: loadAuthorizedReminderAutomation, own: resources.reminderAutomation[0], foreign: resources.reminderAutomation[1] },
      { name: 'campaign delivery', loader: loadAuthorizedCampaignDelivery, own: resources.campaignDelivery[0], foreign: resources.campaignDelivery[1] },
      { name: 'staff user', loader: loadAuthorizedStaffUser, own: users.staffOwn.id, foreign: users.foreignStaff.id }
    ]
    for (const resourceCase of resourceCases) {
      const variants = [
        { label: 'own', id: resourceCase.own, expected: true },
        { label: 'foreign', id: resourceCase.foreign, expected: false },
        { label: 'random', id: resources.random, expected: false },
        { label: 'missing', id: resources.missing, expected: false }
      ] as const
      for (const variant of variants) {
        const resource = await resourceCase.loader(prisma, users.businessAdmin, variant.id)
        assert.equal(Boolean(resource), variant.expected, `${resourceCase.name}: ${variant.label}`)
      }
      const transactionResource = await prisma.$transaction((transaction) =>
        resourceCase.loader(transaction, users.businessAdmin, resourceCase.own)
      )
      assert.equal(Boolean(transactionResource), true, `${resourceCase.name}: transaction client`)
    }

    const nullTenantCases = [
      { name: 'null customer', loader: loadAuthorizedCustomer, id: resources.nullCustomer },
      { name: 'null conversation', loader: loadAuthorizedConversation, id: resources.nullConversation },
      { name: 'message through null conversation', loader: loadAuthorizedMessage, id: resources.nullMessage }
    ] as const
    for (const testCase of nullTenantCases) {
      assert.equal(Boolean(await testCase.loader(prisma, users.businessAdmin, testCase.id)), false, testCase.name)
      assert.equal(
        Boolean(await testCase.loader(prisma, users.superAdmin, testCase.id)),
        false,
        `${testCase.name}: SUPER_ADMIN normal tenant loader must still require ownership`
      )
    }
    assert.equal(
      Boolean(await loadAuthorizedConversation(prisma, users.formerAccountAdmin, resources.conversation[0])),
      true,
      'resource scope follows the current account-admin assignment'
    )
    assert.equal(
      Boolean(await loadAuthorizedConversation(prisma, users.currentAccountAdmin, resources.conversation[0])),
      false,
      'resource scope revokes the previous account admin'
    )
    assert.equal(
      Boolean(await loadAuthorizedCustomer(prisma, users.superAdmin, resources.customer[1])),
      true,
      'SUPER_ADMIN can access concrete foreign tenant resources'
    )

    const taxonomyApp = Fastify()
    let taxonomyLoaderCalls = 0
    taxonomyApp.get('/__test/tenant-customers/:id', async (request, reply) => {
      const query = request.query as { failure?: string }
      if (query.failure === 'malformed') return sendAuthorizationFailure(reply, 'malformed')
      if (request.headers['x-test-authenticated'] !== 'yes') {
        return sendAuthorizationFailure(reply, 'unauthenticated')
      }
      if (query.failure === 'forbidden' || query.failure === 'role') {
        return sendAuthorizationFailure(reply, 'forbidden')
      }
      taxonomyLoaderCalls += 1
      const params = request.params as { id: string }
      const customer = await loadAuthorizedCustomer(prisma, users.businessAdmin, params.id)
      if (!customer) return sendAuthorizationFailure(reply, 'notFound')
      if (query.failure === 'conflict') return sendAuthorizationFailure(reply, 'conflict')
      return { id: customer.id }
    })

    try {
      const preResourceCases = [
        { name: 'malformed input', url: `/__test/tenant-customers/${resources.customer[0]}?failure=malformed`, authenticated: true, statusCode: 400, body: { message: 'Solicitud invalida' } },
        { name: 'unauthenticated', url: `/__test/tenant-customers/${resources.customer[0]}`, authenticated: false, statusCode: 401, body: { message: 'Necesitas iniciar sesion' } },
        { name: 'capability denied', url: `/__test/tenant-customers/${resources.customer[0]}?failure=forbidden`, authenticated: true, statusCode: 403, body: { message: 'No tenes permiso para realizar esta accion' } },
        { name: 'role denied', url: `/__test/tenant-customers/${resources.customer[0]}?failure=role`, authenticated: true, statusCode: 403, body: { message: 'No tenes permiso para realizar esta accion' } }
      ] as const
      for (const testCase of preResourceCases) {
        const callsBefore = taxonomyLoaderCalls
        const response = await taxonomyApp.inject({
          method: 'GET',
          url: testCase.url,
          headers: testCase.authenticated ? { 'x-test-authenticated': 'yes' } : {}
        })
        assert.equal(response.statusCode, testCase.statusCode, testCase.name)
        assert.deepEqual(response.json(), testCase.body, testCase.name)
        assert.equal(taxonomyLoaderCalls, callsBefore, `${testCase.name}: denial must precede resource lookup`)
      }

      const notFoundIds = [
        resources.customer[1],
        resources.random,
        resources.missing,
        resources.nullCustomer
      ] as const
      const notFoundResponses = []
      for (const id of notFoundIds) {
        const response = await taxonomyApp.inject({
          method: 'GET',
          url: `/__test/tenant-customers/${id}`,
          headers: { 'x-test-authenticated': 'yes' }
        })
        notFoundResponses.push({ statusCode: response.statusCode, body: response.json() })
      }
      assert.deepEqual(notFoundResponses, notFoundIds.map(() => ({
        statusCode: 404,
        body: { message: 'Recurso no encontrado' }
      })))

      const conflictResponse = await taxonomyApp.inject({
        method: 'GET',
        url: `/__test/tenant-customers/${resources.customer[0]}?failure=conflict`,
        headers: { 'x-test-authenticated': 'yes' }
      })
      assert.equal(conflictResponse.statusCode, 409)
      assert.deepEqual(conflictResponse.json(), { message: 'El recurso cambio de estado' })

      const ownResponse = await taxonomyApp.inject({
        method: 'GET',
        url: `/__test/tenant-customers/${resources.customer[0]}`,
        headers: { 'x-test-authenticated': 'yes' }
      })
      assert.equal(ownResponse.statusCode, 200)
      assert.deepEqual(ownResponse.json(), { id: resources.customer[0] })
    } finally {
      await taxonomyApp.close()
    }

    const authorizationCookie = businessAuthorizationFixtureCookie('businessAdmin')
    let unexpectedNetworkCalls = 0
    globalThis.fetch = async () => {
      unexpectedNetworkCalls += 1
      throw new Error('Real network access is forbidden in the authorization contract')
    }
    const notFoundBody = { message: 'Recurso no encontrado' }
    const providerCallCount = () => Object.values(providerFakes.calls)
      .reduce((total, calls) => total + calls.length, 0)
    async function assertDeniedPair(
      name: string,
      foreignId: string,
      randomId: string,
      requestForId: (id: string) => {
        method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
        url: string
        payload?: Record<string, unknown>
      }
    ) {
      const callsBefore = providerCallCount()
      const responses = []
      for (const id of [foreignId, randomId]) {
        const request = requestForId(id)
        const response = await app.inject({
          ...request,
          headers: { cookie: authorizationCookie }
        })
        responses.push({ statusCode: response.statusCode, body: response.json() })
      }
      assert.deepEqual(responses, [
        { statusCode: 404, body: notFoundBody },
        { statusCode: 404, body: notFoundBody }
      ], name)
      assert.equal(providerCallCount(), callsBefore, `${name}: denied requests must not call providers`)
    }

    await assertDeniedPair(
      'professional status foreign/random equivalence',
      resources.professional[1],
      resources.random,
      (id) => ({ method: 'PATCH', url: `/professionals/${id}/status`, payload: { isActive: false } })
    )
    const ownProfessionalStatus = await app.inject({
      method: 'PATCH',
      url: `/professionals/${resources.professional[0]}/status`,
      headers: { cookie: authorizationCookie },
      payload: { isActive: true }
    })
    assert.equal(ownProfessionalStatus.statusCode, 200, 'own professional status succeeds')

    await assertDeniedPair(
      'campaign audience foreign/random equivalence',
      resources.campaign[1],
      resources.random,
      (id) => ({ method: 'GET', url: `/campaigns/${id}/audience-preview` })
    )
    const ownCampaignAudience = await app.inject({
      method: 'GET',
      url: `/campaigns/${resources.campaign[0]}/audience-preview`,
      headers: { cookie: authorizationCookie }
    })
    assert.equal(ownCampaignAudience.statusCode, 200, 'own campaign audience succeeds')

    const adjacentProtectedIdCases = [
      {
        name: 'service category',
        foreignId: resources.serviceCategory[1],
        ownId: resources.serviceCategory[0],
        requestForId: (id: string) => ({ method: 'PATCH' as const, url: `/service-categories/${id}`, payload: { name: 'Authorization Category Updated' } })
      },
      {
        name: 'service aliases',
        foreignId: resources.service[1],
        ownId: resources.service[0],
        requestForId: (id: string) => ({ method: 'POST' as const, url: `/services/${id}/aliases`, payload: { aliases: ['authorization-alias'] } })
      },
      {
        name: 'WhatsApp template',
        foreignId: resources.whatsAppTemplate[1],
        ownId: resources.whatsAppTemplate[0],
        requestForId: (id: string) => ({ method: 'PATCH' as const, url: `/whatsapp-templates/${id}`, payload: { internalName: 'Authorization Template Updated' } })
      },
      {
        name: 'reminder automation',
        foreignId: resources.reminderAutomation[1],
        ownId: resources.reminderAutomation[0],
        requestForId: (id: string) => ({ method: 'PATCH' as const, url: `/reminder-automations/${id}`, payload: { name: 'Authorization Reminder Updated', mode: 'PAUSED', channel: 'WHATSAPP' } })
      },
      {
        name: 'campaign delivery',
        foreignId: resources.campaignDelivery[1],
        ownId: resources.campaignDelivery[0],
        requestForId: (id: string) => ({ method: 'PATCH' as const, url: `/campaign-deliveries/${id}`, payload: { status: 'READ' } })
      }
    ] as const
    for (const testCase of adjacentProtectedIdCases) {
      await assertDeniedPair(
        `${testCase.name} foreign/random equivalence`,
        testCase.foreignId,
        resources.random,
        testCase.requestForId
      )
      const ownResponse = await app.inject({
        ...testCase.requestForId(testCase.ownId),
        headers: { cookie: authorizationCookie }
      })
      assert.equal(ownResponse.statusCode, 200, `${testCase.name}: own resource succeeds`)
    }

    await assertDeniedPair(
      'staff user foreign/random equivalence',
      users.foreignStaff.id,
      resources.random,
      (id) => ({ method: 'PATCH', url: `/staff-users/${id}`, payload: {} })
    )
    await assertDeniedPair(
      'conversation history foreign/random equivalence',
      resources.conversation[1],
      resources.random,
      (id) => ({ method: 'GET', url: `/crm/conversations/${id}/messages` })
    )
    const ownHistory = await app.inject({
      method: 'GET',
      url: `/crm/conversations/${resources.conversation[0]}/messages`,
      headers: { cookie: authorizationCookie }
    })
    assert.equal(ownHistory.statusCode, 200)
    assert.deepEqual(
      (ownHistory.json() as Array<{ id: string }>).map(({ id }) => id),
      [resources.message[0]]
    )

    await assertDeniedPair(
      'message media foreign/random equivalence',
      resources.message[1],
      resources.random,
      (id) => ({ method: 'GET', url: `/crm/messages/${id}/media` })
    )
    const mediaCallsBeforeOwn = providerFakes.calls.media.length
    const ownMedia = await app.inject({
      method: 'GET',
      url: `/crm/messages/${resources.message[0]}/media`,
      headers: { cookie: authorizationCookie }
    })
    assert.equal(ownMedia.statusCode, 200)
    assert.equal(providerFakes.calls.media.length, mediaCallsBeforeOwn + 1)
    assert.equal(providerFakes.calls.media.at(-1)?.businessId, businessA)

    const foreignConversationBefore = await prisma.conversation.findUniqueOrThrow({
      where: { id: resources.conversation[1] },
      select: { archivedAt: true, aiEnabled: true, lastMessage: true }
    })
    await assertDeniedPair(
      'archive foreign/random equivalence',
      resources.conversation[1],
      resources.random,
      (id) => ({
        method: 'PATCH',
        url: `/crm/conversations/${id}/archive`,
        payload: { archived: true }
      })
    )
    const ownArchive = await app.inject({
      method: 'PATCH',
      url: `/crm/conversations/${resources.conversation[0]}/archive`,
      headers: { cookie: authorizationCookie },
      payload: { archived: true }
    })
    assert.equal(ownArchive.statusCode, 200)

    await assertDeniedPair(
      'AI toggle foreign/random equivalence',
      resources.conversation[1],
      resources.random,
      (id) => ({
        method: 'PATCH',
        url: `/crm/conversations/${id}/ai`,
        payload: { aiEnabled: false }
      })
    )
    const ownAiToggle = await app.inject({
      method: 'PATCH',
      url: `/crm/conversations/${resources.conversation[0]}/ai`,
      headers: { cookie: authorizationCookie },
      payload: { aiEnabled: false }
    })
    assert.equal(ownAiToggle.statusCode, 200)

    const foreignOutboundBefore = await prisma.message.count({
      where: { conversationId: resources.conversation[1], direction: 'OUTBOUND' }
    })
    await assertDeniedPair(
      'manual reply foreign/random equivalence',
      resources.conversation[1],
      resources.random,
      (id) => ({
        method: 'POST',
        url: `/crm/conversations/${id}/manual-replies`,
        payload: { text: 'Denied fixture reply' }
      })
    )
    assert.equal(await prisma.message.count({
      where: { conversationId: resources.conversation[1], direction: 'OUTBOUND' }
    }), foreignOutboundBefore)
    const whatsAppCallsBeforeOwn = providerFakes.calls.whatsapp.length
    const ownManualReply = await app.inject({
      method: 'POST',
      url: `/crm/conversations/${resources.conversation[0]}/manual-replies`,
      headers: { cookie: authorizationCookie },
      payload: { text: 'Authorized fixture reply' }
    })
    assert.equal(ownManualReply.statusCode, 200)
    assert.equal(providerFakes.calls.whatsapp.length, whatsAppCallsBeforeOwn + 1)
    assert.equal(providerFakes.calls.whatsapp.at(-1)?.businessId, businessA)

    assert.deepEqual(await prisma.conversation.findUniqueOrThrow({
      where: { id: resources.conversation[1] },
      select: { archivedAt: true, aiEnabled: true, lastMessage: true }
    }), foreignConversationBefore, 'denied conversation mutations must preserve foreign state')

    await assertDeniedPair(
      'deposit proof foreign/random equivalence',
      resources.deposit[1],
      resources.random,
      (id) => ({ method: 'GET', url: `/crm/deposits/${id}/proof` })
    )
    const ownProof = await app.inject({
      method: 'GET',
      url: `/crm/deposits/${resources.deposit[0]}/proof`,
      headers: { cookie: authorizationCookie }
    })
    assert.equal(ownProof.statusCode, 200)

    const foreignDepositBefore = await prisma.bookingDeposit.findUniqueOrThrow({
      where: { id: resources.deposit[1] },
      select: { status: true, reviewedAt: true, reviewedByUserId: true, rejectionReason: true }
    })
    for (const action of ['approve', 'reject'] as const) {
      await assertDeniedPair(
        `web deposit ${action} foreign/random equivalence`,
        resources.deposit[1],
        resources.random,
        (id) => ({ method: 'POST', url: `/crm/deposits/${id}/${action}`, payload: {} })
      )
    }
    const ownApprove = await app.inject({
      method: 'POST',
      url: `/crm/deposits/${resources.deposit[0]}/approve`,
      headers: { cookie: authorizationCookie },
      payload: {}
    })
    assert.equal(ownApprove.statusCode, 200)
    assert.equal((await prisma.bookingDeposit.findUniqueOrThrow({
      where: { id: resources.deposit[0] },
      select: { status: true }
    })).status, 'APPROVED')

    await prisma.$transaction([
      prisma.bookingDeposit.update({
        where: { id: resources.deposit[0] },
        data: { status: 'PROOF_RECEIVED', reviewedAt: null, reviewedByUserId: null, rejectionReason: null }
      }),
      prisma.appointment.update({
        where: { id: resources.appointment[0] },
        data: { status: 'PENDING' }
      })
    ])
    const ownReject = await app.inject({
      method: 'POST',
      url: `/crm/deposits/${resources.deposit[0]}/reject`,
      headers: { cookie: authorizationCookie },
      payload: { reason: 'Fixture rejection' }
    })
    assert.equal(ownReject.statusCode, 200)
    assert.equal((await prisma.bookingDeposit.findUniqueOrThrow({
      where: { id: resources.deposit[0] },
      select: { status: true }
    })).status, 'REJECTED')
    assert.deepEqual(await prisma.bookingDeposit.findUniqueOrThrow({
      where: { id: resources.deposit[1] },
      select: { status: true, reviewedAt: true, reviewedByUserId: true, rejectionReason: true }
    }), foreignDepositBefore, 'denied deposit reviews must preserve foreign state')

    for (const action of ['approve', 'reject'] as const) {
      await assertDeniedPair(
        `conversation deposit ${action} foreign/random equivalence`,
        resources.conversation[1],
        resources.random,
        (id) => ({ method: 'POST', url: `/crm/conversations/${id}/deposit/${action}`, payload: {} })
      )
    }
    await prisma.$transaction([
      prisma.bookingDeposit.update({
        where: { id: resources.deposit[0] },
        data: { status: 'PROOF_RECEIVED', reviewedAt: null, reviewedByUserId: null, rejectionReason: null }
      }),
      prisma.appointment.update({
        where: { id: resources.appointment[0] },
        data: { status: 'PENDING' }
      })
    ])
    const conversationReviewCallsBefore = providerFakes.calls.whatsapp.length
    const ownConversationReject = await app.inject({
      method: 'POST',
      url: `/crm/conversations/${resources.conversation[0]}/deposit/reject`,
      headers: { cookie: authorizationCookie },
      payload: { reason: 'Conversation fixture rejection' }
    })
    assert.equal(ownConversationReject.statusCode, 200)
    assert.equal(providerFakes.calls.whatsapp.length, conversationReviewCallsBefore + 1)
    assert.equal(providerFakes.calls.whatsapp.at(-1)?.businessId, businessA)

    const depositsResponse = await app.inject({
      method: 'GET',
      url: `/crm/deposits?businessId=${encodeURIComponent(businessA)}&view=all`,
      headers: { cookie: authorizationCookie }
    })
    assert.equal(depositsResponse.statusCode, 200)
    const depositItems = depositsResponse.json() as {
      items: Array<{ id: string; coordinatedAppointments: Array<{ id: string }> }>
    }
    const ownDepositItem = depositItems.items.find(({ id }) => id === resources.deposit[0])
    assert.ok(ownDepositItem)
    assert.deepEqual(
      ownDepositItem.coordinatedAppointments.map(({ id }) => id),
      [resources.appointment[0]],
      'coordinated lookup must not leak a foreign appointment sharing coordinationGroupId'
    )
    assert.equal(unexpectedNetworkCalls, 0, 'CRM authorization contract must not use real network providers')

    const createAppointmentPayload = {
      customerId: resources.customer[0],
      professionalId: resources.professional[0],
      serviceId: resources.service[0],
      serviceIds: [resources.service[0], resources.addonService[0]],
      startAt: '2026-09-01T12:00:00.000Z',
      force: true
    }
    const appointmentCountBeforeDeniedCreates = await prisma.appointment.count()
    const mixedTenantCreateCases = [
      { name: 'foreign customer', payload: { ...createAppointmentPayload, customerId: resources.customer[1] } },
      { name: 'foreign professional', payload: { ...createAppointmentPayload, professionalId: resources.professional[1] } },
      { name: 'foreign primary service', payload: { ...createAppointmentPayload, serviceId: resources.service[1] } },
      { name: 'foreign service item', payload: { ...createAppointmentPayload, serviceIds: [resources.service[0], resources.service[1]] } },
      { name: 'foreign add-on', payload: { ...createAppointmentPayload, serviceIds: [resources.service[0], resources.addonService[1]] } }
    ] as const
    for (const testCase of mixedTenantCreateCases) {
      const response = await app.inject({
        method: 'POST',
        url: '/appointments',
        headers: { cookie: authorizationCookie },
        payload: testCase.payload
      })
      assert.equal(response.statusCode, 404, testCase.name)
      assert.deepEqual(response.json(), notFoundBody, testCase.name)
    }
    assert.equal(
      await prisma.appointment.count(),
      appointmentCountBeforeDeniedCreates,
      'mixed-tenant appointment creation must not persist appointments'
    )
    const ownCreate = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: authorizationCookie },
      payload: createAppointmentPayload
    })
    assert.equal(ownCreate.statusCode, 200, 'consistent own-tenant appointment creation succeeds')
    const createdAppointment = ownCreate.json() as { id: string; serviceItems: Array<{ serviceId: string }> }
    assert.deepEqual(
      createdAppointment.serviceItems.map(({ serviceId }) => serviceId),
      [resources.service[0], resources.addonService[0]]
    )

    const foreignAppointmentBefore = await prisma.appointment.findUniqueOrThrow({
      where: { id: resources.appointment[1] },
      include: { serviceItems: { orderBy: { sortOrder: 'asc' } }, bookingDeposit: true }
    })
    const editPayload = {
      customerId: resources.customer[0],
      professionalId: resources.professional[0],
      serviceId: resources.service[0],
      serviceIds: [resources.service[0]],
      startAt: '2026-09-02T12:00:00.000Z',
      force: true,
      notes: 'Authorized Batch 5 edit'
    }
    await assertDeniedPair(
      'appointment edit foreign/random equivalence',
      resources.appointment[1],
      resources.random,
      (id) => ({ method: 'PATCH', url: `/appointments/${id}`, payload: editPayload })
    )
    await assertDeniedPair(
      'appointment status foreign/random equivalence',
      resources.appointment[1],
      resources.random,
      (id) => ({ method: 'PATCH', url: `/appointments/${id}/status`, payload: { status: 'COMPLETED' } })
    )
    await assertDeniedPair(
      'appointment cancel foreign/random equivalence',
      resources.appointment[1],
      resources.random,
      (id) => ({ method: 'DELETE', url: `/appointments/${id}` })
    )
    assert.deepEqual(await prisma.appointment.findUniqueOrThrow({
      where: { id: resources.appointment[1] },
      include: { serviceItems: { orderBy: { sortOrder: 'asc' } }, bookingDeposit: true }
    }), foreignAppointmentBefore, 'denied appointment mutations must preserve the foreign row and relations')

    const ownEdit = await app.inject({
      method: 'PATCH',
      url: `/appointments/${resources.appointment[0]}`,
      headers: { cookie: authorizationCookie },
      payload: editPayload
    })
    assert.equal(ownEdit.statusCode, 200, 'own appointment edit succeeds')
    const ownStatus = await app.inject({
      method: 'PATCH',
      url: `/appointments/${resources.appointment[0]}/status`,
      headers: { cookie: authorizationCookie },
      payload: { status: 'COMPLETED' }
    })
    assert.equal(ownStatus.statusCode, 200, 'own appointment status mutation succeeds')
    const ownCancel = await app.inject({
      method: 'DELETE',
      url: `/appointments/${resources.appointment[0]}`,
      headers: { cookie: authorizationCookie }
    })
    assert.equal(ownCancel.statusCode, 200, 'own appointment cancellation succeeds')

    const staffOtherAppointmentBefore = await prisma.appointment.findUniqueOrThrow({
      where: { id: resources.otherAppointment },
      include: { serviceItems: { orderBy: { sortOrder: 'asc' } } }
    })
    const staffOwnAppointmentCases = [
      { method: 'PATCH' as const, url: `/appointments/${resources.otherAppointment}`, payload: { ...editPayload, force: false } },
      { method: 'PATCH' as const, url: `/appointments/${resources.otherAppointment}/status`, payload: { status: 'COMPLETED' } },
      { method: 'DELETE' as const, url: `/appointments/${resources.otherAppointment}` }
    ]
    for (const request of staffOwnAppointmentCases) {
      const response = await app.inject({
        ...request,
        headers: { cookie: businessAuthorizationFixtureCookie('staffOwn') }
      })
      assert.equal(response.statusCode, 403, 'STAFF OWN cannot mutate another professional appointment')
    }
    assert.deepEqual(await prisma.appointment.findUniqueOrThrow({
      where: { id: resources.otherAppointment },
      include: { serviceItems: { orderBy: { sortOrder: 'asc' } } }
    }), staffOtherAppointmentBefore, 'STAFF OWN denials preserve another professional appointment')
    const staffAllEdit = await app.inject({
      method: 'PATCH',
      url: `/appointments/${resources.otherAppointment}`,
      headers: { cookie: businessAuthorizationFixtureCookie('staffAll') },
      payload: {
        ...editPayload,
        professionalId: resources.otherProfessional,
        startAt: '2026-09-03T13:00:00.000Z'
      }
    })
    assert.equal(staffAllEdit.statusCode, 200, 'STAFF ALL edits another professional appointment')
    const staffAllStatus = await app.inject({
      method: 'PATCH',
      url: `/appointments/${resources.otherAppointment}/status`,
      headers: { cookie: businessAuthorizationFixtureCookie('staffAll') },
      payload: { status: 'COMPLETED' }
    })
    assert.equal(staffAllStatus.statusCode, 200, 'STAFF ALL changes another professional appointment status')
    const staffAllCancel = await app.inject({
      method: 'DELETE',
      url: `/appointments/${resources.otherAppointment}`,
      headers: { cookie: businessAuthorizationFixtureCookie('staffAll') }
    })
    assert.equal(staffAllCancel.statusCode, 200, 'STAFF ALL cancels another professional appointment')

    const foreignBlockBefore = await prisma.scheduleBlock.findUniqueOrThrow({
      where: { id: resources.scheduleBlock[1] }
    })
    await assertDeniedPair(
      'schedule-block delete foreign/random equivalence',
      resources.scheduleBlock[1],
      resources.random,
      (id) => ({ method: 'DELETE', url: `/schedule-blocks/${id}` })
    )
    assert.deepEqual(
      await prisma.scheduleBlock.findUniqueOrThrow({ where: { id: resources.scheduleBlock[1] } }),
      foreignBlockBefore,
      'denied schedule-block deletion must preserve the foreign row'
    )
    const staffOwnOtherBlock = await app.inject({
      method: 'DELETE',
      url: `/schedule-blocks/${resources.otherScheduleBlock}`,
      headers: { cookie: businessAuthorizationFixtureCookie('staffOwn') }
    })
    assert.equal(staffOwnOtherBlock.statusCode, 403, 'STAFF OWN cannot delete another professional block')
    assert.ok(await prisma.scheduleBlock.findUnique({ where: { id: resources.otherScheduleBlock } }))
    const staffOwnBlock = await app.inject({
      method: 'DELETE',
      url: `/schedule-blocks/${resources.scheduleBlock[0]}`,
      headers: { cookie: businessAuthorizationFixtureCookie('staffOwn') }
    })
    assert.equal(staffOwnBlock.statusCode, 200, 'STAFF OWN deletes their professional block')
    const staffAllBlock = await app.inject({
      method: 'DELETE',
      url: `/schedule-blocks/${resources.otherScheduleBlock}`,
      headers: { cookie: businessAuthorizationFixtureCookie('staffAll') }
    })
    assert.equal(staffAllBlock.statusCode, 200, 'STAFF ALL deletes another tenant professional block')
    const businessAdminBlock = await app.inject({
      method: 'DELETE',
      url: `/schedule-blocks/${resources.adminScheduleBlock}`,
      headers: { cookie: authorizationCookie }
    })
    assert.equal(businessAdminBlock.statusCode, 200, 'BUSINESS_ADMIN deletes an own-tenant block')

    async function assertCanonicalNotFoundIds(
      name: string,
      ids: readonly string[],
      requestForId: (id: string) => {
        method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
        url: string
        payload?: Record<string, unknown>
      },
      cookie = authorizationCookie
    ) {
      const responses = []
      for (const id of ids) {
        const request = requestForId(id)
        const response = await app.inject({
          ...request,
          headers: { cookie }
        })
        responses.push({ statusCode: response.statusCode, body: response.json() })
      }
      assert.deepEqual(responses, ids.map(() => ({ statusCode: 404, body: notFoundBody })), name)
    }

    const customerDeniedIds = [
      resources.customer[1],
      resources.random,
      resources.missing,
      resources.nullCustomer
    ] as const
    const foreignCustomerBefore = await prisma.customer.findUniqueOrThrow({
      where: { id: resources.customer[1] },
      include: {
        notes: { orderBy: { id: 'asc' } },
        marketingPreferences: { orderBy: { businessId: 'asc' } },
        appointments: { orderBy: { id: 'asc' } }
      }
    })
    const nullCustomerBefore = await prisma.customer.findUniqueOrThrow({
      where: { id: resources.nullCustomer },
      include: {
        notes: { orderBy: { id: 'asc' } },
        marketingPreferences: { orderBy: { businessId: 'asc' } },
        appointments: { orderBy: { id: 'asc' } }
      }
    })
    await assertCanonicalNotFoundIds(
      'customer edit foreign/random/missing/null equivalence',
      customerDeniedIds,
      (id) => ({
        method: 'PATCH',
        url: `/customers/${id}`,
        payload: { businessId: businessA, name: 'Denied Batch 6 edit', email: 'denied@fixture.invalid' }
      })
    )
    await assertCanonicalNotFoundIds(
      'customer delete foreign/random/missing/null equivalence',
      customerDeniedIds,
      (id) => ({ method: 'DELETE', url: `/customers/${id}` })
    )
    await assertCanonicalNotFoundIds(
      'customer notes read foreign/random/missing/null equivalence',
      customerDeniedIds,
      (id) => ({ method: 'GET', url: `/customers/${id}/notes` })
    )
    await assertCanonicalNotFoundIds(
      'customer note create foreign/random/missing/null equivalence',
      customerDeniedIds,
      (id) => ({ method: 'POST', url: `/customers/${id}/notes`, payload: { body: 'Denied Batch 6 note' } })
    )
    await assertCanonicalNotFoundIds(
      'customer marketing read foreign/random/missing/null equivalence',
      customerDeniedIds,
      (id) => ({ method: 'GET', url: `/customers/${id}/marketing-preference?businessId=${encodeURIComponent(businessA)}` })
    )
    await assertCanonicalNotFoundIds(
      'customer marketing mutation foreign/random/missing/null equivalence',
      customerDeniedIds,
      (id) => ({
        method: 'PATCH',
        url: `/customers/${id}/marketing-preference`,
        payload: { businessId: businessA, status: 'OPTED_OUT', source: 'MANUAL' }
      })
    )
    assert.deepEqual(await prisma.customer.findUniqueOrThrow({
      where: { id: resources.customer[1] },
      include: {
        notes: { orderBy: { id: 'asc' } },
        marketingPreferences: { orderBy: { businessId: 'asc' } },
        appointments: { orderBy: { id: 'asc' } }
      }
    }), foreignCustomerBefore, 'denied customer operations preserve the complete foreign customer graph')
    assert.deepEqual(await prisma.customer.findUniqueOrThrow({
      where: { id: resources.nullCustomer },
      include: {
        notes: { orderBy: { id: 'asc' } },
        marketingPreferences: { orderBy: { businessId: 'asc' } },
        appointments: { orderBy: { id: 'asc' } }
      }
    }), nullCustomerBefore, 'denied customer operations preserve the complete null-tenant customer graph')

    const superAdminNullCustomer = await app.inject({
      method: 'GET',
      url: `/customers/${resources.nullCustomer}/notes`,
      headers: { cookie: businessAuthorizationFixtureCookie('superAdmin') }
    })
    assert.equal(superAdminNullCustomer.statusCode, 404)
    assert.deepEqual(superAdminNullCustomer.json(), notFoundBody)
    const staffCapabilityDenial = await app.inject({
      method: 'GET',
      url: `/customers/${resources.customer[1]}/notes`,
      headers: { cookie: businessAuthorizationFixtureCookie('staffOwn') }
    })
    assert.equal(staffCapabilityDenial.statusCode, 403, 'customer capability denial precedes resource lookup')

    for (const route of ['/customers', '/customers/search?q=Authorization', '/customers/overview']) {
      const separator = route.includes('?') ? '&' : '?'
      const response = await app.inject({
        method: 'GET',
        url: `${route}${separator}businessId=${encodeURIComponent(businessA)}`,
        headers: { cookie: authorizationCookie }
      })
      assert.equal(response.statusCode, 200, `${route} own-tenant list succeeds`)
      const body = response.json() as Array<{ id: string }> | { items: Array<{ id: string }> }
      const items = Array.isArray(body) ? body : body.items
      assert.equal(items.some(({ id }) => id === resources.customer[1] || id === resources.nullCustomer), false)
    }

    const ownCustomerEdit = await app.inject({
      method: 'PATCH',
      url: `/customers/${resources.customer[0]}`,
      headers: { cookie: authorizationCookie },
      payload: { businessId: businessA, name: 'Authorization Customer 1 Updated', email: 'own@fixture.invalid' }
    })
    assert.equal(ownCustomerEdit.statusCode, 200)
    const ownCustomerPhoneEdit = await app.inject({
      method: 'PATCH',
      url: `/customers/${resources.customer[0]}`,
      headers: { cookie: authorizationCookie },
      payload: {
        businessId: businessA,
        name: 'Authorization Customer 1 Updated',
        phone: '11 4000 0010',
        email: 'own@fixture.invalid'
      }
    })
    assert.equal(ownCustomerPhoneEdit.statusCode, 200)
    assert.equal((ownCustomerPhoneEdit.json() as { businessId: string }).businessId, businessA)
    const ownNotesRead = await app.inject({
      method: 'GET',
      url: `/customers/${resources.customer[0]}/notes`,
      headers: { cookie: authorizationCookie }
    })
    assert.equal(ownNotesRead.statusCode, 200)
    const ownNoteCreate = await app.inject({
      method: 'POST',
      url: `/customers/${resources.customer[0]}/notes`,
      headers: { cookie: authorizationCookie },
      payload: { body: 'Authorized Batch 6 note' }
    })
    assert.equal(ownNoteCreate.statusCode, 200)
    const ownMarketingRead = await app.inject({
      method: 'GET',
      url: `/customers/${resources.customer[0]}/marketing-preference?businessId=${encodeURIComponent(businessA)}`,
      headers: { cookie: authorizationCookie }
    })
    assert.equal(ownMarketingRead.statusCode, 200)
    const ownMarketingMutation = await app.inject({
      method: 'PATCH',
      url: `/customers/${resources.customer[0]}/marketing-preference`,
      headers: { cookie: authorizationCookie },
      payload: { businessId: businessA, status: 'OPTED_OUT', source: 'MANUAL' }
    })
    assert.equal(ownMarketingMutation.statusCode, 200)
    assert.equal((ownMarketingMutation.json() as { customerId: string }).customerId, resources.customer[0])

    const foreignDepositGraphBefore = await prisma.bookingDeposit.findUniqueOrThrow({
      where: { id: resources.deposit[1] },
      include: { appointment: true, conversation: true }
    })
    for (const requestForId of [
      (id: string) => ({ method: 'GET' as const, url: `/crm/deposits/${id}/proof` }),
      (id: string) => ({ method: 'POST' as const, url: `/crm/deposits/${id}/approve`, payload: {} }),
      (id: string) => ({ method: 'POST' as const, url: `/crm/deposits/${id}/reject`, payload: { reason: 'Denied Batch 6 review' } })
    ]) {
      await assertCanonicalNotFoundIds(
        'deposit foreign/random/missing equivalence',
        [resources.deposit[1], resources.random, resources.missing],
        requestForId
      )
    }
    assert.deepEqual(await prisma.bookingDeposit.findUniqueOrThrow({
      where: { id: resources.deposit[1] },
      include: { appointment: true, conversation: true }
    }), foreignDepositGraphBefore, 'denied deposit operations preserve the complete foreign deposit graph')

    const foreignServiceResolutionBefore = await prisma.conversation.findUniqueOrThrow({
      where: { id: resources.conversation[1] }
    })
    const serviceResolutionCallsBefore = providerCallCount()
    await assertCanonicalNotFoundIds(
      'deposit-gated service resolution foreign/random/missing equivalence',
      [resources.conversation[1], resources.random, resources.missing],
      (id) => ({
        method: 'POST',
        url: `/crm/conversations/${id}/service-resolution`,
        payload: { serviceId: null }
      })
    )
    assert.equal(providerCallCount(), serviceResolutionCallsBefore)
    assert.deepEqual(
      await prisma.conversation.findUniqueOrThrow({ where: { id: resources.conversation[1] } }),
      foreignServiceResolutionBefore,
      'denied deposit-gated service resolution preserves the foreign conversation'
    )

    const ownCustomerDelete = await app.inject({
      method: 'DELETE',
      url: `/customers/${resources.deletableCustomer}`,
      headers: { cookie: authorizationCookie }
    })
    assert.equal(ownCustomerDelete.statusCode, 200)
    assert.equal(await prisma.customer.count({ where: { id: resources.deletableCustomer } }), 0)

    async function qaMaintenanceSnapshot() {
      const [customers, notes, appointments, deposits, conversations, messages] = await Promise.all([
        prisma.customer.findMany({
          where: { id: { in: [...resources.customer, ...resources.qaCustomer, resources.nullCustomer] } },
          orderBy: { id: 'asc' }
        }),
        prisma.customerNote.findMany({
          where: { id: { in: [...resources.customerNote, ...resources.qaNote] } },
          orderBy: { id: 'asc' }
        }),
        prisma.appointment.findMany({
          where: { id: { in: [...resources.appointment, ...resources.qaAppointment, resources.otherAppointment] } },
          orderBy: { id: 'asc' }
        }),
        prisma.bookingDeposit.findMany({
          where: { id: { in: [...resources.deposit, ...resources.qaDeposit] } },
          orderBy: { id: 'asc' }
        }),
        prisma.conversation.findMany({
          where: { id: { in: [...resources.conversation, ...resources.qaConversation, resources.nullConversation] } },
          orderBy: { id: 'asc' }
        }),
        prisma.message.findMany({
          where: { id: { in: [...resources.message, ...resources.qaMessage, resources.nullMessage] } },
          orderBy: { id: 'asc' }
        })
      ])
      return { customers, notes, appointments, deposits, conversations, messages }
    }

    async function assertQaMaintenanceDenial(input: {
      name: string
      qaBusinessId: string | undefined
      method?: 'GET' | 'POST'
      url?: string
      user?: Parameters<typeof businessAuthorizationFixtureCookie>[0]
      payload?: Record<string, unknown>
      statusCode: number
      body?: Record<string, unknown>
    }) {
      if (input.qaBusinessId === undefined) delete process.env.QA_BUSINESS_ID
      else process.env.QA_BUSINESS_ID = input.qaBusinessId
      const before = await qaMaintenanceSnapshot()
      const response = await app.inject({
        method: input.method ?? 'POST',
        url: input.url ?? '/crm/maintenance/delete-qa-data',
        ...(input.user ? { headers: { cookie: businessAuthorizationFixtureCookie(input.user) } } : {}),
        ...(input.payload ? { payload: input.payload } : {})
      })
      assert.equal(response.statusCode, input.statusCode, input.name)
      if (input.body) assert.deepEqual(response.json(), input.body, input.name)
      assert.deepEqual(await qaMaintenanceSnapshot(), before, `${input.name}: denial must not delete or mutate QA data`)
    }

    await prisma.business.update({
      where: { id: businessA },
      data: { isDemo: true, demoType: 'QA_SANDBOX' }
    })
    const qaBusinessId = businessA
    const nonQaBusinessId = businessB
    const qaConfirmation = 'delete-all-qa-cami-data'
    await assertQaMaintenanceDenial({
      name: 'legacy destructive QA GET is removed',
      qaBusinessId,
      method: 'GET',
      url: '/crm/maintenance/delete-qa-conversations?date=2026-08-22&confirm=delete-qa-cami',
      user: 'superAdmin',
      statusCode: 404
    })
    await assertQaMaintenanceDenial({
      name: 'destructive QA POST path rejects GET',
      qaBusinessId,
      method: 'GET',
      url: '/crm/maintenance/delete-qa-data',
      user: 'superAdmin',
      statusCode: 404
    })
    await assertQaMaintenanceDenial({
      name: 'QA maintenance requires authentication',
      qaBusinessId,
      payload: { businessId: qaBusinessId, confirm: qaConfirmation },
      statusCode: 401,
      body: { message: 'Necesitas iniciar sesion' }
    })
    for (const user of ['businessAdmin', 'staffOwn', 'currentAccountAdmin'] as const) {
      await assertQaMaintenanceDenial({
        name: `QA maintenance rejects ${user}`,
        qaBusinessId,
        user,
        payload: { businessId: qaBusinessId, confirm: qaConfirmation },
        statusCode: 403
      })
    }
    await assertQaMaintenanceDenial({
      name: 'QA maintenance requires body businessId',
      qaBusinessId,
      user: 'superAdmin',
      payload: { confirm: qaConfirmation },
      statusCode: 400,
      body: { message: 'Solicitud invalida' }
    })
    await assertQaMaintenanceDenial({
      name: 'QA maintenance requires confirmation',
      qaBusinessId,
      user: 'superAdmin',
      payload: { businessId: qaBusinessId },
      statusCode: 400,
      body: { message: 'Solicitud invalida' }
    })
    await assertQaMaintenanceDenial({
      name: 'QA maintenance rejects invalid confirmation',
      qaBusinessId,
      user: 'superAdmin',
      payload: { businessId: qaBusinessId, confirm: 'delete-something-else' },
      statusCode: 400,
      body: { message: 'Solicitud invalida' }
    })
    await assertQaMaintenanceDenial({
      name: 'QA maintenance fails closed without QA_BUSINESS_ID',
      qaBusinessId: undefined,
      user: 'superAdmin',
      payload: { businessId: qaBusinessId, confirm: qaConfirmation },
      statusCode: 409,
      body: { message: 'El recurso cambio de estado' }
    })
    await assertQaMaintenanceDenial({
      name: 'QA maintenance rejects configured/requested mismatch',
      qaBusinessId,
      user: 'superAdmin',
      payload: { businessId: nonQaBusinessId, confirm: qaConfirmation },
      statusCode: 400,
      body: { message: 'Solicitud invalida' }
    })
    await assertQaMaintenanceDenial({
      name: 'QA maintenance rejects configured non-QA business',
      qaBusinessId: nonQaBusinessId,
      user: 'superAdmin',
      payload: { businessId: nonQaBusinessId, confirm: qaConfirmation },
      statusCode: 409,
      body: { message: 'El recurso cambio de estado' }
    })
    await assertQaMaintenanceDenial({
      name: 'QA maintenance rejects missing configured business',
      qaBusinessId: resources.missing,
      user: 'superAdmin',
      payload: { businessId: resources.missing, confirm: qaConfirmation },
      statusCode: 403,
      body: { message: 'No tenes acceso a ese comercio' }
    })

    process.env.QA_BUSINESS_ID = qaBusinessId
    const nonQaTenantBeforeCleanup = await qaMaintenanceSnapshot()
    const qaCleanup = await app.inject({
      method: 'POST',
      url: '/crm/maintenance/delete-qa-data',
      headers: { cookie: businessAuthorizationFixtureCookie('superAdmin') },
      payload: { businessId: qaBusinessId, confirm: qaConfirmation }
    })
    assert.equal(qaCleanup.statusCode, 200)
    const qaCleanupBody = qaCleanup.json() as { businessId: string; deleted: Record<string, number> }
    assert.equal(qaCleanupBody.businessId, qaBusinessId)
    assert.deepEqual(qaCleanupBody.deleted, {
      deposits: 1,
      messages: 1,
      conversations: 1,
      appointments: 1,
      notes: 1,
      customers: 1
    })
    const afterQaCleanup = await qaMaintenanceSnapshot()
    const includesId = (ids: readonly string[], id: string) => ids.includes(id)
    assert.deepEqual({
      customers: afterQaCleanup.customers.filter(({ businessId }) => businessId === nonQaBusinessId),
      appointments: afterQaCleanup.appointments.filter(({ professionalId }) => professionalId === resources.professional[1]),
      deposits: afterQaCleanup.deposits.filter(({ businessId }) => businessId === nonQaBusinessId),
      conversations: afterQaCleanup.conversations.filter(({ businessId }) => businessId === nonQaBusinessId),
      messages: afterQaCleanup.messages.filter(({ conversationId }) => conversationId === resources.qaConversation[1]),
      notes: afterQaCleanup.notes.filter(({ customerId }) => customerId === resources.qaCustomer[1])
    }, {
      customers: nonQaTenantBeforeCleanup.customers.filter(({ businessId }) => businessId === nonQaBusinessId),
      appointments: nonQaTenantBeforeCleanup.appointments.filter(({ professionalId }) => professionalId === resources.professional[1]),
      deposits: nonQaTenantBeforeCleanup.deposits.filter(({ businessId }) => businessId === nonQaBusinessId),
      conversations: nonQaTenantBeforeCleanup.conversations.filter(({ businessId }) => businessId === nonQaBusinessId),
      messages: nonQaTenantBeforeCleanup.messages.filter(({ conversationId }) => conversationId === resources.qaConversation[1]),
      notes: nonQaTenantBeforeCleanup.notes.filter(({ customerId }) => customerId === resources.qaCustomer[1])
    }, 'QA cleanup must preserve the other tenant byte-for-byte')
    assert.deepEqual({
      customers: afterQaCleanup.customers.filter(({ id }) => includesId(resources.customer, id)),
      appointments: afterQaCleanup.appointments.filter(({ id }) => includesId(resources.appointment, id) || id === resources.otherAppointment),
      deposits: afterQaCleanup.deposits.filter(({ id }) => includesId(resources.deposit, id)),
      conversations: afterQaCleanup.conversations.filter(({ id }) => includesId(resources.conversation, id) || id === resources.nullConversation),
      messages: afterQaCleanup.messages.filter(({ id }) => includesId(resources.message, id) || id === resources.nullMessage),
      notes: afterQaCleanup.notes.filter(({ id }) => includesId(resources.customerNote, id))
    }, {
      customers: nonQaTenantBeforeCleanup.customers.filter(({ id }) => includesId(resources.customer, id)),
      appointments: nonQaTenantBeforeCleanup.appointments.filter(({ id }) => includesId(resources.appointment, id) || id === resources.otherAppointment),
      deposits: nonQaTenantBeforeCleanup.deposits.filter(({ id }) => includesId(resources.deposit, id)),
      conversations: nonQaTenantBeforeCleanup.conversations.filter(({ id }) => includesId(resources.conversation, id) || id === resources.nullConversation),
      messages: nonQaTenantBeforeCleanup.messages.filter(({ id }) => includesId(resources.message, id) || id === resources.nullMessage),
      notes: nonQaTenantBeforeCleanup.notes.filter(({ id }) => includesId(resources.customerNote, id))
    }, 'QA cleanup must preserve non-matching records byte-for-byte')
    assert.equal(afterQaCleanup.customers.some(({ id }) => id === resources.qaCustomer[0]), false)
    assert.equal(afterQaCleanup.appointments.some(({ id }) => id === resources.qaAppointment[0]), false)
    assert.equal(afterQaCleanup.deposits.some(({ id }) => id === resources.qaDeposit[0]), false)
    assert.equal(afterQaCleanup.conversations.some(({ id }) => id === resources.qaConversation[0]), false)
    assert.equal(afterQaCleanup.messages.some(({ id }) => id === resources.qaMessage[0]), false)
    assert.equal(afterQaCleanup.notes.some(({ id }) => id === resources.qaNote[0]), false)

    const directWhatsAppStart = providerFakes.calls.whatsapp.length
    const firstWhatsApp = await app.authorizationProviders.whatsapp.sendTextMessage({
      businessId: businessAuthorizationFixture.businessIds[0],
      to: '5491100000001',
      text: 'Fixture A'
    })
    const secondWhatsApp = await app.authorizationProviders.whatsapp.sendTextMessage({
      businessId: businessAuthorizationFixture.businessIds[1],
      to: '5491100000002',
      text: 'Fixture B'
    })
    assert.deepEqual(
      [firstWhatsApp, secondWhatsApp].map((result) =>
        result.sent
          ? (result.response as { messages?: Array<{ id?: string }> }).messages?.[0]?.id
          : undefined
      ),
      [
        `fake-whatsapp-${directWhatsAppStart + 1}`,
        `fake-whatsapp-${directWhatsAppStart + 2}`
      ]
    )
    assert.deepEqual(
      providerFakes.calls.whatsapp.slice(directWhatsAppStart).map(({ businessId }) => businessId),
      [...businessAuthorizationFixture.businessIds]
    )
  } finally {
    await app.close()
  }
} finally {
  globalThis.fetch = originalFetch
  if (originalQaBusinessId === undefined) delete process.env.QA_BUSINESS_ID
  else process.env.QA_BUSINESS_ID = originalQaBusinessId
  await cleanBusinessAuthorizationFixtures(prisma)
  await prisma.$disconnect()
}

console.log('Business authorization Batches 1-8 contract tests passed')
