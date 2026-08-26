import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const SAFE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'
const safety = new URL(SAFE_DATABASE_URL)
if (safety.hostname !== '127.0.0.1' || safety.port !== '54322' || safety.pathname !== '/salon_ai_test') {
  throw new Error('Refusing unsafe F5 catalog PostgreSQL URL')
}
process.env.DATABASE_URL = SAFE_DATABASE_URL

const [{ createPrismaClient }, catalog, catalogQueries, { Prisma }, { claimOutbox, sendClaimedOutbox }, { claimBotJob }] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/bot-options/infrastructure/prisma-catalog.js'),
  import('../src/bot-options/application/catalog-queries.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/infrastructure/whatsapp-outbox-sender.js'),
  import('../src/bot-options/infrastructure/postgres-worker.js')
])
const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 4, idleTimeoutMillis: 1000, connectionTimeoutMillis: 3000 })
const suffix = randomUUID().replaceAll('-', '')
const businessId = `f5_catalog_b_${suffix}`
const otherBusinessId = `f5_catalog_other_${suffix}`
const categoryIds = Array.from({ length: 12 }, (_, index) => `f5_cat_${index}_${suffix}`)
const pagedServiceIds = Array.from({ length: 11 }, (_, index) => `f5_paged_service_${index}_${suffix}`)
const groupId = `f5_group_${suffix}`
const serviceId = `f5_service_${suffix}`
const variantId = `f5_variant_${suffix}`

// IDs for the fragment-failure fixture — declared OUTSIDE try so cleanup always has them.
const depDeploymentId = `f5_dep_deploy_${suffix}`
const depConfigId = `f5_dep_cfg_${suffix}`
const depSessionId = `f5_dep_s_${suffix}`
const depConversationId = `f5_dep_v_${suffix}`
const depTransitionId = `f5_dep_t_${suffix}`
const depDeliveryGroupId = `f5_dep_group_${suffix}`
const predecessorId = `f5_dep_pre_${suffix}`
const dependentId = `f5_dep_dep_${suffix}`
const otherDepConfigId = `f5_other_dep_cfg_${suffix}`
const otherDepDeploymentId = `f5_other_dep_deploy_${suffix}`
const otherDepConversationId = `f5_other_dep_v_${suffix}`
const otherDepSessionId = `f5_other_dep_s_${suffix}`
const otherStaleOutboxId = `f5_other_stale_outbox_${suffix}`
const otherExpiredJobId = `f5_other_expired_job_${suffix}`

