import { openAiConfig } from '../config/openai.js'
import { getOpenAiClient } from '../integrations/openai-client.js'
import { isAiExecutionEnabled } from './ai-execution-context.js'
import {
  bookingExtractionSchema,
  normalizeExtraction,
  type BookingV2CatalogOption,
  type BookingV2Extraction
} from './booking-v2-extractor.js'
import { nextMissingField } from './booking-v2-state.js'
import { normalizeText } from './message-understanding-service.js'

export const CONVERSATION_INTENTS = [
  'book_appointment',
  'edit_booking',
  'confirm_booking',
  'cancel_appointment',
  'business_information',
  'availability_preference',
  'professional_preference',
  'request_quote',
  'submit_media',
  'request_human',
  'social_message',
  'stop_flow',
  'unknown'
] as const

export type ConversationIntent = (typeof CONVERSATION_INTENTS)[number]

export const BUSINESS_INFORMATION_TOPICS = [
  'opening_hours',
  'address',
  'website',
  'booking_channels',
  'phone',
  'email',
  'instagram',
  'facebook',
  'services',
  'professionals',
  'prices',
  'other'
] as const

export type BusinessInformationTopic = (typeof BUSINESS_INFORMATION_TOPICS)[number]

export type RoutedIntent = {
  type: ConversationIntent
  topic: BusinessInformationTopic | null
  confidence: number
  evidence: string
}

export const CATALOG_QUERY_INFORMATION = [
  'general',
  'price',
  'duration',
  'professionals'
] as const

export type CatalogQueryInformation = (typeof CATALOG_QUERY_INFORMATION)[number]

export type CatalogQuery = {
  serviceId: string
  requestedInformation: CatalogQueryInformation[]
  confidence: number
  evidence: string
}

export type ConversationRouting = {
  intents: RoutedIntent[]
  bookingMessage: string | null
  bookingExtraction?: BookingV2Extraction | null
  catalogQuery?: CatalogQuery | null
  source: 'ai' | 'deterministic'
}

export type ConversationRouterInput = {
  message: string
  currentStep: string
  lastBotMessage: string | null
  recentMessages: Array<{
    direction: 'INBOUND' | 'OUTBOUND'
    body: string
  }>
  draft: {
    name: string | null
    service: string | null
    professional: string | null
    date: string | null
    time: string | null
  }
  business: {
    name: string
    availableInformation: BusinessInformationTopic[]
  }
  catalog: {
    services: BookingV2CatalogOption[]
    professionals: BookingV2CatalogOption[]
  }
}

type AiConversationRouting = {
  intents: Array<{
    type: ConversationIntent
    topic: BusinessInformationTopic | null
    confidence: number
    evidence: string
  }>
  bookingMessage: string | null
  bookingExtraction?: BookingV2Extraction | null
  catalogQuery?: CatalogQuery | null
}

