import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { crmUiRoutes } from '../src/routes/crm-ui.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'
import { issueChoiceQuestion, publicChoiceQuestion } from '../src/conversational-bot/choices.js'
import { publicMapsLink } from '../src/conversational-bot/maps-link.js'

const app = Fastify()
await app.register(crmUiRoutes, { pollingMarker: DISABLED_POLLING_MARKER })
const page = await app.inject({ method: 'GET', url: '/crm' })
assert.equal(page.statusCode, 200)
function source(name: string) {
  const found = page.body.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n    \\}'))
  assert.ok(found, `missing ${name}`)
  return found[0]
}
const state: any = { demoChatMessages: [], demoChatSessionId: 'session' }
const els: any = { demoProfileSelect: { value: 'qa' }, demoPreviewModeRow: { hidden: false }, demoPreviewMode: { value: 'conversational-preview' },
  demoChatInput: { value: 'hola', focus() {} }, demoChatSend: { disabled: false }, demoChatMessages: { innerHTML: '', scrollHeight: 0, scrollTop: 0 } }
let token = 0
const question = issueChoiceQuestion({ businessId: 'qa', conversationKey: 'chat', policyKey: 'preview-v1', policyGeneration: 1, revision: '1' }, {},
  { kind: 'professional', title: 'Elegí profesional <seguro>', choices: [
    { label: 'Cualquier profesional', operation: { kind: 'any_professional' } },
    { label: 'Ramiro', operation: { kind: 'professional', professionalId: 'rama' } }
  ] }, () => `ui_token_${String(++token).padStart(12, '0')}`)
const requests: any[] = []
let staleRequest = false
const getJson = async (_url: string, options: any) => { requests.push(JSON.parse(options.body)); if (staleRequest) { const error: any = new Error('Esta opción ya no está vigente. Escribí tu consulta.'); error.body = { choiceDiagnostic: { gate: 'ledger_resolve', reason: 'not_current' } }; throw error }; return { reply: 'Elegí profesional', presentation: publicChoiceQuestion(question) } }
const actions = new Function('state', 'els', 'getJson', 'renderDemoChatMessages', 'setButtonLoading',
  [source('startNewDemoChat'), source('drainDemoPreviewMessages'), source('sendDemoChatMessage'), 'return {sendDemoChatMessage,startNewDemoChat}'].join('\n'))(
    state, els, getJson, () => {}, () => {})
await actions.sendDemoChatMessage({ preventDefault() {} })
await new Promise(resolve => setImmediate(resolve))
assert.deepEqual(state.demoChatMessages.at(-1).replyButtons, publicChoiceQuestion(question).choices, 'preview delivers real choices to existing UI')
assert.equal(state.demoChatMessages.at(-1).replyMode, 'list')
await actions.sendDemoChatMessage(null, publicChoiceQuestion(question).choices[1])
await new Promise(resolve => setImmediate(resolve))
assert.equal(requests[1].interactiveReplyId, publicChoiceQuestion(question).choices[1]!.id, 'UI returns opaque selection to preview backend')
assert.equal(state.demoChatMessages[1].replyButtonsDisabled, true, 'old choices disabled while another turn is pending')
const render = new Function('state', 'els', [source('escapeHtml'), source('renderDemoChatText'), source('renderDemoChatMessages'), 'return renderDemoChatMessages'].join('\n'))(state, els)
render()
assert.match(els.demoChatMessages.innerHTML, /demo-chat-interactive-list/)
assert.match(els.demoChatMessages.innerHTML, /Elegí profesional &lt;seguro&gt;/)
assert.match(els.demoChatMessages.innerHTML, /<details class="demo-chat-interactive-list" open/, 'options must be visible initially')
assert.equal((els.demoChatMessages.innerHTML.match(/Elegí profesional &lt;seguro&gt;/g) ?? []).length, state.demoChatMessages.filter((m: any) => m.replyButtons?.length).length, 'title appears exactly once per question')
assert.match(els.demoChatMessages.innerHTML, /Cualquier profesional/)
assert.doesNotMatch(els.demoChatMessages.innerHTML, /<seguro>/)
const maps = publicMapsLink({ businessName: 'Example', address: 'Monroe 2266', addressArea: 'Villa Urquiza' })!
const renderText = new Function(source('escapeHtml') + '\n' + source('renderDemoChatText') + ';return renderDemoChatText')()
assert.match(renderText('Monroe 2266, Villa Urquiza\nMaps: ' + maps.url), /<a href="https:\/\/www.google.com\/maps\/search\//)
assert.match(renderText('Maps: ' + maps.url), />Ver en Maps<\/a>/)
assert.doesNotMatch(renderText('Maps: javascript:alert(1)'), /<a/)
assert.doesNotMatch(renderText('Maps: https://www.google.com.evil.test/maps/a'), /<a/)
assert.ok(/\.demo-chat-interactive-list-option[^}]*overflow-wrap:\s*anywhere/s.test(page.body), 'long choice labels must not overflow mobile widths')
assert.match(page.body, /\.demo-chat-quick-replies[^}]*flex-wrap:\s*wrap/s)
assert.ok(/\.demo-dialog[^}]*height:\s*min\(720px, calc\(100dvh - 36px\)\)/s.test(page.body), 'existing dialog stays bounded vertically by viewport')
staleRequest = true
await actions.sendDemoChatMessage(null, publicChoiceQuestion(question).choices[0])
await new Promise(resolve => setImmediate(resolve))
assert.match(state.demoChatMessages.at(-1).text, /opción ya no está vigente/)
assert.deepEqual(state.demoChatMessages.at(-1).preview?.choiceDiagnostic, { gate: 'ledger_resolve', reason: 'not_current' })
assert.equal(els.demoChatSend.disabled, false, 'integrated rejection does not block further messages')
assert.equal(state.demoChatPreviewRun.working, false)
staleRequest = false
const priorSession = state.demoChatSessionId
actions.startNewDemoChat()
assert.notEqual(state.demoChatSessionId, priorSession)
assert.equal(state.demoChatMessages.length, 0, 'reopening/new chat never retains the previous choice envelope')
assert.equal(state.demoChatPreviewRun, null)
const safelyEmptyOptions = { role: 'bot', text: 'Texto completo sin opciones', replyButtons: [] }
state.demoChatMessages = [safelyEmptyOptions]
render()
assert.doesNotMatch(els.demoChatMessages.innerHTML, /data-demo-chat-reply-id/, 'text-only fallback contains no fake choices')
for (const inline of page.body.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new Function(inline[1]!)
await app.close()
console.log('conversational preview choices UI: OK')
