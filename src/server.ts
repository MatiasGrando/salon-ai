import Fastify from 'fastify'
import { pathToFileURL } from 'node:url'
import { healthRoutes } from './routes/health.js'
import { businessRoutes } from './routes/business.js'
import { professionalRoutes } from './routes/professional.js'
import { serviceRoutes } from './routes/service.js'
import { customerRoutes } from './routes/customer.js'
import { appointmentRoutes } from './routes/appointment.js'
import { businessHoursRoutes } from './routes/business-hours.js'
import { professionalHoursRoutes } from './routes/professional-hours.js'
import { availabilityRoutes } from './routes/availability.js'
import { chatRoutes } from './routes/chat.js'
import { crmRoutes } from './routes/crm.js'
import { crmUiRoutes } from './routes/crm-ui.js'
import { landingUiRoutes } from './routes/landing-ui.js'
import { tamaraSiteRoutes } from './routes/tamara-site.js'
import { publicBookingRoutes } from './routes/public-booking.js'
import { weexAccountRoutes } from './routes/weex-account.js'
import { scheduleBlockRoutes } from './routes/schedule-block.js'
import { whatsappWebhookRoutes } from './routes/whatsapp-webhook.js'
import { instagramWebhookRoutes } from './routes/instagram-webhook.js'
import { instagramSettingsRoutes } from './routes/instagram-settings.js'
import { campaignRoutes } from './routes/campaign.js'
import { reportRoutes } from './routes/report.js'
import { authRoutes } from './routes/auth.js'
import { accountManagementRoutes } from './routes/account-management.js'
import { staffUserRoutes } from './routes/staff-user.js'
import { postSaleRoutes } from './routes/post-sale.js'
import { weexLeadAdminRoutes, weexLeadCampaignRoutes } from './routes/weex-lead-campaign.js'
import { weexSupportBotV1Routes } from './routes/weex-support-bot-v1.js'
import { demoProfileRoutes } from './routes/demo-profile.js'
import { authGuard } from './plugins/auth-guard.js'
import { ensureBootstrapSuperAdmin } from './services/auth-service.js'
import { startMarketingScheduler } from './services/marketing-scheduler.js'
import {
  createProductionAuthorizationProviders,
  installAuthorizationProviders,
  type BuildAppOptions as AuthorizationBuildAppOptions
} from './providers/authorization-providers.js'
import { resolveEgressBaselineConfig } from './config/egress-baseline.js'
import { installEgressBaseline } from './observability/egress-baseline/install.js'
import { resolveBotOptionsConfig, type BotOptionsConfig } from './config/bot-options.js'
import { createPrismaIngressClient } from './config/prisma-ingress.js'
import { PrismaAdmissionRepository } from './bot-options/infrastructure/prisma-admission.js'
import { PrismaAuthoritativeAdmissionRepository } from './bot-options/infrastructure/prisma-admission.js'
import {
  createAuthoritativeWebhookAdmission,
  createProviderEventAdmission,
  type AuthoritativeWebhookAdmission,
  type ProviderEventAdmission
} from './bot-options/application/admit-provider-events.js'
import type { WhatsAppWebhookServiceContract } from './routes/whatsapp-webhook.js'
import { prisma } from './config/prisma.js'
import { startPostgresWorkerLoop, type WorkerLoop } from './bot-options/infrastructure/postgres-worker.js'
import { reconcileActions } from './bot-options/application/reconcile-actions.js'
import { processSessionJob } from './bot-options/application/process-session-job.js'
import { startOutboxSenderLoop, type OutboxProvider } from './bot-options/infrastructure/whatsapp-outbox-sender.js'
import { MetaOutboxProvider } from './bot-options/infrastructure/meta-outbox-provider.js'
import { startBotOptionsMetricsLoop } from './bot-options/observability/metrics.js'

process.env.TZ ??= 'America/Argentina/Buenos_Aires'

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

