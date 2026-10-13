import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { runInNewContext } from 'node:vm'

// Synthetic repositories only. Do not load the workspace environment or use a network.
process.env.DOTENV_CONFIG_PATH = '__offline_phone_test_no_env__'
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_phone_test'
process.env.WEEX_GOOGLE_CLIENT_ID = ''
process.env.GOOGLE_CLIENT_ID = ''
process.env.ENABLE_GOOGLE_CALENDAR_SYNC = 'false'
const [{ prisma }, { landingUiRoutes }, { publicBookingRoutes }, { weexAccountRoutes }, { BusinessService },
  { AppointmentService }, { BookingAvailabilitySearchEngine }, { bookingDepositService },
  { updateWeexPhone, linkExistingCustomersByPhone }, { normalizeCustomerPhone, phoneSearchVariants },
  { findOrCreateCustomerByPhone }, { Prisma }, { PGlite }] = await Promise.all([
  import('../src/config/prisma.js'), import('../src/routes/landing-ui.js'), import('../src/routes/public-booking.js'),
  import('../src/routes/weex-account.js'), import('../src/services/business-service.js'),
  import('../src/services/appointment-service.js'), import('../src/services/booking-availability-search.js'),
  import('../src/services/booking-deposit-service.js'), import('../src/services/weex-account-service.js'),
  import('../src/services/phone-normalization-service.js'), import('../src/services/customer-identity-service.js'),
  import('../src/generated/prisma/client.js'), import('@electric-sql/pglite')
])
const db = prisma as any
function matchesCustomerWhere(where: any) {
  if (where.OR && !where.OR.some(matchesCustomerWhere)) return false
  if (where.AND && !where.AND.every(matchesCustomerWhere)) return false
  if ('normalizedPhone' in where && where.normalizedPhone !== customer.normalizedPhone) return false
  if (where.phone?.in && !where.phone.in.includes(customer.phone)) return false
  return true
}
const restore: Array<() => void> = []
function replace(object: any, key: string, value: any) {
  const original = object[key]
  object[key] = value
  restore.push(() => { object[key] = original })
}
let passes = 0
let failures = 0
async function test(name: string, run: () => any) {
  try { await run(); passes++; console.log('PASS ' + name) }
  catch (error) { failures++; console.error('FAIL ' + name, (error as Error).message) }
}
const account: any = {
  id: 'account-a', name: 'Synthetic', email: 'offline@example.test', emailVerified: false,
  phone: '4930123456', phoneVerifiedAt: new Date(), avatarUrl: null
}
const service: any = {
  id: 'service-a', name: 'Corte', attentionMode: 'DIRECT_BOOKING', depositMode: 'NONE',
  isActive: true, duration: 30, price: 15000, estimateAllowsBooking: true, bookingOrderPriority: 1,
  professionalLinks: [{ professional: { id: 'professional-a', name: 'Professional' } }]
}
const professional = { id: 'professional-a', name: 'Professional', businessId: 'business-a' }
const business: any = {
  id: 'business-a', slug: 'phone-test', name: 'Offline', accountStatus: 'ACTIVE', landingEnabled: true,
  landingTemplate: 'classic', services: [service, { ...service, id: 'service-b' }], professionals: [professional],
  publicWhatsapp: '+54 9 11 4000-0000'
}
let customer: any = { id: 'existing-customer', name: 'Existing', businessId: business.id, phone: '4930123456', normalizedPhone: '4930123456' }
let customerCreates = 0
let profileWrites = 0
let writtenPhones: string[] = []
let linkQuery: any = null
let depositQuery: any = null
let historyQuery: any = null
let deposit: any = null
let links: any[] = []
const app = Fastify()
const sqlDb = new PGlite()
const cookie = { cookie: 'weex_account_session=offline-token' }
try {
  replace(BusinessService.prototype, 'findPublicBySlug', async () => business)
  replace(db.business, 'findUnique', async () => business)
  replace(db.weexAccount, 'update', async ({ data }: any) => { profileWrites++; Object.assign(account, data); return { ...account } })
  replace(db.weexAccount, 'findUnique', async () => account)
  replace(db.weexAccountSession, 'findUnique', async () => ({ account, expiresAt: new Date(Date.now() + 60_000) }))
  replace(db.weexCustomerLink, 'upsert', async ({ create }: any) => {
    assert.equal(create.phone, account.phone); links = [create]; return {}
  })
  replace(db.weexCustomerLink, 'findMany', async ({ where }: any) => links.filter(link =>
    link.weexAccountId === where.weexAccountId && (!where.businessId || link.businessId === where.businessId)))
  replace(db.customer, 'updateMany', async () => { throw new Error('Email verification must not be bypassed') })
  replace(db.customer, 'findFirst', async ({ where }: any) => {
    assert.equal(where.businessId, business.id)
    return matchesCustomerWhere(where) ? customer : null
  })
  replace(db.customer, 'findUnique', async () => customer)
  replace(db.customer, 'update', async ({ data }: any) => { writtenPhones.push(data.phone); Object.assign(customer, data); return customer })
  replace(db.customer, 'create', async ({ data }: any) => { customerCreates++; writtenPhones.push(data.phone); return { ...data, id: 'new-customer' } })
  replace(db.customerMarketingPreference, 'upsert', async () => ({}))
  replace(db, '$queryRaw', async (query: any, ...values: any[]) => {
    const statement = Prisma.sql(query, ...values)
    return statement.text.includes('FROM "Customer"') ? (await sqlDb.query(statement.text, statement.values)).rows : []
  })
  replace(db, '$transaction', async (run: any) => run(db))
  replace(db.service, 'findFirst', async () => service)
  replace(db.serviceCombinationRule, 'findMany', async () => [])
  replace(db.professionalService, 'findMany', async () => business.services.map((entry: any) => ({ serviceId: entry.id, professionalId: professional.id })))
  replace(db.professional, 'findMany', async () => [professional])
  replace(db.appointment, 'findMany', async ({ where, select }: any) => {
    if (select?.customerId) {
      linkQuery = where
      return matchesCustomerWhere(where.customer)
        ? [{ customerId: customer.id, professional: { businessId: business.id } }] : []
    }
    historyQuery = where
    if (where.customerId?.in?.includes(customer.id) || (where.customer && matchesCustomerWhere(where.customer))) return [{
      id: 'history-a', customer, service, professional: { ...professional, business },
      status: 'CONFIRMED', startAt: new Date('2026-10-14T19:00:00.000Z'), totalDurationMinutes: 30
    }]
    return []
  })
  replace(db.bookingDeposit, 'findFirst', async ({ where }: any) => {
    depositQuery = where
    return where.appointment?.customer && !matchesCustomerWhere(where.appointment.customer) ? null : deposit
  })
  replace(bookingDepositService, 'expireOverdue', async () => {})
  replace(bookingDepositService, 'submitWebProof', async ({ depositId }: any) => ({ ok: true, deposit: { id: depositId } }))
  replace(AppointmentService.prototype, 'createPublicBooking', async (input: any) => {
    assert.equal(input.customerId, customer.id, 'reuse exact existing identity')
    assert.equal(input.customerPhone, account.phone)
    return { ok: true, appointment: { id: 'appointment-a', startAt: new Date(), bookingDeposit: null } }
  })
  replace(AppointmentService.prototype, 'create', async (input: any) => {
    assert.equal(input.customerId, customer.id)
    return { ok: true, appointment: { id: 'coordinated-' + input.serviceId } }
  })
  replace(AppointmentService.prototype, 'confirmPendingAppointments', async () => true)
  replace(BookingAvailabilitySearchEngine.prototype, 'search', async () => ({ options: [{
    id: 'itinerary-a', segments: business.services.map((entry: any, index: number) => ({
      serviceId: entry.id, professionalId: professional.id, startTime: index ? '16:30' : '16:00'
    }))
  }] }))
  await app.register(landingUiRoutes)
  await app.register(publicBookingRoutes)
  await app.register(weexAccountRoutes)
  await sqlDb.exec('CREATE TABLE "Customer" ("id" TEXT, "businessId" TEXT, "phone" TEXT, "normalizedPhone" TEXT, "createdAt" TIMESTAMP DEFAULT now())')
  const forms = await Promise.all(['/phone-test/reservar', '/phone-test/cuenta'].map(async url => (await app.inject(url)).body))
  function phoneFunctions(html: string) {
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(code => code.includes('function formatPhoneInput'))!
    const start = script.indexOf('          function formatPhoneInput')
    const end = script.includes('          function setDate', start)
      ? script.indexOf('          function setDate', start) : script.indexOf('          function businessInitials', start)
    const context: any = { defaultAreaCode: '11', normalizePhone: (value: string) => value.replace(/\D/g, '') }
    runInNewContext(script.slice(start, end), context)
    const handler = script.match(/els\.phoneInput\.addEventListener\('input', \(\) => \{([\s\S]*?)\n\s*\}\)/)!
    return { ...context, script, input: (value: string) => {
      const scope = { ...context, els: { phoneInput: { value } } }
      runInNewContext(handler[1], scope)
      return scope.els.phoneInput.value
    } }
  }
  const phones: Array<[string, string, string?]> = [
    ['11-6655-8877', '5491166558877'], ['9 11-6655-8877', '5491166558877'],
    ['11-1565-8877', '5491115658877'], ['011 15 6655 8877', '5491166558877'],
    ['15-5555-6666', '5491155556666'], ['11-5555-6666', '5491155556666'],
    ['911-5555-6666', '5491155556666'], ['+54911-5555-6666', '5491155556666']
  ]
  for (const [area, subscriber] of [['11', '55556666'], ['351', '5556666'], ['2920', '555666']]) {
    const national = area + subscriber
    for (const raw of [subscriber, '15-' + subscriber, area + '-' + subscriber, '9' + national,
      '0' + national, '0' + area + '-15-' + subscriber, area + ' 15 ' + subscriber,
      '54' + national, '549' + national, '+54 ' + area + ' ' + subscriber,
      '+54 9 (' + area + ') ' + subscriber, '0054' + national, '00549' + national,
      '  ' + area + '.' + subscriber + '  ']) {
      phones.push([raw, '549' + national, area])
    }
  }
  for (const digits of ['59899123456', '12025550123', '442079460123', '4930123456',
    '56912345678', '5511987654321', '595981234567', '59171234567', '12345678', '123456789012345']) {
    for (const prefix of ['+', '00']) phones.push([prefix + digits, digits])
  }
  phones.push(['+598 99 123 456', '59899123456'], ['+1 (202) 555-0123', '12025550123'])
  function useAreaCode(area = '11') {
    // The real profile route derives this default from the current business, not the browser.
    business.publicWhatsapp = '+54 9 ' + area + ' ' + '4'.repeat(10 - area.length)
  }
  for (const [index, html] of forms.entries()) {
    const functions = phoneFunctions(html)
    for (const [raw, expected, area = '11'] of phones) {
      await test(`generated form ${index + 1} paste/type preserves ${raw}`, () => {
        for (const typed of [false, true]) {
          let value = ''
          if (typed) for (const char of raw) value = functions.input(value + char)
          else value = functions.input(raw)
          assert.equal(functions.input(value), value, 'formatting must be idempotent')
          const normalized = normalizeCustomerPhone(functions.phoneForSubmit(value), { defaultAreaCode: area })
          assert.equal(normalized.ok && normalized.phone, expected)
          const reloaded = normalizeCustomerPhone('+' + expected, { defaultAreaCode: area })
          assert.equal(reloaded.ok && reloaded.phone, expected, 'canonical identity must be idempotent')
        }
      })
    }
    await test(`generated form ${index + 1} reload retains saved foreign country`, () => {
      const value = functions.formatPhoneInput('+4930123456')
      assert.equal(functions.phoneForSubmit(value), '+4930123456')
      if (functions.formatPhoneDisplay) assert.equal(functions.formatPhoneDisplay('4930123456'), '+4930123456')
    })
    await test(`generated form ${index + 1} actual submit saves raw phone through authenticated profile route`, async () => {
      const selector = index ? 'phoneForm' : 'gatePhone'
      const start = functions.script.indexOf(`els.${selector}.addEventListener('submit'`)
      const end = functions.script.indexOf('\n          })', start) + '\n          })'.length
      for (const [raw, expected, area = '11'] of phones) {
        useAreaCode(area)
        let handler: any
        let pending: Promise<any> | undefined
        const scope: any = { ...functions, slug: business.slug, state: {},
          els: { [selector]: { addEventListener: (_event: string, run: any) => { handler = run } }, phoneInput: { value: raw } },
          setGateFeedback() {}, setPhoneModalFeedback() {}, setFeedback() {}, proceedToConfirm() {}, closePhoneModal() {}, renderShell() {}, loadHistory: async () => {},
          postJson: (path: string, payload: any) => {
            assert.equal(payload.phone, raw.trim(), 'client must not invent country or drop digits')
            pending = app.inject({ method: 'POST', url: path, payload, headers: cookie }).then(response => {
              assert.equal(response.statusCode, 200, response.body)
              return response.json()
            })
            return pending
          }
        }
        runInNewContext(functions.script.slice(start, end), scope)
        handler({ preventDefault() {} })
        assert.ok(pending, `the real generated submit must call profile/phone for ${raw} (business area ${area})`)
        await pending
        assert.equal(account.phone, expected)
        assert.equal(account.phoneVerifiedAt, null)
      }
      useAreaCode()
    })
  }
  for (const [raw, expected, area = '11'] of phones) {
    await test('profile saves canonical ' + raw + ' without verifying ownership', async () => {
      const result = await updateWeexPhone(account.id, raw, area)
      assert.equal(result.ok, true)
      assert.equal(account.phone, expected)
      assert.equal(account.phoneVerifiedAt, null)
      assert.equal(linkQuery.customer.OR[0].normalizedPhone, expected)
    })
  }
  await test('invalid and short phone do not write profile', async () => {
    const before = account.phone
    const writesBefore = profileWrites
    for (const raw of ['', '   ', '1234', '55555', '555666', '5556666', '+', '00', '+1234567', '001234567',
      '+598123', '+1234567890123456', '001234567890123456', '+549115555666', '+54911555566666']) {
      assert.equal((await updateWeexPhone(account.id, raw, '11')).ok, false)
      assert.equal(account.phone, before)
    }
    for (const [raw, area] of [['55556666', '351'], ['5556666', '2920']]) {
      assert.equal((await updateWeexPhone(account.id, raw, area)).ok, false)
      assert.equal(account.phone, before)
    }
    assert.equal(profileWrites, writesBefore)
  })
  await test('profile API rejects incomplete local and foreign inputs without writes', async () => {
    useAreaCode()
    const before = account.phone
    const writesBefore = profileWrites
    for (const phone of ['555666', '5556666', '+1234567', '+1234567890123456']) {
      const response = await app.inject({ method: 'POST', url: '/public/weex/profile/phone',
        headers: cookie, payload: { phone, businessSlug: business.slug } })
      assert.equal(response.statusCode, 400, phone + ': ' + response.body)
      assert.equal(account.phone, before, 'a looser browser precheck must not permit incomplete identities')
    }
    assert.equal(profileWrites, writesBefore)
  })
  await test('foreign numbers without a country prefix never invent a foreign identity', async () => {
    for (const digits of ['59899123456', '12025550123', '442079460123', '4930123456']) {
      const normalized = normalizeCustomerPhone(digits, { defaultAreaCode: '11' })
      assert.ok(!normalized.ok || normalized.phone.startsWith('549'), 'bare input uses only the local Argentine default')
      assert.notEqual(normalized.ok && normalized.phone, digits, 'foreign country must be explicit')
    }
  })
  await test('every accepted format reuses its exact canonical customer without duplicates', async () => {
    const before = customerCreates
    for (const [raw, expected, area = '11'] of phones) {
      customer.phone = expected; customer.normalizedPhone = expected
      const result = await findOrCreateCustomerByPhone({ businessId: business.id, name: 'Existing', phone: raw, defaultAreaCode: area })
      assert.equal(result.wasExisting, true, raw)
      assert.equal(result.customer.id, customer.id, raw)
      assert.equal(result.canonicalPhone, expected, raw)
    }
    assert.equal(customerCreates, before)
    customer.phone = '4930123456'; customer.normalizedPhone = customer.phone
  })
  await test('profile route still requires the authenticated session', async () => {
    const original = db.weexAccountSession.findUnique
    db.weexAccountSession.findUnique = async () => null
    try { assert.equal((await app.inject({ method: 'POST', url: '/public/weex/profile/phone', payload: { phone: '+4930123456' } })).statusCode, 401) }
    finally { db.weexAccountSession.findUnique = original }
  })
  await test('international variants never contain an Argentine lookalike', async () => {
    const variants = phoneSearchVariants('+49 30 123456')
    assert.ok(variants.includes('4930123456'))
    assert.ok(!variants.includes('5494930123456'))
    account.phone = '4930123456'
    assert.equal(await linkExistingCustomersByPhone(account.id, '+4930123456'), 1)
    assert.ok(!linkQuery.customer.OR[1].phone.in.includes('5494930123456'))
  })
  const book = { serviceId: service.id, professionalId: professional.id, date: '2026-10-14', time: '16:00' }
  for (const coordinated of [false, true]) {
    await test(`saved foreign profile ${coordinated ? 'coordinated' : 'single'} booking reuses customer`, async () => {
      account.phone = '4930123456'; customer.phone = account.phone; customer.normalizedPhone = account.phone
      const response = await app.inject({ method: 'POST', url: '/public/booking/phone-test/' + (coordinated ? 'book-coordinated' : 'book'), headers: cookie,
        payload: coordinated ? { serviceSelections: business.services.map((entry: any) => ({ serviceId: entry.id })), date: book.date, itineraryId: 'itinerary-a' } : book })
      assert.equal(response.statusCode, 200, response.body)
      assert.equal(customerCreates, 0, 'foreign country must not create another Argentine identity')
      assert.equal(writtenPhones.at(-1), '4930123456')
    })
  }
  await test('pending deposit lookup retains international identity and tenant', async () => {
    deposit = null
    assert.equal((await app.inject({ url: '/public/booking/phone-test/pending-deposit', headers: cookie })).statusCode, 200)
    assert.equal(depositQuery.businessId, business.id)
    assert.ok(matchesCustomerWhere(depositQuery.appointment.customer))
    const variants = depositQuery.appointment.customer.phone?.in ?? depositQuery.appointment.customer.OR[1].phone.in
    assert.ok(!variants.includes('5494930123456'))
  })
  await test('proof accepts exact international owner, rejects a different country identity', async () => {
    deposit = { id: 'deposit-a', appointment: { customer } }
    const proof = () => app.inject({ method: 'POST', url: '/public/booking/phone-test/deposits/deposit-a/proof', headers: cookie, payload: { dataUrl: 'synthetic' } })
    assert.equal((await proof()).statusCode, 200)
    customer.phone = '5494930123456'
    customer.normalizedPhone = customer.phone
    assert.equal((await proof()).statusCode, 404)
    customer.phone = '4930123456'
    customer.normalizedPhone = customer.phone
  })
  await test('history searches foreign exact digits without Argentine variants', async () => {
    const response = await app.inject('/public/booking/phone-test/history?phone=' + encodeURIComponent('+4930123456'))
    assert.equal(response.statusCode, 200)
    assert.equal(historyQuery.professional.businessId, business.id)
    assert.ok(matchesCustomerWhere(historyQuery.customer))
    const variants = historyQuery.customer.phone?.in ?? historyQuery.customer.OR[1].phone.in
    assert.ok(!variants.includes('5494930123456'))
  })
  for (const pending of [false, true]) {
    await test(`${pending ? 'pending deposit' : 'history'} excludes an Argentine legacy national lookalike`, async () => {
      account.phone = '4930123456'; customer.phone = '4930123456'; customer.normalizedPhone = '5494930123456'
      deposit = { id: 'deposit-a', amount: 5000, status: 'PENDING_PROOF', expiresAt: new Date(), appointment: {
        customer, service, professional, serviceId: service.id, professionalId: professional.id,
        startAt: new Date('2026-10-14T19:00:00.000Z'), coordinationGroupId: null
      } }
      for (const normalized of ['5494930123456', null]) {
        customer.normalizedPhone = normalized
        const response = await app.inject({
          url: pending ? '/public/booking/phone-test/pending-deposit' : '/public/booking/phone-test/history?phone=' + encodeURIComponent('+4930123456'),
          headers: cookie
        })
        assert.equal(response.statusCode, 200, response.body)
        if (pending) assert.equal(response.json().deposit, null)
        else assert.equal(response.json().appointments.length, 0)
      }
      customer.normalizedPhone = account.phone
      const own = await app.inject({
        url: pending ? '/public/booking/phone-test/pending-deposit' : '/public/booking/phone-test/history?phone=' + encodeURIComponent('+4930123456'),
        headers: cookie
      })
      assert.equal(own.statusCode, 200, own.body)
      if (pending) assert.equal(own.json().deposit.id, deposit.id)
      else assert.equal(own.json().appointments[0].customer.phone, account.phone)
      for (const prefix of ['+', '00']) {
        customer.phone = prefix + account.phone; customer.normalizedPhone = null
        const explicitLegacy = await app.inject({
          url: pending ? '/public/booking/phone-test/pending-deposit' : '/public/booking/phone-test/history?phone=' + encodeURIComponent('+4930123456'),
          headers: cookie
        })
        assert.equal(explicitLegacy.statusCode, 200, explicitLegacy.body)
        if (pending) assert.equal(explicitLegacy.json().deposit?.id, deposit.id, prefix + ' is an explicit international prefix')
        else assert.equal(explicitLegacy.json().appointments[0]?.customer.phone, prefix + account.phone)
      }
      customer.phone = account.phone; customer.normalizedPhone = account.phone
    })
  }
  await test('authenticated account history follows the exact foreign customer link', async () => {
    links = []; account.phone = '4930123456'
    customer.phone = account.phone; customer.normalizedPhone = account.phone
    assert.equal(await linkExistingCustomersByPhone(account.id, '+4930123456'), 1)
    const response = await app.inject({ url: '/public/weex/appointments?businessSlug=phone-test', headers: cookie })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().appointments[0].customer.id, customer.id)
    assert.equal(response.json().appointments[0].customer.phone, '4930123456')
    assert.deepEqual(historyQuery.customerId.in, [customer.id])
    assert.deepEqual(historyQuery.professional.businessId.in, [business.id])
  })
  await test('Argentine legacy proof without normalized identity retains ownership', async () => {
    account.phone = '5491166558877'; customer.phone = '(011) 15-6655-8877'; customer.normalizedPhone = null
    deposit = { id: 'deposit-a', appointment: { customer } }
    const response = await app.inject({ method: 'POST', url: '/public/booking/phone-test/deposits/deposit-a/proof', headers: cookie, payload: { dataUrl: 'synthetic' } })
    assert.equal(response.statusCode, 200, response.body)
  })
  for (const [name, storedPhone, normalized, expectedExisting] of [
    ['Argentine legacy national lookalike', '4930123456', '5494930123456', false],
    ['contradictory normalized identity', '+4930123456', '5494930123456', false],
    ['ambiguous legacy national without country', '4930123456', null, false],
    ['explicit legacy foreign country', '+4930123456', null, true],
    ['explicit legacy foreign 00 country', '004930123456', null, true],
    ['contradictory legacy 00 identity', '004930123456', '5494930123456', false]
  ] as const) {
    await test('foreign identity does not reinterpret ' + name, async () => {
      account.phone = '4930123456'; customer.phone = storedPhone; customer.normalizedPhone = normalized
      await sqlDb.exec('DELETE FROM "Customer"')
      await sqlDb.query('INSERT INTO "Customer" ("id", "businessId", "phone", "normalizedPhone") VALUES ($1, $2, $3, $4)',
        [customer.id, business.id, storedPhone, normalized])
      const result = await findOrCreateCustomerByPhone({ businessId: business.id, name: 'Foreign', phone: '+49 30 123456', defaultAreaCode: '11' })
      assert.equal(result.wasExisting, expectedExisting)
      assert.equal(result.canonicalPhone, '4930123456')
      customer.phone = storedPhone; customer.normalizedPhone = normalized
      assert.equal(await linkExistingCustomersByPhone(account.id, '+4930123456'), expectedExisting ? 1 : 0)
    })
  }
  for (const storedPhone of ['+49 (30) 123456', '00 49 (30) 123456']) {
    await test('real SQL fallback reuses explicitly formatted foreign legacy ' + storedPhone, async () => {
      customer.phone = storedPhone; customer.normalizedPhone = null
      await sqlDb.exec('DELETE FROM "Customer"')
      await sqlDb.query('INSERT INTO "Customer" ("id", "businessId", "phone", "normalizedPhone") VALUES ($1, $2, $3, $4)',
        [customer.id, business.id, customer.phone, null])
      const result = await findOrCreateCustomerByPhone({ businessId: business.id, name: 'Foreign', phone: '+49 30 123456', defaultAreaCode: '11' })
      assert.equal(result.wasExisting, true)
      assert.equal(result.customer.id, customer.id)
      assert.equal(result.canonicalPhone, '4930123456')
      assert.equal(await linkExistingCustomersByPhone(account.id, '+4930123456'), 1, 'booking normalizes and links the same legacy identity')
    })
  }
  console.log(`Public registration phone: ${passes} passed; ${failures} failed`)
} finally {
  await app.close()
  for (const undo of restore.reverse()) undo()
  await prisma.$disconnect()
  await sqlDb.close()
}
if (failures) process.exitCode = 1
