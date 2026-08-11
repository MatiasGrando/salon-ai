export type WeexSupportBotNode =
  | 'MAIN_MENU'
  | 'CLIENT_MENU'
  | 'CLIENT_PROBLEM'
  | 'CLIENT_ADMIN'
  | 'CLIENT_CHANGE'
  | 'SERVICES_MENU'
  | 'SERVICE_DETAIL'
  | 'PRICES_MENU'
  | 'PRICE_DETAIL'
  | 'FAQ_MENU'
  | 'HANDOFF_NAME'
  | 'HANDOFF_REASON'
  | 'HANDOFF_CONFIRM'
  | 'HANDOFF_DONE'

export type WeexSupportBotContext = {
  category?: string
  sector?: 'soporte' | 'administracion' | 'comercial' | 'general'
  service?: string
  customerName?: string
  reason?: string
}

export type WeexSupportBotState = {
  node: WeexSupportBotNode
  invalidAttempts: number
  trail: string[]
  context: WeexSupportBotContext
}

export type WeexSupportBotOption = {
  value: string
  label: string
}

export type WeexSupportBotResult = {
  version: 'v1'
  connected: false
  status: 'active' | 'handoff_ready' | 'completed'
  message: string
  options: WeexSupportBotOption[]
  state: WeexSupportBotState
  handoff: null | {
    name: string
    reason: string
    category: string
    sector: NonNullable<WeexSupportBotContext['sector']>
    trail: string[]
  }
}

export const WEEX_SUPPORT_BOT_V1_DEFINITION = {
  botKey: 'weex-support-v1',
  name: 'Bot de atención Weex V1',
  version: 'v1',
  mode: 'OPTIONS_ONLY',
  status: 'DRAFT',
  channel: 'UNASSIGNED',
  connected: false,
  published: false,
  universalOptions: {
    '0': 'Volver',
    '9': 'Hablar con un asesor'
  },
  mainMenu: [
    'Soy cliente',
    'Conocer servicios',
    'Consultar precios',
    'Preguntas frecuentes',
    'Hablar con un asesor'
  ],
  capabilities: {
    artificialIntelligence: false,
    invalidOptionHandling: true,
    menuReturns: true,
    humanHandoff: true,
    capturesNameAndReason: true
  }
}

const MAIN_OPTIONS: WeexSupportBotOption[] = [
  { value: '1', label: 'Soy cliente' },
  { value: '2', label: 'Quiero conocer los servicios' },
  { value: '3', label: 'Consultar precios' },
  { value: '4', label: 'Preguntas frecuentes' },
  { value: '5', label: 'Hablar con un asesor' }
]

const BACK_TO_MAIN: WeexSupportBotOption = { value: '0', label: 'Volver al menú principal' }
const ADVISOR: WeexSupportBotOption = { value: '9', label: 'Hablar con un asesor' }

const NODE_OPTIONS: Partial<Record<WeexSupportBotNode, WeexSupportBotOption[]>> = {
  CLIENT_MENU: [
    { value: '1', label: 'Tengo un problema con el servicio' },
    { value: '2', label: 'Tengo una consulta administrativa' },
    { value: '3', label: 'Quiero modificar o cancelar algo' },
    { value: '4', label: 'Tengo otra consulta' },
    ADVISOR,
    BACK_TO_MAIN
  ],
  CLIENT_PROBLEM: [
    { value: '1', label: 'No puedo ingresar' },
    { value: '2', label: 'Algo no funciona correctamente' },
    { value: '3', label: 'Tengo un problema con WhatsApp' },
    { value: '4', label: 'Tengo un problema con turnos o agenda' },
    { value: '5', label: 'Otro problema' },
    ADVISOR,
    { value: '0', label: 'Volver a clientes' }
  ],
  CLIENT_ADMIN: [
    { value: '1', label: 'Facturación' },
    { value: '2', label: 'Pagos' },
    { value: '3', label: 'Plan contratado' },
    { value: '4', label: 'Datos de mi cuenta' },
    { value: '5', label: 'Otra consulta administrativa' },
    ADVISOR,
    { value: '0', label: 'Volver a clientes' }
  ],
  CLIENT_CHANGE: [
    { value: '1', label: 'Modificar mi plan' },
    { value: '2', label: 'Actualizar datos de mi cuenta' },
    { value: '3', label: 'Cancelar un servicio' },
    { value: '4', label: 'Otra modificación' },
    ADVISOR,
    { value: '0', label: 'Volver a clientes' }
  ],
  SERVICES_MENU: [
    { value: '1', label: 'Agenda y gestión de turnos' },
    { value: '2', label: 'Bot de WhatsApp' },
    { value: '3', label: 'CRM' },
    { value: '4', label: 'Automatizaciones' },
    ADVISOR,
    BACK_TO_MAIN
  ],
  SERVICE_DETAIL: [
    { value: '1', label: 'Consultar precios' },
    { value: '2', label: 'Conocer otro servicio' },
    ADVISOR,
    BACK_TO_MAIN
  ],
  PRICES_MENU: [
    { value: '1', label: 'Agenda y gestión de turnos' },
    { value: '2', label: 'Bot de WhatsApp' },
    { value: '3', label: 'CRM' },
    { value: '4', label: 'Automatizaciones' },
    ADVISOR,
    BACK_TO_MAIN
  ],
  PRICE_DETAIL: [
    ADVISOR,
    { value: '0', label: 'Consultar otro servicio' }
  ],
  FAQ_MENU: [
    { value: '1', label: 'Horarios de atención' },
    { value: '2', label: 'Canales de soporte' },
    { value: '3', label: 'Implementación' },
    { value: '4', label: 'Pagos y facturación' },
    { value: '5', label: 'Tengo otra pregunta' },
    ADVISOR,
    BACK_TO_MAIN
  ],
  HANDOFF_CONFIRM: [
    { value: '1', label: 'Confirmar y preparar derivación' },
    { value: '2', label: 'Corregir nombre' },
    { value: '3', label: 'Corregir motivo' },
    { value: '0', label: 'Cancelar y volver al menú principal' }
  ],
  HANDOFF_DONE: [BACK_TO_MAIN]
}

