import { isIP } from 'node:net'

// Exact ingress peer addresses only. CIDR, hop count and trust-all permit
// arbitrary X-Forwarded-For and are intentionally unsupported here.
export function resolveLeadFormTrustedProxyIps(raw: string | undefined): string | null {
  if (!raw || raw.length > 1024) return null
  const addresses = raw.split(',').map(value => value.trim())
  if (!addresses.length || addresses.length > 16 || addresses.some(value => !isIP(value))) return null
  return [...new Set(addresses)].join(',')
}

const SHARED_PEER_MODE = 'SHARED_PEER_CONSERVATIVE'

export function usesConservativeSharedPeerMode(env: NodeJS.ProcessEnv = process.env, businessId?: string) {
  if (env.LEAD_FORM_INGRESS_MODE !== SHARED_PEER_MODE || !businessId) return false
  const allowed = (env.LEAD_FORM_CONSERVATIVE_BUSINESS_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean)
  return allowed.length > 0 && allowed.length <= 16 && allowed.includes(businessId)
}

export function leadFormPublicationReady(env: NodeJS.ProcessEnv = process.env, requiresBenefit = true, businessId?: string) {
  const ingressReady = Boolean(resolveLeadFormTrustedProxyIps(env.LEAD_FORM_TRUSTED_PROXY_IPS)) ||
    (!requiresBenefit && usesConservativeSharedPeerMode(env, businessId))
  return Boolean(
    ingressReady &&
    (env.LEAD_FORM_RATE_LIMIT_SECRET?.length ?? 0) >= 32 &&
    (!requiresBenefit || (env.LEAD_REWARD_TOKEN_SECRET?.length ?? 0) >= 32)
  )
}
