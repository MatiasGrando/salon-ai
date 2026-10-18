import { prisma } from '../config/prisma.js'
import {
  assertActivatableConfiguration,
  resumeDispatchScope,
  startActivationPreflight,
  switchPausedRouting,
  type DispatchPauseHandle
} from '../bot-options/infrastructure/prisma-activation.js'
import { attestLegacyDispatchCoverage } from '../bot-options/infrastructure/prisma-activation.js'
import { BOT_OPTIONS_ENGINE_KEY } from '../bot-options/domain/actions.js'
import { Prisma } from '../generated/prisma/client.js'

export type BusinessBotVariant = 'options' | 'conversational'
export type BusinessBotRoutingTarget = string
const conversationMarker = { schemaVersion: 1, engine: 'conversational-booking-v1' } as const
// Separate from both historical deterministic-options and the pilot keys.
const commercialKeys = { options: 'commercial-options-v1', conversational: 'commercial-conversational-v1' } as const
const configurationSelect = { id: true, businessId: true, botKey: true, name: true, version: true, mode: true, status: true, channel: true,
  routingMode: true, phoneNumberId: true, displayPhoneNumber: true, definition: true } as const

type Configuration = { id: string; businessId: string; name: string; version: string; mode: string; status: string; routingMode: string;
  phoneNumberId: string | null; displayPhoneNumber: string | null; definition: unknown }
function variantOf(configuration: Configuration): BusinessBotVariant | null {
  const value = configuration.definition
  if (!value || typeof value !== 'object' || Array.isArray(value) || configuration.mode !== 'OPTIONS_ONLY' || configuration.status !== 'ACTIVE' || configuration.routingMode !== 'EXCLUSIVE') return null
  const definition = value as Record<string, unknown>
  if (definition.schemaVersion !== 1 || definition.engineKey !== BOT_OPTIONS_ENGINE_KEY) return null
  if (!Object.hasOwn(definition, 'conversation')) return 'options'
  const marker = definition.conversation
  return marker && typeof marker === 'object' && !Array.isArray(marker) && Object.keys(marker).sort().join(',') === 'engine,schemaVersion'
    && (marker as typeof conversationMarker).schemaVersion === 1 && (marker as typeof conversationMarker).engine === conversationMarker.engine ? 'conversational' : null
}
function configurationSummary(configuration: Configuration) {
  return { id: configuration.id, name: configuration.name, version: configuration.version, variant: variantOf(configuration)! }
}
function conversationAiReady() {
  // Match the existing WhatsApp provider's own opt-in; QA/legacy flags cannot enable it.
  return process.env.CONVERSATIONAL_WHATSAPP_AI_ENABLED === 'true' && Boolean(process.env.OPENAI_API_KEY?.trim())
}
async function assertCommercialTarget(businessId: string, target: string) {
  if (target === 'legacy-whatsapp') throw new Error('El bot heredado ya no está disponible para nuevas selecciones')
  const configuration = await prisma.businessBotConfiguration.findFirst({ where: { id: target, businessId }, select: configurationSelect })
  const variant = configuration && variantOf(configuration)
  if (!configuration || !variant) throw new Error('La configuración seleccionada no corresponde a un bot comercial preparado')
  if (variant === 'conversational' && !conversationAiReady()) throw new Error('El Nuevo bot requiere la IA de WhatsApp habilitada y configurada en el servidor')
  return variant
}

