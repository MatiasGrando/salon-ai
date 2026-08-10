import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_BOOKING_ORDER_PRIORITY,
  bookingOrderPriority,
  orderBookingServicesByPriority
} from '../src/services/booking-service-order.js'
import { createBookingV2DomainCatalog } from '../src/services/booking-v2-domain.js'
import {
  acceptField,
  addCombinedServices,
  combinedServiceIds,
  createEmptyBookingV2State
} from '../src/services/booking-v2-state.js'

function catalog(priorities: Record<string, number | undefined>) {
  return createBookingV2DomainCatalog({
    services: Object.entries(priorities).map(([id, priority]) => ({
      id,
      name: id,
      aliases: [id],
      duration: 30,
      price: 1000,
      category: null,
      ...(priority === undefined ? {} : { bookingOrderPriority: priority })
    })),
    professionals: []
  })
}

function stateFor(serviceIds: string[]) {
  let state = acceptField(createEmptyBookingV2State(), 'service', serviceIds[0]!)
  state = addCombinedServices(state, serviceIds.slice(1).map((serviceId) => ({
    serviceId,
    evidence: serviceId
  })))
  return state
}

assert.equal(bookingOrderPriority(undefined), DEFAULT_BOOKING_ORDER_PRIORITY)
assert.equal(bookingOrderPriority(null), DEFAULT_BOOKING_ORDER_PRIORITY)

const reordered = orderBookingServicesByPriority(
  stateFor(['alisado', 'corte']),
  catalog({ alisado: 30, corte: 10 })
)
assert.deepEqual(combinedServiceIds(reordered), ['corte', 'alisado'])

const stable = orderBookingServicesByPriority(
  stateFor(['color', 'corte', 'nutricion']),
  catalog({ color: 20, corte: 20, nutricion: undefined })
)
assert.deepEqual(combinedServiceIds(stable), ['color', 'corte', 'nutricion'])

const withAddon = orderBookingServicesByPriority(
  stateFor(['alisado', 'color', 'corte']),
  catalog({ alisado: 30, color: 20, corte: 10 })
)
assert.deepEqual(combinedServiceIds(withAddon), ['corte', 'color', 'alisado'])

const schema = readFileSync('prisma/schema.prisma', 'utf8')
assert.match(schema, /bookingOrderPriority\s+Int\s+@default\(20\)/)

const serviceRoute = readFileSync('src/routes/service.ts', 'utf8')
assert.match(serviceRoute, /normalizeBookingOrderPriority\(body\.bookingOrderPriority\)/)

const crmUi = readFileSync('src/routes/crm-ui.ts', 'utf8')
assert.match(crmUi, /id="service-booking-order-priority"[^>]*value="20"/)
assert.match(crmUi, /bookingOrderPriority,/)

const engine = readFileSync('src/services/booking-v2-engine.ts', 'utf8')
assert.match(engine, /plan\.type !== 'ask_service_addons'[\s\S]*?orderBookingServicesByPriority/)

console.log('service-booking-order-contract-test: OK')
