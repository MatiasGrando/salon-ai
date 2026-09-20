import assert from 'node:assert/strict'
import { normalizeProductItems, ProductSalesError, snapshotProductLines } from '../src/services/product-sales-service.js'

assert.deepEqual(
  normalizeProductItems([{ productId: 'gel', quantity: 1 }, { productId: 'gel', quantity: 2 }, { productId: 'crema', quantity: 1 }]),
  [{ productId: 'gel', quantity: 3 }, { productId: 'crema', quantity: 1 }],
  'la misma referencia se consolida sin duplicar líneas'
)
assert.throws(
  () => normalizeProductItems([{ productId: 'gel', quantity: 0 }]),
  (error: unknown) => error instanceof ProductSalesError && error.code === 'INVALID_PRODUCT_ITEM'
)
assert.throws(
  () => snapshotProductLines([{ productId: 'ajeno', quantity: 1 }], []),
  (error: unknown) => error instanceof ProductSalesError && error.code === 'PRODUCT_NOT_AVAILABLE'
)

const lines = snapshotProductLines(
  [{ productId: 'gel', quantity: 2 }],
  [{ id: 'gel', name: 'Gel premium', sku: 'GEL-1', salePrice: 8500, cost: 4000 }]
)
assert.deepEqual(lines, [{
  productId: 'gel',
  productNameSnapshot: 'Gel premium',
  skuSnapshot: 'GEL-1',
  unitCost: 4000,
  unitPrice: 8500,
  quantity: 2,
  lineTotal: 17000
}], 'la venta conserva precio, costo, nombre y código históricos')

console.log('OK ventas de productos: cantidades, disponibilidad y snapshots históricos')