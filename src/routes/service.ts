import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { Prisma } from '../generated/prisma/client.js'
import { serviceCanContinueToBooking } from '../services/booking-v2-deposit.js'

export async function serviceRoutes(app: FastifyInstance) {
  app.post('/service-categories', async (request, reply) => {
    const body = request.body as {
      businessId?: string
      name?: string
      sortOrder?: number
    }
    const businessId = body.businessId?.trim()
    const name = body.name?.trim()

    if (!businessId || !name) {
      return reply.status(400).send({
        message: 'businessId y name son requeridos'
      })
    }

    const duplicate = await prisma.serviceCategory.findFirst({
      where: {
        businessId,
        name: { equals: name, mode: 'insensitive' }
      }
    })
    if (duplicate) {
      return reply.status(409).send({
        message: 'Ya existe una categoria con ese nombre'
      })
    }

    return prisma.serviceCategory.create({
      data: {
        businessId,
        name,
        sortOrder: normalizeSortOrder(body.sortOrder)
      },
      include: { _count: { select: { services: true } } }
    })
  })

  app.get('/service-categories', async (request) => {
    const query = request.query as { businessId?: string }
    return prisma.serviceCategory.findMany({
      where: query.businessId ? { businessId: query.businessId } : {},
      include: { _count: { select: { services: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
    })
  })

  app.patch('/service-categories/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as {
      name?: string
      sortOrder?: number
      isActive?: boolean
    }
    const category = await prisma.serviceCategory.findUnique({
      where: { id: params.id }
    })
    const name = body.name?.trim()

    if (!category) {
      return reply.status(404).send({ message: 'No encontre la categoria' })
    }
    if (!name) {
      return reply.status(400).send({ message: 'name es requerido' })
    }

    const duplicate = await prisma.serviceCategory.findFirst({
      where: {
        businessId: category.businessId,
        id: { not: category.id },
        name: { equals: name, mode: 'insensitive' }
      }
    })
    if (duplicate) {
      return reply.status(409).send({
        message: 'Ya existe una categoria con ese nombre'
      })
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.serviceCategory.update({
        where: { id: category.id },
        data: {
          name,
          ...(body.sortOrder === undefined ? {} : { sortOrder: normalizeSortOrder(body.sortOrder) }),
          ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {})
        }
      })
      await tx.service.updateMany({
        where: { catalogCategoryId: category.id },
        data: { category: name }
      })
      return result
    })

    return {
      ...updated,
      _count: {
        services: await prisma.service.count({
          where: { catalogCategoryId: category.id }
        })
      }
    }
  })

  app.delete('/service-categories/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const category = await prisma.serviceCategory.findUnique({
      where: { id: params.id },
      select: { id: true }
    })
    if (!category) {
      return reply.status(404).send({ message: 'No encontre la categoria' })
    }
    await prisma.$transaction([
      prisma.service.updateMany({
        where: { catalogCategoryId: category.id },
        data: { category: null }
      }),
      prisma.serviceCategory.delete({ where: { id: category.id } })
    ])
    return { deleted: true }
  })

  app.post('/services', async (request, reply) => {

    const body = request.body as {
      name: string
      duration: number
      businessId: string
      category?: string
      price?: number | string | null
      priceMode?: string
      imageUrl?: string | null
      aliases?: string[]
      categoryId?: string | null
      parentServiceId?: string | null
      isBookable?: boolean
      sortOrder?: number
      attentionMode?: string
      requiresPhoto?: boolean
      estimateExplanation?: string | null
      estimateQuestion?: string | null
      estimateOptions?: unknown
      estimateDisclaimer?: string | null
      estimateAllowsBooking?: boolean
      validationEnabled?: boolean
      validationMessage?: string | null
      validationQuestion?: string | null
      depositMode?: string
      depositValue?: number | string | null
      depositHoldMinutes?: number | string
    }
    const name = body.name?.trim()
    const duration = Number(body.duration)
    const businessId = body.businessId?.trim()
    const category = body.category?.trim()
    const imageUrl = normalizeServiceImageUrl(body.imageUrl)
    const price = body.price === null || body.price === undefined || body.price === ''
      ? null
      : Number(body.price)
    const priceMode = normalizeServicePriceMode(body.priceMode)
    const aliases = body.aliases
      ?.map((alias) => alias.trim())
      .filter(Boolean)
    const categoryId = normalizeNullableId(body.categoryId)
    const parentServiceId = normalizeNullableId(body.parentServiceId)
    const isBookable = body.isBookable !== false
    const attentionMode = normalizeServiceAttentionMode(body.attentionMode)
    const requiresPhoto = Boolean(body.requiresPhoto)
    const estimateOptions = normalizeEstimateOptions(body.estimateOptions)
    const validationEnabled = Boolean(body.validationEnabled)
    const validationMessage = normalizeOptionalText(body.validationMessage)
    const validationQuestion = normalizeOptionalText(body.validationQuestion)
    const depositMode = normalizeServiceDepositMode(body.depositMode)
    const depositValue = normalizeNullableNumber(body.depositValue)
    const depositHoldMinutes = normalizeDepositHoldMinutes(body.depositHoldMinutes)

    if (!businessId) {
      return reply.status(400).send({
        message: 'businessId es requerido'
      })
    }

    if (!name) {
      return reply.status(400).send({
        message: 'name es requerido'
      })
    }

    if (!Number.isFinite(duration) || duration <= 0) {
      return reply.status(400).send({
        message: 'duration debe ser mayor a 0'
      })
    }

    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return reply.status(400).send({
        message: 'price debe ser mayor o igual a 0'
      })
    }
    if (body.priceMode !== undefined && !priceMode) {
      return reply.status(400).send({
        message: 'Selecciona una modalidad de precio valida'
      })
    }
    if (priceMode === 'STARTING_AT' && (price === null || price <= 0)) {
      return reply.status(400).send({
        message: 'El precio desde debe ser mayor a 0'
      })
    }

    if (body.imageUrl !== undefined && imageUrl === undefined) {
      return reply.status(400).send({
        message: 'La imagen del servicio debe ser PNG, JPG, WEBP o GIF y pesar hasta 2 MB'
      })
    }

    if (parentServiceId && !isBookable) {
      return reply.status(400).send({
        message: 'Una variante debe poder reservarse'
      })
    }
    if (body.attentionMode !== undefined && !attentionMode) {
      return reply.status(400).send({
        message: 'Selecciona una modalidad de atencion valida'
      })
    }
    const priceAttentionValidation = validateServicePriceAttentionMode(
      priceMode ?? 'FIXED',
      attentionMode ?? 'DIRECT_BOOKING'
    )
    if (!priceAttentionValidation.ok) {
      return reply.status(400).send({ message: priceAttentionValidation.message })
    }
    if (body.estimateOptions !== undefined && estimateOptions === null) {
      return reply.status(400).send({
        message: 'Revisa las opciones del estimativo'
      })
    }
    if (
      attentionMode === 'GUIDED_ESTIMATE' &&
      (!body.estimateQuestion?.trim() || !estimateOptions?.length)
    ) {
      return reply.status(400).send({
        message: 'El estimativo necesita una pregunta y al menos una opcion'
      })
    }
    if (validationEnabled && !validationMessage) {
      return reply.status(400).send({
        message: 'La validacion necesita una explicacion para el cliente'
      })
    }
    if (body.depositMode !== undefined && !depositMode) {
      return reply.status(400).send({
        message: 'Selecciona una modalidad de seña valida'
      })
    }
    if (depositHoldMinutes === null) {
      return reply.status(400).send({
        message: 'El tiempo para pagar la seña debe estar entre 5 minutos y 24 horas'
      })
    }
    const depositValidation = validateDepositRule(depositMode ?? 'NONE', depositValue)
    if (!depositValidation.ok) {
      return reply.status(400).send({ message: depositValidation.message })
    }
    const depositBaseValidation = validatePercentageDepositBase({
      mode: depositMode ?? 'NONE',
      attentionMode: attentionMode ?? 'DIRECT_BOOKING',
      requiresPhoto,
      price,
      estimateOptions: estimateOptions ?? []
    })
    if (!depositBaseValidation.ok) {
      return reply.status(400).send({ message: depositBaseValidation.message })
    }
    const depositFlowValidation = validateDepositBookingFlow({
      mode: depositMode ?? 'NONE',
      attentionMode: attentionMode ?? 'DIRECT_BOOKING',
      requiresPhoto,
      estimateAllowsBooking: body.estimateAllowsBooking !== false
    })
    if (!depositFlowValidation.ok) {
      return reply.status(400).send({ message: depositFlowValidation.message })
    }

    const hierarchy = await validateServiceHierarchy({
      businessId,
      categoryId,
      parentServiceId
    })
    if (!hierarchy.ok) {
      return reply.status(400).send({ message: hierarchy.message })
    }

    const data = {
      name,
      duration,
      businessId,
      price,
      priceMode: isBookable ? priceMode ?? 'FIXED' : 'FIXED',
      imageUrl: imageUrl ?? null,
      category: hierarchy.categoryName ?? category ?? null,
      catalogCategoryId: categoryId,
      parentServiceId,
      isBookable,
      sortOrder: normalizeSortOrder(body.sortOrder),
      attentionMode: isBookable ? attentionMode ?? 'DIRECT_BOOKING' : 'DIRECT_BOOKING',
      requiresPhoto: isBookable ? requiresPhoto : false,
      estimateExplanation: isBookable ? normalizeOptionalText(body.estimateExplanation) : null,
      estimateQuestion: isBookable ? normalizeOptionalText(body.estimateQuestion) : null,
      estimateOptions: isBookable && estimateOptions?.length ? estimateOptions : undefined,
      estimateDisclaimer: isBookable ? normalizeOptionalText(body.estimateDisclaimer) : null,
      estimateAllowsBooking: isBookable ? body.estimateAllowsBooking !== false : true,
      validationEnabled: isBookable ? validationEnabled : false,
      validationMessage: isBookable && validationEnabled ? validationMessage : null,
      validationQuestion: isBookable && validationEnabled ? validationQuestion : null,
      depositMode: isBookable ? depositMode ?? 'NONE' : 'NONE',
      depositValue: isBookable && depositMode !== 'NONE' ? depositValue : null,
      depositHoldMinutes: isBookable ? depositHoldMinutes ?? 60 : 60,
      ...(aliases?.length
        ? {
            aliases: {
              create: aliases.map((alias) => ({
                name: alias
              }))
            }
          }
        : {})
    }

    return prisma.$transaction(async (tx) => {
      const created = await tx.service.create({
        data: data as any,
        include: serviceCatalogInclude
      })
      if (parentServiceId) {
        const parentLinks = await tx.professionalService.findMany({
          where: { serviceId: parentServiceId },
          select: { professionalId: true }
        })
        if (parentLinks.length) {
          await tx.professionalService.createMany({
            data: parentLinks.map((link) => ({
              serviceId: created.id,
              professionalId: link.professionalId
            })),
            skipDuplicates: true
          })
        }
      }
      return tx.service.findUnique({
        where: { id: created.id },
        include: serviceCatalogInclude
      })
    })
  })

  app.get('/services', async (request) => {
    const query = request.query as {
      businessId?: string
    }

    return prisma.service.findMany({
      where: query.businessId
        ? {
            businessId: query.businessId
          }
        : {},
      include: serviceCatalogInclude,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
    })
  })

  app.patch('/services/:id', async (request, reply) => {
    const params = request.params as {
      id: string
    }
    const body = request.body as {
      name?: string
      duration?: number
      category?: string | null
      price?: number | string | null
      priceMode?: string
      imageUrl?: string | null
      aliases?: string[]
      categoryId?: string | null
      parentServiceId?: string | null
      isBookable?: boolean
      sortOrder?: number
      attentionMode?: string
      requiresPhoto?: boolean
      estimateExplanation?: string | null
      estimateQuestion?: string | null
      estimateOptions?: unknown
      estimateDisclaimer?: string | null
      estimateAllowsBooking?: boolean
      validationEnabled?: boolean
      validationMessage?: string | null
      validationQuestion?: string | null
      depositMode?: string
      depositValue?: number | string | null
      depositHoldMinutes?: number | string
    }
    const name = body.name?.trim()
    const duration = Number(body.duration)
    const price = body.price === null || body.price === undefined || body.price === ''
      ? null
      : Number(body.price)
    const imageUrl = normalizeServiceImageUrl(body.imageUrl)

    if (!name) {
      return reply.status(400).send({
        message: 'name es requerido'
      })
    }

    if (!Number.isFinite(duration) || duration <= 0) {
      return reply.status(400).send({
        message: 'duration debe ser mayor a 0'
      })
    }

    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return reply.status(400).send({
        message: 'price debe ser mayor o igual a 0'
      })
    }

    if (body.imageUrl !== undefined && imageUrl === undefined) {
      return reply.status(400).send({
        message: 'La imagen del servicio debe ser PNG, JPG, WEBP o GIF y pesar hasta 2 MB'
      })
    }

    const aliases = body.aliases
      ?.map((alias) => alias.trim())
      .filter(Boolean)
    const existing = await prisma.service.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        businessId: true,
        catalogCategoryId: true,
        parentServiceId: true,
        isBookable: true,
        priceMode: true,
        attentionMode: true,
        requiresPhoto: true,
        estimateExplanation: true,
        estimateQuestion: true,
        estimateOptions: true,
        estimateDisclaimer: true,
        estimateAllowsBooking: true,
        validationEnabled: true,
        validationMessage: true,
        validationQuestion: true,
        depositMode: true,
        depositValue: true,
        depositHoldMinutes: true,
        _count: {
          select: {
            variants: true
          }
        }
      }
    })
    if (!existing) {
      return reply.status(404).send({ message: 'No encontre el servicio' })
    }

    const categoryId = body.categoryId === undefined
      ? existing.catalogCategoryId
      : normalizeNullableId(body.categoryId)
    const parentServiceId = body.parentServiceId === undefined
      ? existing.parentServiceId
      : normalizeNullableId(body.parentServiceId)
    const isBookable = typeof body.isBookable === 'boolean'
      ? body.isBookable
      : existing.isBookable
    const priceMode = body.priceMode === undefined
      ? existing.priceMode
      : normalizeServicePriceMode(body.priceMode)
    if (!priceMode) {
      return reply.status(400).send({
        message: 'Selecciona una modalidad de precio valida'
      })
    }
    if (isBookable && priceMode === 'STARTING_AT' && (price === null || price <= 0)) {
      return reply.status(400).send({
        message: 'El precio desde debe ser mayor a 0'
      })
    }
    const attentionMode = body.attentionMode === undefined
      ? existing.attentionMode
      : normalizeServiceAttentionMode(body.attentionMode)
    const requiresPhoto = typeof body.requiresPhoto === 'boolean'
      ? body.requiresPhoto
      : existing.requiresPhoto
    const estimateOptions = body.estimateOptions === undefined
      ? normalizeEstimateOptions(existing.estimateOptions)
      : normalizeEstimateOptions(body.estimateOptions)
    const estimateQuestion = body.estimateQuestion === undefined
      ? existing.estimateQuestion
      : normalizeOptionalText(body.estimateQuestion)
    const estimateAllowsBooking = typeof body.estimateAllowsBooking === 'boolean'
      ? body.estimateAllowsBooking
      : existing.estimateAllowsBooking
    const validationEnabled = typeof body.validationEnabled === 'boolean'
      ? body.validationEnabled
      : existing.validationEnabled
    const validationMessage = body.validationMessage === undefined
      ? existing.validationMessage
      : normalizeOptionalText(body.validationMessage)
    const validationQuestion = body.validationQuestion === undefined
      ? existing.validationQuestion
      : normalizeOptionalText(body.validationQuestion)
    const depositMode = body.depositMode === undefined
      ? existing.depositMode
      : normalizeServiceDepositMode(body.depositMode)
    const depositValue = body.depositValue === undefined
      ? existing.depositValue
      : normalizeNullableNumber(body.depositValue)
    const depositHoldMinutes = body.depositHoldMinutes === undefined
      ? existing.depositHoldMinutes
      : normalizeDepositHoldMinutes(body.depositHoldMinutes)
    if (estimateOptions === null) {
      return reply.status(400).send({
        message: 'Revisa las opciones del estimativo'
      })
    }
    if (attentionMode === 'GUIDED_ESTIMATE' && (!estimateQuestion || !estimateOptions?.length)) {
      return reply.status(400).send({
        message: 'El estimativo necesita una pregunta y al menos una opcion'
      })
    }
    if (isBookable && validationEnabled && !validationMessage) {
      return reply.status(400).send({
        message: 'La validacion necesita una explicacion para el cliente'
      })
    }
    if (!attentionMode) {
      return reply.status(400).send({
        message: 'Selecciona una modalidad de atencion valida'
      })
    }
    const priceAttentionValidation = validateServicePriceAttentionMode(priceMode, attentionMode)
    if (!priceAttentionValidation.ok) {
      return reply.status(400).send({ message: priceAttentionValidation.message })
    }
    if (!depositMode) {
      return reply.status(400).send({
        message: 'Selecciona una modalidad de seña valida'
      })
    }
    if (depositHoldMinutes === null) {
      return reply.status(400).send({
        message: 'El tiempo para pagar la seña debe estar entre 5 minutos y 24 horas'
      })
    }
    const depositValidation = validateDepositRule(depositMode, depositValue)
    if (!depositValidation.ok) {
      return reply.status(400).send({ message: depositValidation.message })
    }
    const depositBaseValidation = validatePercentageDepositBase({
      mode: depositMode,
      attentionMode,
      requiresPhoto,
      price,
      estimateOptions: estimateOptions ?? []
    })
    if (!depositBaseValidation.ok) {
      return reply.status(400).send({ message: depositBaseValidation.message })
    }
    const depositFlowValidation = validateDepositBookingFlow({
      mode: depositMode,
      attentionMode,
      requiresPhoto,
      estimateAllowsBooking
    })
    if (!depositFlowValidation.ok) {
      return reply.status(400).send({ message: depositFlowValidation.message })
    }
    if (parentServiceId === params.id) {
      return reply.status(400).send({
        message: 'Un servicio no puede ser variante de si mismo'
      })
    }
    if (parentServiceId && !isBookable) {
      return reply.status(400).send({
        message: 'Una variante debe poder reservarse'
      })
    }
    if (existing._count.variants > 0 && (parentServiceId || isBookable)) {
      return reply.status(400).send({
        message: 'No podes convertir un grupo con variantes en servicio reservable'
      })
    }

    const hierarchy = await validateServiceHierarchy({
      businessId: existing.businessId,
      categoryId,
      parentServiceId
    })
    if (!hierarchy.ok) {
      return reply.status(400).send({ message: hierarchy.message })
    }

    return prisma.$transaction(async (tx) => {
      const service = await tx.service.update({
        where: {
          id: params.id
        },
        data: {
          name,
          duration,
          category: hierarchy.categoryName ?? body.category?.trim() ?? null,
          catalogCategoryId: categoryId,
          parentServiceId,
          isBookable,
          priceMode: isBookable ? priceMode : 'FIXED',
          attentionMode: isBookable ? attentionMode : 'DIRECT_BOOKING',
          requiresPhoto: isBookable ? requiresPhoto : false,
          estimateExplanation: isBookable
            ? body.estimateExplanation === undefined
              ? existing.estimateExplanation
              : normalizeOptionalText(body.estimateExplanation)
            : null,
          estimateQuestion: isBookable ? estimateQuestion : null,
          estimateOptions: isBookable && estimateOptions?.length ? estimateOptions : Prisma.JsonNull,
          estimateDisclaimer: isBookable
            ? body.estimateDisclaimer === undefined
              ? existing.estimateDisclaimer
              : normalizeOptionalText(body.estimateDisclaimer)
            : null,
          estimateAllowsBooking: isBookable
            ? estimateAllowsBooking
            : true,
          validationEnabled: isBookable ? validationEnabled : false,
          validationMessage: isBookable && validationEnabled ? validationMessage : null,
          validationQuestion: isBookable && validationEnabled ? validationQuestion : null,
          depositMode: isBookable ? depositMode : 'NONE',
          depositValue: isBookable && depositMode !== 'NONE' ? depositValue : null,
          depositHoldMinutes: isBookable ? depositHoldMinutes : 60,
          ...(body.sortOrder === undefined ? {} : { sortOrder: normalizeSortOrder(body.sortOrder) }),
          price,
          imageUrl: imageUrl ?? null
        } as any,
        include: serviceCatalogInclude
      })
      if (parentServiceId) {
        const parentLinks = await tx.professionalService.findMany({
          where: { serviceId: parentServiceId },
          select: { professionalId: true }
        })
        if (parentLinks.length) {
          await tx.professionalService.createMany({
            data: parentLinks.map((link) => ({
              serviceId: service.id,
              professionalId: link.professionalId
            })),
            skipDuplicates: true
          })
        }
      }

      if (aliases) {
        await tx.serviceAlias.deleteMany({
          where: {
            serviceId: params.id
          }
        })

        if (aliases.length > 0) {
          await tx.serviceAlias.createMany({
            data: aliases.map((alias) => ({
              name: alias,
              serviceId: params.id
            }))
          })
        }
      }

      return tx.service.findUnique({
        where: {
          id: service.id
        },
        include: serviceCatalogInclude
      })
    })
  })

  app.delete('/services/:id', async (request, reply) => {
    const params = request.params as {
      id: string
    }

    const service = await prisma.service.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        variants: {
          select: { id: true }
        }
      }
    })
    if (!service) {
      return reply.status(404).send({ message: 'No encontre el servicio' })
    }

    const serviceIds = [service.id, ...service.variants.map((variant) => variant.id)]
    const appointmentCount = await prisma.appointment.count({
      where: {
        serviceId: { in: serviceIds }
      }
    })

    if (appointmentCount > 0) {
      return reply.status(409).send({
        message: 'No se puede eliminar porque tiene turnos asociados'
      })
    }

    await prisma.$transaction([
      prisma.serviceAlias.deleteMany({
        where: {
          serviceId: { in: serviceIds }
        }
      }),
      prisma.service.deleteMany({
        where: {
          parentServiceId: service.id
        }
      }),
      prisma.service.delete({
        where: {
          id: service.id
        }
      })
    ])

    return {
      deleted: true,
      deletedCount: serviceIds.length
    }
  })

  app.post('/services/:serviceId/aliases', async (request) => {

    const params = request.params as {
      serviceId: string
    }

    const body = request.body as {
      aliases: string[]
    }

    return prisma.serviceAlias.createMany({
      data: body.aliases.map((alias) => ({
        name: alias,
        serviceId: params.serviceId
      }))
    })
  })

}