export class ConversationRouter {
  async route(input: ConversationRouterInput): Promise<ConversationRouting> {
    const deterministic = deterministicConversationRouting(input.message, {
      currentStep: input.currentStep,
      catalog: input.catalog
    })
    if (!isAiExecutionEnabled()) return deterministic

    const client = getOpenAiClient()
    if (!client) return deterministic

    try {
      const response = await client.responses.create({
        model: openAiConfig.model,
        instructions: [
          'Sos el router de una recepcionista virtual para comercios con agenda.',
          'Clasifica exclusivamente customerMessage, que es el turno actual del cliente.',
          'recentMessages y lastBotMessage sirven solo para desambiguar el turno actual.',
          'Nunca repitas una intencion de recentMessages si no aparece tambien en customerMessage.',
          'Podes devolver varias intenciones cuando el mensaje mezcla pedidos.',
          'Interpreta el mensaje como un pedido completo: conserva cada tarea solicitada y asociala al servicio mencionado.',
          'Ejemplo: "quiero iluminaciones, presupuesto y horarios" combina reserva, presupuesto y disponibilidad para Iluminacion; no descartes ninguna parte.',
          'Comprende singular, plural, errores ortograficos comunes y alias del catalogo antes de concluir que falta el servicio.',
          'Si un unico servicio del catalogo coincide con suficiente claridad, devolve su ID aunque el cliente use una variante plural o informal.',
          'Si dos servicios son realmente posibles, no adivines: deja service.value en null para que el flujo muestre una aclaracion acotada.',
          'No respondas al cliente, no ejecutes acciones y no inventes datos.',
          'Usa business_information para preguntas sobre horarios del local, direccion, web, formas de reservar, contacto, redes, servicios, profesionales o precios.',
          'Para consultas sobre un servicio puntual, completa catalogQuery con su ID y la informacion pedida aunque el cliente no use palabras literales como servicio o precio.',
          'Ejemplos de consulta puntual: "contame sobre tratamiento", "dame informacion de las iluminaciones", "cuanto vale el corte" o "quien hace color".',
          'Usa catalogQuery.general cuando pide informacion o detalles generales; price para precio; duration para duracion; professionals para quien lo realiza.',
          'Una consulta puntual no inicia ni modifica una reserva: bookingMessage debe ser null salvo que tambien exprese claramente que quiere reservar o cambiar.',
          'Si currentStep es START y preguntan genericamente por los horarios, interpretalo como opening_hours del negocio, no como disponibilidad para reservar.',
          'Si currentStep es ASK_TIME, una pregunta por horarios se refiere a disponibilidad de turnos, salvo que mencione explicitamente abrir, cerrar u horario del local.',
          'Usa availability_preference para dias o franjas como despues de las 18, por la manana o solo sabados.',
          'Usa professional_preference cuando nombra, pregunta o cambia profesional.',
          'Usa request_quote cuando pide precio estimado o presupuesto personalizado.',
          'Usa submit_media cuando afirma enviar una foto, imagen o comprobante.',
          'Usa request_human cuando pide una persona o la consulta requiere criterio humano.',
          'Usa stop_flow cuando dice que no necesita nada mas o quiere terminar la conversacion, incluso con respuestas informales como no gracias, nada mas, era eso, joya o estamos.',
          'bookingMessage debe contener solamente la parte util para continuar o modificar la reserva.',
          'Si el mensaje es solo informativo, social o ajeno a la reserva, bookingMessage debe ser null.',
          'Ademas de clasificar, extrae en bookingExtraction todos los datos de reserva visibles en customerMessage.',
          'Evalua name, service, professional, date y time por separado con value, confidence y evidence.',
          'expectedField indica el dato que el flujo espera, pero no impide extraer datos adelantados.',
          'Para service y professional usa exclusivamente IDs presentes en catalog.',
          'Usa nombres, alias y descripciones del catalogo para comprender expresiones naturales del cliente.',
          'Si no hay evidencia de un campo, usa value null, confidence 0 y evidence vacio.',
          'No copies valores de currentDraft si no aparecen en customerMessage.',
          'Interpreta fechas relativas usando currentDate y timezone. date usa YYYY-MM-DD y time HH:mm.',
          'Detecta correction solo cuando el cliente expresa que quiere cambiar un dato existente.',
          'Si bookingMessage es null, bookingExtraction debe ser null.',
          'evidence debe ser un fragmento textual exacto de customerMessage.',
          'Si no esta claro, usa unknown con confianza baja.'
        ].join('\n'),
        input: JSON.stringify({
          customerMessage: input.message,
          currentStep: input.currentStep,
          lastBotMessage: input.lastBotMessage,
          recentMessages: input.recentMessages,
          currentDraft: input.draft,
          expectedField: nextMissingField(input.draft),
          currentDate: formatDate(new Date()),
          timezone: 'America/Buenos_Aires',
          business: input.business,
          catalog: input.catalog
        }),
        text: {
          format: {
            type: 'json_schema',
            name: 'conversation_routing_v2',
            strict: true,
            schema: conversationRoutingSchema
          }
        },
        store: false
      })

      const aiRouting = normalizeConversationRouting(JSON.parse(response.output_text) as AiConversationRouting)
      if (aiRouting.intents.length === 0) return deterministic
      const routing = mergeConversationRouting(aiRouting, deterministic, input.message, input.catalog)

      console.info('[conversation-router] routed message', {
        currentStep: input.currentStep,
        source: 'ai',
        intents: routing.intents.map((intent) => ({
          type: intent.type,
          topic: intent.topic,
          confidence: intent.confidence
        }))
      })

      return { ...routing, source: 'ai' }
    } catch (error) {
      console.warn('[conversation-router] AI routing failed; using deterministic fallback', error)
      return deterministic
    }
  }
}

