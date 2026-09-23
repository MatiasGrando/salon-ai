export type WorkshopMaintenanceService = {
  id: string
  name: string
  recurrenceEnabled: boolean
  returnMonths: number | null
  returnKilometers: number | null
  customerInstructions: string
}

export type WorkshopMaintenanceLine = {
  serviceId?: string
  nextDueDate?: string | null
  nextDueMileage?: number | null
  returnMonths?: number | null
  returnKilometers?: number | null
}

export function addWorkshopMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

export function calculateWorkshopMaintenance(input: {
  jobDate: string
  jobMileage: number
  line: WorkshopMaintenanceLine
  service: WorkshopMaintenanceService
}) {
  const { service, line } = input
  if (!service.recurrenceEnabled) return null
  const defaultDate = service.returnMonths ? addWorkshopMonths(input.jobDate, service.returnMonths) : null
  const defaultMileage = service.returnKilometers ? input.jobMileage + service.returnKilometers : null
  const returnMonths = line.returnMonths === undefined ? service.returnMonths : line.returnMonths
  const returnKilometers = line.returnKilometers === undefined ? service.returnKilometers : line.returnKilometers
  const nextDueDate = line.nextDueDate || (returnMonths ? addWorkshopMonths(input.jobDate, returnMonths) : null)
  const nextDueMileage = line.nextDueMileage ?? (returnKilometers ? input.jobMileage + returnKilometers : null)
  if (!nextDueDate && nextDueMileage === null) return null
  return {
    serviceId: service.id,
    serviceName: service.name,
    lastPerformedDate: input.jobDate,
    lastMileage: input.jobMileage,
    returnMonths,
    returnKilometers,
    nextDueDate,
    nextDueMileage,
    customerInstructions: service.customerInstructions,
    manuallyAdjusted: returnMonths !== service.returnMonths || returnKilometers !== service.returnKilometers ||
      (line.nextDueDate != null && line.nextDueDate !== '' && line.nextDueDate !== defaultDate) ||
      (line.nextDueMileage != null && line.nextDueMileage !== defaultMileage)
  }
}
export function shouldReplaceWorkshopMaintenance(existingDate: string | null | undefined, candidateDate: string) {
  return !existingDate || existingDate <= candidateDate
}
export type WorkshopMaintenanceCycleView = {
  id: string
  serviceId: string
  serviceName: string
  lastPerformedDate: string
  lastMileage: number
  nextDueDate: string | null
  nextDueMileage: number | null
  customerInstructions: string
}

export function presentWorkshopMaintenance(cycles: WorkshopMaintenanceCycleView[], currentMileage: number | null, now = new Date()) {
  const today = now.toISOString().slice(0, 10)
  const warningDate = new Date(`${today}T00:00:00Z`)
  warningDate.setUTCDate(warningDate.getUTCDate() + 30)
  const warningDateText = warningDate.toISOString().slice(0, 10)
  const items = cycles.map(cycle => {
    const overdueByDate = Boolean(cycle.nextDueDate && cycle.nextDueDate <= today)
    const overdueByMileage = Boolean(cycle.nextDueMileage !== null && currentMileage !== null && currentMileage >= cycle.nextDueMileage)
    const upcomingByDate = Boolean(cycle.nextDueDate && cycle.nextDueDate > today && cycle.nextDueDate <= warningDateText)
    const upcomingByMileage = Boolean(cycle.nextDueMileage !== null && currentMileage !== null && cycle.nextDueMileage > currentMileage && cycle.nextDueMileage - currentMileage <= 1_000)
    const status = overdueByDate || overdueByMileage ? 'OVERDUE' : upcomingByDate || upcomingByMileage ? 'UPCOMING' : 'UP_TO_DATE'
    return { ...cycle, status, overdueByDate, overdueByMileage }
  }).sort((left, right) => {
    const rank = { OVERDUE: 0, UPCOMING: 1, UP_TO_DATE: 2 }
    return rank[left.status] - rank[right.status] || String(left.nextDueDate || '9999').localeCompare(String(right.nextDueDate || '9999')) || left.serviceName.localeCompare(right.serviceName)
  })
  return {
    items,
    summary: {
      overdue: items.filter(item => item.status === 'OVERDUE').length,
      upcoming: items.filter(item => item.status === 'UPCOMING').length,
      upToDate: items.filter(item => item.status === 'UP_TO_DATE').length
    }
  }
}
