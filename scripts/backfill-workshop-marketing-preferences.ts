import { prisma } from '../src/config/prisma.js'
import { workshopInPersonMarketingPreferenceData } from '../src/services/marketing-preference-service.js'

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const campaignName = argument('--campaign-name')
  if (!campaignName) throw new Error('Indica --campaign-name para identificar un solo taller')

  const campaigns = await prisma.campaign.findMany({
    where: { name: campaignName },
    select: { businessId: true },
    take: 2
  })
  if (campaigns.length !== 1) throw new Error('La campaña debe existir una sola vez')
  const businessId = campaigns[0]!.businessId
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, businessType: true }
  })
  if (!business || business.businessType !== 'WORKSHOP') throw new Error('La campaña no pertenece a un taller')

  const customers = await prisma.customer.findMany({
    where: {
      businessId: business.id,
      workshopVehicles: { some: { businessId: business.id } },
      marketingPreferences: { none: { businessId: business.id } }
    },
    select: { id: true, phone: true, normalizedPhone: true }
  })
  const eligible = customers.filter(customer => {
    if (customer.normalizedPhone?.startsWith('legacy-')) return false
    const digits = customer.phone.replace(/\D/g, '')
    return digits.length >= 8 && digits.length <= 15
  })
  console.log(JSON.stringify({
    mode: process.argv.includes('--apply') ? 'apply' : 'dry-run',
    customersWithoutPreference: customers.length,
    eligibleForInPersonBackfill: eligible.length,
    skippedWithoutUsablePhone: customers.length - eligible.length
  }))
  if (!process.argv.includes('--apply')) return

  let created = 0
  for (let index = 0; index < eligible.length; index += 500) {
    const batch = eligible.slice(index, index + 500)
    const result = await prisma.customerMarketingPreference.createMany({
      data: batch.map(customer => ({
        businessId: business.id,
        customerId: customer.id,
        ...workshopInPersonMarketingPreferenceData(null)
      })),
      skipDuplicates: true
    })
    created += result.count
  }
  console.log(JSON.stringify({ created, alreadyPresentOrConcurrent: eligible.length - created }))
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => prisma.$disconnect())
