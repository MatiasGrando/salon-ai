import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { parseImageDataUrl, storeBusinessImage } from './media-storage-service.js'

type Crop = { x: number; y: number; width: number; height: number; fillRatio?: number }
type BannerSource = 'cover' | 'gallery' | 'upload'
type SavedPhoto = { sourceUrl: string; crop: Crop; imageUrl: string }
type BusinessSources = {
  coverImageUrl?: string | null
  logoUrl?: string | null
  landingGalleryImages?: string | null
  bookingEmailMedia?: unknown
}

export type BookingEmailMediaSettings = {
  logoUrl: string | null
  banner: (SavedPhoto & { source: BannerSource }) | null
  gallery: SavedPhoto[]
}

export type BookingEmailMedia = {
  bannerUrl: string | null
  logoUrl: string | null
  galleryUrls: string[]
}

const ORIGINAL_MAX_BYTES = 2 * 1024 * 1024
const BANNER_MAX_BYTES = 600 * 1024
const GALLERY_MAX_BYTES = 250 * 1024
export const BOOKING_EMAIL_MEDIA_BODY_LIMIT = 5 * 1024 * 1024

export class BookingEmailMediaInputError extends Error {
  constructor(message: string, readonly status: 400 | 409 = 400) {
    super(message)
  }
}

export function httpsBookingEmailUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value) || /[\s\\]/u.test(value)) return null
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/\.$/, '')
    if (url.username || url.password || url.port || !host.includes('.') || isIP(host) ||
      /\.(?:local|localhost|internal|lan|home\.arpa)$/i.test(host)) return null
    return url.href
  } catch {
    return null
  }
}

function imageSourceReference(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (httpsBookingEmailUrl(value)) return value
  if (!/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(value)) return null
  return `data-sha256:${createHash('sha256').update(value).digest('hex')}`
}

export function bookingEmailMediaSources(business: BusinessSources) {
  let gallery: unknown[] = []
  if (business.landingGalleryImages) {
    try {
      const parsed: unknown = JSON.parse(business.landingGalleryImages)
      if (Array.isArray(parsed)) gallery = parsed.slice(0, 6)
    } catch {
      // Old or malformed gallery data has no selectable sources.
    }
  }
  return {
    cover: imageSourceReference(business.coverImageUrl),
    logo: imageSourceReference(business.logoUrl),
    gallery: gallery.map(imageSourceReference)
  }
}

export function resolveBookingEmailMedia(business: BusinessSources): BookingEmailMedia {
  const logoUrl = httpsBookingEmailUrl(business.logoUrl)
  const settings = record(business.bookingEmailMedia)
  if (!settings || !Array.isArray(settings.gallery)) return { bannerUrl: null, logoUrl, galleryUrls: [] }

  const sources = bookingEmailMediaSources(business)
  const banner = record(settings.banner)
  const bannerSource = banner?.sourceUrl
  const isCurrentSource = typeof bannerSource === 'string' && (
    (banner?.source === 'cover' && bannerSource === sources.cover) ||
    (banner?.source === 'gallery' && sources.gallery.includes(bannerSource)) ||
    (banner?.source === 'upload' && Boolean(httpsBookingEmailUrl(bannerSource)))
  )
  const bannerUrl = isCurrentSource && settings.logoUrl === sources.logo ? httpsBookingEmailUrl(banner?.imageUrl) : null

  const galleryUrls = settings.gallery.slice(0, 3).flatMap((value: unknown) => {
    const photo = record(value)
    if (typeof photo?.sourceUrl !== 'string' || !sources.gallery.includes(photo.sourceUrl)) return []
    const url = httpsBookingEmailUrl(photo.imageUrl)
    return url ? [url] : []
  })
  return { bannerUrl, logoUrl: bannerUrl ? null : logoUrl, galleryUrls }
}

