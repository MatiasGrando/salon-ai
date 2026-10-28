import { Prisma } from '../../generated/prisma/client.js'

export type BotWorkerScope = {
  mode?: 'include' | 'exclude'
  businessId?: string
  channels?: readonly ('WHATSAPP'|'INSTAGRAM')[]
  businessIds?:readonly string[]
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
export function tenantScopeSql(scope: BotWorkerScope | undefined, alias: 'j' | 'o' | 'op' | '"BotJob"' | '"BotOutbox"'): Prisma.Sql {
  if (!scope) return Prisma.empty
  const column = Prisma.raw(`${alias}."businessId"`)
  const singleTenant=scope.businessId?(scope.mode!=='exclude'?Prisma.sql`AND ${column}=${scope.businessId}`:Prisma.sql`AND ${column}<>${scope.businessId}`):Prisma.empty
  const tenant=scope.businessIds===undefined?singleTenant:scope.businessIds.length?Prisma.sql`${singleTenant} AND ${column} IN (${Prisma.join([...scope.businessIds])})`:Prisma.sql`${singleTenant} AND false`
  if(scope.channels===undefined)return tenant
  if(!scope.channels.length)return Prisma.sql`${tenant} AND false`
  if(scope.channels.some(channel=>!['WHATSAPP','INSTAGRAM'].includes(channel)))throw new Error('invalid worker channel scope')
  const owner=Prisma.raw(alias)
  const deployment=alias==='o'||alias==='op'||alias==='"BotOutbox"'?Prisma.sql`SELECT 1 FROM "BotSession" scoped_session JOIN "BotChannelDeployment" scoped_deployment ON scoped_deployment.id=scoped_session."deploymentId" AND scoped_deployment."businessId"=scoped_session."businessId" WHERE scoped_session.id=${owner}."sessionId" AND scoped_session."businessId"=${column}`:Prisma.sql`SELECT 1 FROM "BotChannelDeployment" scoped_deployment WHERE scoped_deployment.id=${owner}."deploymentId" AND scoped_deployment."businessId"=${column}`
  return Prisma.sql`${tenant} AND EXISTS (${deployment} AND scoped_deployment.channel::text IN (${Prisma.join([...scope.channels])}))`
}
