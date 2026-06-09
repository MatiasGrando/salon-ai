import { prisma } from '../src/config/prisma.js'
import { ConversationService } from '../src/services/conversation-service.js'

type Check = {
  includes?: string[]
  includesAny?: string[]
  excludes?: string[]
  currentStep?: string
}

type Step = Check & {
  message: string
}

type Scenario = {
  name: string
  phone: string
  setup?: () => Promise<void>
  fakeNow?: Date
  steps: Step[]
}

const conversationService = new ConversationService()
const testPhonePrefix = 'qa-cami-'
const workingDayMorning = new Date('2026-07-06T08:00:00')
const workingDayLateNight = new Date('2026-07-06T23:00:00')

async function main() {
  const business = await prisma.business.findFirst({
    include: {
      services: {
        orderBy: {
          createdAt: 'asc'
        }
      },
      professionals: {
        orderBy: {
          createdAt: 'asc'
        }
      }
    },
    orderBy: {
      createdAt: 'asc'
    }
  })

  if (!business || business.services.length === 0 || business.professionals.length === 0) {
    throw new Error('Necesito al menos un negocio, un servicio y un profesional cargados para correr las pruebas.')
  }

  const service = business.services[0]
  const professional = business.professionals[0]

  if (!service || !professional) {
    throw new Error('Necesito al menos un servicio y un profesional cargados para correr las pruebas.')
  }

  const secondProfessional = business.professionals[1] ?? professional

  const scenarios: Scenario[] = [
    {
      name: 'saludo inicial pide nombre',
      phone: `${testPhonePrefix}initial-name`,
      steps: [
        {
          message: 'hola',
          includes: ['Cami']
        }
      ]
    },
    {
      name: 'no toma saludo con nombre ajeno como nombre del cliente',
      phone: `${testPhonePrefix}greeting-not-name`,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: 'Hola Manola',
          includes: ['nombre'],
          excludes: ['Manola', service.name]
        }
      ]
    },
    {
      name: 'corrige nombre equivocado de Cami y pide nombre si falta',
      phone: `${testPhonePrefix}wrong-bot-name-no-customer`,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: 'Hola Manu quiero un turno',
          includes: ['Cami', 'nombre'],
          excludes: ['Manu', service.name]
        }
      ]
    },
    {
      name: 'corrige nombre equivocado de Cami y sigue si ya conoce al cliente',
      phone: `${testPhonePrefix}wrong-bot-name-known-customer`,
      setup: async () => {
        await prisma.conversation.create({
          data: {
            phone: `${testPhonePrefix}wrong-bot-name-known-customer`,
            businessId: business.id,
            currentStep: 'START',
            selectedCustomerName: 'Mati QA'
          }
        })
      },
      steps: [
        {
          message: 'Hola Manu quiero un turno',
          includes: ['Cami', service.name],
          excludes: ['Manu', 'nombre']
        }
      ]
    },
    {
      name: 'acepta nombre cuando el usuario lo da explicitamente',
      phone: `${testPhonePrefix}explicit-name`,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: 'Hola soy Manola',
          includes: ['Manola', service.name]
        }
      ]
    },
    {
      name: 'flujo completo con lenguaje natural',
      phone: `${testPhonePrefix}full-flow`,
      fakeNow: workingDayMorning,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: `hola soy Mati, quiero ${service.name}`,
          includes: [service.name]
        },
        {
          message: 'manana',
          includes: [professional.name]
        },
        {
          message: professional.name,
          includes: ['Horarios disponibles']
        },
        {
          message: 'el primero que tengas',
          includes: ['confirm']
        },
        {
          message: 'okey perfecto quedamos asi',
          includes: ['confirmado']
        },
        {
          message: 'dale excelente gracias',
          includes: ['Mati']
        }
      ]
    },
    {
      name: 'entiende lunfardo y servicio corto',
      phone: `${testPhonePrefix}slang-service`,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: 'soy Thiago',
          includes: [service.name]
        },
        {
          message: 'me quiero cortar el pelo',
          includes: ['gustar']
        }
      ]
    },
    {
      name: 'entiende profesional abreviado',
      phone: `${testPhonePrefix}short-professional`,
      fakeNow: workingDayMorning,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: 'soy Mati',
          includes: [service.name]
        },
        {
          message: service.name,
          includes: ['gustar']
        },
        {
          message: 'manana',
          includes: [professional.name]
        },
        {
          message: shortName(professional.name),
          includes: ['Horarios disponibles']
        }
      ]
    },
    {
      name: 'acepta cualquier profesional escrito natural',
      phone: `${testPhonePrefix}any-professional`,
      fakeNow: workingDayMorning,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: 'soy Nico',
          includes: [service.name]
        },
        {
          message: service.name,
          includes: ['gustar']
        },
        {
          message: 'manana',
          includes: [professional.name]
        },
        {
          message: 'cualquiera esta bien',
          includes: ['Horarios disponibles']
        }
      ]
    },
    {
      name: 'acepta cualquier profesional con error de tipeo',
      phone: `${testPhonePrefix}any-professional-typo`,
      fakeNow: workingDayMorning,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: 'soy Nico',
          includes: [service.name]
        },
        {
          message: service.name,
          includes: ['gustar']
        },
        {
          message: 'manana',
          includes: [professional.name]
        },
        {
          message: 'cualkiera esta bien',
          includes: ['Horarios disponibles']
        }
      ]
    },
    {
      name: 'confirma con tono argentino natural',
      phone: `${testPhonePrefix}confirm-local-tone`,
      fakeNow: workingDayMorning,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: `hola soy Juli quiero ${service.name} manana con ${professional.name}`,
          includes: ['Horarios disponibles']
        },
        {
          message: 'el primero que tengas',
          includes: ['confirm']
        },
        {
          message: 'dale de una',
          includes: ['confirmado']
        }
      ]
    },
    {
      name: 'confirma con joya confirmalo',
      phone: `${testPhonePrefix}confirm-joya`,
      fakeNow: workingDayMorning,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: `hola soy Sofi quiero ${service.name} manana con ${professional.name}`,
          includes: ['Horarios disponibles']
        },
        {
          message: 'el primero que tengas',
          includes: ['confirm']
        },
        {
          message: 'joya confirmalo',
          includes: ['confirmado']
        }
      ]
    },
    {
      name: 'mensaje fuera de flujo vuelve a servicios',
      phone: `${testPhonePrefix}off-flow`,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: 'soy Mati',
          includes: [service.name]
        },
        {
          message: 'quiero una cena con vos',
          includes: [service.name],
          excludes: ['turno confirmado']
        }
      ]
    },
    {
      name: 'no inventa profesional cuando el usuario solo dice fecha',
      phone: `${testPhonePrefix}date-without-professional`,
      fakeNow: workingDayMorning,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: 'soy Mati',
          includes: [service.name]
        },
        {
          message: service.name,
          includes: ['gustar']
        },
        {
          message: 'para hoy si es posible',
          includes: [professional.name, 'Cualquier profesional'],
          excludes: ['Horarios disponibles']
        }
      ]
    },
    {
      name: 'entiende typo de manana',
      phone: `${testPhonePrefix}tomorrow-typo`,
      fakeNow: workingDayMorning,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: 'soy Mati',
          includes: [service.name]
        },
        {
          message: service.name,
          includes: ['gustar']
        },
        {
          message: 'maniana',
          includes: [professional.name]
        }
      ]
    },
    {
      name: 'no ofrece horarios de hoy si ya es tarde',
      phone: `${testPhonePrefix}today-late-night`,
      fakeNow: workingDayLateNight,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: `hola soy Noche quiero ${service.name} hoy con ${professional.name}`,
          includesAny: ['No veo horarios disponibles', 'Para hoy no veo horarios disponibles'],
          excludes: ['Horarios disponibles:', '- 09:', '- 10:', '- 11:']
        }
      ]
    },
    {
      name: 'buscar horarios hoy con todos no pide profesional si no hay disponibilidad',
      phone: `${testPhonePrefix}today-all-professionals-late`,
      fakeNow: workingDayLateNight,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: `hola soy Noche quiero ${service.name}`,
          includes: ['gustar']
        },
        {
          message: 'busca horarios para hoy con todos los profesionales',
          includes: ['No veo horarios disponibles'],
          excludes: [professional.name, 'Cualquier profesional', 'Preferis atenderte']
        }
      ]
    },
    {
      name: 'sin disponibilidad hoy permite volver a elegir otro dia',
      phone: `${testPhonePrefix}today-no-availability-another-day`,
      fakeNow: workingDayLateNight,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: `hola soy Noche quiero ${service.name} hoy con ${professional.name}`,
          includesAny: ['Para hoy no veo horarios disponibles', 'No veo horarios disponibles']
        },
        {
          message: '2',
          includes: ['No veo horarios disponibles'],
          excludes: ['Horarios disponibles:']
        },
        {
          message: 'okey probamos otro dia',
          includes: ['gustar']
        }
      ]
    },
    {
      name: 'cancelar turno acepta el numero natural',
      phone: `${testPhonePrefix}cancel`,
      setup: async () => {
        await seedAppointment({
          phone: `${testPhonePrefix}cancel`,
          customerName: 'Mati QA',
          serviceId: service.id,
          professionalId: professional.id
        })
      },
      steps: [
        {
          message: 'quiero cancelar un turno',
          includes: ['cancelarlo', service.name]
        },
        {
          message: 'el 1',
          includes: ['cancel', 'ayudar', 'otro turno']
        }
      ]
    },
    {
      name: 'cancelar turno acepta numero en frase completa',
      phone: `${testPhonePrefix}cancel-number-phrase`,
      setup: async () => {
        await seedAppointment({
          phone: `${testPhonePrefix}cancel-number-phrase`,
          customerName: 'Mati QA',
          serviceId: service.id,
          professionalId: professional.id
        })
      },
      steps: [
        {
          message: 'quiero cancelar un turno',
          includes: ['cancelarlo', service.name]
        },
        {
          message: 'quiero cancelar el numero 1',
          includes: ['cancel', 'ayudar', 'otro turno']
        }
      ]
    },
    {
      name: 'cancelar turno orienta si no entiende la seleccion',
      phone: `${testPhonePrefix}cancel-unclear`,
      setup: async () => {
        await seedAppointment({
          phone: `${testPhonePrefix}cancel-unclear`,
          customerName: 'Mati QA',
          serviceId: service.id,
          professionalId: professional.id
        })
      },
      steps: [
        {
          message: 'quiero cancelar un turno',
          includes: ['cancelarlo', service.name]
        },
        {
          message: 'ese no',
          includes: ['entender', 'lista', 'por ejemplo', service.name]
        }
      ]
    },
    {
      name: 'cancelar turno orienta si el numero no existe',
      phone: `${testPhonePrefix}cancel-invalid-number`,
      setup: async () => {
        await seedAppointment({
          phone: `${testPhonePrefix}cancel-invalid-number`,
          customerName: 'Mati QA',
          serviceId: service.id,
          professionalId: professional.id
        })
      },
      steps: [
        {
          message: 'quiero cancelar un turno',
          includes: ['cancelarlo', service.name]
        },
        {
          message: 'el 9',
          includes: ['lista', 'por ejemplo', service.name]
        }
      ]
    },
    {
      name: 'mis turnos muestra solo turnos futuros',
      phone: `${testPhonePrefix}future-only`,
      setup: async () => {
        await seedAppointment({
          phone: `${testPhonePrefix}future-only`,
          customerName: 'Mati QA',
          serviceId: service.id,
          professionalId: professional.id,
          startAt: dateWithOffset(-2)
        })
        await seedAppointment({
          phone: `${testPhonePrefix}future-only`,
          customerName: 'Mati QA',
          serviceId: service.id,
          professionalId: professional.id,
          startAt: dateWithOffset(30)
        })
      },
      steps: [
        {
          message: 'mis turnos',
          includes: ['1.', service.name],
          excludes: ['2.']
        }
      ]
    },
    {
      name: 'cancelar multiples turnos respeta el numero elegido',
      phone: `${testPhonePrefix}cancel-second`,
      setup: async () => {
        await seedAppointment({
          phone: `${testPhonePrefix}cancel-second`,
          customerName: 'Mati QA',
          serviceId: service.id,
          professionalId: professional.id,
          startAt: dateWithOffset(30, 10)
        })
        await seedAppointment({
          phone: `${testPhonePrefix}cancel-second`,
          customerName: 'Mati QA',
          serviceId: service.id,
          professionalId: professional.id,
          startAt: dateWithOffset(31, 11)
        })
      },
      steps: [
        {
          message: 'quiero cancelar un turno',
          includes: ['1.', '2.', service.name]
        },
        {
          message: 'el 2',
          includes: ['cancel', 'ayudar', 'otro turno']
        },
        {
          message: 'mis turnos',
          includes: ['1.', service.name],
          excludes: ['2.']
        }
      ]
    },
    {
      name: 'entiende typo fuerte para cancelar',
      phone: `${testPhonePrefix}cancel-typo`,
      setup: async () => {
        await seedAppointment({
          phone: `${testPhonePrefix}cancel-typo`,
          customerName: 'Mati QA',
          serviceId: service.id,
          professionalId: professional.id
        })
      },
      steps: [
        {
          message: 'kiero cancelar',
          includes: ['cancelarlo', service.name]
        }
      ]
    },
    {
      name: 'editar turno orienta si no entiende la seleccion',
      phone: `${testPhonePrefix}edit-unclear`,
      setup: async () => {
        await seedAppointment({
          phone: `${testPhonePrefix}edit-unclear`,
          customerName: 'Mati QA',
          serviceId: service.id,
          professionalId: professional.id
        })
      },
      steps: [
        {
          message: 'quiero cambiar un turno',
          includes: ['cambiarlo', service.name]
        },
        {
          message: 'ese no',
          includes: ['entender', 'lista', 'por ejemplo', service.name]
        }
      ]
    },
    {
      name: 'entiende typo fuerte para editar',
      phone: `${testPhonePrefix}edit-typo`,
      setup: async () => {
        await seedAppointment({
          phone: `${testPhonePrefix}edit-typo`,
          customerName: 'Mati QA',
          serviceId: service.id,
          professionalId: professional.id
        })
      },
      steps: [
        {
          message: 'kiero camviar turno',
          includes: ['cambiarlo', service.name]
        }
      ]
    },
    {
      name: 'volver a empezar desde seleccion de cancelacion',
      phone: `${testPhonePrefix}cancel-reset-to-service`,
      setup: async () => {
        await seedAppointment({
          phone: `${testPhonePrefix}cancel-reset-to-service`,
          customerName: 'Mati QA',
          serviceId: service.id,
          professionalId: professional.id
        })
      },
      steps: [
        {
          message: 'quiero cancelar un turno',
          includes: ['cancelarlo', service.name]
        },
        {
          message: 'volver a empezar',
          includes: ['empezamos de nuevo']
        },
        {
          message: 'reservar turno',
          includes: [service.name]
        }
      ]
    },
    {
      name: 'editar turno vuelve a reservar desde servicio',
      phone: `${testPhonePrefix}edit-rebook`,
      setup: async () => {
        await seedAppointment({
          phone: `${testPhonePrefix}edit-rebook`,
          customerName: 'Mati QA',
          serviceId: service.id,
          professionalId: professional.id
        })
      },
      steps: [
        {
          message: 'quiero cambiar un turno',
          includes: ['cambiarlo', service.name]
        },
        {
          message: 'el 1',
          includes: ['cancel', 'reservarlo de nuevo', 'servicio']
        },
        {
          message: 'reservar turno',
          includes: [service.name],
          excludes: ['nombre']
        }
      ]
    },
    {
      name: 'cambiar de profesional antes de confirmar',
      phone: `${testPhonePrefix}change-professional`,
      fakeNow: workingDayMorning,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: `hola soy Mati quiero ${service.name} manana con ${professional.name}`,
          includes: ['Horarios disponibles']
        },
        {
          message: 'el primero que tengas',
          includes: ['confirm']
        },
        {
          message: `mejor puede ser con ${secondProfessional.name}`,
          includes: [secondProfessional.name],
          excludes: ['servicio?']
        }
      ]
    },
    {
      name: 'cambiar a un horario mas tarde antes de confirmar',
      phone: `${testPhonePrefix}change-time-later`,
      fakeNow: workingDayMorning,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: `hola soy Mati quiero ${service.name} manana con ${professional.name}`,
          includes: ['Horarios disponibles']
        },
        {
          message: 'el primero que tengas',
          includes: ['confirm']
        },
        {
          message: 'mejor mas tarde',
          includes: ['Horarios disponibles'],
          excludes: ['servicio?']
        }
      ]
    },
    {
      name: 'cambiar de fecha antes de confirmar',
      phone: `${testPhonePrefix}change-date-before-confirm`,
      fakeNow: workingDayMorning,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: `hola soy Mati quiero ${service.name} manana con ${professional.name}`,
          includes: ['Horarios disponibles']
        },
        {
          message: 'el primero que tengas',
          includes: ['confirm']
        },
        {
          message: 'mejor pasado',
          includesAny: ['Horarios disponibles', 'No veo horarios disponibles'],
          excludes: ['servicio?']
        }
      ]
    },
    {
      name: 'mensaje confuso ofrece recuperacion y derivacion',
      phone: `${testPhonePrefix}fallback-recovery`,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: 'soy Mati',
          includes: [service.name]
        },
        {
          message: service.name,
          includes: ['gustar']
        },
        {
          message: 'no elegÃ­ eso',
          includes: [
            'volver al paso anterior',
            'cambiar servicio',
            'pasarte con una persona'
          ]
        },
        {
          message: 'volver al paso anterior',
          includes: [professional.name, 'Cualquier profesional'],
          currentStep: 'ASK_PROFESSIONAL'
        }
      ]
    },
    {
      name: 'deriva a una persona y queda marcado en CRM',
      phone: `${testPhonePrefix}human-handoff`,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: 'hablar con una persona',
          includes: ['avisé', 'equipo'],
          currentStep: 'HUMAN_HANDOFF'
        },
        {
          message: 'hola?',
          includes: ['avisado', 'equipo'],
          currentStep: 'HUMAN_HANDOFF'
        }
      ]
    },
    {
      name: 'flujo abandonado por 24 horas se reinicia',
      phone: `${testPhonePrefix}expired`,
      setup: async () => {
        await prisma.conversation.create({
          data: {
            phone: `${testPhonePrefix}expired`,
            businessId: business.id,
            currentStep: 'ASK_DATE',
            selectedCustomerName: 'Mati',
            selectedServiceId: service.id,
            lastMessage: 'manana'
          }
        })

        await prisma.conversation.update({
          where: {
            phone: `${testPhonePrefix}expired`
          },
          data: {
            updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000)
          }
        })
      },
      steps: [
        {
          message: 'hola',
          includes: ['Cami'],
          excludes: ['gustar']
        }
      ]
    }
  ]

  let failures = 0

  for (const scenario of scenarios) {
    try {
      await runScenario(scenario)
    } catch (error) {
      failures += 1
      console.error(`\nFALLO: ${scenario.name}`)
      console.error(error instanceof Error ? error.message : error)
    }
  }

  await prisma.$disconnect()

  if (failures > 0) {
    process.exit(1)
  }

  console.log('\nTodas las pruebas de conversación pasaron.')
}

