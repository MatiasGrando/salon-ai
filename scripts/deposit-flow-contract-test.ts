import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BookingDepositService,
  DEPOSIT_PROOF_RECEIVED_ACKNOWLEDGEMENT
} from '../src/services/booking-deposit-service.js'
import {
  calculateBookingV2Deposit,
  renderBookingV2DepositRequest,
  renderBookingV2PaymentInstructions,
  serviceCanContinueToBooking
} from '../src/services/booking-v2-deposit.js'

type DepositRecord = {
  id: string
  appointmentId: string
  conversationId: string
  status: 'PENDING_PROOF' | 'PROOF_RECEIVED' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
  expiresAt: Date
  proofMessageId: string | null
  reviewedAt?: Date | null
  rejectionReason?: string | null
  bookingV2State?: unknown
}

type AppointmentRecord = {
  id: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED'
}

const tests: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'monto fijo conserva el valor configurado',
    run: () => {
      assert.equal(calculateBookingV2Deposit({
        mode: 'FIXED',
        value: 25000,
        servicePrice: 100000,
        estimateMinimum: null
      })?.amount, 25000)
    }
  },
  {
    name: 'porcentaje usa el minimo del estimativo',
    run: () => {
      const result = calculateBookingV2Deposit({
        mode: 'PERCENTAGE',
        value: 30,
        servicePrice: 80000,
        estimateMinimum: 100000
      })
      assert.equal(result?.baseAmount, 100000)
      assert.equal(result?.amount, 30000)
    }
  },
  {
    name: 'presupuesto personalizado puede continuar a profesional horario y seña',
    run: () => {
      assert.equal(serviceCanContinueToBooking({
        attentionMode: 'QUOTE',
        requiresPhoto: true,
        estimateAllowsBooking: false
      }), true)
      assert.equal(calculateBookingV2Deposit({
        mode: 'PERCENTAGE',
        value: 30,
        servicePrice: null,
        estimateMinimum: 160000
      })?.amount, 48000)
    }
  },
  {
    name: 'asesoramiento sin continuidad no habilita seña',
    run: () => {
      assert.equal(serviceCanContinueToBooking({
        attentionMode: 'ADVISOR',
        requiresPhoto: false,
        estimateAllowsBooking: false
      }), false)
    }
  },
  {
    name: 'solicitud incluye medios de pago y vencimiento',
    run: () => {
      const calculation = calculateBookingV2Deposit({
        mode: 'PERCENTAGE',
        value: 30,
        servicePrice: null,
        estimateMinimum: 100000
      })
      assert.ok(calculation)
      const reply = renderBookingV2DepositRequest({
        serviceName: 'Iluminación',
        calculation,
        paymentSettings: {
          transferEnabled: true,
          alias: 'barber.colapinta',
          cbu: '1234567890123456789012',
          cvu: null,
          accountHolder: 'Barber Colapinta',
          paymentLinkEnabled: true,
          paymentLink: 'https://example.com/pagar',
          instructions: 'Incluí tu nombre.'
        },
        expiresAt: new Date('2026-07-28T21:00:00.000Z')
      })
      assert.match(reply, /Alias: barber\.colapinta/)
      assert.match(reply, /CBU: 1234567890123456789012/)
      assert.match(reply, /https:\/\/example\.com\/pagar/)
      assert.match(reply, /horario queda reservado/)
      assert.match(reply, /comprobante/)
    }
  },
  {
    name: 'comparte datos de transferencia ya cargados aunque el indicador historico este apagado',
    run: () => {
      const instructions = renderBookingV2PaymentInstructions({
        transferEnabled: false,
        alias: 'barber.colapinta',
        cbu: null,
        cvu: null,
        accountHolder: 'Barber Colapinta',
        paymentLinkEnabled: false,
        paymentLink: null,
        instructions: null
      })
      assert.match(instructions, /Alias: barber\.colapinta/)
      assert.match(instructions, /Titular: Barber Colapinta/)
    }
  },
  {
    name: 'una imagen marca el comprobante como recibido',
    run: async () => {
      const now = new Date('2026-07-28T20:00:00.000Z')
      const fixture = fakeDepositDb({
        deposits: [{
          id: 'deposit-1',
          appointmentId: 'appointment-1',
          conversationId: 'conversation-1',
          status: 'PENDING_PROOF',
          expiresAt: new Date('2026-07-28T21:00:00.000Z'),
          proofMessageId: null
        }],
        appointments: [{ id: 'appointment-1', status: 'PENDING' }]
      })
      const service = new BookingDepositService(fixture.db as never)
      const result = await service.markProofReceived({
        conversationId: 'conversation-1',
        messageId: 'message-image-1',
        receivedAt: now
      })
      assert.equal(result?.status, 'PROOF_RECEIVED')
      assert.equal(fixture.deposits[0]?.proofMessageId, 'message-image-1')
      assert.equal(fixture.appointments[0]?.status, 'PENDING')
    }
  },
  {
    name: 'el acuse informa que el horario sigue reservado hasta la revision',
    run: () => {
      assert.equal(
        DEPOSIT_PROOF_RECEIVED_ACKNOWLEDGEMENT,
        'Recibimos tu comprobante. El horario continúa reservado mientras el equipo verifica el pago. Te avisamos por acá cuando quede confirmado.'
      )
      const webhook = readFileSync(new URL('../src/services/whatsapp-webhook-service.ts', import.meta.url), 'utf8')
      assert.ok(webhook.includes('if (depositProof)'))
      assert.ok(webhook.includes("automation: 'deposit_proof_received'"))
    }
  },
  {
    name: 'un comprobante recibido detiene el vencimiento y mantiene el horario',
    run: async () => {
      const fixture = fakeDepositDb({
        deposits: [{
          id: 'deposit-1',
          appointmentId: 'appointment-1',
          conversationId: 'conversation-1',
          status: 'PROOF_RECEIVED',
          expiresAt: new Date('2026-07-28T19:00:00.000Z'),
          proofMessageId: 'message-image-1'
        }],
        appointments: [{ id: 'appointment-1', status: 'PENDING' }]
      })
      const service = new BookingDepositService(fixture.db as never)
      const result = await service.expireOverdue(new Date('2026-07-28T20:00:00.000Z'))
      assert.equal(result.expired, 0)
      assert.equal(fixture.deposits[0]?.status, 'PROOF_RECEIVED')
      assert.equal(fixture.appointments[0]?.status, 'PENDING')

      const crmRoute = readFileSync(new URL('../src/routes/crm.ts', import.meta.url), 'utf8')
      const approveStart = crmRoute.indexOf("app.post('/crm/conversations/:id/deposit/approve'")
      const rejectStart = crmRoute.indexOf("app.post('/crm/conversations/:id/deposit/reject'", approveStart)
      const approveRoute = crmRoute.slice(approveStart, rejectStart)
      assert.equal(approveRoute.includes('expiresAt: { gt: reviewedAt }'), false)
      assert.ok(approveRoute.includes('pendingDepositAppointmentIds'))
      assert.ok(approveRoute.includes('id: { in: heldAppointmentIds }'))
      const rejectRoute = crmRoute.slice(rejectStart)
      assert.ok(rejectRoute.includes('pendingDepositAppointmentIds'))
      assert.ok(rejectRoute.includes('id: { in: heldAppointmentIds }'))
    }
  },
  {
    name: 'una retencion vencida libera el horario',
    run: async () => {
      const fixture = fakeDepositDb({
        deposits: [{
          id: 'deposit-1',
          appointmentId: 'appointment-1',
          conversationId: 'conversation-1',
          status: 'PENDING_PROOF',
          expiresAt: new Date('2026-07-28T19:00:00.000Z'),
          proofMessageId: null
        }],
        appointments: [{ id: 'appointment-1', status: 'PENDING' }]
      })
      const service = new BookingDepositService(fixture.db as never)
      const result = await service.expireOverdue(new Date('2026-07-28T20:00:00.000Z'))
      assert.equal(result.expired, 1)
      assert.equal(fixture.deposits[0]?.status, 'EXPIRED')
      assert.equal(fixture.appointments[0]?.status, 'CANCELLED')
    }
  },
  {
    name: 'una retencion coordinada vencida libera las dos reservas',
    run: async () => {
      const fixture = fakeDepositDb({
        deposits: [{
          id: 'deposit-1',
          appointmentId: 'appointment-1',
          conversationId: 'conversation-1',
          status: 'PENDING_PROOF',
          expiresAt: new Date('2026-07-28T19:00:00.000Z'),
          proofMessageId: null,
          bookingV2State: {
            pendingDeposit: {
              appointmentId: 'appointment-1',
              relatedAppointmentIds: ['appointment-1', 'appointment-2']
            }
          }
        }],
        appointments: [
          { id: 'appointment-1', status: 'PENDING' },
          { id: 'appointment-2', status: 'PENDING' }
        ]
      })
      const service = new BookingDepositService(fixture.db as never)
      const result = await service.expireOverdue(new Date('2026-07-28T20:00:00.000Z'))
      assert.equal(result.expired, 1)
      assert.deepEqual(fixture.appointments.map((appointment) => appointment.status), [
        'CANCELLED',
        'CANCELLED'
      ])
    }
  },
  {
    name: 'un comprobante enviado despues del vencimiento no recupera el horario',
    run: async () => {
      const fixture = fakeDepositDb({
        deposits: [{
          id: 'deposit-1',
          appointmentId: 'appointment-1',
          conversationId: 'conversation-1',
          status: 'PENDING_PROOF',
          expiresAt: new Date('2026-07-28T19:00:00.000Z'),
          proofMessageId: null
        }],
        appointments: [{ id: 'appointment-1', status: 'PENDING' }]
      })
      const service = new BookingDepositService(fixture.db as never)
      const result = await service.markProofReceived({
        conversationId: 'conversation-1',
        messageId: 'message-image-late',
        receivedAt: new Date('2026-07-28T20:00:00.000Z')
      })
      assert.equal(result, null)
      assert.equal(fixture.deposits[0]?.status, 'EXPIRED')
      assert.equal(fixture.appointments[0]?.status, 'CANCELLED')
    }
  },
  {
    name: 'un fallo al enviar la solicitud de seña libera la retención',
    run: async () => {
      const fixture = fakeDepositDb({
        deposits: [{
          id: 'deposit-1',
          appointmentId: 'appointment-1',
          conversationId: 'conversation-1',
          status: 'PENDING_PROOF',
          expiresAt: new Date('2026-07-28T21:00:00.000Z'),
          proofMessageId: null
        }],
        appointments: [{ id: 'appointment-1', status: 'PENDING' }]
      })
      const service = new BookingDepositService(fixture.db as never)
      const cancelled = await service.cancelPendingProof({
        depositId: 'deposit-1',
        reason: 'No se pudo enviar la solicitud de seña.',
        cancelledAt: new Date('2026-07-28T20:00:00.000Z')
      })

      assert.equal(cancelled, true)
      assert.equal(fixture.deposits[0]?.status, 'REJECTED')
      assert.equal(fixture.deposits[0]?.rejectionReason, 'No se pudo enviar la solicitud de seña.')
      assert.equal(fixture.appointments[0]?.status, 'CANCELLED')
    }
  },
  {
    name: 'reset total libera señas pendientes aunque el estado de conversación se haya perdido',
    run: async () => {
      const fixture = fakeDepositDb({
        deposits: [{
          id: 'deposit-1',
          appointmentId: 'appointment-1',
          conversationId: 'conversation-1',
          status: 'PENDING_PROOF',
          expiresAt: new Date('2026-07-28T21:00:00.000Z'),
          proofMessageId: null
        }],
        appointments: [{ id: 'appointment-1', status: 'PENDING' }]
      })
      const service = new BookingDepositService(fixture.db as never)
      const cancelled = await service.cancelPendingProofsForConversation({
        conversationId: 'conversation-1',
        reason: 'La reserva se reinició antes de recibir el comprobante.',
        cancelledAt: new Date('2026-07-28T20:00:00.000Z')
      })

      assert.equal(cancelled, 1)
      assert.equal(fixture.deposits[0]?.status, 'REJECTED')
      assert.equal(fixture.appointments[0]?.status, 'CANCELLED')
    }
  },
  {
    name: 'webhook registra el fallo de envío y reset total cancela la seña pendiente',
    run: () => {
      const webhook = readFileSync(new URL('../src/services/whatsapp-webhook-service.ts', import.meta.url), 'utf8')
      const conversation = readFileSync(new URL('../src/services/conversation-service.ts', import.meta.url), 'utf8')

      assert.ok(webhook.includes('catch (error)'))
      assert.ok(webhook.includes('handleDepositRequestDeliveryFailure'))
      assert.ok(conversation.includes('depositRequestId: deposit.id'))
      assert.ok(conversation.includes("La reserva se reinició antes de recibir el comprobante."))
      assert.ok(conversation.includes('No se pudo guardar el estado de espera del comprobante.'))
      assert.match(readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'), /AWAITING_DEPOSIT/)
    }
  }
]

