import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { EgressBaselineController } from './controller.js'
import { classifyMetricSource, safeRouteTemplate } from './route-classifier.js'
import { measurePayloadBytes } from './payload-bytes.js'
import type { PollingMarkerConfig } from './types.js'

type RequestState = { startedAt: number; bytes: number | null; mode: string; hadError: boolean; finalized: boolean }

export function installHttpLifecycle(app: FastifyInstance, controller: EgressBaselineController, marker: PollingMarkerConfig, monotonicNow: () => number) {
  const states = new WeakMap<FastifyRequest, RequestState>()
  let enabled = true
  app.addHook('onRequest', async (request) => {
    if (!enabled || !controller.measurementEnabled || request.routeOptions.url === '/crm/events') return
    states.set(request, { startedAt: monotonicNow(), bytes: null, mode: 'unknown', hadError: false, finalized: false })
  })
  app.addHook('onError', async (request) => {
    const state = states.get(request)
    if (state) state.hadError = true
  })
  app.addHook('onSend', async (request, reply: FastifyReply, payload) => {
    const state = states.get(request)
    if (!state) return payload
    const measurement = measurePayloadBytes(payload, request.method, reply.statusCode)
    state.bytes = measurement.bytes
    state.mode = measurement.mode
    return payload
  })
  app.addHook('onRequestAbort', async (request) => { states.delete(request) })
  app.addHook('onResponse', async (request, reply) => {
    const state = states.get(request)
    if (!state || state.finalized) return
    state.finalized = true
    states.delete(request)
    const template = safeRouteTemplate(request.routeOptions.url)
    const source = classifyMetricSource(template)
    const polling = marker.effective && request.headers[marker.headerName.toLowerCase()] === marker.headerValue
    const method = normalizeMethod(request.method)
    const statusClass = reply.statusCode >= 100 && reply.statusCode < 600 ? `${Math.floor(reply.statusCode / 100)}xx` : '5xx'
    const key = JSON.stringify([method, template, statusClass, source, polling, state.mode])
    controller.recordHttp({ key, durationMs: Math.max(0, monotonicNow() - state.startedAt), bytes: state.bytes, hadError: state.hadError })
  })
  return { disable() { enabled = false } }
}

function normalizeMethod(method: string) {
  const normalized = method.toUpperCase()
  return ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(normalized) ? normalized : 'OTHER'
}
