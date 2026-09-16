import assert from 'node:assert/strict'
import {
  FORM_FIELD_CATALOG,
  FORM_SCHEMA_VERSION,
  LeadFormDomainError,
  createSubmissionFingerprint,
  normalizeLeadFormAnswers,
  parsePublishedLeadFormSchema,
  validateLeadFormSchema
} from '../src/services/lead-form-domain.js'

function rejectsCode(run: () => unknown, code: string, field?: string) {
  assert.throws(run, (error) => {
    if (!(error instanceof LeadFormDomainError) || error.code !== code) return false
    return field === undefined || error.issues.some((issue) => issue.field === field)
  })
}

assert.equal(FORM_SCHEMA_VERSION, 1)
assert.deepEqual(Object.keys(FORM_FIELD_CATALOG), [
  'TEXT',
  'TEXTAREA',
  'EMAIL',
  'PHONE',
  'NUMBER',
  'SELECT',
  'RADIO',
  'CHECKBOX'
])

const schema = parsePublishedLeadFormSchema({
  schemaVersion: 1,
  fields: [
    { key: 'budget', label: 'Presupuesto', type: 'NUMBER', required: false, order: 4, mapping: { target: 'CUSTOM_DATA', customKey: 'budget' } },
    { key: 'name', label: 'Nombre', type: 'TEXT', required: true, order: 0, mapping: { target: 'CONTACT_NAME' } },
    { key: 'email', label: 'Email', type: 'EMAIL', required: true, order: 1, mapping: { target: 'EMAIL' } },
    { key: 'phone', label: 'WhatsApp', type: 'PHONE', required: true, order: 2, mapping: { target: 'PHONE' } },
    { key: 'goal', label: 'Objetivo', type: 'SELECT', required: true, order: 3, options: [
      { value: 'sell_more', label: 'Vender más' },
      { value: 'organize', label: 'Ordenarme' }
    ], mapping: { target: 'CUSTOM_DATA', customKey: 'goal' } },
    { key: 'newsletter', label: 'Acepto novedades', type: 'CHECKBOX', required: false, order: 5 }
  ]
})

assert.deepEqual(schema.fields.map((field) => field.key), ['name', 'email', 'phone', 'goal', 'budget', 'newsletter'])
assert.equal(schema.fields[3]?.options?.[0]?.value, 'sell_more')

const normalized = normalizeLeadFormAnswers(schema, {
  budget: '1250.50',
  newsletter: true,
  goal: 'sell_more',
  phone: '+54 9 11 5555-1234',
  email: '  PERSONA@Ejemplo.COM ',
  name: '  Ana Pérez  '
})
assert.deepEqual(normalized.answers, {
  name: 'Ana Pérez',
  email: 'persona@ejemplo.com',
  phone: '5491155551234',
  goal: 'sell_more',
  budget: 1250.5,
  newsletter: true
})
assert.deepEqual(normalized.leadFields, {
  contactName: 'Ana Pérez',
  email: 'persona@ejemplo.com',
  normalizedEmail: 'persona@ejemplo.com',
  phone: '5491155551234',
  normalizedPhone: '5491155551234'
})
assert.deepEqual(normalized.customData, { budget: 1250.5, goal: 'sell_more' })

const optional = normalizeLeadFormAnswers(schema, {
  name: 'Ana',
  email: 'ana@example.com',
  phone: '11 4444 5555',
  goal: 'organize',
  budget: '',
  newsletter: false
})
assert.deepEqual(optional.answers, {
  name: 'Ana', email: 'ana@example.com', phone: '1144445555', goal: 'organize', newsletter: false
})
assert.deepEqual(optional.customData, { goal: 'organize' })

