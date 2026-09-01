import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { prisma } from '../src/config/prisma.js'
import {
  createProvisionalCustomer,
  customerHasContactIdentity
} from '../src/services/customer-identity-service.js'

const prismaClient = prisma as any
const originalCreate = prismaClient.customer.create
let capturedCreate: any

try {
  prismaClient.customer.create = async (input: unknown) => {
    capturedCreate = input
    return { id: 'walk-in-1', ...(input as any).data }
  }

  const customer = await createProvisionalCustomer({ businessId: 'business-a', name: ' Juan ' })
  assert.equal(customer.name, 'Juan')
  assert.equal(capturedCreate.data.businessId, 'business-a')
  assert.equal(capturedCreate.data.phone, '')
  assert.equal(capturedCreate.data.normalizedPhone, null)
  assert.equal(customerHasContactIdentity(''), false)
  assert.equal(customerHasContactIdentity('5491112345678'), true)

  const customerRoute = readFileSync(new URL('../src/routes/customer.ts', import.meta.url), 'utf8')
  const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
  const campaignRoute = readFileSync(new URL('../src/routes/campaign.ts', import.meta.url), 'utf8')

  assert.ok(customerRoute.includes('createProvisionalCustomer'), 'el alta manual debe crear una ficha provisional')
  assert.ok(customerRoute.includes('const isNew = !isProvisional'), 'una ficha sin identidad no debe contarse como cliente nuevo')
  assert.ok(customerRoute.includes('averageFrequencyDays: isProvisional ? null'), 'una ficha provisional no debe calcular recurrencia')
  assert.ok(crmUi.includes('<label for="appointment-customer-phone">Tel&eacute;fono</label>'), 'el teléfono debe mostrarse sin texto redundante')
  assert.ok(crmUi.includes("if (!name)"), 'el turno rápido debe requerir solo el nombre al crear el cliente')
  assert.equal(crmUi.includes("if (!name || !phone)"), false, 'el turno manual no debe exigir teléfono')
  assert.ok(crmUi.includes('customer.isProvisional'), 'la interfaz debe identificar la ficha provisional')
  assert.ok(campaignRoute.includes('isUsableCampaignPhone(customer.phone)'), 'las campañas deben excluir fichas sin teléfono utilizable')

  console.log('Manual appointment without phone contract: OK (ficha provisional, métricas y comunicaciones).')
} finally {
  prismaClient.customer.create = originalCreate
  await prisma.$disconnect()
}
