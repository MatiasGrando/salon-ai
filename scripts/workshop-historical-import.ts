import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../src/config/prisma.js'
import { normalizeWorkshopBrand } from '../src/services/workshop-vehicle-domain.js'

type LegacyRow = Record<string, string>

export type LegacyWorkshopSource = {
  source: string
  vehicles: LegacyRow[]
  headers: LegacyRow[]
  lines: LegacyRow[]
}

type ImportLine = {
  description: string
  quantity: number
  partsCents: number | null
  laborCents: number | null
}

type PlannedVehicle = {
  plate: string
  brandName: string
  normalizedBrandName: string
  model: string
  engine: string
  currentMileage: number | null
  usage: 'PARTICULAR'
  contact: { name: string; phone: string; normalizedPhone: string; email: string | null }
}

type PlannedJob = {
  plate: string
  date: string
  mileage: number
  lines: ImportLine[]
  totalCents: number
}

export type WorkshopHistoricalImportPlan = {
  brands: Array<{ name: string; normalizedName: string }>
  vehicles: PlannedVehicle[]
  jobs: PlannedJob[]
  summary: {
    sourceRecords: { vehicles: number; headers: number; lines: number }
    skippedInvalidPlates: number
    skippedInvalidDates: number
    collapsedVehicleDuplicates: number
    collapsedJobDuplicates: number
    vehiclesWithoutLegacyContact: number
    jobsWithoutMileage: number
  }
}

const TOKEN_BRANDS: Record<string, string> = {
  ALFA: 'Alfa Romeo', AUDI: 'Audi', BMW: 'BMW', CHERY: 'Chery', CHEV: 'Chevrolet', CHEVROLET: 'Chevrolet',
  CHRYSLER: 'Chrysler', CITROEN: 'Citroën', CITRTOEN: 'Citroën', DODGE: 'Dodge', FIAT: 'Fiat', FOR: 'Ford',
  FORD: 'Ford', FORF: 'Ford', HONDA: 'Honda', HONDE: 'Honda', HIUNDAI: 'Hyundai', HIUNDAY: 'Hyundai',
  HYUNDAI: 'Hyundai', ISUZU: 'Isuzu', IVECO: 'Iveco', JEEP: 'Jeep', JEEPP: 'Jeep', KIA: 'Kia', KISA: 'Kia',
  MERCEDES: 'Mercedes-Benz', MERCEDEZ: 'Mercedes-Benz', MITSUBISHI: 'Mitsubishi', NISSAN: 'Nissan',
  PEUGEOT: 'Peugeot', PEUGOT: 'Peugeot', RANAUL: 'Renault', RANAULT: 'Renault', REANULT: 'Renault',
  RENAILT: 'Renault', RENAUL: 'Renault', RENAULT: 'Renault', TRANULT: 'Renault', TOYOTA: 'Toyota',
  TOYOYA: 'Toyota', VOLKSWAGEN: 'Volkswagen', VOLSKWAGEN: 'Volkswagen', VOLSWAGEN: 'Volkswagen', VW: 'Volkswagen'
}

const IMPLIED_MODEL_BRANDS: Record<string, string> = { DUSTER: 'Renault', JUMPER: 'Citroën', RENEGADE: 'Jeep' }
const CONCATENATED_PREFIXES = [
  { prefix: 'VOLSKWAGENGOL', brand: 'Volkswagen', model: 'GOL' },
  { prefix: 'RENAULTOROCH', brand: 'Renault', model: 'OROCH' },
  { prefix: 'PEUGEOTPARTNER', brand: 'Peugeot', model: 'PARTNER' },
  { prefix: 'PEUGEOT208', brand: 'Peugeot', model: '208' },
  { prefix: 'FIATSIENA', brand: 'Fiat', model: 'SIENA' }
]
const FLAG_LABELS: Record<string, string> = {
  ACEITE: 'Cambio de aceite', FACEITE: 'Filtro de aceite', FAIRE: 'Filtro de aire',
  FCOMB: 'Filtro de combustible', FHABIT: 'Filtro de habitáculo', ENGRASE: 'Engrase',
  CORREA: 'Correa de distribución', TENSOR: 'Tensor de correa'
}
const DBF_DECODER = new TextDecoder('windows-1252')

