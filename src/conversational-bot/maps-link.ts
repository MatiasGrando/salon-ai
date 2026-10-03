export type PublicMapsLink = { label: 'Ver en Maps'; url: string; address: string | null; precision: 'address_search' | 'configured_link' }
type MapsFields = { businessName?: string | null; address?: string | null; addressArea?: string | null; mapsUrl?: string | null }
const safeText = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value)
/** Address search is not a verified place pin. This helper performs no network request. */
export function publicMapsLink(fields: MapsFields): PublicMapsLink | null {
  if (safeText(fields.address, 1000)) {
    const address = [fields.address.trim(), safeText(fields.addressArea, 300) ? fields.addressArea.trim() : null].filter(Boolean).join(', ')
    const query = [safeText(fields.businessName, 200) ? fields.businessName.trim() : null, address].filter(Boolean).join(', ')
    const url = new URL('https://www.google.com/maps/search/')
    url.searchParams.set('api', '1')
    url.searchParams.set('query', query)
    if (url.toString().length > 2048) return null
    return { label: 'Ver en Maps', url: url.toString(), address, precision: 'address_search' }
  }
  if (!safeText(fields.mapsUrl, 2048)) return null
  try {
    const url = new URL(fields.mapsUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['www.google.com', 'google.com', 'maps.google.com'].includes(url.hostname) ||
        url.hostname !== 'maps.google.com' && !url.pathname.startsWith('/maps')) return null
    return { label: 'Ver en Maps', url: url.toString(), address: null, precision: 'configured_link' }
  } catch { return null }
}
