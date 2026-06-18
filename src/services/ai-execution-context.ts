import { AsyncLocalStorage } from 'node:async_hooks'

const aiExecutionContext = new AsyncLocalStorage<{ enabled: boolean }>()

export function runWithAiEnabled<T>(enabled: boolean, callback: () => Promise<T>) {
  return aiExecutionContext.run({ enabled }, callback)
}

export function isAiExecutionEnabled() {
  return aiExecutionContext.getStore()?.enabled ?? true
}
