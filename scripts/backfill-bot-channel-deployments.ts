import { randomUUID } from 'node:crypto'
import { prisma } from '../src/config/prisma.js'
import { TAMARA_OPTIONS_BOT_KEY } from '../src/services/tamara-options-bot.js'

const apply = process.argv.includes('--apply')
const confirmation = process.argv.find((value) => value.startsWith('--confirm='))?.slice('--confirm='.length)
if (apply && confirmation !== 'BACKFILL_LEGACY_POINTERS') {
  throw new Error('Apply requires --confirm=BACKFILL_LEGACY_POINTERS after reviewing dry-run output')
}

try {
  const duplicatePhones = await prisma.businessWhatsAppConfig.groupBy({
    by: ['phoneNumberId'],
    where: { connectionStatus: 'CONNECTED', phoneNumberId: { not: null } },
    _count: { businessId: true },
    having: { businessId: { _count: { gt: 1 } } }
  })
  const connected = await prisma.businessWhatsAppConfig.findMany({
    where: { connectionStatus: 'CONNECTED', phoneNumberId: { not: null } },
    select: {
      businessId: true,
      phoneNumberId: true,
      business: {
        select: {
          botConfigurations: {
            where: { status: 'ACTIVE', channel: 'WHATSAPP', routingMode: 'EXCLUSIVE' },
            select: { id: true, botKey: true, phoneNumberId: true }
          }
        }
      }
    }
  })
  const pointers = await prisma.botChannelDeployment.findMany({ where: { channel: 'WHATSAPP' } })
  const pointerByBusiness = new Map(pointers.map((pointer) => [pointer.businessId, pointer]))
  const candidates: Array<{ businessId: string; configurationId: string; engineKey: string }> = []
  const unchanged: string[] = []
  const skippedCustom: Array<{ businessId: string; botKeys: string[] }> = []
  const conflicts: Array<{ businessId: string; reason: string }> = duplicatePhones.map((row) => ({
    businessId: '*', reason: `duplicate connected phoneNumberId ${row.phoneNumberId ?? 'null'}`
  }))

  for (const connection of connected) {
    const active = connection.business.botConfigurations
    if (active.length > 1) {
      conflicts.push({ businessId: connection.businessId, reason: 'multiple active exclusive WhatsApp configurations' })
      continue
    }
    const configuration = active[0]
    if (!configuration) continue
    if (configuration.botKey !== TAMARA_OPTIONS_BOT_KEY) {
      skippedCustom.push({ businessId: connection.businessId, botKeys: [configuration.botKey] })
      continue
    }
    if (configuration.phoneNumberId && configuration.phoneNumberId !== connection.phoneNumberId) {
      conflicts.push({ businessId: connection.businessId, reason: 'active configuration phone differs from connected phone' })
      continue
    }
    const pointer = pointerByBusiness.get(connection.businessId)
    if (!pointer) {
      candidates.push({ businessId: connection.businessId, configurationId: configuration.id, engineKey: configuration.botKey })
      continue
    }
    if (pointer.activeConfigurationId === configuration.id && pointer.engineKey === configuration.botKey) {
      unchanged.push(connection.businessId)
      continue
    }
    conflicts.push({ businessId: connection.businessId, reason: 'existing pointer differs from active legacy configuration' })
  }

  const report = { mode: apply ? 'APPLY' : 'DRY_RUN', candidates, unchanged, skippedCustom, conflicts }
  console.log(JSON.stringify(report, null, 2))
  if (conflicts.length > 0) throw new Error(`Pointer backfill aborted: ${conflicts.length} conflict(s) require remediation`)
  if (!apply) {
    console.log('Dry-run only. Re-run with --apply --confirm=BACKFILL_LEGACY_POINTERS after review.')
  } else {
    await prisma.$transaction(async (tx) => {
      for (const candidate of candidates) {
        const deploymentId = randomUUID()
        await tx.botChannelDeployment.create({
          data: {
            id: deploymentId,
            businessId: candidate.businessId,
            channel: 'WHATSAPP',
            engineKey: candidate.engineKey,
            activeConfigurationId: candidate.configurationId,
            generation: 1,
            activatedAt: new Date(),
            legacyDispatchCoverageVersion: 0
          }
        })
        await tx.botDeploymentAudit.create({
          data: {
            businessId: candidate.businessId,
            action: 'LEGACY_POINTER_BACKFILLED',
            newConfigId: candidate.configurationId,
            generation: 1,
            detail: { engineKey: candidate.engineKey, coverageVersion: 0 }
          }
        })
      }
    })
    console.log(`Applied ${candidates.length} legacy pointer(s); coverage remains 0 until audited compatibility rollout.`)
  }
} finally {
  await prisma.$disconnect()
}
