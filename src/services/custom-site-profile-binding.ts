export type CustomSiteProfileBinding = {
  hostname: string
  businessCustomerCode: string
  serviceCatalogMode: 'ALL'
}

const customSiteProfileBindings: CustomSiteProfileBinding[] = [
  {
    hostname: 'tamaragrando.weex.com.ar',
    businessCustomerCode: 'WX-RWCEDG',
    serviceCatalogMode: 'ALL'
  }
]

export function findCustomSiteProfileBinding(host: string | string[] | undefined) {
  const hostname = normalizeHostname(host)
  if (!hostname) return null
  return customSiteProfileBindings.find(binding => binding.hostname === hostname) || null
}

export function normalizeHostname(host: string | string[] | undefined) {
  const rawHost = Array.isArray(host) ? host[0] : host
  return rawHost
    ?.split(',')[0]
    ?.trim()
    .split(':')[0]
    ?.toLowerCase()
    .replace(/\.$/, '') || ''
}