export function normalizeConversationRouting(input: AiConversationRouting): Omit<ConversationRouting, 'source'> {
  const intents = Array.isArray(input.intents)
    ? input.intents
        .filter((intent) => CONVERSATION_INTENTS.includes(intent.type))
        .map((intent): RoutedIntent => ({
          type: intent.type,
          topic: intent.type === 'business_information' && intent.topic && BUSINESS_INFORMATION_TOPICS.includes(intent.topic)
            ? intent.topic
            : null,
          confidence: normalizeConfidence(intent.confidence),
          evidence: typeof intent.evidence === 'string' ? intent.evidence.trim() : ''
        }))
        .filter((intent) => intent.evidence.length > 0)
    : []

  return {
    intents,
    bookingMessage: cleanNullableText(input.bookingMessage),
    bookingExtraction: input.bookingExtraction
      ? normalizeExtraction(input.bookingExtraction)
      : null,
    catalogQuery: normalizeCatalogQuery(input.catalogQuery)
  }
}

export function deterministicConversationRouting(
  message: string,
  context?: {
    currentStep?: string
    catalog?: ConversationRouterInput['catalog']
  }
): ConversationRouting {
  const normalized = normalizeText(message)
  const topics = detectBusinessInformationTopics(normalized, context?.currentStep)
  const hasBookingSignal = hasExplicitBookingIntent(normalized)
  const intents: RoutedIntent[] = topics.map((topic) => ({
    type: 'business_information',
    topic,
    confidence: 0.95,
    evidence: message.trim()
  }))

  const catalogQuery = context?.catalog
    ? deterministicCatalogQuery(message, context.catalog)
    : null
  if (catalogQuery) {
    intents.push({
      type: 'business_information',
      topic: catalogQuery.requestedInformation.includes('price') ? 'prices' : 'services',
      confidence: catalogQuery.confidence,
      evidence: catalogQuery.evidence
    })
  }

  if (intents.length === 0) {
    intents.push({
      type: 'unknown',
      topic: null,
      confidence: 0,
      evidence: message.trim() || 'mensaje vacio'
    })
  }

  return {
    intents,
    bookingMessage: hasBookingSignal ? message.trim() || null : null,
    bookingExtraction: null,
    catalogQuery,
    source: 'deterministic'
  }
}

export function businessInformationTopicsFromRouting(routing: ConversationRouting) {
  return Array.from(new Set(
    routing.intents
      .filter((intent) => intent.type === 'business_information' && intent.confidence >= 0.65)
      .map((intent) => intent.topic)
      .filter((topic): topic is BusinessInformationTopic => topic !== null)
  ))
}

