import type { Env } from "../../env";
import { Db } from "../../db/client";
import { TicketsRepo } from "../../db/tickets";
import { layout } from "./layout";

const STATUS_PILL: Record<string, string> = {
  open: "var(--bad)",
  in_progress: "var(--info)",
};

export async function renderTickets(env: Env): Promise<string> {
  const repo = new TicketsRepo(new Db(env.DB));
  const open = await repo.listOpen();

  const list = open
    .map((t) => {
      const date = new Date(t.created_at).toLocaleString("es-MX");
      const pillColor = STATUS_PILL[t.status] ?? "var(--muted)";
      return `<div class="tkcard bg-panel border border-line" style="padding:16px 18px;margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px;min-width:0">
            <span style="font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:${pillColor};border:1px solid ${pillColor};padding:1px 6px;flex:none">${t.status.toUpperCase()}</span>
            <span class="font-display font-semibold text-[13px] text-cream truncate">${t.category}</span>
          </div>
          <span class="text-dim text-[11px]" style="flex:none">${date}</span>
        </div>
        <p class="text-muted text-[12.5px] leading-relaxed" style="margin:0 0 12px">${t.summary}</p>
        <form method="POST" action="/admin/tickets/${t.id}/resolve" style="display:flex;gap:8px">
          <input name="resolved_by" placeholder="tu email" required
                 style="flex:1;background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:9px 12px;font-size:12.5px;outline:none">
          <button class="bigbtn font-display font-bold text-[11.5px] cursor-pointer"
                  style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:3px 3px 0 var(--linelit);padding:9px 16px">Resolver</button>
        </form>
      </div>`;
    })
    .join("");

  // Empty-state amable: un bot recién instalado nunca tiene tickets — que se
  // entienda que es buena señal y qué los va a llenar (no que algo está roto).
  const body =
    open.length === 0
      ? `<div class="bg-panel border border-line" style="padding:48px 18px;text-align:center">
           <i data-lucide="life-buoy" width="24" height="24" style="color:var(--dim);margin:0 auto 12px;display:block"></i>
           <p class="text-[13px]" style="color:var(--muted);font-weight:600;margin:0">No hay tickets abiertos</p>
           <p class="text-dim text-[11.5px]" style="margin:6px auto 0;line-height:1.5;max-width:380px">Aquí aparecerán los casos que tu bot no pueda resolver solo — un cliente enojado, una duda fuera de su conocimiento, algo que pida un humano. Se llena con el uso.</p>
         </div>`
      : list;

  return layout({ title: "Tickets", activeTab: "tickets", body, env });
}
