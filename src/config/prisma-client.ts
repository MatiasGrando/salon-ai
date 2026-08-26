import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'

export type PrismaClientPoolOptions = {
  connectionString: string
  max: number
  idleTimeoutMillis: number
  connectionTimeoutMillis: number
}

export function createPrismaClient(options: PrismaClientPoolOptions) {
  const adapter = new PrismaPg(options)
  return new PrismaClient({ adapter })
}
