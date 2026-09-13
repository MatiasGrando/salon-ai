export type PipelineLeadLifecycle = 'OPEN' | 'WON' | 'LOST' | 'NO_RESPONSE'
export type PipelineLeadPriority = 'LOW' | 'MEDIUM' | 'HIGH'
export type PipelineActivityKind = 'NOTE' | 'FOLLOW_UP' | 'CONTACT'
export type PipelineTaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE'
export type PipelineTaskCategory = 'BUSINESS' | 'MEETING' | 'PERSONAL' | 'OPERATIONS'

const LIFECYCLES = ['OPEN', 'WON', 'LOST', 'NO_RESPONSE'] as const
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const
const ACTIVITY_KINDS = ['NOTE', 'FOLLOW_UP', 'CONTACT'] as const
const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'] as const
const TASK_CATEGORIES = ['BUSINESS', 'MEETING', 'PERSONAL', 'OPERATIONS'] as const

export type PipelineErrorDetails = Readonly<Record<string, unknown>>

export class PipelineError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode = 422,
    public readonly details?: PipelineErrorDetails
  ) {
    super(code)
    this.name = 'PipelineError'
  }
}

export class PipelineDomainError extends PipelineError {
  constructor(code: string, statusCode = 422, details?: PipelineErrorDetails) {
    super(code, statusCode, details)
    this.name = 'PipelineDomainError'
  }
}

export type PipelineDto<T> =
  T extends bigint | Date ? string
    : T extends readonly (infer Item)[] ? PipelineDto<Item>[]
      : T extends object ? { [Key in keyof T]: PipelineDto<T[Key]> }
        : T

export function toPipelineDto<T>(value: T): PipelineDto<T> {
  if (typeof value === 'bigint') return value.toString() as PipelineDto<T>
  if (value instanceof Date) return value.toISOString() as PipelineDto<T>
  if (Array.isArray(value)) return value.map(toPipelineDto) as PipelineDto<T>
  if (value && typeof value === 'object') {
    const serializable = value as Record<string, unknown> & { toJSON?: () => unknown }
    if (typeof serializable.toJSON === 'function' && Object.getPrototypeOf(value) !== Object.prototype) {
      return toPipelineDto(serializable.toJSON()) as PipelineDto<T>
    }
    return Object.fromEntries(
      Object.entries(serializable)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, toPipelineDto(item)])
    ) as PipelineDto<T>
  }
  return value as PipelineDto<T>
}

export function toPipelineErrorDto(error: PipelineError) {
  return {
    error: error.code,
    code: error.code,
    ...(error.details ? { details: toPipelineDto(error.details) } : {})
  }
}

function parseBoundedText(value: unknown, code: string, maxLength: number) {
  if (typeof value !== 'string') throw new PipelineDomainError(code)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) throw new PipelineDomainError(code)
  return normalized
}

function parseEnum<const T extends readonly string[]>(value: unknown, values: T, code: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) throw new PipelineDomainError(code)
  return value as T[number]
}

export const parsePipelineName = (value: unknown) => parseBoundedText(value, 'INVALID_PIPELINE_NAME', 100)
export const parseStageName = (value: unknown) => parseBoundedText(value, 'INVALID_STAGE_NAME', 80)
export const parseLeadTitle = (value: unknown) => parseBoundedText(value, 'INVALID_LEAD_TITLE', 160)
export const parseActivityBody = (value: unknown) => parseBoundedText(value, 'INVALID_ACTIVITY_BODY', 4000)
export const parseTaskTitle = (value: unknown) => parseBoundedText(value, 'INVALID_TASK_TITLE', 160)

export function parseOptionalText(value: unknown, maxLength: number, code = 'INVALID_TEXT') {
  if (value === undefined || value === null || value === '') return null
  return parseBoundedText(value, code, maxLength)
}

export function parseHexColor(value: unknown) {
  const color = parseBoundedText(value, 'INVALID_STAGE_COLOR', 7)
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new PipelineDomainError('INVALID_STAGE_COLOR')
  return color.toUpperCase()
}

