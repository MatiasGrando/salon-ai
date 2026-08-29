import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from '../generated/prisma/client.js'

type PrismaTransactionOptions = Pick<NonNullable<Prisma.PrismaClientOptions['transactionOptions']>, 'maxWait' | 'timeout'>

export type PrismaClientPoolOptions = {
  connectionString: string
  max: number
  idleTimeoutMillis: number
  connectionTimeoutMillis: number
  transactionOptions?: PrismaTransactionOptions
}

export function createPrismaClient(options: PrismaClientPoolOptions) {
  const { transactionOptions, ...poolOptions } = options
  const adapter = new PrismaPg(poolOptions)
  return new PrismaClient(transactionOptions === undefined ? { adapter } : { adapter, transactionOptions })
}
