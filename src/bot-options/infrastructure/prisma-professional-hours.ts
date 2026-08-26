/**
 * F5.7 — Adaptador Prisma para consultas tenant-scoped de horarios de profesionales.
 *
 * Lee Professional (activo/reservable), ProfessionalHours y ScheduleBlock
 * (excepciones a nivel profesional) para alimentar el read model informativo
 * de jornada de profesionales.
 *
 * NO crea draft, NO consulta appointments, NO revela agenda ni slots.
 */

import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import {
  computeExceptionWindow,
  type ProfessionalCatalogRow,
  type ProfessionalOperationalException,
  type ProfessionalWeeklyHourRow
} from '../application/hours-queries.js'

type HoursClient = Pick<PrismaClient, 'professional' | 'professionalHours' | 'scheduleBlock'> | Prisma.TransactionClient

const professionalCatalogSelect = {
  id: true,
  name: true,
  acceptsBotBookings: true
} as const

const professionalHoursSelect = {
  dayOfWeek: true,
  startTime: true,
  endTime: true
} as const

const scheduleBlockSelect = {
  startAt: true,
  endAt: true
} as const

export class PrismaProfessionalHoursRepository {
  readonly #client: HoursClient

  constructor(client: HoursClient) {
    this.#client = client
  }

  /**
   * Lista profesionales activos del negocio, ordenados por nombre determinísticamente.
   * Tenant-scoped: filtra por businessId + isActive=true.
   * NO incluye inactivos.
   */
  async listActiveProfessionals(input: {
    businessId: string
  }): Promise<readonly ProfessionalCatalogRow[]> {
    const rows = await this.#client.professional.findMany({
      where: { businessId: input.businessId, isActive: true },
      select: professionalCatalogSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }]
    })
    return rows.map((row) => ({
      professionalId: row.id,
      name: row.name,
      acceptsBotBookings: row.acceptsBotBookings
    }))
  }

  /**
   * Obtiene un profesional por ID, tenant-scoped.
   * Retorna null si no existe, inactivo o cross-tenant.
   */
  async getProfessional(input: {
    businessId: string
    professionalId: string
  }): Promise<ProfessionalCatalogRow | null> {
    const row = await this.#client.professional.findFirst({
      where: { id: input.professionalId, businessId: input.businessId, isActive: true },
      select: professionalCatalogSelect
    })
    if (!row) return null
    return {
      professionalId: row.id,
      name: row.name,
      acceptsBotBookings: row.acceptsBotBookings
    }
  }

  /**
   * Carga los horarios regulares de un profesional (ProfessionalHours).
   * Tenant-scoped: filtra por professionalId + businessId (vía Professional).
   */
  async loadProfessionalWeeklyHours(input: {
    professionalId: string
    businessId: string
  }): Promise<readonly ProfessionalWeeklyHourRow[]> {
    const rows = await this.#client.professionalHours.findMany({
      where: {
        professionalId: input.professionalId,
        professional: { businessId: input.businessId }
      },
      select: professionalHoursSelect,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }]
    })
    return rows.map((row) => ({
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime,
      endTime: row.endTime
    }))
  }

  /**
   * Carga las excepciones operativas de un profesional (ScheduleBlock con professionalId).
   * Tenant-scoped: filtra por professionalId + businessId.
   * Ventana: dbNow → +30 días (truncado a inicio del día en timezone del negocio).
   * NO expone `note` al caller (se descarta en el map).
   */
  async loadProfessionalExceptions(input: {
    professionalId: string
    businessId: string
    dbNow: Date
    timezone: string
  }): Promise<readonly ProfessionalOperationalException[]> {
    const { from, to } = computeExceptionWindow(input.dbNow, input.timezone)

    const rows = await this.#client.scheduleBlock.findMany({
      where: {
        professionalId: input.professionalId,
        businessId: input.businessId,
        startAt: { lt: to },
        endAt: { gt: from }
      },
      select: scheduleBlockSelect,
      orderBy: { startAt: 'asc' }
    })

    return rows.map((row) => ({
      startAt: row.startAt,
      endAt: row.endAt
    }))
  }
}
