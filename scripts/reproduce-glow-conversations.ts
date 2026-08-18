import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/config/prisma.js'
import { ConversationService } from '../src/services/conversation-service.js'
import { WhatsAppWebhookService } from '../src/services/whatsapp-webhook-service.js'

type ReplayInput = {
  visibleMessages: string[]
  engineMessage?: string
  kind?: 'text' | 'image'
  interactiveButtonTitle?: string
  expiresPreviousSession?: boolean
}

type ReplaySession = {
  name: string
  turns: ReplayInput[]
}

type AiUsageRecord = {
  source: string
  model: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  totalTokens: number
  responseId: string
}

type StateSnapshot = {
  currentStep: string
  selectedCustomerName: string | null
  selectedService: string | null
  selectedProfessional: string | null
  selectedDate: string | null
  selectedTime: string | null
  draft: Record<string, unknown> | null
  combinedServices: string[]
  queuedServices: string[]
  guidedEstimate: unknown
  pendingInformationSelection: unknown
}

type ReplayRecord = {
  session: string
  turn: number
  visibleMessages: string[]
  engineMessage: string
  inputKind: 'text' | 'image'
  deliveryMode: 'text' | 'interactive_button'
  interactiveReplyId: string | null
  replies: string[]
  buttons: Array<{ id: string; title: string }>
  aiCalls: AiUsageRecord[]
  state: StateSnapshot
}

const AI_SOURCE_LABELS: Record<string, string> = {
  conversation_router: 'interpretación general de intención y extracción de datos',
  message_understanding: 'comprensión o redacción general del mensaje',
  booking_extraction: 'extracción de datos de la reserva',
  booking_choice: 'interpretación de una elección pendiente',
  booking_estimate_option: 'interpretación de una opción del estimativo',
  booking_estimate_decision: 'decisión entre continuar la reserva o pedir presupuesto',
  booking_service_validation: 'validación del servicio seleccionado'
}

const defaultSessions: ReplaySession[] = [
  {
    name: 'Conversación 1 — primera solicitud',
    turns: [
      { visibleMessages: ['Buenas tardes'] },
      { visibleMessages: ['Quiero solicitar un turno'] },
      { visibleMessages: ['Cecilia'] },
      {
        visibleMessages: [
          'Quiero saber precio y procedimiento para hacerme iluminación y ordenador'
        ]
      },
      { visibleMessages: ['Me interesa hacerme un ordenador'] },
      { visibleMessages: ['1'] },
      {
        visibleMessages: [
          'Si solicito un turno cuáles son los pasos a seguir? Me lavan el cabello en el lugar?'
        ]
      }
    ]
  },
  {
    name: 'Conversación 2 — 5 de agosto',
    turns: [
      { visibleMessages: ['Hola'], expiresPreviousSession: true },
      { visibleMessages: ['Quiero un turno'] },
      { visibleMessages: ['Quiero hacerme unas mechas, ordenador y corte'] },
      { visibleMessages: ['Hasta los hombros'] },
      { visibleMessages: ['Me dirías el procedimiento del ordenador'] },
      {
        visibleMessages: ['Continuar reserva'],
        interactiveButtonTitle: 'Continuar reserva'
      }
    ]
  },
  {
    name: 'Conversación 3 — 13 de agosto',
    turns: [
      { visibleMessages: ['Hola'], expiresPreviousSession: true },
      { visibleMessages: ['Quiero un turno'] },
      { visibleMessages: ['Iluminación y corte'] },
      {
        visibleMessages: ['Foto enviada por el cliente', 'Foto recibida'],
        engineMessage: whatsappImageText(),
        kind: 'image'
      },
      { visibleMessages: ['Hasta los hombros'] },
      { visibleMessages: ['Y quisiera hacerme esto'] }
    ]
  }
]

const replayInput = loadReplayInput()
const sessions = replayInput?.sessions ?? defaultSessions
const restoreDate = replayInput?.fakeNow ? installFakeNow(replayInput.fakeNow) : null
const conversationService = new ConversationService()
const businessSlug = requiredBusinessSlug()
const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
// Número argentino ficticio y estable por ejecución. Permite atravesar la
// validación real de identidad al confirmar un turno y se elimina al finalizar.
const phone = `+549115550${runId.slice(-4)}`
const outputDirectory = resolve('tmp')
const markdownPath = resolve(outputDirectory, `glow-conversation-replay-${runId}.md`)
const jsonPath = resolve(outputDirectory, `glow-conversation-replay-${runId}.json`)

