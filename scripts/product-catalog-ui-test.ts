import assert from 'node:assert/strict'
import vm from 'node:vm'
import { cashRegisterMarkup, cashRegisterScript } from '../src/routes/crm-ui/cash-register.js'

const selectMarkup = /<select id="cash-product-category"([^>]*)>/.exec(cashRegisterMarkup)
assert.ok(selectMarkup)
assert.doesNotMatch(selectMarkup[1], /\b(?:required|disabled)\b/, 'native form validation must not require a category')

const categories: any[] = []
const products: any[] = []
const calls: Array<{ path: string; method: string; body: any }> = []
function element(select = false): any {
  return { value: '', checked: true, hidden: false, textContent: '', className: '', focus() {},
    get innerHTML() { return this.html || '' },
    set innerHTML(value: string) { this.html = value; if (select) this.value = /<option value="([^"]*)"/.exec(value)?.[1] || '' } }
}
const cashUi: any = new Proxy({}, { get(target: any, key: string) {
  return target[key] ??= element(['productCategory', 'productSaleProduct', 'appointmentProductSelect'].includes(key))
} })
const state = { businessId: 'business-1', cashRegister: { productCategories: [], products: [], editingProductId: null, editingProductCategoryId: null } }
const context: any = { state, cashUi, escapeHtml: (value: any) => String(value), cashMoney: (value: any) => String(value),
  cashScoped: (path: string) => path, cashCollection: (payload: any, key: string) => payload[key],
  canUseCashPermission: () => true, isCashBusinessScopedRole: () => true, requestAnimationFrame: (callback: () => void) => callback(), showCrmToast() {},
  getJson: async (path: string, options: any = {}) => {
    if (!options.method) return path === '/products' ? { products: products.map(row => ({ ...row })) } : { categories: categories.map(row => ({ ...row })) }
    const body = JSON.parse(options.body), method = options.method
    calls.push({ path, method, body })
    const rows = path.startsWith('/product-categories') ? categories : products
    const id = path.split('/')[2]
    if (method === 'PATCH') Object.assign(rows.find(row => row.id === id), body)
    else rows.push({ id: 'item-' + (rows.length + 1), ...body })
    return rows.at(-1)
  } }
vm.createContext(context)
const start = cashRegisterScript.indexOf('    function activeCashProducts()')
const end = cashRegisterScript.indexOf('    function renderCashProductSale()')
assert.ok(start >= 0 && end > start)
vm.runInContext(cashRegisterScript.slice(start, end) + '\nObject.assign(globalThis, { renderCashProductOptions, loadCashProducts, editCashProduct, submitCashProduct, submitCashProductCategory });', context)
const event = { preventDefault() {} }
await context.loadCashProducts()
context.editCashProduct(null)
cashUi.productName.value = 'Gel'
cashUi.productPrice.value = '1500'
cashUi.productSortOrder.value = '0'
await context.submitCashProduct(event)
assert.equal(calls.length, 1, 'valid product without a category must reach the endpoint')
assert.equal(calls[0].method, 'POST')
assert.equal(calls[0].body.categoryId, null, 'no category is represented explicitly as null')
assert.equal(products[0].categoryId, null)
assert.match(cashUi.productCategory.innerHTML, /<option value="">Sin categor/)

cashUi.productCategoryName.value = 'Peinado'
cashUi.productCategorySortOrder.value = '0'
await context.submitCashProductCategory(event)
assert.equal(state.cashRegister.productCategories.length, 1, 'created category is reloaded into the catalog')
assert.match(cashUi.productCategory.innerHTML, /Peinado/)
assert.match(cashUi.productCategoryList.innerHTML, /Peinado/)
assert.match(cashUi.productCategory.innerHTML, /<option value="">Sin categor/, 'uncategorized stays available alongside categories')
context.editCashProduct(products[0].id)
assert.equal(cashUi.productCategory.value, '', 'editing an uncategorized product must not silently assign the first category')
cashUi.productCategory.value = categories[0].id
context.renderCashProductOptions()
assert.equal(cashUi.productCategory.value, categories[0].id, 'rendering refreshed options preserves a valid selection')
await context.submitCashProduct(event)
assert.equal(products[0].categoryId, categories[0].id)
products.push({ id: 'second-uncategorized', name: 'Crema', categoryId: null, salePrice: 2000, isActive: true })
await context.loadCashProducts()
context.editCashProduct(products[0].id)
assert.equal(cashUi.productCategory.value, categories[0].id)
context.editCashProduct(products[1].id)
assert.equal(cashUi.productCategory.value, '', 'switching from a categorized product must preserve the next product null')
await context.submitCashProduct(event)
assert.equal(calls.at(-1)?.body.categoryId, null)
assert.equal(calls.at(-1)?.path, '/products/second-uncategorized')
context.editCashProduct(products[0].id)
cashUi.productCategory.value = ''
await context.submitCashProduct(event)
assert.equal(products[0].categoryId, null, 'editing may explicitly remove a category')
assert.equal(calls.at(-1)?.method, 'PATCH')
assert.equal(calls.at(-1)?.body.categoryId, null)
const before = calls.length
cashUi.productName.value = ''
await context.submitCashProduct(event)
assert.equal(calls.length, before, 'required name validation remains')
cashUi.productName.value = 'Gel'; cashUi.productPrice.value = '-1'
await context.submitCashProduct(event)
assert.equal(calls.length, before, 'negative prices remain rejected')
console.log('OK product UI: category reload, explicit no-category, edits and validation')