export function mergeConversationRouting(
  aiRouting: Omit<ConversationRouting, 'source'>,
  deterministic: ConversationRouting,
  originalMessage: string,
  catalog?: ConversationRouterInput['catalog']
): Omit<ConversationRouting, 'source'> {
  const catalogQuery = groundedCatalogQuery(
    aiRouting.catalogQuery ?? null,
    originalMessage,
    catalog
  ) ?? groundedCatalogQuery(
    deterministic.catalogQuery ?? null,
    originalMessage,
    catalog
  )
  const deterministicTopics = new Set(businessInformationTopicsFromRouting(deterministic))
  const standaloneBusinessInformationQuestion =
    (deterministicTopics.size > 0 || catalogQuery !== null) &&
    deterministic.bookingMessage === null
  const intents = aiRouting.intents.filter((intent) => {
    if (
      standaloneBusinessInformationQuestion &&
      [
        'book_appointment',
        'availability_preference',
        'professional_preference'
      ].includes(intent.type)
    ) {
      return false
    }
    return intent.type !== 'business_information' ||
      (
        intent.topic !== null &&
        (
          deterministicTopics.has(intent.topic) ||
          isGroundedBusinessInformationIntent(intent, originalMessage) ||
          catalogQuerySupportsTopic(catalogQuery, intent.topic)
        )
      )
  })

  for (const fallbackIntent of deterministic.intents) {
    if (fallbackIntent.type === 'unknown') continue
    const alreadyPresent = intents.some((intent) =>
      intent.type === fallbackIntent.type && intent.topic === fallbackIntent.topic
    )
    if (!alreadyPresent) intents.push(fallbackIntent)
  }

  const hasBookingRelatedIntent = intents.some((intent) => [
    'book_appointment',
    'edit_booking',
    'availability_preference',
    'professional_preference'
  ].includes(intent.type))

  return {
    intents,
    bookingMessage: standaloneBusinessInformationQuestion
      ? null
      : aiRouting.bookingMessage
        ?? deterministic.bookingMessage
        ?? (hasBookingRelatedIntent ? originalMessage.trim() || null : null),
    bookingExtraction: standaloneBusinessInformationQuestion
      ? null
      : aiRouting.bookingExtraction ?? deterministic.bookingExtraction ?? null,
    catalogQuery
  }
}

function normalizeCatalogQuery(value: CatalogQuery | null | undefined): CatalogQuery | null {
  if (!value || typeof value !== 'object') return null
  if (typeof value.serviceId !== 'string' || !value.serviceId.trim()) return null
  if (!Array.isArray(value.requestedInformation)) return null
  const requestedInformation = Array.from(new Set(
    value.requestedInformation.filter((item): item is CatalogQueryInformation =>
      CATALOG_QUERY_INFORMATION.includes(item as CatalogQueryInformation)
    )
  ))
  if (!requestedInformation.length) return null
  if (typeof value.evidence !== 'string' || !value.evidence.trim()) return null
  return {
    serviceId: value.serviceId.trim(),
    requestedInformation,
    confidence: normalizeConfidence(value.confidence),
    evidence: value.evidence.trim()
  }
}

function deterministicCatalogQuery(
  message: string,
  catalog: ConversationRouterInput['catalog']
): CatalogQuery | null {
  const normalized = normalizeEvidenceText(message)
  const requestedInformation: CatalogQueryInformation[] = []
  if (containsAny(normalized, ['precio', 'precios', 'cuanto cuesta', 'cuanto sale', 'cuanto vale', 'valor'])) {
    requestedInformation.push('price')
  }
  if (containsAny(normalized, ['cuanto dura', 'duracion', 'demora'])) {
    requestedInformation.push('duration')
  }
  if (containsAny(normalized, ['quien lo hace', 'quien hace', 'profesional', 'profesionales', 'quien atiende'])) {
    requestedInformation.push('professionals')
  }
  if (containsAny(normalized, ['informacion', 'info', 'contame', 'explicame', 'detalle', 'detalles', 'de que se trata'])) {
    requestedInformation.push('general')
  }
  if (!requestedInformation.length) return null

  const matches = catalog.services.filter((service) =>
    [service.name, ...(service.aliases ?? [])].some((label) =>
      catalogLabelIsMentioned(normalized, normalizeEvidenceText(label))
    )
  )
  if (matches.length !== 1) return null

  return {
    serviceId: matches[0]?.id ?? '',
    requestedInformation: Array.from(new Set(requestedInformation)),
    confidence: 0.95,
    evidence: message.trim()
  }
}

