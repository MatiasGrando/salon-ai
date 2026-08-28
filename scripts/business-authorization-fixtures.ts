import type { PrismaClient } from '../src/generated/prisma/client.js'
import { createHash } from 'node:crypto'

const fixturePrefix = 'sdd-auth-batch-1'

export const businessAuthorizationFixture = {
  businessIds: [
    `${fixturePrefix}-business-a`,
    `${fixturePrefix}-business-b`
  ] as const,
  qaSandboxBusinessId: `${fixturePrefix}-business-qa-sandbox`,
  unassignedRealBusinessId: `${fixturePrefix}-business-real-unassigned`,
  users: {
    superAdmin: { id: `${fixturePrefix}-super`, role: 'SUPER_ADMIN', businessId: null, canCreateBusinesses: true },
    currentAccountAdmin: { id: `${fixturePrefix}-account-current`, role: 'ACCOUNT_ADMIN', businessId: null, canCreateBusinesses: true },
    formerAccountAdmin: { id: `${fixturePrefix}-account-former`, role: 'ACCOUNT_ADMIN', businessId: null, canCreateBusinesses: true },
    otherAccountAdmin: { id: `${fixturePrefix}-account-other`, role: 'ACCOUNT_ADMIN', businessId: null, canCreateBusinesses: true },
    businessAdmin: { id: `${fixturePrefix}-business-admin`, role: 'BUSINESS_ADMIN', businessId: `${fixturePrefix}-business-a`, canCreateBusinesses: false },
    staffOwn: { id: `${fixturePrefix}-staff-own`, role: 'STAFF', businessId: `${fixturePrefix}-business-a`, canCreateBusinesses: false },
    staffAll: { id: `${fixturePrefix}-staff-all`, role: 'STAFF', businessId: `${fixturePrefix}-business-a`, canCreateBusinesses: false },
    creatorOnly: { id: `${fixturePrefix}-creator-only`, role: 'BUSINESS_ADMIN', businessId: `${fixturePrefix}-business-a`, canCreateBusinesses: true },
    foreignStaff: { id: `${fixturePrefix}-staff-foreign`, role: 'STAFF', businessId: `${fixturePrefix}-business-b`, canCreateBusinesses: false }
  } as const,
  resources: {
    professional: [`${fixturePrefix}-professional-a`, `${fixturePrefix}-professional-b`],
    otherProfessional: `${fixturePrefix}-professional-a-other`,
    service: [`${fixturePrefix}-service-a`, `${fixturePrefix}-service-b`],
    addonService: [`${fixturePrefix}-addon-a`, `${fixturePrefix}-addon-b`],
    serviceCategory: [`${fixturePrefix}-category-a`, `${fixturePrefix}-category-b`],
    campaign: [`${fixturePrefix}-campaign-a`, `${fixturePrefix}-campaign-b`],
    whatsAppTemplate: [`${fixturePrefix}-template-a`, `${fixturePrefix}-template-b`],
    reminderAutomation: [`${fixturePrefix}-reminder-a`, `${fixturePrefix}-reminder-b`],
    campaignDelivery: [`${fixturePrefix}-campaign-delivery-a`, `${fixturePrefix}-campaign-delivery-b`],
    customer: [`${fixturePrefix}-customer-a`, `${fixturePrefix}-customer-b`],
    deletableCustomer: `${fixturePrefix}-customer-a-deletable`,
    customerNote: [`${fixturePrefix}-note-a`, `${fixturePrefix}-note-b`, `${fixturePrefix}-note-null`],
    qaCustomer: [`${fixturePrefix}-qa-customer-a`, `${fixturePrefix}-qa-customer-b`],
    appointment: [`${fixturePrefix}-appointment-a`, `${fixturePrefix}-appointment-b`],
    otherAppointment: `${fixturePrefix}-appointment-a-other`,
    qaAppointment: [`${fixturePrefix}-qa-appointment-a`, `${fixturePrefix}-qa-appointment-b`],
    conversation: [`${fixturePrefix}-conversation-a`, `${fixturePrefix}-conversation-b`],
    qaConversation: [`${fixturePrefix}-qa-conversation-a`, `${fixturePrefix}-qa-conversation-b`],
    message: [`${fixturePrefix}-message-a`, `${fixturePrefix}-message-b`],
    qaMessage: [`${fixturePrefix}-qa-message-a`, `${fixturePrefix}-qa-message-b`],
    deposit: [`${fixturePrefix}-deposit-a`, `${fixturePrefix}-deposit-b`],
    qaDeposit: [`${fixturePrefix}-qa-deposit-a`, `${fixturePrefix}-qa-deposit-b`],
    qaNote: [`${fixturePrefix}-qa-note-a`, `${fixturePrefix}-qa-note-b`],
    scheduleBlock: [`${fixturePrefix}-block-a`, `${fixturePrefix}-block-b`],
    otherScheduleBlock: `${fixturePrefix}-block-a-other`,
    adminScheduleBlock: `${fixturePrefix}-block-a-admin`,
    nullCustomer: `${fixturePrefix}-customer-null`,
    nullConversation: `${fixturePrefix}-conversation-null`,
    nullMessage: `${fixturePrefix}-message-null`,
    random: `${fixturePrefix}-resource-random`,
    missing: `${fixturePrefix}-resource-missing`
  } as const,
  fixedNow: new Date('2026-08-22T12:00:00.000Z'),
  createClock() {
    return () => new Date(this.fixedNow)
  }
}