const SERVICE_DETAILS: Record<string, string> = {
  agenda: 'Permite organizar turnos, horarios, profesionales y clientes desde un mismo lugar.',
  whatsapp: 'Automatiza consultas frecuentes y guía a cada persona mediante opciones controladas.',
  crm: 'Centraliza clientes, consultas y conversaciones para mejorar el seguimiento comercial.',
  automatizaciones: 'Reduce tareas manuales mediante recordatorios, seguimientos, notificaciones y procesos internos.'
}

const VALID_NODES = new Set<WeexSupportBotNode>([
  'MAIN_MENU',
  'CLIENT_MENU',
  'CLIENT_PROBLEM',
  'CLIENT_ADMIN',
  'CLIENT_CHANGE',
  'SERVICES_MENU',
  'SERVICE_DETAIL',
  'PRICES_MENU',
  'PRICE_DETAIL',
  'FAQ_MENU',
  'HANDOFF_NAME',
  'HANDOFF_REASON',
  'HANDOFF_CONFIRM',
  'HANDOFF_DONE'
])

export class WeexSupportBotV1 {
  start(): WeexSupportBotResult {
    return this.result(
      this.initialState(),
      [
        '👋 ¡Hola! Gracias por comunicarte con Weex.',
        'Soy el asistente virtual y puedo ayudarte con consultas rápidas.',
        '',
        'Elegí una opción para continuar:'
      ].join('\n'),
      MAIN_OPTIONS
    )
  }

  handle(input: string, unsafeState?: Partial<WeexSupportBotState> | null): WeexSupportBotResult {
    const state = this.sanitizeState(unsafeState)
    const raw = String(input ?? '').trim()
    const normalized = this.normalize(raw)

    if (state.node === 'HANDOFF_NAME') return this.captureName(raw, normalized, state)
    if (state.node === 'HANDOFF_REASON') return this.captureReason(raw, normalized, state)
    if (state.node === 'HANDOFF_CONFIRM') return this.confirmHandoff(normalized, state)
    if (state.node === 'HANDOFF_DONE') return normalized === '0' ? this.start() : this.invalid(state)

    if (normalized === 'menu' || normalized === 'inicio') return this.start()
    if (normalized === 'asesor' || normalized === '9') return this.beginHandoff(state)

    switch (state.node) {
      case 'MAIN_MENU':
        return this.handleMain(normalized, state)
      case 'CLIENT_MENU':
        return this.handleClientMenu(normalized, state)
      case 'CLIENT_PROBLEM':
        return this.handleClientCategory(normalized, state, {
          sector: 'soporte',
          backNode: 'CLIENT_MENU',
          labels: {
            '1': 'Problema de ingreso',
            '2': 'Funcionamiento incorrecto',
            '3': 'Problema con WhatsApp',
            '4': 'Problema con agenda o turnos',
            '5': 'Otro problema técnico'
          }
        })
      case 'CLIENT_ADMIN':
        return this.handleClientCategory(normalized, state, {
          sector: 'administracion',
          backNode: 'CLIENT_MENU',
          labels: {
            '1': 'Facturación',
            '2': 'Pagos',
            '3': 'Plan contratado',
            '4': 'Datos de la cuenta',
            '5': 'Otra consulta administrativa'
          }
        })
      case 'CLIENT_CHANGE':
        return this.handleClientCategory(normalized, state, {
          sector: 'administracion',
          backNode: 'CLIENT_MENU',
          labels: {
            '1': 'Modificar el plan',
            '2': 'Actualizar datos de la cuenta',
            '3': 'Cancelar un servicio',
            '4': 'Otra modificación'
          }
        })
      case 'SERVICES_MENU':
        return this.handleServices(normalized, state)
      case 'SERVICE_DETAIL':
        return this.handleServiceDetail(normalized, state)
      case 'PRICES_MENU':
        return this.handlePrices(normalized, state)
      case 'PRICE_DETAIL':
        return normalized === '0'
          ? this.showNode(state, 'PRICES_MENU', '¿Sobre qué servicio querés consultar precios?')
          : this.invalid(state)
      case 'FAQ_MENU':
        return this.handleFaq(normalized, state)
    }
  }

