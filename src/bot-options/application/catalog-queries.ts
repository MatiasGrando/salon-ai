export const CATALOG_CONTEXTUAL_PAGE_SIZE = 7

export type CatalogPage<T> = {
  items: T[]
  page: number
  hasPrevious: boolean
  hasNext: boolean
}

export type CatalogCategoryItem = {
  id: string
  name: string
}

export type CatalogServiceItem = {
  id: string
  categoryId: string
  parentServiceId: string | null
  kind: 'SERVICE' | 'SUBCATEGORY'
  name: string
  description: string | null
  durationMinutes: number | null
  durationMinMinutes: number | null
  durationMaxMinutes: number | null
  price: number | null
  priceMode: 'FIXED' | 'STARTING_AT'
  isBookable: boolean
  requiresConsultation: boolean
}

export function normalizeCatalogPage(page: number): number {
  if (!Number.isInteger(page) || page < 0) throw new Error('catalog page must be a non-negative integer')
  return page
}

export function catalogPageOffset(page: number): number {
  return normalizeCatalogPage(page) * CATALOG_CONTEXTUAL_PAGE_SIZE
}

export function toCatalogPage<T>(rows: readonly T[], page: number): CatalogPage<T> {
  const normalizedPage = normalizeCatalogPage(page)
  return {
    items: rows.slice(0, CATALOG_CONTEXTUAL_PAGE_SIZE),
    page: normalizedPage,
    hasPrevious: normalizedPage > 0,
    hasNext: rows.length > CATALOG_CONTEXTUAL_PAGE_SIZE
  }
}

// ─── F5.4 — Formato de precio, duración y vista de catálogo ──────────────────

/** Cuenta code points Unicode (no UTF-16 units). Emojis cuentan 1. */
function codePointLength(text: string): number {
  return Array.from(text).length
}

/**
 * Formatea el precio de un servicio según su modo.
 * - FIXED: "$25.000"
 * - STARTING_AT: "Desde $25.000"
 * - Sin precio público: null (se omite, no se muestra "Consultar" acá)
 *
 * Reglas-funcionales.md §3.1: el bot no inventa importes a partir de la categoría.
 */
export function formatCatalogPrice(price: number | null, priceMode: 'FIXED' | 'STARTING_AT'): string | null {
  if (price == null) return null
  const formatted = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(price)
  return priceMode === 'STARTING_AT' ? `Desde ${formatted}` : formatted
}

/**
 * Formatea la duración de un servicio.
 * - Rango: "40–50 min" (cuando min < max)
 * - Fijo: "45 min"
 * - Sin duración: null (se omite)
 */
export function formatCatalogDuration(
  durationMinutes: number | null,
  durationMinMinutes: number | null,
  durationMaxMinutes: number | null
): string | null {
  if (durationMinMinutes != null && durationMaxMinutes != null && durationMaxMinutes > durationMinMinutes) {
    return `${durationMinMinutes}\u2013${durationMaxMinutes} min`
  }
  if (durationMinutes != null && durationMinutes > 0) {
    return `${durationMinutes} min`
  }
  return null
}

/**
 * Label completo para una fila de lista de servicios.
 * Formato: "Nombre — Precio · Duración" usando el separador ` — ` que
 * el renderer de WhatsApp interpreta como división título/descripción.
 *
 * Si no hay precio ni duración, devuelve sólo el nombre.
 * Los campos ausentes se omiten sin texto de relleno.
 */
export function catalogServiceRowLabel(item: CatalogServiceItem): string {
  const descriptionParts: string[] = []
  const price = formatCatalogPrice(item.price, item.priceMode)
  if (price) descriptionParts.push(price)
  const duration = formatCatalogDuration(item.durationMinutes, item.durationMinMinutes, item.durationMaxMinutes)
  if (duration) descriptionParts.push(duration)
  if (descriptionParts.length > 0) {
    return `${item.name} \u2014 ${descriptionParts.join(' \u00b7 ')}`
  }
  return item.name
}

export type CatalogServiceDetailView = {
  /** Textos informativos que viajan como mensajes separados ANTES del interactivo. */
  informativeTexts: string[]
  /**
   * Cuerpo del mensaje interactivo final.
   *
   * Precondición: el nombre del servicio (sin contar precio/duración) debe ser
   * ≤ maxInteractiveBodyCodePoints. Si el nombre solo excede el límite, esta
   * función NO lo trunca — el renderer (splitUnicodeSafe) es quien divide
   * el texto final en chunks que respetan el límite de WhatsApp. Esta función
   * garantiza ≤ maxInteractiveBodyCodePoints SOLO para el resumen (nombre +
   * precio + duración), asumiendo nombre razonable.
   */
  interactiveBody: string
}

/**
 * Construye la vista de detalle de un servicio.
 *
 * Reglas cubiertas (reglas-funcionales.md §3.1):
 * - Muestra nombre, descripción, precio y duración usando datos reales.
 * - Campo ausente se omite sin valor de relleno.
 * - "Desde" para precio STARTING_AT; "Consultar con el equipo" cuando price es null.
 * - Duración "estimada" sólo cuando min/max indican rango (no compromiso exacto).
 * - Si el detalle completo no entra en el cuerpo interactivo, la descripción
 *   se envía como texto informativo previo y el cuerpo interactivo lleva un
 *   resumen breve (nombre + precio + duración).
 * - Los fragmentos informativos comparten dependency group con el interactivo.
 *
 * @param maxInteractiveBodyCodePoints Límite del cuerpo interactivo (1024 por WhatsApp).
 */
export function catalogServiceDetailView(
  item: CatalogServiceItem,
  maxInteractiveBodyCodePoints: number
): CatalogServiceDetailView {
  if (!Number.isInteger(maxInteractiveBodyCodePoints) || maxInteractiveBodyCodePoints <= 0) {
    throw new Error('maxInteractiveBodyCodePoints must be a positive integer')
  }
  const lines: string[] = [item.name]

  if (item.description) {
    lines.push(item.description)
  }

  const price = formatCatalogPrice(item.price, item.priceMode)
  if (price) {
    lines.push(price)
  } else if (item.price == null) {
    lines.push('Consultar con el equipo')
  }

  const duration = formatCatalogDuration(item.durationMinutes, item.durationMinMinutes, item.durationMaxMinutes)
  if (duration) {
    const estimated = item.durationMinMinutes != null && item.durationMaxMinutes != null && item.durationMaxMinutes > item.durationMinMinutes
    lines.push(`${estimated ? 'Duraci\u00f3n estimada' : 'Duraci\u00f3n'}: ${duration}`)
  }

  const fullText = lines.join('\n\n')

  if (codePointLength(fullText) <= maxInteractiveBodyCodePoints) {
    return { informativeTexts: [], interactiveBody: fullText }
  }

  // Detalle excede límite: descripción como informativo, resumen como interactivo.
  const summaryParts: string[] = [item.name]
  if (price) summaryParts.push(price)
  if (duration) {
    const estimated = item.durationMinMinutes != null && item.durationMaxMinutes != null && item.durationMaxMinutes > item.durationMinMinutes
    summaryParts.push(`${estimated ? 'Duraci\u00f3n estimada' : 'Duraci\u00f3n'}: ${duration}`)
  }
  if (!price) summaryParts.push('Consultar con el equipo')

  return {
    informativeTexts: item.description ? [item.description] : [],
    interactiveBody: summaryParts.join('\n\n')
  }
}
