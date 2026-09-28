import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync('src/routes/crm-ui.ts', 'utf8')
function source(name: string) {
  const match = ui.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n    \\}'))
  assert.ok(match, `CRM must define ${name}`)
  return match[0]
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function settle() { await new Promise((resolve) => setImmediate(resolve)) }
function harness() {
  const state: any = { demoChatMessages: [], demoChatSessionId: null }
  const els: any = {
    demoProfileSelect: { value: 'qa-profile' }, demoPreviewModeRow: { hidden: false },
    demoPreviewMode: { value: 'conversational-preview' },
    demoChatInput: { value: '', focus() {} }, demoChatSend: { disabled: false },
  }
  const requests: Array<{ body: any; result: ReturnType<typeof deferred<any>> }> = []
  const getJson = (_url: string, options: any) => {
    const result = deferred<any>()
    requests.push({ body: JSON.parse(options.body), result })
    return result.promise
  }
  const setButtonLoading = (button: any, loading: boolean) => { button.disabled = loading; return true }
  const renderDemoChatMessages = () => {}
  const factory = new Function('state', 'els', 'getJson', 'renderDemoChatMessages', 'setButtonLoading',
    [source('startNewDemoChat'), source('drainDemoPreviewMessages'), source('sendDemoChatMessage'),
      'return { startNewDemoChat, sendDemoChatMessage }'].join('\n'))
  const chat = factory(state, els, getJson, renderDemoChatMessages, setButtonLoading)
  const send = async (text: string) => { els.demoChatInput.value = text; await chat.sendDemoChatMessage({ preventDefault() {} }) }
  const reply = (text: string) => ({ reply: text, state: { pending: 'date' }, timings: { totalMs: 3 } })
  return { state, els, requests, chat, send, reply }
}

{
  const h = harness()
  await h.send('hola quiero un turno hoy')
  assert.equal(h.requests.length, 1)
  assert.equal(h.els.demoChatSend.disabled, false, 'preview send remains enabled while thinking')
  await h.send('no mejor mañana')
  await h.send('con Rama para teñirme')
  assert.deepEqual(h.state.demoChatMessages.map((item: any) => item.text),
    ['hola quiero un turno hoy', 'no mejor mañana', 'con Rama para teñirme'])
  assert.equal(h.requests.length, 1, 'requests must be serialized in one session')
  h.requests[0].result.resolve(h.reply('respuesta obsoleta 1'))
  await settle()
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[1].body.message, 'no mejor mañana')
  assert.equal(h.state.demoChatMessages.filter((item: any) => item.role === 'bot').length, 0)
  h.requests[1].result.resolve(h.reply('respuesta obsoleta 2'))
  await settle()
  assert.equal(h.requests.length, 3)
  assert.equal(h.requests[2].body.message, 'con Rama para teñirme')
  assert.ok(h.requests.every((item) => item.body.sessionId === h.requests[0].body.sessionId))
  h.requests[2].result.resolve(h.reply('respuesta final'))
  await settle()
  assert.deepEqual(h.state.demoChatMessages.filter((item: any) => item.role === 'bot').map((item: any) => item.text), ['respuesta final'])
  await h.send('otra consulta')
  h.requests[3].result.resolve(h.reply('respuesta nueva'))
  await settle()
  assert.deepEqual(h.state.demoChatMessages.filter((item: any) => item.role === 'bot').map((item: any) => item.text), ['respuesta final', 'respuesta nueva'])
}

{
  const h = harness()
  await h.send('primero')
  await h.send('segundo')
  h.requests[0].result.reject(new Error('falló la consulta'))
  await settle()
  assert.equal(h.requests.length, 2, 'a failed turn must not strand queued messages')
  assert.match(h.state.demoChatMessages.find((item: any) => item.role === 'bot')?.text || '', /falló la consulta/)
  h.requests[1].result.resolve(h.reply('respuesta recuperada'))
  await settle()
  assert.equal(h.els.demoChatSend.disabled, false)
  assert.equal(h.state.demoChatMessages.at(-1).text, 'respuesta recuperada')
}

{
  const h = harness()
  await h.send('sesión vieja')
  await h.send('descartar pendiente')
  h.chat.startNewDemoChat()
  h.els.demoProfileSelect.value = 'otro-perfil'
  await h.send('sesión nueva')
  assert.equal(h.requests.length, 2)
  h.requests[0].result.resolve(h.reply('respuesta de sesión vieja'))
  await settle()
  assert.equal(h.requests.length, 2, 'old queued turns must not leak into a new session')
  assert.deepEqual(h.state.demoChatMessages.map((item: any) => item.text), ['sesión nueva'])
  h.requests[1].result.resolve(h.reply('respuesta de sesión nueva'))
  await settle()
  assert.deepEqual(h.state.demoChatMessages.map((item: any) => item.text), ['sesión nueva', 'respuesta de sesión nueva'])
  assert.notEqual(h.requests[0].body.sessionId, h.requests[1].body.sessionId)
}

{
  const h = harness()
  await h.send('preview')
  h.chat.startNewDemoChat()
  h.els.demoPreviewMode.value = 'existing'
  const originalReply = h.send('simulador actual')
  assert.equal(h.els.demoChatSend.disabled, true, 'original simulator still blocks duplicate submits')
  h.requests[0].result.resolve(h.reply('old preview'))
  await settle()
  assert.deepEqual(h.state.demoChatMessages.map((item: any) => item.text), ['simulador actual'])
  h.requests[1].result.resolve(h.reply('respuesta actual'))
  await originalReply
  await settle()
  assert.equal(h.els.demoChatSend.disabled, false)
  assert.deepEqual(h.state.demoChatMessages.map((item: any) => item.text), ['simulador actual', 'respuesta actual'])
}
console.log('conversational preview chat chain: OK')
