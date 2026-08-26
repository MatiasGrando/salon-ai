import { TextDecoder } from 'node:util'
import {
  extractUntrustedPhoneNumberIdCandidate,
  parseWhatsAppWebhookPayload,
  verifyMetaSignature,
  type ParsedWebhookEvent
} from '../infrastructure/meta-webhook-adapter.js'
import type {
  AuthoritativeAdmissionRepository,
  AuthoritativeRoute,
  ShadowAdmissionRepository,
  ShadowAdmissionTenant,
  ShadowEventInsert
} from '../infrastructure/prisma-admission.js'

export type AdmissionOutcome =
  | { status: 'admitted'; eventCount: number }
  | { status: 'duplicate'; eventCount: number }
  | { status: 'partial'; eventCount: number; insertedCount: number }
  | { status: 'unmatched' }
  | { status: 'ambiguous' }
  | { status: 'missing_secret' }
  | { status: 'invalid_signature' }
  | { status: 'malformed_payload' }

export type AdmitProviderEventsInput = {
  rawBody: Buffer
  signatureHeader: string | string[] | undefined
  traceId?: string
}

export interface ProviderEventAdmission {
  admit(input: AdmitProviderEventsInput): Promise<AdmissionOutcome>
}

export type AuthoritativeWebhookDecision =
  | { route: 'legacy' }
  | { route: 'new'; outcome: AdmissionOutcome }
  | { route: 'ambiguous' }

export interface AuthoritativeWebhookAdmission {
  routeAndAdmit(input: AdmitProviderEventsInput): Promise<AuthoritativeWebhookDecision>
}

type AdmissionDependencies = {
  repository: ShadowAdmissionRepository
  clock: () => Date
}

function parseJson(rawBody: Buffer): { ok: true; value: unknown } | { ok: false } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}

function usableSecrets(tenant: ShadowAdmissionTenant, now: Date) {
  const secrets: string[] = []
  if (tenant.appSecret?.trim()) secrets.push(tenant.appSecret)

  const previousIsValid = tenant.appSecretPreviousValidUntil !== null
    && tenant.appSecretPreviousValidUntil.getTime() >= now.getTime()
  if (previousIsValid && tenant.appSecretPrevious?.trim()) {
    secrets.push(tenant.appSecretPrevious)
  }

  return secrets
}

function isNewRoute(route: AuthoritativeRoute): route is Extract<AuthoritativeRoute, { kind: 'new' }> {
  return route.kind === 'new'
}

function redactEvent(event: ParsedWebhookEvent): Record<string, string | boolean | null> {
  if (event.kind === 'message') {
    return {
      kind: event.kind,
      messageType: event.messageType,
      hasInteractiveReply: event.interactiveReplyId !== null,
      mediaType: event.mediaType,
      hasProviderTimestamp: event.providerOccurredAtIso !== null
    }
  }

  if (event.kind === 'status') {
    return {
      kind: event.kind,
      status: event.status,
      hasError: event.errorMessage !== null,
      hasProviderTimestamp: event.providerOccurredAtIso !== null
    }
  }

  return { kind: event.kind }
}

function eventType(event: ParsedWebhookEvent): ShadowEventInsert['eventType'] {
  if (event.kind === 'message') return 'MESSAGE'
  if (event.kind === 'status') return 'STATUS'
  return 'UNSUPPORTED'
}

export async function admitProviderEvents(
  input: AdmitProviderEventsInput,
  dependencies: AdmissionDependencies
): Promise<AdmissionOutcome> {
  const untrustedJson = parseJson(input.rawBody)
  if (!untrustedJson.ok) return { status: 'malformed_payload' }

  const phoneNumberId = extractUntrustedPhoneNumberIdCandidate(input.rawBody)
  if (!phoneNumberId) return { status: 'unmatched' }

  const tenants = await dependencies.repository.findConnectedTenantsByPhoneNumberId(phoneNumberId)
  if (tenants.length === 0) return { status: 'unmatched' }
  if (tenants.length > 1) return { status: 'ambiguous' }

  const now = dependencies.clock()
  const secrets = usableSecrets(tenants[0]!, now)
  if (secrets.length === 0) return { status: 'missing_secret' }

  const signatureIsValid = secrets.some((appSecret) => verifyMetaSignature({
    rawBody: input.rawBody,
    signatureHeader: input.signatureHeader,
    appSecret
  }).ok)
  if (!signatureIsValid) return { status: 'invalid_signature' }

  const trustedJson = parseJson(input.rawBody)
  if (!trustedJson.ok) return { status: 'malformed_payload' }

  const events = parseWhatsAppWebhookPayload(trustedJson.value).events
  const inserts: ShadowEventInsert[] = events.map((event) => ({
    provider: 'WHATSAPP',
    eventKey: event.eventKey,
    businessId: tenants[0]!.businessId,
    phoneNumberId,
    eventType: eventType(event),
    payloadRedacted: redactEvent(event),
    observedAt: now,
    result: 'ADMITTED',
    ...(input.traceId ? { traceId: input.traceId } : {})
  }))
  const insertedCount = await dependencies.repository.insertShadowEvents(inserts)

  if (insertedCount === 0) return { status: 'duplicate', eventCount: events.length }
  if (insertedCount < events.length) {
    return { status: 'partial', eventCount: events.length, insertedCount }
  }
  return { status: 'admitted', eventCount: events.length }
}

export function createProviderEventAdmission(
  repository: ShadowAdmissionRepository,
  clock: () => Date = () => new Date()
): ProviderEventAdmission {
  return {
    admit: (input) => admitProviderEvents(input, { repository, clock })
  }
}

export function createAuthoritativeWebhookAdmission(
  repository: AuthoritativeAdmissionRepository,
  clock: () => Date = () => new Date()
): AuthoritativeWebhookAdmission {
  return {
    async routeAndAdmit(input) {
      const parsed = parseJson(input.rawBody)
      if (!parsed.ok) return { route: 'new', outcome: { status: 'malformed_payload' } }
      const phoneNumberId = extractUntrustedPhoneNumberIdCandidate(input.rawBody)
      if (!phoneNumberId) return { route: 'legacy' }
      const route = await repository.resolveRoute(phoneNumberId)
      if (route.kind === 'legacy') return { route: 'legacy' }
      if (route.kind === 'ambiguous') return { route: 'ambiguous' }
      if (!isNewRoute(route)) return { route: 'legacy' }

      const secrets = usableSecrets(route, clock())
      if (secrets.length === 0) return { route: 'new', outcome: { status: 'missing_secret' } }
      const valid = secrets.some((appSecret) => verifyMetaSignature({
        rawBody: input.rawBody,
        signatureHeader: input.signatureHeader,
        appSecret
      }).ok)
      if (!valid) return { route: 'new', outcome: { status: 'invalid_signature' } }

      const events = parseWhatsAppWebhookPayload(parsed.value).events
      const result = await repository.admitAuthoritative({
        route,
        phoneNumberId,
        events,
        ...(input.traceId ? { traceId: input.traceId } : {})
      })
      const outcome: AdmissionOutcome = result.insertedCount === 0
        ? { status: 'duplicate', eventCount: result.eventCount }
        : result.insertedCount === result.eventCount
          ? { status: 'admitted', eventCount: result.eventCount }
          : { status: 'partial', eventCount: result.eventCount, insertedCount: result.insertedCount }
      return { route: 'new', outcome }
    }
  }
}