async function main() {
  const business = await prisma.business.findUnique({
    where: { slug: businessSlug },
    select: {
      id: true,
      name: true,
      isDemo: true,
      demoType: true,
      aiEnabled: true,
      featureSettings: {
        select: {
          bookingV2Enabled: true,
          bookingFlowOrder: true,
          serviceCatalogDisplayMode: true
        }
      },
      services: {
        where: { isBookable: true },
        select: { id: true, name: true }
      },
      professionals: {
        where: { isActive: true },
        select: { id: true, name: true }
      }
    }
  })

  if (!business) throw new Error('No encontré el negocio Glow.')
  if (businessSlug.startsWith('qa-sandbox-') && (!business.isDemo || business.demoType !== 'QA_SANDBOX')) {
    throw new Error('El destino solicitado no es un entorno QA aislado válido.')
  }
  if (!business.aiEnabled) throw new Error('Glow no tiene la IA habilitada.')
  if (!business.featureSettings?.bookingV2Enabled) {
    throw new Error('Glow no tiene Booking V2 habilitado.')
  }

  await cleanupQaConversation(phone, business.id)
  const conversation = await prisma.conversation.create({
    data: {
      businessId: business.id,
      phone,
      aiEnabled: true
    }
  })

  const serviceNames = new Map(business.services.map((service) => [service.id, service.name]))
  const professionalNames = new Map(
    business.professionals.map((professional) => [professional.id, professional.name])
  )
  const seenAiResponseIds = new Set<string>()
  const records: ReplayRecord[] = []
  let lastButtons: Array<{ id: string; title: string }> = []

  try {
    for (const session of sessions) {
      let turnNumber = 0
      for (const input of session.turns) {
        turnNumber += 1
        const engineMessage = input.engineMessage ?? input.visibleMessages.join('\n')
        const previousConversation = await prisma.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
          select: { updatedAt: true }
        })
        const previousActivityAt = input.expiresPreviousSession
          ? new Date(Date.now() - 48 * 60 * 60 * 1_000)
          : previousConversation.updatedAt
        const selectedButton = input.interactiveButtonTitle
          ? lastButtons.find((button) => button.title === input.interactiveButtonTitle) ?? null
          : null

        await persistInbound({
          conversationId: conversation.id,
          phone,
          visibleMessages: input.visibleMessages,
          engineMessage,
          kind: input.kind ?? 'text',
          interactiveReplyId: selectedButton?.id ?? null
        })

        const result = await conversationService.handleMessage({
          phone,
          businessId: business.id,
          message: engineMessage,
          useAi: true,
          previousActivityAt,
          ...(selectedButton ? { interactiveReplyId: selectedButton.id } : {})
        })

        const buttons = result.replyButtons ?? []
        const replies = buttons.length
          ? [result.reply]
          : result.messages?.length
            ? result.messages
            : [result.reply]

        await persistOutbound(conversation.id, phone, replies)
        const aiCalls = await newAiCalls(conversation.id, seenAiResponseIds)
        const state = await stateSnapshot(
          conversation.id,
          serviceNames,
          professionalNames
        )

        records.push({
          session: session.name,
          turn: turnNumber,
          visibleMessages: input.visibleMessages,
          engineMessage,
          inputKind: input.kind ?? 'text',
          deliveryMode: selectedButton ? 'interactive_button' : 'text',
          interactiveReplyId: selectedButton?.id ?? null,
          replies,
          buttons,
          aiCalls,
          state
        })
        lastButtons = buttons

        printTurn(records.at(-1)!)
      }
    }

    await mkdir(outputDirectory, { recursive: true })
    await writeFile(jsonPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      business: {
        id: business.id,
        name: business.name,
        featureSettings: business.featureSettings
      },
      phone,
      records
    }, null, 2)}\n`, 'utf8')
    await writeFile(markdownPath, renderMarkdown({
      businessName: business.name,
      records
    }), 'utf8')

    console.log(`\nInforme Markdown: ${markdownPath}`)
    console.log(`Datos JSON: ${jsonPath}`)
  } finally {
    await cleanupQaConversation(phone, business.id)
    await prisma.$disconnect()
    restoreDate?.()
  }
}

function loadReplayInput(): { sessions: ReplaySession[]; fakeNow: Date | null } | null {
  const inputPath = process.env.QA_REPLAY_INPUT?.trim()
  if (!inputPath) return null

  const parsed = JSON.parse(readFileSync(resolve(inputPath), 'utf8')) as {
    name?: unknown
    fakeNow?: unknown
    turns?: Array<{ message?: unknown; visibleMessages?: unknown; engineMessage?: unknown }>
  }
  const name = typeof parsed.name === 'string' && parsed.name.trim()
    ? parsed.name.trim()
    : 'Conversación QA'
  if (!Array.isArray(parsed.turns) || parsed.turns.length === 0) {
    throw new Error('El archivo QA debe incluir al menos un turno.')
  }

  const turns: ReplayInput[] = parsed.turns.map((turn, index) => {
    const visibleMessages = Array.isArray(turn.visibleMessages)
      ? turn.visibleMessages.filter((message): message is string => typeof message === 'string' && Boolean(message.trim()))
      : typeof turn.message === 'string' && turn.message.trim()
        ? [turn.message.trim()]
        : []
    if (!visibleMessages.length) throw new Error(`El turno ${index + 1} no tiene mensajes válidos.`)
    return {
      visibleMessages,
      ...(typeof turn.engineMessage === 'string' && turn.engineMessage.trim()
        ? { engineMessage: turn.engineMessage.trim() }
        : {})
    }
  })

  const fakeNow = typeof parsed.fakeNow === 'string' ? new Date(parsed.fakeNow) : null
  if (fakeNow && Number.isNaN(fakeNow.getTime())) throw new Error('fakeNow no contiene una fecha válida.')
  return { sessions: [{ name, turns }], fakeNow }
}

function installFakeNow(fakeNow: Date) {
  const RealDate = Date
  const FakeDate = function (...args: unknown[]) {
    return args.length === 0
      ? new RealDate(fakeNow.getTime())
      : Reflect.construct(RealDate, args)
  } as unknown as DateConstructor
  Object.setPrototypeOf(FakeDate, RealDate)
  Object.defineProperty(FakeDate, 'prototype', { value: RealDate.prototype })
  FakeDate.now = () => fakeNow.getTime()
  FakeDate.parse = RealDate.parse
  FakeDate.UTC = RealDate.UTC
  globalThis.Date = FakeDate
  return () => { globalThis.Date = RealDate }
}

function whatsappImageText() {
  const service = new WhatsAppWebhookService()
  const extracted = service.extractIncomingMessages({
    entry: [{
      changes: [{
        value: {
          messages: [{
            id: 'wamid.qa-replay-image',
            from: 'qa-replay',
            type: 'image',
            image: {
              id: 'qa-replay-image',
              mime_type: 'image/jpeg'
            }
          }]
        }
      }]
    }]
  })
  const message = extracted[0]
  if (!message) throw new Error('No pude simular la extracción de la foto de WhatsApp.')
  return message.text
}

async function persistInbound(input: {
  conversationId: string
  phone: string
  visibleMessages: string[]
  engineMessage: string
  kind: 'text' | 'image'
  interactiveReplyId: string | null
}) {
  if (input.kind === 'image') {
    await prisma.message.create({
      data: {
        conversationId: input.conversationId,
        phone: input.phone,
        direction: 'INBOUND',
        body: input.engineMessage,
        status: 'received',
        metadata: {
          provider: 'whatsapp',
          media: {
            type: 'image',
            id: 'qa-replay-image',
            mimeType: 'image/jpeg'
          }
        }
      }
    })
  } else {
    for (const body of input.visibleMessages) {
      await prisma.message.create({
        data: {
          conversationId: input.conversationId,
          phone: input.phone,
          direction: 'INBOUND',
          body,
          status: 'received',
          metadata: {
            provider: 'whatsapp',
            qaReplay: true,
            ...(input.interactiveReplyId
              ? { interactiveReplyId: input.interactiveReplyId }
              : {})
          }
        }
      })
    }
  }

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: {
      lastMessage: input.engineMessage,
      archivedAt: null,
      updatedAt: new Date()
    }
  })
}

async function persistOutbound(conversationId: string, phone: string, replies: string[]) {
  for (const reply of replies) {
    await prisma.message.create({
      data: {
        conversationId,
        phone,
        direction: 'OUTBOUND',
        body: reply,
        status: 'sent',
        metadata: {
          provider: 'qa-replay',
          qaReplay: true
        }
      }
    })
  }
}

async function newAiCalls(conversationId: string, seen: Set<string>): Promise<AiUsageRecord[]> {
  const events = await prisma.aiUsageEvent.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      source: true,
      model: true,
      inputTokens: true,
      cachedInputTokens: true,
      outputTokens: true,
      totalTokens: true,
      responseId: true
    }
  })
  const fresh = events.filter((event) => !seen.has(event.responseId))
  for (const event of fresh) seen.add(event.responseId)
  return fresh
}

async function stateSnapshot(
  conversationId: string,
  serviceNames: Map<string, string>,
  professionalNames: Map<string, string>
): Promise<StateSnapshot> {
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: {
      currentStep: true,
      selectedCustomerName: true,
      selectedServiceId: true,
      selectedProfessionalId: true,
      selectedDate: true,
      selectedTime: true,
      bookingV2State: true
    }
  })
  const persisted = asRecord(conversation.bookingV2State)
  const draft = asRecord(persisted?.draft)
  const combinedServices = Array.isArray(persisted?.combinedServices)
    ? persisted.combinedServices.flatMap((item) => {
        const serviceId = asRecord(item)?.serviceId
        return typeof serviceId === 'string' ? [serviceNames.get(serviceId) ?? serviceId] : []
      })
    : []
  const queuedServices = Array.isArray(persisted?.queuedServices)
    ? persisted.queuedServices.flatMap((item) => {
        const serviceId = asRecord(item)?.serviceId
        return typeof serviceId === 'string' ? [serviceNames.get(serviceId) ?? serviceId] : []
      })
    : []

  const readableDraft = draft
    ? {
        ...draft,
        ...(typeof draft.service === 'string'
          ? { service: serviceNames.get(draft.service) ?? draft.service }
          : {}),
        ...(typeof draft.professional === 'string'
          ? { professional: professionalNames.get(draft.professional) ?? draft.professional }
          : {})
      }
    : null

  return {
    currentStep: conversation.currentStep,
    selectedCustomerName: conversation.selectedCustomerName,
    selectedService: conversation.selectedServiceId
      ? serviceNames.get(conversation.selectedServiceId) ?? conversation.selectedServiceId
      : null,
    selectedProfessional: conversation.selectedProfessionalId
      ? professionalNames.get(conversation.selectedProfessionalId) ?? conversation.selectedProfessionalId
      : null,
    selectedDate: conversation.selectedDate,
    selectedTime: conversation.selectedTime,
    draft: readableDraft,
    combinedServices,
    queuedServices,
    guidedEstimate: persisted?.guidedEstimate ?? null,
    pendingInformationSelection: persisted?.pendingInformationSelection ?? null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function printTurn(record: ReplayRecord) {
  console.log(`\n${record.session} — turno ${record.turn}`)
  console.log(`Cliente: ${record.visibleMessages.join(' / ')}`)
  console.log(`Entrada al motor: ${record.engineMessage.replace(/\n/g, ' | ')}`)
  console.log(`Modo: ${record.deliveryMode}`)
  for (const reply of record.replies) console.log(`Cami: ${reply}`)
  if (record.aiCalls.length) {
    for (const call of record.aiCalls) {
      console.log(
        `IA: SÍ — ${call.source} (${AI_SOURCE_LABELS[call.source] ?? 'interpretación'}, ${call.totalTokens} tokens)`
      )
    }
  } else {
    console.log('IA: NO')
  }
  console.log(`Estado: ${JSON.stringify(record.state)}`)
}

function renderMarkdown(input: { businessName: string; records: ReplayRecord[] }) {
  const lines = [
    `# Reproducción literal de conversaciones de ${input.businessName}`,
    '',
    `Generado: ${new Date().toISOString()}`,
    '',
    `Entorno: negocio **${input.businessName}**, catálogo y configuración actuales, IA habilitada.`,
    '',
    'Cada entrada textual se procesó por separado y en el orden del transcript. La foto se convirtió al texto interno que hoy recibe el motor.',
    ''
  ]

  let currentSession = ''
  for (const record of input.records) {
    if (record.session !== currentSession) {
      currentSession = record.session
      lines.push(`## ${currentSession}`, '')
    }
    lines.push(`### Turno ${record.turn}`, '')
    lines.push('**Cliente**', '')
    for (const message of record.visibleMessages) lines.push(`> ${message.replace(/\n/g, '\n> ')}`)
    lines.push('')
    if (record.engineMessage !== record.visibleMessages.join('\n') || record.deliveryMode !== 'text') {
      lines.push(
        `Entrada efectiva al motor: \`${record.engineMessage.replace(/`/g, '\\`').replace(/\n/g, ' ⏎ ')}\` (${record.deliveryMode}).`,
        ''
      )
    }
    lines.push('**Cami**', '')
    for (const reply of record.replies) lines.push(`> ${reply.replace(/\n/g, '\n> ')}`, '')
    if (record.buttons.length) {
      lines.push(`Botones: ${record.buttons.map((button) => `“${button.title}”`).join(', ')}.`, '')
    }
    if (record.aiCalls.length) {
      lines.push('**Interpretación con IA: SÍ**', '')
      for (const call of record.aiCalls) {
        lines.push(
          `- \`${call.source}\`: ${AI_SOURCE_LABELS[call.source] ?? 'interpretación'}; modelo ${call.model}; ${call.totalTokens} tokens.`
        )
      }
      lines.push('')
    } else {
      lines.push('**Interpretación con IA: NO.**', '')
    }
    lines.push(
      `Estado posterior: \`${record.state.currentStep}\`; servicio principal: ${record.state.selectedService ?? 'ninguno'}; servicios combinados: ${record.state.combinedServices.join(', ') || 'ninguno'}; cola: ${record.state.queuedServices.join(', ') || 'ninguna'}.`,
      ''
    )
  }

  const calls = input.records.flatMap((record) => record.aiCalls)
  const totals = new Map<string, { calls: number; tokens: number }>()
  for (const call of calls) {
    const current = totals.get(call.source) ?? { calls: 0, tokens: 0 }
    current.calls += 1
    current.tokens += call.totalTokens
    totals.set(call.source, current)
  }
  lines.push('## Resumen de llamadas a IA', '')
  if (!calls.length) {
    lines.push('No se registraron llamadas a IA.', '')
  } else {
    for (const [source, total] of totals) {
      lines.push(`- \`${source}\`: ${total.calls} llamada(s), ${total.tokens} tokens.`)
    }
    lines.push('', `Total: ${calls.length} llamada(s), ${calls.reduce((sum, call) => sum + call.totalTokens, 0)} tokens.`, '')
  }

  return `${lines.join('\n')}\n`
}