export type BusinessAuthorizationFixtureUser = keyof typeof businessAuthorizationFixture.users

export function businessAuthorizationFixtureCookie(user: BusinessAuthorizationFixtureUser) {
  return `salon_ai_session=${fixtureToken(user)}`
}

export async function cleanBusinessAuthorizationFixtures(prisma: PrismaClient) {
  const userIds = Object.values(businessAuthorizationFixture.users).map(({ id }) => id)
  const resources = businessAuthorizationFixture.resources
  await prisma.campaignDelivery.deleteMany({ where: { id: { in: [...resources.campaignDelivery] } } })
  await prisma.campaign.deleteMany({ where: { id: { in: [...resources.campaign] } } })
  await prisma.reminderAutomation.deleteMany({ where: { id: { in: [...resources.reminderAutomation] } } })
  await prisma.whatsAppTemplate.deleteMany({ where: { id: { in: [...resources.whatsAppTemplate] } } })
  await prisma.bookingDeposit.deleteMany({ where: { id: { in: [...resources.deposit, ...resources.qaDeposit] } } })
  await prisma.message.deleteMany({
    where: {
      conversationId: {
        in: [...resources.conversation, ...resources.qaConversation, resources.nullConversation]
      }
    }
  })
  await prisma.conversation.deleteMany({
    where: { id: { in: [...resources.conversation, ...resources.qaConversation, resources.nullConversation] } }
  })
  await prisma.scheduleBlock.deleteMany({
    where: { id: { in: [...resources.scheduleBlock, resources.otherScheduleBlock, resources.adminScheduleBlock] } }
  })
  await prisma.appointment.deleteMany({
    where: {
      OR: [
        { id: { in: [...resources.appointment, ...resources.qaAppointment, resources.otherAppointment] } },
        { customerId: { in: [...resources.customer, ...resources.qaCustomer] } }
      ]
    }
  })
  await prisma.customer.deleteMany({
    where: { id: { in: [...resources.customer, ...resources.qaCustomer, resources.deletableCustomer, resources.nullCustomer] } }
  })
  await prisma.serviceAlias.deleteMany({
    where: { serviceId: { in: [...resources.service, ...resources.addonService] } }
  })
  await prisma.professionalHours.deleteMany({
    where: { professionalId: { in: [...resources.professional, resources.otherProfessional] } }
  })
  await prisma.businessHours.deleteMany({
    where: { businessId: { in: [...businessAuthorizationFixture.businessIds] } }
  })
  await prisma.service.deleteMany({ where: { id: { in: [...resources.service, ...resources.addonService] } } })
  await prisma.serviceCategory.deleteMany({ where: { id: { in: [...resources.serviceCategory] } } })
  await prisma.professional.deleteMany({
    where: { id: { in: [...resources.professional, resources.otherProfessional] } }
  })
  await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.business.deleteMany({
    where: {
      id: {
        in: [
          ...businessAuthorizationFixture.businessIds,
          businessAuthorizationFixture.qaSandboxBusinessId,
          businessAuthorizationFixture.unassignedRealBusinessId
        ]
      }
    }
  })
}

