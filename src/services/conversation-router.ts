import { openAiConfig } from '../config/openai.js'
import { getOpenAiClient } from '../integrations/openai-client.js'
import { isAiExecutionEnabled } from './ai-execution-context.js'
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

export type ConversationRouting = {
  intents: RoutedIntent[]
  bookingMessage: string | null
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
}

type AiConversationRouting = {
  intents: Array<{
    type: ConversationIntent
    topic: BusinessInformationTopic | null
    confidence: number
    evidence: string
  }>
  bookingMessage: string | null
}

export class ConversationRouter {
  async route(input: ConversationRouterInput): Promise<ConversationRouting> {
    const deterministic = deterministicConversationRouting(input.message)
    if (!isAiExecutionEnabled()) return deterministic

    const client = getOpenAiClient()
    if (!client) return deterministic

    try {
      const response = await client.responses.create({
        model: openAiConfig.model,
        instructions: [
          'Sos el router de una recepcionista virtual para comercios con agenda.',
          'Interpreta cada mensaje antes de que el backend ejecute el paso actual.',
          'Podes devolver varias intenciones cuando el mensaje mezcla pedidos.',
          'No respondas al cliente, no ejecutes acciones y no inventes datos.',
          'Usa business_information para preguntas sobre horarios del local, direccion, web, formas de reservar, contacto, redes, servicios o precios.',
          'Usa availability_preference para dias o franjas como despues de las 18, por la manana o solo sabados.',
          'Usa professional_preference cuando nombra, pregunta o cambia profesional.',
          'Usa request_quote cuando pide precio estimado o presupuesto personalizado.',
          'Usa submit_media cuando afirma enviar una foto, imagen o comprobante.',
          'Usa request_human cuando pide una persona o la consulta requiere criterio humano.',
          'bookingMessage debe contener solamente la parte util para continuar o modificar la reserva.',
          'Si el mensaje es solo informativo, social o ajeno a la reserva, bookingMessage debe ser null.',
          'Conserva evidencia textual breve para auditar cada clasificacion.',
          'Si no esta claro, usa unknown con confianza baja.'
        ].join('\n'),
        input: JSON.stringify({
          customerMessage: input.message,
          currentStep: input.currentStep,
          lastBotMessage: input.lastBotMessage,
          recentMessages: input.recentMessages,
          currentDraft: input.draft,
          business: input.business
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
      const routing = mergeConversationRouting(aiRouting, deterministic, input.message)

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
    bookingMessage: cleanNullableText(input.bookingMessage)
  }
}

export function deterministicConversationRouting(message: string): ConversationRouting {
  const normalized = normalizeText(message)
  const topics = detectBusinessInformationTopics(normalized)
  const hasBookingSignal = containsAny(normalized, [
    'turno', 'reservar', 'reserva', 'corte', 'barba', 'color', 'servicio',
    'para hoy', 'para manana', 'quiero venir', 'necesito venir'
  ])
  const intents: RoutedIntent[] = topics.map((topic) => ({
    type: 'business_information',
    topic,
    confidence: 0.95,
    evidence: message.trim()
  }))

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
    bookingMessage: topics.length > 0 && hasBookingSignal ? message.trim() || null : null,
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
  originalMessage: string
): Omit<ConversationRouting, 'source'> {
  const intents = [...aiRouting.intents]

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
    bookingMessage: aiRouting.bookingMessage
      ?? deterministic.bookingMessage
      ?? (hasBookingRelatedIntent ? originalMessage.trim() || null : null)
  }
}

function detectBusinessInformationTopics(normalized: string): BusinessInformationTopic[] {
  const topics: BusinessInformationTopic[] = []
  const add = (topic: BusinessInformationTopic) => {
    if (!topics.includes(topic)) topics.push(topic)
  }

  if (containsAny(normalized, [
    'a que hora abren', 'a que hora cierran', 'que horario hacen', 'horario del local',
    'horarios del local', 'cuando abren', 'cuando cierran', 'estan abiertos', 'abren hoy',
    'abren manana', 'abren el'
  ])) add('opening_hours')

  if (containsAny(normalized, [
    'donde queda', 'donde estan', 'direccion', 'ubicacion', 'como llego', 'maps', 'mapa'
  ])) add('address')

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
    'que servicios tienen', 'que servicios hacen', 'que hacen en el local', 'lista de servicios'
  ])) add('services')
  if (containsAny(normalized, [
    'cuanto sale', 'cuanto cuesta', 'que precio', 'lista de precios', 'precios de los servicios'
  ])) add('prices')

  return topics
}

function containsAny(value: string, phrases: string[]) {
  return phrases.some((phrase) => value.includes(phrase))
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
  required: ['intents', 'bookingMessage'],
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
    }
  }
}
