export type ServiceCatalogPresentationIntent =
  | 'show_all'
  | 'show_categories'
  | 'use_business_default'

export function detectServiceCatalogPresentationIntent(
  message: string
): ServiceCatalogPresentationIntent | null {
  const normalized = normalizeCatalogIntentMessage(message)
  if (!normalized) return null

  if (isExplicitCategoryNavigation(normalized)) return 'show_categories'
  const bookingRequest = isBookingRequest(normalized)
  if (
    isExplicitFullCatalogRequest(normalized) &&
    (!bookingRequest || hasExplicitCatalogInformationRequest(normalized))
  ) {
    return 'show_all'
  }
  if (bookingRequest) return 'use_business_default'
  return null
}

function hasExplicitCatalogInformationRequest(message: string) {
  return /\b(?:que servicios|cuales servicios|ver|mostrar|mostrame|muestrame|saber|conocer|consultar|lista|menu|catalogo|que ofrecen)\b/.test(message)
}

function isExplicitCategoryNavigation(message: string) {
  return /\b(?:volver a|ver|mostrar|mostrame|muestrame)\s+(?:las\s+)?categorias\b/.test(message) ||
    /\b(?:por categorias|tipos de servicio)\b/.test(message) ||
    message === 'categorias'
}

function isExplicitFullCatalogRequest(message: string) {
  if ([
    'ver todos',
    'ver todo',
    'mostrar todos',
    'mostrar todo',
    'mostrame todo',
    'muestrame todo'
  ].includes(message)) {
    return true
  }
  if (/\b(?:todos los servicios|todos sus servicios|todo el catalogo|catalogo completo|todas las opciones)\b/.test(message)) {
    return true
  }
  if (/\b(?:lista|menu|catalogo)(?: completo)?(?: de| con)? (?:los )?servicios\b/.test(message)) {
    return true
  }
  if (/\bservicios disponibles\b/.test(message)) return true
  if (/\bque servicios (?:tienen|hacen|hay|ofrecen)\b/.test(message)) return true
  if (/\b(?:que|cuales) (?:son )?(?:todos )?(?:los )?servicios\b/.test(message)) return true
  if (/\bque (?:ofrecen|opciones tienen|hacen en el local|puedo reservar|me puedo hacer)\b/.test(message)) return true
  if (/\b(?:ver|mostrar|mostrame|muestrame)\b.*\b(?:los servicios|sus servicios|catalogo)\b/.test(message)) {
    return true
  }
  return false
}

function isBookingRequest(message: string) {
  if (/\b(?:reservame|agendame)\b/.test(message)) return true
  return /\b(?:quiero|queria|quisiera|necesito|dame|sacame|reservame|agendame)\b.*\b(?:turno|cita|reservar|agendar)\b/.test(message)
}

export function isNaturalServiceBookingRequest(message: string) {
  const normalized = normalizeCatalogIntentMessage(message)
  return /\b(?:quiero|queria|quisiera|necesito|me gustaria)\s+(?:hacerme|cortarme|tenirme|tinturarme|colorearme|depilarme|peinarme|atenderme)\b/.test(normalized)
}

function normalizeCatalogIntentMessage(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