export const parseLeadLifecycle = (value: unknown) => parseEnum(value, LIFECYCLES, 'INVALID_LEAD_LIFECYCLE')
export const parseLeadPriority = (value: unknown) => parseEnum(value, PRIORITIES, 'INVALID_LEAD_PRIORITY')
export const parseActivityKind = (value: unknown) => parseEnum(value, ACTIVITY_KINDS, 'INVALID_ACTIVITY_KIND')
export const parseTaskStatus = (value: unknown) => parseEnum(value, TASK_STATUSES, 'INVALID_TASK_STATUS')
export const parseTaskCategory = (value: unknown) => parseEnum(value, TASK_CATEGORIES, 'INVALID_TASK_CATEGORY')

export function parseRequiredId(value: unknown, code = 'INVALID_ID') {
  return parseBoundedText(value, code, 200)
}

export function parseOptionalId(value: unknown, code = 'INVALID_ID') {
  if (value === undefined || value === null || value === '') return null
  return parseRequiredId(value, code)
}

export function parseExpectedRevision(value: unknown) {
  try {
    const revision = typeof value === 'bigint'
      ? value
      : typeof value === 'number' && Number.isSafeInteger(value)
        ? BigInt(value)
        : typeof value === 'string' && /^\d+$/.test(value)
          ? BigInt(value)
          : -1n
    if (revision < 0n) throw new Error('negative')
    return revision
  } catch {
    throw new PipelineDomainError('INVALID_EXPECTED_REVISION', 400)
  }
}

export function parseUniqueIdList(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000) {
    throw new PipelineDomainError('INVALID_ID_LIST', 400)
  }
  const ids = value.map((id) => parseRequiredId(id))
  if (new Set(ids).size !== ids.length) throw new PipelineDomainError('DUPLICATE_IDS', 400)
  return ids
}

export function parseEstimatedValue(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 9_999_999_999.99) {
    throw new PipelineDomainError('INVALID_ESTIMATED_VALUE')
  }
  const cents = value * 100
  if (Math.abs(cents - Math.round(cents)) > 1e-8) throw new PipelineDomainError('INVALID_ESTIMATED_VALUE')
  return value
}

export function parseIsoInstant(value: unknown) {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new PipelineDomainError('INVALID_ABSOLUTE_INSTANT')
  }
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) throw new PipelineDomainError('INVALID_ABSOLUTE_INSTANT')
  return instant
}

export function normalizeEmail(value: unknown) {
  const email = parseOptionalText(value, 320, 'INVALID_EMAIL')
  if (email === null) return { email: null, normalizedEmail: null }
  const normalizedEmail = email.toLocaleLowerCase('en-US')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new PipelineDomainError('INVALID_EMAIL')
  return { email, normalizedEmail }
}

export function normalizePhone(value: unknown) {
  const phone = parseOptionalText(value, 40, 'INVALID_PHONE')
  if (phone === null) return { phone: null, normalizedPhone: null }
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) throw new PipelineDomainError('INVALID_PHONE')
  return { phone, normalizedPhone: digits }
}

export function assertAssignableUser<T extends { businessId: string | null; isActive: boolean; role: string }>(
  user: T | null,
  businessId: string
) {
  if (!user || !user.isActive || user.businessId !== businessId || user.role === 'SUPER_ADMIN') {
    throw new PipelineDomainError('INVALID_ASSIGNEE')
  }
  return user
}

export function assertCanArchiveStage(input: { activeStageCount: number; openLeadCount: number }) {
  if (input.activeStageCount <= 1) throw new PipelineDomainError('LAST_ACTIVE_STAGE', 409)
  if (input.openLeadCount > 0) throw new PipelineDomainError('STAGE_HAS_OPEN_LEADS', 409)
}

export function assertLifecycleTransition(from: PipelineLeadLifecycle, to: PipelineLeadLifecycle) {
  if (from === to) throw new PipelineDomainError('LEAD_LIFECYCLE_UNCHANGED')
  if (from !== 'OPEN' && to !== 'OPEN') throw new PipelineDomainError('INVALID_LEAD_LIFECYCLE_TRANSITION')
  return to
}

export function resolveReopenStage(input: { lastOpenStageId: string | null; activeStageIds: string[] }) {
  if (input.activeStageIds.length === 0) throw new PipelineDomainError('ACTIVE_STAGE_REQUIRED', 409)
  const activeStageIds = parseUniqueIdList(input.activeStageIds)
  if (input.lastOpenStageId && activeStageIds.includes(input.lastOpenStageId)) return input.lastOpenStageId
  return activeStageIds[0]!
}