try {
  await prisma.business.createMany({ data: [
    { id: businessId, customerCode: `F5-CAT-${suffix}`, name: 'F5 catalog' },
    { id: otherBusinessId, customerCode: `F5-OTHER-${suffix}`, name: 'F5 other catalog' }
  ] })
  await prisma.serviceCategory.createMany({ data: [
    ...categoryIds.map((id, index) => ({ id, businessId, name: `Categoría ${String(index).padStart(2, '0')}`, sortOrder: index })),
    { id: `f5_cat_empty_${suffix}`, businessId, name: 'Vacía', sortOrder: 50 },
    { id: `f5_cat_inactive_${suffix}`, businessId, name: 'Inactiva', sortOrder: 51, isActive: false },
    { id: `f5_cat_other_${suffix}`, businessId: otherBusinessId, name: 'Otro tenant', sortOrder: 0 }
  ] })
  await prisma.service.createMany({ data: [
    ...categoryIds.map((categoryId, index) => ({
      id: `f5_seed_service_${index}_${suffix}`, businessId, catalogCategoryId: categoryId,
      name: `Servicio ${index}`, duration: 30, sortOrder: index, price: 1000 + index
    })),
    ...pagedServiceIds.map((id, index) => ({
      id, businessId, catalogCategoryId: categoryIds[0]!, name: `Servicio paginado ${String(index).padStart(2, '0')}`,
      duration: 30 + index, sortOrder: index, price: 5000 + index
    })),
    { id: groupId, businessId, catalogCategoryId: categoryIds[0]!, name: 'Color', duration: 0, isBookable: false, sortOrder: -2 },
    { id: serviceId, businessId, catalogCategoryId: categoryIds[0]!, name: 'Corte premium', description: 'Detalle real', duration: 45,
      customerDurationMin: 40, customerDurationMax: 50, price: 25000, priceMode: 'STARTING_AT', sortOrder: -1 },
    { id: variantId, businessId, catalogCategoryId: categoryIds[0]!, parentServiceId: groupId, name: 'Color corto', duration: 90,
      price: null, attentionMode: 'GUIDED_ESTIMATE', estimateAllowsBooking: false, sortOrder: 0 },
    { id: `f5_other_service_${suffix}`, businessId: otherBusinessId, catalogCategoryId: `f5_cat_other_${suffix}`,
      name: 'Secreto otro tenant', duration: 60, price: 99999 }
  ] })

  const repository = new catalog.PrismaCatalogRepository(prisma)
  const first = await repository.listCategories({ businessId, page: 0 })
  assert.equal(first.items.length, 7, 'rows are reserved for pagination and global navigation')
  assert.equal(first.hasPrevious, false)
  assert.equal(first.hasNext, true)
  assert.ok(first.items.every((item) => item.name !== 'Vacía' && item.name !== 'Inactiva'))
  const second = await repository.listCategories({ businessId, page: 1 })
  assert.equal(second.items.length, 5)
  assert.equal(second.hasPrevious, true)
  assert.equal(second.hasNext, false)

  const topLevel = await repository.listServices({ businessId, categoryId: categoryIds[0]!, page: 0 })
  assert.ok(topLevel)
  assert.ok(topLevel.items.some((item) => item.id === groupId && item.kind === 'SUBCATEGORY'))
  assert.ok(topLevel.items.some((item) => item.id === serviceId && item.kind === 'SERVICE'))
  assert.ok(topLevel.items.every((item) => item.id !== variantId))
  assert.equal(topLevel.hasNext, true)
  const topLevelSecond = await repository.listServices({ businessId, categoryId: categoryIds[0]!, page: 1 })
  assert.ok(topLevelSecond)
  assert.equal(topLevelSecond.items.length, 7)
  assert.equal(topLevelSecond.hasPrevious, true)
  assert.equal(topLevelSecond.hasNext, false)
  assert.notDeepEqual(topLevel.items.map((item) => item.id), topLevelSecond.items.map((item) => item.id))
  const variants = await repository.listServices({ businessId, categoryId: categoryIds[0]!, parentServiceId: groupId, page: 0 })
  assert.deepEqual(variants?.items.map((item) => item.id), [variantId])
  assert.equal(variants?.items[0]?.requiresConsultation, true)
  assert.equal(await repository.getService({ businessId, serviceId: groupId }), null,
    'subcategory rows must never resolve through the reservable service API')
  await prisma.service.update({ where: { id: variantId }, data: { isBookable: false } })
  assert.equal(await repository.getSubcategory({ businessId, categoryId: categoryIds[0]!, subcategoryId: groupId }), null,
    'subcategory without remaining bookable children must fail closed as stale')
  await prisma.service.update({ where: { id: variantId }, data: { isBookable: true } })

  const detail = await repository.getService({ businessId, serviceId })
  assert.equal(detail?.name, 'Corte premium')
  assert.equal(detail?.priceMode, 'STARTING_AT')
  assert.equal(detail?.durationMinMinutes, 40)
  assert.equal(await repository.getService({ businessId, serviceId: `f5_other_service_${suffix}` }), null, 'service reads are tenant-scoped')
  assert.equal(await repository.listServices({ businessId, categoryId: `f5_cat_other_${suffix}`, page: 0 }), null, 'category reads are tenant-scoped')
  assert.equal(await repository.getSubcategory({ businessId, categoryId: categoryIds[0]!, subcategoryId: `f5_other_service_${suffix}` }), null)
  assert.throws(() => catalogQueries.catalogPageOffset(-1), /non-negative integer/)

  // ─── F5.4 PG: fragmento previo POISON bloquea dependiente interactivo ─────────
  //
  // reglas-funcionales.md §3.1: "Si no se pudo entregar el contenido previo
  // requerido, no se presenta una acción de reserva descontextualizada."
  //
  // Este contrato verifica que un grupo de delivery con predecesor informativo
  // en estado POISON impide que el interactivo dependiente sea reclamado por
  // el sender. El bloqueo ocurre en la claim query de whatsapp-outbox-sender.ts.
  //
  // Flujo real probado: claimOutbox → sendClaimedOutbox(provider returns
  // clear_failure retryable:false) → POISON status → dependent claim blocked.

  // Crear configuración mínima para soportar el deployment.
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt")
    VALUES (${depConfigId}, ${businessId}, 'f5_cat_dep', 'F5 dep', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())
  `)

  // Crear deployment con todas las columnas que la claim query requiere.
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotChannelDeployment" ("id", "businessId", "generation", "activatedAt",
      "activeConfigurationId", "engineKey", "legacyDispatchCoverageVersion", "updatedAt")
    VALUES (${depDeploymentId}, ${businessId}, 1, clock_timestamp(),
      ${depConfigId}, 'deterministic-options', 1, clock_timestamp())
  `)

  // Crear conversación y sesión.
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt")
    VALUES (${depConversationId}, '5491155550000', ${businessId}, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration",
      "businessTimezone", "state", "updatedAt")
    VALUES (${depSessionId}, ${businessId}, ${depConversationId}, ${depDeploymentId}, 1,
      'America/Argentina/Buenos_Aires',
      ${JSON.stringify({ schemaVersion: 1, flow: 'MAIN_MENU', booking: 'NONE', deposit: 'NONE', handoff: 'NONE',
        cart: [], selections: { categoryId: null, professionalId: null, anyProfessional: false, date: null,
        slotStartAt: null, appointmentId: null }, invalidStreak: 0, presentation: { kind: 'plain' },
        discardReturnFlow: null, handoffReturnFlow: null, catalogMode: 'BOOKING', nameCandidate: null,
        pendingEntityRef: null, rejectedRecommendationIds: [] })}::jsonb,
      clock_timestamp())
  `)

  // Tenant centinela: un claim acotado al fixture principal no debe ejecutar
  // mantenimiento ni seleccionar filas de este segundo negocio.
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt")
    VALUES (${otherDepConfigId}, ${otherBusinessId}, 'f5_other_dep', 'F5 other dep', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotChannelDeployment" ("id", "businessId", "generation", "activatedAt",
      "activeConfigurationId", "engineKey", "legacyDispatchCoverageVersion", "updatedAt")
    VALUES (${otherDepDeploymentId}, ${otherBusinessId}, 1, clock_timestamp(),
      ${otherDepConfigId}, 'deterministic-options', 1, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt")
    VALUES (${otherDepConversationId}, '5491155559999', ${otherBusinessId}, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration",
      "businessTimezone", "state", "updatedAt")
    VALUES (${otherDepSessionId}, ${otherBusinessId}, ${otherDepConversationId}, ${otherDepDeploymentId}, 1,
      'America/Argentina/Buenos_Aires',
      ${JSON.stringify({ schemaVersion: 1, flow: 'MAIN_MENU', booking: 'NONE', deposit: 'NONE', handoff: 'NONE',
        cart: [], selections: { categoryId: null, professionalId: null, anyProfessional: false, date: null,
        slotStartAt: null, appointmentId: null }, invalidStreak: 0, presentation: { kind: 'plain' },
        discardReturnFlow: null, handoffReturnFlow: null, catalogMode: 'BOOKING', nameCandidate: null,
        pendingEntityRef: null, rejectedRecommendationIds: [] })}::jsonb,
      clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId",
      "sequence", "kind", "payload", "idempotencyKey", "status", "leaseToken", "leasedUntil", "updatedAt")
    VALUES (${otherStaleOutboxId}, ${otherBusinessId}, ${otherDepSessionId}, 'other-transition', 'other-group',
      0, 'informative_text', ${JSON.stringify({ to: '5491155559999', item: { type: 'informative_text', body: 'sentinel' } })}::jsonb,
      ${`other-outbox-${suffix}`}, 'SENDING'::"BotOutboxStatus", 'other-lease', clock_timestamp() - interval '1 minute', clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration",
      "status", "attempts", "maxAttempts", "leaseToken", "leasedUntil", "updatedAt")
    VALUES (${otherExpiredJobId}, 'PROCESS_SESSION', 'other-aggregate', ${otherBusinessId}, ${otherDepDeploymentId}, 1,
      'LEASED'::"BotJobStatus", 1, 1, 'other-job-lease', clock_timestamp() - interval '1 minute', clock_timestamp())
  `)
  assert.equal(await claimBotJob(prisma, 30_000, randomUUID(), { businessId }), null)
  const otherJobStatus = await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT "status"::text AS "status" FROM "BotJob" WHERE "id" = ${otherExpiredJobId}
  `)
  assert.equal(otherJobStatus[0]!.status, 'LEASED', 'scoped job maintenance must not poison another tenant')

  // Crear grupo de delivery: sequence 0 = informativo (predecesor), sequence 1 = interactivo (dependiente).
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId",
      "sequence", "kind", "payload", "idempotencyKey", "status", "dependsOnSequence", "updatedAt")
    VALUES (${predecessorId}, ${businessId}, ${depSessionId}, ${depTransitionId}, ${depDeliveryGroupId},
      0, 'informative_text',
      ${JSON.stringify({ to: '5491155550000', item: { type: 'informative_text', body: 'Descripción larga del servicio' } })}::jsonb,
      ${`idem_pre_${suffix}`}, 'PENDING'::"BotOutboxStatus", NULL, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId",
      "sequence", "kind", "payload", "idempotencyKey", "status", "dependsOnSequence", "updatedAt")
    VALUES (${dependentId}, ${businessId}, ${depSessionId}, ${depTransitionId}, ${depDeliveryGroupId},
      1, 'interactive',
      ${JSON.stringify({ to: '5491155550000', item: { type: 'interactive', mode: 'buttons', body: 'Resumen',
        actionIds: [], buttons: [{ id: 'b1.test.btn1', title: 'Reservar' }] } })}::jsonb,
      ${`idem_dep_${suffix}`}, 'PENDING'::"BotOutboxStatus", 0, clock_timestamp())
  `)

  // Paso 1: claim el predecesor por el camino real.
  const predecessorClaim = await claimOutbox(prisma, 30_000, randomUUID(), { businessId })
  assert.equal(predecessorClaim?.id, predecessorId, 'predecessor must be claimable (PENDING)')
  assert.ok(predecessorClaim.claimToken, 'claim must return a claimToken')
  const otherOutboxStatus = await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT "status"::text AS "status" FROM "BotOutbox" WHERE "id" = ${otherStaleOutboxId}
  `)
  assert.equal(otherOutboxStatus[0]!.status, 'SENDING', 'scoped outbox maintenance must not mark another tenant UNKNOWN')

  // Paso 2: sendClaimedOutbox con provider que devuelve clear_failure retryable:false.
  // El sender real calcula: poison = !result.retryable (true) → POISON.
  const poisonResult = await sendClaimedOutbox({
    client: prisma,
    item: predecessorClaim,
    provider: {
      send: async () => ({ kind: 'clear_failure', code: 'provider_rejected', retryable: false })
    }
  })
  assert.equal(poisonResult, 'POISON', 'clear_failure retryable:false must produce POISON via real sender path')

  // Paso 3: verificar status POISON en la tabla (camino real, no UPDATE directo).
  const preStatus = await prisma.$queryRaw<Array<{ status: string }>>(
    Prisma.sql`SELECT "status"::text AS status FROM "BotOutbox" WHERE "id" = ${predecessorId}`
  )
  assert.equal(preStatus[0]!.status, 'POISON', 'predecessor must be POISON after sendClaimedOutbox')

  // Paso 4: claimOutbox no debe poder reclamar el dependiente porque su predecesor es POISON.
  // La claim query exige ACCEPTED/DELIVERED/READ/SKIPPED; POISON no califica.
  // En este fixture aislado (sólo 2 outbox items), null = no hay items claimables.
  const blockedClaim = await claimOutbox(prisma, 30_000, randomUUID(), { businessId })
  assert.equal(blockedClaim, null,
    'no outbox item claimable when predecessor is POISON (dependent blocked by dependency check)')

  // Paso 5: afirmar que el dependiente sigue PENDING sin haber sido mutado.
  const depStatus = await prisma.$queryRaw<Array<{ status: string }>>(
    Prisma.sql`SELECT "status"::text AS status FROM "BotOutbox" WHERE "id" = ${dependentId}`
  )
  assert.equal(depStatus[0]!.status, 'PENDING',
    'dependent must remain PENDING when predecessor is POISON')

  // ─── F5.5 PG: revalidación de servicio contra DB y desactivación concurrente ─
  //
  // Verifica que getService revalide businessId y serviceId contra la DB,
  // y que un servicio desactivado entre render y click sea rechazado.
  // reglas-funcionales.md §3.1: "no usa snapshot stale ni lo agrega".

  // a) Servicio reservable con precio: getService retorna el item correcto.
  const bookableDetail = await repository.getService({ businessId, serviceId })
  assert.ok(bookableDetail, 'getService debe retornar servicio reservable')
  assert.equal(bookableDetail!.id, serviceId)
  assert.equal(bookableDetail!.isBookable, true)
  assert.equal(bookableDetail!.requiresConsultation, false, 'servicio con attentionMode DIRECTBooking no requiere consulta')

  // b) Servicio con atención guiada: requiresConsultation = true.
  const consultDetail = await repository.getService({ businessId, serviceId: variantId })
  assert.ok(consultDetail, 'getService debe retornar variante')
  assert.equal(consultDetail!.requiresConsultation, true, 'servicio GUIDED_ESTIMATE requiere consulta')

  // c) Cross-tenant: getService para otro businessId retorna null.
  const crossTenant = await repository.getService({ businessId: otherBusinessId, serviceId })
  assert.equal(crossTenant, null, 'getService es tenant-scoped: cross-tenant retorna null')

  // d) Desactivación concurrente: desactivar el servicio y verificar que getService retorna null.
  await prisma.service.update({ where: { id: serviceId }, data: { isBookable: false } })
  const deactivated = await repository.getService({ businessId, serviceId })
  assert.equal(deactivated, null, 'getService retorna null después de desactivación concurrente')

  // e) Restaurar el servicio para cleanup.
  await prisma.service.update({ where: { id: serviceId }, data: { isBookable: true } })

  console.log('OK F5.3 catalog: tenant isolation, subcategories, real services and seven-row pagination satisfy the contract.')
  console.log('OK F5.4 catalog PG: claimOutbox → sendClaimedOutbox(clear_failure retryable:false) → POISON → dependent blocked.')
  console.log('OK F5.5 catalog PG: revalidación tenant-scoped, requiresConsultation, cross-tenant y desactivación concurrente.')
  console.log('OK scoped claims: job/outbox maintenance left another tenant sentinel unchanged.')
} finally {
  // Cleanup in reverse dependency order by exact IDs — no wildcards, no global deletes.
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotOutbox" WHERE "id" IN (${predecessorId}, ${dependentId})`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotOutbox" WHERE "id" = ${otherStaleOutboxId}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotJob" WHERE "id" = ${otherExpiredJobId}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "id" = ${depSessionId}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "id" = ${otherDepSessionId}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "id" = ${depConversationId}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "id" = ${otherDepConversationId}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "id" = ${depDeploymentId}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "id" = ${otherDepDeploymentId}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "id" = ${depConfigId}`).catch(() => undefined)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "id" = ${otherDepConfigId}`).catch(() => undefined)
  await prisma.service.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } }).catch(() => undefined)
  await prisma.serviceCategory.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } }).catch(() => undefined)
  await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } }).catch(() => undefined)
  await prisma.$disconnect()
}
