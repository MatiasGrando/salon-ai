import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'

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
      imageUrl?: string | null
      aliases?: string[]
      categoryId?: string | null
      parentServiceId?: string | null
      isBookable?: boolean
      sortOrder?: number
    }
    const name = body.name?.trim()
    const duration = Number(body.duration)
    const businessId = body.businessId?.trim()
    const category = body.category?.trim()
    const imageUrl = normalizeServiceImageUrl(body.imageUrl)
    const price = body.price === null || body.price === undefined || body.price === ''
      ? null
      : Number(body.price)
    const aliases = body.aliases
      ?.map((alias) => alias.trim())
      .filter(Boolean)
    const categoryId = normalizeNullableId(body.categoryId)
    const parentServiceId = normalizeNullableId(body.parentServiceId)
    const isBookable = body.isBookable !== false

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
      imageUrl: imageUrl ?? null,
      category: hierarchy.categoryName ?? category ?? null,
      catalogCategoryId: categoryId,
      parentServiceId,
      isBookable,
      sortOrder: normalizeSortOrder(body.sortOrder),
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
      imageUrl?: string | null
      aliases?: string[]
      categoryId?: string | null
      parentServiceId?: string | null
      isBookable?: boolean
      sortOrder?: number
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
