/**
 * F6.1 — Contrato puro de lookup de cliente por teléfono y negocio.
 *
 * El bot busca el cliente ANTES de preguntar nombre (reglas-funcionales.md §3).
 * Si existe un nombre válido previo, se reutiliza y NAME_INPUT se omite.
 * Si falta o el teléfono es desconocido, el flujo NAME_INPUT queda autoritativo.
 *
 * Este módulo define tipos puros y la interfaz del repositorio.
 * La implementación Prisma vive en infrastructure/.
 *
 * REGLAS CRÍTICAS:
 * - Lookup es READ-ONLY y TENANT-SCOPED.
 * - NO crea ni persiste candidatos/clientes antes de confirmación explícita.
 * - NO usa advisory lock (lectura no necesita exclusión).
 * - NO usa find-or-create: si no existe, devuelve null.
 */

/**
 * Resultado de lookup de cliente por teléfono dentro de un negocio.
 */
export type CustomerLookupResult = {
  /** ID estable del cliente (solo para referencia interna, no se expone al motor). */
  customerId: string
  /** Nombre del cliente tal como está almacenado (ya validado al persistir). */
  name: string
  /**
   * Identidad canónica buscada, derivada del teléfono de Conversation.
   * No se toma de `Customer.name` ni depende de que una fila legacy tenga
   * `normalizedPhone`: siempre representa el teléfono de entrada normalizado.
   */
  canonicalPhone: string
} | null

/**
 * Interfaz del repositorio de lookup de clientes para el motor.
 * La implementación debe ser tenant-scoped: toda query incluye businessId.
 */
export interface CustomerLookupRepository {
  /**
   * Busca un cliente por teléfono dentro de un negocio específico.
   *
   * @param input.businessId - ID del negocio (tenant).
   * @param input.phoneVariants - Variantes normalizadas del teléfono para búsqueda flexible.
   * @returns El cliente encontrado con nombre, o null si no existe.
   *
    * La búsqueda debe intentar, en orden:
    * 1. normalizedPhone === teléfono canónico
    * 2. phone IN variantes literales
    * 3. regexp_replace(phone, '[^0-9]', '', 'g') IN variantes numéricas
   *
    * Siempre devuelve el primer match ordenado por precedencia, createdAt ASC e
    * id ASC. `canonicalPhone` del resultado es el canónico de entrada.
   * NO crea filas; NO toma locks.
   */
  findByPhone(input: {
    businessId: string
    phoneVariants: string[]
    canonicalPhone: string
  }): Promise<CustomerLookupResult>
}
