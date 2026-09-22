import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../config/prisma.js'
import { workshopVehiclePublicUrl } from './workshop-qr.js'

export type WorkshopCampaignCycleRow = {
  customerId: string
  customerName: string
  customerPhone: string
  vehicleId: string
  plate: string
  currentMileage: number | null
  serviceName: string
  nextDueDate: string | null
  nextDueMileage: number | null
  lastPerformedDate: string
  lastVisitDate: string
  publicSiteUrl: string | null
}

export type WorkshopDueAudienceItem = {
  id: string
  name: string
  phone: string
  lastVisitAt: string | null
  recipientKey: string
  vehicleId: string
  plate: string
  overdueServices: string[]
  overdueServicesText: string
  publicUrl: string | null
}

export function buildWorkshopDueAudience(rows: WorkshopCampaignCycleRow[], now = new Date()) {
  const today = now.toISOString().slice(0, 10)
  const vehicles = new Map<string, WorkshopDueAudienceItem>()
  const missingPhoneVehicles = new Set<string>()

  for (const row of rows) {
    const overdueByDate = Boolean(row.nextDueDate && row.nextDueDate <= today)
    const overdueByMileage = Boolean(
      row.nextDueMileage !== null &&
      row.currentMileage !== null &&
      row.currentMileage >= row.nextDueMileage
    )
    if (!overdueByDate && !overdueByMileage) continue
    if (!isUsableWorkshopCampaignPhone(row.customerPhone)) {
      missingPhoneVehicles.add(row.vehicleId)
      continue
    }

    const existing = vehicles.get(row.vehicleId)
    if (existing) {
      if (!existing.overdueServices.includes(row.serviceName)) existing.overdueServices.push(row.serviceName)
      continue
    }

    let publicUrl: string | null = null
    if (row.publicSiteUrl) {
      try { publicUrl = workshopVehiclePublicUrl(row.publicSiteUrl, row.plate) } catch { publicUrl = null }
    }
    vehicles.set(row.vehicleId, {
      id: row.customerId,
      name: row.customerName,
      phone: row.customerPhone,
      lastVisitAt: `${row.lastVisitDate}T00:00:00.000Z`,
      recipientKey: `workshop:${row.vehicleId}`,
      vehicleId: row.vehicleId,
      plate: row.plate,
      overdueServices: [row.serviceName],
      overdueServicesText: '',
      publicUrl
    })
  }

  const included = Array.from(vehicles.values())
    .map(item => ({ ...item, overdueServicesText: item.overdueServices.join(', ') }))
    .sort((left, right) => left.plate.localeCompare(right.plate))

  return {
    total: included.length,
    included,
    excluded: { missingPhone: missingPhoneVehicles.size, withFutureAppointment: 0 },
    note: 'Vista previa calculada con mantenimientos vencidos por fecha o kilometraje conocido.'
  }
}

export type WorkshopInactiveRow = {
  customerId: string
  customerName: string
  customerPhone: string
  vehicleId: string
  plate: string
  lastVisitDate: string
  publicSiteUrl: string | null
}

export function buildWorkshopInactiveAudience(rows: WorkshopInactiveRow[], segmentDays: number, now = new Date()) {
  const cutoff = new Date(now)
  cutoff.setUTCDate(cutoff.getUTCDate() - segmentDays)
  const cutoffDate = cutoff.toISOString().slice(0, 10)
  const included: WorkshopDueAudienceItem[] = []
  const missingPhoneVehicles = new Set<string>()

  for (const row of rows) {
    if (row.lastVisitDate > cutoffDate) continue
    if (!isUsableWorkshopCampaignPhone(row.customerPhone)) {
      missingPhoneVehicles.add(row.vehicleId)
      continue
    }
    let publicUrl: string | null = null
    if (row.publicSiteUrl) {
      try { publicUrl = workshopVehiclePublicUrl(row.publicSiteUrl, row.plate) } catch { publicUrl = null }
    }
    included.push({
      id: row.customerId,
      name: row.customerName,
      phone: row.customerPhone,
      lastVisitAt: `${row.lastVisitDate}T00:00:00.000Z`,
      recipientKey: `workshop:${row.vehicleId}`,
      vehicleId: row.vehicleId,
      plate: row.plate,
      overdueServices: [],
      overdueServicesText: '',
      publicUrl
    })
  }

  included.sort((left, right) => left.plate.localeCompare(right.plate))
  return {
    total: included.length,
    included,
    excluded: { missingPhone: missingPhoneVehicles.size, withFutureAppointment: 0 },
    note: `Vista previa calculada por vehículos sin trabajos durante al menos ${segmentDays} días.`
  }
}