function normalizeLegacyText(value: unknown) {
  return String(value || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/RENAUL\.T/g, 'RENAULT').replace(/[^A-Z0-9.]+/g, ' ').trim().replace(/\s+/g, ' ')
}

export function splitLegacyWorkshopVehicle(value: unknown) {
  const text = normalizeLegacyText(value)
  if (!text) return { brandName: 'Sin marca', model: 'Sin modelo' }
  for (const rule of CONCATENATED_PREFIXES) {
    if (!text.startsWith(rule.prefix)) continue
    const suffix = text.slice(rule.prefix.length).trim()
    return { brandName: rule.brand, model: [rule.model, suffix].filter(Boolean).join(' ') }
  }
  if (/^MERCEDES BENZ(?: |$)/.test(text)) return { brandName: 'Mercedes-Benz', model: text.replace(/^MERCEDES BENZ\s*/, '') || 'Sin modelo' }
  if (/^ALFA ROMEO(?: |$)/.test(text)) return { brandName: 'Alfa Romeo', model: text.replace(/^ALFA ROMEO\s*/, '') || 'Sin modelo' }
  const [token, ...rest] = text.split(' ')
  const impliedBrand = IMPLIED_MODEL_BRANDS[token]
  if (impliedBrand) return { brandName: impliedBrand, model: text }
  const brandName = TOKEN_BRANDS[token]
  return brandName ? { brandName, model: rest.join(' ') || 'Sin modelo' } : { brandName: 'Sin marca', model: text }
}

export function readLegacyDbf(path: string, wantedFields: string[]) {
  const file = readFileSync(path)
  if (file.length < 32) throw new Error(`DBF inválido: ${path}`)
  const recordCount = file.readUInt32LE(4)
  const headerLength = file.readUInt16LE(8)
  const recordLength = file.readUInt16LE(10)
  const fields: Array<{ name: string; offset: number; length: number }> = []
  let cursor = 32, offset = 1
  while (cursor + 32 <= headerLength) {
    if (file[cursor] === 0x0d) break
    const name = file.subarray(cursor, cursor + 11).toString('ascii').replace(/\0/g, '').trim()
    const length = file[cursor + 16]
    if (wantedFields.includes(name)) fields.push({ name, offset, length })
    offset += length
    cursor += 32
  }
  const rows: LegacyRow[] = []
  for (let index = 0; index < recordCount; index += 1) {
    const start = headerLength + index * recordLength
    if (start + recordLength > file.length) break
    if (file[start] === 0x2a) continue
    const row: LegacyRow = {}
    for (const field of fields) row[field.name] = DBF_DECODER.decode(file.subarray(start + field.offset, start + field.offset + field.length)).replace(/\0/g, '').trim()
    rows.push(row)
  }
  return rows
}

export function loadLegacyWorkshopSource(source: string): LegacyWorkshopSource {
  return {
    source,
    vehicles: readLegacyDbf(resolve(source, 'autoclie.DBF'), ['PATENTE', 'MODELO', 'CLIENTE', 'TELEFONO', 'EMAIL']),
    headers: readLegacyDbf(resolve(source, 'autocli2.DBF'), ['PATENTE', 'FECHA', 'KM', ...Object.keys(FLAG_LABELS)]),
    lines: readLegacyDbf(resolve(source, 'autocli3.DBF'), ['PATENTE', 'FECHA', 'CANTIDAD', 'DESCRIP', 'REPUESTO', 'MANOOBRA'])
  }
}

function normalizePlate(value: unknown) {
  const plate = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^(?:[A-Z]{3}[0-9]{3}|[A-Z]{2}[0-9]{3}[A-Z]{2})$/.test(plate) ? plate : null
}