export async function createBusinessAuthorizationFixtures(prisma: PrismaClient) {
  await cleanBusinessAuthorizationFixtures(prisma)
  const accountUsers = [
    businessAuthorizationFixture.users.superAdmin,
    businessAuthorizationFixture.users.currentAccountAdmin,
    businessAuthorizationFixture.users.formerAccountAdmin,
    businessAuthorizationFixture.users.otherAccountAdmin
  ]
  await prisma.user.createMany({
    data: accountUsers.map((user) => ({
      ...user,
      email: `${user.id}@fixture.invalid`,
      name: user.id,
      passwordHash: 'fixture-not-used'
    }))
  })
  await prisma.business.createMany({
    data: [
      {
        id: businessAuthorizationFixture.businessIds[0],
        customerCode: `${fixturePrefix}-1`,
        name: 'Authorization Fixture 1',
        accountStatus: 'ACTIVE',
        accountAdminId: businessAuthorizationFixture.users.currentAccountAdmin.id,
        createdByUserId: businessAuthorizationFixture.users.formerAccountAdmin.id
      },
      {
        id: businessAuthorizationFixture.businessIds[1],
        customerCode: `${fixturePrefix}-2`,
        name: 'Authorization Fixture 2',
        slug: `${fixturePrefix}-commercial-demo`,
        accountStatus: 'ACTIVE',
        isDemo: true,
        demoType: 'NAILS',
        botEnabled: false,
        aiEnabled: false,
        accountAdminId: businessAuthorizationFixture.users.otherAccountAdmin.id
      },
      {
        id: businessAuthorizationFixture.qaSandboxBusinessId,
        customerCode: `${fixturePrefix}-qa`,
        name: 'Authorization QA Sandbox',
        accountStatus: 'ACTIVE',
        isDemo: true,
        demoType: 'QA_SANDBOX',
        accountAdminId: businessAuthorizationFixture.users.currentAccountAdmin.id
      },
      {
        id: businessAuthorizationFixture.unassignedRealBusinessId,
        customerCode: `${fixturePrefix}-real-unassigned`,
        name: 'Authorization Unassigned Real Business',
        accountStatus: 'ACTIVE',
        accountAdminId: businessAuthorizationFixture.users.otherAccountAdmin.id
      }
    ]
  })
  const tenantUsers = [
    businessAuthorizationFixture.users.businessAdmin,
    businessAuthorizationFixture.users.staffOwn,
    businessAuthorizationFixture.users.staffAll,
    businessAuthorizationFixture.users.creatorOnly,
    businessAuthorizationFixture.users.foreignStaff
  ]
  await prisma.user.createMany({
    data: tenantUsers.map((user) => ({
      ...user,
      email: `${user.id}@fixture.invalid`,
      name: user.id,
      passwordHash: 'fixture-not-used',
      ...(user.id === businessAuthorizationFixture.users.staffAll.id
        ? { agendaScope: 'ALL', staffProfile: 'SECRETARY', canForceAppointments: true }
        : {})
    }))
  })
  await prisma.userSession.createMany({
    data: (Object.keys(businessAuthorizationFixture.users) as BusinessAuthorizationFixtureUser[]).map((user) => ({
      id: `${fixturePrefix}-session-${user}`,
      tokenHash: createHash('sha256').update(fixtureToken(user)).digest('hex'),
      userId: businessAuthorizationFixture.users[user].id,
      expiresAt: new Date('2027-08-22T12:00:00.000Z')
    }))
  })
  const resources = businessAuthorizationFixture.resources
  const businesses = businessAuthorizationFixture.businessIds
  await prisma.professional.createMany({
    data: [
      ...resources.professional.map((id, index) => ({
        id,
        name: `Authorization Professional ${index + 1}`,
        businessId: businesses[index]!
      })),
      {
        id: resources.otherProfessional,
        name: 'Authorization Professional 1 Other',
        businessId: businesses[0]
      }
    ]
  })
  await prisma.businessHours.createMany({
    data: businesses.flatMap((businessId) => Array.from({ length: 7 }, (_, dayOfWeek) => ({
      businessId,
      dayOfWeek,
      startTime: '00:00',
      endTime: '23:59'
    })))
  })
  await prisma.professionalHours.createMany({
    data: [...resources.professional, resources.otherProfessional].flatMap((professionalId) =>
      Array.from({ length: 7 }, (_, dayOfWeek) => ({
        professionalId,
        dayOfWeek,
        startTime: '00:00',
        endTime: '23:59'
      }))
    )
  })
  await prisma.user.update({
    where: { id: businessAuthorizationFixture.users.staffOwn.id },
    data: { professionalId: resources.professional[0] }
  })
  await prisma.service.createMany({
    data: [
      ...resources.service.map((id, index) => ({
        id,
        name: `Authorization Service ${index + 1}`,
        duration: 30,
        businessId: businesses[index]!
      })),
      ...resources.addonService.map((id, index) => ({
        id,
        name: `Authorization Add-on ${index + 1}`,
        duration: 15,
        businessId: businesses[index]!
      }))
    ]
  })
  await prisma.serviceCategory.createMany({
    data: resources.serviceCategory.map((id, index) => ({
      id,
      name: `Authorization Category ${index + 1}`,
      businessId: businesses[index]!
    }))
  })
  await prisma.professionalService.createMany({
    data: [
      { professionalId: resources.professional[0], serviceId: resources.service[0] },
      { professionalId: resources.professional[0], serviceId: resources.addonService[0] },
      { professionalId: resources.otherProfessional, serviceId: resources.service[0] },
      { professionalId: resources.professional[1], serviceId: resources.service[1] },
      { professionalId: resources.professional[1], serviceId: resources.addonService[1] }
    ]
  })
  await prisma.serviceAddon.createMany({
    data: resources.service.map((sourceServiceId, index) => ({
      sourceServiceId,
      addonServiceId: resources.addonService[index]!
    }))
  })
  await prisma.customer.createMany({
    data: [
      ...resources.customer.map((id, index) => ({
        id,
        name: `Authorization Customer ${index + 1}`,
        phone: `549110000001${index}`,
        normalizedPhone: `549110000001${index}`,
        businessId: businesses[index]!
      })),
      ...resources.qaCustomer.map((id, index) => ({
        id,
        name: `Authorization QA Customer ${index + 1}`,
        phone: `qa-cami-shared-pattern-${index + 1}`,
        normalizedPhone: `qa-cami-shared-pattern-${index + 1}`,
        businessId: businesses[index]!
      })),
      {
        id: resources.deletableCustomer,
        name: 'Authorization Deletable Customer',
        phone: '5491100000066',
        normalizedPhone: '5491100000066',
        businessId: businesses[0]
      },
      {
        id: resources.nullCustomer,
        name: 'Authorization Null Customer',
        phone: '5491100000099',
        normalizedPhone: '5491100000099',
        businessId: null
      }
    ]
  })
  await prisma.customerNote.createMany({
    data: [
      { id: resources.customerNote[0], customerId: resources.customer[0], body: 'Authorization Note 1' },
      { id: resources.customerNote[1], customerId: resources.customer[1], body: 'Authorization Note 2' },
      { id: resources.customerNote[2], customerId: resources.nullCustomer, body: 'Authorization Null Note' },
      { id: resources.qaNote[0], customerId: resources.qaCustomer[0], body: 'Authorization QA Note 1' },
      { id: resources.qaNote[1], customerId: resources.qaCustomer[1], body: 'Authorization QA Note 2' }
    ]
  })
  await prisma.customerMarketingPreference.createMany({
    data: [
      { businessId: businesses[0], customerId: resources.customer[0], status: 'ACTIVE', source: 'MANUAL' },
      { businessId: businesses[1], customerId: resources.customer[1], status: 'DECLINED', source: 'MANUAL' },
      { businessId: businesses[0], customerId: resources.nullCustomer, status: 'OPTED_OUT', source: 'MANUAL' }
    ]
  })
  await prisma.whatsAppTemplate.createMany({
    data: resources.whatsAppTemplate.map((id, index) => ({
      id,
      businessId: businesses[index]!,
      internalName: `Authorization Template ${index + 1}`,
      metaName: `authorization_template_${index + 1}`,
      body: 'Hola {{nombre_cliente}}',
      exampleJson: JSON.stringify({ nombre_cliente: 'Cliente' })
    }))
  })
  await prisma.reminderAutomation.createMany({
    data: resources.reminderAutomation.map((id, index) => ({
      id,
      businessId: businesses[index]!,
      name: `Authorization Reminder ${index + 1}`,
      mode: 'PAUSED'
    }))
  })
  await prisma.campaign.createMany({
    data: resources.campaign.map((id, index) => ({
      id,
      businessId: businesses[index]!,
      name: `Authorization Campaign ${index + 1}`,
      message: 'Authorization campaign fixture'
    }))
  })
  await prisma.campaignDelivery.createMany({
    data: resources.campaignDelivery.map((id, index) => ({
      id,
      businessId: businesses[index]!,
      campaignId: resources.campaign[index]!,
      customerId: resources.customer[index]!,
      status: 'SENT'
    }))
  })
  await prisma.appointment.createMany({
    data: [
      ...resources.appointment.map((id, index) => ({
        id,
        customerId: resources.customer[index]!,
        professionalId: resources.professional[index]!,
        serviceId: resources.service[index]!,
        startAt: new Date(`2026-08-${24 + index}T12:00:00.000Z`),
        totalDurationMinutes: 30,
        coordinationGroupId: `${fixturePrefix}-cross-tenant-coordination`,
        status: 'PENDING' as const
      })),
      {
        id: resources.otherAppointment,
        customerId: resources.customer[0],
        professionalId: resources.otherProfessional,
        serviceId: resources.service[0],
        startAt: new Date('2026-09-03T12:00:00.000Z'),
        totalDurationMinutes: 30,
        status: 'CONFIRMED' as const
      },
      ...resources.qaAppointment.map((id, index) => ({
        id,
        customerId: resources.qaCustomer[index]!,
        professionalId: resources.professional[index]!,
        serviceId: resources.service[index]!,
        startAt: new Date(`2026-09-0${4 + index}T12:00:00.000Z`),
        totalDurationMinutes: 30,
        status: 'PENDING' as const
      }))
    ]
  })
  await prisma.conversation.createMany({
    data: [
      ...resources.conversation.map((id, index) => ({
        id,
        phone: `549110000002${index}`,
        businessId: businesses[index]!
      })),
      ...resources.qaConversation.map((id, index) => ({
        id,
        phone: `qa-cami-shared-pattern-${index + 1}`,
        businessId: businesses[index]!,
        updatedAt: businessAuthorizationFixture.fixedNow
      })),
      {
        id: resources.nullConversation,
        phone: '5491100000088',
        businessId: null
      }
    ]
  })
  await prisma.message.createMany({
    data: [
      ...resources.message.map((id, index) => ({
        id,
        conversationId: resources.conversation[index]!,
        phone: `549110000003${index}`,
        direction: 'INBOUND' as const,
        body: `Authorization Message ${index + 1}`,
        metadata: {
          media: {
            id: `${fixturePrefix}-media-${index + 1}`,
            type: 'image',
            filename: `fixture-${index + 1}.png`
          }
        }
      })),
      ...resources.qaMessage.map((id, index) => ({
        id,
        conversationId: resources.qaConversation[index]!,
        phone: `qa-cami-shared-pattern-${index + 1}`,
        direction: 'INBOUND' as const,
        body: `Authorization QA Message ${index + 1}`,
        createdAt: businessAuthorizationFixture.fixedNow
      })),
      {
        id: resources.nullMessage,
        conversationId: resources.nullConversation,
        phone: '5491100000077',
        direction: 'INBOUND' as const,
        body: 'Authorization Null Message'
      }
    ]
  })
  await prisma.bookingDeposit.createMany({
    data: [
      ...resources.deposit.map((id, index) => ({
        id,
        businessId: businesses[index]!,
        appointmentId: resources.appointment[index]!,
        conversationId: resources.conversation[index]!,
        mode: 'FIXED' as const,
        configuredValue: 100,
        amount: 100,
        expiresAt: new Date('2026-08-30T12:00:00.000Z'),
        source: 'WEB' as const,
        status: 'PROOF_RECEIVED' as const,
        proofData: Buffer.from(`authorization-proof-${index + 1}`),
        proofMimeType: 'image/png',
        proofFilename: `proof-${index + 1}.png`
      })),
      ...resources.qaDeposit.map((id, index) => ({
        id,
        businessId: businesses[index]!,
        appointmentId: resources.qaAppointment[index]!,
        conversationId: resources.qaConversation[index]!,
        mode: 'FIXED' as const,
        configuredValue: 100,
        amount: 100,
        expiresAt: new Date('2026-09-10T12:00:00.000Z'),
        source: 'WHATSAPP' as const,
        status: 'PENDING_PROOF' as const
      }))
    ]
  })
  await prisma.scheduleBlock.createMany({
    data: [
      ...resources.scheduleBlock.map((id, index) => ({
        id,
        businessId: businesses[index]!,
        professionalId: resources.professional[index]!,
        reason: 'OTHER' as const,
        title: `Authorization Block ${index + 1}`,
        startAt: new Date(`2026-08-${26 + index}T12:00:00.000Z`),
        endAt: new Date(`2026-08-${26 + index}T13:00:00.000Z`)
      })),
      {
        id: resources.otherScheduleBlock,
        businessId: businesses[0],
        professionalId: resources.otherProfessional,
        reason: 'OTHER' as const,
        title: 'Authorization Block 1 Other',
        startAt: new Date('2026-08-28T12:00:00.000Z'),
        endAt: new Date('2026-08-28T13:00:00.000Z')
      },
      {
        id: resources.adminScheduleBlock,
        businessId: businesses[0],
        professionalId: resources.otherProfessional,
        reason: 'OTHER' as const,
        title: 'Authorization Block 1 Admin',
        startAt: new Date('2026-08-29T12:00:00.000Z'),
        endAt: new Date('2026-08-29T13:00:00.000Z')
      }
    ]
  })
  await prisma.businessWhatsAppConfig.createMany({
    data: businesses.map((businessId, index) => ({
      businessId,
      connectionStatus: 'CONNECTED',
      wabaId: `${fixturePrefix}-waba-${index + 1}`,
      phoneNumberId: `${fixturePrefix}-phone-${index + 1}`,
      accessToken: `${fixturePrefix}-token-${index + 1}`
    }))
  })
  await prisma.businessFeatureSettings.createMany({
    data: businesses.map((businessId) => ({
      businessId,
      realWhatsappEnabled: true,
      botEnabled: true
    }))
  })
}

function fixtureToken(user: BusinessAuthorizationFixtureUser) {
  return `${fixturePrefix}-token-${user}`
}
