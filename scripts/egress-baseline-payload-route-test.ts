import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { classifyMetricSource, safeRouteTemplate } from '../src/observability/egress-baseline/route-classifier.js'
import { measurePayloadBytes } from '../src/observability/egress-baseline/payload-bytes.js'

assert.equal(classifyMetricSource('/crm/events'), 'crm')
assert.equal(classifyMetricSource('/webhooks/whatsapp'), 'webhook')
assert.equal(classifyMetricSource('/crm/conversations'), 'crm')
assert.equal(classifyMetricSource('/health'), 'public')
assert.equal(classifyMetricSource('/future/private'), 'unknown')
for (const route of ['/crm', '/crm/', '/admin/accounts', '/appointments', '/appointments/:id', '/availability/day', '/businesses', '/business-hours', '/campaigns', '/campaign-jobs', '/campaign-customer-options', '/campaign-deliveries', '/chat', '/customers', '/professional-hours', '/professionals', '/post-sale', '/reminder-automations', '/reports', '/schedule-blocks', '/service-categories', '/services', '/staff-users', '/whatsapp']) assert.equal(classifyMetricSource(route), 'crm', route)
for (const route of ['/', '/contacto', '/privacidad', '/politicas', '/terminos', '/registro', '/reservar', '/cuenta', '/auth/login', '/public/business', '/:slug', '/:slug/reservar', '/:slug/cuenta', '/landing-assets/:asset', '/weex/bot-v1', '/tamara-home', '/experience-demo', '/branding/logo', '/partners/list', '/testimonials/list', '/promocion-weex-agosto-2026', '/promocion-weex-agosto-2026/gracias']) assert.equal(classifyMetricSource(route), 'public', route)
assert.equal(classifyMetricSource('/webhooks/instagram'), 'webhook')
for (const route of ['/webhooks', '/webhooksx/instagram', '/administrator', '/appointments-extra', '/availabilityx/day', '/authentic/login', '/publicity/business', '/landing-assetsx/file', '/weex/bot-v1/extra', '/:slugger', '/promocion-weex-agosto-20260', '/brandingx/logo', '/partnersx/list', '/testimonialsx/list']) assert.equal(classifyMetricSource(route), 'unknown', route)
assert.equal(classifyMetricSource('/internal/future'), 'unknown', 'internal enum remains intentionally unused')
assert.equal(safeRouteTemplate(undefined), '__unmatched__')
assert.equal(safeRouteTemplate('/customers/:id'), '/customers/:id')
assert.equal(safeRouteTemplate('/customers/secret?token=x'), '__unknown_registered__')

assert.deepEqual(measurePayloadBytes('á', 'GET', 200), { bytes: 2, mode: 'serialized_string' })
assert.deepEqual(measurePayloadBytes(Buffer.from('abc'), 'GET', 200), { bytes: 3, mode: 'buffer' })
assert.deepEqual(measurePayloadBytes(new Uint8Array([1, 2]), 'GET', 200), { bytes: 2, mode: 'typed_array' })
assert.deepEqual(measurePayloadBytes(null, 'GET', 200), { bytes: 0, mode: 'zero_semantic' })
const typedArrayBeforeSerialization = new Uint8Array([1, 2])
const payloadAtObservationPoint: unknown = JSON.stringify(typedArrayBeforeSerialization)
assert.equal(typeof payloadAtObservationPoint, 'string')
assert.equal(payloadAtObservationPoint instanceof Uint8Array, false)
assert.equal(payloadAtObservationPoint, '{"0":1,"1":2}')
assert.deepEqual(measurePayloadBytes(payloadAtObservationPoint as string, 'GET', 200), { bytes: 13, mode: 'serialized_string' })
assert.deepEqual(measurePayloadBytes('body', 'HEAD', 200), { bytes: 0, mode: 'zero_semantic' })
assert.deepEqual(measurePayloadBytes('body', 'GET', 204), { bytes: 0, mode: 'zero_semantic' })
assert.deepEqual(measurePayloadBytes({ pipe() {} }, 'GET', 200), { bytes: null, mode: 'unknown' })
let observableReads = 0
const observableStream = new Readable({ read() { observableReads++; this.push('private-stream'); this.push(null) } })
const listenersBefore = observableStream.eventNames().length
const streamMeasurement = measurePayloadBytes(observableStream, 'GET', 200)
assert.deepEqual(streamMeasurement, { bytes: null, mode: 'unknown' })
assert.equal(observableReads, 0, 'measurement does not read or buffer an unsupported stream')
assert.equal(observableStream.eventNames().length, listenersBefore, 'measurement adds no stream listener')
assert.equal(observableStream.readableLength, 0, 'measurement leaves the same stream unbuffered and unreplaced')

console.log('egress baseline payload/route: ok')