const serviceCatalogInclude = {
  aliases: true,
  catalogCategory: true,
  parentService: {
    select: {
      id: true,
      name: true
    }
  },
  _count: {
    select: {
      variants: true,
      professionalLinks: true
    }
  }
} as const

async function validateServiceHierarchy(input: {
  businessId: string
  categoryId: string | null
  parentServiceId: string | null
}): Promise<
  | { ok: true, categoryName: string | null }
  | { ok: false, message: string }
> {
  const [category, parent] = await Promise.all([
    input.categoryId
      ? prisma.serviceCategory.findFirst({
          where: { id: input.categoryId, businessId: input.businessId }
        })
      : null,
    input.parentServiceId
      ? prisma.service.findFirst({
          where: {
            id: input.parentServiceId,
            businessId: input.businessId,
            parentServiceId: null,
            isBookable: false
          }
        })
      : null
  ])

  if (input.categoryId && !category) {
    return { ok: false, message: 'La categoria no pertenece a este negocio' }
  }
  if (input.parentServiceId && !parent) {
    return { ok: false, message: 'Selecciona un grupo de variantes valido' }
  }
  if (
    category &&
    parent?.catalogCategoryId &&
    parent.catalogCategoryId !== category.id
  ) {
    return {
      ok: false,
      message: 'La variante debe usar la misma categoria que el servicio principal'
    }
  }

  return {
    ok: true,
    categoryName: category?.name ?? parent?.category ?? null
  }
}

