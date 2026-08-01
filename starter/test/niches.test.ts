import { describe, it, expect } from "vitest";
import { getNiche } from "../src/niches";
import { systemPromptFromEnv } from "../src/system-prompt";
import { layout } from "../src/admin/views/layout";
import type { Env } from "../src/env";

const envWith = (niche?: string) => ({ BOT_NICHE: niche, BOT_NAME: "Bot", BUSINESS_NAME: "Neg", BOT_LANGUAGE: "es-MX" }) as unknown as Env;

describe("getNiche", () => {
  it("resuelve los 3 giros nuevos (cafeteria/clinica/spa)", () => {
    const caf = getNiche(envWith("cafeteria"));
    expect(caf.id).toBe("cafeteria");
    expect(caf.navLabel).toBe("Pedidos");
    expect(caf.columns.map((c) => c.key)).toContain("productos");
    expect(caf.playbook).toContain("registrarPedido");
    const cli = getNiche(envWith("clinica"));
    expect(cli.id).toBe("clinica");
    expect(cli.navLabel).toBe("Citas");
    expect(cli.playbook).toContain("agendarCita");
    expect(cli.columns.map((c) => c.key)).toContain("motivo");
    const sp = getNiche(envWith("spa"));
    expect(sp.id).toBe("spa");
    expect(sp.navLabel).toBe("Sesiones");
    expect(sp.playbook).toContain("agendarCita");
    expect(sp.columns.map((c) => c.key)).toContain("ritual");
  });


  it("resuelve restaurante", () => {
    const n = getNiche(envWith("restaurante"));
    expect(n.id).toBe("restaurante");
    expect(n.navLabel).toBe("Reservaciones");
    expect(n.playbook).toContain("reservacion");
    expect(n.defaultTone).not.toBe("");
    expect(n.columns.map((c) => c.key)).toContain("personas");
  });

  it("normaliza mayúsculas/espacios", () => {
    expect(getNiche(envWith("  RESTAURANTE ")).id).toBe("restaurante");
  });

  it("resuelve inmobiliaria", () => {
    const n = getNiche(envWith("inmobiliaria"));
    expect(n.id).toBe("inmobiliaria");
    expect(n.navLabel).toBe("Compradores");
    expect(n.columns.map((c) => c.key)).toContain("presupuesto");
    expect(n.playbook).toContain("calificarComprador");
  });

  it("resuelve los giros de cita (agendarCita)", () => {
    for (const id of ["barberia", "salon", "dentista", "gimnasio", "coach"]) {
      const n = getNiche(envWith(id));
      expect(n.id).toBe(id);
      expect(n.playbook).toContain("agendarCita");
      expect(n.defaultTone).not.toBe("");
      expect(n.columns.map((c) => c.key)).toContain("servicio");
    }
    expect(getNiche(envWith("barberia")).navLabel).toBe("Citas");
    expect(getNiche(envWith("coach")).navLabel).toBe("Sesiones");
    expect(getNiche(envWith("dentista")).statusLabels.sold).toBe("Atendido");
  });

  it("resuelve los giros de comercio (registrarPedido)", () => {
    for (const id of ["tienda", "panaderia"]) {
      const n = getNiche(envWith(id));
      expect(n.id).toBe(id);
      expect(n.navLabel).toBe("Pedidos");
      expect(n.playbook).toContain("registrarPedido");
      expect(n.columns.map((c) => c.key)).toContain("productos");
    }
    expect(getNiche(envWith("panaderia")).columns.map((c) => c.key)).toContain("fecha");
  });

  it("resuelve CRM (pipeline de prospectos)", () => {
    const n = getNiche(envWith("crm"));
    expect(n.id).toBe("crm");
    expect(n.navLabel).toBe("Prospectos");
    expect(n.playbook).toContain("registrarProspecto");
    expect(n.columns.map((c) => c.key)).toContain("empresa");
  });

  it("resuelve Hotelería (hospedaje + eventos)", () => {
    const n = getNiche(envWith("hoteleria"));
    expect(n.id).toBe("hoteleria");
    expect(n.navLabel).toBe("Reservas");
    expect(n.playbook).toContain("reservarHospedaje");
    expect(n.playbook).toContain("cotizarEvento");
    expect(n.columns.map((c) => c.key)).toContain("huespedes");
  });

  it("nicho ausente o desconocido → genérico (comportamiento actual)", () => {
    for (const v of [undefined, "", "xyz"]) {
      const n = getNiche(envWith(v));
      expect(n.id).toBe("generico");
      expect(n.navLabel).toBe("Leads");
      expect(n.playbook).toBe("");
      expect(n.defaultTone).toBe("");
    }
  });
});

describe("dashboard re-etiquetado por nicho (nav)", () => {
  const page = (niche?: string) => layout({ title: "T", activeTab: "leads", body: "x", env: envWith(niche) });

  it("restaurante: el nav 'Leads' se vuelve 'Reservaciones'", () => {
    const html = page("restaurante");
    expect(html).toContain("Reservaciones");
    expect(html).not.toContain(">Leads<");
    expect(html).toContain('href="/admin/leads"'); // el href NO cambia (load-bearing)
  });

  it("inmobiliaria: el nav dice 'Compradores'", () => {
    expect(page("inmobiliaria")).toContain("Compradores");
  });

  it("genérico: sigue diciendo 'Leads'", () => {
    expect(page(undefined)).toContain("Leads");
  });
});

describe("cableado del playbook al prompt", () => {
  it("el playbook del nicho llega al system prompt vía systemPromptFromEnv", () => {
    const env = envWith("restaurante");
    const prompt = systemPromptFromEnv(env, ["searchKb"], "ctx", getNiche(env).playbook || undefined);
    expect(prompt).toContain("<diagnostic_playbooks>");
    expect(prompt).toContain("crearReservacion");
  });

  it("genérico no inyecta playbook", () => {
    const env = envWith(undefined);
    const prompt = systemPromptFromEnv(env, ["searchKb"], "ctx", getNiche(env).playbook || undefined);
    expect(prompt).not.toContain("<diagnostic_playbooks>");
  });
});
