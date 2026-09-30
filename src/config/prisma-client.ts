import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { instrumentPrismaPool, type PrismaPoolDiagnostics } from './prisma-pool-diagnostics.js'

type PrismaTransactionOptions = Pick<NonNullable<Prisma.PrismaClientOptions['transactionOptions']>, 'maxWait' | 'timeout'>

export type PrismaClientPoolOptions = {
  connectionString: string
  max: number
  idleTimeoutMillis: number
  connectionTimeoutMillis: number
  transactionOptions?: PrismaTransactionOptions
}
const diagnosticControls = new WeakMap<PrismaClient, (options: PrismaPoolDiagnostics) => boolean>()

/** Explicit opt-in before the first connection. A started client is never swapped or instrumented late. */
export function enablePrismaClientDiagnostics(client: PrismaClient, options: PrismaPoolDiagnostics): boolean {
  return diagnosticControls.get(client)?.(options) ?? false
}

export function createPrismaClient(options: PrismaClientPoolOptions) {
  const { transactionOptions, ...poolOptions } = options
  const adapter = new PrismaPg(poolOptions)
  const connect = adapter.connect.bind(adapter)
  let started = false
  let diagnostics: PrismaPoolDiagnostics | null = null
  // Public factory method only, never pg/Prisma prototypes or adapter internals.
  adapter.connect = () => {
    started = true
    if (!diagnostics) return connect()
    const pool = new Pool(poolOptions)
    instrumentPrismaPool(pool, diagnostics.role, diagnostics.emit)
    return new PrismaPg(pool, { disposeExternalPool: true }).connect()
  }
  const client = new PrismaClient(transactionOptions === undefined ? { adapter } : { adapter, transactionOptions })
  diagnosticControls.set(client, options => {
    if (started || diagnostics || !['worker', 'ingress'].includes(options.role)) return false
    diagnostics = { role: options.role, emit: options.emit }
    return true
  })
  return client
}
