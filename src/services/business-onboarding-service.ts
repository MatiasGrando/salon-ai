import { prisma } from '../config/prisma.js'

export const BUSINESS_ONBOARDING_STEPS = [
  { key: 'accountCreated', label: 'Cuenta creada' },
  { key: 'ownerLoggedIn', label: 'Primer acceso realizado' },
  { key: 'profileComplete', label: 'Datos del comercio completos' },
  { key: 'hasServices', label: 'Servicios cargados' },
  { key: 'hasProfessionals', label: 'Profesionales cargados' },
  { key: 'hasBusinessHours', label: 'Horarios configurados' },
  { key: 'whatsappConnected', label: 'WhatsApp conectado' },
  { key: 'landingConfigured', label: 'Landing configurada' }
] as const

export type BusinessOnboardingStepKey = typeof BUSINESS_ONBOARDING_STEPS[number]['key']

export async function refreshBusinessOnboarding(businessId: string) {
  const [business, serviceCount, professionalCount, businessHoursCount, ownerLogin] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        contactPhone: true,
        contactEmail: true,
        landingEnabled: true,
        landingSubtitle: true,
        landingDescription: true,
        coverImageUrl: true,
        whatsappConfig: { select: { connectionStatus: true } }
      }
    }),
    prisma.service.count({ where: { businessId } }),
    prisma.professional.count({ where: { businessId, isActive: true } }),
    prisma.businessHours.count({ where: { businessId } }),
    prisma.user.findFirst({
      where: { businessId, role: 'BUSINESS_ADMIN', firstLoginAt: { not: null } },
      select: { id: true }
    })
  ])

  if (!business) return null

  const flags: Record<BusinessOnboardingStepKey, boolean> = {
    accountCreated: true,
    ownerLoggedIn: Boolean(ownerLogin),
    profileComplete: Boolean(business.name.trim() && business.contactPhone?.trim() && business.contactEmail?.trim()),
    hasServices: serviceCount > 0,
    hasProfessionals: professionalCount > 0,
    hasBusinessHours: businessHoursCount > 0,
    whatsappConnected: business.whatsappConfig?.connectionStatus === 'CONNECTED',
    landingConfigured: Boolean(
      business.landingEnabled &&
      (business.landingSubtitle?.trim() || business.landingDescription?.trim() || business.coverImageUrl?.trim())
    )
  }
  const totalSteps = BUSINESS_ONBOARDING_STEPS.length
  const completedSteps = BUSINESS_ONBOARDING_STEPS.filter((step) => flags[step.key]).length
  const progress = Math.round((completedSteps / totalSteps) * 100)

  const status = await prisma.businessOnboardingStatus.upsert({
    where: { businessId },
    create: { businessId, ...flags, completedSteps, totalSteps, progress },
    update: { ...flags, completedSteps, totalSteps, progress }
  })

  return serializeBusinessOnboarding(status)
}

export function serializeBusinessOnboarding(status: {
  businessId: string
  accountCreated: boolean
  ownerLoggedIn: boolean
  profileComplete: boolean
  hasServices: boolean
  hasProfessionals: boolean
  hasBusinessHours: boolean
  whatsappConnected: boolean
  landingConfigured: boolean
  completedSteps: number
  totalSteps: number
  progress: number
  updatedAt: Date
}) {
  const steps = BUSINESS_ONBOARDING_STEPS.map((step) => ({
    key: step.key,
    label: step.label,
    completed: status[step.key]
  }))
  return {
    ...status,
    steps,
    missingSteps: steps.filter((step) => !step.completed).map((step) => step.label)
  }
}
