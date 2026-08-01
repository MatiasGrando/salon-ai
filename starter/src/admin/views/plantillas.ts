// "Plantillas" — el dueño ve/gestiona sus plantillas HSM de WhatsApp para
// reenganchar FUERA de la ventana de 24h. Cubre los DOS métodos de WhatsApp:
//  • Cloud API oficial (Meta): la plantilla se referencia por nombre + idioma;
//    aquí el dueño los configura (setting reengage_template_name/_lang).
//  • Twilio (BSP): la plantilla es un Content SID (HX…); listamos las de la
//    cuenta y se asigna con un click. Read-only + atajos de asignación.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { listContentTemplates, type ContentTemplate } from "../../campaigns";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

const pillOk = `<span style="display:inline-flex;align-items:center;gap:5px;border:1px solid var(--ok);color:var(--ok);font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:2px 8px"><i data-lucide="check" width="12" height="12"></i> Configurada</span>`;
const pillMiss = `<span style="display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dim);color:var(--dim);font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:2px 8px"><i data-lucide="minus" width="12" height="12"></i> Falta</span>`;

function shell(icon: string, title: string, sub: string, pill: string, inner: string): string {
  return `
    <div style="border:1px solid var(--line);background:var(--panel);padding:15px 16px">
      <div style="display:flex;align-items:center;gap:11px;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:11px;min-width:0">
          <div style="width:30px;height:30px;flex:none;border:1px solid var(--linelit);background:var(--accent-soft);display:flex;align-items:center;justify-content:center">
            <i data-lucide="${icon}" width="15" height="15" style="color:var(--accent)"></i>
          </div>
          <div style="min-width:0">
            <div class="font-display" style="font-weight:600;font-size:13.5px">${esc(title)}</div>
            <div style="font-size:10.5px;color:var(--dim)">${esc(sub)}</div>
          </div>
        </div>
        ${pill}
      </div>
      ${inner}
    </div>`;
}

// Tarjeta de un rol de Twilio: qué Content SID tiene asignado.
function twilioRole(opts: { icon: string; title: string; desc: string; sid: string; tpl?: ContentTemplate; source: string }): string {
  const configured = opts.sid.trim() !== "";
  const detail = configured
    ? opts.tpl
      ? `<div style="margin-top:8px"><div class="font-mono" style="font-size:11px;color:var(--muted)">${esc(opts.tpl.name)} · <span style="color:var(--dim)">${esc(opts.sid)}</span></div>
          <div style="font-size:12px;color:var(--cream);margin-top:4px;line-height:1.5">“${esc(opts.tpl.body.slice(0, 140))}${opts.tpl.body.length > 140 ? "…" : ""}”</div></div>`
      : `<div class="font-mono" style="font-size:11px;color:var(--muted);margin-top:8px">${esc(opts.sid)} <span style="color:var(--dim)">— no está en la lista de tu cuenta</span></div>`
    : `<div style="font-size:12px;color:var(--dim);margin-top:8px">Sin plantilla asignada. ${esc(opts.desc)}</div>`;
  return shell(opts.icon, opts.title, opts.source, configured ? pillOk : pillMiss, detail);
}