export async function loadWorkshopInactiveAudience(businessId: string, segmentDays: number, now = new Date()) {
  const cutoff = new Date(now)
  cutoff.setUTCDate(cutoff.getUTCDate() - segmentDays)
  const cutoffDate = cutoff.toISOString().slice(0, 10)
  const rows = await prisma.$queryRaw<WorkshopInactiveRow[]>(Prisma.sql`
    SELECT
      customer."id" AS "customerId",
      customer."name" AS "customerName",
      customer."phone" AS "customerPhone",
      vehicle."id" AS "vehicleId",
      vehicle."plate" AS "plate",
      recent."lastVisitDate" AS "lastVisitDate",
      business."workshopPublicSiteUrl" AS "publicSiteUrl"
    FROM (
      SELECT job."businessId", job."vehicleId", MAX(job."date") AS "lastVisitDate"
      FROM "WorkshopJob" job
      WHERE job."businessId" = ${businessId}
      GROUP BY job."businessId", job."vehicleId"
    ) recent
    INNER JOIN "WorkshopVehicle" vehicle
      ON vehicle."businessId" = recent."businessId" AND vehicle."id" = recent."vehicleId"
    INNER JOIN "Customer" customer
      ON customer."businessId" = vehicle."businessId" AND customer."id" = vehicle."customerId"
    INNER JOIN "Business" business ON business."id" = vehicle."businessId"
    WHERE recent."lastVisitDate" <= ${cutoffDate}
    ORDER BY recent."lastVisitDate" ASC, vehicle."plate" ASC
  `)
  return buildWorkshopInactiveAudience(rows, segmentDays, now)
}

export async function loadWorkshopMaintenanceDueAudience(businessId: string, now = new Date()) {
  const today = now.toISOString().slice(0, 10)
  const rows = await prisma.$queryRaw<WorkshopCampaignCycleRow[]>(Prisma.sql`
    SELECT
      customer."id" AS "customerId",
      customer."name" AS "customerName",
      customer."phone" AS "customerPhone",
      vehicle."id" AS "vehicleId",
      vehicle."plate" AS "plate",
      vehicle."currentMileage" AS "currentMileage",
      cycle."serviceName" AS "serviceName",
      cycle."nextDueDate" AS "nextDueDate",
      cycle."nextDueMileage" AS "nextDueMileage",
      cycle."lastPerformedDate" AS "lastPerformedDate",
      COALESCE(recent."lastVisitDate", cycle."lastPerformedDate") AS "lastVisitDate",
      business."workshopPublicSiteUrl" AS "publicSiteUrl"
    FROM "WorkshopMaintenanceCycle" cycle
    INNER JOIN "WorkshopVehicle" vehicle
      ON vehicle."businessId" = cycle."businessId" AND vehicle."id" = cycle."vehicleId"
    INNER JOIN "Customer" customer
      ON customer."businessId" = vehicle."businessId" AND customer."id" = vehicle."customerId"
    INNER JOIN "Business" business ON business."id" = cycle."businessId"
    LEFT JOIN (
      SELECT job."businessId", job."vehicleId", MAX(job."date") AS "lastVisitDate"
      FROM "WorkshopJob" job
      WHERE job."businessId" = ${businessId}
      GROUP BY job."businessId", job."vehicleId"
    ) recent
      ON recent."businessId" = cycle."businessId" AND recent."vehicleId" = cycle."vehicleId"
    WHERE cycle."businessId" = ${businessId}
      AND (
        (cycle."nextDueDate" IS NOT NULL AND cycle."nextDueDate" <= ${today})
        OR (
          cycle."nextDueMileage" IS NOT NULL
          AND vehicle."currentMileage" IS NOT NULL
          AND vehicle."currentMileage" >= cycle."nextDueMileage"
        )
      )
    ORDER BY vehicle."plate" ASC, cycle."nextDueDate" ASC NULLS LAST, cycle."serviceName" ASC
  `)
  return buildWorkshopDueAudience(rows, now)
}

function isUsableWorkshopCampaignPhone(phone: string) {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits.length >= 8 && digits.length <= 15
}
