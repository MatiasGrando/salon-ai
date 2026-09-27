import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isWhatsAppLatencyDiagnosticsEnabledForBusiness,
  parseWhatsAppLatencyDiagnosticBusinessCodes
} from '../src/config/whatsapp.js'

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

console.log('whatsapp-tenant-latency-diagnostics-test: OK')