import { Prisma } from '../../generated/prisma/client.js'

export type BotWorkerScope = {
  mode?: 'include' | 'exclude'
  businessId: string
}

/** An absent pair keeps legacy global processing; a partial pair must never silently do so. */
export function botWorkerScopeFromEnv(env: Record<string, string | undefined>): BotWorkerScope | undefined {
  const mode = env.BOT_WORKER_SCOPE_MODE
  const businessId = env.BOT_WORKER_SCOPE_BUSINESS_ID
  if (mode === undefined && businessId === undefined) return undefined
  if ((mode !== 'include' && mode !== 'exclude') || !businessId?.trim() || businessId !== businessId.trim()) {
    throw new Error('BOT_WORKER_SCOPE_MODE and BOT_WORKER_SCOPE_BUSINESS_ID must be set together')
  }
  return { mode, businessId }
}

/** The alias is a fixed, call-site-owned SQL identifier, never user input. */
export function tenantScopeSql(scope: BotWorkerScope | undefined, alias: 'j' | 'o' | '"BotJob"' | '"BotOutbox"'): Prisma.Sql {
  if (!scope) return Prisma.empty
  const column = Prisma.raw(`${alias}."businessId"`)
  return scope.mode !== 'exclude'
    ? Prisma.sql`AND ${column} = ${scope.businessId}`
    : Prisma.sql`AND ${column} <> ${scope.businessId}`
}