async function runScenario(scenario: Scenario) {
  const restoreDate = scenario.fakeNow ? installFakeNow(scenario.fakeNow) : null

  try {
    await cleanupPhone(scenario.phone)
    await scenario.setup?.()

    console.log(`\nEscenario: ${scenario.name}`)

    for (const step of scenario.steps) {
      const result = await conversationService.handleMessage({
        phone: scenario.phone,
        message: step.message
      })

      console.log(`Usuario: ${step.message}`)
      console.log(`Cami: ${result.reply}`)

      assertReply(result.reply, step)
      await assertConversationStep(scenario.phone, step)
    }
  } finally {
    restoreDate?.()
  }
}

async function assertConversationStep(phone: string, step: Step) {
  if (!step.currentStep) {
    return
  }

  const conversation = await prisma.conversation.findUnique({
    where: {
      phone
    },
    select: {
      currentStep: true
    }
  })

  if (conversation?.currentStep !== step.currentStep) {
    throw new Error(`Esperaba currentStep ${step.currentStep}, recibÃ­ ${conversation?.currentStep ?? 'sin conversaciÃ³n'}.`)
  }
}

async function seedAppointment(input: {
  phone: string
  customerName: string
  serviceId: string
  professionalId: string
  startAt?: Date
}) {
  const customer = await prisma.customer.create({
    data: {
      phone: input.phone,
      name: input.customerName
    }
  })

  await prisma.appointment.create({
    data: {
      customerId: customer.id,
      serviceId: input.serviceId,
      professionalId: input.professionalId,
      startAt: input.startAt ?? nextFutureAppointmentDate()
    }
  })
}

