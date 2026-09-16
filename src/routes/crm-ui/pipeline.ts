// Adapted from the user-supplied weex-crm.html prototype; persistence and events use the CRM APIs.
export const pipelineStyles = String.raw`
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
    #pipeline-shell {
      --pl-bg:#090B0E; --pl-canvas:#0E1117; --pl-surface:#131722; --pl-surface-2:#1A202E; --pl-surface-3:#222A3D;
      --pl-ink:#F8FAFC; --pl-ink-2:#CBD5E1; --pl-muted:#94A3B8; --pl-muted-2:#64748B;
      --pl-border:rgba(255,255,255,.07); --pl-border-hover:rgba(255,255,255,.16);
      --pl-cyan:#0EA5E9; --pl-cyan-bright:#38BDF8; --pl-cyan-soft:rgba(14,165,233,.12);
      --pl-green:#10B981; --pl-green-bright:#34D399; --pl-green-soft:rgba(16,185,129,.12);
      --pl-amber:#F59E0B; --pl-amber-bright:#FBBF24; --pl-amber-soft:rgba(245,158,11,.12);
      --pl-red:#F43F5E; --pl-red-bright:#FB7185; --pl-red-soft:rgba(244,63,94,.14);
      --pl-purple:#8B5CF6; --pl-purple-bright:#A78BFA; --pl-purple-soft:rgba(139,92,246,.14);
      min-height:100%; color:var(--pl-ink); font-family:'Plus Jakarta Sans',sans-serif; letter-spacing:-.01em;
      background:radial-gradient(circle at 10% 0%,rgba(14,165,233,.08),transparent 40%),radial-gradient(circle at 90% 15%,rgba(139,92,246,.06),transparent 35%),var(--pl-bg);
    }
    #pipeline-shell * { box-sizing:border-box; }
    #pipeline-shell [hidden] { display:none !important; }
    #pipeline-shell .pl-shell { max-width:1600px; margin:0 auto; padding:22px 26px 60px; }
    #pipeline-shell .pl-header { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:22px; padding-bottom:18px; border-bottom:1px solid var(--pl-border); flex-wrap:wrap; }
    #pipeline-shell .pl-brand { display:flex; flex-direction:column; gap:4px; }
    #pipeline-shell .pl-title-row { display:flex; align-items:center; gap:10px; }
    #pipeline-shell .pl-logo { width:32px; height:32px; border-radius:9px; display:flex; align-items:center; justify-content:center; color:#fff; background:linear-gradient(135deg,#0EA5E9,#2563EB); box-shadow:0 2px 10px rgba(14,165,233,.35); font-weight:800; }
    #pipeline-shell .pl-title { margin:0; font-size:24px; font-weight:800; letter-spacing:-.03em; background:linear-gradient(135deg,#FFFFFF 40%,#CBD5E1); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
    #pipeline-shell .pl-brand-badge { padding:3px 9px; border:1px solid rgba(14,165,233,.25); border-radius:20px; color:var(--pl-cyan-bright); background:var(--pl-cyan-soft); font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
    #pipeline-shell .pl-subtitle { margin:0; color:var(--pl-muted); font-size:13px; }
    #pipeline-shell .pl-tabs { display:flex; align-items:center; padding:3px; gap:3px; border:1px solid var(--pl-border); border-radius:10px; background:var(--pl-surface); }
    #pipeline-shell .pl-tab { display:flex; align-items:center; gap:8px; padding:8px 16px; border:1px solid transparent; border-radius:8px; color:var(--pl-muted); background:none; font:600 13px 'Plus Jakarta Sans',sans-serif; cursor:pointer; }
    #pipeline-shell .pl-tab:hover { color:var(--pl-ink); background:rgba(255,255,255,.03); }
    #pipeline-shell .pl-tab.pl-active { color:var(--pl-ink); background:var(--pl-surface-2); border-color:rgba(255,255,255,.08); box-shadow:0 2px 8px rgba(0,0,0,.3); }
    #pipeline-shell .pl-badge { padding:1px 7px; border:1px solid var(--pl-border); border-radius:20px; color:var(--pl-cyan-bright); background:var(--pl-canvas); font-size:11px; font-weight:700; }
    #pipeline-shell .pl-tab.pl-active .pl-badge { background:var(--pl-cyan-soft); border-color:rgba(14,165,233,.3); }
    #pipeline-shell .pl-pane { animation:pl-fade .18s ease; }
    #pipeline-shell .pl-toolbar { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:18px; flex-wrap:wrap; }
    #pipeline-shell .pl-section-title h2 { margin:0 0 4px; font-size:20px; font-weight:700; letter-spacing:-.02em; }
    #pipeline-shell .pl-section-title p { margin:0; color:var(--pl-muted); font-size:12.5px; }
    #pipeline-shell .pl-actions, #pipeline-shell .pl-stats { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    #pipeline-shell .pl-button { min-height:40px; padding:0 14px; display:inline-flex; align-items:center; justify-content:center; gap:7px; border:1px solid var(--pl-border); border-radius:8px; color:var(--pl-ink); background:var(--pl-surface); font:600 12.5px 'Plus Jakarta Sans',sans-serif; cursor:pointer; }
    #pipeline-shell .pl-button:hover { border-color:var(--pl-border-hover); background:var(--pl-surface-2); }
    #pipeline-shell .pl-button.pl-primary { color:#fff; border:0; background:linear-gradient(135deg,#0EA5E9,#2563EB); box-shadow:0 2px 10px rgba(14,165,233,.3); }
    #pipeline-shell .pl-button.pl-primary:hover { transform:translateY(-1px); box-shadow:0 4px 18px rgba(14,165,233,.45); }
    #pipeline-shell .pl-button.pl-danger { color:var(--pl-red-bright); border-color:rgba(244,63,94,.28); background:var(--pl-red-soft); }
    #pipeline-shell .pl-button:disabled { opacity:.45; cursor:not-allowed; transform:none; box-shadow:none; }
    #pipeline-shell .pl-stat { padding:8px 14px; display:flex; align-items:center; gap:10px; border:1px solid var(--pl-border); border-radius:10px; background:var(--pl-surface); }
    #pipeline-shell .pl-stat strong { color:var(--pl-ink); font-size:17px; line-height:1.1; }
    #pipeline-shell .pl-stat span { color:var(--pl-muted); font-size:11px; }
    #pipeline-shell .pl-filters { display:flex; gap:10px; margin-bottom:18px; flex-wrap:wrap; }
    #pipeline-shell .pl-search-box { min-width:220px; flex:1; display:flex; align-items:center; gap:8px; padding:8px 12px; border:1px solid var(--pl-border); border-radius:8px; color:var(--pl-muted); background:var(--pl-surface); }
    #pipeline-shell .pl-search-box:focus-within { border-color:var(--pl-cyan); box-shadow:0 0 0 1px var(--pl-cyan); }
    #pipeline-shell .pl-input, #pipeline-shell .pl-select, #pipeline-shell .pl-textarea { width:100%; padding:9px 10px; border:1px solid var(--pl-border); border-radius:6px; color:var(--pl-ink); background:var(--pl-canvas); font:400 13px 'Plus Jakarta Sans',sans-serif; outline:0; }
    #pipeline-shell .pl-search-box .pl-input { padding:0; border:0; background:none; box-shadow:none; }
    #pipeline-shell .pl-input:focus, #pipeline-shell .pl-select:focus, #pipeline-shell .pl-textarea:focus { outline:2px solid var(--pl-cyan); outline-offset:1px; }
    #pipeline-shell .pl-pill { min-height:36px; padding:8px 13px; display:flex; align-items:center; gap:7px; border:1px solid var(--pl-border); border-radius:8px; color:var(--pl-muted); background:var(--pl-surface); font:500 12.5px 'Plus Jakarta Sans',sans-serif; white-space:nowrap; }
    #pipeline-shell .pl-pill.pl-active { color:var(--pl-cyan-bright); border-color:rgba(14,165,233,.35); background:var(--pl-cyan-soft); font-weight:600; }
    #pipeline-shell .pl-board { display:flex; gap:14px; align-items:flex-start; overflow-x:auto; padding-bottom:14px; }
    #pipeline-shell .pl-board::-webkit-scrollbar { height:7px; }
    #pipeline-shell .pl-board::-webkit-scrollbar-thumb { border-radius:8px; background:var(--pl-surface-3); }
    #pipeline-shell .pl-column { flex:0 0 274px; width:274px; min-height:220px; display:flex; flex-direction:column; border:1px solid var(--pl-border); border-radius:12px; background:var(--pl-surface); box-shadow:0 2px 8px rgba(0,0,0,.2); }
    #pipeline-shell .pl-column-head { padding:12px 14px 10px; display:flex; align-items:center; justify-content:space-between; gap:8px; border-top:3px solid var(--pl-stage-color,var(--pl-cyan)); border-bottom:1px solid var(--pl-border); border-radius:12px 12px 0 0; background:var(--pl-surface); }
    #pipeline-shell .pl-column-head h3 { margin:0; color:var(--pl-ink); font-size:14px; font-weight:700; }
    #pipeline-shell .pl-column-copy { display:block; margin-top:2px; color:var(--pl-cyan-bright); font-size:11px; font-weight:600; }
    #pipeline-shell .pl-icon-button { width:26px; min-height:26px; padding:0; border-radius:6px; }
    #pipeline-shell .pl-cards { min-height:160px; max-height:calc(100vh - 290px); padding:10px 10px 14px; display:flex; flex:1; flex-direction:column; gap:9px; overflow-y:auto; border:2px dashed transparent; }
    #pipeline-shell .pl-cards::-webkit-scrollbar, #pipeline-shell .pl-task-column-list::-webkit-scrollbar { width:5px; }
    #pipeline-shell .pl-cards::-webkit-scrollbar-thumb, #pipeline-shell .pl-task-column-list::-webkit-scrollbar-thumb { border-radius:6px; background:var(--pl-surface-3); }
    #pipeline-shell .pl-card { padding:11px 12px; display:flex; flex-direction:column; gap:6px; border:1px solid var(--pl-border); border-radius:9px; background:var(--pl-surface-2); cursor:grab; transition:all .15s ease; }
    #pipeline-shell .pl-card:hover { transform:translateY(-1px); border-color:var(--pl-border-hover); background:var(--pl-surface-3); box-shadow:0 4px 16px rgba(0,0,0,.35); }
    #pipeline-shell .pl-card-title { margin:0 0 2px; color:var(--pl-ink); font-size:13.5px; font-weight:700; }
    #pipeline-shell .pl-card-contact { color:var(--pl-muted); font-size:12px; }
    #pipeline-shell .pl-card-meta { margin-top:6px; display:flex; align-items:center; justify-content:space-between; color:var(--pl-muted); font-size:10.5px; }
    #pipeline-shell .pl-card-meta strong { color:var(--pl-ink); font-size:13.5px; }
    #pipeline-shell .pl-card-actions { margin-top:8px; padding-top:8px; display:grid; grid-template-columns:1fr 1fr; gap:6px; border-top:1px solid var(--pl-border); }
    #pipeline-shell .pl-card-actions .pl-select { padding:5px 6px; font-size:10px; }
    #pipeline-shell .pl-priority { padding:2px 8px; border-radius:12px; color:var(--pl-amber-bright); background:var(--pl-amber-soft); font-size:10px; font-weight:700; text-transform:uppercase; }
    #pipeline-shell .pl-priority.pl-high { color:var(--pl-red-bright); background:var(--pl-red-soft); }
    #pipeline-shell .pl-empty { padding:24px 10px; display:flex; flex-direction:column; align-items:center; gap:8px; border:1px dashed var(--pl-border); border-radius:8px; color:var(--pl-muted-2); text-align:center; font-size:11px; }
    #pipeline-shell .pl-terminal-column { border-top-color:var(--pl-purple); }
    #pipeline-shell .pl-terminal-zone { margin:10px 10px 6px; padding:16px 14px; border:1px solid var(--pl-border); border-radius:9px; text-align:center; transition:all .18s ease; }
    #pipeline-shell .pl-terminal-zone.pl-won-zone { color:var(--pl-green-bright); border-color:rgba(16,185,129,.25); background:var(--pl-green-soft); }
    #pipeline-shell .pl-terminal-zone.pl-cold-zone { color:#BAE6FD; border-color:rgba(100,116,139,.25); background:rgba(100,116,139,.14); }
    #pipeline-shell .pl-terminal-zone strong { display:block; margin-bottom:3px; font-size:13px; }
    #pipeline-shell .pl-terminal-zone span { color:var(--pl-muted); font-size:10.5px; line-height:1.35; }
    #pipeline-shell .pl-tables { margin-top:24px; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; }
    #pipeline-shell .pl-outcome { padding:16px 18px 8px; overflow:hidden; border:1px solid var(--pl-border); border-radius:12px; background:var(--pl-surface); }
    #pipeline-shell .pl-outcome-head { margin-bottom:4px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
    #pipeline-shell .pl-outcome-head h3 { margin:0; font-size:15px; font-weight:700; }
    #pipeline-shell .pl-outcome-copy { margin:2px 0 10px; color:var(--pl-muted); font-size:11.5px; }
    #pipeline-shell .pl-outcome-list { max-height:230px; overflow:auto; }
    #pipeline-shell .pl-outcome-row { padding:10px 8px; display:flex; justify-content:space-between; gap:10px; border-bottom:1px solid var(--pl-border); color:var(--pl-ink); font-size:12.5px; cursor:pointer; }
    #pipeline-shell .pl-outcome-row span { color:var(--pl-muted); }
    #pipeline-shell .pl-task-quick-add { margin-bottom:18px; padding:10px 12px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; border:1px solid var(--pl-border); border-radius:10px; background:var(--pl-surface); }
    #pipeline-shell .pl-task-quick-add > .pl-input { min-width:240px; flex:1; border:0; background:none; }
    #pipeline-shell .pl-quick-selects { display:flex; gap:7px; align-items:center; flex-wrap:wrap; }
    #pipeline-shell .pl-quick-selects .pl-select { width:auto; padding:6px 9px; background:var(--pl-surface-2); font-size:12px; }
    #pipeline-shell .pl-task-layout { display:grid; grid-template-columns:290px 1fr; gap:20px; align-items:start; }
    #pipeline-shell .pl-task-sidebar { padding:18px; display:flex; flex-direction:column; gap:16px; border:1px solid var(--pl-border); border-radius:12px; background:var(--pl-surface); }
    #pipeline-shell .pl-task-sidebar h3 { margin:0 0 8px; font-size:14px; }
    #pipeline-shell .pl-task-progress-box { padding:12px; border:1px solid var(--pl-border); border-radius:8px; background:var(--pl-surface-2); }
    #pipeline-shell .pl-progress-head { margin-bottom:7px; display:flex; justify-content:space-between; color:var(--pl-muted); font-size:11.5px; }
    #pipeline-shell .pl-progress { height:6px; overflow:hidden; border-radius:10px; background:var(--pl-surface-3); }
    #pipeline-shell .pl-progress-bar { height:100%; border-radius:10px; background:linear-gradient(90deg,#0EA5E9,#10B981); }
    #pipeline-shell .pl-task-filters { display:flex; flex-direction:column; gap:3px; }
    #pipeline-shell .pl-task-filter { padding:8px 11px; display:flex; align-items:center; justify-content:space-between; border:1px solid transparent; border-radius:7px; color:var(--pl-muted); background:none; font:400 12.5px 'Plus Jakarta Sans',sans-serif; cursor:pointer; text-align:left; }
    #pipeline-shell .pl-task-filter.pl-active { color:var(--pl-ink); border-color:var(--pl-border); background:var(--pl-surface-2); font-weight:600; }
    #pipeline-shell .pl-task-board { display:grid; grid-template-columns:repeat(3,minmax(220px,1fr)); gap:14px; align-items:start; overflow-x:auto; }
    #pipeline-shell .pl-task-column { min-height:300px; display:flex; flex-direction:column; border:1px solid var(--pl-border); border-radius:12px; background:var(--pl-surface); }
    #pipeline-shell .pl-task-column h3 { margin:0; padding:12px 14px 10px; border-top:3px solid var(--pl-task-color,var(--pl-cyan)); border-bottom:1px solid var(--pl-border); border-radius:12px 12px 0 0; font-size:14px; }
    #pipeline-shell .pl-task-column-list { min-height:280px; max-height:calc(100vh - 310px); padding:10px; display:flex; flex:1; flex-direction:column; gap:9px; overflow-y:auto; }
    #pipeline-shell .pl-task-card { padding:11px 12px; display:flex; flex-direction:column; gap:7px; border:1px solid var(--pl-border); border-radius:9px; background:var(--pl-surface-2); cursor:grab; }
    #pipeline-shell .pl-task-card:hover { transform:translateY(-1px); border-color:var(--pl-border-hover); background:var(--pl-surface-3); }
    #pipeline-shell .pl-task-card strong { color:var(--pl-ink); font-size:13px; }
    #pipeline-shell .pl-task-card span { color:var(--pl-muted); font-size:10.5px; }
    #pipeline-shell .pl-task-card .pl-select { padding:5px 6px; font-size:10px; }
    #pipeline-shell .pl-feedback { min-height:18px; color:var(--pl-muted); font-size:11px; }
    #pipeline-shell .pl-feedback.pl-error { color:var(--pl-red-bright); }
    #pipeline-shell .pl-loading { min-height:260px; display:grid; place-items:center; color:var(--pl-muted); }
    #pipeline-shell .pl-overlay { position:fixed; inset:0; z-index:90; padding:20px; display:flex; align-items:center; justify-content:center; background:rgba(4,6,10,.7); backdrop-filter:blur(4px); }
    #pipeline-shell .pl-modal { width:100%; max-width:480px; max-height:calc(100vh - 40px); padding:22px; overflow:auto; border:1px solid var(--pl-border); border-radius:12px; background:var(--pl-surface); box-shadow:0 12px 36px rgba(0,0,0,.7); }
    #pipeline-shell .pl-modal-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
    #pipeline-shell .pl-modal-head h2 { margin:0 0 16px; font-size:18px; }
    #pipeline-shell .pl-close { width:26px; height:26px; border:1px solid var(--pl-border); border-radius:6px; color:var(--pl-muted); background:var(--pl-canvas); cursor:pointer; }
    #pipeline-shell .pl-form { display:grid; gap:12px; }
    #pipeline-shell .pl-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    #pipeline-shell .pl-field { display:grid; gap:4px; color:var(--pl-muted); font-size:11.5px; font-weight:500; }
    #pipeline-shell .pl-modal-actions { margin-top:8px; display:flex; justify-content:flex-end; gap:10px; }
    #pipeline-shell .pl-stage-list { display:grid; gap:8px; }
    #pipeline-shell .pl-stage-row { display:grid; grid-template-columns:42px minmax(120px,1fr) auto; gap:8px; align-items:center; }
    #pipeline-shell .pl-stage-actions { display:flex; gap:5px; }
    #pipeline-shell .pl-note-list { max-height:180px; display:grid; gap:7px; overflow:auto; }
    #pipeline-shell .pl-note { padding:8px 10px; border:1px solid var(--pl-border); border-radius:7px; color:var(--pl-ink-2); background:var(--pl-surface-2); font-size:11.5px; }
    #pipeline-shell .pl-form-answers { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
    #pipeline-shell .pl-form-answer { min-width:0; padding:10px 12px; border:1px solid var(--pl-border); border-radius:8px; background:var(--pl-surface-2); }
    #pipeline-shell .pl-form-answer-label { display:block; margin-bottom:4px; color:var(--pl-muted); font-size:10.5px; font-weight:600; }
    #pipeline-shell .pl-form-answer-value { color:var(--pl-ink); font-size:12.5px; line-height:1.45; white-space:pre-wrap; overflow-wrap:anywhere; }
    #pipeline-shell .pl-toast { position:fixed; right:24px; bottom:24px; z-index:110; padding:10px 16px; border:1px solid var(--pl-cyan); border-radius:9px; color:var(--pl-ink); background:var(--pl-surface); box-shadow:0 8px 24px rgba(0,0,0,.6); }
    #pipeline-shell .pl-toast.pl-error { color:var(--pl-red-bright); border-color:var(--pl-red); }
    #pipeline-shell .pl-tab:focus-visible, #pipeline-shell .pl-button:focus-visible, #pipeline-shell .pl-card:focus-visible, #pipeline-shell .pl-task-card:focus-visible, #pipeline-shell .pl-task-filter:focus-visible { outline:3px solid rgba(56,189,248,.7); outline-offset:2px; }
    @keyframes pl-fade { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:translateY(0); } }
    @media (max-width:1100px) { #pipeline-shell .pl-tables { grid-template-columns:1fr; } #pipeline-shell .pl-task-board { grid-template-columns:repeat(3,minmax(260px,1fr)); } }
    @media (max-width:980px) { #pipeline-shell .pl-task-layout { grid-template-columns:1fr; } }
    @media (max-width:700px) { #pipeline-shell .pl-shell { padding:16px 12px 40px; } #pipeline-shell .pl-header { align-items:flex-start; } #pipeline-shell .pl-tabs { width:100%; overflow-x:auto; } #pipeline-shell .pl-tab { flex:1; white-space:nowrap; } #pipeline-shell .pl-grid, #pipeline-shell .pl-form-answers { grid-template-columns:1fr; } }
`

