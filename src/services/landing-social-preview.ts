export type SocialPreviewBusiness = {
  landingSocialImageUrl?: string | null | undefined
  coverImageUrl?: string | null | undefined
  logoUrl?: string | null | undefined
}

export function resolveSocialPreviewImage(business: SocialPreviewBusiness, fallbackUrl = '') {
  return firstPublicImageUrl([
    business.landingSocialImageUrl,
    business.coverImageUrl,
    business.logoUrl,
    fallbackUrl
  ])
}

export function renderSocialPreviewMetadata(input: {
  title: string
  description: string
  canonicalUrl: string
  imageUrl: string
  imageAlt: string
}) {
  const title = escapeAttribute(input.title)
  const description = escapeAttribute(input.description)
  const canonicalUrl = escapeAttribute(input.canonicalUrl)
  const imageUrl = escapeAttribute(input.imageUrl)
  const imageAlt = escapeAttribute(input.imageAlt)
  return `
  <meta name="description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:image:alt" content="${imageAlt}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${imageUrl}">
  <link rel="canonical" href="${canonicalUrl}">`
}

export function injectSocialPreviewImage(html: string, imageUrl: string) {
  if (!isPublicImageUrl(imageUrl)) return html
  const escapedUrl = escapeAttribute(imageUrl)
  return html
    .replace(/(<meta\s+property="og:image"\s+content=")[^"]*(">)/i, `$1${escapedUrl}$2`)
    .replace(/(<meta\s+name="twitter:image"\s+content=")[^"]*(">)/i, `$1${escapedUrl}$2`)
}

function firstPublicImageUrl(candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    const value = candidate?.trim() || ''
    if (isPublicImageUrl(value)) return value
  }
  return ''
}

function isPublicImageUrl(value: string) {
  return /^https:\/\//i.test(value)
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
