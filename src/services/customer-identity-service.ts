import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../config/prisma.js'
import { inferDefaultAreaCodeFromPhone, normalizeCustomerPhone, phoneSearchVariants } from './phone-normalization-service.js'
import type { BusinessAuthorizationUser } from './business-authorization.js'
import {
  authorizedCustomerWhere,
  loadAuthorizedCustomer
} from './tenant-resource-authorization.js'

export class CustomerPhoneValidationError extends Error {}
export class CustomerPhoneConflictError extends Error {}
export class CustomerEmailValidationError extends Error {}
export class CustomerBusinessScopeError extends Error {}

type FindOrCreateCustomerInput = {
  name: string
  phone: string
  email?: string | null | undefined
  businessId: string
  defaultAreaCode?: string | null | undefined
}

type CreateProvisionalCustomerInput = {
  name: string
  businessId: string
  email?: string | null | undefined
}

export async function createProvisionalCustomer(input: CreateProvisionalCustomerInput) {
  const name = input.name.trim()
  const businessId = requireBusinessId(input.businessId)
  const email = normalizeCustomerEmail(input.email)
  if (!name) throw new CustomerPhoneValidationError('El nombre del cliente es requerido')

  return prisma.customer.create({
    data: {
      businessId,
      name,
      phone: '',
      normalizedPhone: null,
      email: email ?? null
    }
  })
}

export function customerHasContactIdentity(phone?: string | null) {
  return Boolean(phone?.trim())
}

export async function findOrCreateCustomerByPhone(input: FindOrCreateCustomerInput) {
  const name = input.name.trim()
  const businessId = requireBusinessId(input.businessId)
  const defaultAreaCode = input.defaultAreaCode || await defaultAreaCodeForBusiness(businessId)
  const normalized = normalizeCustomerPhone(input.phone, { defaultAreaCode })
  const email = normalizeCustomerEmail(input.email)
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
  const lockKey = `${businessId}:${canonicalPhone}`

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw<Array<{ locked: number }>>`
      SELECT 1 AS "locked"
      FROM pg_advisory_xact_lock(hashtext(${lockKey}))
    `

    let customer = await transaction.customer.findFirst({
      where: {
        businessId,
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
        WHERE "businessId" = ${businessId}
          AND regexp_replace("phone", '[^0-9]', '', 'g') IN (${Prisma.join(digitVariants)})
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
          data: {
            phone: canonicalPhone,
            normalizedPhone: canonicalPhone,
            ...(email && !customer.email ? { email } : {})
          }
        })
      : await transaction.customer.create({
          data: { businessId, name, phone: canonicalPhone, normalizedPhone: canonicalPhone, email: email ?? null }
        })

    await transaction.customerMarketingPreference.upsert({
      where: { businessId_customerId: { businessId, customerId: customer.id } },
      create: {
        businessId,
        customerId: customer.id,
        status: 'ACTIVE',
        source: 'DEFAULT',
        optedInAt: new Date()
      },
      update: {}
    })

    return { customer, wasExisting, nameConflict, canonicalPhone }
  })
}

export async function updateCustomerIdentity(input: FindOrCreateCustomerInput & {
  customerId: string
  authorizationUser?: BusinessAuthorizationUser
}) {
  const name = input.name.trim()
  const businessId = requireBusinessId(input.businessId)
  const defaultAreaCode = input.defaultAreaCode || await defaultAreaCodeForBusiness(businessId)
  const normalized = normalizeCustomerPhone(input.phone, { defaultAreaCode })
  const email = normalizeCustomerEmail(input.email)
  if (!name) throw new CustomerPhoneValidationError('El nombre del cliente es requerido')
  if (!normalized.ok) throw new CustomerPhoneValidationError(normalized.message)

  const canonicalPhone = normalized.phone
  const digitVariants = phoneSearchVariants(input.phone, { defaultAreaCode })
  const literalVariants = [...new Set([input.phone.trim(), canonicalPhone, `+${canonicalPhone}`, normalized.display, ...digitVariants].filter(Boolean))]
  const lockKey = `${businessId}:${canonicalPhone}`

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw<Array<{ locked: number }>>`
      SELECT 1 AS "locked"
      FROM pg_advisory_xact_lock(hashtext(${lockKey}))
    `
    const current = input.authorizationUser
      ? await loadAuthorizedCustomer(transaction, input.authorizationUser, input.customerId)
      : await transaction.customer.findFirst({ where: { id: input.customerId, businessId } })
    if (!current || current.businessId !== businessId) {
      throw new CustomerBusinessScopeError('Ese cliente no pertenece a este comercio')
    }

    let conflict = await transaction.customer.findFirst({
      where: {
        businessId,
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
        WHERE "businessId" = ${businessId}
          AND "id" <> ${input.customerId}
          AND regexp_replace("phone", '[^0-9]', '', 'g') IN (${Prisma.join(digitVariants)})
        LIMIT 1
      `
      conflict = rows[0] || null
    }
    if (conflict) throw new CustomerPhoneConflictError('Ese telefono ya pertenece a otra ficha. Abrila desde el buscador en lugar de reemplazarlo.')

    return transaction.customer.update({
      where: input.authorizationUser
        ? { id: input.customerId, AND: authorizedCustomerWhere(input.authorizationUser, input.customerId) }
        : { id: input.customerId },
      data: {
        name,
        phone: canonicalPhone,
        normalizedPhone: canonicalPhone,
        ...(email !== undefined ? { email } : {})
      }
    })
  })
}

export function normalizeCustomerEmail(value?: string | null) {
  if (value === undefined) return undefined
  const email = value?.trim().toLowerCase() || null
  if (!email) return null
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new CustomerEmailValidationError('Ingresa un correo electronico valido')
  }
  return email
}

export function customerNamesDiffer(existingName: string, requestedName: string) {
  return normalizeCustomerName(existingName) !== normalizeCustomerName(requestedName)
}

function normalizeCustomerName(value: string) {
  return value.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')
}

function requireBusinessId(value: string) {
  const businessId = value?.trim()
  if (!businessId) throw new CustomerBusinessScopeError('El comercio es requerido para gestionar clientes')
  return businessId
}

async function defaultAreaCodeForBusiness(businessId: string) {
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
