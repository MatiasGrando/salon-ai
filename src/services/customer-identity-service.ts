import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../config/prisma.js'
import { inferDefaultAreaCodeFromPhone, normalizeCustomerPhone, phoneSearchVariants } from './phone-normalization-service.js'

export class CustomerPhoneValidationError extends Error {}
export class CustomerPhoneConflictError extends Error {}

type FindOrCreateCustomerInput = {
  name: string
  phone: string
  businessId?: string | null | undefined
  defaultAreaCode?: string | null | undefined
}

export async function findOrCreateCustomerByPhone(input: FindOrCreateCustomerInput) {
  const name = input.name.trim()
  const defaultAreaCode = input.defaultAreaCode || await defaultAreaCodeForBusiness(input.businessId)
  const normalized = normalizeCustomerPhone(input.phone, { defaultAreaCode })
  if (!name) throw new CustomerPhoneValidationError('El nombre del cliente es requerido')
  if (!normalized.ok) throw new CustomerPhoneValidationError(normalized.message)

  const canonicalPhone = normalized.phone
  const digitVariants = phoneSearchVariants(input.phone, { defaultAreaCode })
  const literalVariants = [...new Set([
    input.phone.trim(),
    canonicalPhone,
    `+${canonicalPhone}`,
    normalized.display,
    ...digitVariants
  ].filter(Boolean))]

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw<Array<{ locked: number }>>`
      SELECT 1 AS "locked"
      FROM pg_advisory_xact_lock(hashtext(${canonicalPhone}))
    `

    let customer = await transaction.customer.findFirst({
      where: {
        OR: [
          { normalizedPhone: canonicalPhone },
          { phone: { in: literalVariants } }
        ]
      },
      orderBy: { createdAt: 'asc' }
    })

    if (!customer && digitVariants.length) {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Customer"
        WHERE regexp_replace("phone", '[^0-9]', '', 'g') IN (${Prisma.join(digitVariants)})
        ORDER BY "createdAt" ASC
        LIMIT 1
      `
      if (rows[0]?.id) customer = await transaction.customer.findUnique({ where: { id: rows[0].id } })
    }

    const wasExisting = Boolean(customer)
    const nameConflict = customer && customerNamesDiffer(customer.name, name)
      ? { existingName: customer.name, requestedName: name }
      : null
    customer = customer
      ? await transaction.customer.update({
          where: { id: customer.id },
          data: { phone: canonicalPhone, normalizedPhone: canonicalPhone }
        })
      : await transaction.customer.create({
          data: { name, phone: canonicalPhone, normalizedPhone: canonicalPhone }
        })

    if (input.businessId) {
      await transaction.customerMarketingPreference.upsert({
        where: { businessId_customerId: { businessId: input.businessId, customerId: customer.id } },
        create: {
          businessId: input.businessId,
          customerId: customer.id,
          status: 'ACTIVE',
          source: 'DEFAULT',
          optedInAt: new Date()
        },
        update: {}
      })
    }

    return { customer, wasExisting, nameConflict, canonicalPhone }
  })
}

export async function updateCustomerIdentity(input: FindOrCreateCustomerInput & { customerId: string }) {
  const name = input.name.trim()
  const defaultAreaCode = input.defaultAreaCode || await defaultAreaCodeForBusiness(input.businessId)
  const normalized = normalizeCustomerPhone(input.phone, { defaultAreaCode })
  if (!name) throw new CustomerPhoneValidationError('El nombre del cliente es requerido')
  if (!normalized.ok) throw new CustomerPhoneValidationError(normalized.message)

  const canonicalPhone = normalized.phone
  const digitVariants = phoneSearchVariants(input.phone, { defaultAreaCode })
  const literalVariants = [...new Set([input.phone.trim(), canonicalPhone, `+${canonicalPhone}`, normalized.display, ...digitVariants].filter(Boolean))]

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw<Array<{ locked: number }>>`
      SELECT 1 AS "locked"
      FROM pg_advisory_xact_lock(hashtext(${canonicalPhone}))
    `
    const current = await transaction.customer.findUnique({ where: { id: input.customerId } })
    if (!current) throw new CustomerPhoneValidationError('No encontre ese cliente')

    let conflict = await transaction.customer.findFirst({
      where: {
        id: { not: input.customerId },
        OR: [
          { normalizedPhone: canonicalPhone },
          { phone: { in: literalVariants } }
        ]
      },
      select: { id: true }
    })
    if (!conflict && digitVariants.length) {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Customer"
        WHERE "id" <> ${input.customerId}
          AND regexp_replace("phone", '[^0-9]', '', 'g') IN (${Prisma.join(digitVariants)})
        LIMIT 1
      `
      conflict = rows[0] || null
    }
    if (conflict) throw new CustomerPhoneConflictError('Ese telefono ya pertenece a otra ficha. Abrila desde el buscador en lugar de reemplazarlo.')

    return transaction.customer.update({
      where: { id: input.customerId },
      data: { name, phone: canonicalPhone, normalizedPhone: canonicalPhone }
    })
  })
}

export function customerNamesDiffer(existingName: string, requestedName: string) {
  return normalizeCustomerName(existingName) !== normalizeCustomerName(requestedName)
}

function normalizeCustomerName(value: string) {
  return value.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')
}

async function defaultAreaCodeForBusiness(businessId?: string | null) {
  if (!businessId) return undefined
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      publicWhatsapp: true,
      whatsappConfig: { select: { displayPhoneNumber: true } }
    }
  })
  const referencePhone = business?.whatsappConfig?.displayPhoneNumber || business?.publicWhatsapp
  return referencePhone ? inferDefaultAreaCodeFromPhone(referencePhone) : undefined
}
