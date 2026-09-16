import { createHash } from 'node:crypto'

export const FORM_SCHEMA_VERSION = 1 as const

export const FORM_FIELD_CATALOG = {
  TEXT: { answerKind: 'string', options: false, maxLength: 500 },
  TEXTAREA: { answerKind: 'string', options: false, maxLength: 5000 },
  EMAIL: { answerKind: 'string', options: false, maxLength: 320 },
  PHONE: { answerKind: 'string', options: false, maxLength: 40 },
  NUMBER: { answerKind: 'number', options: false },
  SELECT: { answerKind: 'string', options: true },
  RADIO: { answerKind: 'string', options: true },
  CHECKBOX: { answerKind: 'boolean', options: false }
} as const

export type LeadFormFieldType = keyof typeof FORM_FIELD_CATALOG
export type LeadFieldTarget =
  | 'TITLE'
  | 'CONTACT_NAME'
  | 'COMPANY_NAME'
  | 'EMAIL'
  | 'PHONE'
  | 'ESTIMATED_VALUE'
  | 'PRIORITY'
  | 'SOURCE'
  | 'EXTERNAL_REFERENCE'

export type LeadFormFieldMapping =
  | { target: LeadFieldTarget }
  | { target: 'CUSTOM_DATA'; customKey: string }

export type LeadFormOption = Readonly<{ value: string; label: string }>
export type LeadFormField = Readonly<{
  key: string
  label: string
  type: LeadFormFieldType
  required: boolean
  order: number
  options?: readonly LeadFormOption[]
  mapping?: LeadFormFieldMapping
}>

export type LeadFormSchema = Readonly<{
  schemaVersion: typeof FORM_SCHEMA_VERSION
  fields: readonly LeadFormField[]
}>

export type LeadFormIssue = Readonly<{
  field: string
  reason: string
}>

export class LeadFormDomainError extends Error {
  constructor(
    public readonly code: 'INVALID_FORM_SCHEMA' | 'INVALID_FORM_ANSWERS' | 'INVALID_FINGERPRINT_PAYLOAD',
    public readonly issues: readonly LeadFormIssue[] = []
  ) {
    super(code)
    this.name = 'LeadFormDomainError'
  }
}

export type LeadFormSchemaValidation =
  | { ok: true; schema: LeadFormSchema }
  | { ok: false; issues: readonly LeadFormIssue[] }

const LEAD_TARGET_KEYS: Record<LeadFieldTarget, string> = {
  TITLE: 'title',
  CONTACT_NAME: 'contactName',
  COMPANY_NAME: 'companyName',
  EMAIL: 'email',
  PHONE: 'phone',
  ESTIMATED_VALUE: 'estimatedValue',
  PRIORITY: 'priority',
  SOURCE: 'source',
  EXTERNAL_REFERENCE: 'externalReference'
}

const ALLOWED_TARGETS: Record<LeadFormFieldType, ReadonlySet<LeadFieldTarget | 'CUSTOM_DATA'>> = {
  TEXT: new Set(['TITLE', 'CONTACT_NAME', 'COMPANY_NAME', 'SOURCE', 'EXTERNAL_REFERENCE', 'CUSTOM_DATA']),
  TEXTAREA: new Set(['CUSTOM_DATA']),
  EMAIL: new Set(['EMAIL', 'CUSTOM_DATA']),
  PHONE: new Set(['PHONE', 'CUSTOM_DATA']),
  NUMBER: new Set(['ESTIMATED_VALUE', 'CUSTOM_DATA']),
  SELECT: new Set(['PRIORITY', 'SOURCE', 'CUSTOM_DATA']),
  RADIO: new Set(['PRIORITY', 'SOURCE', 'CUSTOM_DATA']),
  CHECKBOX: new Set(['CUSTOM_DATA'])
}

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function issue(field: string, reason: string): LeadFormIssue {
  return { field, reason }
}

function boundedTrimmed(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : null
}

