import { AppointmentService } from '../services/appointment-service.js'
import type {
  BookingAvailabilityInput,
  BookingAvailabilityResult,
  BookingCreateAppointmentInput,
  BookingProvider
} from './booking-provider.js'

const appointmentService = new AppointmentService()

export class InternalBookingProvider implements BookingProvider {
  private pendingAvailability: Array<{
    input: BookingAvailabilityInput
    resolve: (result: BookingAvailabilityResult) => void
  }> = []
  private availabilityFlushScheduled = false

  getAvailability(input: BookingAvailabilityInput) {
    return new Promise<BookingAvailabilityResult>((resolve) => {
      this.pendingAvailability.push({ input, resolve })
      if (this.availabilityFlushScheduled) return
      this.availabilityFlushScheduled = true
      queueMicrotask(() => void this.flushAvailability())
    })
  }

  createAppointment(input: BookingCreateAppointmentInput) {
    return appointmentService.create({ ...input, origin: 'BOT' })
  }

  async cancelAppointment(appointmentId: string) {
    await appointmentService.cancel(appointmentId)
  }

  private async flushAvailability() {
    const pending = this.pendingAvailability.splice(0)
    this.availabilityFlushScheduled = false
    try {
      const results = await appointmentService.findAvailabilityMany(pending.map((item) => item.input))
      pending.forEach((item, index) => item.resolve(results[index] ?? {
        ok: false,
        statusCode: 500,
        message: 'No pudimos consultar la agenda en este momento'
      }))
    } catch (error) {
      console.error('No pude consultar la disponibilidad agrupada', error)
      pending.forEach((item) => item.resolve({
        ok: false,
        statusCode: 500,
        message: 'No pudimos consultar la agenda en este momento'
      }))
    }
  }
}
