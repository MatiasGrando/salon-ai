import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo } from "../db/leads";
import { calcomConfigured, calcomTimeZone, resolveEventTypeId, getAvailableSlots, createBooking } from "../integrations/calcom";

// Tools de los nichos de SERVICIOS POR CITA (barbería, salón, dentista, gimnasio,
// coach). Método base: agendarCita registra la cita como lead para que el dueño la
// confirme. Método adicional (opt-in): si el dueño conectó Cal.com (CALCOM_*), el
// bot consulta disponibilidad real con verDisponibilidad y agendarCita reserva en el
// calendario. Ambos casos SIEMPRE dejan el registro local para el dashboard.

export function verDisponibilidadTool(env: Env, _getConversationId: () => string | null) {
  return tool({
    description:
      "Consulta los HORARIOS LIBRES reales en la agenda (Cal.com) para un servicio y un día. Úsala ANTES de agendar cuando el cliente ya eligió qué servicio quiere y para qué día, para ofrecerle horas que de verdad están disponibles. Devuelve una lista de horas con su startTime exacto — pásale ese startTime a agendarCita.",
    inputSchema: z.object({
      fecha: z.string().describe("Día a consultar en formato YYYY-MM-DD (ej. '2026-07-20')"),
      servicio: z.string().optional().describe("Servicio que quiere el cliente (para elegir el tipo de cita correcto)"),
    }),
    execute: async ({ fecha, servicio }) => {
      if (!calcomConfigured(env)) return { error: "calcom_not_configured" as const };
      const eventTypeId = resolveEventTypeId(env, servicio);
      if (!eventTypeId) return { error: "no_event_type" as const };
      const tz = calcomTimeZone(env);
      const res = await getAvailableSlots(env, eventTypeId, fecha, tz);
      if (!res.ok) return { error: "calcom_failed" as const, reason: res.reason };
      // Cal.com devuelve el start con la hora local de la zona pedida; extraemos HH:MM.
      const slots = res.slots.slice(0, 12).map((start) => ({ hora: start.slice(11, 16), startTime: start }));
      if (!slots.length) return { fecha, slots: [], message: "No hay horarios libres ese día. Ofrece otra fecha." };
      return { fecha, timeZone: tz, slots };
    },
  });
}

export function agendarCitaTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Registra una CITA cuando el cliente ya dio el servicio que quiere, el día, la hora y su nombre. Sirve para barbería, salón, dentista, gimnasio (clase de prueba) y coach (llamada de descubrimiento). Si tienes la tool verDisponibilidad (agenda Cal.com conectada), primero úsala para obtener horarios reales y pásame el `startTime` exacto del slot elegido y el `email` del cliente: así la reservo en el calendario. Si no hay agenda conectada, solo registro la cita para que el negocio la confirme.",
    inputSchema: z.object({
      nombre: z.string().describe("Nombre de quien agenda"),
      servicio: z
        .string()
        .describe(
          "Servicio o motivo de la cita, tal como lo pidió (ej. 'corte + barba', 'limpieza dental', 'clase de prueba', 'llamada de descubrimiento')",
        ),
      fecha: z.string().describe("Día de la cita, tal como lo dijo el cliente (ej. 'sábado', '2026-07-20')"),
      hora: z.string().describe("Hora de la cita (ej. '5pm', '17:00')"),
      startTime: z
        .string()
        .optional()
        .describe("ISO exacto del slot elegido, tomado de verDisponibilidad. Solo si hay agenda Cal.com conectada."),
      email: z.string().optional().describe("Email del cliente. Necesario para reservar en Cal.com."),
      profesional: z
        .string()
        .optional()
        .describe("Con quién quiere la cita, si pidió a alguien en particular (barbero, estilista, doctor, coach)"),
      contacto: z.string().optional().describe("Teléfono del cliente si lo dio"),
      notas: z.string().optional().describe("Detalles extra (primera vez, urgencia, meta que busca, etc.)"),
    }),
    execute: async ({ nombre, servicio, fecha, hora, startTime, email, profesional, contacto, notas }) => {
      const metadata: Record<string, string | number | null> = { servicio, fecha, hora };
      if (profesional) metadata.profesional = profesional;

      // Método adicional: reservar en Cal.com si está conectado y tenemos slot + email.
      let calMessage = "El negocio la confirma.";
      let booked = false;
      if (calcomConfigured(env)) {
        if (startTime && email) {
          const eventTypeId = resolveEventTypeId(env, servicio);
          if (eventTypeId) {
            const b = await createBooking(env, {
              eventTypeId,
              start: startTime,
              name: nombre,
              email,
              timeZone: calcomTimeZone(env),
              phone: contacto,
              notes: notas,
            });
            if (b.ok) {
              booked = true;
              metadata.calBooking = String(b.bookingId);
              metadata.estado = "Reservada (Cal.com)";
              calMessage = "Quedó reservada en la agenda.";
            } else {
              // El slot pudo ocuparse; guardamos el lead pero pedimos reintentar.
              metadata.estado = "Por confirmar (falló Cal.com)";
              const leads = new LeadsRepo(new Db(env.DB));
              const id = await leads.create({
                conversationId: getConversationId(),
                channelUserId: null,
                name: nombre,
                contact: contacto,
                intent: `Cita · ${servicio} · ${fecha} ${hora}`.slice(0, 300),
                notes: [profesional ? `Con: ${profesional}` : "", notas ?? "", `Cal.com: ${b.reason}`].filter(Boolean).join(" · ") || undefined,
                metadata,
              });
              return {
                citaId: id,
                booked: false,
                retry: true,
                message: "No pude reservar ese horario (quizás se acaba de ocupar). Ofrece otro horario con verDisponibilidad.",
              };
            }
          }
        }
      }

      const leads = new LeadsRepo(new Db(env.DB));
      const id = await leads.create({
        conversationId: getConversationId(),
        channelUserId: null,
        name: nombre,
        contact: contacto,
        intent: `Cita · ${servicio} · ${fecha} ${hora}`.slice(0, 300),
        notes: [profesional ? `Con: ${profesional}` : "", notas ?? ""].filter(Boolean).join(" · ") || undefined,
        metadata,
      });
      return { citaId: id, booked, message: `Cita registrada. ${calMessage}` };
    },
  });
}