  private handleMain(input: string, state: WeexSupportBotState) {
    if (input === '0') return this.start()
    if (input === '1') return this.showNode(state, 'CLIENT_MENU', '👤 ¿Con qué necesitás ayuda?')
    if (input === '2') return this.showNode(state, 'SERVICES_MENU', '🚀 ¿Qué servicio te gustaría conocer?')
    if (input === '3') return this.showNode(state, 'PRICES_MENU', '💰 ¿Sobre qué servicio querés consultar precios?')
    if (input === '4') return this.showNode(state, 'FAQ_MENU', '❓ Elegí una pregunta frecuente:')
    if (input === '5') return this.beginHandoff(state)
    return this.invalid(state)
  }

  private handleClientMenu(input: string, state: WeexSupportBotState) {
    if (input === '0') return this.start()
    if (input === '1') return this.showNode(state, 'CLIENT_PROBLEM', 'Indicá qué tipo de inconveniente tenés:')
    if (input === '2') return this.showNode(state, 'CLIENT_ADMIN', '¿Sobre qué necesitás información?')
    if (input === '3') return this.showNode(state, 'CLIENT_CHANGE', '¿Qué gestión querés realizar?')
    if (input === '4') return this.beginHandoff(this.withContext(state, { category: 'Otra consulta de cliente', sector: 'general' }))
    return this.invalid(state)
  }

  private handleClientCategory(
    input: string,
    state: WeexSupportBotState,
    config: {
      sector: NonNullable<WeexSupportBotContext['sector']>
      backNode: WeexSupportBotNode
      labels: Record<string, string>
    }
  ) {
    if (input === '0') return this.showNode(state, config.backNode, '👤 ¿Con qué necesitás ayuda?')
    const category = config.labels[input]
    if (!category) return this.invalid(state)
    return this.beginHandoff(this.withContext(state, { category, sector: config.sector }))
  }

  private handleServices(input: string, state: WeexSupportBotState) {
    if (input === '0') return this.start()
    const serviceMap: Record<string, { key: string; label: string }> = {
      '1': { key: 'agenda', label: 'Agenda y gestión de turnos' },
      '2': { key: 'whatsapp', label: 'Bot de WhatsApp' },
      '3': { key: 'crm', label: 'CRM' },
      '4': { key: 'automatizaciones', label: 'Automatizaciones' }
    }
    const service = serviceMap[input]
    if (!service) return this.invalid(state)
    const next = this.withContext(state, {
      category: `Interés en ${service.label}`,
      sector: 'comercial',
      service: service.key
    })
    return this.showNode(
      next,
      'SERVICE_DETAIL',
      `*${service.label}*\n\n${SERVICE_DETAILS[service.key]}\n\n¿Qué querés hacer ahora?`
    )
  }

  private handleServiceDetail(input: string, state: WeexSupportBotState) {
    if (input === '0') return this.start()
    if (input === '1') {
      return this.showNode(state, 'PRICE_DETAIL', this.pricePendingMessage(state.context.service))
    }
    if (input === '2') return this.showNode(state, 'SERVICES_MENU', '🚀 ¿Qué otro servicio te gustaría conocer?')
    return this.invalid(state)
  }

  private handlePrices(input: string, state: WeexSupportBotState) {
    if (input === '0') return this.start()
    const services: Record<string, string> = {
      '1': 'Agenda y gestión de turnos',
      '2': 'Bot de WhatsApp',
      '3': 'CRM',
      '4': 'Automatizaciones'
    }
    const service = services[input]
    if (!service) return this.invalid(state)
    const next = this.withContext(state, {
      category: `Consulta de precio: ${service}`,
      sector: 'comercial',
      service
    })
    return this.showNode(next, 'PRICE_DETAIL', this.pricePendingMessage(service))
  }