export const pipelineMarkup = String.raw`
    <section class="pl-view" id="pl-pipeline-view">
      <div id="pipeline-shell">
        <div class="pl-shell">
          <header class="pl-header">
            <div class="pl-brand">
              <div class="pl-title-row"><div class="pl-logo" aria-hidden="true">W</div><h1 class="pl-title" id="pl-pipeline-name">WEEX</h1><span class="pl-brand-badge">Panel Comercial</span></div>
              <p class="pl-subtitle">Control centralizado de prospectos inbound y organizador operativo.</p>
            </div>
            <nav class="pl-tabs" role="tablist" aria-label="Vistas de Pipeline">
              <button class="pl-tab pl-active" id="pl-tab-leads" type="button" role="tab" aria-selected="true">▣ <span>Leads de Formulario</span><span class="pl-badge" id="pl-leads-count">0</span></button>
              <button class="pl-tab" id="pl-tab-tasks" type="button" role="tab" aria-selected="false">✓ <span>Mis Tareas &amp; Pendientes</span><span class="pl-badge" id="pl-tasks-count">0</span></button>
            </nav>
          </header>

          <section class="pl-pane" id="pl-leads-pane">
            <div class="pl-toolbar">
              <div class="pl-section-title"><h2>📥 Pipeline de Prospectos</h2><p>Los contactos que envían el formulario de la landing ingresan automáticamente en la primera etapa.</p></div>
              <div class="pl-actions"><div class="pl-stats" id="pl-stats"></div><button class="pl-button" id="pl-refresh" type="button">↻ Actualizar</button><button class="pl-button" id="pl-settings-open" type="button">⚙ Configurar etapas</button><button class="pl-button" id="pl-forms-open" type="button">✉ Formularios</button><button class="pl-button" id="pl-simulate" type="button" disabled title="Se habilitará con el formulario público">➤ Simular Formulario</button><button class="pl-button pl-primary" id="pl-new-lead" type="button">＋ Nuevo Lead</button></div>
            </div>
            <div class="pl-filters">
              <label class="pl-search-box">⌕<input class="pl-input" id="pl-search" type="search" placeholder="Buscar por nombre, empresa o contacto..." aria-label="Buscar leads"></label>
              <span class="pl-pill pl-active">Todos</span><span class="pl-pill">✉ Solo Formulario Web</span>
              <select class="pl-select pl-pill" id="pl-priority-filter" aria-label="Filtrar por prioridad"><option value="">Todas las prioridades</option><option value="HIGH">● Alta prioridad</option><option value="MEDIUM">Prioridad media</option><option value="LOW">Prioridad baja</option></select>
              <select class="pl-select pl-pill" id="pl-assignee-filter" aria-label="Filtrar por responsable"><option value="">Todos los responsables</option></select>
            </div>
            <div class="pl-board" id="pl-board" aria-busy="true"><div class="pl-loading">Cargando pipeline...</div></div>
            <div class="pl-tables">
              <section class="pl-outcome"><header class="pl-outcome-head"><h3>✓ Leads cerrados (Ganados)</h3><span class="pl-badge" id="pl-won-count">0</span></header><p class="pl-outcome-copy">Prospectos que completaron la contratación o compra.</p><div class="pl-outcome-list" id="pl-won"></div></section>
              <section class="pl-outcome"><header class="pl-outcome-head"><h3>❄ Sin respuesta (Fríos)</h3><span class="pl-badge" id="pl-no-response-count">0</span></header><p class="pl-outcome-copy">Contactos que no respondieron tras los intentos de seguimiento.</p><div class="pl-outcome-list" id="pl-no-response"></div></section>
              <section class="pl-outcome"><header class="pl-outcome-head"><h3>× Leads perdidos</h3><span class="pl-badge" id="pl-lost-count">0</span></header><p class="pl-outcome-copy">Oportunidades descartadas que conservan su historial.</p><div class="pl-outcome-list" id="pl-lost"></div></section>
            </div>
          </section>

          <section class="pl-pane" id="pl-tasks-pane" hidden>
            <div class="pl-toolbar"><div class="pl-section-title"><h2>📋 Organización &amp; Tareas del Dueño</h2><p>Mini pipeline compartido: arrastrá tarjetas entre <strong>Por hacer</strong>, <strong>En proceso</strong> y <strong>Terminado</strong>.</p></div><div class="pl-actions"><button class="pl-button pl-primary" id="pl-new-task" type="button" hidden>＋ Nueva Tarea</button></div></div>
            <form class="pl-task-quick-add" id="pl-task-quick-form"><span aria-hidden="true">＋</span><input class="pl-input" id="pl-task-quick-title" maxlength="160" placeholder="Escribí una tarea (ej: Llamar a un prospecto, organizar una reunión)..." required><div class="pl-quick-selects"><select class="pl-select" id="pl-task-quick-category"><option value="BUSINESS">💼 Negocio / Local</option><option value="MEETING">🤝 Reunión / Contacto</option><option value="PERSONAL">🏃 Personal / Salud</option><option value="OPERATIONS">⚙ Operaciones</option></select><select class="pl-select" id="pl-task-quick-status"><option value="TODO">⚪ Por hacer</option><option value="IN_PROGRESS">⚡ En proceso</option></select><button class="pl-button pl-primary" type="submit">+ Agregar</button></div></form>
            <div class="pl-task-layout">
              <aside class="pl-task-sidebar"><div><h3>Progreso del Pipeline</h3><div class="pl-task-progress-box"><div class="pl-progress-head"><span>Efectividad global</span><strong id="pl-task-progress-copy">0 de 0 completadas</strong></div><div class="pl-progress"><div class="pl-progress-bar" id="pl-task-progress"></div></div></div></div><div><h3>Filtrar por Área</h3><div class="pl-task-filters" id="pl-task-filters"><button class="pl-task-filter pl-active" type="button" data-pl-task-filter="">Todas las áreas</button><button class="pl-task-filter" type="button" data-pl-task-filter="BUSINESS">● Negocio / Local</button><button class="pl-task-filter" type="button" data-pl-task-filter="MEETING">● Reuniones / Citas</button><button class="pl-task-filter" type="button" data-pl-task-filter="PERSONAL">● Personal &amp; Bienestar</button><button class="pl-task-filter" type="button" data-pl-task-filter="OPERATIONS">● Operaciones &amp; Trámites</button></div></div></aside>
              <main class="pl-task-board" id="pl-task-board"></main>
            </div>
          </section>
          <p class="pl-feedback" id="pl-feedback" role="status" aria-live="polite"></p>
        </div>

        <div class="pl-overlay" id="pl-lead-dialog" hidden><div class="pl-modal" role="dialog" aria-modal="true" aria-labelledby="pl-lead-dialog-title"><div class="pl-modal-head"><h2 id="pl-lead-dialog-title">Nuevo lead</h2><button class="pl-close" type="button" data-pl-close="lead" aria-label="Cerrar">×</button></div><form class="pl-form" id="pl-lead-form"><input id="pl-lead-id" type="hidden"><label class="pl-field">Oportunidad<input class="pl-input" id="pl-lead-title" required maxlength="160"></label><div class="pl-grid"><label class="pl-field">Contacto<input class="pl-input" id="pl-lead-contact" maxlength="160"></label><label class="pl-field">Empresa<input class="pl-input" id="pl-lead-company" maxlength="160"></label><label class="pl-field">Email<input class="pl-input" id="pl-lead-email" type="email"></label><label class="pl-field">Teléfono<input class="pl-input" id="pl-lead-phone"></label><label class="pl-field">Valor estimado (USD)<input class="pl-input" id="pl-lead-value" type="number" min="0" step="0.01" value="0"></label><label class="pl-field">Prioridad<select class="pl-select" id="pl-lead-priority"><option value="LOW">Baja</option><option value="MEDIUM" selected>Media</option><option value="HIGH">Alta</option></select></label><label class="pl-field">Etapa<select class="pl-select" id="pl-lead-stage" required></select></label><label class="pl-field">Responsable<select class="pl-select" id="pl-lead-assignee"><option value="">Sin asignar</option></select></label></div><label class="pl-field">Origen<input class="pl-input" id="pl-lead-source" maxlength="120" placeholder="Manual, Instagram, Web..."></label><p class="pl-feedback" id="pl-lead-feedback"></p><div class="pl-modal-actions"><button class="pl-button" type="button" data-pl-close="lead">Cancelar</button><button class="pl-button pl-primary" type="submit">Guardar lead</button></div></form></div></div>
        <div class="pl-overlay" id="pl-detail-dialog" hidden><div class="pl-modal" role="dialog" aria-modal="true" aria-labelledby="pl-detail-title"><div class="pl-modal-head"><h2 id="pl-detail-title">Detalle del lead</h2><button class="pl-close" type="button" data-pl-close="detail" aria-label="Cerrar">×</button></div><div class="pl-form" id="pl-detail-content"></div></div></div>
        <div class="pl-overlay" id="pl-task-dialog" hidden><div class="pl-modal" role="dialog" aria-modal="true" aria-labelledby="pl-task-dialog-title"><div class="pl-modal-head"><h2 id="pl-task-dialog-title">Nueva tarea</h2><button class="pl-close" type="button" data-pl-close="task" aria-label="Cerrar">×</button></div><form class="pl-form" id="pl-task-form"><input id="pl-task-id" type="hidden"><label class="pl-field">Tarea<input class="pl-input" id="pl-task-title" required maxlength="160"></label><div class="pl-grid"><label class="pl-field">Categoría<select class="pl-select" id="pl-task-category"><option value="BUSINESS">Negocio</option><option value="MEETING">Reunión</option><option value="PERSONAL">Personal</option><option value="OPERATIONS">Operaciones</option></select></label><label class="pl-field">Estado<select class="pl-select" id="pl-task-status"><option value="TODO">Por hacer</option><option value="IN_PROGRESS">En proceso</option><option value="DONE">Terminado</option></select></label><label class="pl-field">Vencimiento<input class="pl-input" id="pl-task-due" type="datetime-local"></label><label class="pl-field">Responsable<select class="pl-select" id="pl-task-assignee"><option value="">Sin asignar</option></select></label><label class="pl-field">Lead<select class="pl-select" id="pl-task-lead"><option value="">Sin vincular</option></select></label></div><label class="pl-field">Notas<textarea class="pl-textarea" id="pl-task-notes" rows="3" maxlength="4000"></textarea></label><p class="pl-feedback" id="pl-task-feedback"></p><div class="pl-modal-actions"><button class="pl-button pl-danger" id="pl-task-archive" type="button" hidden>Archivar</button><button class="pl-button" type="button" data-pl-close="task">Cancelar</button><button class="pl-button pl-primary" type="submit">Guardar tarea</button></div></form></div></div>
        <div class="pl-overlay" id="pl-settings-dialog" hidden><div class="pl-modal" role="dialog" aria-modal="true" aria-labelledby="pl-settings-title"><div class="pl-modal-head"><h2 id="pl-settings-title">Configurar pipeline</h2><button class="pl-close" type="button" data-pl-close="settings" aria-label="Cerrar">×</button></div><form class="pl-form" id="pl-pipeline-form"><label class="pl-field">Nombre del pipeline<input class="pl-input" id="pl-pipeline-name-input" required maxlength="100"></label><button class="pl-button pl-primary" type="submit">Guardar nombre</button></form><div class="pl-form"><div class="pl-stage-list" id="pl-stage-list"></div><form class="pl-stage-row" id="pl-stage-create-form"><input class="pl-input" id="pl-new-stage-color" type="color" value="#0EA5E9" aria-label="Color"><input class="pl-input" id="pl-new-stage-name" required maxlength="80" placeholder="Nueva etapa"><button class="pl-button" type="submit">Agregar</button></form><p class="pl-feedback" id="pl-settings-feedback"></p></div></div></div>
        <div class="pl-overlay" id="pl-forms-dialog" hidden><div class="pl-modal" role="dialog" aria-modal="true" aria-labelledby="pl-forms-title"><div class="pl-modal-head"><h2 id="pl-forms-title">Formularios de entrada</h2><button class="pl-close" type="button" data-pl-close="forms" aria-label="Cerrar">×</button></div><p class="pl-subtitle">Cada página conserva su diseño; acá elegís las preguntas, etapa y beneficio.</p><div id="pl-forms-list" class="pl-stage-list"></div><form id="pl-form-editor" class="pl-form"><input id="pl-form-id" type="hidden"><label class="pl-field">Nombre interno<input class="pl-input" id="pl-form-name" maxlength="160" required></label><label class="pl-field">Clave pública (slug)<input class="pl-input" id="pl-form-slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="120" required></label><label class="pl-field">Etapa inicial<select class="pl-select" id="pl-form-stage" required></select></label><label class="pl-field">Responsable inicial<select class="pl-select" id="pl-form-assignee"></select></label><label class="pl-field">Modo de beneficio<select class="pl-select" id="pl-form-reward-mode" required><option value="NONE">Sin beneficio</option><option value="BENEFIT">Con beneficio</option></select></label><p class="pl-feedback" id="pl-form-reward-help">Sin beneficio: el envío crea el lead sin entregar un regalo.</p><label class="pl-field">Título de éxito<input class="pl-input" id="pl-form-success-title" maxlength="160"></label><label class="pl-field">Mensaje de éxito<textarea class="pl-textarea" id="pl-form-success-message" maxlength="1000"></textarea></label><h3>Preguntas</h3><div id="pl-form-field-rows" class="pl-stage-list"></div><button class="pl-button" id="pl-form-add-field" type="button">＋ Agregar pregunta</button><div class="pl-modal-actions"><button class="pl-button pl-primary" type="submit">Guardar borrador</button><button class="pl-button" id="pl-form-publish" type="button" hidden>Publicar</button><button class="pl-button pl-danger" id="pl-form-disable" type="button" hidden>Deshabilitar</button></div></form><form id="pl-form-reward-form" class="pl-form" hidden><h3>Beneficio</h3><label class="pl-field">Tipo<select class="pl-select" id="pl-form-reward-type"><option value="LINK">Enlace HTTPS</option><option value="DISCOUNT">Descuento</option><option value="TEXT">Texto</option></select></label><label class="pl-field">Nombre<input class="pl-input" id="pl-form-reward-name" maxlength="160" required></label><label class="pl-field">Valor (no se mostrará al público hasta enviar)<input class="pl-input" id="pl-form-reward-value" required></label><button class="pl-button" type="submit">Configurar beneficio</button></form><p class="pl-feedback" id="pl-forms-feedback" role="status" aria-live="polite"></p></div></div>
        <div class="pl-toast" id="pl-toast" role="status" aria-live="polite" hidden></div>
      </div>
    </section>
`

