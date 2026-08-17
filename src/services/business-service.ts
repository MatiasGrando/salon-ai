import { prisma } from '../config/prisma.js'
import { generateBusinessCustomerCode } from './business-customer-code.js'
import type { Prisma } from '../generated/prisma/client.js'

const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'auth',
  'crm',
  'health',
  'public',
  'static',
  'weex',
  'www'
])

const publicBusinessInclude = {
  businessHours: true,
  services: {
    where: { isBookable: true },
    orderBy: [
      { category: 'asc' as const },
      { name: 'asc' as const }
    ]
  },
  professionals: {
    where: {
      isActive: true
    },
    orderBy: {
      name: 'asc' as const
    }
  },
  whatsappConfig: {
    select: {
      displayPhoneNumber: true
    }
  },
  paymentSettings: true
} satisfies Prisma.BusinessInclude

export class BusinessService {
  async create(name: string, requestedSlug?: string, ownership?: {
    accountAdminId?: string | null
    createdByUserId?: string | null
    contactName?: string | null
    contactPhone?: string | null
    contactEmail?: string | null
    planId?: string | null
  }) {
    const slug = await this.resolveAvailableSlug(requestedSlug || name)

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const customerCode = generateBusinessCustomerCode()
      if (await this.customerCodeExists(customerCode)) continue

      try {
        return await prisma.business.create({
          data: {
            customerCode,
            name,
            slug,
            accountAdminId: ownership?.accountAdminId || null,
            createdByUserId: ownership?.createdByUserId || null,
            contactName: ownership?.contactName || null,
            contactPhone: ownership?.contactPhone || null,
            contactEmail: ownership?.contactEmail || null,
            planId: ownership?.planId || null,
            whatsappConfig: {
              create: {}
            },
            featureSettings: {
              create: {}
            }
          }
        })
      } catch (error) {
        if (isUniqueConstraintError(error) && await this.customerCodeExists(customerCode)) continue
        throw error
      }
    }

    throw new Error('CUSTOMER_CODE_UNAVAILABLE')
  }

  private async customerCodeExists(customerCode: string) {
    return Boolean(await prisma.business.findUnique({
      where: { customerCode },
      select: { id: true }
    }))
  }

  async findByCustomerCode(customerCode: string) {
    return prisma.business.findUnique({
      where: { customerCode },
      select: {
        id: true,
        customerCode: true,
        name: true
      }
    })
  }

  async findAll(query?: string) {
    const search = query?.trim()
    if (!search) {
      return prisma.business.findMany({ orderBy: { name: 'asc' } })
    }

    return prisma.business.findMany({
      where: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { customerCode: { contains: search.toUpperCase(), mode: 'insensitive' } }
        ]
      },
      orderBy: { name: 'asc' }
    })
  }

  async update(id: string, data: {
    name?: string
    slug?: string | null
    logoUrl?: string | null
    landingEnabled?: boolean
    landingTemplate?: string
    landingSubtitle?: string | null
    landingFeature?: string | null
    landingOpeningYear?: number | null
    landingDescription?: string | null
    landingTemplateContent?: Prisma.InputJsonValue
    coverImageUrl?: string | null
    landingGalleryImages?: string | null
    publicWhatsapp?: string | null
    contactEmail?: string | null
    publicAddress?: string | null
    publicAddressArea?: string | null
    publicMapsUrl?: string | null
    instagramUrl?: string | null
    facebookUrl?: string | null
    tiktokUrl?: string | null
  }) {
    const business = await prisma.business.findUnique({
      where: {
        id
      }
    })

    if (!business) {
      return null
    }

    const slug = data.slug === undefined
      ? undefined
      : data.slug === null
        ? null
        : await this.resolveAvailableSlug(data.slug, id)

    return prisma.business.update({
      where: {
        id
      },
      data: {
        ...data,
        ...(slug !== undefined ? { slug } : {})
      }
    })
  }

  async findPublicBySlug(slug: string) {
    const normalizedSlug = normalizeBusinessSlug(slug)
    if (!normalizedSlug) return null

    return prisma.business.findUnique({
      where: {
        slug: normalizedSlug
      },
      include: publicBusinessInclude
    })
  }

  async findPublicByCustomerCode(customerCode: string) {
    const normalizedCustomerCode = customerCode.trim().toUpperCase()
    if (!normalizedCustomerCode) return null

    return prisma.business.findUnique({
      where: {
        customerCode: normalizedCustomerCode
      },
      include: publicBusinessInclude
    })
  }

  private async resolveAvailableSlug(value: string, excludeBusinessId?: string) {
    const base = normalizeBusinessSlug(value)
    if (!base) throw new Error('SLUG_INVALID')
    if (RESERVED_SLUGS.has(base)) throw new Error('SLUG_RESERVED')

    let candidate = base
    let suffix = 2

    while (await this.slugExists(candidate, excludeBusinessId)) {
      candidate = `${base}-${suffix}`
      suffix += 1
    }

    return candidate
  }

  private async slugExists(slug: string, excludeBusinessId?: string) {
    const business = await prisma.business.findUnique({
      where: {
        slug
      },
      select: {
        id: true
      }
    })

    return Boolean(business && business.id !== excludeBusinessId)
  }
}

export function normalizeBusinessSlug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function isReservedBusinessSlug(slug: string) {
  return RESERVED_SLUGS.has(slug)
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
}
