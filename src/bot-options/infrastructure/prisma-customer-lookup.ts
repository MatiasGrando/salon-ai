/**
 * F6.1 — Implementación Prisma del repositorio de lookup de clientes.
 *
 * Lookup READ-ONLY y TENANT-SCOPED por teléfono + negocio.
 * NO crea filas, NO toma advisory locks, NO usa find-or-create.
 * Reutiliza la estrategia de búsqueda existente en customer-identity-service.ts
 * (normalizedPhone, literal variants, digit regexp) pero sin transacción ni lock.
 */

import { Prisma } from '../../generated/prisma/client.js'
import type { CustomerLookupRepository, CustomerLookupResult } from '../domain/customer-lookup.js'

type PrismaTx = {
  $queryRaw: <T>(query: Prisma.Sql) => Promise<T>
}

/**
 * Implementación Prisma del repositorio de lookup de clientes.
 * Cada consulta incluye businessId para aislamiento tenant-scoped.
 */
export class PrismaCustomerLookupRepository implements CustomerLookupRepository {
  constructor(private readonly tx: PrismaTx) {}

  async findByPhone(input: {
    businessId: string
    phoneVariants: string[]
    canonicalPhone: string
  }): Promise<CustomerLookupResult> {
    const { businessId, phoneVariants, canonicalPhone } = input

    if (!businessId || !canonicalPhone) return null
    const variants = [...new Set(phoneVariants.filter((variant) => variant.length > 0))]

    // La primera query conserva las dos rutas indexables existentes
    // (businessId+normalizedPhone y businessId+phone) y expresa la precedencia
    // explícitamente. El fallback por expresión se separa porque mezclarlo en el
    // mismo OR puede degradar el plan de los índices seguros.
    const byIndexedIdentity = await this.tx.$queryRaw<Array<{
      id: string
      name: string
    }>>(Prisma.sql`
      SELECT "id", "name"
      FROM "Customer"
      WHERE "businessId" = ${businessId}
        AND (
          "normalizedPhone" = ${canonicalPhone}
          ${variants.length > 0 ? Prisma.sql`OR "phone" IN (${Prisma.join(variants)})` : Prisma.empty}
        )
      ORDER BY
        CASE WHEN "normalizedPhone" = ${canonicalPhone} THEN 0 ELSE 1 END,
        "createdAt" ASC,
        "id" ASC
      LIMIT 1
    `)
    if (byIndexedIdentity[0]) {
      return {
        customerId: byIndexedIdentity[0].id,
        name: byIndexedIdentity[0].name,
        canonicalPhone
      }
    }

    // Fallback legacy por dígitos; read-only y tenant-scoped.
    const digitVariants = variants
      .map((v) => v.replace(/\D/g, ''))
      .filter((d) => d.length > 0)
    if (digitVariants.length > 0) {
      const byDigits = await this.tx.$queryRaw<Array<{
        id: string
        name: string
        normalizedPhone: string | null
      }>>(Prisma.sql`
        SELECT "id", "name"
        FROM "Customer"
        WHERE "businessId" = ${businessId}
          AND regexp_replace("phone", '[^0-9]', '', 'g') IN (${Prisma.join(digitVariants)})
        ORDER BY "createdAt" ASC, "id" ASC
        LIMIT 1
      `)
      if (byDigits[0]) {
        return {
          customerId: byDigits[0].id,
          name: byDigits[0].name,
          canonicalPhone
        }
      }
    }

    return null
  }
}
