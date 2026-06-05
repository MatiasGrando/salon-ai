import { prisma } from '../src/config/prisma.js'
import { ConversationService } from '../src/services/conversation-service.js'

type Check = {
  includes?: string[]
  excludes?: string[]
}

type Step = Check & {
  message: string
}

type Scenario = {
  name: string
  phone: string
  setup?: () => Promise<void>
  steps: Step[]
}

const conversationService = new ConversationService()
const testPhonePrefix = 'qa-cami-'

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
      name: 'flujo completo con lenguaje natural',
      phone: `${testPhonePrefix}full-flow`,
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
          message: 'mañana',
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
          includes: ['Para qué día']
        }
      ]
    },
    {
      name: 'entiende profesional abreviado',
      phone: `${testPhonePrefix}short-professional`,
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
          includes: ['Para qué día']
        },
        {
          message: 'mañana',
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
          includes: ['Para qué día']
        },
        {
          message: 'mañana',
          includes: [professional.name]
        },
        {
          message: 'cualquiera esta bien',
          includes: ['Horarios disponibles']
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
          includes: ['Para qué día']
        },
        {
          message: 'para hoy si es posible',
          includes: [professional.name, 'Cualquier profesional'],
          excludes: ['Horarios disponibles']
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
      name: 'cambiar de profesional antes de confirmar',
      phone: `${testPhonePrefix}change-professional`,
      steps: [
        {
          message: 'reset total',
          includes: ['Cami']
        },
        {
          message: `hola soy Mati quiero ${service.name} mañana con ${professional.name}`,
          includes: ['Horarios disponibles']
        },
        {
          message: 'el primero que tengas',
          includes: ['confirm']
        },
        {
          message: `mejor puede ser con ${secondProfessional.name}`,
          includes: [secondProfessional.name],
          excludes: ['Qué servicio']
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
            lastMessage: 'mañana'
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
          excludes: ['Para qué día']
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
  }
}

async function seedAppointment(input: {
  phone: string
  customerName: string
  serviceId: string
  professionalId: string
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
      startAt: nextFutureAppointmentDate()
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

function nextFutureAppointmentDate() {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  date.setHours(10, 0, 0, 0)

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
