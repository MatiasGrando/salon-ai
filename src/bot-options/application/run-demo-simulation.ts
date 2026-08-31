import { createHmac, randomUUID } from 'node:crypto'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { createAuthoritativeWebhookAdmission } from './admit-provider-events.js'
import { PrismaAuthoritativeAdmissionRepository } from '../infrastructure/prisma-admission.js'

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

type DemoPayload = {
  to?: unknown
  item?: {
    body?: unknown
    buttons?: Array<{ id?: unknown; title?: unknown }>
    rows?: Array<{ id?: unknown; title?: unknown }>
  }
}

function transitionIdForInbox(inbox: {
  id: string
  sessionId: string | null
  expectedRevision: bigint | null
  error: string | null
}, transitionRevision: bigint | null) {
  if (!inbox.sessionId) return null
  if (inbox.error === 'EXISTING_SESSION_RESTARTED') return `restart:${inbox.sessionId}:${inbox.id}`
  if (inbox.error === 'EXISTING_SESSION_REPROMPTED') return `reprompt:${inbox.sessionId}:${inbox.id}`
  if (inbox.error === 'STALE_PROMPT_RECOVERED') return `stale-prompt:${inbox.sessionId}:${inbox.id}`
  if (transitionRevision !== null) return `transition:${inbox.sessionId}:${transitionRevision}`
  if (inbox.expectedRevision !== null) return `initial:${inbox.sessionId}:${inbox.expectedRevision}`
  return null
}

async function waitForReply(input: {
  client: PrismaClient
  businessId: string
  phone: string
  providerMessageId: string
}) {
  for (let index = 0; index < 60; index += 1) {
    await wait(500)
    const providerEvent = await input.client.botProviderEvent.findFirst({
      where: { businessId: input.businessId, providerMessageId: input.providerMessageId },
      select: { id: true }
    })
    if (!providerEvent) continue
    const inbox = await input.client.botActionInbox.findFirst({
      where: { businessId: input.businessId, providerEventId: providerEvent.id, status: 'PROCESSED' },
      select: { id: true, sessionId: true, expectedRevision: true, error: true }
    })
    if (!inbox) continue
    const transition = await input.client.botTransitionLog.findFirst({
      where: { businessId: input.businessId, providerEventId: providerEvent.id },
      select: { revisionTo: true }
    })
    const transitionId = transitionIdForInbox(inbox, transition?.revisionTo ?? null)
    if (!transitionId) continue
    const rows = await input.client.botOutbox.findMany({
      where: { businessId: input.businessId, sessionId: inbox.sessionId!, transitionId },
      orderBy: { sequence: 'asc' },
      select: { payload: true }
    })
    const payloads = rows.map((row) => row.payload as DemoPayload).filter((payload) => payload.to === input.phone)
    if (!payloads.length) continue
    const messages = payloads.flatMap((payload) => typeof payload.item?.body === 'string' ? [payload.item.body] : [])
    const replyButtons = payloads.flatMap((payload) => payload.item?.buttons ?? payload.item?.rows ?? [])
      .flatMap((option) => typeof option.id === 'string' && typeof option.title === 'string' ? [{ id: option.id, title: option.title }] : [])
    if (messages.length) return { reply: messages.join('\n\n'), replyButtons }
  }
  throw new Error('El bot nuevo no generó una respuesta')
}

export async function runDeterministicDemoSimulation(input: { client: PrismaClient; businessId: string; phone: string; message: string; interactiveReplyId?: string }) {
  const whatsapp = await input.client.businessWhatsAppConfig.findUnique({ where: { businessId: input.businessId }, select: { phoneNumberId: true, appSecret: true } })
  if (!whatsapp?.phoneNumberId || !whatsapp.appSecret) throw new Error('La demo del bot nuevo no está configurada')
  const messageId = `demo.${randomUUID()}`
  const event = input.interactiveReplyId
    ? { id: messageId, from: input.phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: input.interactiveReplyId, title: input.message } } }
    : { id: messageId, from: input.phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: input.message } }
  const rawBody = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: whatsapp.phoneNumberId }, messages: [event] } }] }] }), 'utf8')
  const signatureHeader = `sha256=${createHmac('sha256', whatsapp.appSecret).update(rawBody).digest('hex')}`
  const admission = createAuthoritativeWebhookAdmission(new PrismaAuthoritativeAdmissionRepository(input.client))
  const admitted = await admission.routeAndAdmit({ rawBody, signatureHeader, traceId: messageId })
  if (admitted.route !== 'new' || !['admitted', 'partial'].includes(admitted.outcome.status)) throw new Error('No se pudo ingresar el mensaje al bot nuevo')
  return waitForReply({ client: input.client, businessId: input.businessId, phone: input.phone, providerMessageId: messageId })
}
