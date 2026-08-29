import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { crmUiRoutes } from '../src/routes/crm-ui.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'

// 1) Regression guard: the CRM route still renders and every inline script compiles.
const app = Fastify()
await app.register(crmUiRoutes, { pollingMarker: DISABLED_POLLING_MARKER })
const response = await app.inject({ method: 'GET', url: '/crm' })
assert.equal(response.statusCode, 200)

// The new interactive CSS must ship with the page.
assert.match(response.body, /\.message-interactive-chip\s*\{/)
assert.match(response.body, /\.message-interactive-row\s*\{/)

const scripts = [...response.body.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!)
assert.ok(scripts.length > 0, 'CRM should include inline scripts')
for (const [index, script] of scripts.entries()) {
  try {
    new Function(script)
  } catch (error) {
    throw new Error(`CRM inline script ${index} does not compile: ${error instanceof Error ? error.message : error}`)
  }
}

// 2) Exercise the real renderMessageInteractive + escapeHtml shipped in the inline script.
const inline = scripts.find((script) => script.includes('function renderMessageInteractive'))
assert.ok(inline, 'expected inline script defining renderMessageInteractive')

function extractFunctionSource(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start !== -1, `expected function ${name} in inline script`)
  let depth = 0
  let cursor = source.indexOf('{', start)
  for (; cursor < source.length; cursor++) {
    const char = source[cursor]
    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) {
        cursor++
        break
      }
    }
  }
  return source.slice(start, cursor)
}

const renderMessageInteractive = new Function(
  extractFunctionSource(inline, 'escapeHtml') + '\n' +
  extractFunctionSource(inline, 'renderMessageInteractive') + '\n' +
  'return renderMessageInteractive;',
)() as (message: { direction: string; body?: string; status?: string; metadata?: Record<string, unknown> }) => string

// Outbound buttons render as non-clickable chips with escaped text beneath the body.
const buttonsHtml = renderMessageInteractive({
  id: 'm1',
  direction: 'OUTBOUND',
  body: 'Elegi una opcion',
  status: 'sent',
  metadata: { interactive: { mode: 'buttons', buttons: [{ title: 'Agendar' }, { title: 'Hablar con humano' }] } },
})
assert.match(buttonsHtml, /message-interactive-buttons/)
assert.match(buttonsHtml, /message-interactive-chip/)
assert.match(buttonsHtml, /Agendar/)
assert.match(buttonsHtml, /Hablar con humano/)
assert.doesNotMatch(buttonsHtml, /<button/)
assert.doesNotMatch(buttonsHtml, /onclick/i)
assert.doesNotMatch(buttonsHtml, /data-demo-chat-reply/)
assert.doesNotMatch(buttonsHtml, /href=/)

// Outbound list renders section title, trigger and rows (title + description).
const listHtml = renderMessageInteractive({
  id: 'm2',
  direction: 'OUTBOUND',
  body: 'Servicios',
  status: 'sent',
  metadata: {
    interactive: {
      mode: 'list',
      sectionTitle: 'Menu',
      buttonText: 'Ver opciones',
      rows: [{ title: 'Corte', description: 'Corte y lavado' }, { title: 'Manicuria' }],
    },
  },
})
assert.match(listHtml, /message-interactive-list/)
assert.match(listHtml, /message-interactive-section-title/)
assert.match(listHtml, /Menu/)
assert.match(listHtml, /message-interactive-trigger/)
assert.match(listHtml, /Ver opciones/)
assert.match(listHtml, /message-interactive-row/)
assert.match(listHtml, /Corte/)
assert.match(listHtml, /Corte y lavado/)
assert.match(listHtml, /Manicuria/)
assert.doesNotMatch(listHtml, /<button/)
assert.doesNotMatch(listHtml, /onclick/i)

// Interactive metadata is only rendered for OUTBOUND messages.
const inboundHtml = renderMessageInteractive({
  direction: 'INBOUND',
  body: 'hola',
  metadata: { interactive: { mode: 'buttons', buttons: [{ title: 'X' }] } },
})
assert.equal(inboundHtml, '')

// Without interactive metadata nothing is rendered.
assert.equal(renderMessageInteractive({ direction: 'OUTBOUND', body: 'x' }), '')

// All user/provider text is escaped, including in buttons and list titles/descriptions.
const evilButtonsHtml = renderMessageInteractive({
  direction: 'OUTBOUND',
  body: 'x',
  metadata: { interactive: { mode: 'buttons', buttons: [{ title: '<script>alert(1)</script>' }] } },
})
assert.match(evilButtonsHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
assert.doesNotMatch(evilButtonsHtml, /<script>alert/)

const evilListHtml = renderMessageInteractive({
  direction: 'OUTBOUND',
  body: 'x',
  metadata: {
    interactive: {
      mode: 'list',
      sectionTitle: '<img src=x onerror=1>',
      rows: [{ title: 'A & B', description: 'C < D' }],
    },
  },
})
assert.match(evilListHtml, /&lt;img src=x onerror=1&gt;/)
assert.match(evilListHtml, /A &amp; B/)
assert.match(evilListHtml, /C &lt; D/)
assert.doesNotMatch(evilListHtml, /<img src=x/)

await app.close()
console.log('CRM outbound interactive metadata contract: OK')
