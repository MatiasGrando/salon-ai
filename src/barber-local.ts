import { createBoundedDiagnosticSink } from './bot-options/observability/bounded-diagnostic-sink.js'
import { createBarberTypingIndicator } from './barber-local/typing-indicator.js'
import { createQueueMilestoneTracker } from './bot-options/observability/queue-milestones.js'
import { enablePrismaClientDiagnostics } from './config/prisma-client.js'
import { createProviderDiagnosticProbe } from './bot-options/observability/provider-diagnostic-probe.js'
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
import { createWorkerWakeSignal, notifyWorkerWake } from './bot-options/infrastructure/worker-wake.js'

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
  const diagnosticSink = createBoundedDiagnosticSink()
  conversationalAi.onDiagnostic = (diagnostic) => {
    diagnosticSink.emit('barber-local-conversation-latency', diagnostic)
  }

  const ingressClient = createPrismaIngressClient()
  const providerDiagnosticProbe = createProviderDiagnosticProbe({
    emitAttempt: event => { diagnosticSink.emit('bot-options-attempt-stage', event) },
    emitPool: event => { diagnosticSink.emit('barber-local-pool-latency', event) },
    emitSummary: event => { diagnosticSink.emit('barber-local-provider-sink-cost', event) }
  })
  const emitPoolDiagnostic = providerDiagnosticProbe.emitPool
  if (!enablePrismaClientDiagnostics(prisma, { role: 'worker', emit: emitPoolDiagnostic })
    || !enablePrismaClientDiagnostics(ingressClient, { role: 'ingress', emit: emitPoolDiagnostic })) {
    await diagnosticSink.stop()
    await ingressClient.$disconnect()
    throw new Error('Barber pool diagnostics require unused clients')
  }
  const queueMilestones = createQueueMilestoneTracker({ businessId: BARBER_DEMO_BUSINESS_ID, monotonicBoundaries: true,
    emit: diagnostic => { diagnosticSink.emit('barber-local-queue-milestones', diagnostic) }
  })
  const repository = new PrismaAuthoritativeAdmissionRepository(ingressClient, {
    depositProofIngressEnabled: botOptionsConfig.depositsCapabilityEnabled, queueMilestones
  })
  const wakeSignals = { jobs: createWorkerWakeSignal(), outbox: createWorkerWakeSignal() }
  const { internal, gateway } = await createBarberWebhookApps({
    repository, verifyToken, onAdmissionCommitted: () => notifyWorkerWake(wakeSignals.jobs)
  })
  const typingIndicator = createBarberTypingIndicator({ onDiagnostic: event => { diagnosticSink.emit('barber-local-presence', event) } })
  const handler = async (job: ClaimedBotJob) => {
    if (job.businessId !== BARBER_DEMO_BUSINESS_ID) throw new Error('non-Barber local job denied')
    if (job.kind === 'PROCESS_PROVIDER_EVENT') {
      await providerDiagnosticProbe.run({ jobId: job.id, attempt: job.attempts }, () => processProviderEventJob({ client: prisma, job, depositProofIngressEnabled: botOptionsConfig.depositsCapabilityEnabled, queueMilestones }))
      return
    }
    if (job.kind === 'RECONCILE_PROMPT') { await reconcileActions(prisma, job); return }
    if (job.kind === 'EXPIRE_DEPOSIT') { await expireDepositHold(prisma, job); return }
    if (job.kind === 'RECEIVE_DEPOSIT_PROOF') {
      const outcome = await processDepositProofJob({ client: prisma, job, capabilityEnabled: botOptionsConfig.depositsCapabilityEnabled,
        onDiagnostic: value => { diagnosticSink.emit('barber-local-deposit-proof', value) } })
      diagnosticSink.emit('barber-local-deposit-proof', { outcome })
      return
    }
    if (job.kind === 'BRIDGE_DEPOSIT_NOTIFICATION') { await bridgeDepositNotificationJob(prisma, job); return }
    await processSessionJob({ client: prisma, job, conversationalAi, queueMilestones, onPreparingReply: typingIndicator.notify, onInboundConsumed: typingIndicator.consume,
      onAttemptDiagnostic: event => { diagnosticSink.emit('bot-options-attempt-stage', event) } })
  }

  let loops: Awaited<ReturnType<typeof startBarberWorkerLoops>> | null = null
  let stopping: Promise<void> | null = null
  const stop = () => {
    if (stopping) return stopping
    typingIndicator.stop()
    stopping = (async () => {
      await gateway.close()
      await loops?.stop()
      await internal.close()
      await diagnosticSink.stop()
      await Promise.all([ingressClient.$disconnect(), prisma.$disconnect()])
    })()
    return stopping
  }
  try {
    await internal.listen({ port: internalPort, host: '127.0.0.1' })
    loops = await startBarberWorkerLoops({
      scope, client: prisma, provider: new MetaOutboxProvider({ monotonicBoundaries: true }), handle: handler, wakeSignals, queueMilestones, monotonicBoundaries: true,
      onError: (error) => internal.log.error(error),
      onWorkerDiagnostic: (diagnostic) => {
        diagnosticSink.emit('barber-local-job-latency', diagnostic)
      },
      onOutboxDiagnostic: (diagnostic) => {
        diagnosticSink.emit('barber-local-outbox-latency', diagnostic)
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
