export const STAFF_PROFILES = ['PROFESSIONAL', 'SECRETARY'] as const
export const STAFF_PERMISSION_PRESETS = ['PROFESSIONAL_DEFAULT', 'SECRETARY_READ_ONLY', 'SECRETARY_STANDARD', 'SECRETARY_OPERATIONS', 'SECRETARY_CASHIER', 'CUSTOM'] as const
export const STAFF_AGENDA_SCOPES = ['OWN', 'ALL'] as const

export type StaffProfile = typeof STAFF_PROFILES[number]
export type StaffPermissionPreset = typeof STAFF_PERMISSION_PRESETS[number]
export type StaffAgendaScope = typeof STAFF_AGENDA_SCOPES[number]

export type StaffPermissions = {
  agendaScope: StaffAgendaScope
  canCreateAppointments: boolean
  canEditAppointments: boolean
  canCancelAppointments: boolean
  canManageScheduleBlocks: boolean
  canForceAppointments: boolean
  canViewCustomers: boolean
  canCreateCustomers: boolean
  canEditCustomers: boolean
  canManageCustomerNotes: boolean
  canManageCustomerMarketing: boolean
  canViewConversations: boolean
  canReplyConversations: boolean
  canManageDeposits: boolean
  canViewOperationalReports: boolean
  canViewFinancialAmounts: boolean
}

export const STAFF_PRESET_DEFINITIONS: Record<Exclude<StaffPermissionPreset, 'CUSTOM'>, {
  label: string
  description: string
  profile: StaffProfile
  permissions: StaffPermissions
}> = {
  PROFESSIONAL_DEFAULT: {
    label: 'Profesional',
    description: 'Ve su propia agenda y puede crear, reprogramar y cancelar sus turnos. No accede a clientes, conversaciones, reportes ni configuraciones.',
    profile: 'PROFESSIONAL',
    permissions: permissions({ agendaScope: 'OWN', canCreateAppointments: true, canEditAppointments: true, canCancelAppointments: true })
  },
  SECRETARY_READ_ONLY: {
    label: 'Secretaria · Solo lectura',
    description: 'Ve la agenda completa, los clientes y la información operativa, pero no puede crear ni modificar turnos, clientes o conversaciones.',
    profile: 'SECRETARY',
    permissions: permissions({ agendaScope: 'ALL', canViewCustomers: true })
  },
  SECRETARY_STANDARD: {
    label: 'Secretaria · Estándar',
    description: 'Gestiona la agenda completa, clientes, notas, preferencias de contacto y responde conversaciones. No administra bloqueos, señas ni reportes.',
    profile: 'SECRETARY',
    permissions: permissions({
      agendaScope: 'ALL', canCreateAppointments: true, canEditAppointments: true, canCancelAppointments: true,
      canViewCustomers: true, canCreateCustomers: true, canEditCustomers: true,
      canManageCustomerNotes: true, canManageCustomerMarketing: true,
      canViewConversations: true, canReplyConversations: true
    })
  },
  SECRETARY_OPERATIONS: {
    label: 'Secretaria · Operaciones',
    description: 'Incluye el perfil estándar y además permite administrar bloqueos de agenda y consultar reportes operativos, sin mostrar importes financieros.',
    profile: 'SECRETARY',
    permissions: permissions({
      agendaScope: 'ALL', canCreateAppointments: true, canEditAppointments: true, canCancelAppointments: true,
      canManageScheduleBlocks: true, canViewCustomers: true, canCreateCustomers: true, canEditCustomers: true,
      canManageCustomerNotes: true, canManageCustomerMarketing: true,
      canViewConversations: true, canReplyConversations: true, canViewOperationalReports: true
    })
  },
  SECRETARY_CASHIER: {
    label: 'Secretaria · Caja',
    description: 'Incluye operaciones y suma aprobación o rechazo de señas y acceso a importes financieros. Recomendado solo para personal de confianza.',
    profile: 'SECRETARY',
    permissions: permissions({
      agendaScope: 'ALL', canCreateAppointments: true, canEditAppointments: true, canCancelAppointments: true,
      canManageScheduleBlocks: true, canViewCustomers: true, canCreateCustomers: true, canEditCustomers: true,
      canManageCustomerNotes: true, canManageCustomerMarketing: true,
      canViewConversations: true, canReplyConversations: true, canManageDeposits: true,
      canViewOperationalReports: true, canViewFinancialAmounts: true
    })
  }
}

function permissions(overrides: Partial<StaffPermissions>): StaffPermissions {
  return {
    agendaScope: 'OWN',
    canCreateAppointments: false,
    canEditAppointments: false,
    canCancelAppointments: false,
    canManageScheduleBlocks: false,
    canForceAppointments: false,
    canViewCustomers: false,
    canCreateCustomers: false,
    canEditCustomers: false,
    canManageCustomerNotes: false,
    canManageCustomerMarketing: false,
    canViewConversations: false,
    canReplyConversations: false,
    canManageDeposits: false,
    canViewOperationalReports: false,
    canViewFinancialAmounts: false,
    ...overrides
  }
}

