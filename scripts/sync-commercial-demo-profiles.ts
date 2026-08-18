import { prisma } from '../src/config/prisma.js'
import { createDemoProfileBusiness, type DemoType } from '../src/routes/demo-profile.js'

const REQUIRED_DEMOS: Array<{ type: DemoType; name: string }> = [
  { type: 'BARBERSHOP', name: 'Barbería Simple' },
  { type: 'PILATES', name: 'Estudio Pilates' }
]

const referenceDemo = await prisma.business.findFirst({
  where: { isDemo: true, demoType: { in: ['NAILS', 'HAIR_SALON'] }, createdByUserId: { not: null } },
  orderBy: { createdAt: 'asc' },
  select: { createdByUserId: true }
})

if (!referenceDemo?.createdByUserId) {
  throw new Error('No se encontró una demo compartida existente para determinar el propietario.')
}

for (const demo of REQUIRED_DEMOS) {
  const existing = await prisma.business.findFirst({
    where: { isDemo: true, demoType: demo.type },
    select: { id: true, name: true }
  })
  if (existing) {
    console.log(`${demo.type}: ya existe ${existing.name} (${existing.id})`)
    continue
  }

  const created = await createDemoProfileBusiness(demo.name, demo.type, referenceDemo.createdByUserId)
  console.log(`${demo.type}: creada ${created.name} (${created.id})`)
}
