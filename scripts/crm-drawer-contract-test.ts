import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../src/routes/crm-ui/drawer.ts', import.meta.url), 'utf8')
const script = source.match(/export const crmDrawerScript = `([\s\S]*?)`\s*$/)?.[1]
assert.ok(script, 'El Drawer exporta su controlador para el CRM')

class Element {
  hidden = false
  disabled = false
  inert = false
  isConnected = true
  parent: Element | null = null
  attributes = new Map<string, string>()
  classes = new Set<string>()
  listeners = new Map<string, Array<(event: any) => void>>()
  children: Element[] = []
  classList = { add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name) }
  addEventListener(name: string, handler: (event: any) => void) {
    const handlers = this.listeners.get(name) || []
    handlers.push(handler)
    this.listeners.set(name, handlers)
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  hasAttribute(name: string) { return this.attributes.has(name) }
  contains(element: Element | null): boolean { return Boolean(element && (element === this || this.children.some(child => child.contains(element)))) }
  getClientRects() { return this.hidden ? [] : [{}] }
  getBoundingClientRect() { return { width: 420, height: 900 } }
  querySelectorAll() { return this.children }
  focus() { document.activeElement = this }
  fire(name: string, event: any) { for (const handler of this.listeners.get(name) || []) handler(event) }
}

const document = {
  activeElement: null as Element | null,
  body: { style: { overflow: 'auto' } },
  documentElement: { clientWidth: 1285, style: { scrollbarGutter: '' } },
  listeners: new Map<string, Array<(event: any) => void>>(),
  addEventListener(name: string, handler: (event: any) => void) {
    const handlers = this.listeners.get(name) || []
    handlers.push(handler)
    this.listeners.set(name, handlers)
  }
}
const timers = new Map<number, () => void>()
const frames: Array<() => void> = []
let timerId = 0
const context = vm.createContext({
  document,
  window: { innerWidth: 1300, matchMedia: () => ({ matches: false }), getComputedStyle: () => ({ scrollbarGutter: document.documentElement.style.scrollbarGutter || 'auto' }) },
  requestAnimationFrame: (callback: () => void) => frames.push(callback),
  setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId },
  clearTimeout: (id: number) => timers.delete(id)
})
vm.runInContext(script, context)
const flushFrames = () => { for (const callback of frames.splice(0)) callback() }
const flushTimers = async () => {
  for (const [id, callback] of timers) { timers.delete(id); callback() }
  await Promise.resolve()
  await Promise.resolve()
}
const settle = async () => { await Promise.resolve(); await Promise.resolve() }
function key(key: string, shiftKey = false) {
  const event = { key, shiftKey, prevented: false, stopped: false,
    preventDefault() { this.prevented = true }, stopImmediatePropagation() { this.stopped = true } }
  for (const handler of document.listeners.get('keydown') || []) handler(event)
  return event
}
function setup(options: Record<string, unknown> = {}) {
  const backdrop = new Element()
  backdrop.hidden = true
  const panel = new Element()
  const closeButton = new Element()
  const field = new Element()
  const disabled = new Element()
  disabled.disabled = true
  const submit = new Element()
  panel.children = [closeButton, field, disabled, submit]
  backdrop.children = [panel]
  let closes = 0
  const drawer = context.createCrmDrawer({ backdrop, panel, closeButton, onClose: () => closes++, ...options })
  return { drawer, backdrop, panel, closeButton, field, submit, closes: () => closes }
}

