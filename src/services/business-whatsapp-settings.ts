import { prisma } from '../config/prisma.js'
import { whatsappConfig } from '../config/whatsapp.js'

export type WhatsAppCloudCredentials = {
  accessToken?: string
  phoneNumberId?: string
  businessAccountId?: string
  appId?: string
  apiVersion: string
  phoneNumberMode: string
}

type SendPurpose = 'CAMPAIGN' | 'REMINDER' | 'TEST' | 'BOT' | 'TEMPLATE'

export async function getBusinessWhatsAppState(businessId: string) {
  const [config, settings, business] = await Promise.all([
    prisma.businessWhatsAppConfig.findUnique({ where: { businessId } }),
    prisma.businessFeatureSettings.findUnique({ where: { businessId } }),
    prisma.business.findUnique({ where: { id: businessId }, select: { id: true, botEnabled: true, aiEnabled: true } })
  ])

  const hasBusinessCredentials = Boolean(config?.accessToken && config.phoneNumberId && config.wabaId)
  const hasEnvCredentials = Boolean(whatsappConfig.accessToken && whatsappConfig.phoneNumberId && whatsappConfig.businessAccountId)
  const usingInternalFallback = whatsappConfig.allowInternalFallback && !hasBusinessCredentials && hasEnvCredentials
  const storedConnectionStatus = config?.connectionStatus ?? 'NOT_CONNECTED'
  const connectionStatus = usingInternalFallback
    ? 'CONNECTED'
    : hasBusinessCredentials
    ? storedConnectionStatus
    : storedConnectionStatus === 'CONNECTED'
    ? 'CONNECTING'
    : storedConnectionStatus
  const mode = usingInternalFallback ? 'INTERNAL_TEST' : (config?.mode ?? 'CLIENT_OWNED')
  const billingOwner = usingInternalFallback ? 'SALON_AI' : (settings?.billingOwner ?? 'CLIENT')
  const realWhatsappEnabled = usingInternalFallback ? true : Boolean(settings?.realWhatsappEnabled)

  const baseReasons: string[] = []
  if (!business) baseReasons.push('No encontre el comercio.')
  if (!hasBusinessCredentials && !usingInternalFallback) baseReasons.push('WhatsApp todavia no esta conectado.')
  if (connectionStatus !== 'CONNECTED') baseReasons.push(connectionStatusReason(connectionStatus))
  if (!realWhatsappEnabled) baseReasons.push('Los envios reales de WhatsApp estan desactivados para este comercio.')
  if (config?.lastError) baseReasons.push(config.lastError)

  const campaignsLocked = Boolean(settings?.campaignSendingLocked) || !settings?.campaignsEnabled
  const remindersLocked = Boolean(settings?.reminderSendingLocked) || !settings?.remindersEnabled

  return {
    config,
    settings: {
      botEnabled: business?.botEnabled ?? settings?.botEnabled ?? true,
      aiEnabled: business?.aiEnabled ?? settings?.aiEnabled ?? true,
      campaignsEnabled: Boolean(settings?.campaignsEnabled),
      remindersEnabled: Boolean(settings?.remindersEnabled),
      realWhatsappEnabled,
      billingOwner,
      campaignSendingLocked: campaignsLocked,
      reminderSendingLocked: remindersLocked
    },
    connection: {
      status: connectionStatus,
      mode,
      displayPhoneNumber: config?.displayPhoneNumber ?? null,
      wabaId: config?.wabaId ?? null,
      phoneNumberId: config?.phoneNumberId ?? null,
      connectedAt: config?.connectedAt ?? null,
      tokenExpiresAt: config?.tokenExpiresAt ?? null,
      lastError: config?.lastError ?? null,
      usingInternalFallback
    },
    gates: {
      canSendTests: baseReasons.length === 0,
      canCreateTemplates: baseReasons.length === 0,
      canSendCampaigns: baseReasons.length === 0 && !campaignsLocked && billingOwner === 'CLIENT',
      canSendReminders: baseReasons.length === 0 && !remindersLocked,
      canSendBotReplies: baseReasons.length === 0 && (business?.botEnabled ?? settings?.botEnabled ?? true)
    },
    reasons: {
      base: baseReasons,
      campaigns: [
        ...baseReasons,
        ...(!settings?.campaignsEnabled ? ['Las campanas estan desactivadas para este comercio.'] : []),
        ...(settings?.campaignSendingLocked ? ['Las campanas reales estan bloqueadas hasta completar la conexion de WhatsApp.'] : []),
        ...(billingOwner === 'SALON_AI' ? ['Las campanas masivas no pueden salir con la cuenta interna de Salon AI.'] : [])
      ],
      reminders: [
        ...baseReasons,
        ...(!settings?.remindersEnabled ? ['Los recordatorios estan desactivados para este comercio.'] : []),
        ...(settings?.reminderSendingLocked ? ['Los recordatorios reales estan bloqueados hasta completar la conexion de WhatsApp.'] : [])
      ]
    }
  }
}