export async function renderPlantillas(
  env: Env,
  q: Record<string, string | undefined> = {},
): Promise<string> {
  const db = new Db(env.DB);
  const settings = new SettingsRepo(db);

  const cloudWa = Boolean(env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN);
  const twilioWa = Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);

  const [reengageSid, handoffSidSetting, reName, reLang, templates] = await Promise.all([
    settings.get(SETTING_KEYS.reengageTemplateSid),
    settings.get(SETTING_KEYS.twilioHandoffContentSid),
    settings.get(SETTING_KEYS.reengageTemplateName),
    settings.get(SETTING_KEYS.reengageTemplateLang),
    twilioWa ? listContentTemplates(env).catch(() => []) : Promise.resolve([] as ContentTemplate[]),
  ]);
  const reengage = (reengageSid ?? "").trim();
  const handoff = (env.TWILIO_HANDOFF_CONTENT_SID || handoffSidSetting || "").trim();
  const name = (reName ?? "").trim();
  const lang = (reLang ?? "").trim() || "es";
  const byId = new Map(templates.map((t) => [t.sid, t]));

  const method = cloudWa && twilioWa ? "Cloud API oficial + Twilio" : cloudWa ? "Cloud API oficial de Meta" : twilioWa ? "Twilio (BSP)" : "WhatsApp sin conectar";
  const banner = q.saved
    ? `<div style="border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:12px 16px;margin-bottom:18px;font-size:12.5px">✅ Plantilla de reenganche guardada.</div>`
    : "";

  // ── Sección Cloud API oficial ──────────────────────────────────────────────
  const cloudInput = `background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:8px 10px;font-size:12.5px;font-family:inherit`;
  const cloudForm = `
    <form method="post" action="/admin/plantillas/wa-template" style="margin-top:12px;display:flex;flex-direction:column;gap:9px">
      <div style="display:flex;gap:9px;flex-wrap:wrap">
        <label style="flex:1;min-width:160px;display:flex;flex-direction:column;gap:4px">
          <span class="text-dim" style="font-size:10.5px;letter-spacing:.06em;text-transform:uppercase">Nombre de la plantilla (Meta)</span>
          <input name="name" value="${esc(name)}" placeholder="reenganche_lead" style="${cloudInput}">
        </label>
        <label style="width:120px;display:flex;flex-direction:column;gap:4px">
          <span class="text-dim" style="font-size:10.5px;letter-spacing:.06em;text-transform:uppercase">Idioma</span>
          <input name="lang" value="${esc(lang)}" placeholder="es" style="${cloudInput}">
        </label>
      </div>
      <div><button type="submit" class="bigbtn" style="background:var(--accent);color:#20140a;border:none;padding:8px 16px;font-size:12px;font-weight:700;cursor:pointer">Guardar</button></div>
    </form>
    <div class="text-dim" style="font-size:11px;margin-top:10px;line-height:1.5">
      Crea la plantilla en tu <b>WhatsApp Manager</b> (Meta → Manage templates), con
      <b>{{1}} = nombre del cliente</b>, y ponla a aprobar. Aquí solo va su <b>nombre</b> e <b>idioma</b>.
    </div>`;
  const cloudSection = cloudWa
    ? `<div>
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:10px" class="text-dim">Recupera no-shows · WhatsApp oficial</div>
        ${shell("flame", "Plantilla de reenganche (Cloud API)", "Reenganche fuera de la ventana de 24h", name ? pillOk : pillMiss, cloudForm)}
      </div>`
    : "";

  // ── Sección Twilio ─────────────────────────────────────────────────────────
  const accountRows =
    templates.length > 0
      ? templates
          .map((t) => {
            const inUse = t.sid === reengage;
            const vars = t.variables.length ? ` · ${t.variables.length} var${t.variables.length > 1 ? "s" : ""}` : "";
            const action = inUse
              ? `<span style="display:inline-flex;align-items:center;gap:5px;color:var(--ok);font-size:11px"><i data-lucide="check" width="13" height="13"></i> En reenganche</span>`
              : `<form method="post" action="/admin/plantillas/use" style="margin:0"><input type="hidden" name="sid" value="${esc(t.sid)}">
                  <button type="submit" class="ghostbtn" style="background:var(--panel);border:1px solid var(--line);color:var(--muted);padding:6px 11px;font-size:11px;cursor:pointer;white-space:nowrap">Usar para reenganche</button></form>`;
            return `<div style="border-top:1px solid var(--line);padding:12px 16px;display:flex;gap:14px;align-items:flex-start;justify-content:space-between">
              <div style="min-width:0"><div class="font-mono" style="font-size:12px;color:var(--cream)">${esc(t.name)} <span style="color:var(--dim)">· ${esc(t.sid)}${vars}</span></div>
              <div style="font-size:12px;color:var(--muted);margin-top:4px;line-height:1.5">“${esc(t.body.slice(0, 110))}${t.body.length > 110 ? "…" : ""}”</div></div>
              <div style="flex:none">${action}</div></div>`;
          })
          .join("")
      : `<div class="text-dim" style="font-size:12px;padding:16px;line-height:1.5">No hay plantillas aprobadas en tu cuenta de Twilio (o faltan credenciales). Créalas en Twilio → Content Template Builder y sométlas a aprobación de Meta.</div>`;
  const twilioSection = twilioWa
    ? `<div>
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:10px" class="text-dim">Recupera no-shows · Twilio</div>
        <div style="display:grid;grid-template-columns:1fr;gap:10px">
          ${twilioRole({ icon: "flame", title: "Recupera no-shows", desc: "Sin ella, en WhatsApp solo reengancha dentro de la ventana de 24h.", sid: reengage, tpl: byId.get(reengage), source: "Reenganche fuera de ventana · Configuración" })}
          ${twilioRole({ icon: "phone-forwarded", title: "Aviso de handoff", desc: "El aviso al dueño cuando un cliente necesita un humano fuera de ventana.", sid: handoff, tpl: byId.get(handoff), source: "Aviso al dueño · setup automático" })}
        </div>
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin:18px 0 10px" class="text-dim">Plantillas en tu cuenta de Twilio</div>
        <div style="border:1px solid var(--line);background:var(--panel)">${accountRows}</div>
      </div>`
    : "";

  const none = !cloudWa && !twilioWa
    ? `<div class="text-dim" style="font-size:12.5px;padding:20px 16px;border:1px solid var(--line);background:var(--panel);line-height:1.6">
        Aún no conectas WhatsApp. Conéctalo por el <b>Cloud API oficial de Meta</b> (recomendado) o por <b>Twilio</b> en
        <a href="/admin/conexiones" style="color:var(--accent)">Conexiones</a>. Después vuelve aquí para las plantillas de reenganche.</div>`
    : "";

  const body = `
  ${banner}
  <div style="max-width:860px;display:flex;flex-direction:column;gap:22px">
    <div style="font-size:12.5px;color:var(--muted);line-height:1.6">
      Las plantillas HSM sirven para escribirle a un cliente <b>fuera de la ventana de 24h</b>.
      Tu bot manda WhatsApp por: <b class="text-cream">${esc(method)}</b>.
    </div>
    ${cloudSection}
    ${twilioSection}
    ${none}
  </div>`;

  return layout({ title: "Plantillas", activeTab: "plantillas", body, env });
}
