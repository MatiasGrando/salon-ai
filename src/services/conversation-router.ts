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
import type { BookingFlowOrder } from './booking-v2-state.js'
import { normalizeText } from './message-understanding-service.js'

export const CONVERSATION_INTENTS = [
  'book_appointment',
  'edit_booking',
  'confirm_booking',
  'cancel_booking',
  'go_back',
  'restart_booking',
  'cancel_appointment',
  'business_information',
  'deposit_information',
  'availability_preference',
  'professional_preference',
  'professional_schedule',
  'service_detail',
  'unsupported_service',
  'request_quote',
  'submit_media',
  'request_human',
  'other_query',
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
  'deposit',
  'duration',
  'professionals'
] as const

export type CatalogQueryInformation = (typeof CATALOG_QUERY_INFORMATION)[number]

export type CatalogQuery = {
  serviceId: string | null
  candidateServiceIds?: string[]
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
    bookingFlowOrder?: BookingFlowOrder
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

type NaturalBookingRecovery = {
  decision: 'booking' | 'information_only' | 'unclear'
  serviceId: string | null
  confidence: number
  evidence: string
}

export class ConversationRouter {
  async route(input: ConversationRouterInput): Promise<ConversationRouting> {
    const deterministic = deterministicConversationRouting(input.message, {
      currentStep: input.currentStep,
      catalog: input.catalog
    })
    if (!isAiExecutionEnabled()) {
      return {
        ...applyExpectedFieldCatalogFallback(deterministic, input),
        source: 'deterministic'
      }
    }

    const client = getOpenAiClient()
    if (!client) {
      return {
        ...applyExpectedFieldCatalogFallback(deterministic, input),
        source: 'deterministic'
      }
    }

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
          'Ejemplo: "quiero saber la direccion y hacerme raices" combina business_information address y book_appointment para Raices, aunque no diga turno, reservar ni agendar.',
          'Ejemplo: "decime el horario del local y un corte" combina business_information opening_hours y book_appointment; si Corte es ambiguo conserva la reserva y deja service.value null para aclararlo.',
          'Expresiones como "hacerme", "quiero", "necesito", "me gustaria" o la mencion natural de un servicio pueden expresar una reserva segun el contexto; comprende su significado, no exijas palabras predeterminadas.',
          'Cada intencion debe conservar como evidence el fragmento exacto que expresa solamente esa tarea siempre que sea posible.',
          'Comprende singular, plural, errores ortograficos comunes y alias del catalogo antes de concluir que falta el servicio.',
          'Si un unico servicio del catalogo coincide con suficiente claridad, devolve su ID aunque el cliente use una variante plural o informal.',
          'Si dos servicios son realmente posibles, no adivines: deja service.value en null para que el flujo muestre una aclaracion acotada.',
          'No respondas al cliente, no ejecutes acciones y no inventes datos.',
          'Usa business_information para preguntas sobre horarios del local, direccion, web, formas de reservar, contacto, redes, servicios, profesionales o precios.',
          'Modismos como "cuando levantan la persiana", "cuando abren las puertas" o "desde que hora atienden" preguntan opening_hours; nunca significan volver de paso.',
          'Una consulta por costo, valor, inversion o cuanto sale es business_information con topic prices, aunque no use la palabra precio.',
          'Usa deposit_information cuando pregunta cuánto debe adelantar, abonar antes, pagar para confirmar o dejar para asegurar un lugar. Es una consulta sobre la seña, no inicia ni modifica una reserva; usa evidencia textual exacta.',
          'Usa request_quote solo cuando pide un presupuesto personalizado o exacto; no lo uses para una consulta general de precio.',
          'Para consultas sobre un servicio puntual, completa catalogQuery con su ID y la informacion pedida aunque el cliente no use palabras literales como servicio o precio.',
          'En catalogQuery usa serviceId para una coincidencia unica y candidateServiceIds con todos los candidatos cuando la referencia es ambigua; no elijas uno arbitrariamente.',
          'Ejemplos de consulta puntual: "contame sobre tratamiento", "dame informacion de las iluminaciones", "cuanto vale el corte" o "quien hace color".',
          'Usa catalogQuery.general cuando pide informacion o detalles generales; price para precio; deposit para consultar el monto de la seña o anticipo; duration para duracion; professionals para quien lo realiza.',
          'Una consulta puntual no inicia ni modifica una reserva: bookingMessage debe ser null salvo que tambien exprese claramente que quiere reservar o cambiar.',
          'Si currentStep es START y preguntan genericamente por los horarios, interpretalo como opening_hours del negocio, no como disponibilidad para reservar.',
          'Si currentStep es ASK_TIME, una pregunta por horarios se refiere a disponibilidad de turnos, salvo que mencione explicitamente abrir, cerrar u horario del local.',
          'Usa availability_preference para dias o franjas como despues de las 18, por la manana o solo sabados.',
          'Usa professional_preference cuando selecciona, nombra como preferencia o cambia profesional para su reserva.',
          'Usa professional_schedule cuando pregunta qué días u horarios trabaja o atiende un profesional específico. Es una consulta informativa: no lo tomes como elección y bookingMessage debe ser null.',
          'Ejemplos de professional_schedule: "qué horarios tiene Tamara", "cuándo atiende Tami" o "qué días trabaja Marcos". Extrae el ID del profesional mencionado en bookingExtraction.professional.',
          'Nunca uses professional_schedule si no pregunta por horarios, días o disponibilidad laboral de un profesional.',
          'Usa service_detail solamente cuando pregunta qué incluye, cómo se realiza, cuál es el proceso, si lavan o preparan el cabello, o qué pasos tiene el servicio que ya está conversando.',
          'Nunca uses service_detail por la sola mencion de un servicio dentro de un deseo de hacerlo, elegirlo o reservarlo.',
          'service_detail usa currentDraft.service como contexto y bookingMessage null; no necesita que el cliente repita el nombre del servicio.',
          'Usa unsupported_service cuando el cliente pide, selecciona o consulta por un servicio concreto que no coincide con ningún nombre, alias ni descripción del catalogo.',
          'Ejemplos: responde "lavado de pelo" al elegir servicio, pregunta "hacen depilacion?" o dice "quiero reservar reflexologia" y esos servicios no existen en catalog.services.',
          'No uses unsupported_service para saludos, frases sin sentido, consultas genericas sobre todos los servicios ni cuando exista una coincidencia razonable en el catalogo.',
          'Para unsupported_service usa bookingMessage null, bookingExtraction.service.value null, catalogQuery null y copia como evidence el fragmento exacto del servicio pedido.',
          'Si pregunta quienes realizan, conocen o "tienen mano" para un servicio, usa business_information con topic professionals y catalogQuery.professionals; no lo tomes como una eleccion.',
          'Usa cancel_booking cuando quiere abandonar o cancelar la reserva que esta armando, sin cancelar un turno ya confirmado.',
          'Si currentDraft contiene un servicio, profesional, fecha u hora y el cliente quiere dejar, abandonar o frenar lo que esta haciendo, cancel_booking tiene prioridad sobre stop_flow.',
          'Usa cancel_appointment solamente cuando quiere cancelar un turno ya confirmado o existente.',
          'Usa go_back cuando quiere regresar al paso anterior de la reserva actual, cambiar la eleccion anterior o volver atras.',
          'Usa go_back solo si pide semanticamente retroceder, regresar o recuperar una eleccion previa dentro de la reserva. No lo infieras de una pregunta informativa.',
          'Usa restart_booking cuando quiere comenzar otra vez, iniciar una nueva reserva o confirma que quiere reservar nuevamente despues de cancelar.',
          'Usa el estado actual y lastBotMessage para entender respuestas breves como si, mejor volvamos o empecemos otra vez.',
          'Usa request_quote cuando pide precio estimado o presupuesto personalizado.',
          'No uses request_quote para una consulta comun de precio; reservalo para presupuesto, cotizacion o estimacion personalizada.',
          'Usa submit_media cuando afirma enviar una foto, imagen o comprobante.',
          'Usa request_human cuando pide una persona o la consulta requiere criterio humano.',
          'Usa other_query cuando anuncia que quiere hacer otra pregunta pero todavía no expresa cuál, por ejemplo "te quería consultar otra cosa" o "antes de seguir tengo otra duda".',
          'Si la otra consulta ya está escrita, clasifica la consulta concreta en lugar de usar other_query.',
          'Si pregunta por una sede, sucursal, barrio o si la atención corresponde a una ubicación determinada, usa business_information con topic address y bookingMessage null.',
          'Si responde solamente con el nombre o alias de un servicio después de que el bot pidió elegir uno, trátalo como selección para la reserva; no como pedido de descripción ni de catálogo.',
          'Si pide que lo agenden o reserven esta semana sin indicar servicio, inicia book_appointment y deja que el flujo pida solamente el dato faltante; no respondas con el catálogo como consulta informativa.',
          'Nunca respondas booking_channels a una pregunta sobre cómo se realiza un servicio. Para proceso, lavado, preparación o procedimiento usa business_information de services con catalogQuery.general.',
          'Usa stop_flow cuando dice que no necesita nada mas o quiere terminar la conversacion y no esta cancelando una reserva en curso, incluso con respuestas informales como no gracias, nada mas, era eso, joya o estamos.',
          'bookingMessage debe contener solamente la parte util para continuar o modificar la reserva.',
          'Si el mensaje es solo informativo, social o ajeno a la reserva, bookingMessage debe ser null.',
          'Ademas de clasificar, extrae en bookingExtraction todos los datos de reserva visibles en customerMessage.',
          'Si pide varios servicios para reservar, coloca el primero en bookingExtraction.service y los siguientes, en orden y sin repetir, en bookingExtraction.additionalServices.',
          'Si currentDraft ya tiene un servicio y el cliente pide sumar, agregar o hacer otro servicio en el mismo turno, conserva el servicio actual como contexto y coloca cada nuevo servicio solicitado en bookingExtraction.additionalServices. No lo clasifiques como correccion ni reemplazo.',
          'Evalua name, service, professional, date y time por separado con value, confidence y evidence.',
          'expectedField indica el dato que el flujo espera, pero no impide extraer datos adelantados.',
          'Para service y professional usa exclusivamente IDs presentes en catalog.',
          'Usa nombres, alias y descripciones del catalogo para comprender expresiones naturales del cliente.',
          'Si no hay evidencia de un campo, usa value null, confidence 0 y evidence vacio.',
          'No copies valores de currentDraft si no aparecen en customerMessage.',
          'Interpreta fechas relativas usando currentDate y timezone. date usa YYYY-MM-DD y time HH:mm.',
          'Detecta correction solo cuando el cliente expresa que quiere cambiar un dato existente.',
          'Si bookingMessage es null, bookingExtraction debe ser null, salvo professional_schedule o request_quote. Para request_quote conserva los servicios mencionados en bookingExtraction para poder calcular el presupuesto, pero no inicies una reserva.',
          'evidence debe ser un fragmento textual exacto de customerMessage.',
          'Si no esta claro, usa unknown con confianza baja.'
        ].join('\n'),
        input: JSON.stringify({
          customerMessage: input.message,
          currentStep: input.currentStep,
          lastBotMessage: input.lastBotMessage,
          recentMessages: input.recentMessages,
          currentDraft: input.draft,
          expectedField: nextMissingField(input.draft, input.catalog.bookingFlowOrder),
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
      // La respuesta estructurada principal ya clasifica intenciones y extrae
      // los campos de reserva. Evitamos una segunda llamada de IA para volver a
      // decidir si una consulta informativa tambien contiene una reserva.
      const prioritizedRouting = applyContextualRoutingPriorities(routing, input)
      const groundedRouting = applyExpectedFieldCatalogFallback(prioritizedRouting, input)

      console.info('[conversation-router] routed message', {
        currentStep: input.currentStep,
        source: 'ai',
        intents: groundedRouting.intents.map((intent) => ({
          type: intent.type,
          topic: intent.topic,
          confidence: intent.confidence
        }))
      })

      return { ...groundedRouting, source: 'ai' }
    } catch (error) {
      console.warn('[conversation-router] AI routing failed; using deterministic fallback', error)
      return {
        ...applyExpectedFieldCatalogFallback(deterministic, input),
        source: 'deterministic'
      }
    }
  }

}

export function applyExpectedFieldCatalogFallback(
  routing: Omit<ConversationRouting, 'source'>,
  input: Pick<ConversationRouterInput, 'message' | 'currentStep' | 'catalog'>
): Omit<ConversationRouting, 'source'> {
  if (looksLikeInformationQuestion(input.message)) return routing
  const isService = input.currentStep === 'ASK_SERVICE' ||
    (
      ['START', 'ASK_CUSTOMER_NAME'].includes(input.currentStep) &&
      Boolean(routing.bookingMessage) &&
      routing.intents.some((intent) =>
        intent.type === 'book_appointment' && intent.confidence >= 0.65
      )
    )
  const isProfessional = input.currentStep === 'ASK_PROFESSIONAL'
  if (!isService && !isProfessional) return routing
  const options = isService ? input.catalog.services : input.catalog.professionals
  const matches = resolveCatalogOptionMatches(normalizeEvidenceText(input.message), options)
  const isExactServiceSelection = isService && matches.length === 1 &&
    isBareCatalogOptionSelection(input.message, matches[0]!)
  if (routing.intents.some((intent) =>
    ['professional_schedule', 'other_query', 'request_human'].includes(intent.type) &&
    intent.confidence >= 0.65
  )) return routing
  if (
    !isExactServiceSelection &&
    routing.intents.some((intent) => intent.type === 'service_detail' && intent.confidence >= 0.65)
  ) return routing
  if (matches.length !== 1) return routing

  const match = matches[0]!
  const bookingExtraction = routing.bookingExtraction ?? emptyBookingExtraction()
  const groundedField = { value: match.id, confidence: 0.92, evidence: input.message.trim() }
  const intentType = isService ? 'book_appointment' as const : 'professional_preference' as const
  const intents = routing.intents.filter((intent) =>
    !['unknown', 'go_back'].includes(intent.type) &&
    !(isExactServiceSelection && intent.type === 'service_detail') &&
    !(intent.type === 'business_information' && ['services', 'professionals'].includes(intent.topic ?? ''))
  )
  if (!intents.some((intent) => intent.type === intentType)) {
    intents.push({ type: intentType, topic: null, confidence: 0.92, evidence: input.message.trim() })
  }
  return {
    ...routing,
    intents,
    bookingMessage: input.message.trim() || null,
    bookingExtraction: {
      ...bookingExtraction,
      ...(isService ? { service: groundedField } : { professional: groundedField })
    },
    catalogQuery: null
  }
}

function isBareCatalogOptionSelection(
  message: string,
  option: { name: string; aliases?: string[] }
) {
  const normalizedMessage = normalizeEvidenceText(message)
    .replace(/^(?:elijo|me interesa|prefiero|quiero)\s+/, '')
    .replace(/\s+por favor$/, '')
  return catalogOptionSelectionLabels(option)
    .some((label) => normalizeEvidenceText(label) === normalizedMessage)
}

function catalogOptionSelectionLabels(option: { name: string; aliases?: string[] }) {
  const primaryName = option.name.split('(')[0]?.trim()
  return Array.from(new Set([
    option.name,
    ...(primaryName && primaryName !== option.name ? [primaryName] : []),
    ...(option.aliases ?? [])
  ]))
}

export function applyContextualRoutingPriorities(
  routing: Omit<ConversationRouting, 'source'>,
  input: Pick<ConversationRouterInput, 'message' | 'currentStep'>
): Omit<ConversationRouting, 'source'> {
  if (input.currentStep === 'ASK_TIME' && isCompactTimeSelection(input.message)) {
    const intents = routing.intents.filter((intent) =>
      ![
        'professional_schedule',
        'business_information',
        'deposit_information',
        'service_detail',
        'other_query',
        'unknown'
      ].includes(intent.type)
    )
    if (!intents.some((intent) => intent.type === 'availability_preference')) {
      intents.push({
        type: 'availability_preference',
        topic: null,
        confidence: 1,
        evidence: input.message.trim()
      })
    }
    return {
      ...routing,
      intents,
      bookingMessage: input.message.trim() || null,
      catalogQuery: null
    }
  }

  const hasBookingTask = Boolean(routing.bookingMessage) && routing.intents.some((intent) =>
    isBookingTaskIntent(intent) && intent.confidence >= 0.65
  )
  if (routing.intents.some((intent) =>
    intent.type === 'professional_schedule' && intent.confidence >= 0.65
  ) && !hasBookingTask) {
    return { ...routing, bookingMessage: null, catalogQuery: null }
  }
  if (routing.intents.some((intent) =>
    intent.type === 'service_detail' && intent.confidence >= 0.65
  ) && !hasBookingTask) {
    return { ...routing, bookingMessage: null }
  }

  if (looksLikeInformationQuestion(input.message)) return routing
  const selection = input.currentStep === 'ASK_SERVICE'
    ? {
        field: routing.bookingExtraction?.service,
        intent: 'book_appointment' as const
      }
    : input.currentStep === 'ASK_PROFESSIONAL'
      ? {
          field: routing.bookingExtraction?.professional,
          intent: 'professional_preference' as const
        }
      : null
  if (!selection?.field?.value || selection.field.confidence < 0.85) return routing

  const intents = routing.intents.filter((intent) =>
    intent.type !== 'unknown' &&
    !(intent.type === 'business_information' && ['services', 'professionals'].includes(intent.topic ?? ''))
  )
  if (!intents.some((intent) => intent.type === selection.intent)) {
    intents.push({
      type: selection.intent,
      topic: null,
      confidence: selection.field.confidence,
      evidence: selection.field.evidence
    })
  }
  return {
    ...routing,
    intents,
    bookingMessage: input.message.trim() || null,
    catalogQuery: null
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
  const catalogQuery = context?.catalog
    ? deterministicCatalogQuery(message, context.catalog)
    : null
  const hasExplicitBookingSignal = hasExplicitBookingIntent(normalized)
  const hasCatalogBookingSignal = !catalogQuery &&
    hasCatalogGroundedBookingIntent(normalized, context?.catalog)
  const hasBookingSignal = hasExplicitBookingSignal || hasCatalogBookingSignal
  const intents: RoutedIntent[] = topics.map((topic) => ({
    type: 'business_information',
    topic,
    confidence: 0.95,
    evidence: message.trim()
  }))
  if (hasExplicitQuoteRequest(normalized)) {
    intents.push({
      type: 'request_quote',
      topic: null,
      confidence: 0.95,
      evidence: message.trim()
    })
  }

  if (catalogQuery) {
    intents.push({
      type: 'business_information',
      topic: catalogQuery.requestedInformation.some((item) => item === 'price' || item === 'deposit')
        ? 'prices'
        : 'services',
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
  const groundedAiBookingMessage = groundedBookingMessage(
    aiRouting.bookingMessage,
    originalMessage
  )
  const hasGroundedAiBookingTask = Boolean(groundedAiBookingMessage) &&
    hasDistinctGroundedBookingEvidence(aiRouting, originalMessage)
  const aiCatalogQuery = groundedCatalogQuery(
    aiRouting.catalogQuery ?? null,
    originalMessage,
    catalog
  )
  const deterministicCatalogQuery = groundedCatalogQuery(
    deterministic.catalogQuery ?? null,
    originalMessage,
    catalog
  )
  const highConfidenceAiCatalogQuery = catalog
    ? highConfidenceAiCatalogQueryFromIntent(aiRouting, originalMessage, catalog)
    : null
  // Una mención inequívoca del nombre o alias en el catálogo es más confiable
  // que una clasificación genérica de IA: conserva tanto el servicio como el
  // dato pedido (por ejemplo, precio) y evita listar el catálogo completo.
  let catalogQuery = deterministicCatalogQuery?.serviceId
    ? deterministicCatalogQuery
    : (deterministicCatalogQuery?.candidateServiceIds?.length ?? 0) > 1
      ? deterministicCatalogQuery
      : highConfidenceAiCatalogQuery ?? aiCatalogQuery ?? deterministicCatalogQuery
  const serviceDetailIntent = aiRouting.intents.find((intent) =>
    intent.type === 'service_detail' && intent.confidence >= 0.65
  )
  if (!catalogQuery && serviceDetailIntent && catalog) {
    const serviceMatches = resolveCatalogQueryServices(
      normalizeEvidenceText(originalMessage),
      catalog
    )
    if (serviceMatches.length) {
      catalogQuery = {
        serviceId: serviceMatches.length === 1 ? serviceMatches[0]?.id ?? null : null,
        candidateServiceIds: serviceMatches.map((service) => service.id),
        requestedInformation: ['general'],
        confidence: serviceMatches.length === 1 ? 0.95 : 0.82,
        evidence: originalMessage.trim()
      }
    }
  }
  const deterministicTopics = new Set(businessInformationTopicsFromRouting(deterministic))
  const normalizedOriginalMessage = normalizeEvidenceText(originalMessage)
  const catalogGroundedBookingRequest = Boolean(catalog) &&
    hasCatalogGroundedBookingIntent(normalizedOriginalMessage, catalog)
  const explicitBookingRequest = hasExplicitBookingAction(normalizedOriginalMessage) ||
    catalogGroundedBookingRequest
  const hasExplicitGeneralCatalogRequest = deterministicTopics.has('services')
  const deterministicSpecificCatalogRequest = Boolean(
    deterministicCatalogQuery?.requestedInformation.some((item) => item !== 'general')
  )
  const suppressGenericCatalogInformation = explicitBookingRequest &&
    !hasExplicitGeneralCatalogRequest
  if (
    suppressGenericCatalogInformation &&
    !deterministicSpecificCatalogRequest &&
    catalogQuery?.requestedInformation.every((item) => item === 'general')
  ) {
    // La intención y la consulta de catálogo representan la misma orden.
    // Si una reserva explícita no contiene una consulta informativa real,
    // ambas deben desaparecer juntas para no listar todo el catálogo.
    catalogQuery = null
  }
  const hasGroundedAiInformation = aiRouting.intents.some((intent) =>
    intent.type === 'business_information' &&
    isGroundedBusinessInformationIntent(intent, originalMessage)
  )
  const hasGroundedAiDepositInformation = aiRouting.intents.some((intent) =>
    isGroundedDepositInformationIntent(intent, originalMessage)
  )
  const hasProfessionalScheduleQuestion = aiRouting.intents.some((intent) =>
    intent.type === 'professional_schedule' &&
    intent.confidence >= 0.65 &&
    normalizeEvidenceText(originalMessage).includes(normalizeEvidenceText(intent.evidence))
  )
  const standaloneQuoteRequest = isQuoteOnlyRouting({
    intents: [...aiRouting.intents, ...deterministic.intents]
  }, originalMessage)
  const hasExactCatalogPriceQuery = Boolean(
    catalogQuery?.serviceId && catalogQuery.requestedInformation.includes('price')
  )
  const standaloneBusinessInformationQuestion =
    (
      deterministicTopics.size > 0 ||
      catalogQuery !== null ||
      hasGroundedAiInformation ||
      hasGroundedAiDepositInformation ||
      hasProfessionalScheduleQuestion
    ) &&
    deterministic.bookingMessage === null &&
    (!hasGroundedAiBookingTask || hasExactCatalogPriceQuery)
  const intents = aiRouting.intents.filter((intent) => {
    if (
      suppressGenericCatalogInformation &&
      (
        intent.type === 'service_detail' ||
        (
          intent.type === 'business_information' &&
          (
            intent.topic === 'services' ||
            (intent.topic === 'prices' && !deterministicSpecificCatalogRequest)
          )
        )
      )
    ) {
      return false
    }
    if (isBookingTaskIntent(intent) && !isGroundedIntentEvidence(intent, originalMessage)) {
      return false
    }
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
    if (standaloneQuoteRequest && isBookingTaskIntent(intent)) return false
    if (
      standaloneBusinessInformationQuestion &&
      intent.type === 'request_quote' &&
      !hasExplicitQuoteRequest(normalizeEvidenceText(originalMessage))
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
    bookingMessage: standaloneBusinessInformationQuestion || standaloneQuoteRequest
      ? null
      : groundedAiBookingMessage
        ?? deterministic.bookingMessage
        ?? (hasBookingRelatedIntent ? originalMessage.trim() || null : null),
    bookingExtraction: hasProfessionalScheduleQuestion
      ? aiRouting.bookingExtraction ?? null
      : standaloneBusinessInformationQuestion && !standaloneQuoteRequest
        ? null
        : quoteBookingExtraction({
            standaloneQuoteRequest,
            aiExtraction: aiRouting.bookingExtraction,
            deterministicExtraction: deterministic.bookingExtraction,
            catalogQuery,
            catalog,
            message: originalMessage
          }),
    catalogQuery
  }
}

function quoteBookingExtraction(input: {
  standaloneQuoteRequest: boolean
  aiExtraction: BookingV2Extraction | null
  deterministicExtraction: BookingV2Extraction | null
  catalogQuery: CatalogQuery | null
  catalog: ConversationRouterInput['catalog'] | undefined
  message: string
}) {
  const extraction = input.aiExtraction ?? input.deterministicExtraction
  const matchingServices = input.catalog
    ? resolveCatalogQueryServices(normalizeEvidenceText(input.message), input.catalog)
    : []
  const fallbackServiceId = input.catalogQuery?.serviceId ?? (
    matchingServices.length === 1 ? matchingServices[0]?.id ?? null : null
  )
  if (!input.standaloneQuoteRequest || extraction?.service.value || !fallbackServiceId) {
    return extraction ?? null
  }
  return {
    ...(extraction ?? emptyBookingExtraction()),
    service: {
      value: fallbackServiceId,
      confidence: input.catalogQuery?.confidence ?? 0.95,
      evidence: input.catalogQuery?.evidence ?? input.message.trim()
    }
  }
}

export function isQuoteOnlyRouting(
  _routing: Pick<ConversationRouting, 'intents'>,
  message: string
) {
  const normalized = normalizeEvidenceText(message)
  return hasExplicitQuoteRequest(normalized) &&
    !hasExplicitBookingAction(normalized)
}

function groundedBookingMessage(value: string | null, originalMessage: string) {
  const normalizedValue = normalizeEvidenceText(value ?? '')
  if (!normalizedValue) return null
  return normalizeEvidenceText(originalMessage).includes(normalizedValue)
    ? value?.trim() || null
    : null
}

function isBookingTaskIntent(intent: RoutedIntent) {
  return [
    'book_appointment',
    'edit_booking',
    'availability_preference',
    'professional_preference'
  ].includes(intent.type)
}

function isGroundedIntentEvidence(intent: RoutedIntent, originalMessage: string) {
  const evidence = normalizeEvidenceText(intent.evidence)
  return intent.confidence >= 0.65 &&
    Boolean(evidence) &&
    normalizeEvidenceText(originalMessage).includes(evidence)
}

function hasDistinctGroundedBookingEvidence(
  routing: Omit<ConversationRouting, 'source'>,
  originalMessage: string
) {
  const informationEvidence = routing.intents
    .filter((intent) => [
      'business_information',
      'deposit_information',
      'professional_schedule',
      'service_detail'
    ].includes(intent.type) && isGroundedIntentEvidence(intent, originalMessage))
    .map((intent) => normalizeEvidenceText(intent.evidence))
  const bookingEvidence = [
    ...routing.intents
      .filter((intent) =>
        intent.type === 'book_appointment' &&
        isGroundedIntentEvidence(intent, originalMessage)
      )
      .map((intent) => normalizeEvidenceText(intent.evidence)),
    ...(['service', 'professional', 'date', 'time'] as const)
      .map((field) => routing.bookingExtraction?.[field])
      .filter((field) =>
        Boolean(field?.value) &&
        (field?.confidence ?? 0) >= 0.55 &&
        Boolean(field?.evidence) &&
        normalizeEvidenceText(originalMessage).includes(
          normalizeEvidenceText(field?.evidence ?? '')
        )
      )
      .map((field) => normalizeEvidenceText(field?.evidence ?? ''))
  ]

  return bookingEvidence.some((evidence) =>
    Boolean(evidence) &&
    !informationEvidence.some((information) =>
      information === evidence || information.includes(evidence)
    )
  )
}

export function hasGroundedDepositInformationIntent(
  routing: Pick<ConversationRouting, 'intents'>,
  originalMessage: string
) {
  return routing.intents.some((intent) => isGroundedDepositInformationIntent(intent, originalMessage))
}

function isGroundedDepositInformationIntent(intent: RoutedIntent, originalMessage: string) {
  return intent.type === 'deposit_information' &&
    intent.confidence >= 0.85 &&
    isGroundedIntentEvidence(intent, originalMessage)
}

export function applyNaturalBookingRecovery(
  routing: Omit<ConversationRouting, 'source'>,
  recovery: NaturalBookingRecovery,
  originalMessage: string,
  candidateServiceIds: ReadonlySet<string>
): Omit<ConversationRouting, 'source'> {
  if (
    recovery.decision !== 'booking' ||
    normalizeConfidence(recovery.confidence) < 0.75
  ) {
    return routing
  }
  const evidence = recovery.evidence.trim()
  const normalizedEvidence = normalizeEvidenceText(evidence)
  if (
    !normalizedEvidence ||
    !normalizeEvidenceText(originalMessage).includes(normalizedEvidence)
  ) {
    return routing
  }
  const serviceId = recovery.serviceId && candidateServiceIds.has(recovery.serviceId)
    ? recovery.serviceId
    : null
  if (recovery.serviceId && !serviceId) return routing

  const bookingExtraction = routing.bookingExtraction ?? emptyBookingExtraction()
  const intents = routing.intents.filter((intent) => {
    if (intent.type !== 'service_detail') return intent.type !== 'unknown'
    const detailEvidence = normalizeEvidenceText(intent.evidence)
    return !detailEvidence || (
      detailEvidence !== normalizedEvidence &&
      !detailEvidence.includes(normalizedEvidence) &&
      !normalizedEvidence.includes(detailEvidence)
    )
  })
  intents.push({
    type: 'book_appointment',
    topic: null,
    confidence: normalizeConfidence(recovery.confidence),
    evidence
  })

  return {
    ...routing,
    intents,
    bookingMessage: evidence,
    bookingExtraction: {
      ...bookingExtraction,
      ...(serviceId
        ? {
            service: {
              value: serviceId,
              confidence: normalizeConfidence(recovery.confidence),
              evidence
            }
          }
        : {})
    },
    ...(serviceId && routing.catalogQuery?.requestedInformation.includes('general')
      ? { catalogQuery: null }
      : {})
  }
}

function normalizeCatalogQuery(value: CatalogQuery | null | undefined): CatalogQuery | null {
  if (!value || typeof value !== 'object') return null
  const serviceId = typeof value.serviceId === 'string' && value.serviceId.trim()
    ? value.serviceId.trim()
    : null
  const candidateServiceIds = Array.from(new Set(
    Array.isArray(value.candidateServiceIds)
      ? value.candidateServiceIds
          .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
          .map((item) => item.trim())
      : []
  ))
  if (serviceId && !candidateServiceIds.includes(serviceId)) candidateServiceIds.unshift(serviceId)
  if (!serviceId && candidateServiceIds.length < 2) return null
  if (!Array.isArray(value.requestedInformation)) return null
  const requestedInformation = Array.from(new Set(
    value.requestedInformation.filter((item): item is CatalogQueryInformation =>
      CATALOG_QUERY_INFORMATION.includes(item as CatalogQueryInformation)
    )
  ))
  if (!requestedInformation.length) return null
  if (typeof value.evidence !== 'string' || !value.evidence.trim()) return null
  return {
    serviceId,
    candidateServiceIds,
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
  if (containsAny(normalized, [
    'precio', 'precios', 'cuanto cuesta', 'cuanto sale', 'cuanto me sale', 'cuanto vale', 'valor'
  ])) {
    requestedInformation.push('price')
  }
  if (isDepositInformationRequest(message)) {
    requestedInformation.push('deposit')
  }
  if (containsAny(normalized, ['cuanto dura', 'duracion', 'demora'])) {
    requestedInformation.push('duration')
  }
  if (containsAny(normalized, ['quien lo hace', 'quien hace', 'profesional', 'profesionales', 'quien atiende'])) {
    requestedInformation.push('professionals')
  }
  if (!requestedInformation.includes('price') && containsAny(normalized, [
    'informacion', 'info', 'contame', 'consultar', 'consulta', 'explicame',
    'detalle', 'detalles', 'de que se trata'
  ])) {
    requestedInformation.push('general')
  }
  if (!requestedInformation.length) return null

  const matches = resolveCatalogQueryServices(normalized, catalog)
  if (!matches.length) return null

  return {
    serviceId: matches.length === 1 ? matches[0]?.id ?? null : null,
    candidateServiceIds: matches.map((service) => service.id),
    requestedInformation: Array.from(new Set(requestedInformation)),
    confidence: matches.length === 1 ? 0.95 : 0.82,
    evidence: message.trim()
  }
}

export function isDepositInformationRequest(message: string) {
  const normalized = normalizeText(message)
  const depositTerms = ['seña', 'sena', 'anticipo']
  const amountTerms = [
    'cuanto', 'de cuanto', 'monto', 'valor', 'importe', 'hay que dejar', 'hay que pagar'
  ]
  const mentionsDeposit = containsAny(normalized, depositTerms)
  const asksReservationAmount = containsAny(normalized, ['reserva', 'reservar']) &&
    containsAny(normalized, amountTerms)
  return (mentionsDeposit || asksReservationAmount) && containsAny(normalized, amountTerms)
}

function resolveCatalogQueryServices(
  normalizedMessage: string,
  catalog: ConversationRouterInput['catalog']
) {
  const fullLabelMatches = catalog.services
    .map((service) => ({
      service,
      specificity: Math.max(0, ...[service.name, ...(service.aliases ?? [])]
        .filter((label) => catalogLabelIsMentioned(normalizedMessage, normalizeEvidenceText(label)))
        .map((label) => catalogQuerySubjectTokens(normalizeEvidenceText(label)).length))
    }))
    .filter((candidate) => candidate.specificity > 0)
  if (fullLabelMatches.length) {
    const bestSpecificity = Math.max(...fullLabelMatches.map((candidate) => candidate.specificity))
    return fullLabelMatches
      .filter((candidate) => candidate.specificity === bestSpecificity)
      .map((candidate) => candidate.service)
  }

  const messageTokens = catalogQuerySubjectTokens(normalizedMessage)
  const catalogTokens = catalog.services.flatMap((service) =>
    [service.name, ...(service.aliases ?? [])]
      .flatMap((label) => catalogQuerySubjectTokens(normalizeEvidenceText(label)))
  )
  const relevantMessageTokens = messageTokens.filter((messageToken) =>
    catalogTokens.some((catalogToken) => catalogTokensMatch(messageToken, catalogToken))
  )
  const sharedPartialMatches = relevantMessageTokens.length
    ? catalog.services.filter((service) =>
        [service.name, ...(service.aliases ?? [])].some((label) => {
          const labelTokens = catalogQuerySubjectTokens(normalizeEvidenceText(label))
          return relevantMessageTokens.every((messageToken) =>
            labelTokens.some((labelToken) => catalogTokensMatch(messageToken, labelToken))
          )
        })
      )
    : []
  if (sharedPartialMatches.length) return sharedPartialMatches

  const scoredMatches = catalog.services
    .map((service) => ({
      service,
      score: Math.max(...[service.name, ...(service.aliases ?? [])].map((label) =>
        catalogLabelMatchScore(messageTokens, catalogQuerySubjectTokens(normalizeEvidenceText(label)))
      ))
    }))
    .filter((candidate) => candidate.score >= 0.5)
    .sort((left, right) => right.score - left.score)
  const bestScore = scoredMatches[0]?.score ?? 0
  return scoredMatches
    .filter((candidate) => bestScore - candidate.score < 0.08)
    .map((candidate) => candidate.service)
}

function resolveCatalogOptionMatches(
  normalizedMessage: string,
  options: BookingV2CatalogOption[]
) {
  const fullLabelMatches = options.filter((option) =>
    catalogOptionSelectionLabels(option).some((label) =>
      catalogLabelIsMentioned(normalizedMessage, normalizeEvidenceText(label))
    )
  )
  if (fullLabelMatches.length) return fullLabelMatches

  const messageTokens = catalogQuerySubjectTokens(normalizedMessage)
  const scoredMatches = options
    .map((option) => ({
      option,
      score: Math.max(...catalogOptionSelectionLabels(option).map((label) =>
        catalogLabelMatchScore(messageTokens, catalogQuerySubjectTokens(normalizeEvidenceText(label)))
      ))
    }))
    .filter((candidate) => candidate.score >= 0.82)
    .sort((left, right) => right.score - left.score)
  const bestScore = scoredMatches[0]?.score ?? 0
  return scoredMatches
    .filter((candidate) => bestScore - candidate.score < 0.05)
    .map((candidate) => candidate.option)
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
  const resolvedServiceIds = resolveCatalogQueryServices(normalizedMessage, catalog)
    .map((service) => service.id)
  if (query.serviceId) {
    return resolvedServiceIds.length === 1 && resolvedServiceIds[0] === query.serviceId
      ? query
      : null
  }
  const candidateServiceIds = query.candidateServiceIds ?? []
  return resolvedServiceIds.length > 1 &&
    resolvedServiceIds.length === candidateServiceIds.length &&
    resolvedServiceIds.every((serviceId) => candidateServiceIds.includes(serviceId))
    ? query
    : null
}

function highConfidenceAiCatalogQueryFromIntent(
  aiRouting: Omit<ConversationRouting, 'source'>,
  originalMessage: string,
  catalog: NonNullable<ConversationRouterInput['catalog']>
): CatalogQuery | null {
  const requestedInformation = new Set<CatalogQueryInformation>()
  let confidence = 0
  for (const intent of aiRouting.intents) {
    if (intent.confidence < 0.85 || !isGroundedIntentEvidence(intent, originalMessage)) continue
    if (intent.type === 'service_detail') {
      requestedInformation.add('general')
      confidence = Math.max(confidence, intent.confidence)
      continue
    }
    if (intent.type !== 'business_information') continue
    if (intent.topic === 'prices') requestedInformation.add('price')
    if (intent.topic === 'services') requestedInformation.add('general')
    if (intent.topic === 'professionals') requestedInformation.add('professionals')
    confidence = Math.max(confidence, intent.confidence)
  }
  if (!requestedInformation.size) return null

  const matches = resolveCatalogQueryServices(normalizeEvidenceText(originalMessage), catalog)
  if (matches.length !== 1) return null
  const service = matches[0]
  if (!service) return null

  return {
    serviceId: service.id,
    candidateServiceIds: [service.id],
    requestedInformation: [...requestedInformation],
    confidence,
    evidence: originalMessage.trim()
  }
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
      catalogTokensMatch(labelToken, messageToken)
    )
  )
}

function catalogQuerySubjectTokens(value: string) {
  const ignored = new Set([
    'a', 'al', 'algo', 'cual', 'cuales', 'consultar', 'consulta', 'cuanto', 'cuesta', 'dame', 'de', 'decime',
    'del', 'detalle', 'detalles', 'duracion', 'el', 'es', 'explicame', 'informacion',
    'info', 'la', 'las', 'lo', 'los', 'para', 'precio', 'precios', 'que', 'quien', 'quienes',
    'sobre', 'un', 'una', 'valor', 'y'
  ])
  return value.split(' ').filter((token) => token && !ignored.has(token))
}

function catalogLabelMatchScore(messageTokens: string[], labelTokens: string[]) {
  if (!labelTokens.length || !messageTokens.length) return 0
  const matched = labelTokens.filter((labelToken) =>
    messageTokens.some((messageToken) => catalogTokensMatch(labelToken, messageToken))
  ).length
  if (!matched) return 0
  const coverage = matched / labelTokens.length
  const specificity = Math.min(1, labelTokens.length / messageTokens.length)
  return coverage * 0.9 + specificity * 0.1
}

function catalogTokensMatch(left: string, right: string) {
  if (left === right) return true
  if (singularCatalogToken(left) === singularCatalogToken(right)) return true
  if (left.length < 4 || right.length < 4) return false
  return editDistanceAtMostOne(left, right)
}

function singularCatalogToken(token: string) {
  if (token.length >= 7 && token.endsWith('ciones')) return `${token.slice(0, -6)}cion`
  if (token.length >= 6 && token.endsWith('es')) return token.slice(0, -2)
  if (token.length >= 5 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

function editDistanceAtMostOne(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 1) return false
  if (left.length === right.length) {
    const mismatches: number[] = []
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) mismatches.push(index)
    }
    if (
      mismatches.length === 2 &&
      mismatches[1] === mismatches[0]! + 1 &&
      left[mismatches[0]!] === right[mismatches[1]!] &&
      left[mismatches[1]!] === right[mismatches[0]!]
    ) {
      return true
    }
  }
  let differences = 0
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1
      rightIndex += 1
      continue
    }
    differences += 1
    if (differences > 1) return false
    if (left.length > right.length) leftIndex += 1
    else if (right.length > left.length) rightIndex += 1
    else {
      leftIndex += 1
      rightIndex += 1
    }
  }
  if (leftIndex < left.length || rightIndex < right.length) differences += 1
  return differences <= 1
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
    'por donde reservo', 'por donde puedo reservar', 'donde reservo', 'como puedo reservar', 'como reservo',
    'link para reservar', 'enlace para reservar', 'pagina para reservar'
  ])) add('booking_channels')

  if (containsAny(normalized, ['telefono', 'numero del local', 'whatsapp del local'])) add('phone')
  if (containsAny(normalized, ['correo', 'email', 'mail del local'])) add('email')
  if (containsAny(normalized, ['instagram', 'ig del local', 'insta del local'])) add('instagram')
  if (containsAny(normalized, ['facebook'])) add('facebook')
  if (containsAny(normalized, [
    'que servicios tienen', 'que servicios hacen', 'que servicios hay', 'cuales servicios hay',
    'servicios disponibles', 'mostrame los servicios', 'mostrar servicios', 'ver servicios',
    'quiero ver los servicios', 'quiero ver el catalogo', 'mostrame el catalogo',
    'menu de servicios', 'que ofrecen', 'que puedo reservar',
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
    'quiero consultar el precio', 'consultar el precio', 'consulta el precio',
    'los precios', 'tarifas'
  ])) add('prices')
  if (isDepositInformationRequest(normalized)) add('prices')

  return topics
}

