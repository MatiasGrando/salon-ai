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
  | 'HANDOFF_CUSTOMER_CODE'
  | 'HANDOFF_NAME'
  | 'HANDOFF_REASON'
  | 'HANDOFF_CONFIRM'
  | 'HANDOFF_DONE'

export type WeexSupportBotContext = {
  category?: string
  sector?: 'soporte' | 'administracion' | 'comercial' | 'general'
  service?: string
  customerIdentificationRequired?: boolean
  customerCode?: string
  customerCodeStatus?: 'verified' | 'missing'
  customerBusinessName?: string
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
    customerCode: string | null
    customerCodeStatus: 'verified' | 'missing' | 'not_required'
    customerBusinessName: string | null
    category: string
    sector: NonNullable<WeexSupportBotContext['sector']>
    trail: string[]
  }
}

export type WeexSupportBotCustomerIdentity = {
  status: 'verified' | 'not_found'
  customerCode: string
  businessName?: string
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
  },
  commercialInformation: {
    humanServiceHours: 'Lunes a sábado de 11:00 a 18:00',
    virtualAssistantAvailability: '24/7',
    paymentMethods: ['Transferencia', 'Débito', 'Crédito', 'Efectivo'],
    plansArePerBranch: true,
    professionalsIncluded: 4,
    promotion: '50% durante los primeros 6 meses con primer pago confirmado hasta el 31/08/2026',
    plans: [
      { key: '1', name: 'Agenda + CRM', promotionalMonthlyArs: 35000, listMonthlyArs: 70000 },
      { key: '2A', name: 'Agenda + bot económico + CRM', promotionalMonthlyArs: 55000, listMonthlyArs: 110000 },
      { key: '2B', name: 'Agenda + bot inteligente + CRM', promotionalMonthlyArs: 70000, listMonthlyArs: 140000 },
      { key: '3', name: 'Agenda + bot inteligente + CRM + landing desde cero', promotionalMonthlyArs: 87500, listMonthlyArs: 175000 }
    ],
    standaloneBot: {
      setupArs: 100000,
      monthlyArs: 20000,
      metaWhatsappCurrentChargeArs: 0
    }
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
    { value: '1', label: 'Plan 1 · Agenda + CRM' },
    { value: '2', label: 'Plan 2A · Agenda + bot económico + CRM' },
    { value: '3', label: 'Plan 2B · Agenda + bot inteligente + CRM' },
    { value: '4', label: 'Plan 3 · Solución completa + landing desde cero' },
    { value: '5', label: 'Bot por opciones sin plan' },
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
    { value: '5', label: 'Baja o cancelación' },
    { value: '6', label: 'Tengo otra pregunta' },
    ADVISOR,
    BACK_TO_MAIN
  ],
  HANDOFF_CONFIRM: [
    { value: '1', label: 'Confirmar y preparar derivación' },
    { value: '2', label: 'Corregir nombre' },
    { value: '3', label: 'Corregir motivo' },
    { value: '0', label: 'Cancelar y volver al menú principal' }
  ],
  HANDOFF_CUSTOMER_CODE: [
    { value: '1', label: 'No recuerdo mi número de cliente' },
    ADVISOR,
    { value: '0', label: 'Cancelar y volver al menú principal' }
  ],
  HANDOFF_DONE: [BACK_TO_MAIN]
}

const SERVICE_DETAILS: Record<string, string> = {
  agenda: 'Organiza agenda, turnos, profesionales, servicios, clientes, historial de visitas y recordatorios automáticos. Todos los planes incluyen hasta 4 profesionales y corresponden a una sucursal.',
  whatsapp: 'Podés elegir un bot económico por menús y opciones o un bot inteligente con interpretación de lenguaje natural. Ambos pueden responder, reservar y derivar a una persona cuando sea necesario.',
  crm: 'Centraliza clientes, conversaciones, agenda, campañas, seguimiento comercial y automatizaciones desde un mismo lugar.',
  automatizaciones: 'Las automatizaciones y campañas ya están incorporadas en el CRM, no requieren tiempo adicional de implementación y su precio está incluido en los planes.'
}