async function main() {
  for (const test of tests) {
    await test.run()
    console.log(`OK: ${test.name}`)
  }
  console.log(`\n${tests.length} pruebas del flujo de señas pasaron.`)
}

function fakeDepositDb(input: {
  deposits: DepositRecord[]
  appointments: AppointmentRecord[]
}) {
  const deposits = input.deposits
  const appointments = input.appointments
  const db = {
    bookingDeposit: {
      async findMany(args: any) {
        const now = args.where.expiresAt?.lte as Date | undefined
        return deposits
          .filter((deposit) =>
            (typeof args.where.status === 'string'
              ? deposit.status === args.where.status
              : args.where.status.in.includes(deposit.status)) &&
            (!args.where.conversationId || deposit.conversationId === args.where.conversationId) &&
            (!now || deposit.expiresAt <= now)
          )
          .map((deposit) => args.select?.id && !args.select.appointmentId
            ? { id: deposit.id }
            : {
                id: deposit.id,
                appointmentId: deposit.appointmentId,
                conversation: { bookingV2State: deposit.bookingV2State ?? null }
              })
      },
      async updateMany(args: any) {
        let count = 0
        for (const deposit of deposits) {
          const idMatches = typeof args.where.id === 'string'
            ? deposit.id === args.where.id
            : args.where.id.in.includes(deposit.id)
          const statusMatches = typeof args.where.status === 'string'
            ? deposit.status === args.where.status
            : args.where.status.in.includes(deposit.status)
          const expiryMatches = !args.where.expiresAt ||
            (!args.where.expiresAt.lte || deposit.expiresAt <= args.where.expiresAt.lte) &&
            (!args.where.expiresAt.gt || deposit.expiresAt > args.where.expiresAt.gt)
          if (
            idMatches &&
            statusMatches &&
            expiryMatches
          ) {
            Object.assign(deposit, args.data)
            count += 1
          }
        }
        return { count }
      },
      async findFirst(args: any) {
        return deposits
          .filter((deposit) =>
            deposit.conversationId === args.where.conversationId &&
            deposit.status === args.where.status &&
            deposit.expiresAt > args.where.expiresAt.gt
          )
          .sort((left, right) => right.expiresAt.getTime() - left.expiresAt.getTime())[0] ?? null
      },
      async update(args: any) {
        const deposit = deposits.find((item) => item.id === args.where.id)
        if (!deposit) throw new Error('deposit not found')
        Object.assign(deposit, args.data)
        return deposit
      },
      async findUnique(args: any) {
        const deposit = deposits.find((item) => item.id === args.where.id)
        if (!deposit) return null
        return args.select?.conversation
          ? {
              appointmentId: deposit.appointmentId,
              conversation: { bookingV2State: deposit.bookingV2State ?? null }
            }
          : deposit
      }
    },
    appointment: {
      async updateMany(args: any) {
        let count = 0
        for (const appointment of appointments) {
          if (
            (typeof args.where.id === 'string'
              ? appointment.id === args.where.id
              : args.where.id.in.includes(appointment.id)) &&
            appointment.status === args.where.status
          ) {
            Object.assign(appointment, args.data)
            count += 1
          }
        }
        return { count }
      }
    },
    async $transaction(operation: any) {
      return typeof operation === 'function'
        ? operation(db)
        : Promise.all(operation)
    }
  }
  return { db, deposits, appointments }
}

void main()
