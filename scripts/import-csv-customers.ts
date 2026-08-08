import { readFile } from 'node:fs/promises'
import { prisma } from '../src/config/prisma.js'
import { findOrCreateCustomerByPhone, normalizeCustomerEmail } from '../src/services/customer-identity-service.js'
import { normalizeCustomerPhone } from '../src/services/phone-normalization-service.js'

type CsvRow = Record<string, string>

const [filePath, businessName, mode, limitArgument] = process.argv.slice(2)
const applyChanges = mode === '--apply'
const limit = Number(limitArgument?.replace('--limit=', '')) || null

if (!filePath || !businessName) {
  throw new Error('Uso: tsx scripts/import-csv-customers.ts <archivo.csv> <nombre-comercio> [--apply] [--limit=75]')
}

const business = await findBusinessByName(businessName)
if (!business) throw new Error(`No encontré un comercio llamado "${businessName}"`)

const rows = parseCsv(await readFile(filePath, 'utf8'))
const candidates = uniqueCandidates(rows)
const existingPhones = new Set((await prisma.customer.findMany({
  select: { normalizedPhone: true }
})).flatMap((customer) => customer.normalizedPhone ? [customer.normalizedPhone] : []))
const candidatePhones = candidates.map((candidate) => candidate.phone)

if (!applyChanges) {
  const existing = candidates.filter((candidate) => existingPhones.has(candidate.phone)).length
  console.log(JSON.stringify({
    mode: 'preview',
    business: business.name,
    csvRows: rows.length,
    rowsWithPhone: candidates.length,
    invalidOrMissingPhone: rows.length - candidates.length,
    duplicatePhonesInCsv: countDuplicatePhones(rows),
    alreadyRegistered: existing,
    readyToCreate: candidates.length - existing
  }, null, 2))
  await prisma.$disconnect()
  process.exit(0)
}

const pendingCandidates = candidates.filter((candidate) => !existingPhones.has(candidate.phone))
const importCandidates = limit ? pendingCandidates.slice(0, limit) : pendingCandidates
let created = 0
let alreadyRegistered = 0
let errors = 0
for (const candidate of importCandidates) {
  try {
    const result = await findOrCreateCustomerByPhone({
      businessId: business.id,
      name: candidate.name,
      phone: candidate.phone,
      email: candidate.email
    })
    if (result.wasExisting) alreadyRegistered += 1
    else created += 1
  } catch {
    errors += 1
  }
}

const activePreferences = await prisma.customerMarketingPreference.count({
  where: { businessId: business.id, status: 'ACTIVE' }
})
const importedCustomers = await prisma.customer.findMany({
  where: { normalizedPhone: { in: candidatePhones } },
  select: {
    marketingPreferences: {
      where: { businessId: business.id, status: 'ACTIVE' },
      select: { id: true }
    }
  }
})
console.log(JSON.stringify({
  mode: 'import',
  business: business.name,
  rowsWithPhone: candidates.length,
  processedInThisBatch: importCandidates.length,
  created,
  alreadyRegistered,
  errors,
  remainingAfterThisBatch: Math.max(0, pendingCandidates.length - importCandidates.length),
  activeMarketingPreferences: activePreferences,
  importedContactsWithActivePromotions: importedCustomers.filter(
    (customer) => customer.marketingPreferences.length > 0
  ).length
}, null, 2))
await prisma.$disconnect()

async function findBusinessByName(name: string) {
  const normalizedName = normalizeName(name)
  const businesses = await prisma.business.findMany({
    select: { id: true, name: true }
  })
  return businesses.find((business) => normalizeName(business.name) === normalizedName) ?? null
}

function uniqueCandidates(rows: CsvRow[]) {
  const byPhone = new Map<string, { name: string; phone: string; email: string | undefined }>()
  for (const row of rows) {
    const phone = normalizeCustomerPhone(row['Número de móvil'] || row['Teléfono'])
    if (!phone.ok || byPhone.has(phone.phone)) continue
    const name = (row['Nombre completo'] || [row['Nombre'], row['Apellido']].filter(Boolean).join(' ') || 'Cliente importado').trim()
    const email = validEmail(row.Email)
    byPhone.set(phone.phone, { name, phone: phone.phone, email })
  }
  return [...byPhone.values()]
}

function countDuplicatePhones(rows: CsvRow[]) {
  let duplicates = 0
  const phones = new Set<string>()
  for (const row of rows) {
    const phone = normalizeCustomerPhone(row['Número de móvil'] || row['Teléfono'])
    if (!phone.ok) continue
    if (phones.has(phone.phone)) duplicates += 1
    phones.add(phone.phone)
  }
  return duplicates
}

function validEmail(value: string | undefined) {
  try {
    return normalizeCustomerEmail(value)
  } catch {
    return undefined
  }
}

function normalizeName(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function parseCsv(content: string) {
  const cells: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] ?? ''
    const nextCharacter = content[index + 1] ?? ''
    if (character === '"') {
      if (quoted && nextCharacter === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (character === ',' && !quoted) {
      row.push(cell)
      cell = ''
      continue
    }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && nextCharacter === '\n') index += 1
      row.push(cell)
      if (row.some(Boolean)) cells.push(row)
      row = []
      cell = ''
      continue
    }
    cell += character
  }
  row.push(cell)
  if (row.some(Boolean)) cells.push(row)

  const [headers = [], ...records] = cells
  return records.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ''])))
}
