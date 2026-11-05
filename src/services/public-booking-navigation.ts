import { findCustomSiteProfileBindingByCustomerCode } from './custom-site-profile-binding.js'

export type PublicBusinessNavigation = { slug?: string | null; customerCode?: string | null }

export function publicBookingNavigation(business: PublicBusinessNavigation) {
  const domain = (process.env.PUBLIC_BASE_DOMAIN || 'weex.com.ar').toLowerCase()
  const slug = business.slug || ''
  const central = `https://${domain}${slug ? `/${encodeURIComponent(slug)}` : ''}`
  const binding = business.customerCode ? findCustomSiteProfileBindingByCustomerCode(business.customerCode) : null
  const landingUrl = business.customerCode === 'WX-NPP7HE'
    ? 'https://glow.weex.com.ar/?sede=canitas'
    : business.customerCode === 'WX-QG5FQA'
      ? 'https://glow.weex.com.ar/?sede=urquiza'
      : `https://${binding?.hostname || (slug ? `${slug}.${domain}` : domain)}/`
  return { bookingUrl: `${central}/reservar`, accountUrl: `${central}/cuenta`, landingUrl }
}

// Only existing reservation/account anchors are adapted; forms and external links stay intact.
export function centralizePublicBookingLinks(html: string, business: PublicBusinessNavigation) {
  if (!business.slug) return html
  const navigation = publicBookingNavigation(business)
  const allowedHosts = new Set([new URL(navigation.landingUrl).host, `${business.slug}.${(process.env.PUBLIC_BASE_DOMAIN || 'weex.com.ar').toLowerCase()}`])
  return html.replace(/(\bhref\s*=\s*)(["'])([^"']+)\2/gi, (anchor, prefix, quote, href: string) => {
    const match = href.match(/^(?:https?:\/\/([^/?#]+))?\/(reservar|cuenta)([?#].*)?$/)
    if (!match || (match[1] && !allowedHosts.has(match[1].toLowerCase()))) return anchor
    const target = match[2] === 'reservar' ? navigation.bookingUrl : navigation.accountUrl
    return `${prefix}${quote}${target}${match[3] || ''}${quote}`
  })
}
