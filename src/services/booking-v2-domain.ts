import { prisma as defaultPrisma } from '../config/prisma.js'
import { InternalBookingProvider } from '../providers/internal-booking-provider.js'
import type { BookingProvider } from '../providers/booking-provider.js'
import type { BookingV2Catalog } from './booking-v2-interpreter.js'
import type { BookingV2CatalogOption } from './booking-v2-extractor.js'

type PrismaClientLike = typeof defaultPrisma

export type BookingV2ServiceOption = {
  id: string
  name: string
  aliases: string[]
  duration: number
  category: string | null
}

export type BookingV2ProfessionalOption = {
  id: string
  name: string
  serviceIds: string[]
}

export type BookingV2DomainCatalog = {
  services: BookingV2ServiceOption[]
  professionals: BookingV2ProfessionalOption[]
  serviceIds: ReadonlySet<string>
  professionalIds: ReadonlySet<string>
  professionalServiceIds: ReadonlyMap<string, ReadonlySet<string>>
}

export type BookingV2AvailabilityOption = {
  time: string
  professionalId: string
  professionalName: string
}

export type BookingV2AvailabilityResult =
  | {
      ok: true
      options: BookingV2AvailabilityOption[]
    }
  | {
      ok: false
      message: string
    }

export class BookingV2DomainService {
  constructor(
    private readonly db: PrismaClientLike = defaultPrisma,
    private readonly bookingProvider: BookingProvider = new InternalBookingProvider()
  ) {}

  async loadCatalog(businessId: string): Promise<BookingV2DomainCatalog> {
    const [services, professionals] = await Promise.all([
      this.db.service.findMany({
        where: { businessId },
        include: { aliases: true },
        orderBy: { name: 'asc' }
      }),
      this.db.professional.findMany({
        where: {
          businessId,
          isActive: true
        },
        include: {
          serviceLinks: {
            select: { serviceId: true }
          }
        },
        orderBy: { name: 'asc' }
      })
    ])

    return createBookingV2DomainCatalog({
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        aliases: service.aliases.map((alias) => alias.name),
        duration: service.duration,
        category: service.category
      })),
      professionals: professionals.map((professional) => ({
        id: professional.id,
        name: professional.name,
        serviceIds: professional.serviceLinks.map((link) => link.serviceId)
      }))
    })
  }

  toExtractionCatalog(catalog: BookingV2DomainCatalog): {
    services: BookingV2CatalogOption[]
    professionals: BookingV2CatalogOption[]
  } {
    return {
      services: catalog.services.map((service) => ({
        id: service.id,
        name: service.name,
        aliases: service.aliases
      })),
      professionals: catalog.professionals.map((professional) => ({
        id: professional.id,
        name: professional.name
      }))
    }
  }

  toInterpreterCatalog(catalog: BookingV2DomainCatalog): BookingV2Catalog {
    return {
      serviceIds: catalog.serviceIds,
      professionalIds: catalog.professionalIds,
      professionalServiceIds: catalog.professionalServiceIds
    }
  }

  professionalOffersService(
    catalog: BookingV2DomainCatalog,
    professionalId: string,
    serviceId: string
  ) {
    return catalog.professionalServiceIds.get(professionalId)?.has(serviceId) ?? false
  }

  async findAvailabilityOptions(input: {
    catalog: BookingV2DomainCatalog
    serviceId: string
    date: string
    professionalId?: string | null
  }): Promise<BookingV2AvailabilityResult> {
    if (!input.catalog.serviceIds.has(input.serviceId)) {
      return { ok: false, message: 'No encontre ese servicio para este comercio' }
    }

    const professionals = input.professionalId
      ? input.catalog.professionals.filter((professional) => professional.id === input.professionalId)
      : input.catalog.professionals

    const compatibleProfessionals = professionals.filter((professional) =>
      this.professionalOffersService(input.catalog, professional.id, input.serviceId)
    )

    if (input.professionalId && compatibleProfessionals.length === 0) {
      return { ok: false, message: 'Ese profesional no realiza ese servicio' }
    }

    const options: BookingV2AvailabilityOption[] = []
    for (const professional of compatibleProfessionals) {
      const availability = await this.bookingProvider.getAvailability({
        professionalId: professional.id,
        serviceId: input.serviceId,
        date: input.date
      })
      if (!availability.ok) continue

      for (const time of availability.slots) {
        options.push({
          time,
          professionalId: professional.id,
          professionalName: professional.name
        })
      }
    }

    options.sort((left, right) =>
      left.time.localeCompare(right.time) ||
      left.professionalName.localeCompare(right.professionalName)
    )

    return { ok: true, options }
  }
}

export function createBookingV2DomainCatalog(input: {
  services: BookingV2ServiceOption[]
  professionals: BookingV2ProfessionalOption[]
}): BookingV2DomainCatalog {
  return {
    services: input.services,
    professionals: input.professionals,
    serviceIds: new Set(input.services.map((service) => service.id)),
    professionalIds: new Set(input.professionals.map((professional) => professional.id)),
    professionalServiceIds: new Map(
      input.professionals.map((professional) => [
        professional.id,
        new Set(professional.serviceIds)
      ])
    )
  }
}
