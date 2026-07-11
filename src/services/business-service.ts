import { prisma } from '../config/prisma.js'

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

export class BusinessService {
  async create(name: string, requestedSlug?: string) {
    const slug = await this.resolveAvailableSlug(requestedSlug || name)

    return prisma.business.create({
      data: {
        name,
        slug,
        whatsappConfig: {
          create: {}
        },
        featureSettings: {
          create: {}
        }
      }
    })
  }

  async findAll() {
    return prisma.business.findMany()
  }

  async update(id: string, data: {
    name?: string
    slug?: string | null
    logoUrl?: string | null
    landingEnabled?: boolean
    landingDescription?: string | null
    coverImageUrl?: string | null
    publicWhatsapp?: string | null
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
      include: {
        businessHours: true,
        services: {
          orderBy: [
            { category: 'asc' },
            { name: 'asc' }
          ]
        },
        professionals: {
          where: {
            isActive: true
          },
          orderBy: {
            name: 'asc'
          }
        }
      }
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
