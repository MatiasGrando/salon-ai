import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { join } from 'node:path'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'

process.env.DOTENV_CONFIG_PATH = '__instagram_contract_no_dotenv__'
const { renderCrmHtml } = await import('../src/routes/crm-ui.js')
const html = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER })
const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!).find((script) => script.includes('function renderInstagramSettings('))!
function fn(name: string) {
  const match = new RegExp('    (?:async )?function ' + name + '\\(').exec(inline)
  assert.ok(match, 'expected existing UI function ' + name)
  return inline.slice(match.index, inline.indexOf('\n    }', match.index) + 6)
}
const names = ['renderInstagramSettings', 'showInstagramSettingsFeedback', 'clearInstagramSettingsFeedback', 'saveInstagramSettings', 'testInstagramConnection', 'getJson', 'resetInstagramMediaState', 'instagramMediaObserveAccount']
const script = names.map(fn).join('\n')
const node = () => ({ textContent: '', className: '', innerHTML: '', value: '', checked: false, disabled: false, classList: { toggle() {} } })
const els: any = new Proxy({}, { get(target: any, key) { return target[key] ??= node() } })
const saved = () => ({ connection: { connected: true, hasAccessToken: true, hasAppSecret: true, instagramAccountId: 'professional-account', username: 'salon', lastError: 'Falta WhatsApp publico', expiry: { status: 'unknown', source: 'manual' }, verification: { status: 'not_checked', checkedAt: null } }, enabled: true, redirectReady: true })
const state: any = { businessId: 'business-a', instagramSettings: saved() }
let failure: any = null
let response: any = null
const requests: string[] = []
const requestOptions: any[] = []
const context = { state, els, window: { location: { origin: 'https://fixture.invalid' } },
  toDatetimeLocalValue: (value: string) => value.slice(0, 16),
  setButtonLoading: () => true,
  buildGetJsonRequestOptions: (options: unknown) => options,
  fetch: async (url: string, options: unknown) => {
    requests.push(url)
    requestOptions.push(options)
    return new Response(JSON.stringify(failure ? { message: failure.message, ...failure.body } : response), { status: failure ? 400 : 200 })
  }
}
runInNewContext(script, context)
const call = (expression: string) => runInNewContext(expression, context)
call('renderInstagramSettings()')
assert.match(els.instagramSettingsTitle.textContent, /guardad/i, 'stored credentials must be presented as saved, not verified')
assert.doesNotMatch(els.instagramSettingsCopy.textContent, /puede responder/)
assert.match(els.instagramConnectionVerification.textContent, /sin comprobar/i)
assert.match(els.instagramConnectionExpiry.textContent, /desconocido/i)
assert.equal(els.instagramAccessToken.value, '')
assert.equal(els.instagramAppSecret.value, '')
assert.equal(els.instagramTestButton.disabled, false)

response = { ...saved(), ok: true, account: { id: 'app-scoped-account', username: 'salon' } }
response.connection.verification = { status: 'verified', checkedAt: '2026-10-24T12:00:00Z' }
await call('testInstagramConnection()')
assert.equal(requests.at(-1), '/businesses/business-a/instagram-settings/test')
assert.match(els.instagramConnectionVerification.textContent, /cuenta comprobada/i)
assert.doesNotMatch(els.instagramSettingsBadge.textContent, /listo/i)
assert.match(els.instagramSettingsFeedback.textContent, /permisos.*sin verificar/i)

failure = Object.assign(new Error('No pude comprobar la cuenta configurada de Instagram.'), { body: { connection: { ...saved().connection, verification: { status: 'failed', checkedAt: '2026-10-24T12:01:00Z' } }, enabled: true, redirectReady: true } })
await call('testInstagramConnection()')
assert.match(els.instagramConnectionVerification.textContent, /no se pudo comprobar/i)
assert.doesNotMatch(els.instagramConnectionVerification.textContent, /cuenta comprobada/i, 'a failed retry replaces the previous success')
assert.match(els.instagramSettingsFeedback.textContent, /No pude/)
failure = null

