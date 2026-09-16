import { isIP } from 'node:net'

// Exact ingress peer addresses only. CIDR, hop count and trust-all permit
// arbitrary X-Forwarded-For and are intentionally unsupported here.
export function resolveLeadFormTrustedProxyIps(raw: string | undefined): string | null {
  if (!raw || raw.length > 1024) return null
  const addresses = raw.split(',').map(value => value.trim())
  if (!addresses.length || addresses.length > 16 || addresses.some(value => !isIP(value))) return null
  return [...new Set(addresses)].join(',')
}

export function leadFormPublicationReady(env: NodeJS.ProcessEnv = process.env, requiresBenefit = true) {
  return Boolean(
    resolveLeadFormTrustedProxyIps(env.LEAD_FORM_TRUSTED_PROXY_IPS) &&
    (env.LEAD_FORM_RATE_LIMIT_SECRET?.length ?? 0) >= 32 &&
    (!requiresBenefit || (env.LEAD_REWARD_TOKEN_SECRET?.length ?? 0) >= 32)
  )
}
