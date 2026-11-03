import { lockInstagramRuntimeActorTx, validRuntimeChannelIdentity, managementIdentityFromRuntime } from './conversation-subject.js'
import { Prisma } from '../generated/prisma/client.js'
import { normalizePhone } from '../services/phone-normalization-service.js'
import { loadCancellationGroupSnapshot, type RuntimeManagementContext } from './prisma-appointment-management.js'
import { ownAppointmentKey, type OwnAppointments } from './own-appointments.js'
import { GroupCancellationError } from './appointment-management.js'
/** Read-only recovery from verified channel identity. No receipt, consent or booking capability is invented. */
export async function loadOwnAppointments(tx: Pick<Prisma.TransactionClient,'$queryRaw'>, scope: RuntimeManagementContext): Promise<OwnAppointments> {
  if (!scope || !validRuntimeChannelIdentity(scope) || typeof scope.expectedRevision !== 'bigint' || scope.expectedRevision < 0n ||
    !scope.businessId || !scope.sessionId) throw new GroupCancellationError('invalid own appointment ownership scope')
  const instagramActor = scope.subject ? await lockInstagramRuntimeActorTx(tx,{businessId:scope.businessId,sessionId:scope.sessionId,subject:scope.subject,revision:scope.expectedRevision}) : null
  const sessions = scope.subject ? (instagramActor ? [instagramActor] : []) : await tx.$queryRaw<Array<{ phone?: string; customerId: string|null; state: unknown; dbNow: Date; businessTimezone:string }>>(Prisma.sql`
    SELECT co.phone,c.id AS "customerId",bs.state,bs."businessTimezone",clock_timestamp() AS "dbNow" FROM "BotSession" bs
    JOIN "Conversation" co ON co.id=bs."conversationId" AND co."businessId"=bs."businessId"
    LEFT JOIN "Customer" c ON c."businessId"=bs."businessId" AND c."normalizedPhone"=${scope.canonicalPhone}
    WHERE bs.id=${scope.sessionId} AND bs."businessId"=${scope.businessId} AND bs.revision=${scope.expectedRevision} AND bs.status='ACTIVE'`)
  const session = sessions[0], state = session?.state as { booking?: string; deposit?: string; handoff?: string }|undefined
  if (sessions.length !== 1 || !session || (!scope.subject && normalizePhone(('phone' in session ? session.phone : '')??'') !== scope.canonicalPhone) || state?.handoff !== 'NONE' ||
    !['NONE','DRAFT','CONFIRMED'].includes(state.booking ?? '') || !['NONE','APPROVED'].includes(state.deposit ?? ''))
    throw new GroupCancellationError('current own appointment ownership unavailable')
  const result: OwnAppointments = { businessId: scope.businessId, sessionId: scope.sessionId, revision: String(scope.expectedRevision),
    dbNow: new Date(session.dbNow).toISOString(), items: [], hasMore: false }
  if (!session.customerId) return result
  const anchors = await tx.$queryRaw<Array<{ appointmentId: string }>>(Prisma.sql`
    SELECT (array_agg(a.id ORDER BY a."startAt",a.id))[1] AS "appointmentId" FROM "Appointment" a
    WHERE a."businessId"=${scope.businessId} AND a."customerId"=${session.customerId} AND a.status='CONFIRMED' AND a."startAt">${session.dbNow}
    GROUP BY a."coordinationGroupId",CASE WHEN a."coordinationGroupId" IS NULL THEN a.id ELSE NULL END
    ORDER BY min(a."startAt"),min(a.id) LIMIT 11`)
  result.hasMore = anchors.length > 10
  for (const anchor of anchors.slice(0,10)) {
    const snapshot = await loadCancellationGroupSnapshot(tx as Prisma.TransactionClient, { businessId: scope.businessId, sessionId: scope.sessionId,
      customerId: session.customerId, ...managementIdentityFromRuntime(scope) }, anchor.appointmentId)
    if (snapshot.members.some(m=>m.depositId !== null && m.depositStatus !== 'APPROVED')) throw new GroupCancellationError('own group financial coherence unavailable')
    const ids = snapshot.members.map(m=>m.appointmentId)
    const labels = await tx.$queryRaw<Array<{ appointmentId: string; professionalName: string; serviceNames: string[] }>>(Prisma.sql`
      SELECT a.id AS "appointmentId",p.name AS "professionalName",COALESCE(NULLIF(ARRAY(
        SELECT s.name FROM "AppointmentServiceItem" i JOIN "Service" s ON s.id=i."serviceId" AND s."businessId"=${scope.businessId}
        WHERE i."appointmentId"=a.id ORDER BY i."sortOrder"),ARRAY[]::text[]),ARRAY[s.name]) AS "serviceNames"
      FROM "Appointment" a JOIN "Professional" p ON p.id=a."professionalId" AND p."businessId"=${scope.businessId}
      JOIN "Service" s ON s.id=a."serviceId" AND s."businessId"=${scope.businessId}
      WHERE a.id IN (${Prisma.join(ids)}) AND a."businessId"=${scope.businessId} AND a."customerId"=${session.customerId}`)
    if (labels.length !== snapshot.members.length) throw new GroupCancellationError('own group labels unavailable')
    const safe = (v: string) => typeof v === 'string' && !!v.trim() && v.length <= 200 && !/[\u0000-\u001f]/.test(v)
    if (labels.some(l=>!safe(l.professionalName) || !l.serviceNames.length || l.serviceNames.some(n=>!safe(n)))) throw new GroupCancellationError('own group labels invalid')
    const label = [...snapshot.members].sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt)).map(m=>{
      const l = labels.find(l=>l.appointmentId===m.appointmentId)!
      return l.serviceNames.join(' + ') + ' con ' + l.professionalName + ' · ' + new Intl.DateTimeFormat('es-AR', { timeZone: session.businessTimezone, dateStyle:'short',timeStyle:'short' }).format(new Date(m.startAt))
    }).join('\n')
    result.items.push({ key: ownAppointmentKey(snapshot), label, snapshot })
  }
  return result
}