export function validateLeadFormSchema(input: unknown): LeadFormSchemaValidation {
  const issues: LeadFormIssue[] = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, issues: [issue('schema', 'must_be_object')] }
  }

  const candidate = input as Record<string, unknown>
  if (candidate.schemaVersion !== FORM_SCHEMA_VERSION) issues.push(issue('schemaVersion', 'unsupported_version'))
  if (!Array.isArray(candidate.fields) || candidate.fields.length === 0 || candidate.fields.length > 100) {
    issues.push(issue('fields', 'invalid_size'))
    return { ok: false, issues }
  }

  const fields: LeadFormField[] = []
  const seenKeys = new Set<string>()
  const seenOrders = new Set<number>()
  const seenTargets = new Set<LeadFieldTarget>()
  const seenCustomKeys = new Set<string>()

  candidate.fields.forEach((rawField, index) => {
    const prefix = `fields[${index}]`
    if (!rawField || typeof rawField !== 'object' || Array.isArray(rawField)) {
      issues.push(issue(prefix, 'must_be_object'))
      return
    }
    const raw = rawField as Record<string, unknown>
    const key = typeof raw.key === 'string' ? raw.key.trim() : ''
    if (!KEY_PATTERN.test(key) || RESERVED_OBJECT_KEYS.has(key)) issues.push(issue(`${prefix}.key`, 'invalid_key'))
    else if (seenKeys.has(key)) issues.push(issue(`${prefix}.key`, 'duplicate'))
    else seenKeys.add(key)

    const label = boundedTrimmed(raw.label, 160)
    if (label === null) issues.push(issue(`${prefix}.label`, 'invalid_label'))

    const type = typeof raw.type === 'string' && raw.type in FORM_FIELD_CATALOG
      ? raw.type as LeadFormFieldType
      : null
    if (type === null) issues.push(issue(`${prefix}.type`, 'unknown_type'))
    if (typeof raw.required !== 'boolean') issues.push(issue(`${prefix}.required`, 'must_be_boolean'))

    const order = raw.order
    if (!Number.isSafeInteger(order) || (order as number) < 0 || (order as number) >= candidate.fields.length) {
      issues.push(issue(`${prefix}.order`, 'invalid_order'))
    } else if (seenOrders.has(order as number)) {
      issues.push(issue(`${prefix}.order`, 'duplicate'))
    } else {
      seenOrders.add(order as number)
    }

    let options: LeadFormOption[] | undefined
    if (type && FORM_FIELD_CATALOG[type].options) {
      if (!Array.isArray(raw.options) || raw.options.length === 0 || raw.options.length > 100) {
        issues.push(issue(`${prefix}.options`, 'required'))
      } else {
        options = []
        const values = new Set<string>()
        raw.options.forEach((rawOption, optionIndex) => {
          const optionPrefix = `${prefix}.options[${optionIndex}]`
          if (!rawOption || typeof rawOption !== 'object' || Array.isArray(rawOption)) {
            issues.push(issue(optionPrefix, 'must_be_object'))
            return
          }
          const option = rawOption as Record<string, unknown>
          const value = boundedTrimmed(option.value, 120)
          const optionLabel = boundedTrimmed(option.label, 160)
          if (value === null) issues.push(issue(`${optionPrefix}.value`, 'invalid_value'))
          else if (values.has(value)) issues.push(issue(`${optionPrefix}.value`, 'duplicate'))
          else values.add(value)
          if (optionLabel === null) issues.push(issue(`${optionPrefix}.label`, 'invalid_label'))
          if (value !== null && optionLabel !== null) options!.push({ value, label: optionLabel })
        })
      }
    } else if (raw.options !== undefined) {
      issues.push(issue(`${prefix}.options`, 'not_supported'))
    }

    let mapping: LeadFormFieldMapping | undefined
    if (raw.mapping !== undefined) {
      if (!raw.mapping || typeof raw.mapping !== 'object' || Array.isArray(raw.mapping)) {
        issues.push(issue(`${prefix}.mapping`, 'must_be_object'))
      } else {
        const rawMapping = raw.mapping as Record<string, unknown>
        const target = rawMapping.target
        if (typeof target !== 'string' || (target !== 'CUSTOM_DATA' && !(target in LEAD_TARGET_KEYS))) {
          issues.push(issue(`${prefix}.mapping.target`, 'unknown_target'))
        } else if (type && !ALLOWED_TARGETS[type].has(target as LeadFieldTarget | 'CUSTOM_DATA')) {
          issues.push(issue(`${prefix}.mapping.target`, 'incompatible_type'))
        } else if (target === 'CUSTOM_DATA') {
          const customKey = typeof rawMapping.customKey === 'string' ? rawMapping.customKey.trim() : ''
          if (!KEY_PATTERN.test(customKey) || RESERVED_OBJECT_KEYS.has(customKey)) {
            issues.push(issue(`${prefix}.mapping.customKey`, 'invalid_key'))
          } else if (seenCustomKeys.has(customKey)) {
            issues.push(issue(`${prefix}.mapping.customKey`, 'duplicate'))
          } else {
            seenCustomKeys.add(customKey)
            mapping = { target, customKey }
          }
        } else {
          const typedTarget = target as LeadFieldTarget
          if (seenTargets.has(typedTarget)) issues.push(issue(`${prefix}.mapping.target`, 'duplicate'))
          else {
            seenTargets.add(typedTarget)
            mapping = { target: typedTarget }
          }
        }
      }
    }

    if (key && label !== null && type && typeof raw.required === 'boolean' && Number.isSafeInteger(order)) {
      fields.push({
        key,
        label,
        type,
        required: raw.required,
        order: order as number,
        ...(options ? { options } : {}),
        ...(mapping ? { mapping } : {})
      })
    }
  })

  if (issues.length > 0) return { ok: false, issues }
  fields.sort((left, right) => left.order - right.order)
  return { ok: true, schema: { schemaVersion: FORM_SCHEMA_VERSION, fields } }
}

