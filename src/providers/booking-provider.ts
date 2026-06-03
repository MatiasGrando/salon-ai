export type BookingAvailabilityInput = {
  professionalId: string
  serviceId: string
  date: string
}

export type BookingAvailabilityResult =
  | {
      ok: true
      slots: string[]
    }
  | {
      ok: false
      statusCode: number
      message: string
    }

export type BookingCreateAppointmentInput = {
  customerId: string
  professionalId: string
  serviceId: string
  startAt: string
}

export type BookingCreateAppointmentResult =
  | {
      ok: true
      appointment: unknown
    }
  | {
      ok: false
      statusCode: number
      message: string
    }

export interface BookingProvider {
  getAvailability(input: BookingAvailabilityInput): Promise<BookingAvailabilityResult>
  createAppointment(input: BookingCreateAppointmentInput): Promise<BookingCreateAppointmentResult>
  cancelAppointment(appointmentId: string): Promise<void>
}
