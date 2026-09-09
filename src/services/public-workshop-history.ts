type WorkshopUsage = 'PARTICULAR' | 'FREQUENT' | 'PROFESSIONAL'

type PublicHistoryLine = {
  description?: unknown
  quantity?: unknown
  partsCents?: unknown
  laborCents?: unknown
}

type PublicHistoryJob = {
  id: string
  date: string
  mileage: number
  lines: unknown
  responsible?: unknown
  performerId?: unknown
  totalCents?: unknown
  notes?: unknown
}

type PublicVehicle = {
  plate: string
  model: string
  year: number | null
  engine: string
  currentMileage: number | null
  usage: WorkshopUsage
  brand: { name: string }
  customer?: unknown
}

const POLICIES: Record<WorkshopUsage, { months: number; kilometers: number }> = {
  PARTICULAR: { months: 6, kilometers: 10_000 },
  FREQUENT: { months: 4, kilometers: 7_500 },
  PROFESSIONAL: { months: 3, kilometers: 5_000 }
}

export function workshopMaintenancePolicy(usage: string) {
  return POLICIES[usage as WorkshopUsage] ?? POLICIES.PARTICULAR
}

function addMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  const safeDay = Math.min(day, lastDay)
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`
}

function safeLines(value: unknown): Array<{ description: string; quantity: number }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((line: PublicHistoryLine) => {
    const description = typeof line?.description === 'string' ? line.description.trim() : ''
    if (!description) return []
    const quantity = Number(line.quantity)
    return [{ description, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1 }]
  })
}

function recommendationStatus(nextDate: string, nextMileage: number, currentMileage: number | null, now: Date) {
  const today = now.toISOString().slice(0, 10)
  const daysUntil = Math.ceil((Date.parse(`${nextDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  const kilometersUntil = currentMileage === null ? Number.POSITIVE_INFINITY : nextMileage - currentMileage
  if (daysUntil <= 0 || kilometersUntil <= 0) return {
    status: 'danger' as const,
    label: 'Servicio recomendado',
    message: 'La fecha o el kilometraje sugerido ya fue alcanzado. Comunicate con el taller para coordinar una revisión.'
  }
  if (daysUntil <= 30 || kilometersUntil <= 1_000) return {
    status: 'warning' as const,
    label: 'Próximo servicio cercano',
    message: 'Tu próximo mantenimiento está cerca. Podés comunicarte con el taller para reservar.'
  }
  return {
    status: 'ok' as const,
    label: 'Mantenimiento al día',
    message: 'Según el último registro, tu próximo mantenimiento todavía no está vencido.'
  }
}

export function buildPublicWorkshopVehicle(input: {
  vehicle: PublicVehicle
  jobs: PublicHistoryJob[]
  latestJob?: PublicHistoryJob | null
  hasMore: boolean
  nextOffset: number | null
  now?: Date
}) {
  const { vehicle, jobs } = input
  const historyItems = jobs.map(job => {
    const lines = safeLines(job.lines)
    return {
      id: job.id,
      date: job.date,
      mileage: job.mileage,
      serviceType: lines[0]?.description ?? 'Servicio registrado',
      summary: lines.map(line => line.description).join(', ') || 'Servicio registrado',
      items: lines.map(line => ({ name: line.description, quantity: line.quantity }))
    }
  })
  const latestSource = input.latestJob === undefined ? jobs[0] ?? null : input.latestJob
  const latest = latestSource ? {
    id: latestSource.id,
    date: latestSource.date,
    mileage: latestSource.mileage
  } : null
  const policy = workshopMaintenancePolicy(vehicle.usage)
  const nextDate = latest ? addMonths(latest.date, policy.months) : null
  const nextMileage = latest ? latest.mileage + policy.kilometers : null
  const status = nextDate && nextMileage
    ? recommendationStatus(nextDate, nextMileage, vehicle.currentMileage, input.now ?? new Date())
    : null

  return {
    plate: vehicle.plate,
    brand: vehicle.brand.name,
    model: vehicle.model,
    year: vehicle.year,
    engine: vehicle.engine === '--' ? null : vehicle.engine,
    usage: vehicle.usage,
    currentMileage: vehicle.currentMileage,
    lastService: latest ? { date: latest.date, mileage: latest.mileage } : null,
    recommendation: latest && nextDate && nextMileage ? {
      nextDate,
      nextMileage,
      intervalMonths: policy.months,
      intervalKilometers: policy.kilometers,
      ...status
    } : null,
    history: {
      items: historyItems,
      hasMore: input.hasMore,
      nextOffset: input.nextOffset
    }
  }
}
