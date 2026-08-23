import type {
  Appointment,
  BookingDeposit,
  Business,
  Campaign,
  CampaignDelivery,
  Conversation,
  Customer,
  Message,
  Professional,
  Prisma,
  PrismaClient,
  ScheduleBlock,
  Service,
  ServiceCategory,
  ReminderAutomation,
  User,
  WhatsAppTemplate
} from '../generated/prisma/client.js'
import {
  businessAccessWhere,
  resolveBusinessScope,
  type BusinessAuthorizationUser
} from './business-authorization.js'

export type TenantResourceAuthorizationClient = PrismaClient | Prisma.TransactionClient

function tenantBusinessWhere(user: BusinessAuthorizationUser) {
  return businessAccessWhere(resolveBusinessScope(user))
}

function requiredTenantBusinessRelation(
  user: BusinessAuthorizationUser
): Prisma.BusinessNullableScalarRelationFilter {
  return { is: tenantBusinessWhere(user) }
}

export function authorizedBusinessWhere(
  user: BusinessAuthorizationUser,
  id: string
): Prisma.BusinessWhereInput {
  return businessAccessWhere(resolveBusinessScope(user), id)
}

export function authorizedConversationWhere(
  user: BusinessAuthorizationUser,
  id: string
): Prisma.ConversationWhereInput {
  return {
    id,
    business: requiredTenantBusinessRelation(user)
  }
}

export function authorizedMessageWhere(
  user: BusinessAuthorizationUser,
  id: string
): Prisma.MessageWhereInput {
  return {
    id,
    conversation: {
      business: requiredTenantBusinessRelation(user)
    }
  }
}

export function authorizedAppointmentWhere(
  user: BusinessAuthorizationUser,
  id: string
): Prisma.AppointmentWhereInput {
  return {
    id,
    professional: {
      business: tenantBusinessWhere(user)
    }
  }
}

export function authorizedProfessionalWhere(
  user: BusinessAuthorizationUser,
  id: string
): Prisma.ProfessionalWhereInput {
  return {
    id,
    business: tenantBusinessWhere(user)
  }
}

export function authorizedServiceWhere(
  user: BusinessAuthorizationUser,
  id: string
): Prisma.ServiceWhereInput {
  return {
    id,
    business: tenantBusinessWhere(user)
  }
}

export function authorizedBookingDepositWhere(
  user: BusinessAuthorizationUser,
  id: string
): Prisma.BookingDepositWhereInput {
  return {
    id,
    business: tenantBusinessWhere(user)
  }
}

export function authorizedCustomerWhere(
  user: BusinessAuthorizationUser,
  id: string
): Prisma.CustomerWhereInput {
  return {
    id,
    business: requiredTenantBusinessRelation(user)
  }
}

export function authorizedScheduleBlockWhere(
  user: BusinessAuthorizationUser,
  id: string
): Prisma.ScheduleBlockWhereInput {
  return {
    id,
    business: tenantBusinessWhere(user)
  }
}

export function authorizedServiceCategoryWhere(
  user: BusinessAuthorizationUser,
  id: string
): Prisma.ServiceCategoryWhereInput {
  return { id, business: tenantBusinessWhere(user) }
}

export function authorizedCampaignWhere(
  user: BusinessAuthorizationUser,
  id: string
): Prisma.CampaignWhereInput {
  return { id, business: tenantBusinessWhere(user) }
}

export function authorizedWhatsAppTemplateWhere(
  user: BusinessAuthorizationUser,
  id: string
): Prisma.WhatsAppTemplateWhereInput {
  return { id, business: tenantBusinessWhere(user) }
}

export function authorizedReminderAutomationWhere(
  user: BusinessAuthorizationUser,
  id: string
): Prisma.ReminderAutomationWhereInput {
  return { id, business: tenantBusinessWhere(user) }
}

export function authorizedCampaignDeliveryWhere(
  user: BusinessAuthorizationUser,
  id: string
): Prisma.CampaignDeliveryWhereInput {
  return { id, business: tenantBusinessWhere(user) }
}

export function authorizedStaffUserWhere(
  user: BusinessAuthorizationUser,
  id: string
): Prisma.UserWhereInput {
  return {
    id,
    role: 'STAFF',
    business: requiredTenantBusinessRelation(user)
  }
}

