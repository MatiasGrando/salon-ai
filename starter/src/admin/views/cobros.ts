// Tab "Cobros" (Pro): dinero cobrado por WhatsApp (Stripe) + estado de Reseñas.
// La data ya se guarda (payment_intents / review_requests); esta vista la surfacea.
// Empty states: si no está conectado Stripe / falta el link de Google, guía a
// conectarlo en vez de mostrar una tabla vacía sin contexto.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { stripeConfigured } from "../../integrations/stripe";
import { layout, renderConfigPrompt } from "./layout";

// Prompt que el dueño pega a su agente (Claude Code) para conectar Stripe y
// prender Cobros. Vive en el empty-state cuando aún no hay Stripe conectado.
const COBROS_PROMPT =
  "Configura Cobros por WhatsApp en mi bot de Forja: guíame a conectar mi Stripe " +
  "(poner mi STRIPE_SECRET_KEY como secret del Worker con wrangler secret put), " +
  "activa el toggle de Cobros en Configuración, y explícame cómo el bot genera y " +
  "manda links de pago por WhatsApp y me avisa cuando pagan.";

type PayRow = {
  id: string;
  amount: number;
  currency: string;
  description: string | null;
  status: string;
  url: string | null;
  created_at: number;
  paid_at: number | null;
  conversation_id: string | null;
  channel: string | null;
  channel_user_id: string | null;
};

const STATUS: Record<string, { label: string; color: string }> = {
  paid: { label: "PAGADO", color: "var(--ok)" },
  pending: { label: "PENDIENTE", color: "var(--accent-2)" },
  canceled: { label: "CANCELADO", color: "var(--dim)" },
};

function money(cents: number, currency: string): string {
  const cur = (currency || "mxn").toUpperCase();
  try {
    return (cents / 100).toLocaleString("es-MX", { style: "currency", currency: cur });
  } catch {
    return `$${(cents / 100).toFixed(2)} ${cur}`;
  }
}

function statCard(label: string, value: string, sub?: string): string {
  return `<div class="bg-panel border border-line" style="padding:16px 18px">
    <div class="text-dim" style="font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;margin-bottom:6px">${label}</div>
    <div class="font-display font-bold text-cream" style="font-size:24px;letter-spacing:-.02em">${value}</div>
    ${sub ? `<div class="text-dim" style="font-size:11px;margin-top:2px">${sub}</div>` : ""}
  </div>`;
}

// Tarjeta de "conecta esto" (empty state accionable).
function connectCard(icon: string, title: string, stepsHtml: string): string {
  return `<div class="bg-panel border" style="border-color:var(--accent);border-left-width:3px;padding:18px 20px;margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px">
      <i data-lucide="${icon}" width="18" height="18" style="color:var(--accent)"></i>
      <span class="font-display font-semibold text-cream" style="font-size:14px">${title}</span>
    </div>
    <div class="text-muted" style="font-size:12.5px;line-height:1.7">${stepsHtml}</div>
  </div>`;
}