export function resolveStaffPermissions(input: Partial<StaffPermissions> & {
  staffProfile?: string | null
  permissionPreset?: string | null
}) {
  const staffProfile: StaffProfile = input.staffProfile === 'SECRETARY' ? 'SECRETARY' : 'PROFESSIONAL'
  const requestedPreset = STAFF_PERMISSION_PRESETS.includes(input.permissionPreset as StaffPermissionPreset)
    ? input.permissionPreset as StaffPermissionPreset
    : staffProfile === 'SECRETARY' ? 'SECRETARY_STANDARD' : 'PROFESSIONAL_DEFAULT'
  const compatiblePreset = requestedPreset === 'CUSTOM'
    || STAFF_PRESET_DEFINITIONS[requestedPreset].profile === staffProfile
    ? requestedPreset
    : staffProfile === 'SECRETARY' ? 'SECRETARY_STANDARD' : 'PROFESSIONAL_DEFAULT'
  const base = compatiblePreset === 'CUSTOM'
    ? permissions({ agendaScope: staffProfile === 'SECRETARY' ? 'ALL' : 'OWN' })
    : STAFF_PRESET_DEFINITIONS[compatiblePreset].permissions
  const merged = compatiblePreset === 'CUSTOM' ? permissions({ ...base, ...pickPermissions(input) }) : { ...base }

  if (staffProfile === 'SECRETARY') merged.agendaScope = 'ALL'
  if (staffProfile === 'PROFESSIONAL') merged.agendaScope = 'OWN'
  if (!merged.canViewCustomers) {
    merged.canCreateCustomers = false
    merged.canEditCustomers = false
    merged.canManageCustomerNotes = false
    merged.canManageCustomerMarketing = false
  }
  if (!merged.canViewConversations) {
    merged.canReplyConversations = false
    merged.canManageDeposits = false
  }
  if (!merged.canCreateAppointments && !merged.canEditAppointments) merged.canForceAppointments = false
  if (!merged.canViewOperationalReports) merged.canViewFinancialAmounts = false

  return { staffProfile, permissionPreset: compatiblePreset, permissions: merged }
}

function pickPermissions(input: Partial<StaffPermissions>) {
  const result: Partial<StaffPermissions> = {}
  for (const key of Object.keys(permissions({})) as Array<keyof StaffPermissions>) {
    if (key === 'agendaScope') {
      if (STAFF_AGENDA_SCOPES.includes(input.agendaScope as StaffAgendaScope)) result[key] = input[key] as StaffAgendaScope
    } else if (typeof input[key] === 'boolean') {
      ;(result as Record<string, unknown>)[key] = input[key]
    }
  }
  return result
}

export type StaffAuthorizationUser = StaffPermissions & {
  role: string
  staffProfile?: string | null
  professionalId?: string | null
}

export function canStaffAccessRoute(user: StaffAuthorizationUser, method: string, rawPath: string) {
  if (user.role !== 'STAFF') return true
  const path = rawPath.split('?')[0] || '/'
  const verb = method.toUpperCase()

  if (path.startsWith('/staff-users') || path.startsWith('/admin/') || path.startsWith('/businesses') && verb !== 'GET') return false
  if (/^\/businesses\/[^/]+\/(?:whatsapp|instagram|payment)(?:-|\/)/.test(path) || path.startsWith('/crm/ai-settings') || path.startsWith('/crm/maintenance')) return false
  if (path.startsWith('/campaign') || path.startsWith('/whatsapp-template') || path.startsWith('/reminder-') || path.startsWith('/post-sale')) return false
  if (path.startsWith('/professionals') || path.startsWith('/services') || path.startsWith('/service-categories') || path.startsWith('/professional-hours') || path.startsWith('/business-hours')) {
    return verb === 'GET'
  }
  if (path.startsWith('/customers')) {
    if (path.endsWith('/marketing-preference')) return verb === 'GET' ? user.canViewCustomers : user.canManageCustomerMarketing
    if (path.endsWith('/notes')) return verb === 'GET' ? user.canViewCustomers : user.canManageCustomerNotes
    if (verb === 'GET') return user.canViewCustomers
    if (verb === 'POST') return user.canCreateCustomers
    if (verb === 'PATCH') return user.canEditCustomers
    return false
  }
  if (path.startsWith('/crm/conversations') || path.startsWith('/crm/messages')) {
    if (/\/deposit\/(?:approve|reject)$/.test(path)) return user.canManageDeposits
    return verb === 'GET' ? user.canViewConversations : user.canReplyConversations
  }
  if (path === '/crm/events') return verb === 'GET' && user.canViewConversations
  if (path.startsWith('/crm/deposits')) {
    return verb === 'GET' ? user.canViewConversations : user.canManageDeposits
  }
  if (path.startsWith('/reports/')) return verb === 'GET' && user.canViewOperationalReports
  if (path.startsWith('/schedule-blocks')) return verb === 'GET' || user.canManageScheduleBlocks
  if (path.startsWith('/appointments')) {
    if (verb === 'GET') return true
    if (verb === 'POST') return user.canCreateAppointments
    if (verb === 'DELETE') return user.canCancelAppointments
    if (path.endsWith('/status')) return user.canCancelAppointments || user.canEditAppointments
    return user.canEditAppointments
  }
  return true
}

export function staffVisibleSections(user: StaffAuthorizationUser) {
  if (user.role !== 'STAFF') return ['conversations', 'agenda', 'customers', 'professionals', 'services', 'campaigns', 'reports', 'settings']
  return [
    user.canViewConversations ? 'conversations' : null,
    'agenda',
    user.canViewCustomers ? 'customers' : null,
    user.canViewOperationalReports ? 'reports' : null
  ].filter((value): value is string => Boolean(value))
}

export function staffCanUseProfessional(user: StaffAuthorizationUser, professionalId: string | null | undefined) {
  return user.role !== 'STAFF' || user.agendaScope === 'ALL' || Boolean(user.professionalId && user.professionalId === professionalId)
}

export function staffProfileRequiresProfessional(profile: string | null | undefined) {
  return profile !== 'SECRETARY'
}

export function staffAuditAction(method: string, rawPath: string) {
  const path = rawPath.split('?')[0] || '/'
  const resource = path.split('/').filter(Boolean)[0] || 'unknown'
  return `${method.toUpperCase()}_${resource.replace(/-/g, '_').toUpperCase()}`
}