function groundedCatalogQuery(
  query: CatalogQuery | null,
  message: string,
  catalog?: ConversationRouterInput['catalog']
) {
  if (!query || query.confidence < 0.65) return null
  const normalizedMessage = normalizeEvidenceText(message)
  const normalizedEvidence = normalizeEvidenceText(query.evidence)
  if (!normalizedEvidence || !normalizedMessage.includes(normalizedEvidence)) return null
  if (!catalog) return query
  const service = catalog.services.find((option) => option.id === query.serviceId)
  if (!service) return null
  const serviceIsMentioned = [service.name, ...(service.aliases ?? [])].some((label) =>
    catalogLabelIsMentioned(normalizedMessage, normalizeEvidenceText(label))
  )
  return serviceIsMentioned ? query : null
}

function catalogQuerySupportsTopic(
  query: CatalogQuery | null,
  topic: BusinessInformationTopic
) {
  if (!query) return false
  if (topic === 'prices') return query.requestedInformation.includes('price')
  if (topic === 'professionals') return query.requestedInformation.includes('professionals')
  return topic === 'services'
}

function catalogLabelIsMentioned(message: string, label: string) {
  if (!label) return false
  const messageTokens = message.split(' ').filter(Boolean)
  const labelTokens = label.split(' ').filter((token) =>
    token && !['de', 'del', 'el', 'la', 'las', 'los', 'y'].includes(token)
  )
  return labelTokens.length > 0 && labelTokens.every((labelToken) =>
    messageTokens.some((messageToken) =>
      labelToken === messageToken || singularCatalogToken(labelToken) === singularCatalogToken(messageToken)
    )
  )
}