  private handleFaq(input: string, state: WeexSupportBotState) {
    if (input === '0') return this.start()
    if (input === '5') {
      return this.beginHandoff(this.withContext(state, { category: 'Otra pregunta', sector: 'general' }))
    }
    const answers: Record<string, string> = {
      '1': 'Los horarios de atención se completarán antes de activar el bot en un canal real.',
      '2': 'El bot podrá derivar la conversación al equipo humano en el canal que conectemos más adelante.',
      '3': 'El tiempo de implementación depende de los servicios y las integraciones necesarias. Un asesor puede evaluar cada caso.',
      '4': 'Los medios de pago y las condiciones de facturación se completarán con la información comercial aprobada.'
    }
    const answer = answers[input]
    if (!answer) return this.invalid(state)
    return this.result(
      this.touch(state, 'FAQ_MENU'),
      `${answer}\n\nPodés elegir otra pregunta, hablar con un asesor o volver al menú principal.`,
      NODE_OPTIONS.FAQ_MENU ?? []
    )
  }

  private beginHandoff(state: WeexSupportBotState) {
    const next = this.touch(this.withContext(state, {
      category: state.context.category || 'Solicitud de asesor',
      sector: state.context.sector || 'general'
    }), 'HANDOFF_NAME')
    return this.result(next, '🙋 Para derivarte con el equipo, escribí tu nombre y apellido.', [
      { value: '0', label: 'Cancelar y volver al menú principal' }
    ])
  }

  private captureName(raw: string, normalized: string, state: WeexSupportBotState) {
    if (normalized === '0') return this.start()
    const name = raw.replace(/\s+/g, ' ').trim()
    if (name.length < 2 || name.length > 80) {
      return this.result(state, 'Necesito un nombre válido de hasta 80 caracteres para continuar.', [
        { value: '0', label: 'Cancelar y volver al menú principal' }
      ])
    }
    const next = this.touch(this.withContext(state, { customerName: name }), 'HANDOFF_REASON')
    return this.result(next, `Gracias, ${name}. Contanos brevemente cuál es el motivo de tu consulta.`, [
      { value: '0', label: 'Cancelar y volver al menú principal' }
    ])
  }

  private captureReason(raw: string, normalized: string, state: WeexSupportBotState) {
    if (normalized === '0') return this.start()
    const reason = raw.replace(/\s+/g, ' ').trim()
    if (reason.length < 3 || reason.length > 500) {
      return this.result(state, 'Escribí un motivo breve de entre 3 y 500 caracteres.', [
        { value: '0', label: 'Cancelar y volver al menú principal' }
      ])
    }
    const next = this.touch(this.withContext(state, { reason }), 'HANDOFF_CONFIRM')
    return this.result(next, this.handoffSummary(next), NODE_OPTIONS.HANDOFF_CONFIRM ?? [])
  }

  private confirmHandoff(input: string, state: WeexSupportBotState) {
    if (input === '0') return this.start()
    if (input === '2') {
      return this.result(this.touch(state, 'HANDOFF_NAME'), 'Escribí nuevamente tu nombre y apellido.', [
        { value: '0', label: 'Cancelar y volver al menú principal' }
      ])
    }
    if (input === '3') {
      return this.result(this.touch(state, 'HANDOFF_REASON'), 'Escribí nuevamente el motivo de tu consulta.', [
        { value: '0', label: 'Cancelar y volver al menú principal' }
      ])
    }
    if (input !== '1') return this.invalid(state)

    const next = this.touch(state, 'HANDOFF_DONE')
    const handoff = this.buildHandoff(next)
    if (!handoff) return this.result(this.touch(state, 'HANDOFF_NAME'), 'Necesito volver a capturar tus datos. Escribí tu nombre y apellido.', [])

    return this.result(
      next,
      [
        `✅ Gracias, ${handoff.name}. La consulta quedó preparada para derivación.`,
        '',
        `Sector: ${this.sectorLabel(handoff.sector)}`,
        `Motivo: ${handoff.reason}`,
        '',
        'Esta versión todavía no envía datos ni crea tickets en una cuenta externa.'
      ].join('\n'),
      NODE_OPTIONS.HANDOFF_DONE ?? [],
      'completed',
      handoff
    )
  }

