import { resolveBotOptionsConfig } from '../config/bot-options.js'
import { parseWhatsAppLatencyDiagnosticBusinessCodes } from '../config/whatsapp.js'
import { botWorkerScopeFromEnv, type BotWorkerScope } from '../bot-options/infrastructure/tenant-scope.js'
import { startPostgresWorkerLoop } from '../bot-options/infrastructure/postgres-worker.js'
import { startOutboxSenderLoop } from '../bot-options/infrastructure/whatsapp-outbox-sender.js'
import { BARBER_DEMO_BUSINESS_ID } from './ingress.js'

type WorkerInput = Parameters<typeof startPostgresWorkerLoop>[0]
type SenderInput = Parameters<typeof startOutboxSenderLoop>[0]
type Loop = { stop(): Promise<void> }

export function validateBarberLocalConfig(env: Record<string, string | undefined>): {
  scope: BotWorkerScope
  verifyToken: string
} {
  const scope = botWorkerScopeFromEnv(env)
  if (scope?.mode !== 'include' || scope.businessId !== BARBER_DEMO_BUSINESS_ID) {
    throw new Error('Barber local requires BOT_WORKER_SCOPE_MODE=include and Barber BOT_WORKER_SCOPE_BUSINESS_ID')
  }
  const verifyToken = env.WHATSAPP_VERIFY_TOKEN?.trim()
  if (!verifyToken) throw new Error('WHATSAPP_VERIFY_TOKEN required for Barber local')
  if (!env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL required for Barber local')
  if (env.CONVERSATIONAL_WHATSAPP_AI_ENABLED !== 'true' || !env.OPENAI_API_KEY?.trim()) {
    throw new Error('WhatsApp AI must be configured for Barber local')
  }
  if (!parseWhatsAppLatencyDiagnosticBusinessCodes(env.WHATSAPP_LATENCY_DIAGNOSTIC_BUSINESS_CODES).has('WX-38N6UG')) {
    throw new Error('Barber latency diagnostics must be enabled')
  }
  const bot = resolveBotOptionsConfig(env)
  if (!bot.authoritativeProcessingEnabled || !bot.workersEnabled || !bot.senderEnabled || !bot.legacyDispatchCoverageComplete) {
    throw new Error('Barber local requires authoritative worker and sender flags')
  }
  return { scope, verifyToken }
}

/** Test seam: production injects real Prisma/provider/handler; scopes are never optional here. */
export async function startBarberWorkerLoops(input: {
  scope: BotWorkerScope
  client: WorkerInput['client'] & SenderInput['client']
  provider: SenderInput['provider']
  handle: WorkerInput['handle']
  onError?: (error: unknown) => void
  onWorkerDiagnostic?: WorkerInput['onDiagnostic']
  onOutboxDiagnostic?: SenderInput['onDiagnostic']
  startWorker?: (input: WorkerInput) => Loop
  startSender?: (input: SenderInput) => Loop
}): Promise<Loop> {
  if (input.scope.mode !== 'include' || input.scope.businessId !== BARBER_DEMO_BUSINESS_ID) {
    throw new Error('Barber worker scope must include Barber exclusively')
  }
  const worker = input.startWorker ?? startPostgresWorkerLoop
  const sender = input.startSender ?? startOutboxSenderLoop
  const sharedWorker = {
    client: input.client, handle: input.handle, handlerSettlesJob: true,
    scope: input.scope,
    ...(input.onError ? { onError: input.onError } : {}),
    ...(input.onWorkerDiagnostic ? { onDiagnostic: input.onWorkerDiagnostic } : {})
  }
  const loops: Loop[] = []
  try {
    loops.push(worker(sharedWorker))
    loops.push(worker({ ...sharedWorker, maintenanceEnabled: false }))
    loops.push(sender({
      client: input.client, provider: input.provider, scope: input.scope,
      ...(input.onError ? { onError: input.onError } : {}),
      ...(input.onOutboxDiagnostic ? { onDiagnostic: input.onOutboxDiagnostic } : {})
    }))
  } catch (error) {
    // A factory can throw after earlier loops have begun polling. Do not let
    // the caller disconnect Prisma until every started loop has stopped.
    await Promise.allSettled(loops.map((loop) => Promise.resolve().then(() => loop.stop())))
    throw error
  }
  return { async stop() { await Promise.all(loops.map((loop) => loop.stop())) } }
}
