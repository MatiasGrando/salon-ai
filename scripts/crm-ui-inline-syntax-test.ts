import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { crmUiRoutes } from '../src/routes/crm-ui.js'

const app = Fastify()
await app.register(crmUiRoutes)
const response = await app.inject({ method: 'GET', url: '/crm' })
assert.equal(response.statusCode, 200)

const scripts = [...response.body.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!)
assert.ok(scripts.length > 0, 'CRM should include inline scripts')
for (const [index, script] of scripts.entries()) {
  try {
    new Function(script)
  } catch (error) {
    throw new Error(`CRM inline script ${index} does not compile: ${error instanceof Error ? error.message : error}`)
  }
}

await app.close()
console.log(`CRM inline scripts compile: OK (${scripts.length})`)