const opener = new Element()
opener.focus()
const first = setup()
first.drawer.open(opener)
flushFrames()
assert.equal(first.backdrop.hidden, false)
assert.equal(first.drawer.isOpen(), true)
assert.equal(document.body.style.overflow, 'hidden')
assert.equal(document.documentElement.style.scrollbarGutter, 'stable', 'La apertura reserva la barra existente para mantener el ancho')
assert.equal(document.activeElement, first.closeButton)
assert.equal(first.panel.getAttribute('aria-hidden'), 'false')
first.submit.focus()
assert.equal(key('Tab').prevented, true)
assert.equal(document.activeElement, first.closeButton)
assert.equal(key('Tab', true).prevented, true)
assert.equal(document.activeElement, first.submit)
const escape = key('Escape')
assert.equal(escape.prevented && escape.stopped, true, 'Escape se consume antes de otros modales')
await settle()
assert.equal(first.backdrop.hidden, false, 'El panel permanece durante la animación de salida')
await flushTimers()
assert.equal(first.backdrop.hidden, true)
assert.equal(document.activeElement, opener)
assert.equal(document.body.style.overflow, 'auto')
assert.equal(document.documentElement.style.scrollbarGutter, '', 'El cierre restaura la reserva anterior')
assert.equal(first.closes(), 1)

let allowClose = false
let confirmationVisible = false
const guarded = setup({ beforeClose: async () => allowClose, isTopmost: () => !confirmationVisible })
guarded.drawer.open(opener)
flushFrames()
guarded.field.focus()
assert.equal(await guarded.drawer.close(), false)
assert.equal(guarded.drawer.isOpen(), true)
assert.equal(document.activeElement, guarded.field, 'Cancelar descarte devuelve foco al campo')
confirmationVisible = true
const otherEscape = key('Escape')
assert.equal(otherEscape.prevented || otherEscape.stopped, false, 'La confirmación superior conserva Escape')
confirmationVisible = false
guarded.backdrop.fire('click', { target: guarded.panel })
await settle()
assert.equal(guarded.drawer.isOpen(), true, 'Un clic interior conserva el panel')
allowClose = true
guarded.closeButton.fire('click', {})
await settle()
await flushTimers()
assert.equal(guarded.backdrop.hidden, true, 'X usa el cierre protegido')

const reopened = setup()
reopened.drawer.open(opener)
flushFrames()
const oldClose = reopened.drawer.close()
await settle()
reopened.drawer.open(opener)
flushFrames()
await flushTimers()
assert.equal(await oldClose, false)
assert.equal(reopened.backdrop.hidden, false, 'Una salida anterior no oculta una nueva apertura')
const forceClose = reopened.drawer.close(true)
await settle()
await flushTimers()
assert.equal(await forceClose, true)

let resolveGuard!: (allowed: boolean) => void
let checks = 0
const pending = setup({ beforeClose: () => { checks++; return new Promise(resolve => { resolveGuard = resolve }) } })
pending.drawer.open(opener)
flushFrames()
const closeOne = pending.drawer.close()
const closeTwo = pending.drawer.close()
assert.equal(closeOne, closeTwo)
assert.equal(checks, 1, 'Los cierres simultáneos comparten una sola confirmación')
const forced = pending.drawer.close(true)
await settle()
await flushTimers()
assert.equal(await forced, true)
resolveGuard(false)
assert.equal(await closeOne, false)
assert.equal(pending.backdrop.hidden, true)

document.documentElement.clientWidth = 1300
const noScrollbar = setup()
noScrollbar.drawer.open(opener)
flushFrames()
assert.equal(document.documentElement.style.scrollbarGutter, '', 'Sin barra previa no se agrega ancho reservado')
noScrollbar.backdrop.fire('click', { target: noScrollbar.backdrop })
await settle()
await flushTimers()
assert.equal(noScrollbar.backdrop.hidden, true, 'El clic exterior cierra el panel')

document.documentElement.clientWidth = 1285
document.documentElement.style.scrollbarGutter = 'stable both-edges'
const reservedScrollbar = setup()
reservedScrollbar.drawer.open(opener)
flushFrames()
assert.equal(document.documentElement.style.scrollbarGutter, 'stable both-edges', 'Se conserva la reserva de ancho configurada')
const closeReserved = reservedScrollbar.drawer.close(true)
await settle()
await flushTimers()
assert.equal(await closeReserved, true)
assert.equal(document.documentElement.style.scrollbarGutter, 'stable both-edges')

console.log('CRM Drawer: foco, teclado, cierre protegido, reapertura y cambios de contexto OK')
