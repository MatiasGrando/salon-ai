import type {
  Business,
  Prisma,
  PrismaClient,
  UserRole
} from '../generated/prisma/client.js'

const DENIED_BUSINESS_ID = '__NO_AUTHORIZED_BUSINESS__'

export type BusinessAuthorizationUser = {
  id: string
  role: UserRole
  businessId: string | null
  authorizedBusinessIdOverride?: string
  canCreateBusinesses: boolean
}

export type BusinessScope =
  | { kind: 'all' }
  | { kind: 'assigned'; userId: string }
  | { kind: 'single'; businessId: string }

type BusinessAuthorizationClient = Pick<PrismaClient, 'business'> | Pick<Prisma.TransactionClient, 'business'>

export function resolveBusinessScope(user: BusinessAuthorizationUser): BusinessScope {
  if (user.role === 'SUPER_ADMIN') return { kind: 'all' }
  if (user.authorizedBusinessIdOverride) {
    return { kind: 'single', businessId: user.authorizedBusinessIdOverride }
  }
  if (user.role === 'ACCOUNT_ADMIN') return { kind: 'assigned', userId: user.id }
  return {
    kind: 'single',
    businessId: user.businessId ?? DENIED_BUSINESS_ID
  }
}

export function businessAccessWhere(
  scope: BusinessScope,
  requestedId?: string
): Prisma.BusinessWhereInput {
  const requestedWhere = requestedId ? { id: requestedId } : {}
  if (scope.kind === 'all') return requestedWhere
  if (scope.kind === 'assigned') {
    return {
      ...requestedWhere,
      accountAdminId: scope.userId
    }
  }
  return requestedId
    ? { AND: [{ id: requestedId }, { id: scope.businessId }] }
    : { id: scope.businessId }
}

export function canCreateBusiness(user: BusinessAuthorizationUser) {
  return user.role === 'SUPER_ADMIN' || user.canCreateBusinesses
}

export async function requireAuthorizedBusiness(
  client: BusinessAuthorizationClient,
  user: BusinessAuthorizationUser,
  businessId: string
): Promise<Business | null> {
  return client.business.findFirst({
    where: businessAccessWhere(resolveBusinessScope(user), businessId)
  })
}