response = { ...saved(), connection: { ...saved().connection, verification: { status: 'verified', checkedAt: '2026-10-24T12:02:00Z' } } }
els.instagramAccessToken.value = 'new-fixture-token'
els.instagramAppSecret.value = 'new-fixture-secret'
await call('saveInstagramSettings({preventDefault(){}})')
assert.equal(requestOptions.at(-1).method, 'PATCH')
assert.equal(JSON.parse(requestOptions.at(-1).body).accessToken, 'new-fixture-token')
assert.equal(els.instagramAccessToken.value, '', 'successful save clears sensitive inputs')
assert.equal(els.instagramAppSecret.value, '')
assert.match(els.instagramConnectionVerification.textContent, /cuenta comprobada/i)
assert.match(els.instagramSettingsFeedback.textContent, /permisos sin verificar/i)

state.instagramSettings = saved()
state.instagramSettings.connection.expiry.status = 'declared_expired'
state.instagramSettings.connection.tokenExpiresAt = '2000-01-01T00:00:00Z'
call('renderInstagramSettings()')
assert.match(els.instagramConnectionExpiry.textContent, /vencimiento declarado.*pasado/i)
state.instagramSettings.connection.expiry.status = 'declared_future'
state.instagramSettings.connection.tokenExpiresAt = '2100-01-01T00:00:00Z'
call('renderInstagramSettings()')
assert.match(els.instagramConnectionExpiry.textContent, /vencimiento declarado/i)
assert.doesNotMatch(els.instagramSettingsBadge.textContent, /listo/i)

state.instagramSettings = { connection: { connected: false }, enabled: false }
call('renderInstagramSettings()')
assert.match(els.instagramSettingsTitle.textContent, /sin conectar/i)
assert.equal(els.instagramTestButton.disabled, true)
assert.equal(els.instagramEnabledToggle.disabled, true)
assert.match(html, /id="instagram-capabilities"/)
assert.match(html, /Permisos sin verificar/)
assert.match(html, /@media \(max-width: 720px\)\s*\{\s*\.instagram-connection-panel \.whatsapp-status-card\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/, 'mobile status must stack within the Instagram panel')
assert.doesNotMatch(html, /\b(?:alert|confirm|prompt)\s*\(/)
console.log('OK: shipped Instagram UI renders saved, verified, failed, missing and declared-expiry states')

if (process.argv.includes('--fixture')) {
  const source = readFileSync('src/routes/crm-ui.ts', 'utf8')
  const elementBindings = [...source.matchAll(/(instagram\w+): document\.getElementById\('([^']+)'\)/g)].map((match) => `${match[1]}:document.getElementById(${JSON.stringify(match[2])})`).join(',')
  const heading = html.indexOf('<h3>Instagram del comercio</h3>')
  const start = html.lastIndexOf('<details ', heading)
  const panel = html.slice(start, html.indexOf('</details>', heading) + 10).replace('<details ', '<details open ')
  const fixtureScript = `const state=${JSON.stringify({ businessId: 'fixture', instagramSettings: saved() })};const els={${elementBindings}}; const toDatetimeLocalValue=v=>v.slice(0,16);const setButtonLoading=()=>true;const buildGetJsonRequestOptions=v=>v;const fetch=async()=>new Response(JSON.stringify({...state.instagramSettings,ok:true,account:{username:'salon'},connection:{...state.instagramSettings.connection,verification:{status:'verified',checkedAt:new Date().toISOString()}}}),{status:200});\n${script}\nrenderInstagramSettings();document.getElementById('instagram-test-button').onclick=testInstagramConnection;document.getElementById('instagram-technical-form').onsubmit=saveInstagramSettings;`
  const fixtureDir = process.argv.find((arg) => arg.startsWith('--fixture-dir='))?.slice('--fixture-dir='.length) ?? 'tmp/instagram-settings-qa'
  await mkdir(fixtureDir, { recursive: true })
  const fixturePath = join(fixtureDir, 'index.html')
  await writeFile(fixturePath, `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instagram: prueba local</title>${html.match(/<style>[\s\S]*?<\/style>/)?.[0]}<body style="padding:16px;background:#f3f6fb"><main style="max-width:960px;margin:auto">${panel}</main><script>${fixtureScript}</script></body></html>`, 'utf8')
  console.log('Fixture: ' + fixturePath + ' (neutral local data; simulated account check)')
}