export async function resolveBusinessWhatsAppCredentials(businessId?: string | null): Promise<WhatsAppCloudCredentials> {
  if (!businessId) return whatsappConfig.allowInternalFallback ? envCredentials() : emptyCredentials()
  const config = await prisma.businessWhatsAppConfig.findUnique({ where: { businessId } })
  if (config?.accessToken && config.phoneNumberId) {
    const appId = config.metaAppId ?? whatsappConfig.appId
    return {
      accessToken: config.accessToken,
      phoneNumberId: config.phoneNumberId,
      apiVersion: whatsappConfig.apiVersion,
      phoneNumberMode: whatsappConfig.phoneNumberMode,
      ...(config.wabaId ? { businessAccountId: config.wabaId } : {}),
      ...(appId ? { appId } : {})
    }
  }
  return whatsappConfig.allowInternalFallback ? envCredentials() : emptyCredentials()
}

export async function assertBusinessCanSendWhatsApp(businessId: string, purpose: SendPurpose) {
  const state = await getBusinessWhatsAppState(businessId)
  const reasons = purpose === 'CAMPAIGN'
    ? state.reasons.campaigns
    : purpose === 'REMINDER'
    ? state.reasons.reminders
    : state.reasons.base
  const allowed = purpose === 'CAMPAIGN'
    ? state.gates.canSendCampaigns
    : purpose === 'REMINDER'
    ? state.gates.canSendReminders
    : purpose === 'BOT'
    ? state.gates.canSendBotReplies
    : purpose === 'TEMPLATE'
    ? state.gates.canCreateTemplates
    : state.gates.canSendTests

  return allowed
    ? { allowed: true as const, state }
    : { allowed: false as const, state, message: firstReason(reasons) }
}

function envCredentials(): WhatsAppCloudCredentials {
  return {
    apiVersion: whatsappConfig.apiVersion,
    phoneNumberMode: whatsappConfig.phoneNumberMode,
    ...(whatsappConfig.accessToken ? { accessToken: whatsappConfig.accessToken } : {}),
    ...(whatsappConfig.phoneNumberId ? { phoneNumberId: whatsappConfig.phoneNumberId } : {}),
    ...(whatsappConfig.businessAccountId ? { businessAccountId: whatsappConfig.businessAccountId } : {}),
    ...(whatsappConfig.appId ? { appId: whatsappConfig.appId } : {})
  }
}

function emptyCredentials(): WhatsAppCloudCredentials {
  return {
    apiVersion: whatsappConfig.apiVersion,
    phoneNumberMode: whatsappConfig.phoneNumberMode
  }
}

function firstReason(reasons: string[]) {
  return reasons.find(Boolean) || 'WhatsApp no esta listo para enviar mensajes reales.'
}

function connectionStatusReason(status: string) {
  if (status === 'NEEDS_PAYMENT') return 'Meta requiere medio de pago antes de enviar mensajes reales.'
  if (status === 'NEEDS_REVIEW') return 'Meta requiere completar la revision de la cuenta.'
  if (status === 'CONNECTING') return 'La conexion de WhatsApp todavia esta en proceso.'
  if (status === 'ERROR') return 'La conexion de WhatsApp esta en error.'
  return 'WhatsApp todavia no esta conectado.'
}
