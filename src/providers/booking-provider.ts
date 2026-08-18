import type { BookingAvailabilityUnavailableReason } from '../services/booking-availability-reason.js'

export type BookingAvailabilityInput = {
  professionalId: string
  serviceId: string
  serviceIds?: string[]
  date: string
}

export type BookingAvailabilityResult =
  | {
      ok: true
      slots: string[]
      unavailableReason?: string | null
      unavailable?: BookingAvailabilityUnavailableReason | null
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
  serviceIds?: string[]
  startAt: string
  quotedPrice?: number | null
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