export type BuildAppOptions = AuthorizationBuildAppOptions & {
  botOptionsConfig?: BotOptionsConfig
  shadowAdmission?: ProviderEventAdmission
  authoritativeAdmission?: AuthoritativeWebhookAdmission
  legacyWhatsappWebhookService?: WhatsAppWebhookServiceContract
  outboxProvider?: OutboxProvider
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    bodyLimit: 5 * 1024 * 1024
  })
  const baseline = installEgressBaseline(app, resolveEgressBaselineConfig(process.env))
  installAuthorizationProviders(app, options)
  const botOptionsConfig = options.botOptionsConfig ?? resolveBotOptionsConfig(process.env)
  let shadowAdmission = options.shadowAdmission
  let authoritativeAdmission = options.authoritativeAdmission

  if ((botOptionsConfig.shadowAdmissionEnabled && !shadowAdmission) || (botOptionsConfig.authoritativeProcessingEnabled && !authoritativeAdmission)) {
    const ingressPrisma = createPrismaIngressClient()
    if (botOptionsConfig.shadowAdmissionEnabled && !shadowAdmission) {
      shadowAdmission = createProviderEventAdmission(new PrismaAdmissionRepository(ingressPrisma), app.clock)
    }
    if (botOptionsConfig.authoritativeProcessingEnabled && !authoritativeAdmission) {
      authoritativeAdmission = createAuthoritativeWebhookAdmission(new PrismaAuthoritativeAdmissionRepository(ingressPrisma), app.clock)
    }
    app.addHook('onClose', async () => {
      await ingressPrisma.$disconnect()
    })
  }

  await app.register(healthRoutes)
  await app.register(authRoutes)
  await app.register(crmUiRoutes, { pollingMarker: baseline.pollingMarker })
  await app.register(tamaraSiteRoutes)
  await app.register(landingUiRoutes)
  await app.register(publicBookingRoutes)
  await app.register(weexAccountRoutes)
  await app.register(weexLeadCampaignRoutes)
  await app.register(weexSupportBotV1Routes)
  await app.register(whatsappWebhookRoutes, {
    botOptionsConfig,
    ...(shadowAdmission ? { shadowAdmission } : {}),
    ...(authoritativeAdmission ? { authoritativeAdmission } : {}),
    ...(options.legacyWhatsappWebhookService
      ? { legacyWebhookService: options.legacyWhatsappWebhookService }
      : {})
  })
  await app.register(instagramWebhookRoutes)
  await authGuard(app)
  await app.register(accountManagementRoutes)
  await app.register(businessRoutes)
  await app.register(instagramSettingsRoutes)
  await app.register(professionalRoutes)
  await app.register(serviceRoutes)
  await app.register(customerRoutes)
  await app.register(appointmentRoutes)
  await app.register(businessHoursRoutes)
  await app.register(professionalHoursRoutes)
  await app.register(scheduleBlockRoutes)
  await app.register(availabilityRoutes)
  await app.register(chatRoutes)
  await app.register(crmRoutes, { sseRecorder: baseline.sseRecorder })
  await app.register(campaignRoutes)
  await app.register(postSaleRoutes)
  await app.register(reportRoutes)
  await app.register(staffUserRoutes)
  await app.register(demoProfileRoutes)
  await app.register(weexLeadAdminRoutes)

  const loops: WorkerLoop[] = []
  if (botOptionsConfig.workersEnabled) {
    const handler = async (job: Parameters<typeof processSessionJob>[0]['job']) => {
      if (job.kind === 'RECONCILE_PROMPT') {
        await reconcileActions(prisma, job)
        return
      }
      await processSessionJob({ client: prisma, job })
    }
    loops.push(startPostgresWorkerLoop({ client: prisma, handle: handler, onError: (error) => app.log.error(error) }))
    loops.push(startPostgresWorkerLoop({ client: prisma, handle: handler, onError: (error) => app.log.error(error) }))
  }
  if (botOptionsConfig.senderEnabled) {
    const provider = options.outboxProvider ?? new MetaOutboxProvider()
    loops.push(startOutboxSenderLoop({
      client: prisma,
      provider,
      onError: (error) => app.log.error(error)
    }))
  }
  if (loops.length > 0) {
    app.addHook('onClose', async () => { await Promise.all(loops.map((loop) => loop.stop())) })
  }
  if (botOptionsConfig.authoritativeProcessingEnabled) {
    const metricsLoop = startBotOptionsMetricsLoop({
      client: prisma,
      publish: (snapshot) => {
        const log = snapshot.alerts.length > 0 ? app.log.warn.bind(app.log) : app.log.info.bind(app.log)
        log({ botOptionsMetrics: snapshot }, 'bot-options operational metrics')
      }
    })
    app.addHook('onClose', async () => { metricsLoop.stop() })
  }

  return app
}

async function startServer() {
  const app = await buildApp({
    authorizationProviders: createProductionAuthorizationProviders()
  })
  await ensureBootstrapSuperAdmin()
  startMarketingScheduler(app)

  if (process.env.NODE_ENV !== 'production') {
    console.log(app.printRoutes())
  }

  const address = await app.listen({ port, host })
  console.log(`Servidor iniciado en ${address}`)
}

const entrypointPath = process.argv[1]
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  startServer().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