async function cleanupPhone(phone: string) {
  const customers = await prisma.customer.findMany({
    where: {
      phone
    },
    select: {
      id: true
    }
  })

  if (customers.length > 0) {
    await prisma.appointment.updateMany({
      where: {
        customerId: {
          in: customers.map((customer) => customer.id)
        },
        status: {
          not: 'CANCELLED'
        }
      },
      data: {
        status: 'CANCELLED'
      }
    })
  }

  await prisma.message.deleteMany({
    where: {
      phone
    }
  })

  await prisma.conversation.deleteMany({
    where: {
      phone
    }
  })
}

function assertReply(reply: string, check: Check) {
  const normalizedReply = normalizeForCheck(reply)

  for (const expected of check.includes ?? []) {
    if (!normalizedReply.includes(normalizeForCheck(expected))) {
      throw new Error(`Esperaba que la respuesta incluya "${expected}".\nRespuesta:\n${reply}`)
    }
  }

  if (check.includesAny && !check.includesAny.some((expected) => normalizedReply.includes(normalizeForCheck(expected)))) {
    throw new Error(`Esperaba que la respuesta incluya alguna de estas opciones: ${check.includesAny.map((expected) => `"${expected}"`).join(', ')}.\nRespuesta:\n${reply}`)
  }

  for (const forbidden of check.excludes ?? []) {
    if (normalizedReply.includes(normalizeForCheck(forbidden))) {
      throw new Error(`No esperaba que la respuesta incluya "${forbidden}".\nRespuesta:\n${reply}`)
    }
  }
}

function normalizeForCheck(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function installFakeNow(fakeNow: Date) {
  const RealDate = Date
  const FakeDate = function (...args: unknown[]) {
    return args.length === 0
      ? new RealDate(fakeNow.getTime())
      : Reflect.construct(RealDate, args)
  } as unknown as DateConstructor

  Object.setPrototypeOf(FakeDate, RealDate)
  Object.defineProperty(FakeDate, 'prototype', {
    value: RealDate.prototype
  })
  FakeDate.now = () => fakeNow.getTime()
  FakeDate.parse = RealDate.parse
  FakeDate.UTC = RealDate.UTC

  globalThis.Date = FakeDate

  return () => {
    globalThis.Date = RealDate
  }
}

function nextFutureAppointmentDate() {
  return dateWithOffset(30)
}

function dateWithOffset(days: number, hour = 10) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(hour, 0, 0, 0)

  return date
}

function shortName(name: string) {
  return name.trim().slice(0, Math.max(3, Math.min(5, name.trim().length)))
}

main().catch(async (error) => {
  console.error(error)
  await prisma.$disconnect()
  process.exit(1)
})
