import type { BusinessAuthorizationUser } from './business-authorization.js'
import { findOrCreateCustomerByPhone, normalizeCustomerEmail } from './customer-identity-service.js'
import { parseChannelResourceId } from './conversation-channel-service.js'
import { authorizedConversationWhere } from './tenant-resource-authorization.js'

type PrismaLike = Record<string, any>

type CustomerFromConversationInput = {
  conversationId: string
  businessId: string
  requestedName?: string | null
  requestedPhone?: string | null
  email?: string | null
  user: BusinessAuthorizationUser
  client: PrismaLike
  phoneCustomerCreator?: typeof findOrCreateCustomerByPhone
}

export class ConversationCustomerLinkError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'NAME_REQUIRED') {
    super(code === 'NAME_REQUIRED'
      ? 'Ingresá el nombre del cliente para crear su ficha.'
      : 'No encontramos esa conversación en este comercio.')
  }
}

export async function createOrLinkCustomerFromConversation(input: CustomerFromConversationInput) {
  const businessId = input.businessId.trim()
  if (!businessId || (input.user.businessId && input.user.businessId !== businessId)) {
    throw new ConversationCustomerLinkError('NOT_FOUND')
  }

  const parsed = parseChannelResourceId(input.conversationId)
  if (parsed?.resourceType === 'conversation' && parsed.channel === 'INSTAGRAM') {
    return createOrLinkInstagramCustomer(input, parsed.resourceId, businessId)
  }
  if (parsed) throw new ConversationCustomerLinkError('NOT_FOUND')

  const conversation = await input.client.conversation.findFirst({
    where: {
      ...authorizedConversationWhere(input.user, input.conversationId),
      businessId
    }
  })
  if (!conversation?.phone?.trim()) throw new ConversationCustomerLinkError('NOT_FOUND')
  const name = preferredCustomerName(input.requestedName, conversation.selectedCustomerName)
  if (!name) throw new ConversationCustomerLinkError('NAME_REQUIRED')
  const createByPhone = input.phoneCustomerCreator ?? findOrCreateCustomerByPhone
  return createByPhone({
    businessId,
    name,
    phone: conversation.phone,
    email: input.email
  })
}

async function createOrLinkInstagramCustomer(
  input: CustomerFromConversationInput,
  leadId: string,
  businessId: string
) {
  const lead = await input.client.instagramLead.findFirst({
    where: { id: leadId, businessId },
    select: {
      id: true,
      businessId: true,
      instagramUserId: true,
      username: true,
      displayName: true
    }
  })
  if (!lead) throw new ConversationCustomerLinkError('NOT_FOUND')

  const name = preferredCustomerName(input.requestedName, lead.displayName, lead.username ? `@${lead.username.replace(/^@/, '')}` : null)
  if (!name) throw new ConversationCustomerLinkError('NAME_REQUIRED')
  const email = normalizeCustomerEmail(input.email)
  const alreadyLinked = await findInstagramIdentity(input.client, businessId, lead.instagramUserId)
  if (alreadyLinked?.customer) {
    return {
      customer: withChannelIdentity(alreadyLinked.customer, alreadyLinked),
      wasExisting: true,
      nameConflict: null
    }
  }

  const legacyCustomer = await input.client.customer.findFirst({
    where: { businessId, instagramUserId: lead.instagramUserId }
  })
  const createByPhone = input.phoneCustomerCreator ?? findOrCreateCustomerByPhone
  const phoneCustomerResult = !legacyCustomer && input.requestedPhone?.trim()
    ? await createByPhone({
        businessId,
        name,
        phone: input.requestedPhone,
        email: input.email
      })
    : null
  try {
    const operation = async (transaction: PrismaLike) => {
      const linkedIdentity = await findInstagramIdentity(transaction, businessId, lead.instagramUserId)
      if (linkedIdentity?.customer) {
        return {
          customer: withChannelIdentity(linkedIdentity.customer, linkedIdentity),
          wasExisting: true,
          nameConflict: null
        }
      }

      // Transitional compatibility: previous lead-form work can still populate these
      // columns. Heal that row into the canonical child identity without duplicating it.
      const transitionalCustomer = legacyCustomer || await transaction.customer.findFirst({
        where: { businessId, instagramUserId: lead.instagramUserId }
      })
      if (transitionalCustomer) {
        const identity = await transaction.customerChannelIdentity.upsert({
          where: {
            businessId_channel_externalUserId: {
              businessId,
              channel: 'INSTAGRAM',
              externalUserId: lead.instagramUserId
            }
          },
          create: instagramIdentityData(transitionalCustomer.id, businessId, lead),
          update: {
            username: lead.username?.replace(/^@/, '') || null,
            displayName: lead.displayName || null
          }
        })
        return {
          customer: withChannelIdentity(transitionalCustomer, identity),
          wasExisting: true,
          nameConflict: null
        }
      }

      const customer = phoneCustomerResult
        ? await transaction.customer.update({
            where: { id: phoneCustomerResult.customer.id },
            data: {
              // Dual-write until all pending lead-form consumers migrate to channelIdentities.
              instagramUserId: lead.instagramUserId,
              instagramUsername: lead.username?.replace(/^@/, '') || null
            }
          })
        : await transaction.customer.create({
            data: {
              businessId,
              name,
              phone: '',
              normalizedPhone: null,
              email: email ?? null,
              // Dual-write until all pending lead-form consumers migrate to channelIdentities.
              instagramUserId: lead.instagramUserId,
              instagramUsername: lead.username?.replace(/^@/, '') || null
            }
          })
      const identity = await transaction.customerChannelIdentity.create({
        data: instagramIdentityData(customer.id, businessId, lead)
      })
      return {
        customer: withChannelIdentity(customer, identity),
        wasExisting: phoneCustomerResult?.wasExisting ?? false,
        nameConflict: phoneCustomerResult?.nameConflict ?? null
      }
    }
    return input.client.$transaction ? await input.client.$transaction(operation) : await operation(input.client)
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const raced = await findInstagramIdentity(input.client, businessId, lead.instagramUserId)
    if (!raced?.customer) throw error
    return {
      customer: withChannelIdentity(raced.customer, raced),
      wasExisting: true,
      nameConflict: null
    }
  }
}

function findInstagramIdentity(client: PrismaLike, businessId: string, instagramUserId: string) {
  return client.customerChannelIdentity.findFirst({
    where: { businessId, channel: 'INSTAGRAM', externalUserId: instagramUserId },
    include: { customer: true }
  })
}

function instagramIdentityData(customerId: string, businessId: string, lead: Record<string, any>) {
  return {
    businessId,
    customerId,
    channel: 'INSTAGRAM',
    externalUserId: lead.instagramUserId,
    username: lead.username?.replace(/^@/, '') || null,
    displayName: lead.displayName || null,
    metadata: { source: 'INSTAGRAM_LEAD', leadId: lead.id }
  }
}

function withChannelIdentity(customer: Record<string, any>, identity: Record<string, any>) {
  const { customer: _customer, ...identityData } = identity
  return {
    ...customer,
    channelIdentities: [identityData]
  }
}

function preferredCustomerName(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean) || ''
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
}