export async function loadAuthorizedBusiness(
  client: TenantResourceAuthorizationClient,
  user: BusinessAuthorizationUser,
  id: string
): Promise<Business | null> {
  return client.business.findFirst({ where: authorizedBusinessWhere(user, id) })
}

export async function loadAuthorizedConversation(
  client: TenantResourceAuthorizationClient,
  user: BusinessAuthorizationUser,
  id: string
): Promise<Conversation | null> {
  return client.conversation.findFirst({ where: authorizedConversationWhere(user, id) })
}

export async function loadAuthorizedMessage(
  client: TenantResourceAuthorizationClient,
  user: BusinessAuthorizationUser,
  id: string
): Promise<Message | null> {
  return client.message.findFirst({ where: authorizedMessageWhere(user, id) })
}

export async function loadAuthorizedAppointment(
  client: TenantResourceAuthorizationClient,
  user: BusinessAuthorizationUser,
  id: string
): Promise<Appointment | null> {
  return client.appointment.findFirst({ where: authorizedAppointmentWhere(user, id) })
}

export async function loadAuthorizedBookingDeposit(
  client: TenantResourceAuthorizationClient,
  user: BusinessAuthorizationUser,
  id: string
): Promise<BookingDeposit | null> {
  return client.bookingDeposit.findFirst({ where: authorizedBookingDepositWhere(user, id) })
}

export async function loadAuthorizedProfessional(
  client: TenantResourceAuthorizationClient,
  user: BusinessAuthorizationUser,
  id: string
): Promise<Professional | null> {
  return client.professional.findFirst({ where: authorizedProfessionalWhere(user, id) })
}

export async function loadAuthorizedService(
  client: TenantResourceAuthorizationClient,
  user: BusinessAuthorizationUser,
  id: string
): Promise<Service | null> {
  return client.service.findFirst({ where: authorizedServiceWhere(user, id) })
}

export async function loadAuthorizedCustomer(
  client: TenantResourceAuthorizationClient,
  user: BusinessAuthorizationUser,
  id: string
): Promise<Customer | null> {
  return client.customer.findFirst({ where: authorizedCustomerWhere(user, id) })
}

export async function loadAuthorizedScheduleBlock(
  client: TenantResourceAuthorizationClient,
  user: BusinessAuthorizationUser,
  id: string
): Promise<ScheduleBlock | null> {
  return client.scheduleBlock.findFirst({ where: authorizedScheduleBlockWhere(user, id) })
}

export async function loadAuthorizedServiceCategory(
  client: TenantResourceAuthorizationClient,
  user: BusinessAuthorizationUser,
  id: string
): Promise<ServiceCategory | null> {
  return client.serviceCategory.findFirst({ where: authorizedServiceCategoryWhere(user, id) })
}

export async function loadAuthorizedCampaign(
  client: TenantResourceAuthorizationClient,
  user: BusinessAuthorizationUser,
  id: string
): Promise<Campaign | null> {
  return client.campaign.findFirst({ where: authorizedCampaignWhere(user, id) })
}

export async function loadAuthorizedWhatsAppTemplate(
  client: TenantResourceAuthorizationClient,
  user: BusinessAuthorizationUser,
  id: string
): Promise<WhatsAppTemplate | null> {
  return client.whatsAppTemplate.findFirst({ where: authorizedWhatsAppTemplateWhere(user, id) })
}

export async function loadAuthorizedReminderAutomation(
  client: TenantResourceAuthorizationClient,
  user: BusinessAuthorizationUser,
  id: string
): Promise<ReminderAutomation | null> {
  return client.reminderAutomation.findFirst({ where: authorizedReminderAutomationWhere(user, id) })
}

export async function loadAuthorizedCampaignDelivery(
  client: TenantResourceAuthorizationClient,
  user: BusinessAuthorizationUser,
  id: string
): Promise<CampaignDelivery | null> {
  return client.campaignDelivery.findFirst({ where: authorizedCampaignDeliveryWhere(user, id) })
}

export async function loadAuthorizedStaffUser(
  client: TenantResourceAuthorizationClient,
  user: BusinessAuthorizationUser,
  id: string
): Promise<User | null> {
  return client.user.findFirst({ where: authorizedStaffUserWhere(user, id) })
}
