import 'dotenv/config'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { prisma } from '../src/config/prisma.js'
import { mediaStorageConfig, parseImageDataUrl, storeBusinessImage } from '../src/services/media-storage-service.js'

type MediaBackup = {
  createdAt: string
  services: Array<{ id: string; businessId: string; imageUrl: string }>
  professionals: Array<{ id: string; businessId: string; avatarUrl: string }>
  businesses: Array<{
    id: string
    logoUrl: string | null
    coverImageUrl: string | null
    landingGalleryImages: string | null
  }>
}

async function main() {
const args = process.argv.slice(2)
const apply = args.includes('--apply')
const restoreIndex = args.indexOf('--restore')
const businessIdIndex = args.indexOf('--business-id')
const businessId = businessIdIndex >= 0 ? args[businessIdIndex + 1]?.trim() : undefined

if (restoreIndex >= 0) {
  const backupPath = args[restoreIndex + 1]
  if (!backupPath) throw new Error('Usa --restore <archivo-de-respaldo>')
  await restoreBackup(resolve(backupPath))
  return
}

const [services, professionals, businesses] = await Promise.all([
  prisma.service.findMany({
    where: { ...(businessId ? { businessId } : {}), imageUrl: { startsWith: 'data:image/' } },
    select: { id: true, businessId: true, imageUrl: true }
  }),
  prisma.professional.findMany({
    where: { ...(businessId ? { businessId } : {}), avatarUrl: { startsWith: 'data:image/' } },
    select: { id: true, businessId: true, avatarUrl: true }
  }),
  prisma.business.findMany({
    where: businessId ? { id: businessId } : {},
    select: { id: true, logoUrl: true, coverImageUrl: true, landingGalleryImages: true }
  })
])

const businessesWithMedia = businesses.filter((business) =>
  isDataImage(business.logoUrl) ||
  isDataImage(business.coverImageUrl) ||
  galleryDataImages(business.landingGalleryImages).length > 0
)
const imageCount = services.length + professionals.length + businessesWithMedia.reduce((total, business) =>
  total + Number(isDataImage(business.logoUrl)) + Number(isDataImage(business.coverImageUrl)) + galleryDataImages(business.landingGalleryImages).length,
0)
const byteCount = [
  ...services.map((service) => service.imageUrl),
  ...professionals.map((professional) => professional.avatarUrl),
  ...businessesWithMedia.flatMap((business) => [
    business.logoUrl,
    business.coverImageUrl,
    ...galleryDataImages(business.landingGalleryImages)
  ])
].reduce((total, value) => total + (value ? parseImageDataUrl(value)?.bytes.length || 0 : 0), 0)

console.log(`Imágenes encontradas: ${imageCount}`)
console.log(`Datos que saldrán de la base: ${(byteCount / 1024 / 1024).toFixed(2)} MB`)
if (!apply) {
  console.log('Vista previa terminada. Usa --apply para subir, verificar y actualizar la base.')
  return
}
if (!mediaStorageConfig()) throw new Error('Configura SUPABASE_SERVICE_ROLE_KEY antes de ejecutar la migración.')

const backup: MediaBackup = {
  createdAt: new Date().toISOString(),
  services: services.filter((item): item is typeof item & { imageUrl: string } => Boolean(item.imageUrl)),
  professionals: professionals.filter((item): item is typeof item & { avatarUrl: string } => Boolean(item.avatarUrl)),
  businesses: businessesWithMedia
}
const backupPath = resolve('measurements', 'media-migration', `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
mkdirSync(dirname(backupPath), { recursive: true })
writeFileSync(backupPath, JSON.stringify(backup), 'utf8')

const serviceUpdates: Array<{ id: string; imageUrl: string }> = []
const professionalUpdates: Array<{ id: string; avatarUrl: string }> = []
const businessUpdates: Array<{
  id: string
  logoUrl: string | null
  coverImageUrl: string | null
  landingGalleryImages: string | null
}> = []
let uploadedCount = 0

for (const service of backup.services) {
  serviceUpdates.push({
    id: service.id,
    imageUrl: await storeBusinessImage({ businessId: service.businessId, kind: 'services', value: service.imageUrl, maxBytes: 4 * 1024 * 1024 })
  })
  console.log(`Verificadas ${++uploadedCount}/${imageCount}`)
}
for (const professional of backup.professionals) {
  professionalUpdates.push({
    id: professional.id,
    avatarUrl: await storeBusinessImage({ businessId: professional.businessId, kind: 'professionals', value: professional.avatarUrl, maxBytes: 4 * 1024 * 1024 })
  })
  console.log(`Verificadas ${++uploadedCount}/${imageCount}`)
}
for (const business of backup.businesses) {
  const gallery = parseGallery(business.landingGalleryImages)
  const logoUrl = isDataImage(business.logoUrl)
    ? await storeBusinessImage({ businessId: business.id, kind: 'logos', value: business.logoUrl, maxBytes: 4 * 1024 * 1024 })
    : business.logoUrl
  if (isDataImage(business.logoUrl)) console.log(`Verificadas ${++uploadedCount}/${imageCount}`)
  const coverImageUrl = isDataImage(business.coverImageUrl)
    ? await storeBusinessImage({ businessId: business.id, kind: 'covers', value: business.coverImageUrl, maxBytes: 4 * 1024 * 1024 })
    : business.coverImageUrl
  if (isDataImage(business.coverImageUrl)) console.log(`Verificadas ${++uploadedCount}/${imageCount}`)
  const storedGallery: string[] = []
  for (const value of gallery) {
    storedGallery.push(isDataImage(value)
      ? await storeBusinessImage({ businessId: business.id, kind: 'gallery', value, maxBytes: 4 * 1024 * 1024 })
      : value)
    if (isDataImage(value)) console.log(`Verificadas ${++uploadedCount}/${imageCount}`)
  }
  businessUpdates.push({
    id: business.id,
    logoUrl,
    coverImageUrl,
    landingGalleryImages: gallery.length ? JSON.stringify(storedGallery) : business.landingGalleryImages
  })
}

await prisma.$transaction([
  ...serviceUpdates.map((item) => prisma.service.update({ where: { id: item.id }, data: { imageUrl: item.imageUrl } })),
  ...professionalUpdates.map((item) => prisma.professional.update({ where: { id: item.id }, data: { avatarUrl: item.avatarUrl } })),
  ...businessUpdates.map((item) => prisma.business.update({
    where: { id: item.id },
    data: {
      logoUrl: item.logoUrl,
      coverImageUrl: item.coverImageUrl,
      landingGalleryImages: item.landingGalleryImages
    }
  }))
])

console.log(`Migración completada. Respaldo reversible: ${backupPath}`)
}

await main()
await prisma.$disconnect()

async function restoreBackup(path: string) {
  const backup = JSON.parse(readFileSync(path, 'utf8')) as MediaBackup
  await prisma.$transaction([
    ...backup.services.map((item) => prisma.service.update({ where: { id: item.id }, data: { imageUrl: item.imageUrl } })),
    ...backup.professionals.map((item) => prisma.professional.update({ where: { id: item.id }, data: { avatarUrl: item.avatarUrl } })),
    ...backup.businesses.map((item) => prisma.business.update({
      where: { id: item.id },
      data: {
        logoUrl: item.logoUrl,
        coverImageUrl: item.coverImageUrl,
        landingGalleryImages: item.landingGalleryImages
      }
    }))
  ])
  console.log(`Respaldo restaurado: ${path}`)
}

function isDataImage(value: string | null | undefined): value is string {
  return Boolean(value?.startsWith('data:image/'))
}

function parseGallery(value: string | null) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function galleryDataImages(value: string | null) {
  return parseGallery(value).filter(isDataImage)
}
