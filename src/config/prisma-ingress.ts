import 'dotenv/config'
import { createPrismaClient } from './prisma-client.js'

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>

export function createPrismaIngressClient(env: Env = process.env) {
  const connectionString = env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL no está configurada')
  }

  const configuredPoolMax = Number(env.DATABASE_INGRESS_POOL_MAX ?? '2')
  const poolMax = Number.isInteger(configuredPoolMax) && configuredPoolMax > 0
    ? configuredPoolMax
    : 2

  return createPrismaClient({
    connectionString,
    max: poolMax,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000
  })
}