function normalizeNullableId(value?: string | null) {
  const normalized = value?.trim()
  return normalized || null
}

function normalizeSortOrder(value?: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

function normalizeServiceImageUrl(imageUrl?: string | null) {
  if (imageUrl === undefined) return undefined
  if (imageUrl === null || imageUrl.trim() === '') return null
  const normalized = imageUrl.trim()
  const isImageDataUrl = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(normalized)
  return isImageDataUrl && normalized.length <= 2_800_000 ? normalized : undefined
}

function normalizeServiceAttentionMode(value?: string) {
  const normalized = value?.trim().toUpperCase()
  return normalized === 'DIRECT_BOOKING' ||
    normalized === 'QUOTE' ||
    normalized === 'ADVISOR' ||
    normalized === 'GUIDED_ESTIMATE'
    ? normalized
    : value === undefined
      ? undefined
      : null
}

function normalizeServiceDepositMode(value?: string) {
  const normalized = value?.trim().toUpperCase()
  return normalized === 'NONE' || normalized === 'FIXED' || normalized === 'PERCENTAGE'
    ? normalized
    : value === undefined
      ? undefined
      : null
}

function normalizeNullableNumber(value?: number | string | null) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function normalizeDepositHoldMinutes(value?: number | string) {
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 5 && parsed <= 1440 ? parsed : null
}

function validateDepositRule(mode: 'NONE' | 'FIXED' | 'PERCENTAGE', value: number | null) {
  if (mode === 'NONE') return { ok: true as const }
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return {
      ok: false as const,
      message: mode === 'FIXED'
        ? 'El monto de la seña debe ser mayor a 0'
        : 'El porcentaje de la seña debe ser mayor a 0'
    }
  }
  if (mode === 'PERCENTAGE' && value > 100) {
    return {
      ok: false as const,
      message: 'El porcentaje de la seña no puede superar el 100%'
    }
  }
  if (!Number.isInteger(value)) {
    return {
      ok: false as const,
      message: 'La seña debe expresarse con un numero entero'
    }
  }
  return { ok: true as const }
}

