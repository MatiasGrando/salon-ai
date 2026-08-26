import 'dotenv/config'
import { createPrismaClient } from './prisma-client.js'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL no está configurada')
}

const configuredPoolMax = Number(process.env.DATABASE_POOL_MAX ?? '3')
const poolMax = Number.isInteger(configuredPoolMax) && configuredPoolMax > 0
  ? configuredPoolMax
  : 3

export const prisma = createPrismaClient({
  connectionString,
  max: poolMax,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000
})
