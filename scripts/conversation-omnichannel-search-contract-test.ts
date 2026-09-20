import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  listChannelConversations,
  resolveLinkedCustomerConversationSearch
} from '../src/services/conversation-channel-service.js'

const customers = [
  {
    id: 'customer-linked',
    businessId: 'business-a',
    name: 'Matías Grando',
    phone: '5491135233282',
    normalizedPhone: '5491135233282',
    email: 'matias@example.com',
    channelIdentities: [
      { channel: 'INSTAGRAM', externalUserId: 'ig-linked', username: 'matiasgrando', displayName: 'Matías Grando' }
    ]
  },
  {
    id: 'customer-unrelated',
    businessId: 'business-a',
    name: 'Otra Persona',
    phone: '5491100000000',
    normalizedPhone: '5491100000000',
    email: null,
    channelIdentities: [{ channel: 'INSTAGRAM', externalUserId: 'ig-unrelated', username: 'otra', displayName: null }]
  },
  {
    id: 'customer-cross-tenant',
    businessId: 'business-b',
    name: 'Matías Grando',
    phone: '5491135233282',
    normalizedPhone: '5491135233282',
    email: 'matias@example.com',
    channelIdentities: [{ channel: 'INSTAGRAM', externalUserId: 'ig-cross', username: 'matiasgrando', displayName: null }]
  }
]

const searchClient = {
  customer: {
    findMany: async ({ where }: any) => customers.filter((customer) => {
      if (customer.businessId !== where.businessId) return false
      const query = '5491135233282'
      return customer.phone.includes(query) || customer.normalizedPhone.includes(query)
    })
  }
}

const linked = await resolveLinkedCustomerConversationSearch({
  businessId: 'business-a',
  search: '5491135233282',
  client: searchClient as any
})
assert.deepEqual(linked.whatsappPhones, ['5491135233282'])
assert.deepEqual(linked.instagramUserIds, ['ig-linked'])
assert.ok(!linked.instagramUserIds.includes('ig-unrelated'))
assert.ok(!linked.instagramUserIds.includes('ig-cross'))

const leadRows = [
  {
    id: 'lead-linked', businessId: 'business-a', instagramUserId: 'ig-linked', username: 'matiasgrando', displayName: 'Matías',
    lastMessage: 'Hola', messages: [], createdAt: new Date('2026-09-17T12:00:00Z'), updatedAt: new Date('2026-09-19T12:00:00Z')
  },
  {
    id: 'lead-direct', businessId: 'business-a', instagramUserId: 'ig-direct', username: 'busqueda.directa', displayName: 'Directa',
    lastMessage: 'Consulta', messages: [], createdAt: new Date('2026-09-18T12:00:00Z'), updatedAt: new Date('2026-09-20T12:00:00Z')
  }
]
const leadClient = {
  instagramLead: {
    findMany: async ({ where }: any) => {
      if (where.businessId !== 'business-a') return []
      if (where.instagramUserId?.in) return leadRows.filter((lead) => where.instagramUserId.in.includes(lead.instagramUserId))
      if (where.OR) return leadRows.filter((lead) => lead.username.includes('busqueda.directa'))
      return []
    }
  }
}

const projected = await listChannelConversations({
  businessId: 'business-a',
  take: 1,
  search: 'busqueda.directa',
  linkedInstagramUserIds: ['ig-linked', 'ig-direct'],
  client: leadClient as any
})
assert.deepEqual(projected.map((conversation) => conversation.instagramUserId), ['ig-direct', 'ig-linked'])
assert.equal(projected.length, 2, 'linked results must not be capped by the direct-search take')

const crmSource = await readFile(new URL('../src/routes/crm.ts', import.meta.url), 'utf8')
assert.match(crmSource, /resolveLinkedCustomerConversationSearch/)
assert.match(crmSource, /linkedInstagramUserIds:\s*linkedSearch\.instagramUserIds/)
assert.match(crmSource, /messages:\s*\{\s*some:/)
assert.match(crmSource, /new Map\(\[\.\.\.itemsWithReplyWindow, \.\.\.channelConversations\]/)

const uiSource = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const localFilter = uiSource.slice(
  uiSource.indexOf('function filteredConversations()'),
  uiSource.indexOf('async function loadMoreConversationsFromScroll')
)
assert.match(localFilter, /customerForConversation\(conversation\)/)
assert.match(localFilter, /customer\?\.name/)
assert.match(localFilter, /customer\?\.phone/)
assert.match(localFilter, /customer\?\.email/)
assert.match(localFilter, /channelIdentities/)
assert.match(localFilter, /channelAddress/)
assert.match(localFilter, /normalizePhone\(query\)/)
assert.match(localFilter, /normalizePhone\(customer\?\.phone\)/)

console.log('conversation-omnichannel-search-contract-test: OK')