function validatePercentageDepositBase(input: {
  mode: 'NONE' | 'FIXED' | 'PERCENTAGE'
  attentionMode: 'DIRECT_BOOKING' | 'QUOTE' | 'ADVISOR' | 'GUIDED_ESTIMATE'
  requiresPhoto: boolean
  price: number | null
  estimateOptions: Array<{ priceMin: number } | null>
}) {
  if (input.mode !== 'PERCENTAGE') return { ok: true as const }
  if (input.attentionMode === 'GUIDED_ESTIMATE') {
    if (
      input.estimateOptions.length > 0 &&
      input.estimateOptions.every((option) => option !== null && option.priceMin > 0)
    ) {
      return { ok: true as const }
    }
    return {
      ok: false as const,
      message: 'Para calcular la seña porcentual, todos los estimativos deben tener un minimo mayor a 0'
    }
  }
  if (input.attentionMode === 'QUOTE' || input.requiresPhoto) {
    return { ok: true as const }
  }
  if (input.price !== null && input.price > 0) return { ok: true as const }
  return {
    ok: false as const,
    message: 'Para calcular la seña porcentual, carga un precio base mayor a 0'
  }
}

function validateDepositBookingFlow(input: {
  mode: 'NONE' | 'FIXED' | 'PERCENTAGE'
  attentionMode: 'DIRECT_BOOKING' | 'QUOTE' | 'ADVISOR' | 'GUIDED_ESTIMATE'
  requiresPhoto: boolean
  estimateAllowsBooking: boolean
}) {
  if (input.mode === 'NONE') return { ok: true as const }
  if (serviceCanContinueToBooking(input)) {
    return { ok: true as const }
  }
  return {
    ok: false as const,
    message: 'La seña solo puede activarse en servicios que permiten continuar con una reserva'
  }
}