function containsAny(value: string, phrases: string[]) {
  return phrases.some((phrase) => value.includes(phrase))
}

function isCompactTimeSelection(message: string) {
  const compact = normalizeEvidenceText(message)
    .replace(/^(?:a\s+las?|para\s+las?)\s+/, '')
    .replace(/\s*(?:h|hs|hrs|horas)$/, '')
    .trim()
  if (!/^\d{1,4}$/.test(compact)) return false
  if (compact.length <= 2) {
    const hour = Number(compact)
    return hour >= 0 && hour <= 23
  }
  const padded = compact.padStart(4, '0')
  const hour = Number(padded.slice(0, 2))
  const minute = Number(padded.slice(2))
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

function hasExplicitBookingIntent(normalized: string) {
  return hasExplicitBookingAction(normalized) || containsAny(normalized, [
    'quiero venir',
    'necesito venir',
    'quiero hacerme',
    'queria hacerme',
    'quisiera hacerme',
    'me quiero hacer',
    'me quiero cortar',
    'necesito un corte',
    'quiero un corte',
    'quiero corte'
  ]) || /\b(?:quiero|prefiero)\s+con\s+\p{L}/u.test(normalized)
}

function hasExplicitBookingAction(normalized: string) {
  return containsAny(normalized, [
    'quiero reservar',
    'queria reservar',
    'quisiera reservar',
    'necesito reservar',
    'quiero sacar un turno',
    'queria sacar un turno',
    'quisiera sacar un turno',
    'necesito sacar un turno',
    'quiero pedir un turno',
    'queria pedir un turno',
    'quisiera pedir un turno',
    'necesito pedir un turno',
    'quiero un turno',
    'queria un turno',
    'quisiera un turno',
    'necesito un turno',
    'me das un turno',
    'dame un turno',
    'sacar turno',
    'sacame un turno',
    'reservame un turno',
    'podes reservarme',
    'podrias reservarme',
    'agendar turno',
    'agendar un turno',
    'quiero agendar',
    'agendame',
    'me agendas',
    'reservame',
    'coordinar un turno',
    'programar un turno'
  ]) || hasApproximateBookingTurnRequest(normalized)
}

function hasCatalogGroundedBookingIntent(
  normalizedMessage: string,
  catalog: ConversationRouterInput['catalog'] | undefined
) {
  if (!catalog?.services.length) return false
  const expressesServiceChoice = [
    /\b(?:quiero|queria|quisiera|necesito|prefiero)\s+(?!(?:(?:el|la|los|las|un|una|unos|unas)\s+)?(?:averiguar|consultar|conocer|costo|costos|cuanto|duracion|horario|horarios|informacion|info|precio|precios|preguntar|saber|valor|ver)\b)/,
    /\bme gustaria\s+(?!(?:(?:el|la|los|las|un|una|unos|unas)\s+)?(?:averiguar|consultar|conocer|costo|costos|cuanto|duracion|horario|horarios|informacion|info|precio|precios|preguntar|saber|valor|ver)\b)/
  ].some((pattern) => pattern.test(normalizedMessage))
  if (!expressesServiceChoice) return false
  return resolveCatalogQueryServices(normalizedMessage, catalog).length > 0
}

function hasApproximateBookingTurnRequest(normalized: string) {
  const tokens = normalized.split(' ').filter(Boolean)
  if (!tokens.some((token) => token === 'turno' || token === 'turnos')) return false
  const bookingVerbs = ['quiero', 'queria', 'quisiera', 'necesito', 'reservar', 'agendar']
  return tokens.some((token) =>
    token.length >= 4 && bookingVerbs.some((verb) => editDistanceAtMostOne(token, verb))
  )
}

function hasExplicitQuoteRequest(normalized: string) {
  return containsAny(normalized, [
    'presupuesto',
    'presupuestar',
    'cotizacion',
    'cotizar',
    'estimacion personalizada',
    'precio exacto'
  ])
}

function isGroundedBusinessInformationIntent(
  intent: RoutedIntent,
  originalMessage: string
) {
  if (intent.type !== 'business_information' || !intent.topic) return false
  const message = normalizeEvidenceText(originalMessage)
  const evidence = normalizeEvidenceText(intent.evidence)
  return intent.confidence >= 0.65 && Boolean(evidence) && message.includes(evidence)
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

function emptyBookingExtraction(): BookingV2Extraction {
  const emptyField = { value: null, confidence: 0, evidence: '' }
  return {
    name: { ...emptyField },
    service: { ...emptyField },
    professional: { ...emptyField },
    date: { ...emptyField },
    time: { ...emptyField },
    additionalServices: [],
    correction: { field: null, newValue: null, confidence: 0, evidence: '' }
  }
}

function looksLikeInformationQuestion(message: string) {
  const normalized = normalizeEvidenceText(message)
  return message.includes('?') || /^(?:que|cual|cuales|como|cuando|donde|cuanto|quien|quienes|por que)\b/.test(normalized)
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
          required: ['serviceId', 'candidateServiceIds', 'requestedInformation', 'confidence', 'evidence'],
          properties: {
            serviceId: {
              anyOf: [
                { type: 'string' },
                { type: 'null' }
              ]
            },
            candidateServiceIds: {
              type: 'array',
              items: { type: 'string' }
            },
            requestedInformation: {
              type: 'array',
              minItems: 1,
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
