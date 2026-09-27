import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isWhatsAppLatencyDiagnosticsEnabledForBusiness,
  parseWhatsAppLatencyDiagnosticBusinessCodes
} from '../src/config/whatsapp.js'
import { emitWhatsAppLatencyDiagnostic, LatencyDiagnostic } from '../src/services/latency-diagnostic.js'

const configuredCodes = parseWhatsAppLatencyDiagnosticBusinessCodes(' WX-ABC234, wx-DEF567,invalid, WX-ABC234 ')
assert.deepEqual([...configuredCodes], ['WX-ABC234', 'WX-DEF567'])
assert.deepEqual([...parseWhatsAppLatencyDiagnosticBusinessCodes(undefined)], [])
assert.equal(isWhatsAppLatencyDiagnosticsEnabledForBusiness('wx-abc234', configuredCodes), true)
assert.equal(isWhatsAppLatencyDiagnosticsEnabledForBusiness('WX-OTHER1', configuredCodes), false)
assert.equal(isWhatsAppLatencyDiagnosticsEnabledForBusiness(undefined, configuredCodes), false)
assert.equal(isWhatsAppLatencyDiagnosticsEnabledForBusiness('WX-ABC234', new Set()), false)

const schema = readFileSync('prisma/schema.prisma', 'utf8')
assert.match(schema, /model Business\s*{[\s\S]*?customerCode\s+String\s+@unique/)

const webhookSource = readFileSync('src/services/whatsapp-webhook-service.ts', 'utf8')
assert.match(webhookSource, /business:\s*\{\s*select:\s*\{\s*accountStatus:\s*true,\s*customerCode:\s*true/)
assert.match(webhookSource, /const tenantLatencyDiagnosticsEnabled = isWhatsAppLatencyDiagnosticsEnabledForBusiness\(/)
assert.match(webhookSource, /firstMessage\.tenantLatencyDiagnosticsEnabled/)
assert.match(readFileSync('src/config/whatsapp.ts', 'utf8'), /WHATSAPP_LATENCY_DIAGNOSTIC_BUSINESS_CODES/)
const emittedDiagnostics: Array<{ tag: string; payload: string }> = []
const captureDiagnostic = (tag: string, payload: string) => emittedDiagnostics.push({ tag, payload })
const emit = (customerCode: string) => emitWhatsAppLatencyDiagnostic({
  diagnostic: new LatencyDiagnostic('whatsapp_inbound', () => 1),
  tenantEnabled: isWhatsAppLatencyDiagnosticsEnabledForBusiness(customerCode, configuredCodes),
  globalEnabled: false,
  greetingMessage: false,
  specialBotEnabled: false,
  traceId: `trace-${customerCode}`,
  conversationId: `conversation-${customerCode}`,
  sink: captureDiagnostic
})

assert.equal(emit('WX-ABC234'), true, 'an opted-in ordinary business should emit its diagnostic')
assert.equal(emit('WX-OTHER1'), false, 'an unlisted ordinary business should not emit its diagnostic')
assert.equal(emittedDiagnostics.length, 1, 'only the opted-in business should reach the diagnostic sink')
assert.equal(emittedDiagnostics[0]?.tag, '[whatsapp-latency-diagnostic]')
assert.deepEqual(JSON.parse(emittedDiagnostics[0]!.payload), {
  traceId: 'trace-WX-ABC234',
  conversationId: 'conversation-WX-ABC234',
  ...new LatencyDiagnostic('whatsapp_inbound', () => 1).report()
})

console.log('whatsapp-tenant-latency-diagnostics-test: OK')