function dateIso(value: unknown) {
  const raw = String(value || '').trim()
  if (!/^(\d{4})(\d{2})(\d{2})$/.test(raw)) return null
  const result = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  const parsed = new Date(`${result}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result ? result : null
}

function integer(value: unknown) {
  const raw = String(value || '').trim().replace(/\./g, '').replace(',', '.')
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(10_000_000, Math.round(parsed)) : null
}

function cents(value: unknown) {
  const raw = String(value || '').trim().replace(',', '.')
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null
}

function shortText(value: unknown, fallback: string, maxLength: number) {
  const result = String(value || '').trim().replace(/\s+/g, ' ')
  return (result || fallback).slice(0, maxLength)
}

function contactFromLegacy(row: LegacyRow | undefined, plate: string) {
  const digits = String(row?.TELEFONO || '').replace(/\D/g, '')
  const local = /^(?:11|15)\d{8}$/.test(digits) ? digits.slice(2) : null
  const email = String(row?.EMAIL || '').trim().toLowerCase()
  return {
    name: shortText(row?.CLIENTE, 'Sin registro', 120),
    phone: local ? `11-${local.slice(0, 4)}-${local.slice(4)}` : '',
    normalizedPhone: local ? `54911${local}` : `legacy-${plate.toLowerCase()}`,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.slice(0, 200) : null
  }
}

function sourceLineMap(source: LegacyWorkshopSource, summary: { skippedInvalidPlates: number; skippedInvalidDates: number }) {
  const map = new Map<string, ImportLine[]>()
  for (const row of source.lines) {
    const plate = normalizePlate(row.PATENTE), date = dateIso(row.FECHA)
    if (!plate) { summary.skippedInvalidPlates += 1; continue }
    if (!date) { summary.skippedInvalidDates += 1; continue }
    const line: ImportLine = {
      description: shortText(row.DESCRIP, 'Servicio registrado', 300),
      quantity: Math.max(1, Math.min(999, integer(row.CANTIDAD) || 1)),
      partsCents: cents(row.REPUESTO), laborCents: cents(row.MANOOBRA)
    }
    const key = `${plate}|${date}`
    const entries = map.get(key) || []
    const signature = JSON.stringify(line)
    if (!entries.some(entry => JSON.stringify(entry) === signature)) entries.push(line)
    map.set(key, entries)
  }
  return map
}

function jobQuality(lines: ImportLine[]) {
  return lines.length * 10 + lines.filter(line => line.partsCents != null || line.laborCents != null).length
}

export function buildWorkshopHistoricalImportPlan(sources: LegacyWorkshopSource[]): WorkshopHistoricalImportPlan {
  const summary = {
    sourceRecords: { vehicles: 0, headers: 0, lines: 0 }, skippedInvalidPlates: 0, skippedInvalidDates: 0,
    collapsedVehicleDuplicates: 0, collapsedJobDuplicates: 0, vehiclesWithoutLegacyContact: 0, jobsWithoutMileage: 0
  }
  const vehicleRows = new Map<string, { row: LegacyRow; sourceIndex: number }>()
  const jobs = new Map<string, PlannedJob & { sourceIndex: number }>()

  for (const [sourceIndex, source] of sources.entries()) {
    summary.sourceRecords.vehicles += source.vehicles.length
    summary.sourceRecords.headers += source.headers.length
    summary.sourceRecords.lines += source.lines.length
    for (const row of source.vehicles) {
      const plate = normalizePlate(row.PATENTE)
      if (!plate) { summary.skippedInvalidPlates += 1; continue }
      if (vehicleRows.has(plate)) summary.collapsedVehicleDuplicates += 1
      vehicleRows.set(plate, { row, sourceIndex })
    }

    const linesByJob = sourceLineMap(source, summary)
    for (const header of source.headers) {
      const plate = normalizePlate(header.PATENTE), date = dateIso(header.FECHA)
      if (!plate) { summary.skippedInvalidPlates += 1; continue }
      if (!date) { summary.skippedInvalidDates += 1; continue }
      const mileage = integer(header.KM)
      if (mileage == null) summary.jobsWithoutMileage += 1
      const lines = linesByJob.get(`${plate}|${date}`) || []
      if (!lines.length) {
        for (const [field, label] of Object.entries(FLAG_LABELS)) {
          if (integer(header[field]) === 1) lines.push({ description: label, quantity: 1, partsCents: null, laborCents: null })
        }
      }
      if (!lines.length) lines.push({ description: 'Servicio registrado', quantity: 1, partsCents: null, laborCents: null })
      const key = `${plate}|${date}|${mileage ?? 0}`
      const next: PlannedJob & { sourceIndex: number } = {
        plate, date, mileage: mileage ?? 0, lines,
        totalCents: lines.reduce((total, line) => total + line.quantity * ((line.partsCents || 0) + (line.laborCents || 0)), 0),
        sourceIndex
      }
      const current = jobs.get(key)
      if (current) {
        summary.collapsedJobDuplicates += 1
        if (sourceIndex > current.sourceIndex || (sourceIndex === current.sourceIndex && jobQuality(next.lines) >= jobQuality(current.lines))) jobs.set(key, next)
      } else jobs.set(key, next)
    }
  }

  const maxMileageByPlate = new Map<string, number>()
  for (const job of jobs.values()) maxMileageByPlate.set(job.plate, Math.max(maxMileageByPlate.get(job.plate) || 0, job.mileage))
  const plates = new Set([...vehicleRows.keys(), ...[...jobs.values()].map(job => job.plate)])
  const vehicles = [...plates].sort().map(plate => {
    const legacy = vehicleRows.get(plate)?.row
    const parsed = splitLegacyWorkshopVehicle(legacy?.MODELO)
    const brand = normalizeWorkshopBrand(parsed.brandName)
    const contact = contactFromLegacy(legacy, plate)
    if (!contact.phone) summary.vehiclesWithoutLegacyContact += 1
    return {
      plate, brandName: brand.name, normalizedBrandName: brand.normalizedName,
      model: shortText(parsed.model, 'Sin modelo', 100), engine: '--', currentMileage: maxMileageByPlate.get(plate) ?? null,
      usage: 'PARTICULAR' as const, contact
    }
  })
  const brands = [...new Map(vehicles.map(vehicle => [vehicle.normalizedBrandName, { name: vehicle.brandName, normalizedName: vehicle.normalizedBrandName }])).values()]
    .sort((left, right) => left.name.localeCompare(right.name, 'es'))
  return { brands, vehicles, jobs: [...jobs.values()].map(({ sourceIndex: _sourceIndex, ...job }) => job).sort((left, right) => left.date.localeCompare(right.date) || left.plate.localeCompare(right.plate)), summary }
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

async function findByValues<T extends { [key: string]: unknown }>(values: string[], read: (batch: string[]) => Promise<T[]>) {
  const results: T[] = []
  for (const batch of chunks(values, 500)) results.push(...await read(batch))
  return results
}

async function applyPlan(plan: WorkshopHistoricalImportPlan, customerCode: string, accountEmail: string, resume: boolean) {
  const business = await prisma.business.findUnique({ where: { customerCode }, select: { id: true, name: true, businessType: true } })
  if (!business || business.businessType !== 'WORKSHOP') throw new Error(`No existe un Taller para el código ${customerCode}`)
  const owner = await prisma.user.findFirst({ where: { email: accountEmail, businessId: business.id }, select: { id: true } })
  if (!owner) throw new Error(`La cuenta ${accountEmail} no corresponde al Taller ${customerCode}`)
  const [vehicleCount, jobCount] = await Promise.all([
    prisma.workshopVehicle.count({ where: { businessId: business.id } }),
    prisma.workshopJob.count({ where: { businessId: business.id } })
  ])
  if ((vehicleCount || jobCount) && !resume) throw new Error(`El Lubricentro ya tiene ${vehicleCount} autos y ${jobCount} trabajos. Usá --resume sólo para retomar esta misma importación.`)

  const existingBrands = await prisma.workshopBrand.findMany({ where: { businessId: business.id }, select: { id: true, normalizedName: true } })
  const missingBrands = plan.brands.filter(brand => !existingBrands.some(existing => existing.normalizedName === brand.normalizedName))
  if (missingBrands.length) await prisma.workshopBrand.createMany({ data: missingBrands.map(brand => ({ id: randomUUID(), businessId: business.id, ...brand })), skipDuplicates: true })
  const brands = await prisma.workshopBrand.findMany({ where: { businessId: business.id }, select: { id: true, normalizedName: true } })
  const brandIds = new Map(brands.map(brand => [brand.normalizedName, brand.id]))

  const contacts = [...new Map(plan.vehicles.map(vehicle => [vehicle.contact.normalizedPhone, vehicle.contact])).values()]
  const existingCustomers = await findByValues(contacts.map(contact => contact.normalizedPhone), batch => prisma.customer.findMany({ where: { businessId: business.id, normalizedPhone: { in: batch } }, select: { id: true, normalizedPhone: true } }))
  const knownCustomerPhones = new Set(existingCustomers.map(customer => customer.normalizedPhone))
  const newContacts = contacts.filter(contact => !knownCustomerPhones.has(contact.normalizedPhone))
  for (const batch of chunks(newContacts, 500)) await prisma.customer.createMany({ data: batch.map(contact => ({ id: randomUUID(), businessId: business.id, ...contact })), skipDuplicates: true })
  const customers = await findByValues(contacts.map(contact => contact.normalizedPhone), batch => prisma.customer.findMany({ where: { businessId: business.id, normalizedPhone: { in: batch } }, select: { id: true, normalizedPhone: true } }))
  const customerIds = new Map(customers.map(customer => [customer.normalizedPhone, customer.id]))

  const existingVehicles = await findByValues(plan.vehicles.map(vehicle => vehicle.plate), batch => prisma.workshopVehicle.findMany({ where: { businessId: business.id, plate: { in: batch } }, select: { id: true, plate: true } }))
  const knownVehiclePlates = new Set(existingVehicles.map(vehicle => vehicle.plate))
  const newVehicles = plan.vehicles.filter(vehicle => !knownVehiclePlates.has(vehicle.plate))
  for (const batch of chunks(newVehicles, 500)) await prisma.workshopVehicle.createMany({
    data: batch.map(vehicle => ({
      id: randomUUID(), businessId: business.id, plate: vehicle.plate,
      brandId: brandIds.get(vehicle.normalizedBrandName)!, customerId: customerIds.get(vehicle.contact.normalizedPhone)!,
      model: vehicle.model, year: null, engine: vehicle.engine, currentMileage: vehicle.currentMileage, usage: vehicle.usage
    })), skipDuplicates: true
  })
  const vehicles = await findByValues(plan.vehicles.map(vehicle => vehicle.plate), batch => prisma.workshopVehicle.findMany({ where: { businessId: business.id, plate: { in: batch } }, select: { id: true, plate: true } }))
  const vehicleIds = new Map(vehicles.map(vehicle => [vehicle.plate, vehicle.id]))

  const importedJobs = await prisma.workshopJob.findMany({ where: { businessId: business.id, responsible: null }, select: { vehicleId: true, date: true, mileage: true } })
  const existingJobKeys = new Set(importedJobs.map(job => `${job.vehicleId}|${job.date}|${job.mileage}`))
  const newJobs = plan.jobs.filter(job => !existingJobKeys.has(`${vehicleIds.get(job.plate)}|${job.date}|${job.mileage}`))
  for (const batch of chunks(newJobs, 500)) await prisma.workshopJob.createMany({
    data: batch.map(job => ({ id: randomUUID(), businessId: business.id, vehicleId: vehicleIds.get(job.plate)!, date: job.date, mileage: job.mileage, responsible: null, performerId: null, notes: '', lines: job.lines, totalCents: job.totalCents }))
  })
  const [finalVehicleCount, finalJobCount] = await Promise.all([
    prisma.workshopVehicle.count({ where: { businessId: business.id } }),
    prisma.workshopJob.count({ where: { businessId: business.id } })
  ])
  return { business: business.name, customerCode, created: { brands: missingBrands.length, customers: newContacts.length, vehicles: newVehicles.length, jobs: newJobs.length }, totals: { vehicles: finalVehicleCount, jobs: finalJobCount } }
}

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const sourcePaths = ['F:\\tMecanica', 'F:\\tMecanica 1']
  const plan = buildWorkshopHistoricalImportPlan(sourcePaths.map(loadLegacyWorkshopSource))
  console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run', vehicles: plan.vehicles.length, jobs: plan.jobs.length, brands: plan.brands.length, ...plan.summary }, null, 2))
  if (!process.argv.includes('--apply')) return
  const customerCode = argument('--customer-code'), accountEmail = argument('--account-email')
  if (!customerCode || !accountEmail) throw new Error('Para aplicar se requieren --customer-code y --account-email')
  console.log(JSON.stringify(await applyPlan(plan, customerCode, accountEmail, process.argv.includes('--resume')), null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => prisma.$disconnect())
}