export const pipelineScript = String.raw`
    const plState = {
      pipeline: null,
      revision: '0',
      leads: [],
      won: [],
      noResponse: [],
      lost: [],
      metrics: {
        open: { count: 0, estimatedValue: 0, groups: [] },
        won: { count: 0, estimatedValue: 0, groups: [] },
        noResponse: { count: 0, estimatedValue: 0, groups: [] },
        lost: { count: 0, estimatedValue: 0, groups: [] }
      },
      tasks: [],
      responsibles: [],
      timezone: 'America/Argentina/Buenos_Aires',
      activeTab: 'leads',
      taskFilter: '',
      loadedBusinessId: null,
      draggedLeadId: null,
      draggedTaskId: null
    }

    const plEl = (id) => document.getElementById(id)
    const plShell = plEl('pipeline-shell')

    function plOptions(items, selected, emptyLabel) {
      const first = emptyLabel === null ? '' : '<option value="">' + escapeHtml(emptyLabel || '') + '</option>'
      return first + items.map((item) =>
        '<option value="' + escapeHtml(item.id) + '"' + (item.id === selected ? ' selected' : '') + '>' +
          escapeHtml(item.name || item.title || item.id) + '</option>'
      ).join('')
    }

    function plMoney(value) {
      return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(value || 0))
    }

    function plDate(value) {
      if (!value) return 'Sin fecha'
      return new Intl.DateTimeFormat('es-AR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: plState.timezone
      }).format(new Date(value))
    }

    function plLocalDateTimeValue(value) {
      if (!value) return ''
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: plState.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(new Date(value)).map((part) => [part.type, part.value]))
      return parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute
    }

    function plLocalDateTimeToIso(value) {
      if (!value) return null
      const desired = Date.parse(value + ':00Z')
      let guess = desired
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const rendered = plLocalDateTimeValue(new Date(guess))
        guess += desired - Date.parse(rendered + ':00Z')
      }
      return new Date(guess).toISOString()
    }

    function plToast(message, type) {
      const toast = plEl('pl-toast')
      toast.textContent = message
      toast.className = 'pl-toast' + (type === 'error' ? ' pl-error' : '')
      toast.hidden = false
      clearTimeout(plToast.timer)
      plToast.timer = setTimeout(() => { toast.hidden = true }, 3600)
    }

    function plSetFeedback(message, error) {
      const feedback = plEl('pl-feedback')
      feedback.textContent = message || ''
      feedback.className = 'pl-feedback' + (error ? ' pl-error' : '')
    }

    async function plRequest(path, options) {
      if (!state.businessId) throw new Error('Seleccioná un negocio para abrir Pipeline.')
      const method = options?.method || 'GET'
      if (method === 'GET') {
        const separator = path.includes('?') ? '&' : '?'
        return getJson(path + separator + 'businessId=' + encodeURIComponent(state.businessId), options)
      }
      const body = { ...(options?.body || {}), businessId: state.businessId }
      return getJson(path, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options?.headers || {}) },
        body: JSON.stringify(body)
      })
    }

    function plCaptureOpenForm() {
      const form = plShell.querySelector('.pl-overlay:not([hidden]) form')
      if (!form) return null
      return {
        formId: form.id,
        values: Array.from(form.querySelectorAll('input,select,textarea')).reduce((values, field) => {
          if (field.id) values[field.id] = field.value
          return values
        }, {})
      }
    }

    function plRestoreOpenForm(snapshot) {
      if (!snapshot) return
      const form = plEl(snapshot.formId)
      if (!form) return
      Object.entries(snapshot.values).forEach(([id, value]) => {
        const field = plEl(id)
        if (field && form.contains(field)) field.value = value
      })
    }

    async function plMutate(path, method, body) {
      const formSnapshot = plCaptureOpenForm()
      try {
        const result = await plRequest(path, { method, body })
        if (result?.revision !== undefined) plState.revision = String(result.revision)
        return result
      } catch (error) {
        if (error.body?.code === 'PIPELINE_REVISION_CONFLICT') {
          await plLoadAll(true)
          plRestoreOpenForm(formSnapshot)
          plToast('El pipeline cambió en otra sesión. Actualizamos la información para evitar sobrescribirla.', 'error')
        }
        throw error
      }
    }

    async function plLoadAll(force) {
      if (!state.businessId || state.business?.featureSettings?.pipelineEnabled !== true) return
      if (!force && plState.loadedBusinessId === state.businessId && plState.pipeline) return
      plState.loadedBusinessId = state.businessId
      plSetFeedback('Cargando información...', false)
      plEl('pl-board').setAttribute('aria-busy', 'true')
      plEl('pl-board').innerHTML = '<div class="pl-loading">Cargando pipeline...</div>'
      try {
        const search = plEl('pl-search').value.trim()
        const priority = plEl('pl-priority-filter').value
        const assignee = plEl('pl-assignee-filter').value
        const leadParams = new URLSearchParams({ lifecycle: 'OPEN' })
        if (search) leadParams.set('search', search)
        if (priority) leadParams.set('priority', priority)
        if (assignee) leadParams.set('assigneeUserId', assignee)
        const [pipeline, open, won, noResponse, lost, tasks, responsibles] = await Promise.all([
          plRequest('/pipeline'),
          plRequest('/pipeline/leads?' + leadParams.toString()),
          plRequest('/pipeline/leads?lifecycle=WON'),
          plRequest('/pipeline/leads?lifecycle=NO_RESPONSE'),
          plRequest('/pipeline/leads?lifecycle=LOST'),
          plRequest('/pipeline/tasks'),
          plRequest('/pipeline/responsibles')
        ])
        plState.pipeline = pipeline
        plState.revision = String(open.revision ?? pipeline.revision ?? '0')
        plState.leads = open.items || []
        plState.won = won.items || []
        plState.noResponse = noResponse.items || []
        plState.lost = lost.items || []
        plState.metrics = {
          open: open.metrics || { count: plState.leads.length, estimatedValue: 0, groups: [] },
          won: won.metrics || { count: plState.won.length, estimatedValue: 0, groups: [] },
          noResponse: noResponse.metrics || { count: plState.noResponse.length, estimatedValue: 0, groups: [] },
          lost: lost.metrics || { count: plState.lost.length, estimatedValue: 0, groups: [] }
        }
        plState.tasks = tasks.items || []
        plState.responsibles = responsibles || []
        plState.timezone = tasks.timezone || state.business?.timezone || plState.timezone
        plRender()
        plEl('pl-board').setAttribute('aria-busy', 'false')
        plSetFeedback('', false)
      } catch (error) {
        plEl('pl-board').setAttribute('aria-busy', 'false')
        plSetFeedback(error.message, true)
        plEl('pl-board').innerHTML = '<div class="pl-empty" role="alert"><span>No pudimos cargar el pipeline.</span><button class="pl-button" type="button" data-pl-retry>Reintentar</button></div>'
      }
    }

    function plRender() {
      plEl('pl-pipeline-name').textContent = plState.pipeline?.name || 'Pipeline de leads'
      plEl('pl-leads-count').textContent = String(plState.metrics.open.count + plState.metrics.won.count + plState.metrics.noResponse.count + plState.metrics.lost.count)
      plEl('pl-tasks-count').textContent = String(plState.tasks.filter((task) => task.status !== 'DONE').length)
      plRenderFilters()
      plRenderStats()
      plRenderBoard()
      plRenderOutcomes()
      plRenderTasks()
    }

    function plRenderFilters() {
      const selectedAssignee = plEl('pl-assignee-filter').value
      plEl('pl-assignee-filter').innerHTML = plOptions(plState.responsibles, selectedAssignee, 'Todos los responsables')
      plEl('pl-lead-assignee').innerHTML = plOptions(plState.responsibles, plEl('pl-lead-assignee').value, 'Sin asignar')
      plEl('pl-task-assignee').innerHTML = plOptions(plState.responsibles, plEl('pl-task-assignee').value, 'Sin asignar')
      plEl('pl-task-lead').innerHTML = plOptions(plState.leads, plEl('pl-task-lead').value, 'Sin vincular')
      plEl('pl-lead-stage').innerHTML = plOptions(plState.pipeline?.stages || [], plEl('pl-lead-stage').value, null)
    }

    function plRenderStats() {
      const openValue = plState.metrics.open.estimatedValue
      const wonValue = plState.metrics.won.estimatedValue
      plEl('pl-stats').innerHTML =
        '<div class="pl-stat"><strong>' + plState.metrics.open.count + '</strong><span>Abiertos</span></div>' +
        '<div class="pl-stat"><strong>' + plMoney(openValue) + '</strong><span>En pipeline</span></div>' +
        '<div class="pl-stat"><strong>' + plState.metrics.won.count + '</strong><span>Ganados</span></div>' +
        '<div class="pl-stat"><strong>' + plMoney(wonValue) + '</strong><span>Valor ganado</span></div>'
    }

    function plLeadCard(lead) {
      const contact = lead.contactName || lead.companyName || lead.email || lead.phone || 'Sin contacto'
      const stageOptions = (plState.pipeline?.stages || []).map((stage) => '<option value="' + escapeHtml(stage.id) + '"' + (stage.id === lead.stageId ? ' selected' : '') + '>' + escapeHtml(stage.name) + '</option>').join('')
      const priority = lead.priority === 'HIGH' ? 'Alta' : lead.priority === 'LOW' ? 'Baja' : 'Media'
      return '<article class="pl-card" draggable="true" tabindex="0" data-pl-lead-id="' + escapeHtml(lead.id) + '">' +
        '<h4 class="pl-card-title">' + escapeHtml(lead.title) + '</h4><div class="pl-card-contact">' + escapeHtml(contact) + '</div>' +
        '<div class="pl-card-meta"><strong>' + plMoney(lead.estimatedValue) + '</strong><span class="pl-priority' + (lead.priority === 'HIGH' ? ' pl-high' : '') + '">' + priority + '</span></div>' +
        '<div class="pl-card-meta"><span>● ' + escapeHtml(lead.source || 'Manual') + '</span><span>' + escapeHtml(plDate(lead.updatedAt || lead.createdAt)) + '</span></div>' +
        '<div class="pl-card-actions"><select class="pl-select" data-pl-move-stage aria-label="Mover ' + escapeHtml(lead.title) + ' a otra etapa">' + stageOptions + '</select><select class="pl-select" data-pl-change-outcome aria-label="Cambiar estado de ' + escapeHtml(lead.title) + '"><option value="">Resolver...</option><option value="WON">Ganado</option><option value="NO_RESPONSE">Sin respuesta</option><option value="LOST">Perdido</option></select></div></article>'
    }

    function plRenderBoard() {
      const stages = plState.pipeline?.stages || []
      if (!stages.length) { plEl('pl-board').innerHTML = '<div class="pl-empty">Todavía no hay etapas activas.</div>'; return }
      const stageColumns = stages.map((stage) => {
        const leads = plState.leads.filter((lead) => lead.stageId === stage.id)
        const group = (plState.metrics.open.groups || []).find((item) => item.stageId === stage.id)
        const count = group?._count?._all ?? leads.length
        const value = group?._sum?.estimatedValue ?? leads.reduce((sum, lead) => sum + Number(lead.estimatedValue || 0), 0)
        return '<section class="pl-column" data-pl-stage-id="' + escapeHtml(stage.id) + '" style="--pl-stage-color:' + escapeHtml(stage.color) + '"><header class="pl-column-head"><div><h3>' + escapeHtml(stage.name) + ' <span class="pl-badge">' + count + '</span></h3><span class="pl-column-copy">' + plMoney(value) + '</span></div><button class="pl-button pl-icon-button" type="button" data-pl-add-stage="' + escapeHtml(stage.id) + '" aria-label="Agregar lead">＋</button></header><div class="pl-cards">' + (leads.length ? leads.map(plLeadCard).join('') : '<div class="pl-empty"><strong>No hay leads en esta fase</strong><span>Arrastrá una tarjeta acá o agregá un nuevo lead.</span></div>') + '</div></section>'
      }).join('')
      const terminal = '<section class="pl-column pl-terminal-column"><header class="pl-column-head" style="--pl-stage-color:#8B5CF6"><div><h3>Resolución <span class="pl-badge">' + (plState.metrics.won.count + plState.metrics.noResponse.count) + '</span></h3><span class="pl-column-copy">' + plMoney(plState.metrics.won.estimatedValue + plState.metrics.noResponse.estimatedValue) + '</span></div></header><div class="pl-terminal-zone pl-won-zone" data-pl-terminal="WON"><strong>● Cerrado / Ganado</strong><span>Arrastrá acá los leads ganados.</span></div><div class="pl-terminal-zone pl-cold-zone" data-pl-terminal="NO_RESPONSE"><strong>❄ Sin respuesta</strong><span>Arrastrá acá los leads fríos.</span></div></section>'
      plEl('pl-board').innerHTML = stageColumns + terminal
    }

    function plOutcomeRows(items) {
      return items.length ? items.map((lead) =>
        '<div class="pl-outcome-row" tabindex="0" data-pl-lead-id="' + escapeHtml(lead.id) + '"><strong>' + escapeHtml(lead.title) + '</strong><span>' + plMoney(lead.estimatedValue) + '</span></div>'
      ).join('') : '<div class="pl-empty">Sin leads</div>'
    }

    function plRenderOutcomes() {
      plEl('pl-won').innerHTML = plOutcomeRows(plState.won)
      plEl('pl-no-response').innerHTML = plOutcomeRows(plState.noResponse)
      plEl('pl-lost').innerHTML = plOutcomeRows(plState.lost)
      plEl('pl-won-count').textContent = String(plState.metrics.won.count)
      plEl('pl-no-response-count').textContent = String(plState.metrics.noResponse.count)
      plEl('pl-lost-count').textContent = String(plState.metrics.lost.count)
    }

    function plRenderTasks() {
      const visible = plState.taskFilter ? plState.tasks.filter((task) => task.category === plState.taskFilter) : plState.tasks
      const statuses = [{ id:'TODO', label:'Por hacer', color:'#0EA5E9' }, { id:'IN_PROGRESS', label:'En proceso', color:'#F59E0B' }, { id:'DONE', label:'Terminado', color:'#10B981' }]
      plEl('pl-task-board').innerHTML = statuses.map((status) => {
        const tasks = visible.filter((task) => task.status === status.id)
        return '<section class="pl-task-column" data-pl-task-status="' + status.id + '" style="--pl-task-color:' + status.color + '"><h3>' + status.label + ' <span class="pl-badge">' + tasks.length + '</span></h3><div class="pl-task-column-list">' + (tasks.length ? tasks.map((task) => '<article class="pl-task-card" draggable="true" tabindex="0" data-pl-task-id="' + escapeHtml(task.id) + '"><strong>' + escapeHtml(task.title) + '</strong><span>' + escapeHtml(task.category) + ' · ' + escapeHtml(plDate(task.dueAt)) + '</span>' + (task.notes ? '<div class="pl-note">' + escapeHtml(task.notes) + '</div>' : '') + '<select class="pl-select" data-pl-move-task-status aria-label="Cambiar estado de ' + escapeHtml(task.title) + '"><option value="TODO"' + (task.status === 'TODO' ? ' selected' : '') + '>Por hacer</option><option value="IN_PROGRESS"' + (task.status === 'IN_PROGRESS' ? ' selected' : '') + '>En proceso</option><option value="DONE"' + (task.status === 'DONE' ? ' selected' : '') + '>Terminado</option></select></article>').join('') : '<div class="pl-empty">Sin tareas</div>') + '</div></section>'
      }).join('')
      const done = plState.tasks.filter((task) => task.status === 'DONE').length
      const total = plState.tasks.length
      plEl('pl-task-progress').style.width = (total ? Math.round(done * 100 / total) : 0) + '%'
      plEl('pl-task-progress-copy').textContent = done + ' de ' + total + ' (' + (total ? Math.round(done * 100 / total) : 0) + '%)'
    }

    function plSwitchTab(tab) {
      plState.activeTab = tab
      const leads = tab === 'leads'
      plEl('pl-leads-pane').hidden = !leads
      plEl('pl-tasks-pane').hidden = leads
      plEl('pl-tab-leads').classList.toggle('pl-active', leads)
      plEl('pl-tab-tasks').classList.toggle('pl-active', !leads)
      plEl('pl-tab-leads').setAttribute('aria-selected', String(leads))
      plEl('pl-tab-tasks').setAttribute('aria-selected', String(!leads))
      plEl('pl-new-lead').hidden = !leads
      plEl('pl-new-task').hidden = leads
    }

    function plOpenLead(lead, stageId) {
      plEl('pl-lead-form').reset()
      plEl('pl-lead-id').value = lead?.id || ''
      plEl('pl-lead-dialog-title').textContent = lead ? 'Editar lead' : 'Nuevo lead'
      plEl('pl-lead-title').value = lead?.title || ''
      plEl('pl-lead-contact').value = lead?.contactName || ''
      plEl('pl-lead-company').value = lead?.companyName || ''
      plEl('pl-lead-email').value = lead?.email || ''
      plEl('pl-lead-phone').value = lead?.phone || ''
      plEl('pl-lead-value').value = String(lead?.estimatedValue || 0)
      plEl('pl-lead-priority').value = lead?.priority || 'MEDIUM'
      plEl('pl-lead-stage').innerHTML = plOptions(plState.pipeline?.stages || [], lead?.stageId || stageId, null)
      plEl('pl-lead-assignee').innerHTML = plOptions(plState.responsibles, lead?.assigneeUserId || '', 'Sin asignar')
      plEl('pl-lead-source').value = lead?.source || ''
      plEl('pl-lead-feedback').textContent = ''
      plEl('pl-lead-dialog').hidden = false
      plEl('pl-lead-title').focus()
    }

    async function plSaveLead(event) {
      event.preventDefault()
      const id = plEl('pl-lead-id').value
      const payload = {
        title: plEl('pl-lead-title').value,
        contactName: plEl('pl-lead-contact').value,
        companyName: plEl('pl-lead-company').value,
        email: plEl('pl-lead-email').value,
        phone: plEl('pl-lead-phone').value,
        estimatedValue: Number(plEl('pl-lead-value').value || 0),
        priority: plEl('pl-lead-priority').value,
        stageId: plEl('pl-lead-stage').value,
        assigneeUserId: plEl('pl-lead-assignee').value || null,
        source: plEl('pl-lead-source').value
      }
      const feedback = plEl('pl-lead-feedback')
      try {
        if (id) {
          const { stageId, assigneeUserId, ...changes } = payload
          await plMutate('/pipeline/leads/' + encodeURIComponent(id), 'PATCH', changes)
          const previous = plState.leads.find((lead) => lead.id === id)
          if ((previous?.assigneeUserId || '') !== (assigneeUserId || '')) {
            await plMutate('/pipeline/leads/' + encodeURIComponent(id) + '/assign', 'POST', { assigneeUserId })
          }
          if (previous?.stageId !== stageId) {
            await plMutate('/pipeline/leads/' + encodeURIComponent(id) + '/transition', 'POST', { stageId, expectedRevision: plState.revision })
          }
        } else {
          await plMutate('/pipeline/leads', 'POST', payload)
        }
        plEl('pl-lead-dialog').hidden = true
        await plLoadAll(true)
        plToast(id ? 'Lead actualizado.' : 'Lead creado.')
      } catch (error) {
        feedback.textContent = error.message
        feedback.className = 'pl-feedback pl-error'
      }
    }

    async function plOpenDetail(id) {
      plEl('pl-detail-dialog').hidden = false
      plEl('pl-detail-content').innerHTML = '<div class="pl-loading">Cargando detalle...</div>'
      try {
        const lead = await plRequest('/pipeline/leads/' + encodeURIComponent(id))
        const lifecycleButtons = lead.lifecycle === 'OPEN'
          ? '<button class="pl-button pl-primary" type="button" data-pl-outcome="WON">Ganado</button><button class="pl-button" type="button" data-pl-outcome="NO_RESPONSE">Sin respuesta</button><button class="pl-button pl-danger" type="button" data-pl-outcome="LOST">Perdido</button>'
          : '<button class="pl-button" type="button" data-pl-outcome="OPEN">Reabrir</button>'
        const formAnswers = (lead.formAnswers || []).map((answer) =>
          '<div class="pl-form-answer"><span class="pl-form-answer-label">' + escapeHtml(answer.label) + '</span><div class="pl-form-answer-value">' + escapeHtml(answer.value) + '</div></div>'
        ).join('')
        const formAnswersSection = formAnswers
          ? '<h3 class="pl-card-title">Respuestas del formulario</h3><div class="pl-form-answers">' + formAnswers + '</div>'
          : ''
        plEl('pl-detail-title').textContent = lead.title
        plEl('pl-detail-content').innerHTML =
          '<div class="pl-card-contact">' + escapeHtml(lead.contactName || lead.companyName || lead.email || lead.phone || 'Sin contacto') + '</div>' +
          '<div class="pl-stats"><div class="pl-stat"><strong>' + plMoney(lead.estimatedValue) + '</strong><span>Valor</span></div><div class="pl-stat"><strong>' + escapeHtml(lead.lifecycle) + '</strong><span>Estado</span></div></div>' +
          '<div class="pl-actions">' + lifecycleButtons + '<button class="pl-button" type="button" data-pl-edit-lead="' + escapeHtml(lead.id) + '">Editar</button><button class="pl-button pl-danger" type="button" data-pl-archive-lead="' + escapeHtml(lead.id) + '">Archivar</button></div>' +
          formAnswersSection +
          '<h3 class="pl-card-title">Notas y seguimientos</h3><div class="pl-note-list">' +
            ((lead.activities || []).length ? lead.activities.map((activity) => '<div class="pl-note">' + escapeHtml(activity.body) + '<br>' + escapeHtml(plDate(activity.occurredAt)) + '</div>').join('') : '<div class="pl-empty">Sin actividad registrada</div>') +
          '</div><form class="pl-form" id="pl-note-form"><textarea class="pl-textarea" id="pl-note-body" rows="3" required maxlength="4000" placeholder="Registrar una nota o seguimiento..."></textarea><div class="pl-modal-actions"><button class="pl-button pl-primary" type="submit">Agregar nota</button></div></form>'
        plEl('pl-detail-content').dataset.plLeadId = lead.id
      } catch (error) {
        plEl('pl-detail-content').innerHTML = '<div class="pl-empty">' + escapeHtml(error.message) + '</div>'
      }
    }

    function plOpenTask(task) {
      plEl('pl-task-form').reset()
      plEl('pl-task-id').value = task?.id || ''
      plEl('pl-task-dialog-title').textContent = task ? 'Editar tarea' : 'Nueva tarea'
      plEl('pl-task-title').value = task?.title || ''
      plEl('pl-task-category').value = task?.category || 'BUSINESS'
      plEl('pl-task-status').value = task?.status || 'TODO'
      plEl('pl-task-due').value = plLocalDateTimeValue(task?.dueAt)
      plEl('pl-task-assignee').innerHTML = plOptions(plState.responsibles, task?.assigneeUserId || '', 'Sin asignar')
      plEl('pl-task-lead').innerHTML = plOptions(plState.leads, task?.leadId || '', 'Sin vincular')
      plEl('pl-task-notes').value = task?.notes || ''
      plEl('pl-task-archive').hidden = !task
      plEl('pl-task-feedback').textContent = ''
      plEl('pl-task-dialog').hidden = false
      plEl('pl-task-title').focus()
    }

    async function plSaveTask(event) {
      event.preventDefault()
      const id = plEl('pl-task-id').value
      const due = plEl('pl-task-due').value
      const payload = {
        title: plEl('pl-task-title').value,
        category: plEl('pl-task-category').value,
        status: plEl('pl-task-status').value,
        dueAt: plLocalDateTimeToIso(due),
        assigneeUserId: plEl('pl-task-assignee').value || null,
        leadId: plEl('pl-task-lead').value || null,
        notes: plEl('pl-task-notes').value
      }
      try {
        if (id) await plMutate('/pipeline/tasks/' + encodeURIComponent(id), 'PATCH', { ...payload, expectedRevision: plState.revision })
        else await plMutate('/pipeline/tasks', 'POST', payload)
        plEl('pl-task-dialog').hidden = true
        await plLoadAll(true)
        plToast(id ? 'Tarea actualizada.' : 'Tarea creada.')
      } catch (error) {
        plEl('pl-task-feedback').textContent = error.message
        plEl('pl-task-feedback').className = 'pl-feedback pl-error'
      }
    }

    async function plQuickAddTask(event) {
      event.preventDefault()
      const title = plEl('pl-task-quick-title').value.trim()
      if (!title) return
      try {
        await plMutate('/pipeline/tasks', 'POST', { title, category: plEl('pl-task-quick-category').value, status: plEl('pl-task-quick-status').value, dueAt: null, assigneeUserId: null, leadId: null, notes: '' })
        plEl('pl-task-quick-title').value = ''
        await plLoadAll(true)
        plToast('Tarea creada.')
      } catch (error) { plToast(error.message, 'error') }
    }

    function plOpenSettings() {
      plEl('pl-pipeline-name-input').value = plState.pipeline?.name || ''
      plRenderStages()
      plEl('pl-settings-dialog').hidden = false
    }

    function plRenderStages() {
      const stages = plState.pipeline?.stages || []
      plEl('pl-stage-list').innerHTML = stages.map((stage, index) =>
        '<div class="pl-stage-row" data-pl-stage-row="' + escapeHtml(stage.id) + '">' +
          '<input class="pl-input" type="color" value="' + escapeHtml(stage.color) + '" data-pl-stage-color aria-label="Color">' +
          '<input class="pl-input" value="' + escapeHtml(stage.name) + '" maxlength="80" data-pl-stage-name aria-label="Nombre de etapa">' +
          '<div class="pl-stage-actions"><button class="pl-button" type="button" data-pl-stage-save>Guardar</button><button class="pl-button" type="button" data-pl-stage-up' + (index === 0 ? ' disabled' : '') + '>↑</button><button class="pl-button" type="button" data-pl-stage-down' + (index === stages.length - 1 ? ' disabled' : '') + '>↓</button><button class="pl-button pl-danger" type="button" data-pl-stage-archive>×</button></div>' +
        '</div>'
      ).join('')
    }

    async function plMoveLead(id, stageId) {
      const lead = plState.leads.find((item) => item.id === id)
      if (!lead || lead.stageId === stageId) return
      const snapshot = plState.leads.map((item) => ({ ...item }))
      lead.stageId = stageId
      plRenderBoard()
      try {
        await plMutate('/pipeline/leads/' + encodeURIComponent(id) + '/transition', 'POST', { stageId, expectedRevision: plState.revision })
        await plLoadAll(true)
      } catch (error) {
        plRollbackLeadMove(snapshot)
        plToast(error.message, 'error')
      }
    }

    function plRollbackLeadMove(snapshot) {
      plState.leads = snapshot
      plRenderBoard()
    }

    async function plChangeOutcome(id, lifecycle) {
      const snapshot = plState.leads.map((item) => ({ ...item }))
      plState.leads = plState.leads.filter((item) => item.id !== id)
      plRenderBoard()
      try {
        await plMutate('/pipeline/leads/' + encodeURIComponent(id) + '/transition', 'POST', { lifecycle, expectedRevision: plState.revision })
        await plLoadAll(true)
      } catch (error) {
        plRollbackLeadMove(snapshot)
        plToast(error.message, 'error')
      }
    }

    async function plMoveTask(id, status) {
      const task = plState.tasks.find((item) => item.id === id)
      if (!task) return
      const snapshot = plState.tasks.map((item) => ({ ...item }))
      const previousStatus = task.status
      task.status = status
      plRenderTasks()
      try {
        if (previousStatus === status) {
          const taskIds = plState.tasks.filter((item) => item.status === status && item.id !== id).map((item) => item.id)
          taskIds.push(id)
          await plMutate('/pipeline/tasks/reorder', 'POST', { status, taskIds, expectedRevision: plState.revision })
        } else {
          await plMutate('/pipeline/tasks/' + encodeURIComponent(id), 'PATCH', { status, expectedRevision: plState.revision })
        }
        await plLoadAll(true)
      } catch (error) {
        plRollbackTaskMove(snapshot)
        plToast(error.message, 'error')
      }
    }

    function plRollbackTaskMove(snapshot) {
      plState.tasks = snapshot
      plRenderTasks()
    }

    let plForms = []
    const plFormTargets = ['NONE','TITLE','CONTACT_NAME','COMPANY_NAME','EMAIL','PHONE','ESTIMATED_VALUE','PRIORITY','SOURCE','EXTERNAL_REFERENCE','CUSTOM_DATA']
    function plFormRow(field) {
      const row = document.createElement('div')
      row.className = 'pl-stage-row pl-form-field-row'
      row.innerHTML = '<input class="pl-input" data-pl-field="key" placeholder="clave_interna" pattern="[a-z][a-z0-9_]*" maxlength="64" required value="' + escapeHtml(field?.key || '') + '">' +
        '<input class="pl-input" data-pl-field="label" placeholder="Pregunta" maxlength="160" required value="' + escapeHtml(field?.label || '') + '">' +
        '<select class="pl-select" data-pl-field="type">' + ['TEXT','TEXTAREA','EMAIL','PHONE','NUMBER','SELECT','RADIO','CHECKBOX'].map(type => '<option value="' + type + '"' + (type === (field?.type || 'TEXT') ? ' selected' : '') + '>' + type + '</option>').join('') + '</select>' +
        '<label><input type="checkbox" data-pl-field="required"' + (field?.required ? ' checked' : '') + '> Obligatoria</label>' +
        '<select class="pl-select" data-pl-field="mapping">' + plFormTargets.map(target => '<option value="' + target + '"' + (target === (field?.mapping?.target || 'NONE') ? ' selected' : '') + '>' + target + '</option>').join('') + '</select>' +
        '<input class="pl-input" data-pl-field="customKey" placeholder="clave extra" value="' + escapeHtml(field?.mapping?.customKey || '') + '">' +
        '<input class="pl-input" data-pl-field="options" placeholder="Opciones: valor=Etiqueta, ..." value="' + escapeHtml((field?.options || []).map(option => option.value + '=' + option.label).join(', ')) + '">' +
        '<button class="pl-button" type="button" data-pl-field-up aria-label="Subir">↑</button><button class="pl-button" type="button" data-pl-field-down aria-label="Bajar">↓</button><button class="pl-button pl-danger" type="button" data-pl-field-remove aria-label="Eliminar pregunta">×</button>'
      plEl('pl-form-field-rows').append(row)
    }
    function plFormFields() {
      return Array.from(plEl('pl-form-field-rows').children).map((row, order) => {
        const value = key => row.querySelector('[data-pl-field="' + key + '"]').value.trim()
        const type = value('type'), target = value('mapping')
        const field = { key: value('key'), label: value('label'), type, required: row.querySelector('[data-pl-field="required"]').checked, order }
        if (target !== 'NONE') field.mapping = target === 'CUSTOM_DATA' ? { target, customKey: value('customKey') } : { target }
        if (type === 'SELECT' || type === 'RADIO') field.options = value('options').split(',').map(part => {
          const [rawValue, ...labels] = part.trim().split('=')
          return { value: rawValue?.trim() || '', label: labels.join('=').trim() || rawValue?.trim() || '' }
        })
        return field
      })
    }
    function plRenderFormsList() {
      plEl('pl-forms-list').innerHTML = plForms.map(form => '<button class="pl-button" type="button" data-pl-open-form="' + escapeHtml(form.id) + '">' + escapeHtml(form.name) + ' · ' + escapeHtml(form.status) + ' · v' + escapeHtml(String(form.version)) + '</button>').join('') || '<p>No hay formularios configurados.</p>'
    }
    async function plLoadForms() {
      plForms = await plRequest('/pipeline/forms')
      plRenderFormsList()
    }
    function plEditForm(form) {
      plEl('pl-form-editor').reset()
      plEl('pl-form-id').value = form?.id || ''
      plEl('pl-form-name').value = form?.name || ''
      plEl('pl-form-slug').value = form?.publicSlug || ''
      plEl('pl-form-slug').disabled = Boolean(form)
      plEl('pl-form-stage').innerHTML = plOptions(plState.pipeline?.stages || [], form?.initialStageId || '', null)
      plEl('pl-form-assignee').innerHTML = plOptions(plState.responsibles, form?.defaultAssigneeUserId || '', 'Sin asignar')
      plEl('pl-form-success-title').value = form?.successTitle || ''
      plEl('pl-form-success-message').value = form?.successMessage || ''
      plEl('pl-form-reward-mode').value = form?.rewardMode || 'NONE'
      plEl('pl-form-field-rows').replaceChildren()
      for (const field of form?.fields || []) plFormRow(field)
      if (!form) plFormRow({ key: 'nombre', label: 'Nombre', type: 'TEXT', required: true, mapping: { target: 'CONTACT_NAME' } })
      plEl('pl-form-publish').hidden = !form || form.status !== 'DRAFT'
      plEl('pl-form-disable').hidden = !form || form.status === 'DISABLED'
      plSyncRewardMode()
      plEl('pl-form-editor').querySelector('button[type="submit"]').hidden = Boolean(form && form.status === 'DISABLED')
      plEl('pl-forms-feedback').textContent = ''
    }
    function plSyncRewardMode() {
      const benefit = plEl('pl-form-reward-mode').value === 'BENEFIT'
      const form = plForms.find(item => item.id === plEl('pl-form-id').value)
      plEl('pl-form-reward-form').hidden = !benefit || !form || form.status !== 'DRAFT'
      plEl('pl-form-reward-help').textContent = benefit
        ? 'Configurá un enlace, descuento o texto antes de publicar.'
        : 'Sin beneficio: el envío crea el lead sin entregar un regalo.'
    }
    plEl('pl-forms-open').addEventListener('click', async () => {
      plEl('pl-forms-dialog').hidden = false
      plEditForm(null)
      try { await plLoadForms() } catch (error) { plEl('pl-forms-feedback').textContent = error.message }
    })
    plEl('pl-form-add-field').addEventListener('click', () => plFormRow(null))
    plEl('pl-form-reward-mode').addEventListener('change', plSyncRewardMode)
    plEl('pl-forms-list').addEventListener('click', event => {
      const button = event.target.closest('[data-pl-open-form]')
      if (button) plEditForm(plForms.find(form => form.id === button.dataset.plOpenForm))
    })
    plEl('pl-form-field-rows').addEventListener('click', event => {
      const row = event.target.closest('.pl-form-field-row')
      if (!row) return
      if (event.target.closest('[data-pl-field-remove]')) row.remove()
      else if (event.target.closest('[data-pl-field-up]') && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling)
      else if (event.target.closest('[data-pl-field-down]') && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row)
    })
    plEl('pl-form-editor').addEventListener('submit', async event => {
      event.preventDefault()
      const id = plEl('pl-form-id').value
      const body = { name: plEl('pl-form-name').value, publicSlug: plEl('pl-form-slug').value, initialStageId: plEl('pl-form-stage').value,
        defaultAssigneeUserId: plEl('pl-form-assignee').value || null, successTitle: plEl('pl-form-success-title').value,
        successMessage: plEl('pl-form-success-message').value, rewardMode: plEl('pl-form-reward-mode').value, fields: plFormFields() }
      try {
        const result = await plRequest(id ? '/pipeline/forms/' + encodeURIComponent(id) : '/pipeline/forms', { method: id ? 'PATCH' : 'POST', body })
        await plLoadForms(); plEditForm(result)
        plEl('pl-forms-feedback').textContent = 'Borrador guardado. El beneficio se configura antes de publicar.'
      } catch (error) { plEl('pl-forms-feedback').textContent = error.message }
    })
    plEl('pl-form-reward-form').addEventListener('submit', async event => {
      event.preventDefault()
      try {
        await plRequest('/pipeline/forms/' + encodeURIComponent(plEl('pl-form-id').value) + '/reward', { method: 'POST', body: {
          type: plEl('pl-form-reward-type').value, name: plEl('pl-form-reward-name').value, value: plEl('pl-form-reward-value').value } })
        plEl('pl-form-reward-value').value = ''
        plEl('pl-forms-feedback').textContent = 'Beneficio protegido. Ya podés publicar cuando se habilite el módulo.'
      } catch (error) { plEl('pl-forms-feedback').textContent = error.message }
    })
    plEl('pl-form-publish').addEventListener('click', async () => {
      try { const form = await plRequest('/pipeline/forms/' + encodeURIComponent(plEl('pl-form-id').value) + '/publish', { method: 'POST', body: {} }); await plLoadForms(); plEditForm(form); plEl('pl-forms-feedback').textContent = 'Publicado. Usá ' + form.publicPath + ' en el dominio personalizado del negocio.' }
      catch (error) { plEl('pl-forms-feedback').textContent = error.message }
    })
    plEl('pl-form-disable').addEventListener('click', async () => {
      try { await plRequest('/pipeline/forms/' + encodeURIComponent(plEl('pl-form-id').value) + '/disable', { method: 'POST', body: {} }); await plLoadForms(); plEditForm(null); plEl('pl-forms-feedback').textContent = 'Formulario deshabilitado.' }
      catch (error) { plEl('pl-forms-feedback').textContent = error.message }
    })

    let plSearchTimer = null
    plEl('pl-tab-leads').addEventListener('click', () => plSwitchTab('leads'))
    plEl('pl-tab-tasks').addEventListener('click', () => plSwitchTab('tasks'))
    plEl('pl-refresh').addEventListener('click', () => plLoadAll(true))
    plEl('pl-new-lead').addEventListener('click', () => plOpenLead(null, plState.pipeline?.stages?.[0]?.id))
    plEl('pl-new-task').addEventListener('click', () => plOpenTask(null))
    plEl('pl-settings-open').addEventListener('click', plOpenSettings)
    plEl('pl-lead-form').addEventListener('submit', plSaveLead)
    plEl('pl-task-form').addEventListener('submit', plSaveTask)
    plEl('pl-task-quick-form').addEventListener('submit', plQuickAddTask)
    plEl('pl-task-archive').addEventListener('click', async () => {
      const id = plEl('pl-task-id').value
      if (!id) return
      try {
        await plMutate('/pipeline/tasks/' + encodeURIComponent(id), 'DELETE', {})
        plEl('pl-task-dialog').hidden = true
        await plLoadAll(true)
        plToast('Tarea archivada.')
      } catch (error) {
        plEl('pl-task-feedback').textContent = error.message
        plEl('pl-task-feedback').className = 'pl-feedback pl-error'
      }
    })
    plEl('pl-search').addEventListener('input', () => {
      clearTimeout(plSearchTimer)
      plSearchTimer = setTimeout(() => plLoadAll(true), 280)
    })
    plEl('pl-priority-filter').addEventListener('change', () => plLoadAll(true))
    plEl('pl-assignee-filter').addEventListener('change', () => plLoadAll(true))

    plShell.addEventListener('click', async (event) => {
      const retry = event.target.closest('[data-pl-retry]')
      if (retry) { await plLoadAll(true); return }
      const close = event.target.closest('[data-pl-close]')
      if (close) {
        const dialogs = { lead: 'pl-lead-dialog', detail: 'pl-detail-dialog', task: 'pl-task-dialog', settings: 'pl-settings-dialog', forms: 'pl-forms-dialog' }
        plEl(dialogs[close.dataset.plClose]).hidden = true
        return
      }
      const add = event.target.closest('[data-pl-add-stage]')
      if (add) { plOpenLead(null, add.dataset.plAddStage); return }
      const leadCard = event.target.closest('[data-pl-lead-id]')
      if (leadCard && !event.target.closest('button,input,select,textarea,a')) { await plOpenDetail(leadCard.dataset.plLeadId); return }
      const taskCard = event.target.closest('[data-pl-task-id]')
      if (taskCard && !event.target.closest('button,input,select,textarea,a')) { plOpenTask(plState.tasks.find((task) => task.id === taskCard.dataset.plTaskId)); return }
      const filter = event.target.closest('[data-pl-task-filter]')
      if (filter) {
        plState.taskFilter = filter.dataset.plTaskFilter
        plEl('pl-task-filters').querySelectorAll('[data-pl-task-filter]').forEach((button) => button.classList.toggle('pl-active', button === filter))
        plRenderTasks()
      }
    })

    plShell.addEventListener('change', (event) => {
      const leadCard = event.target.closest('[data-pl-lead-id]')
      if (leadCard && event.target.matches('[data-pl-move-stage]')) {
        void plMoveLead(leadCard.dataset.plLeadId, event.target.value)
        return
      }
      if (leadCard && event.target.matches('[data-pl-change-outcome]') && event.target.value) {
        void plChangeOutcome(leadCard.dataset.plLeadId, event.target.value)
        return
      }
      const taskCard = event.target.closest('[data-pl-task-id]')
      if (taskCard && event.target.matches('[data-pl-move-task-status]')) {
        void plMoveTask(taskCard.dataset.plTaskId, event.target.value)
      }
    })

    plShell.addEventListener('keydown', (event) => {
      if (event.target.matches('input,select,textarea,button')) return
      if (event.key !== 'Enter' && event.key !== ' ') return
      const leadCard = event.target.closest('[data-pl-lead-id]')
      const taskCard = event.target.closest('[data-pl-task-id]')
      if (!leadCard && !taskCard) return
      event.preventDefault()
      if (leadCard) void plOpenDetail(leadCard.dataset.plLeadId)
      if (taskCard) plOpenTask(plState.tasks.find((task) => task.id === taskCard.dataset.plTaskId))
    })

    plEl('pl-board').addEventListener('dragstart', (event) => {
      const card = event.target.closest('[data-pl-lead-id]')
      plState.draggedLeadId = card?.dataset.plLeadId || null
    })
    plEl('pl-board').addEventListener('dragover', (event) => {
      if (event.target.closest('[data-pl-stage-id],[data-pl-terminal]')) event.preventDefault()
    })
    plEl('pl-board').addEventListener('drop', (event) => {
      const terminal = event.target.closest('[data-pl-terminal]')
      const column = event.target.closest('[data-pl-stage-id]')
      if (terminal && plState.draggedLeadId) void plChangeOutcome(plState.draggedLeadId, terminal.dataset.plTerminal)
      else if (column && plState.draggedLeadId) void plMoveLead(plState.draggedLeadId, column.dataset.plStageId)
      plState.draggedLeadId = null
    })
    plEl('pl-task-board').addEventListener('dragstart', (event) => {
      const card = event.target.closest('[data-pl-task-id]')
      plState.draggedTaskId = card?.dataset.plTaskId || null
    })
    plEl('pl-task-board').addEventListener('dragover', (event) => {
      if (event.target.closest('[data-pl-task-status]')) event.preventDefault()
    })
    plEl('pl-task-board').addEventListener('drop', (event) => {
      const column = event.target.closest('[data-pl-task-status]')
      if (column && plState.draggedTaskId) void plMoveTask(plState.draggedTaskId, column.dataset.plTaskStatus)
      plState.draggedTaskId = null
    })

    plEl('pl-detail-content').addEventListener('click', async (event) => {
      const leadId = plEl('pl-detail-content').dataset.plLeadId
      const edit = event.target.closest('[data-pl-edit-lead]')
      if (edit) {
        plEl('pl-detail-dialog').hidden = true
        plOpenLead([...plState.leads, ...plState.won, ...plState.noResponse, ...plState.lost].find((lead) => lead.id === edit.dataset.plEditLead))
        return
      }
      const archive = event.target.closest('[data-pl-archive-lead]')
      if (archive) {
        await plMutate('/pipeline/leads/' + encodeURIComponent(archive.dataset.plArchiveLead), 'DELETE', {})
        plEl('pl-detail-dialog').hidden = true
        await plLoadAll(true)
        return
      }
      const outcome = event.target.closest('[data-pl-outcome]')
      if (outcome && leadId) {
        await plMutate('/pipeline/leads/' + encodeURIComponent(leadId) + '/transition', 'POST', { lifecycle: outcome.dataset.plOutcome, expectedRevision: plState.revision })
        plEl('pl-detail-dialog').hidden = true
        await plLoadAll(true)
      }
    })
    plEl('pl-detail-content').addEventListener('submit', async (event) => {
      if (event.target.id !== 'pl-note-form') return
      event.preventDefault()
      const leadId = plEl('pl-detail-content').dataset.plLeadId
      await plMutate('/pipeline/leads/' + encodeURIComponent(leadId) + '/activities', 'POST', { kind: 'NOTE', body: plEl('pl-note-body').value })
      await plLoadAll(true)
      await plOpenDetail(leadId)
    })

    plEl('pl-pipeline-form').addEventListener('submit', async (event) => {
      event.preventDefault()
      try {
        await plMutate('/pipeline', 'PATCH', { name: plEl('pl-pipeline-name-input').value })
        await plLoadAll(true)
        plEl('pl-settings-feedback').textContent = 'Nombre actualizado.'
      } catch (error) {
        plEl('pl-settings-feedback').textContent = error.message
        plEl('pl-settings-feedback').className = 'pl-feedback pl-error'
      }
    })
    plEl('pl-stage-create-form').addEventListener('submit', async (event) => {
      event.preventDefault()
      await plMutate('/pipeline/stages', 'POST', { name: plEl('pl-new-stage-name').value, color: plEl('pl-new-stage-color').value })
      plEl('pl-new-stage-name').value = ''
      await plLoadAll(true)
      plRenderStages()
    })
    plEl('pl-stage-list').addEventListener('click', async (event) => {
      const row = event.target.closest('[data-pl-stage-row]')
      if (!row) return
      const id = row.dataset.plStageRow
      try {
        if (event.target.closest('[data-pl-stage-save]')) {
          await plMutate('/pipeline/stages/' + encodeURIComponent(id), 'PATCH', {
            name: row.querySelector('[data-pl-stage-name]').value,
            color: row.querySelector('[data-pl-stage-color]').value
          })
        } else if (event.target.closest('[data-pl-stage-archive]')) {
          await plMutate('/pipeline/stages/' + encodeURIComponent(id), 'DELETE', {})
        }
        const up = event.target.closest('[data-pl-stage-up]')
        const down = event.target.closest('[data-pl-stage-down]')
        if (up || down) {
          const ids = (plState.pipeline?.stages || []).map((stage) => stage.id)
          const from = ids.indexOf(id)
          const to = up ? from - 1 : from + 1
          if (to >= 0 && to < ids.length) {
            const moved = ids.splice(from, 1)[0]
            ids.splice(to, 0, moved)
            await plMutate('/pipeline/stages/reorder', 'POST', { stageIds: ids, expectedRevision: plState.revision })
          }
        }
        await plLoadAll(true)
        plRenderStages()
      } catch (error) {
        plEl('pl-settings-feedback').textContent = error.message
        plEl('pl-settings-feedback').className = 'pl-feedback pl-error'
      }
    })
`
