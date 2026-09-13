import type { PrismaClient } from '../generated/prisma/client.js'

export const BARBER_DEMO_CUSTOMER_CODE = 'WX-38N6UG'

export const DEFAULT_PIPELINE_STAGES = Object.freeze([
  { name: 'Nuevo', color: '#E7B52C' },
  { name: 'Contactado', color: '#D98A3A' },
  { name: 'Agendar entrevista', color: '#D95C43' },
  { name: 'Propuesta enviada', color: '#3B82C4' }
])

/** Provision only when the existing flag grants access; never mutate the flag. */
export async function provisionPipelineForCustomerCode(prisma: PrismaClient, customerCode: string) {
  return prisma.$transaction(async (transaction) => {
    const business = await transaction.business.findFirst({
      where: { customerCode, featureSettings: { pipelineEnabled: true } },
      select: { id: true }
    })
    if (!business) return null

    const pipeline = await transaction.pipeline.upsert({
      where: { businessId: business.id },
      create: {
        id: `pl_${business.id}`,
        businessId: business.id,
        name: 'Pipeline de leads'
      },
      update: {},
      select: { id: true, businessId: true }
    })

    const stages = []
    for (const [position, defaults] of DEFAULT_PIPELINE_STAGES.entries()) {
      stages.push(await transaction.pipelineStage.upsert({
        where: { id: `pls_${business.id}_${position}` },
        create: {
          id: `pls_${business.id}_${position}`,
          businessId: business.id,
          pipelineId: pipeline.id,
          name: defaults.name,
          color: defaults.color,
          position
        },
        update: {},
        select: { id: true, position: true }
      }))
    }

    return { pipeline, stages }
  })
}

export function provisionBarberDemoPipeline(prisma: PrismaClient) {
  return provisionPipelineForCustomerCode(prisma, BARBER_DEMO_CUSTOMER_CODE)
}
