import { prisma } from '../config/prisma.js'
import { AppointmentService } from '../services/appointment-service.js'
import type {
  BookingAvailabilityInput,
  BookingCreateAppointmentInput,
  BookingProvider
} from './booking-provider.js'

const appointmentService = new AppointmentService()

export class InternalBookingProvider implements BookingProvider {
  getAvailability(input: BookingAvailabilityInput) {
    return appointmentService.findAvailability(input)
  }

  createAppointment(input: BookingCreateAppointmentInput) {
    return appointmentService.create(input)
  }

  async cancelAppointment(appointmentId: string) {
    await prisma.appointment.update({
      where: {
        id: appointmentId
      },
      data: {
        status: 'CANCELLED'
      }
    })
  }
}
