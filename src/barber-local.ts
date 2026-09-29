import { pathToFileURL } from 'node:url'
import { prisma } from './config/prisma.js'
import { createPrismaIngressClient } from './config/prisma-ingress.js'
import { resolveBotOptionsConfig } from './config/bot-options.js'
import { resolveWhatsAppConversationAi } from './conversational-bot/whatsapp-ai.js'
import { PrismaAuthoritativeAdmissionRepository } from './bot-options/infrastructure/prisma-admission.js'
import { MetaOutboxProvider } from './bot-options/infrastructure/meta-outbox-provider.js'
import { reconcileActions } from './bot-options/application/reconcile-actions.js'
import { processSessionJob } from './bot-options/application/process-session-job.js'
import { processProviderEventJob } from './bot-options/application/process-provider-event-job.js'
import { expireDepositHold } from './bot-options/application/expire-deposit-hold.js'
import { processDepositProofJob } from './bot-options/application/process-deposit-proof-job.js'
import { bridgeDepositNotificationJob } from './bot-options/application/bridge-deposit-notification-job.js'
import type { ClaimedBotJob } from './bot-options/infrastructure/postgres-worker.js'
import { BARBER_DEMO_BUSINESS_ID, createBarberWebhookApps } from './barber-local/ingress.js'
import { startBarberWorkerLoops, validateBarberLocalConfig } from './barber-local/runtime.js'

function port(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error('Invalid Barber local port')
  return parsed
}

/** Starts only Barber ingress, its scoped worker/sender, and a path-restricted gateway. */
export async function startBarberLocal() {
  const { scope, verifyToken } = validateBarberLocalConfig(process.env)
  const internalPort = port(process.env.BARBER_INTERNAL_PORT, 3311)
  const gatewayPort = port(process.env.BARBER_GATEWAY_PORT, 3312)
  if (internalPort === gatewayPort) throw new Error('Barber gateway and internal ports must differ')
  const botOptionsConfig = resolveBotOptionsConfig(process.env)
  const conversationalAi = resolveWhatsAppConversationAi(process.env)
  if (!conversationalAi) throw new Error('Barber WhatsApp AI unavailable')
  conversationalAi.onDiagnostic = (diagnostic) => {
    console.info('[barber-local-conversation-latency]', JSON.stringify(diagnostic))
  }

  const ingressClient = createPrismaIngressClient()
  const repository = new PrismaAuthoritativeAdmissionRepository(ingressClient, {
    depositProofIngressEnabled: botOptionsConfig.depositsCapabilityEnabled
  })
  const { internal, gateway } = await createBarberWebhookApps({ repository, verifyToken })
  const handler = async (job: ClaimedBotJob) => {
    if (job.businessId !== BARBER_DEMO_BUSINESS_ID) throw new Error('non-Barber local job denied')
    if (job.kind === 'PROCESS_PROVIDER_EVENT') {
      await processProviderEventJob({
        client: prisma, job, depositProofIngressEnabled: botOptionsConfig.depositsCapabilityEnabled
      })
      return
    }
    if (job.kind === 'RECONCILE_PROMPT') { await reconcileActions(prisma, job); return }
    if (job.kind === 'EXPIRE_DEPOSIT') { await expireDepositHold(prisma, job); return }
    if (job.kind === 'RECEIVE_DEPOSIT_PROOF') {
      await processDepositProofJob({ client: prisma, job, capabilityEnabled: botOptionsConfig.depositsCapabilityEnabled })
      return
    }
    if (job.kind === 'BRIDGE_DEPOSIT_NOTIFICATION') { await bridgeDepositNotificationJob(prisma, job); return }
    await processSessionJob({ client: prisma, job, conversationalAi })
  }

  let loops: ReturnType<typeof startBarberWorkerLoops> | null = null
  let stopping: Promise<void> | null = null
  const stop = () => {
    if (stopping) return stopping
    stopping = (async () => {
      await gateway.close()
      await loops?.stop()
      await internal.close()
      await Promise.all([ingressClient.$disconnect(), prisma.$disconnect()])
    })()
    return stopping
  }
  try {
    await internal.listen({ port: internalPort, host: '127.0.0.1' })
    loops = startBarberWorkerLoops({
      scope, client: prisma, provider: new MetaOutboxProvider(), handle: handler,
      onError: (error) => internal.log.error(error),
      onWorkerDiagnostic: (diagnostic) => {
        console.info('[barber-local-job-latency]', JSON.stringify(diagnostic))
      },
      onOutboxDiagnostic: (diagnostic) => {
        console.info('[barber-local-outbox-latency]', JSON.stringify(diagnostic))
      }
    })
    await gateway.listen({ port: gatewayPort, host: '127.0.0.1' })
    console.info('Barber local webhook gateway ready on loopback')
    return { stop, internalPort, gatewayPort }
  } catch (error) {
    await stop()
    throw error
  }
}

const entrypointPath = process.argv[1]
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  startBarberLocal().then(({ stop }) => {
    const shutdown = () => { void stop().then(() => { process.exitCode = 0 }) }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  }).catch(() => {
    console.error('Barber local startup failed; no public gateway is serving')
    process.exitCode = 1
  })
}