function normalizeEstimateOptions(value: unknown) {
  if (value === undefined) return undefined
  if (value === null) return []
  if (!Array.isArray(value) || value.length > 12) return null
  const normalized = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') return null
    const option = entry as {
      id?: unknown
      label?: unknown
      priceMin?: unknown
      priceMax?: unknown
      note?: unknown
    }
    const label = typeof option.label === 'string' ? option.label.trim() : ''
    const priceMin = Number(option.priceMin)
    const priceMax = option.priceMax === null || option.priceMax === undefined || option.priceMax === ''
      ? null
      : Number(option.priceMax)
    if (
      !label ||
      !Number.isFinite(priceMin) ||
      priceMin < 0 ||
      (priceMax !== null && (!Number.isFinite(priceMax) || priceMax < priceMin))
    ) {
      return null
    }
    return {
      id: typeof option.id === 'string' && option.id.trim()
        ? option.id.trim().slice(0, 80)
        : `estimate-${index + 1}`,
      label: label.slice(0, 120),
      priceMin,
      priceMax,
      note: typeof option.note === 'string' && option.note.trim()
        ? option.note.trim().slice(0, 300)
        : null
    }
  })
  return normalized.some((option) => option === null)
    ? null
    : normalized
}

function normalizeOptionalText(value?: string | null) {
  const normalized = value?.trim()
  return normalized ? normalized.slice(0, 1000) : null
}

function normalizeServicePriceMode(value?: string) {
  const normalized = value?.trim().toUpperCase()
  return normalized === 'FIXED' || normalized === 'STARTING_AT'
    ? normalized
    : value === undefined
      ? undefined
      : null
}

export function validateServicePriceAttentionMode(
  priceMode: 'FIXED' | 'STARTING_AT',
  attentionMode: 'DIRECT_BOOKING' | 'QUOTE' | 'ADVISOR' | 'GUIDED_ESTIMATE'
) {
  if (attentionMode === 'QUOTE' && priceMode === 'FIXED') {
    return {
      ok: false as const,
      message: 'Un servicio con presupuesto no puede mostrar un precio fijo'
    }
  }
  return { ok: true as const }
}