export const businessBotRoutingService = {
  async state(input: { businessId: string }) {
    const [pointer, configurations, audits, whatsapp, settings] = await Promise.all([
      prisma.botChannelDeployment.findUnique({
        where: { businessId_channel: { businessId: input.businessId, channel: 'WHATSAPP' } },
        select: { id: true, engineKey: true, activeConfigurationId: true, generation: true, claimsPausedAt: true }
      }),
      prisma.businessBotConfiguration.findMany({
        where: { businessId: input.businessId, status: 'ACTIVE', routingMode: 'EXCLUSIVE' },
        select: configurationSelect,
        orderBy: [{ name: 'asc' }, { version: 'asc' }]
      }),
      prisma.botDeploymentAudit.findMany({
        where: { businessId: input.businessId },
        select: { id: true, action: true, generation: true, actorUserId: true, detail: true, createdAt: true },
        orderBy: { createdAt: 'desc' }, take: 20
      }),
      prisma.businessWhatsAppConfig.findUnique({
        where: { businessId: input.businessId },
        select: { connectionStatus: true, phoneNumberId: true, displayPhoneNumber: true, accessToken: true, wabaId: true, appSecret: true }
      }),
      prisma.businessBotOptionsSettings.findUnique({ where: { businessId: input.businessId }, select: { timezone: true } })
    ])
    const available = configurations.filter(configuration => variantOf(configuration) !== null)
    const active = available.find(configuration => configuration.id === pointer?.activeConfigurationId)
    return {
      businessId: input.businessId,
      deploymentId: pointer?.id ?? null,
      engineKey: pointer?.engineKey ?? 'legacy-whatsapp',
      activeConfigurationId: pointer?.activeConfigurationId ?? null,
      activeVariant: pointer?.engineKey === BOT_OPTIONS_ENGINE_KEY && active ? variantOf(active) : null,
      generation: pointer?.generation ?? 0,
      paused: Boolean(pointer?.claimsPausedAt),
      configurations: available.map(configurationSummary),
      preparation: {
        hasAppSecret: Boolean(whatsapp?.appSecret), hasTimezone: Boolean(settings?.timezone), timezone: settings?.timezone ?? null,
        conversationalAiReady: conversationAiReady(),
        whatsappReady: whatsapp?.connectionStatus === 'CONNECTED' && Boolean(whatsapp.phoneNumberId && whatsapp.displayPhoneNumber && whatsapp.accessToken && whatsapp.wabaId),
        ready: whatsapp?.connectionStatus === 'CONNECTED' && Boolean(whatsapp.phoneNumberId && whatsapp.displayPhoneNumber && whatsapp.accessToken && whatsapp.wabaId && whatsapp.appSecret && settings?.timezone)
      }, audits
    }
  },

  async prepare(input: { businessId: string; timezone: string; actorId: string; variant?: BusinessBotVariant }) {
    const variant = input.variant ?? 'options'
    if (variant !== 'options' && variant !== 'conversational') throw new Error('Variante de bot inválida')
    assertIanaTimezone(input.timezone)
    const whatsapp = await prisma.businessWhatsAppConfig.findUnique({
      where: { businessId: input.businessId },
      select: { connectionStatus: true, phoneNumberId: true, displayPhoneNumber: true, accessToken: true, wabaId: true, appSecret: true }
    })
    if (whatsapp?.connectionStatus !== 'CONNECTED' || !whatsapp.phoneNumberId || !whatsapp.displayPhoneNumber || !whatsapp.accessToken || !whatsapp.wabaId) throw new Error('WhatsApp debe estar conectado completamente antes de preparar el bot')
    if (!whatsapp.appSecret) throw new Error('Guardá el App Secret de Meta antes de preparar el bot')

    return prisma.$transaction(async tx => {
      // Share the existing F11 lock, so preparation never races a cutover.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bot-cutover:${input.businessId}:WHATSAPP`}, 0))`)
      const pointer = await tx.botChannelDeployment.findUnique({ where: { businessId_channel: { businessId: input.businessId, channel: 'WHATSAPP' } }, select: { activeConfigurationId: true, claimsPausedAt: true } })
      if (pointer?.claimsPausedAt) throw new Error('El bot está pausado para un cambio; resolvé esa operación antes de preparar otra configuración')
      const configurations = await tx.businessBotConfiguration.findMany({ where: { businessId: input.businessId, status: 'ACTIVE', routingMode: 'EXCLUSIVE' }, select: configurationSelect, orderBy: [{ name: 'asc' }, { version: 'asc' }] })
      const keyed = await tx.businessBotConfiguration.findUnique({ where: { businessId_botKey: { businessId: input.businessId, botKey: commercialKeys[variant] } }, select: configurationSelect })
      if (keyed && variantOf(keyed) !== variant) throw new Error('La configuración comercial existente no coincide con la variante solicitada; no se modificó')
      const active = configurations.find(configuration => configuration.id === pointer?.activeConfigurationId)
      const candidate = active && variantOf(active) === variant ? active : keyed ?? configurations.find(configuration => variantOf(configuration) === variant)
      if (candidate && (candidate.phoneNumberId !== whatsapp.phoneNumberId || candidate.displayPhoneNumber !== whatsapp.displayPhoneNumber)) throw new Error('La configuración existente no coincide con el teléfono conectado; revisala antes de continuar')
      await tx.businessBotOptionsSettings.upsert({ where: { businessId: input.businessId }, create: { businessId: input.businessId, timezone: input.timezone }, update: { timezone: input.timezone } })
      if (candidate) return configurationSummary(candidate)
      const source = active && variantOf(active) ? active : configurations.find(configuration => variantOf(configuration))
      const definition = { ...(source?.definition as Record<string, Prisma.InputJsonValue> | undefined ?? { schemaVersion: 1, engineKey: BOT_OPTIONS_ENGINE_KEY }) }
      delete definition.conversation
      if (variant === 'conversational') definition.conversation = conversationMarker
      const created = await tx.businessBotConfiguration.create({
        data: {
          businessId: input.businessId, botKey: commercialKeys[variant], name: variant === 'options' ? 'Bot de opciones' : 'Nuevo bot',
          version: 'v1', mode: 'OPTIONS_ONLY', status: 'ACTIVE', channel: 'UNASSIGNED', routingMode: 'EXCLUSIVE',
          phoneNumberId: whatsapp.phoneNumberId, displayPhoneNumber: whatsapp.displayPhoneNumber,
          definition: definition as Prisma.InputJsonValue
        }, select: configurationSelect
      })
      return configurationSummary(created)
    })
  },

  async preflight(input: { businessId: string; expectedGeneration: number; target: BusinessBotRoutingTarget; actorId: string }) {
    await assertCommercialTarget(input.businessId, input.target)
    await assertActivatableConfiguration({ client: prisma, businessId: input.businessId, configurationId: input.target })
    await attestLegacyDispatchCoverage({ client: prisma, businessId: input.businessId, actorId: input.actorId, protocolVersion: 1 })
    const result = await startActivationPreflight({ client: prisma, businessId: input.businessId, expectedGeneration: input.expectedGeneration, actorId: input.actorId, legacyCoverageComplete: true })
    return { ...result, targetConfigurationId: input.target }
  },

  async commit(input: { businessId: string; target: BusinessBotRoutingTarget; handle: DispatchPauseHandle; actorId: string }) {
    if (input.handle.businessId !== input.businessId) throw new Error('routing handle belongs to another business')
    await assertCommercialTarget(input.businessId, input.target)
    await assertActivatableConfiguration({ client: prisma, businessId: input.businessId, configurationId: input.target })
    return switchPausedRouting({ client: prisma, handle: input.handle, actorId: input.actorId, action: 'ACTIVATE', targetConfigurationId: input.target })
  },

  async abort(input: { businessId: string; handle: DispatchPauseHandle; actorId: string }) {
    if (input.handle.businessId !== input.businessId) throw new Error('routing handle belongs to another business')
    await resumeDispatchScope({ client: prisma, handle: input.handle, actorId: input.actorId })
  }
}
export type BusinessBotRoutingService = typeof businessBotRoutingService
function assertIanaTimezone(timezone: string) {
  const normalized = timezone.trim()
  if (!normalized || normalized.length > 100) throw new Error('Zona horaria inválida')
  try { new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date()) }
  catch { throw new Error('Zona horaria inválida') }
}