async function cleanupQaConversation(qaPhone: string, businessId: string) {
  const conversations = await prisma.conversation.findMany({
    where: { phone: qaPhone },
    select: { id: true }
  })
  const conversationIds = conversations.map((conversation) => conversation.id)
  if (conversationIds.length) {
    await prisma.aiUsageEvent.deleteMany({
      where: { conversationId: { in: conversationIds } }
    })
    await prisma.message.deleteMany({
      where: { conversationId: { in: conversationIds } }
    })
    await prisma.conversation.deleteMany({
      where: { id: { in: conversationIds } }
    })
  }

  const normalizedPhone = qaPhone.replace(/\D/g, '')
  const customers = await prisma.customer.findMany({
    where: {
      businessId,
      OR: [
        { phone: qaPhone },
        { phone: normalizedPhone },
        { normalizedPhone }
      ]
    },
    select: { id: true }
  })
  const customerIds = customers.map((customer) => customer.id)
  if (!customerIds.length) return

  const appointments = await prisma.appointment.findMany({
    where: { customerId: { in: customerIds } },
    select: { id: true }
  })
  const appointmentIds = appointments.map((appointment) => appointment.id)
  if (appointmentIds.length) {
    await prisma.bookingDeposit.deleteMany({ where: { appointmentId: { in: appointmentIds } } })
    await prisma.aiUsageEvent.deleteMany({ where: { appointmentId: { in: appointmentIds } } })
    await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } })
  }
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
}

main().catch(async (error) => {
  console.error(error)
  await prisma.$disconnect()
  process.exit(1)
})

function requiredBusinessSlug() {
  const value = process.env.QA_BUSINESS_SLUG?.trim()
  if (!value) {
    throw new Error('Indicá explícitamente QA_BUSINESS_SLUG antes de reproducir conversaciones.')
  }
  return value
}
