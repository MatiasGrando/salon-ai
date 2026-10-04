import { Prisma } from '../generated/prisma/client.js'
import { computeExceptionWindow } from '../bot-options/application/hours-queries.js'
import type { CommercialHoursSnapshot } from './business-time-context.js'
import type { DialogueContext } from './engine.js'

export class PublicSourceIntegrityError extends Error {}
type StampClient = { $queryRaw<T>(query: Prisma.Sql): Promise<T> }
/** One database snapshot covers only inputs to the current public loaders, never appointments or secrets. */
export async function readPublicSourceSnapshot(client: StampClient, context: DialogueContext): Promise<CommercialHoursSnapshot> {
  const { from, to } = computeExceptionWindow(context.dbNow, context.timezone)
  const rows = await client.$queryRaw<Array<{ businessId: string; timezone: string; stamp: string; weeklyHours?: unknown; globalBlocks?: unknown }>>(Prisma.sql`
    /* conversational-public-source-stamp */
    SELECT b."id" AS "businessId", settings."timezone", encode(sha256(convert_to(jsonb_build_array(
      jsonb_build_array(b."id", b."name", b."publicAddress", b."publicAddressArea", b."publicMapsUrl", b."publicWhatsapp",
        b."contactEmail", b."workshopPublicSiteUrl", b."instagramUrl", b."facebookUrl", b."tiktokUrl", b."landingDescription", personality."assistantPersonality"->>'commercialName'),
      settings."timezone", ${context.timezone}::text, ${from}::timestamp, ${to}::timestamp,
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(c."id", c."name", c."sortOrder", c."isActive") ORDER BY c."id"), '[]'::jsonb)
        FROM "ServiceCategory" c WHERE c."businessId" = b."id"),
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(s."id", s."catalogCategoryId", s."parentServiceId", s."name", s."description",
        s."duration", s."customerDurationMin", s."customerDurationMax", s."price", s."priceMode", s."isBookable", s."isActive", s."sortOrder",
        s."attentionMode", s."estimateAllowsBooking", s."estimateQuestion", s."estimateOptions", s."estimateExplanation", s."estimateDisclaimer",
        s."requiresPhoto", s."validationEnabled", s."validationMessage", s."validationQuestion") ORDER BY s."id"), '[]'::jsonb)
        FROM "Service" s WHERE s."businessId" = b."id"),
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(p."id", p."name", p."description", p."isActive", p."acceptsBotBookings") ORDER BY p."id"), '[]'::jsonb)
        FROM "Professional" p WHERE p."businessId" = b."id"),
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(ps."id", ps."serviceId", ps."professionalId") ORDER BY ps."id"), '[]'::jsonb)
        FROM "ProfessionalService" ps JOIN "Service" s ON s."id" = ps."serviceId" AND s."businessId" = b."id"
        JOIN "Professional" p ON p."id" = ps."professionalId" AND p."businessId" = b."id"),
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(ph."id", ph."professionalId", ph."dayOfWeek", ph."startTime", ph."endTime") ORDER BY ph."id"), '[]'::jsonb)
        FROM "ProfessionalHours" ph JOIN "Professional" p ON p."id" = ph."professionalId" AND p."businessId" = b."id"),
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(pm."id", pm."name", pm."position", pm."isActive") ORDER BY pm."id"), '[]'::jsonb)
        FROM "BusinessPaymentMethod" pm WHERE pm."businessId" = b."id"),
      (SELECT COALESCE(jsonb_agg(jsonb_build_array(pe."id", pe."professionalId", pe."startAt", pe."endAt") ORDER BY pe."id"), '[]'::jsonb)
        FROM "ScheduleBlock" pe JOIN "Professional" p ON p."id" = pe."professionalId" AND p."businessId" = b."id"
        WHERE pe."businessId" = b."id" AND pe."startAt" < ${to} AND pe."endAt" > ${from}),
      commercial."fingerprint", exceptions."fingerprint"
    )::text, 'UTF8')), 'hex') AS "stamp",
      commercial."weeklyHours", exceptions."globalBlocks"
    FROM "Business" b JOIN "BusinessBotOptionsSettings" settings ON settings."businessId" = b."id"
    LEFT JOIN "BusinessFeatureSettings" personality ON personality."businessId" = b."id"
    LEFT JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(jsonb_build_array(h."id", h."dayOfWeek", h."startTime", h."endTime") ORDER BY h."id"), '[]'::jsonb) AS "fingerprint",
        COALESCE(jsonb_agg(jsonb_build_object('dayOfWeek', h."dayOfWeek", 'startTime', h."startTime", 'endTime', h."endTime") ORDER BY h."id"), '[]'::jsonb) AS "weeklyHours"
      FROM "BusinessHours" h WHERE h."businessId" = b."id"
    ) commercial ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(jsonb_build_array(e."id", e."startAt", e."endAt", e."reason", e."title") ORDER BY e."id"), '[]'::jsonb) AS "fingerprint",
        COALESCE(jsonb_agg(jsonb_build_object(
          'startAt', to_char(e."startAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'endAt', to_char(e."endAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY e."id"), '[]'::jsonb) AS "globalBlocks"
      FROM "ScheduleBlock" e WHERE e."businessId" = b."id" AND e."professionalId" IS NULL
        AND e."startAt" < ${to} AND e."endAt" > ${from}
    ) exceptions ON true
    WHERE b."id" = ${context.businessId}
  `)
  const row = rows[0]
  if (rows.length !== 1 || row?.businessId !== context.businessId || typeof row.stamp !== 'string' || !/^[a-f0-9]{64}$/.test(row.stamp)) throw new PublicSourceIntegrityError('invalid public source scope')
  if (row.timezone !== context.timezone) throw new PublicSourceIntegrityError('public source timezone changed')
  return {businessId:row.businessId,timezone:row.timezone,stamp:row.stamp,from,to,weeklyHours:row.weeklyHours,globalBlocks:row.globalBlocks}
}
/** Compatibility wrapper retains the durable fingerprint contract. */
export async function readPublicSourceStamp(client: StampClient, context: DialogueContext): Promise<string> {
  return (await readPublicSourceSnapshot(client,context)).stamp
}
export type PublicSnapshotClient<TClient> = { $transaction<T>(body: (tx: TClient & { $executeRaw(query: Prisma.Sql): Promise<unknown> }) => Promise<T>, options: { isolationLevel: 'RepeatableRead'; maxWait: number; timeout: number }): Promise<T> }
/** Loaders cannot escape this read-only snapshot; its stamp always describes its own rows. */
export async function loadReadonlyPublicSnapshot<T, TClient>(client: PublicSnapshotClient<TClient>, load: (tx: TClient) => Promise<T>): Promise<T> {
  return client.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`)
    return load(tx)
  }, { isolationLevel: 'RepeatableRead', maxWait: 2_000, timeout: 10_000 })
}