export async function renderCobros(env: Env): Promise<string> {
  const db = new Db(env.DB);
  const settings = await new SettingsRepo(db).all();
  const connected = stripeConfigured(env);
  const paymentsOn = settings[SETTING_KEYS.paymentsEnabled] === "1";
  const reviewUrl = (settings[SETTING_KEYS.reviewUrl] ?? "").trim();
  const reviewsOn = settings[SETTING_KEYS.reviewRequests] === "1";

  // Agregados (todas las filas) + lista (últimas 100).
  const agg = await db.first<{ n: number; paid: number; pending: number; cur: string | null }>(
    `SELECT COUNT(*) n,
            COALESCE(SUM(CASE WHEN status='paid'    THEN amount END),0) paid,
            COALESCE(SUM(CASE WHEN status='pending' THEN amount END),0) pending,
            (SELECT currency FROM payment_intents ORDER BY created_at DESC LIMIT 1) cur
       FROM payment_intents`,
  );
  const rows = await db.all<PayRow>(
    `SELECT pi.id, pi.amount, pi.currency, pi.description, pi.status, pi.url,
            pi.created_at, pi.paid_at, pi.conversation_id,
            c.channel, c.channel_user_id
       FROM payment_intents pi
       LEFT JOIN conversations c ON c.id = pi.conversation_id
      ORDER BY pi.created_at DESC
      LIMIT 100`,
  );
  const reviews = await db.first<{ n: number; last: number | null }>(
    `SELECT COUNT(*) n, MAX(sent_at) last FROM review_requests`,
  );

  const cur = agg?.cur ?? "MXN";

  // ── Sección Cobros ─────────────────────────────────────────────────────────
  let cobrosBody = "";

  // Banner de conexión / estado.
  if (!connected) {
    cobrosBody += connectCard(
      "credit-card",
      "Conecta tu Stripe para cobrar por WhatsApp",
      `1. Saca tu llave secreta en <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener">dashboard.stripe.com/apikeys</a> (empieza con <code style="background:var(--bg);border:1px solid var(--line);padding:1px 5px">sk_live_…</code>).<br>
       2. Pídele a tu agente (Claude Code) que la guarde como el secreto <code style="background:var(--bg);border:1px solid var(--line);padding:1px 5px">STRIPE_SECRET_KEY</code>.<br>
       3. Prende <b class="text-cream">💰 Cobros por WhatsApp</b> en <a href="/admin/config">Configuración</a>.<br>
       <span class="text-dim">Mientras no esté conectado, el bot no inventa cobros — le dice al cliente que tú lo confirmas.</span>`,
    );
    cobrosBody += `<div style="margin-bottom:16px">${renderConfigPrompt(
      COBROS_PROMPT,
      "¿No sabes de llaves ni secrets? Copia esto y pégaselo a tu agente (Claude Code): te conecta Stripe y prende los cobros paso a paso.",
    )}</div>`;
  } else if (!paymentsOn) {
    cobrosBody += connectCard(
      "circle-alert",
      "Stripe conectado, pero Cobros está apagado",
      `Tu llave ya está lista. Solo prende <b class="text-cream">💰 Cobros por WhatsApp</b> en <a href="/admin/config">Configuración</a> para que el bot mande links de pago.`,
    );
  }

  // Stats.
  cobrosBody += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
    ${statCard("Cobrado", money(agg?.paid ?? 0, cur), "pagos completados")}
    ${statCard("Pendiente", money(agg?.pending ?? 0, cur), "links sin pagar")}
    ${statCard("Cobros generados", String(agg?.n ?? 0))}
  </div>`;

  // Lista o empty.
  if (rows.length === 0) {
    cobrosBody += `<div class="bg-panel border border-line" style="padding:36px 18px;text-align:center">
      <p class="text-dim" style="font-size:12.5px">Aún no hay cobros. Cuando el bot mande un link de pago, aparecerá aquí con su estado.</p>
    </div>`;
  } else {
    const list = rows
      .map((r) => {
        const st = STATUS[r.status] ?? { label: r.status.toUpperCase(), color: "var(--muted)" };
        const when = new Date((r.status === "paid" && r.paid_at ? r.paid_at : r.created_at)).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        const who = r.channel_user_id ? `${r.channel ?? ""} · ${r.channel_user_id.slice(-8)}` : "—";
        const desc = (r.description ?? "Cobro").replace(/[<>]/g, "");
        const openConv = r.conversation_id ? `<a href="/admin/conversations?c=${encodeURIComponent(r.conversation_id)}" class="text-dim" style="font-size:11px" title="Ver conversación">ver chat →</a>` : "";
        return `<div class="datarow bg-panel border border-line" style="padding:13px 16px;margin-bottom:8px;display:flex;align-items:center;gap:14px">
          <div style="min-width:0;flex:1">
            <div class="text-cream font-display font-semibold" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${desc}</div>
            <div class="text-dim" style="font-size:11px;margin-top:2px">${who} · ${when}</div>
          </div>
          <div class="font-mono text-cream" style="font-size:13.5px;font-weight:600;flex:none">${money(r.amount, r.currency)}</div>
          <span style="font-size:9px;letter-spacing:.05em;color:${st.color};border:1px solid ${st.color};padding:2px 7px;flex:none">${st.label}</span>
          <span style="flex:none">${openConv}</span>
        </div>`;
      })
      .join("");
    cobrosBody += list;
  }

  // ── Sección Reseñas ────────────────────────────────────────────────────────
  let reseñasBody = "";
  if (!reviewUrl) {
    reseñasBody = connectCard(
      "star",
      "Pon tu link de Google para pedir reseñas",
      `El bot invita a dejar reseña a quien quedó contento — pero necesita tu link de Google Business.<br>
       Pégalo en <a href="/admin/config">Configuración → “Tu link de reseñas de Google”</a> y prende <b class="text-cream">🌟 Pide reseñas</b>.`,
    );
  } else {
    reseñasBody = `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
      ${statCard("Reseñas pedidas", String(reviews?.n ?? 0), reviews?.last ? `última: ${new Date(reviews.last).toLocaleDateString("es-MX")}` : "aún ninguna")}
      ${statCard("Estado", reviewsOn ? "Activo" : "Apagado", reviewsOn ? "" : "préndelo en Configuración")}
    </div>
    <div class="text-dim" style="font-size:11.5px;margin-top:10px">Tu link: <a href="${reviewUrl.replace(/"/g, "&quot;")}" target="_blank" rel="noopener">${reviewUrl.replace(/[<>]/g, "")}</a>
    <span class="text-dim"> — Google no nos deja leer las reseñas que llegan; aquí ves a cuántos se las pediste.</span></div>`;
  }

  const body = `
    <div class="card">
      <section style="margin-bottom:30px">
        <h2 class="font-display font-semibold text-cream" style="font-size:15px;margin:0 0 12px;display:flex;align-items:center;gap:8px">
          <i data-lucide="wallet" width="17" height="17" style="color:var(--accent)"></i> Cobros por WhatsApp
        </h2>
        ${cobrosBody}
      </section>
      <section>
        <h2 class="font-display font-semibold text-cream" style="font-size:15px;margin:0 0 12px;display:flex;align-items:center;gap:8px">
          <i data-lucide="star" width="17" height="17" style="color:var(--accent)"></i> Reseñas
        </h2>
        ${reseñasBody}
      </section>
    </div>`;

  return layout({ title: "Cobros", activeTab: "cobros", body, env });
}