const PLAN_PRICES: Record<string, string> = {
  '1': [
    '*Plan 1 · Agenda + CRM*',
    'Incluye agenda inteligente, gestión de turnos, profesionales y servicios, CRM, historial de visitas y recordatorios automáticos.',
    'También incluye una landing adaptable utilizando nuestras plantillas.',
    '',
    'Precio de lista: ARS 70.000 por mes.',
    'Promoción: ARS 35.000 por mes durante los primeros 6 meses.'
  ].join('\n'),
  '2': [
    '*Plan 2A · Agenda + bot económico + CRM*',
    'Incluye todo el Plan 1 más bot por menús y opciones, atención y reservas 24/7, preguntas frecuentes, confirmaciones, recordatorios y derivación humana.',
    'También incluye una landing adaptable utilizando nuestras plantillas.',
    '',
    'Precio de lista: ARS 110.000 por mes.',
    'Promoción: ARS 55.000 por mes durante los primeros 6 meses.'
  ].join('\n'),
  '3': [
    '*Plan 2B · Agenda + bot inteligente + CRM*',
    'Incluye todo el Plan 1 más interpretación de lenguaje natural, respuestas personalizadas, sugerencias, mayor contexto y derivación humana.',
    'También incluye una landing adaptable utilizando nuestras plantillas.',
    '',
    'Precio de lista: ARS 140.000 por mes.',
    'Promoción: ARS 70.000 por mes durante los primeros 6 meses.'
  ].join('\n'),
  '4': [
    '*Plan 3 · Agenda + bot inteligente + CRM + landing desde cero*',
    'Incluye todo el Plan 2B y una landing creada desde cero según el diseño del cliente, con hosting propio incluido. El dominio se evalúa en la reunión porque su precio puede variar.',
    '',
    'Precio de lista: ARS 175.000 por mes.',
    'Promoción: ARS 87.500 por mes durante los primeros 6 meses.',
    'Tiempo estimado de la landing: alrededor de 15 días.'
  ].join('\n'),
  '5': [
    '*Bot por opciones contratado de forma individual*',
    'Instalación y configuración inicial: ARS 100.000, pago único.',
    'Abono de funcionamiento y mantenimiento básico: ARS 20.000 por mes.',
    'Incluye un flujo principal, hasta 5 secciones, hasta 25 respuestas o caminos, una ronda de correcciones, derivación humana y configuración en un número de WhatsApp.',
    'Los cambios importantes posteriores se cotizan aparte.'
  ].join('\n')
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
  'HANDOFF_CUSTOMER_CODE',
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

  handle(
    input: string,
    unsafeState?: Partial<WeexSupportBotState> | null,
    customerIdentity?: WeexSupportBotCustomerIdentity
  ): WeexSupportBotResult {
    const state = this.sanitizeState(unsafeState)
    const raw = String(input ?? '').trim()
    const normalized = this.normalize(raw)

    if (state.node === 'HANDOFF_CUSTOMER_CODE') return this.captureCustomerCode(raw, normalized, state, customerIdentity)
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
    if (input === '1') return this.showNode(
      this.withContext(state, { customerIdentificationRequired: true }),
      'CLIENT_MENU',
      '👤 ¿Con qué necesitás ayuda?'
    )
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
      return this.showNode(state, 'PRICES_MENU', '💰 Elegí el plan que querés consultar:')
    }
    if (input === '2') return this.showNode(state, 'SERVICES_MENU', '🚀 ¿Qué otro servicio te gustaría conocer?')
    return this.invalid(state)
  }

  private handlePrices(input: string, state: WeexSupportBotState) {
    if (input === '0') return this.start()
    const services: Record<string, string> = {
      '1': 'Plan 1 · Agenda + CRM',
      '2': 'Plan 2A · Agenda + bot económico + CRM',
      '3': 'Plan 2B · Agenda + bot inteligente + CRM',
      '4': 'Plan 3 · Solución completa + landing desde cero',
      '5': 'Bot por opciones sin plan'
    }
    const service = services[input]
    if (!service) return this.invalid(state)
    const next = this.withContext(state, {
      category: `Consulta de precio: ${service}`,
      sector: 'comercial',
      service: input
    })
    return this.showNode(next, 'PRICE_DETAIL', this.pricePendingMessage(input))
  }

  private handleFaq(input: string, state: WeexSupportBotState) {
    if (input === '0') return this.start()
    if (input === '6') {
      return this.beginHandoff(this.withContext(state, { category: 'Otra pregunta', sector: 'general' }))
    }
    const answers: Record<string, string> = {
      '1': 'El asistente virtual está disponible las 24 horas. La atención humana es de lunes a sábado, de 11:00 a 18:00. Fuera de ese horario tu consulta queda registrada y el equipo la retoma sin que tengas que volver a enviarla.',
      '2': 'Por el momento, la atención y el soporte se realizan por este mismo WhatsApp. Intentamos responder lo más rápido posible y muchas consultas se atienden en pocos minutos.',
      '3': 'Una integración estándar puede quedar disponible inmediatamente y una solución personalizada, dentro del día. Una landing diseñada desde cero demora aproximadamente 15 días. La capacitación está incluida y una prueba de hasta 7 días puede ofrecerse según evaluación comercial.',
      '4': 'Aceptamos transferencia, débito, crédito o efectivo. Todavía no contamos con un sistema de cobros integrado. Actualmente Meta/WhatsApp no aplica cargos, aunque esto podría cambiar si modifica sus condiciones. Ante cualquier consulta de pago o facturación te derivamos con un asesor.',
      '5': 'La baja no requiere preaviso ni tiene penalidad. Si el mes ya fue abonado no se reintegra: el servicio continúa hasta fin de mes y se da de baja antes del próximo cobro. Los saldos pendientes los revisa un asesor.'
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
    if (state.context.customerIdentificationRequired && !state.context.customerCodeStatus) {
      return this.result(
        this.touch(state, 'HANDOFF_CUSTOMER_CODE'),
        '🔐 Para identificar tu sucursal, escribí tu número de cliente con formato WX-XXXXXX.\n\nSi no lo recordás, elegí la opción 1 y te derivaremos sin revelar información de la cuenta.',
        NODE_OPTIONS.HANDOFF_CUSTOMER_CODE ?? []
      )
    }
    return this.continueHandoff(state)
  }

  private continueHandoff(state: WeexSupportBotState) {
    const next = this.touch(this.withContext(state, {
      category: state.context.category || 'Solicitud de asesor',
      sector: state.context.sector || 'general'
    }), 'HANDOFF_NAME')
    return this.result(next, '🙋 Para derivarte con el equipo, escribí tu nombre y apellido.', [
      { value: '0', label: 'Cancelar y volver al menú principal' }
    ])
  }

  private captureCustomerCode(
    raw: string,
    normalized: string,
    state: WeexSupportBotState,
    customerIdentity?: WeexSupportBotCustomerIdentity
  ) {
    if (normalized === '0') return this.start()
    if (normalized === '1' || normalized === '9' || normalized === 'asesor') {
      return this.continueHandoff(this.withContext(state, {
        customerCodeStatus: 'missing'
      }))
    }

    const submittedCode = raw.trim().toUpperCase().replace(/\s+/g, '')
    if (!/^WX-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(submittedCode)) {
      return this.result(state, 'El número debe tener el formato WX-XXXXXX. Revisalo o elegí 1 si no lo recordás.', NODE_OPTIONS.HANDOFF_CUSTOMER_CODE ?? [])
    }
    if (!customerIdentity || customerIdentity.status !== 'verified' || customerIdentity.customerCode !== submittedCode) {
      return this.result(state, 'No pudimos verificar ese número de cliente. Revisalo o elegí 1 para continuar con un asesor.', NODE_OPTIONS.HANDOFF_CUSTOMER_CODE ?? [])
    }

    return this.continueHandoff(this.withContext(state, {
      customerCode: submittedCode,
      customerCodeStatus: 'verified',
      ...(customerIdentity.businessName ? { customerBusinessName: customerIdentity.businessName } : {})
    }))
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
        ...(handoff.customerCode ? [`Número de cliente: ${handoff.customerCode}`] : []),
        `Motivo: ${handoff.reason}`,
        '',
        'Un asesor continuará la atención por este mismo WhatsApp.'
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
      `Número de cliente: ${state.context.customerCode || 'No informado'}`,
      ...(state.context.customerBusinessName ? [`Comercio: ${state.context.customerBusinessName}`] : []),
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
      customerCode: state.context.customerCode || null,
      customerCodeStatus: state.context.customerCodeStatus || 'not_required',
      customerBusinessName: state.context.customerBusinessName || null,
      category: state.context.category || 'Consulta general',
      sector: state.context.sector || 'general',
      trail: [...state.trail]
    }
  }

  private pricePendingMessage(service?: string) {
    const detail = service && PLAN_PRICES[service]
      ? PLAN_PRICES[service]
      : 'Un asesor puede ayudarte a elegir el plan más conveniente.'
    return [
      detail,
      '',
      'Todos los planes corresponden a una sucursal, incluyen hasta 4 profesionales y no tienen costo de instalación. Para más de una sucursal, hablá con un asesor.',
      'La promoción del 50% es válida para contrataciones con primer pago confirmado hasta el 31/08/2026 inclusive. Desde el séptimo mes se abona el precio de lista vigente.',
      'Los cargos de Meta/WhatsApp, si existieran en el futuro, se abonan por separado. Ante un volumen extraordinario de conversaciones se evaluará el costo correspondiente.',
      '',
      'Podés solicitar asesoramiento o consultar otro plan.'
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
        ...(context.customerIdentificationRequired === true ? { customerIdentificationRequired: true } : {}),
        ...(typeof context.customerCode === 'string' ? { customerCode: context.customerCode.slice(0, 20) } : {}),
        ...(context.customerCodeStatus === 'verified' || context.customerCodeStatus === 'missing'
          ? { customerCodeStatus: context.customerCodeStatus }
          : {}),
        ...(typeof context.customerBusinessName === 'string' ? { customerBusinessName: context.customerBusinessName.slice(0, 120) } : {}),
        ...(typeof context.customerName === 'string' ? { customerName: context.customerName.slice(0, 80) } : {}),
        ...(typeof context.reason === 'string' ? { reason: context.reason.slice(0, 500) } : {})
      }
    }
  }
}