const commercialSchema = parsePublishedLeadFormSchema({
  schemaVersion: 1,
  fields: [
    { key: 'title', label: 'Título', type: 'TEXT', required: true, order: 0, mapping: { target: 'TITLE' } },
    { key: 'value', label: 'Valor', type: 'NUMBER', required: true, order: 1, mapping: { target: 'ESTIMATED_VALUE' } },
    { key: 'priority', label: 'Prioridad', type: 'RADIO', required: true, order: 2, options: [
      { value: 'LOW', label: 'Baja' }, { value: 'HIGH', label: 'Alta' }
    ], mapping: { target: 'PRIORITY' } }
  ]
})
assert.deepEqual(normalizeLeadFormAnswers(commercialSchema, {
  title: ' Consulta curso ', value: '99.90', priority: 'HIGH'
}).leadFields, { title: 'Consulta curso', estimatedValue: 99.9, priority: 'HIGH' })
rejectsCode(
  () => normalizeLeadFormAnswers(commercialSchema, { title: 'Consulta', value: '-1', priority: 'HIGH' }),
  'INVALID_FORM_ANSWERS',
  'answers.value'
)

rejectsCode(
  () => normalizeLeadFormAnswers(schema, { name: '', email: 'malo', phone: '12', goal: 'unknown', unexpected: 'x' }),
  'INVALID_FORM_ANSWERS',
  'answers.name'
)
rejectsCode(
  () => normalizeLeadFormAnswers(schema, { name: 'Ana', email: 'ana@example.com', phone: '1144445555', goal: 'unknown' }),
  'INVALID_FORM_ANSWERS',
  'answers.goal'
)

const invalidSchema = validateLeadFormSchema({
  schemaVersion: 99,
  fields: [
    { key: 'name', label: 'Nombre', type: 'MAGIC', required: true, order: 0, mapping: { target: 'EMAIL' } },
    { key: 'name', label: 'Duplicado', type: 'TEXT', required: false, order: 0, options: [{ value: 'x', label: 'X' }] },
    { key: 'choice', label: 'Elegí', type: 'SELECT', required: true, order: 2, options: [] },
    { key: 'other_email', label: 'Otro email', type: 'EMAIL', required: false, order: 3, mapping: { target: 'EMAIL' } },
    { key: 'private', label: 'Dato', type: 'TEXT', required: false, order: 4, mapping: { target: 'CUSTOM_DATA', customKey: '__proto__' } }
  ]
})
assert.equal(invalidSchema.ok, false)
if (!invalidSchema.ok) {
  const issueFields = invalidSchema.issues.map((issue) => issue.field)
  assert.ok(issueFields.includes('schemaVersion'))
  assert.ok(issueFields.includes('fields[0].type'))
  assert.ok(issueFields.includes('fields[1].key'))
  assert.ok(issueFields.includes('fields[1].order'))
  assert.ok(issueFields.includes('fields[1].options'))
  assert.ok(issueFields.includes('fields[2].options'))
  assert.ok(issueFields.includes('fields[3].mapping.target'))
  assert.ok(issueFields.includes('fields[4].mapping.customKey'))
}
rejectsCode(() => parsePublishedLeadFormSchema({ schemaVersion: 2, fields: [] }), 'INVALID_FORM_SCHEMA', 'schemaVersion')

const a = createSubmissionFingerprint({
  schemaVersion: 1,
  answers: { name: 'Ana', tags: ['a', 'b'], nested: { z: true, a: 1 } }
})
const b = createSubmissionFingerprint({
  answers: { nested: { a: 1, z: true }, tags: ['a', 'b'], name: 'Ana' },
  schemaVersion: 1
})
const c = createSubmissionFingerprint({
  schemaVersion: 1,
  answers: { name: 'Ana', tags: ['b', 'a'], nested: { z: true, a: 1 } }
})
assert.match(a, /^[a-f0-9]{64}$/)
assert.equal(a, b)
assert.notEqual(a, c)
rejectsCode(() => createSubmissionFingerprint({ answers: { value: Number.NaN } }), 'INVALID_FINGERPRINT_PAYLOAD')

console.log('lead-form-domain-contract-test: ok')