export function parsePublishedLeadFormSchema(input: unknown): LeadFormSchema {
  const result = validateLeadFormSchema(input)
  if (!result.ok) throw new LeadFormDomainError('INVALID_FORM_SCHEMA', result.issues)
  return result.schema
}

function normalizeAnswer(field: LeadFormField, value: unknown): unknown {
  if (field.type === 'CHECKBOX') return typeof value === 'boolean' ? value : undefined
  if (field.type === 'NUMBER') {
    const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
    return Number.isFinite(number) ? number : undefined
  }
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text) return undefined
  if (field.type === 'EMAIL') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text.toLowerCase() : undefined
  if (field.type === 'PHONE') {
    const digits = text.replace(/\D/g, '')
    return digits.length >= 7 && digits.length <= 15 ? digits : undefined
  }
  if (field.type === 'SELECT' || field.type === 'RADIO') {
    return field.options?.some((option) => option.value === text) ? text : undefined
  }
  const maxLength = FORM_FIELD_CATALOG[field.type].maxLength
  return text.length <= maxLength ? text : undefined
}

export type NormalizedLeadFormAnswers = Readonly<{
  answers: Readonly<Record<string, unknown>>
  leadFields: Readonly<Record<string, unknown>>
  customData: Readonly<Record<string, unknown>>
}>

export function normalizeLeadFormAnswers(schema: LeadFormSchema, input: unknown): NormalizedLeadFormAnswers {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new LeadFormDomainError('INVALID_FORM_ANSWERS', [issue('answers', 'must_be_object')])
  }
  const rawAnswers = input as Record<string, unknown>
  const issues: LeadFormIssue[] = []
  const answers: Record<string, unknown> = {}
  const leadFields: Record<string, unknown> = {}
  const customData: Record<string, unknown> = {}
  const knownKeys = new Set(schema.fields.map((field) => field.key))

  for (const key of Object.keys(rawAnswers)) {
    if (!knownKeys.has(key)) issues.push(issue(`answers.${key}`, 'unknown_field'))
  }
  for (const field of schema.fields) {
    const supplied = Object.prototype.hasOwnProperty.call(rawAnswers, field.key)
    const rawValue = rawAnswers[field.key]
    const optionalBlank = !field.required && (rawValue === undefined || rawValue === null || rawValue === '')
    if (optionalBlank) continue
    let normalized = supplied ? normalizeAnswer(field, rawValue) : undefined
    if (field.mapping?.target === 'ESTIMATED_VALUE' && typeof normalized === 'number') {
      const cents = normalized * 100
      if (normalized < 0 || normalized > 9_999_999_999.99 || Math.abs(cents - Math.round(cents)) > 1e-8) {
        normalized = undefined
      }
    }
    if (field.mapping?.target === 'PRIORITY' && !['LOW', 'MEDIUM', 'HIGH'].includes(String(normalized))) {
      normalized = undefined
    }
    if (normalized === undefined || (field.type === 'CHECKBOX' && field.required && normalized !== true)) {
      if (field.required || supplied) issues.push(issue(`answers.${field.key}`, 'invalid_value'))
      continue
    }
    answers[field.key] = normalized
    if (!field.mapping) continue
    if (field.mapping.target === 'CUSTOM_DATA') {
      customData[field.mapping.customKey] = normalized
      continue
    }
    const targetKey = LEAD_TARGET_KEYS[field.mapping.target]
    leadFields[targetKey] = normalized
    if (field.mapping.target === 'EMAIL') leadFields.normalizedEmail = normalized
    if (field.mapping.target === 'PHONE') leadFields.normalizedPhone = normalized
  }
  if (issues.length > 0) throw new LeadFormDomainError('INVALID_FORM_ANSWERS', issues)
  return { answers, leadFields, customData }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.some(([, item]) => item === undefined)) throw new LeadFormDomainError('INVALID_FINGERPRINT_PAYLOAD')
    return `{${entries.sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  throw new LeadFormDomainError('INVALID_FINGERPRINT_PAYLOAD')
}

export function createSubmissionFingerprint(payload: unknown) {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex')
}