  private invalid(state: WeexSupportBotState) {
    const attempts = state.invalidAttempts + 1
    const next = { ...state, invalidAttempts: attempts }
    if (attempts >= 3) {
      return this.result(
        next,
        'Parece que estás teniendo dificultades para elegir una opción. Podés hablar con un asesor o volver al menú principal.',
        [ADVISOR, BACK_TO_MAIN]
      )
    }
    return this.result(
      next,
      'No pude reconocer esa opción. Elegí uno de los números disponibles en el menú.',
      this.optionsFor(state.node)
    )
  }

  private showNode(state: WeexSupportBotState, node: WeexSupportBotNode, message: string) {
    const next = this.touch(state, node)
    return this.result(next, message, this.optionsFor(node))
  }

  private touch(state: WeexSupportBotState, node: WeexSupportBotNode): WeexSupportBotState {
    return {
      ...state,
      node,
      invalidAttempts: 0,
      trail: [...state.trail, node].slice(-30)
    }
  }

  private withContext(state: WeexSupportBotState, context: WeexSupportBotContext): WeexSupportBotState {
    return {
      ...state,
      context: {
        ...state.context,
        ...context
      }
    }
  }

  private optionsFor(node: WeexSupportBotNode) {
    return node === 'MAIN_MENU' ? MAIN_OPTIONS : NODE_OPTIONS[node] ?? []
  }

  private result(
    state: WeexSupportBotState,
    message: string,
    options: WeexSupportBotOption[],
    status: WeexSupportBotResult['status'] = state.node === 'HANDOFF_CONFIRM' ? 'handoff_ready' : 'active',
    handoff: WeexSupportBotResult['handoff'] = null
  ): WeexSupportBotResult {
    return {
      version: 'v1',
      connected: false,
      status,
      message,
      options,
      state,
      handoff
    }
  }

  private handoffSummary(state: WeexSupportBotState) {
    return [
      'Revisá los datos de tu consulta:',
      '',
      `Nombre: ${state.context.customerName || '-'}`,
      `Motivo: ${state.context.reason || '-'}`,
      `Categoría: ${state.context.category || 'Consulta general'}`,
      `Sector sugerido: ${this.sectorLabel(state.context.sector || 'general')}`
    ].join('\n')
  }

  private buildHandoff(state: WeexSupportBotState): WeexSupportBotResult['handoff'] {
    const name = state.context.customerName?.trim()
    const reason = state.context.reason?.trim()
    if (!name || !reason) return null
    return {
      name,
      reason,
      category: state.context.category || 'Consulta general',
      sector: state.context.sector || 'general',
      trail: [...state.trail]
    }
  }

  private pricePendingMessage(service?: string) {
    const label = service || 'el servicio seleccionado'
    return [
      `Información comercial de ${label}:`,
      '',
      'Los precios, planes y condiciones están pendientes de aprobación antes de conectar el bot.',
      '',
      'Podés solicitar asesoramiento o consultar otro servicio.'
    ].join('\n')
  }

  private sectorLabel(sector: NonNullable<WeexSupportBotContext['sector']>) {
    return {
      soporte: 'Soporte',
      administracion: 'Administración',
      comercial: 'Comercial',
      general: 'Atención general'
    }[sector]
  }

  private normalize(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
  }

  private initialState(): WeexSupportBotState {
    return {
      node: 'MAIN_MENU',
      invalidAttempts: 0,
      trail: ['MAIN_MENU'],
      context: {}
    }
  }

  private sanitizeState(input?: Partial<WeexSupportBotState> | null): WeexSupportBotState {
    if (!input || !input.node || !VALID_NODES.has(input.node)) return this.initialState()
    const context = input.context && typeof input.context === 'object' ? input.context : {}
    return {
      node: input.node,
      invalidAttempts: Number.isInteger(input.invalidAttempts) && Number(input.invalidAttempts) >= 0
        ? Math.min(Number(input.invalidAttempts), 3)
        : 0,
      trail: Array.isArray(input.trail)
        ? input.trail.filter((item): item is string => typeof item === 'string').slice(-30)
        : [input.node],
      context: {
        ...(typeof context.category === 'string' ? { category: context.category.slice(0, 120) } : {}),
        ...(context.sector === 'soporte' || context.sector === 'administracion' || context.sector === 'comercial' || context.sector === 'general'
          ? { sector: context.sector }
          : {}),
        ...(typeof context.service === 'string' ? { service: context.service.slice(0, 120) } : {}),
        ...(typeof context.customerName === 'string' ? { customerName: context.customerName.slice(0, 80) } : {}),
        ...(typeof context.reason === 'string' ? { reason: context.reason.slice(0, 500) } : {})
      }
    }
  }
}
