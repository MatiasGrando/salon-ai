import { Prisma } from '../src/generated/prisma/client.js'
import { resolveQaScriptEnvironment } from './qa-script-safety.js'

const qaEnvironment = resolveQaScriptEnvironment(process.env)
const qaBusinessId = qaEnvironment.businessId
process.env.DATABASE_URL = qaEnvironment.databaseUrl
const { prisma } = await import('../src/config/prisma.js')
const { acquireAgendaHierarchy, lockAppointmentRows } = await import('../src/services/agenda-locks.js')

const sourceSlug = requiredSourceSlug()
const emptyAgenda = process.argv.includes('--empty-agenda')
const optionsBot = process.argv.includes('--options-bot')
if (emptyAgenda && optionsBot) throw new Error('Elegí agenda vacía o bot nuevo, no ambas variantes.')
const sandboxSlug = `${optionsBot ? 'qa-options-bot-sandbox' : emptyAgenda ? 'qa-empty-sandbox' : 'qa-sandbox'}-${sourceSlug}`
const now = new Date()
const occupancyUntil = new Date(now)
occupancyUntil.setDate(occupancyUntil.getDate() + 120)

async function main() {
  const existing = await prisma.business.findUnique({
    where: { id: qaBusinessId },
    select: { id: true, name: true, slug: true, isDemo: true, demoType: true }
  })

  if (existing) {
    if (existing.slug !== sandboxSlug || !existing.isDemo || existing.demoType !== 'QA_SANDBOX') {
      throw new Error(`QA_BUSINESS_ID no identifica el entorno ${sandboxSlug}.`)
    }
    console.log(`Entorno QA existente: ${existing.name} (${sandboxSlug})`)
    if (emptyAgenda) {
      const appointments = await prisma.appointment.findMany({
        where: { professional: { businessId: existing.id } },
        select: { id: true, visitId: true }
      })
      const appointmentIds = appointments.map((appointment) => appointment.id)
      const visitIds = Array.from(new Set(appointments.flatMap((appointment) => appointment.visitId ? [appointment.visitId] : [])))
      const cleared = await prisma.$transaction(async (tx) => {
        await acquireAgendaHierarchy(tx, { businessId: existing.id })
        if (appointmentIds.length) {
          await lockAppointmentRows(tx, { businessId: existing.id, appointmentIds })
          await tx.$executeRaw(Prisma.sql`
            DELETE FROM "BookingDepositExpiryAudit"
            WHERE "businessId" = ${existing.id} AND "depositId" IN (
              SELECT "id" FROM "BookingDeposit" WHERE "businessId" = ${existing.id} AND "appointmentId" IN (${Prisma.join(appointmentIds)})
            )
          `)
          await tx.$executeRaw(Prisma.sql`
            DELETE FROM "BookingDepositLine"
            WHERE "businessId" = ${existing.id} AND "depositId" IN (
              SELECT "id" FROM "BookingDeposit" WHERE "businessId" = ${existing.id} AND "appointmentId" IN (${Prisma.join(appointmentIds)})
            )
          `)
          await tx.bookingDeposit.deleteMany({ where: { appointmentId: { in: appointmentIds }, appointment: { professional: { businessId: existing.id } } } })
          await tx.aiUsageEvent.deleteMany({ where: { appointmentId: { in: appointmentIds }, appointment: { professional: { businessId: existing.id } } } })
          await tx.appointment.deleteMany({ where: { id: { in: appointmentIds }, professional: { businessId: existing.id } } })
          if (visitIds.length) {
            await tx.$executeRaw(Prisma.sql`
              DELETE FROM "BookingVisit"
              WHERE "businessId" = ${existing.id} AND "id" IN (${Prisma.join(visitIds)})
            `)
          }
        }
        const blocks = await tx.scheduleBlock.deleteMany({ where: { businessId: existing.id } })
        await tx.customer.deleteMany({ where: { businessId: existing.id } })
        return blocks
      })
      console.log(`Agenda QA vaciada: ${cleared.count} bloqueos eliminados.`)
      console.log(`Datos operativos QA vaciados: ${appointmentIds.length} turnos eliminados.`)
    } else {
      console.log('No se modificó. Eliminá o renombrá el entorno QA si necesitás regenerarlo.')
    }
    await verifySandbox(existing.id)
    return
  }

  const source = await prisma.business.findUnique({
    where: { slug: sourceSlug },
    include: {
      featureSettings: true,
      paymentSettings: true,
      businessHours: true,
      serviceCategories: {
        include: { aliases: true }
      },
      services: {
        include: {
          aliases: true
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
      },
      professionals: {
        include: {
          workingHours: true,
          serviceLinks: true
        },
        orderBy: { createdAt: 'asc' }
      },
      serviceCombinationRules: true,
      scheduleBlocks: {
        where: { endAt: { gt: now }, startAt: { lt: occupancyUntil } }
      }
    }
  })

  if (!source) throw new Error(`No encontré el comercio con slug ${sourceSlug}.`)

  const sourceServiceIds = source.services.map((service) => service.id)
  const addons = await prisma.serviceAddon.findMany({
      where: {
        sourceServiceId: { in: sourceServiceIds },
        addonServiceId: { in: sourceServiceIds }
      }
    })
  const occupiedAppointments = emptyAgenda
    ? []
    : await prisma.appointment.findMany({
      where: {
        professional: { businessId: source.id },
        status: { in: ['PENDING', 'CONFIRMED'] },
        startAt: { gte: now, lt: occupancyUntil }
      },
      select: { professionalId: true, startAt: true, totalDurationMinutes: true }
    })

  const sandbox = await prisma.$transaction(async (tx) => {
    const {
      id: _sourceId,
      customerCode: _customerCode,
      slug: _sourceSlug,
      isDemo: _isDemo,
      demoType: _demoType,
      createdAt: _createdAt,
      ...businessData
    } = source
    const {
      featureSettings: _featureSettings,
      paymentSettings: _paymentSettings,
      businessHours: _businessHours,
      serviceCategories: _serviceCategories,
      services: _services,
      professionals: _professionals,
      serviceCombinationRules: _serviceCombinationRules,
      scheduleBlocks: _scheduleBlocks,
      ...businessScalars
    } = businessData

    const created = await tx.business.create({
      data: {
        id: qaBusinessId,
        ...businessScalars,
        customerCode: `QA-${Date.now().toString(36).toUpperCase()}`,
        name: `${source.name} · QA aislado${optionsBot ? ' · bot nuevo' : emptyAgenda ? ' · agenda vacía' : ''}`,
        slug: sandboxSlug,
        isDemo: true,
        demoType: 'QA_SANDBOX',
        landingEnabled: false,
        botEnabled: true,
        aiEnabled: true
      } as Prisma.BusinessUncheckedCreateInput
    })
    await acquireAgendaHierarchy(tx, { businessId: created.id, professionalIds: [] })

    if (source.featureSettings) {
      const {
        id: _id,
        businessId: _businessId,
        createdAt: _settingsCreatedAt,
        updatedAt: _settingsUpdatedAt,
        ...settings
      } = source.featureSettings
      await tx.businessFeatureSettings.create({
        data: {
          ...settings,
          businessId: created.id,
          botEnabled: true,
          aiEnabled: true,
          realWhatsappEnabled: false,
          campaignsEnabled: false,
          remindersEnabled: false,
          campaignSendingLocked: true,
          reminderSendingLocked: true
        } as Prisma.BusinessFeatureSettingsUncheckedCreateInput
      })
    }

    if (source.paymentSettings) {
      const {
        id: _id,
        businessId: _businessId,
        createdAt: _paymentCreatedAt,
        updatedAt: _paymentUpdatedAt,
        ...paymentSettings
      } = source.paymentSettings
      await tx.businessPaymentSettings.create({
        data: { ...paymentSettings, businessId: created.id }
      })
    }

    await tx.businessHours.createMany({
      data: source.businessHours.map(({ id: _id, businessId: _businessId, ...hours }) => ({
        ...hours,
        businessId: created.id
      }))
    })

    const categoryIds = new Map<string, string>()
    for (const category of source.serviceCategories) {
      const {
        id: sourceCategoryId,
        businessId: _businessId,
        createdAt: _categoryCreatedAt,
        updatedAt: _categoryUpdatedAt,
        aliases,
        ...categoryData
      } = category
      const copy = await tx.serviceCategory.create({
        data: {
          ...categoryData,
          businessId: created.id,
          ...(aliases.length
            ? {
                aliases: {
                  create: aliases.map((alias) => ({
                    name: alias.name,
                    normalizedName: alias.normalizedName
                  }))
                }
              }
            : {})
        }
      })
      categoryIds.set(sourceCategoryId, copy.id)
    }

    const serviceIds = new Map<string, string>()
    for (const service of source.services) {
      const {
        id: sourceServiceId,
        businessId: _businessId,
        catalogCategoryId,
        parentServiceId: _parentServiceId,
        createdAt: _serviceCreatedAt,
        aliases: _aliases,
        ...serviceData
      } = service
      const copy = await tx.service.create({
        data: {
          ...serviceData,
          businessId: created.id,
          catalogCategoryId: catalogCategoryId ? categoryIds.get(catalogCategoryId) ?? null : null,
          parentServiceId: null
        } as Prisma.ServiceUncheckedCreateInput
      })
      serviceIds.set(sourceServiceId, copy.id)
    }

    for (const service of source.services) {
      if (!service.parentServiceId) continue
      const copiedId = serviceIds.get(service.id)
      const copiedParentId = serviceIds.get(service.parentServiceId)
      if (copiedId && copiedParentId) {
        await tx.service.update({ where: { id: copiedId }, data: { parentServiceId: copiedParentId } })
      }
    }

    await tx.serviceAlias.createMany({
      data: source.services.flatMap((service) => {
        const serviceId = serviceIds.get(service.id)
        return serviceId ? service.aliases.map((alias) => ({ name: alias.name, serviceId })) : []
      })
    })

    const professionalIds = new Map<string, string>()
    for (const professional of source.professionals) {
      const {
        id: sourceProfessionalId,
        businessId: _businessId,
        createdAt: _professionalCreatedAt,
        workingHours: _workingHours,
        serviceLinks: _serviceLinks,
        ...professionalData
      } = professional
      const copy = await tx.professional.create({
        data: { ...professionalData, businessId: created.id }
      })
      professionalIds.set(sourceProfessionalId, copy.id)

      await tx.professionalHours.createMany({
        data: professional.workingHours.map((hours) => ({
          professionalId: copy.id,
          dayOfWeek: hours.dayOfWeek,
          startTime: hours.startTime,
          endTime: hours.endTime
        }))
      })
    }

    await tx.professionalService.createMany({
      data: source.professionals.flatMap((professional) => {
        const professionalId = professionalIds.get(professional.id)
        if (!professionalId) return []
        return professional.serviceLinks.flatMap((link) => {
          const serviceId = serviceIds.get(link.serviceId)
          return serviceId ? [{ professionalId, serviceId }] : []
        })
      })
    })

    await tx.serviceAddon.createMany({
      data: addons.flatMap((addon) => {
        const sourceServiceId = serviceIds.get(addon.sourceServiceId)
        const addonServiceId = serviceIds.get(addon.addonServiceId)
        return sourceServiceId && addonServiceId
          ? [{ sourceServiceId, addonServiceId, sortOrder: addon.sortOrder }]
          : []
      })
    })

    await tx.serviceCombinationRule.createMany({
      data: source.serviceCombinationRules.flatMap((rule) => {
        const serviceAId = serviceIds.get(rule.serviceAId)
        const serviceBId = serviceIds.get(rule.serviceBId)
        return serviceAId && serviceBId
          ? [{ businessId: created.id, serviceAId, serviceBId, policy: rule.policy, note: rule.note }]
          : []
      })
    })

    await tx.scheduleBlock.createMany({
      data: [
        ...(emptyAgenda ? [] : source.scheduleBlocks).flatMap((block) => {
          const professionalId = block.professionalId
            ? professionalIds.get(block.professionalId) ?? null
            : null
          if (block.professionalId && !professionalId) return []
          return [{
            businessId: created.id,
            professionalId,
            reason: block.reason,
            title: block.title,
            note: 'Copia aislada de disponibilidad para QA',
            startAt: block.startAt,
            endAt: block.endAt
          }]
        }),
        ...occupiedAppointments.flatMap((appointment) => {
          const professionalId = professionalIds.get(appointment.professionalId)
          if (!professionalId) return []
          return [{
            businessId: created.id,
            professionalId,
            reason: 'OTHER' as const,
            title: 'Ocupación reflejada para QA',
            note: 'No contiene datos del cliente ni del turno original',
            startAt: appointment.startAt,
            endAt: new Date(appointment.startAt.getTime() + appointment.totalDurationMinutes * 60_000)
          }]
        })
      ]
    })

    if (optionsBot) {
      const phoneNumberId = `qa-demo-${created.id}`
      const configuration = await tx.businessBotConfiguration.create({
        data: { businessId: created.id, botKey: 'deterministic-options', name: 'Bot nuevo · simulador QA', version: 'v1', status: 'ACTIVE', channel: 'WHATSAPP', phoneNumberId, definition: { qaSimulator: true } }
      })
      await tx.botChannelDeployment.create({
        data: { businessId: created.id, engineKey: 'deterministic-options', activeConfigurationId: configuration.id, generation: 1, legacyDispatchCoverageVersion: 1, activatedAt: now }
      })
      await tx.businessWhatsAppConfig.create({
        data: { businessId: created.id, connectionStatus: 'CONNECTED', phoneNumberId, appSecret: `qa-demo-secret-${created.id}`, lastError: 'Canal sintético exclusivo del simulador; no enviar a Meta.' }
      })
      await tx.businessBotOptionsSettings.create({
        data: { businessId: created.id, timezone: process.env.QA_BUSINESS_TIMEZONE?.trim() || 'America/Argentina/Buenos_Aires' }
      })
    }

    return created
  }, { timeout: 30_000 })

  console.log(`Entorno QA creado: ${sandbox.name}`)
  console.log(`Slug: ${sandbox.slug}`)
  console.log(`Servicios: ${source.services.length}`)
  console.log(`Profesionales: ${source.professionals.length}`)
  console.log(`Bloqueos operativos copiados: ${source.scheduleBlocks.length}`)
  console.log(`Turnos reflejados como ocupación: ${occupiedAppointments.length}`)
  console.log('WhatsApp real, campañas y recordatorios quedaron bloqueados.')
  await verifySandbox(sandbox.id)
}

async function verifySandbox(businessId: string) {
  const [business, whatsappConfigs, instagramConfigs, botConfigurations, conversations, appointments, customers] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        isDemo: true,
        demoType: true,
        aiEnabled: true,
        services: { select: { id: true } },
        professionals: { select: { id: true } },
        featureSettings: {
          select: {
            realWhatsappEnabled: true,
            aiEnabled: true,
            bookingV2Enabled: true,
            campaignsEnabled: true,
            remindersEnabled: true,
            campaignSendingLocked: true,
            reminderSendingLocked: true
          }
        }
      }
    }),
    prisma.businessWhatsAppConfig.count({ where: { businessId } }),
    prisma.businessInstagramConfig.count({ where: { businessId } }),
    prisma.businessBotConfiguration.count({ where: { businessId } }),
    prisma.conversation.count({ where: { businessId } }),
    prisma.appointment.count({ where: { professional: { businessId } } }),
    prisma.customer.count({ where: { businessId } })
  ])

  const settings = business.featureSettings
  console.log(`Residuos QA: ${conversations} conversaciones, ${appointments} turnos, ${customers} clientes.`)
  const safe = business.isDemo &&
    business.demoType === 'QA_SANDBOX' &&
    business.aiEnabled === true &&
    whatsappConfigs === (optionsBot ? 1 : 0) &&
    instagramConfigs === 0 &&
    botConfigurations === (optionsBot ? 1 : 0) &&
    conversations === 0 &&
    appointments === 0 &&
    customers === 0 &&
    settings?.realWhatsappEnabled === false &&
    settings.aiEnabled === true &&
    settings.campaignsEnabled === false &&
    settings.remindersEnabled === false &&
    settings.campaignSendingLocked === true &&
    settings.reminderSendingLocked === true

  if (!safe) throw new Error('La verificación de aislamiento del entorno QA falló.')

  console.log(`Verificación: ${business.services.length} servicios, ${business.professionals.length} profesionales, 0 conversaciones, 0 turnos, 0 clientes, IA activa.`)
  console.log(`Booking V2: ${settings.bookingV2Enabled ? 'activo' : 'inactivo, igual que en el comercio original'}.`)
  console.log('Verificación de aislamiento: OK (sin Meta ni canales automáticos).')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

function requiredSourceSlug() {
  const value = process.argv[2]?.trim() || process.env.QA_SOURCE_BUSINESS_SLUG?.trim()
  if (!value) {
    throw new Error('Indicá explícitamente el slug del comercio que querés copiar al entorno QA.')
  }
  return value
}
