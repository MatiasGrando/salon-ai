import type { Env } from "../env";
import { isPro } from "../config";
import { getNiche } from "../niches";
import { searchKbTool, type SearchKbResult } from "./searchKb";
import { handoffHumanTool } from "./handoffHuman";
import { pauseBotTool } from "./pauseBot";
import { snoozeUserTool } from "./snoozeUser";
import { pauseSuspectedBotTool } from "./pauseSuspectedBot";
import { captureLeadTool } from "./captureLead";
import { scheduleAppointmentTool } from "./scheduleAppointment";
import { catalogQueryTool } from "./catalogQuery";
import { crearReservacionTool, tomarPedidoTool } from "./restaurante";
import { calificarCompradorTool, registrarVisitaTool } from "./inmobiliaria";
import { agendarCitaTool, verDisponibilidadTool } from "./servicios";
import { registrarPedidoTool } from "./comercio";
import { registrarProspectoTool } from "./crm";
import { reservarHospedajeTool, cotizarEventoTool } from "./hoteleria";
import { calcomConfigured } from "../integrations/calcom";
import {
  hasMasterclassMode,
  eventInfoTool,
  trackedLinkTool,
  registerMasterclassTool,
} from "./masterclass";
import { forjaLicenseStatusTool } from "./forjaSupport";
import { submitAuditCaseTool } from "./auditCase";
import { sendPaymentLinkTool } from "./cobros";
import { stripeConfigured } from "../integrations/stripe";
import { composioTool } from "./composio";
import { composioEnabled } from "../integrations/composio";

export interface ToolContext {
  env: Env;
  getConversationId: () => string | null;
  /** Blindaje anti-invento: el agente captura los pasajes de KB del turno. */
  onSearchKb?: (results: SearchKbResult[]) => void;
}

export function buildTools(ctx: ToolContext) {
  // Free tier base set. captureLead va aquí a propósito: el bot Starter (free)
  // captura prospectos — es el valor central de un bot de ventas. Lo Pro son las
  // tools más avanzadas por nicho (agendar citas, consultar catálogo/inventario).
  const tools: Record<string, any> = {
    searchKb: searchKbTool(ctx.env, ctx.onSearchKb),
    handoffHuman: handoffHumanTool(ctx.env, ctx.getConversationId),
    pauseBot: pauseBotTool(ctx.env, ctx.getConversationId),
    snoozeUser: snoozeUserTool(ctx.env, ctx.getConversationId),
    pauseSuspectedBot: pauseSuspectedBotTool(ctx.env, ctx.getConversationId),
    captureLead: captureLeadTool(ctx.env, ctx.getConversationId),
  };

  // Soporte Forja (solo la instancia de Horizontes: requiere URL + token).
  if (ctx.env.FORJA_SUPPORT_URL && ctx.env.FORJA_SUPPORT_TOKEN) {
    tools.forjaLicenseStatus = forjaLicenseStatusTool(ctx.env);
  }

  // Modo auditoría (dinámica masterclass, instancia Horizontes).
  if (ctx.env.AUDIT_MODE === "on") {
    tools.submitAuditCase = submitAuditCaseTool(ctx.env, ctx.getConversationId);
  }

  // Pro tier additions
  if (isPro(ctx.env)) {
    tools.scheduleAppointment = scheduleAppointmentTool(ctx.env, ctx.getConversationId);
    tools.catalogQuery = catalogQueryTool(ctx.env);
    // Cobros por WhatsApp: solo si el miembro conectó su llave de Stripe.
    if (stripeConfigured(ctx.env)) {
      tools.sendPaymentLink = sendPaymentLinkTool(ctx.env, ctx.getConversationId);
    }
    // Composio (integraciones genéricas): solo si el miembro conectó su
    // llave de Composio. El catálogo de tools disponibles (qué apps puede
    // usar) se anuncia en el system prompt — ver agent.ts.
    if (composioEnabled(ctx.env)) {
      tools.composio = composioTool(ctx.env);
    }
  }

  // Tools específicas del nicho (BOT_NICHE). Se cargan por giro, no por tier:
  // un restaurante toma reservaciones y pedidos; una inmobiliaria califica
  // compradores; los giros de cita comparten agendarCita; los de comercio,
  // registrarPedido. (Método único por ahora: agendarCita registra la cita sin
  // depender de una agenda externa; Cal.com se documenta como método adicional.)
  switch (getNiche(ctx.env).id) {
    case "restaurante":
      tools.crearReservacion = crearReservacionTool(ctx.env, ctx.getConversationId);
      tools.tomarPedido = tomarPedidoTool(ctx.env, ctx.getConversationId);
      break;
    case "inmobiliaria":
      tools.calificarComprador = calificarCompradorTool(ctx.env, ctx.getConversationId);
      tools.registrarVisita = registrarVisitaTool(ctx.env, ctx.getConversationId);
      break;
    case "barberia":
    case "salon":
    case "dentista":
    case "clinica":
    case "spa":
    case "gimnasio":
    case "coach":
      tools.agendarCita = agendarCitaTool(ctx.env, ctx.getConversationId);
      // Método adicional: si el dueño conectó Cal.com, el bot consulta
      // disponibilidad real antes de reservar (agendarCita hace la reserva).
      if (calcomConfigured(ctx.env)) {
        tools.verDisponibilidad = verDisponibilidadTool(ctx.env, ctx.getConversationId);
      }
      break;
    case "tienda":
    case "panaderia":
    case "cafeteria":
      tools.registrarPedido = registrarPedidoTool(ctx.env, ctx.getConversationId);
      break;
    case "crm":
      tools.registrarProspecto = registrarProspectoTool(ctx.env, ctx.getConversationId);
      break;
    case "hoteleria":
      tools.reservarHospedaje = reservarHospedajeTool(ctx.env, ctx.getConversationId);
      tools.cotizarEvento = cotizarEventoTool(ctx.env, ctx.getConversationId);
      break;
  }

  // agendarCita es el método canónico de citas del giro (registra + reserva en
  // Cal.com). Sustituye al scheduleAppointment genérico para no duplicar tools.
  if (tools.agendarCita) delete tools.scheduleAppointment;

  // Modo evento/masterclass (opt-in por env EVENT_*): info exacta del evento,
  // links de trackeo por cliente y registro conversacional.
  if (hasMasterclassMode(ctx.env)) {
    tools.eventInfo = eventInfoTool(ctx.env);
    tools.trackedLink = trackedLinkTool(ctx.env, ctx.getConversationId);
    if (ctx.env.REGISTRATION_WEBHOOK_URL) {
      tools.registerMasterclass = registerMasterclassTool(ctx.env, ctx.getConversationId);
    }
  }

  return tools;
}