function singularCatalogToken(token: string) {
  if (token.length >= 7 && token.endsWith('ciones')) return `${token.slice(0, -6)}cion`
  if (token.length >= 6 && token.endsWith('es')) return token.slice(0, -2)
  if (token.length >= 5 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

function detectBusinessInformationTopics(
  normalized: string,
  currentStep?: string
): BusinessInformationTopic[] {
  const topics: BusinessInformationTopic[] = []
  const add = (topic: BusinessInformationTopic) => {
    if (!topics.includes(topic)) topics.push(topic)
  }

  if (containsAny(normalized, [
    'a que hora abren', 'a que hora cierran', 'que horario hacen', 'horario del local',
    'horarios del local', 'cuando abren', 'cuando cierran', 'estan abiertos', 'abren hoy',
    'abren manana', 'abren el'
  ])) add('opening_hours')
  if (
    currentStep === 'START' &&
    containsAny(normalized, [
      'los horarios',
      'sus horarios',
      'que horarios tienen',
      'cuales son los horarios',
      'queria saber el horario',
      'queria saber los horarios'
    ])
  ) add('opening_hours')

  if (containsAny(normalized, [
    'donde queda', 'donde estan', 'direccion', 'ubicacion', 'como llego', 'maps', 'mapa'
  ])) add('address')
  if (
    normalized.includes('donde') &&
    containsAny(normalized, ['local', 'esta', 'estan', 'queda', 'ubica', 'encuentra'])
  ) add('address')

  if (containsAny(normalized, [
    'pagina web', 'pagina de internet', 'sitio web', 'web del local', 'cual es la web'
  ])) add('website')

  if (containsAny(normalized, [
    'por donde reservo', 'donde reservo', 'como puedo reservar', 'como reservo',
    'link para reservar', 'enlace para reservar', 'pagina para reservar'
  ])) add('booking_channels')

  if (containsAny(normalized, ['telefono', 'numero del local', 'whatsapp del local'])) add('phone')
  if (containsAny(normalized, ['correo', 'email', 'mail del local'])) add('email')
  if (containsAny(normalized, ['instagram', 'ig del local', 'insta del local'])) add('instagram')
  if (containsAny(normalized, ['facebook'])) add('facebook')
  if (containsAny(normalized, [
    'que servicios tienen', 'que servicios hacen', 'que servicios hay', 'cuales servicios hay',
    'servicios disponibles', 'mostrame los servicios', 'mostrar servicios', 'ver servicios',
    'que hacen en el local', 'lista de servicios'
  ])) add('services')
  if (containsAny(normalized, [
    'que profesionales hay', 'cuales profesionales hay', 'quienes atienden', 'quien atiende',
    'con quien me puedo atender', 'lista de profesionales', 'profesionales disponibles'
  ])) add('professionals')
  if (containsAny(normalized, [
    'cuanto sale', 'cuanto cuesta', 'que precio', 'lista de precios', 'precios de los servicios',
    'quiero saber los precios', 'saber los precios', 'ver los precios', 'ver precios',
    'que precios tienen', 'cuales son los precios', 'mostrar precios', 'mostrame los precios',
    'los precios', 'catalogo', 'tarifas'
  ])) add('prices')

  return topics
}

function containsAny(value: string, phrases: string[]) {
  return phrases.some((phrase) => value.includes(phrase))
}

function hasExplicitBookingIntent(normalized: string) {
  return containsAny(normalized, [
    'quiero reservar',
    'queria reservar',
    'quisiera reservar',
    'necesito reservar',
    'quiero un turno',
    'queria un turno',
    'quisiera un turno',
    'necesito un turno',
    'sacar turno',
    'sacame un turno',
    'agendar turno',
    'agendame',
    'reservame',
    'quiero venir',
    'necesito venir',
    'quiero hacerme',
    'queria hacerme',
    'quisiera hacerme',
    'me quiero hacer',
    'me quiero cortar',
    'necesito un corte',
    'quiero un corte',
    'quiero corte',
    'quiero con',
    'prefiero con'
  ])
}

function isGroundedBusinessInformationIntent(
  intent: RoutedIntent,
  originalMessage: string
) {
  if (intent.type !== 'business_information' || !intent.topic) return false
  const message = normalizeEvidenceText(originalMessage)
  const evidence = normalizeEvidenceText(intent.evidence)
  if (!evidence || !message.includes(evidence)) return false

  const topicSignals: Record<BusinessInformationTopic, string[]> = {
    opening_hours: ['horario', 'horarios', 'abren', 'abrir', 'cierran', 'cerrar', 'abierto'],
    address: ['direccion', 'ubicacion', 'donde', 'llegar', 'llego', 'local', 'mapa', 'maps'],
    website: ['web', 'pagina', 'sitio', 'internet'],
    booking_channels: ['reservar', 'reservo', 'turno', 'link', 'enlace'],
    phone: ['telefono', 'numero', 'whatsapp'],
    email: ['email', 'mail', 'correo'],
    instagram: ['instagram', 'insta', 'ig'],
    facebook: ['facebook'],
    services: ['servicio', 'servicios', 'hacen', 'ofrecen'],
    professionals: ['profesional', 'profesionales', 'atiende', 'atienden'],
    prices: ['precio', 'precios', 'sale', 'cuesta', 'valor'],
    other: []
  }

  return containsAny(message, topicSignals[intent.topic])
}

function normalizeEvidenceText(value: string) {
  return normalizeText(value)
    .replace(/[^\p{Letter}\p{Number}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeConfidence(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function cleanNullableText(value: string | null) {
  const cleaned = value?.trim()
  return cleaned ? cleaned : null
}

const conversationRoutingSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['intents', 'bookingMessage', 'bookingExtraction', 'catalogQuery'],
  properties: {
    intents: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'topic', 'confidence', 'evidence'],
        properties: {
          type: {
            type: 'string',
            enum: CONVERSATION_INTENTS
          },
          topic: {
            anyOf: [
              { type: 'string', enum: BUSINESS_INFORMATION_TOPICS },
              { type: 'null' }
            ]
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidence: { type: 'string' }
        }
      }
    },
    bookingMessage: {
      anyOf: [
        { type: 'string' },
        { type: 'null' }
      ]
    },
    bookingExtraction: {
      anyOf: [
        bookingExtractionSchema,
        { type: 'null' }
      ]
    },
    catalogQuery: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['serviceId', 'requestedInformation', 'confidence', 'evidence'],
          properties: {
            serviceId: { type: 'string' },
            requestedInformation: {
              type: 'array',
              minItems: 1,
              uniqueItems: true,
              items: { type: 'string', enum: CATALOG_QUERY_INFORMATION }
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            evidence: { type: 'string' }
          }
        },
        { type: 'null' }
      ]
    }
  }
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}
