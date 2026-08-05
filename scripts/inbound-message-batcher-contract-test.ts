import assert from 'node:assert/strict'
import { InboundMessageBatcher } from '../src/services/inbound-message-batcher.js'

const batcher = new InboundMessageBatcher(20, 60)
const processed: string[][] = []
const process = async (items: string[]) => {
  processed.push(items)
  return items.join('\n')
}

const first = batcher.enqueue({ key: 'conversation-1', item: 'Quisiera agendar un turno', process })
await wait(8)
const second = batcher.enqueue({ key: 'conversation-1', item: 'De color', process })
await wait(8)
const third = batcher.enqueue({ key: 'conversation-1', item: 'Y corte', process })

assert.deepEqual(await Promise.all([first, second, third]), [
  'Quisiera agendar un turno\nDe color\nY corte',
  'Quisiera agendar un turno\nDe color\nY corte',
  'Quisiera agendar un turno\nDe color\nY corte'
])
assert.deepEqual(processed, [[
  'Quisiera agendar un turno',
  'De color',
  'Y corte'
]])

const isolated = new InboundMessageBatcher(10, 30)
const isolatedCalls: string[][] = []
const isolatedProcess = async (items: string[]) => {
  isolatedCalls.push(items)
  return items[0] ?? ''
}
await Promise.all([
  isolated.enqueue({ key: 'conversation-a', item: 'uno', process: isolatedProcess }),
  isolated.enqueue({ key: 'conversation-b', item: 'dos', process: isolatedProcess })
])
assert.equal(isolatedCalls.length, 2)

const serialized = new InboundMessageBatcher(5, 15)
const order: string[] = []
let releaseFirst!: () => void
const firstRelease = new Promise<void>((resolve) => {
  releaseFirst = resolve
})
const firstBatch = serialized.enqueue({
  key: 'same-conversation',
  item: 'primero',
  process: async () => {
    order.push('inicio-primero')
    await firstRelease
    order.push('fin-primero')
    return 'primero'
  }
})
await wait(8)
const secondBatch = serialized.enqueue({
  key: 'same-conversation',
  item: 'segundo',
  process: async () => {
    order.push('inicio-segundo')
    return 'segundo'
  }
})
await wait(8)
assert.deepEqual(order, ['inicio-primero'])
releaseFirst()
assert.deepEqual(await Promise.all([firstBatch, secondBatch]), ['primero', 'segundo'])
assert.deepEqual(order, ['inicio-primero', 'fin-primero', 'inicio-segundo'])

const immediate = new InboundMessageBatcher(40, 80)
const immediateCalls: string[][] = []
const pendingText = immediate.enqueue({
  key: 'conversation-button',
  item: 'texto pendiente',
  process: async (items) => {
    immediateCalls.push(items)
    return items.join(',')
  }
})
const button = immediate.enqueue({
  key: 'conversation-button',
  item: 'botón',
  immediate: true,
  process: async (items) => {
    immediateCalls.push(items)
    return items.join(',')
  }
})
assert.deepEqual(await Promise.all([pendingText, button]), ['texto pendiente', 'botón'])
assert.deepEqual(immediateCalls, [['texto pendiente'], ['botón']])

const dateAndTime = new InboundMessageBatcher(15, 40)
let combinedDateAndTime = ''
const dateMessage = dateAndTime.enqueue({
  key: 'conversation-date-time',
  item: 'El 22 de agosto',
  process: async (items) => {
    combinedDateAndTime = items.join('\n')
    return combinedDateAndTime
  }
})
await wait(5)
const timeMessage = dateAndTime.enqueue({
  key: 'conversation-date-time',
  item: 'A las 15hs',
  process: async (items) => items.join('\n')
})
await Promise.all([dateMessage, timeMessage])
assert.equal(combinedDateAndTime, 'El 22 de agosto\nA las 15hs')

console.log('inbound-message-batcher-contract-test: OK')

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