export async function storeBookingEmailMedia(
  business: BusinessSources & { id: string },
  value: unknown,
  store = storeBusinessImage
): Promise<BookingEmailMediaSettings> {
  const input = record(value)
  if (!input || !Array.isArray(input.gallery) || input.gallery.length > 3 || input.banner === undefined) {
    throw new BookingEmailMediaInputError('Elegí una portada y hasta tres fotos de la galería.')
  }
  const sources = bookingEmailMediaSources(business)
  if (input.logoUrl !== sources.logo) {
    throw new BookingEmailMediaInputError('El logo cambió. Volvé a cargar las imágenes antes de guardar.', 409)
  }

  const gallery = input.gallery.map((item: unknown) => {
    const photo = record(item)
    if (typeof photo?.sourceUrl !== 'string' || !sources.gallery.includes(photo.sourceUrl)) {
      throw new BookingEmailMediaInputError('Elegí fotos que estén en la galería actual del negocio.')
    }
    return {
      sourceUrl: photo.sourceUrl,
      crop: crop(photo.crop),
      imageDataUrl: imageData(photo.imageDataUrl, GALLERY_MAX_BYTES, 'Una foto de la galería', true)
    }
  })
  if (new Set(gallery.map(photo => photo.sourceUrl)).size !== gallery.length) {
    throw new BookingEmailMediaInputError('Elegí cada foto de la galería una sola vez.')
  }

  const banner = input.banner === null ? null : prepareBanner(input.banner, business, sources)
  const save = async (kind: 'booking-email-original' | 'booking-email-banner' | 'booking-email-gallery', value: string, maxBytes: number) => {
    const stored = await store({ businessId: business.id, kind, value, maxBytes })
    const publicUrl = httpsBookingEmailUrl(stored)
    if (!publicUrl) throw new Error('El almacenamiento no devolvió una URL pública HTTPS para la imagen.')
    return publicUrl
  }

  let savedBanner: BookingEmailMediaSettings['banner'] = null
  if (banner) {
    const sourceUrl = banner.originalDataUrl
      ? await save('booking-email-original', banner.originalDataUrl, ORIGINAL_MAX_BYTES)
      : banner.sourceUrl
    savedBanner = {
      source: banner.source,
      sourceUrl,
      crop: banner.crop,
      imageUrl: await save('booking-email-banner', banner.imageDataUrl, BANNER_MAX_BYTES)
    }
  }
  const savedGallery = await Promise.all(gallery.map(async (photo) => ({
    sourceUrl: photo.sourceUrl,
    crop: photo.crop,
    imageUrl: await save('booking-email-gallery', photo.imageDataUrl, GALLERY_MAX_BYTES)
  })))
  return { logoUrl: sources.logo, banner: savedBanner, gallery: savedGallery }
}

function prepareBanner(value: unknown, business: BusinessSources, sources: ReturnType<typeof bookingEmailMediaSources>): {
  source: BannerSource
  sourceUrl: string
  originalDataUrl: string | null
  crop: Crop
  imageDataUrl: string
} {
  const banner = record(value)
  const source = banner?.source
  if (!banner || (source !== 'cover' && source !== 'gallery' && source !== 'upload')) {
    throw new BookingEmailMediaInputError('Elegí el origen de la portada del correo.')
  }
  const sourceUrl = typeof banner.sourceUrl === 'string' ? banner.sourceUrl : ''
  let originalDataUrl: string | null = null
  if (source === 'upload') {
    if (banner.originalDataUrl !== undefined) {
      originalDataUrl = imageData(banner.originalDataUrl, ORIGINAL_MAX_BYTES, 'La foto original')
    } else {
      const saved = record(record(business.bookingEmailMedia)?.banner)
      if (saved?.source !== 'upload' || saved.sourceUrl !== sourceUrl || !httpsBookingEmailUrl(sourceUrl)) {
        throw new BookingEmailMediaInputError('Volvé a subir la foto original de la portada.')
      }
    }
  } else if (!sourceUrl || banner.originalDataUrl !== undefined ||
    (source === 'cover' ? sourceUrl !== sources.cover : !sources.gallery.includes(sourceUrl))) {
    throw new BookingEmailMediaInputError('La portada ya no está disponible. Elegí una de las imágenes actuales.', 409)
  }
  return {
    source, sourceUrl, originalDataUrl, crop: crop(banner.crop),
    imageDataUrl: imageData(banner.imageDataUrl, BANNER_MAX_BYTES, 'La portada del correo', true)
  }
}

function crop(value: unknown): Crop {
  const data = record(value)
  const { x, y, width, height, fillRatio } = data || {}
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number' ||
    ![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 ||
    x >= 1 || y >= 1 || x + width > 1.000001 || y + height > 1.000001 ||
    (fillRatio !== undefined && (typeof fillRatio !== 'number' || !Number.isFinite(fillRatio) || fillRatio < 0 || fillRatio >= 1))) {
    throw new BookingEmailMediaInputError('El encuadre no es válido. Ajustá la imagen y volvé a guardar.')
  }
  return { x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y), ...(fillRatio === undefined ? {} : { fillRatio }) }
}

function imageData(value: unknown, maxBytes: number, label: string, jpegOnly = false) {
  const image = typeof value === 'string' && value.length <= Math.ceil(maxBytes / 3) * 4 + 32
    ? parseImageDataUrl(value)
    : null
  if (!image || !image.bytes.length || image.bytes.length > maxBytes || !hasImageSignature(image, jpegOnly)) {
    const formats = jpegOnly ? 'JPG' : 'JPG, PNG o WebP'
    throw new BookingEmailMediaInputError(`${label} debe estar en ${formats} y pesar como máximo ${maxBytes / 1024} KB.`)
  }
  return value as string
}

function hasImageSignature(image: NonNullable<ReturnType<typeof parseImageDataUrl>>, jpegOnly: boolean) {
  const { bytes, mimeType } = image
  if (mimeType === 'image/jpeg') return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  if (jpegOnly) return false
  if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))
  return mimeType === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
