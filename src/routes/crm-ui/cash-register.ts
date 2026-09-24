export const cashRegisterStyles = `
    .cash-register-view { display: none; min-width: 0; overflow: auto; background: var(--bg); }
    .app[data-section="cash"] { grid-template-columns: 80px minmax(0, 1fr); }
    .app[data-section="cash"] > :not(.workspace-nav):not(.cash-register-view):not(.crm-toast):not(.dialog-backdrop):not(.cash-dialog-backdrop) { display: none; }
    .app[data-section="cash"] .cash-register-view { display: block; grid-column: 2; }
    .cash-shell { width: min(1260px, 100%); margin: 0 auto; padding: 28px; }
    .cash-header, .cash-toolbar, .cash-session-strip, .cash-filter-row, .cash-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .cash-header { margin-bottom: 20px; }
    .cash-header h2, .cash-empty-state h3, .cash-dialog h3 { margin: 0; }
    .cash-header p, .cash-empty-state p { color: var(--muted); margin: 5px 0 0; }
    .cash-status { border-radius: 999px; padding: 7px 12px; font-weight: 800; background: var(--danger-soft); color: var(--danger); }
    .cash-status.open { background: #ecfdf5; color: #047857; }
    .cash-empty-state, .cash-panel, .cash-summary-card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow); }
    .cash-empty-state { min-height: 360px; display: grid; place-items: center; padding: 36px; text-align: center; }
    .cash-empty-state > div { max-width: 520px; }
    .cash-empty-state button { margin-top: 18px; }
    .cash-dashboard { display: grid; gap: 18px; }
    .cash-session-strip, .cash-toolbar, .cash-filter-row { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
    .cash-session-copy { display: grid; gap: 3px; }
    .cash-session-copy span { color: var(--muted); font-size: 13px; }
    .cash-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .cash-summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .cash-summary-card { padding: 16px; display: grid; gap: 7px; }
    .cash-summary-card span { color: var(--muted); font-size: 13px; }
    .cash-summary-card strong { font-size: 24px; }
    .cash-summary-card small { color: var(--muted); }
    .cash-reconciliation { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 15px 17px; border: 1px solid #fecaca; border-radius: 14px; background: #fef2f2; color: #991b1b; }
    .cash-reconciliation[hidden] { display: none; }
    .cash-reconciliation-copy { display: grid; gap: 4px; }
    .cash-reconciliation-copy span { color: #7f1d1d; }
    .cash-reconciliation > strong { font-size: 22px; white-space: nowrap; }
    .cash-session-history { border: 1px solid var(--line); border-radius: 14px; background: var(--surface); overflow: hidden; }
    .cash-session-history > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 50px; padding: 0 16px; cursor: pointer; font-weight: 800; list-style: none; }
    .cash-session-history > summary::-webkit-details-marker { display: none; }
    .cash-session-history > summary span { color: var(--muted); font-weight: 600; }
    .cash-session-list { display: grid; border-top: 1px solid var(--line); }
    .cash-session-row { display: grid; grid-template-columns: minmax(180px, 1fr) repeat(3, minmax(110px, auto)); gap: 14px; align-items: center; padding: 13px 16px; border-bottom: 1px solid var(--line); }
    .cash-session-row:last-child { border-bottom: 0; }
    .cash-session-row > div { display: grid; gap: 3px; }
    .cash-session-row span, .cash-session-row small { color: var(--muted); }
    .cash-session-difference.positive { color: #047857; }
    .cash-session-difference.negative { color: var(--danger); }
    .cash-panel { overflow: hidden; }
    .cash-filter-row { border: 0; border-bottom: 1px solid var(--line); border-radius: 0; }
    .cash-filter-controls { display: flex; gap: 8px; flex: 1; flex-wrap: wrap; }
    .cash-filter-controls :is(select,input) { min-height: 40px; border: 1px solid var(--line); border-radius: 9px; padding: 8px 10px; background: white; }
    .cash-filter-controls input { min-width: min(320px, 100%); flex: 1; }
    .cash-category-toolbar { display: flex; gap: 8px; align-items: center; }
    .cash-operation-category-field { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface-soft); }
    .cash-operation-category-field[hidden] { display: none; }
    .cash-operation-category-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .cash-operation-category-head label { display: block; }
    .cash-category-list { display: grid; border: 1px solid var(--line); border-radius: 11px; overflow: hidden; }
    .cash-subcategory-section { display: grid; gap: 12px; padding: 14px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface-soft); }
    .cash-subcategory-section h4 { margin: 0; }
    .cash-subcategory-section > p { margin: 0; color: var(--muted); font-size: 13px; }
    .cash-subcategory-section :is(input, select):focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
    .cash-category-row { display: grid; grid-template-columns: minmax(150px, 1fr) 90px 100px auto; gap: 10px; align-items: center; padding: 11px 12px; border-bottom: 1px solid var(--line); }
    .cash-category-row:last-child { border-bottom: 0; }
    .cash-category-row small { color: var(--muted); }
    .cash-category-row.inactive strong { color: var(--muted); text-decoration: line-through; }
    .cash-category-editor { padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-soft); display: grid; gap: 12px; }
    .cash-category-editor[hidden] { display: none; }
    .cash-entry-list { display: grid; }
    .cash-entry { display: grid; grid-template-columns: minmax(180px, 1.2fr) 120px 120px 140px auto; gap: 12px; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--line); }
    .cash-entry:last-child { border-bottom: 0; }
    .cash-entry-main { display: grid; gap: 4px; }
    .cash-entry-main span, .cash-entry small { color: var(--muted); }
    .cash-entry-amount { font-weight: 900; text-align: right; }
    .cash-entry-amount.outflow { color: var(--danger); }
    .cash-entry-amount.inflow { color: #047857; }
    .cash-load-more { width: 100%; border: 0; border-top: 1px solid var(--line); border-radius: 0; padding: 14px; background: var(--surface-soft); }
    .cash-inline-state { padding: 34px; text-align: center; color: var(--muted); }
    .cash-dialog-backdrop { position: fixed; inset: 0; z-index: 120; display: grid; place-items: center; padding: 18px; background: rgba(17,19,24,.52); }
    .cash-dialog-backdrop[hidden] { display: none; }
    .cash-session-loading { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #bfdbfe; border-radius: 9px; color: #1d4ed8; background: #eff6ff; font-weight: 700; }
    .cash-session-loading[hidden] { display: none; }
    .cash-session-spinner { width: 18px; height: 18px; flex: none; border: 2px solid #bfdbfe; border-top-color: #2563eb; border-radius: 50%; animation: cash-session-spin .7s linear infinite; }
    @keyframes cash-session-spin { to { transform: rotate(360deg); } }
    .cash-dialog { width: min(620px, 100%); max-height: calc(100vh - 36px); overflow: auto; background: var(--surface); border-radius: 18px; padding: 22px; box-shadow: 0 24px 64px rgba(0,0,0,.24); }
    .cash-dialog-form { display: grid; gap: 14px; margin-top: 18px; }
    .cash-dialog-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .cash-dialog-form label { display: grid; gap: 6px; font-weight: 750; }
    .cash-dialog-form :is(input:not([type="checkbox"]),select,textarea) { width: 100%; border: 1px solid var(--line); border-radius: 9px; background: #fff; color: var(--text); box-sizing: border-box; }
    .cash-dialog-form :is(input:not([type="checkbox"]),select) { height: 42px; min-height: 42px; }
    .cash-dialog-form input:not([type="checkbox"]) { padding: 0 12px; }
    .cash-dialog-form select { height: 42px; padding: 0 36px 0 12px; line-height: normal; }
    .cash-dialog-form textarea { min-height: 88px; padding: 10px 12px; resize: vertical; }
    .cash-session-help { margin: 0; padding: 10px 12px; border-radius: 9px; background: var(--surface-soft); color: var(--muted); line-height: 1.45; }
    .cash-session-reconciliation { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface-soft); }
    .cash-session-reconciliation[hidden] { display: none; }
    .cash-session-reconciliation div { display: grid; gap: 4px; }
    .cash-session-reconciliation span { color: var(--muted); font-size: 12px; }
    .cash-difference-confirm { display: flex !important; grid-column: 1 / -1; grid-template-columns: 18px 1fr !important; align-items: start; gap: 9px !important; padding-top: 8px; border-top: 1px solid var(--line); font-weight: 650 !important; }
    .cash-difference-confirm[hidden] { display: none !important; }
    .cash-difference-confirm input { width: 18px; height: 18px; margin: 1px 0 0; }
    .cash-close-change { display: grid; gap: 12px; padding: 14px; border: 1px solid #bfdbfe; border-radius: 11px; background: #f8fbff; }
    .cash-close-change[hidden], .cash-close-change-field[hidden], .cash-close-change-preview[hidden] { display: none !important; }
    .cash-close-change-toggle { display: flex !important; align-items: center; gap: 10px !important; font-weight: 750 !important; }
    .cash-close-change-toggle input { width: 18px; height: 18px; flex: none; }
    .cash-close-change-field { display: grid; gap: 6px; }
    .cash-close-change-field input { width: 100%; }
    .cash-close-change :is(input[type="checkbox"], input[type="number"]):focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
    .cash-close-change-preview { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .cash-close-change-preview div { display: grid; min-width: 0; gap: 4px; padding: 10px; background: #fff; border: 1px solid #dbeafe; border-radius: 9px; overflow-wrap: anywhere; }
    .cash-close-change-preview span, .cash-close-change-note { color: var(--muted); font-size: 12px; }
    .cash-close-change-note { margin: 0; }
    @media (max-width: 480px) { .cash-close-change-preview { grid-template-columns: minmax(0, 1fr); } }

    .cash-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .cash-feedback, .appointment-finance-feedback { min-height: 20px; margin: 0; color: var(--muted); white-space: pre-line; }
    .cash-feedback.error, .appointment-finance-feedback.error { color: var(--danger); }
    .cash-feedback.success, .appointment-finance-feedback.success { color: #047857; }
    .appointment-finance { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
    .appointment-finance > summary { min-height: 52px; cursor: pointer; padding: 0 13px; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; font-weight: 850; background: var(--surface-soft); list-style: none; }
    .appointment-finance > summary::-webkit-details-marker { display: none; }
    .appointment-finance > summary::after { content: "⌄"; color: #64748b; font-size: 18px; line-height: 1; transition: transform 160ms ease; }
    .appointment-finance[open] > summary { border-bottom: 1px solid var(--line); }
    .appointment-finance[open] > summary::after { transform: rotate(180deg); }
    .appointment-finance-content { padding: 14px; display: grid; gap: 14px; }
    .appointment-finance-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .appointment-finance-summary div { background: var(--surface-soft); border-radius: 9px; padding: 10px; display: grid; gap: 4px; }
    .appointment-finance-summary span { color: var(--muted); font-size: 12px; }
    .appointment-finance-form { display: grid; gap: 10px; padding-top: 12px; border-top: 1px solid var(--line); }
    .appointment-finance-form > small { color: var(--muted); }
    .appointment-finance-fixed-note { margin: 0; padding: 11px 12px; display: grid; gap: 4px; border: 1px solid var(--line); border-radius: 9px; color: var(--muted); background: var(--surface-soft); }
    .appointment-finance-fixed-note strong { color: var(--text); }
    .appointment-finance-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: end; }
    .appointment-finance-history { display: grid; gap: 7px; }
    .appointment-finance-history article { display: flex; justify-content: space-between; gap: 8px; padding: 9px; border-radius: 8px; background: var(--surface-soft); }
    .appointment-finance label { display: grid; gap: 6px; }
    .appointment-finance :is(input:not([type="checkbox"]), select) { width: 100%; min-height: 40px; border: 1px solid #b8c4d4; border-radius: 9px; padding: 8px 10px; background: var(--surface); }
    .appointment-finance :is(input:not([type="checkbox"]), select):focus { border-color: #2563eb; box-shadow: 0 0 0 3px #dbeafe; outline: none; }
    .appointment-create-payment-content { padding: 12px; display: grid; gap: 12px; }
    .appointment-create-payment-fields { display: grid; gap: 12px; }
    .appointment-create-actions { display: flex; gap: 8px; }
    .appointment-create-actions button { flex: 1; min-height: 40px; padding: 8px 10px; }
    .appointment-create-actions button.active { border-color: #2563eb; color: #1d4ed8; background: #eff6ff; box-shadow: 0 0 0 1px #2563eb inset; }
    .appointment-create-panel { display: grid; gap: 9px; padding: 11px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
    .appointment-create-panel[hidden], .appointment-create-observation[hidden] { display: none; }
    .appointment-create-panel-title { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .appointment-create-panel-title small { color: var(--muted); }
    .appointment-payment-complete { display: flex; align-items: flex-start; gap: 9px; padding: 10px; border: 1px solid #bfdbfe; border-radius: 9px; background: #eff6ff; color: #1e3a8a; cursor: pointer; }
    .appointment-payment-complete[hidden] { display: none; }
    .appointment-payment-complete input { width: 18px; height: 18px; margin: 1px 0 0; flex: 0 0 auto; }
    .appointment-payment-complete span { display: grid; gap: 2px; }
    .appointment-payment-complete small { color: #475569; }
    .appointment-create-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
    .appointment-create-summary div { min-width: 0; padding: 9px 10px; border-radius: 9px; background: var(--surface-soft); display: grid; gap: 3px; }
    .appointment-create-summary span { color: var(--muted); font-size: 11px; }
    .appointment-create-summary strong { font-size: 14px; }
    .appointment-create-summary .appointment-create-summary-emphasis { background: #eff6ff; }
    .appointment-create-summary .appointment-create-summary-emphasis strong { color: #1d4ed8; }
    .appointment-edit-estimated-total { display: grid; gap: 8px; padding: 11px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-soft); }
    .appointment-edit-estimated-total[hidden] { display: none; }
    .appointment-total-reference { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .appointment-total-reference div { padding: 9px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); display: grid; gap: 3px; }
    .appointment-total-reference span { color: var(--muted); font-size: 12px; }
    .appointment-total-adjust-grid { display: grid; grid-template-columns: minmax(0, 180px) minmax(220px, 1fr); gap: 10px; align-items: start; }
    .appointment-total-adjust-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .appointment-edit-history { display: grid; gap: 9px; padding-top: 12px; border-top: 1px solid var(--line); }
    .appointment-edit-history > strong { font-size: 13px; }
    .appointment-finance textarea { width: 100%; min-height: 72px; border: 1px solid #b8c4d4; border-radius: 9px; padding: 10px; background: var(--surface); resize: vertical; }
    .appointment-finance textarea:focus { border-color: #2563eb; box-shadow: 0 0 0 3px #dbeafe; outline: none; }
    .cash-product-layout { display: grid; grid-template-columns: minmax(230px, .75fr) minmax(340px, 1.25fr); gap: 16px; align-items: start; }
    .cash-product-section { min-width: 0; display: grid; gap: 12px; padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-soft); }
    .cash-product-section-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .cash-product-section-head h4 { margin: 0; }
    .cash-product-table { border: 1px solid var(--line); border-radius: 11px; background: var(--surface); overflow: hidden; }
    .cash-product-row { display: grid; grid-template-columns: minmax(130px, 1fr) minmax(100px, .7fr) 100px auto; gap: 10px; align-items: center; padding: 11px 12px; border-bottom: 1px solid var(--line); }
    .cash-product-row:last-child { border-bottom: 0; }
    .cash-product-row small { color: var(--muted); }
    .cash-product-row.inactive strong { color: var(--muted); text-decoration: line-through; }
    .cash-product-dialog { width: min(940px, 100%); }
    .cash-sale-builder { display: grid; gap: 12px; }
    .cash-sale-add-row, .appointment-product-add-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(76px, 100px) max-content; gap: 8px; align-items: end; }
    .cash-sale-add-row > label { min-width: 0; }
    .appointment-product-add-row > label { min-width: 0; }
    .cash-sale-add-row input, .cash-sale-add-row select { width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; }
    .appointment-product-add-row input, .appointment-product-add-row select { width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; }
    .cash-sale-items, .appointment-product-list { display: grid; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--surface); }
    .cash-sale-item, .appointment-product-item { display: grid; grid-template-columns: minmax(150px, 1fr) 80px 110px auto; gap: 10px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--line); }
    .cash-sale-item:last-child, .appointment-product-item:last-child { border-bottom: 0; }
    .cash-sale-item small, .appointment-product-item small { color: var(--muted); }
    .cash-sale-total { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 16px; align-items: center; padding: 12px; border-radius: 10px; background: #eff6ff; color: #1d4ed8; }
    .cash-sale-total strong { font-size: 20px; }
    .appointment-products { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
    .appointment-products > summary { min-height: 52px; cursor: pointer; padding: 0 13px; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; font-weight: 850; background: var(--surface-soft); list-style: none; }
    .appointment-products > summary::-webkit-details-marker { display: none; }
    .appointment-products > summary::after { content: "⌄"; color: #64748b; font-size: 18px; }
    .appointment-product-content { padding: 14px; display: grid; gap: 12px; container-type: inline-size; }
    @container (max-width: 430px) {
      .appointment-product-add-row { grid-template-columns: minmax(0, 1fr) minmax(76px, 96px); }
      .appointment-product-add-row > button { grid-column: 1 / -1; width: 100%; }
    }
    .appointment-product-note { margin: 0; color: var(--muted); font-size: 13px; }
    .cash-view-switch { display: inline-flex; gap: 4px; padding: 4px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-soft); width: fit-content; }
    .cash-view-tab { min-height: 40px; padding: 0 18px; border: 0; border-radius: 9px; background: transparent; color: var(--muted); font-weight: 850; cursor: pointer; }
    .cash-view-tab.active { background: var(--surface); color: var(--primary); box-shadow: 0 1px 4px rgba(15, 23, 42, .12); }
    .cash-method-totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 4px; }
    .cash-method-total[hidden] { display: none; }
    .cash-method-total { display: grid; gap: 3px; padding: 10px; border: 1px solid #dbeafe; border-radius: 10px; background: #f8fbff; }
    .cash-method-total span { font-size: 12px; color: var(--muted); }
    .cash-method-total strong { font-size: 17px; color: #0f172a; }
    .cash-period-view { display: grid; gap: 16px; }
    .cash-period-toolbar { display: grid; gap: 14px; padding: 16px; }
    .cash-period-toolbar-head, .cash-section-head, .cash-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .cash-period-toolbar-head h3, .cash-section-head h3 { margin: 0; }
    .cash-period-toolbar-head p, .cash-section-head p { margin: 4px 0 0; color: var(--muted); }
    .cash-period-presets { display: flex; flex-wrap: wrap; gap: 8px; }
    .cash-period-preset { min-height: 38px; padding: 0 14px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); font-weight: 750; cursor: pointer; }
    .cash-period-preset.active { color: var(--primary); border-color: var(--primary); background: #eff6ff; }
    .cash-period-dates { display: grid; grid-template-columns: repeat(2, minmax(160px, 230px)) auto; gap: 10px; align-items: end; }
    .cash-period-limit { color: var(--muted); font-size: 12px; }
    .cash-period-summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .cash-period-highlight { grid-column: auto; }
    .cash-period-highlight .cash-method-totals { margin-top: 10px; }
    .cash-period-movements { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .cash-period-movement { display: grid; gap: 4px; padding: 13px; border-radius: 12px; background: var(--surface-soft); border: 1px solid var(--line); }
    .cash-period-movement span { color: var(--muted); font-size: 12px; }
    .cash-period-movement strong { font-size: 18px; }
    .cash-period-category-list { display: flex; gap: 8px; flex-wrap: wrap; }
    .cash-period-category-list span { padding: 7px 10px; border-radius: 999px; background: #f1f5f9; color: #334155; font-size: 12px; font-weight: 750; }
    .cash-period-expenses { padding: 0; overflow: hidden; }
    .cash-period-expenses .cash-section-head, .cash-period-expense-filters, .cash-pagination { padding: 16px; }
    .cash-period-expense-filters { display: grid; grid-template-columns: repeat(3, minmax(130px, .8fr)) minmax(200px, 1.2fr) auto; gap: 10px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .cash-period-expense-list { min-height: 120px; }
    .cash-period-expense-row { display: grid; grid-template-columns: minmax(180px, 1.5fr) minmax(120px, .8fr) 150px 130px; gap: 12px; align-items: center; padding: 13px 16px; border-bottom: 1px solid var(--line); }
    .cash-period-expense-row small { color: var(--muted); }
    .cash-period-expense-row strong:last-child { text-align: right; }
    .cash-period-expense-row.reversal strong:last-child { color: #047857; }
    .cash-pagination { border-top: 1px solid var(--line); }
    .cash-pagination-controls { display: flex; gap: 8px; align-items: center; }
    @media (max-width: 900px) {
      .app[data-section="cash"] { display: block; }
      .app[data-section="cash"] .cash-register-view { min-height: 100vh; padding-top: 70px; }
      .cash-shell { padding: 16px; }
      .cash-summary-grid { grid-template-columns: 1fr 1fr; }
      .cash-period-summary-grid { grid-template-columns: 1fr 1fr; }
      .cash-period-highlight { grid-column: auto; }
      .cash-period-expense-filters { grid-template-columns: 1fr 1fr; }
      .cash-period-expense-row { grid-template-columns: minmax(160px, 1fr) 120px 120px; }
      .cash-period-expense-row > :nth-child(3) { display: none; }
      .cash-entry { grid-template-columns: 1fr auto; }
      .cash-session-row { grid-template-columns: 1fr 1fr; }
      .cash-entry > :not(.cash-entry-main):not(.cash-entry-amount) { display: none; }
    }
    @media (max-width: 560px) {
      .cash-header, .cash-toolbar, .cash-session-strip, .cash-filter-row { align-items: stretch; flex-direction: column; }
      .cash-summary-grid, .cash-dialog-grid, .appointment-finance-summary, .appointment-finance-row, .appointment-total-reference, .appointment-total-adjust-grid { grid-template-columns: 1fr; }
      .appointment-total-adjust-actions > button { flex: 1 1 120px; }
      .cash-session-reconciliation, .cash-session-row, .cash-product-layout { grid-template-columns: 1fr; }
      .cash-sale-add-row, .appointment-product-add-row, .cash-sale-item, .appointment-product-item, .cash-product-row { grid-template-columns: 1fr; }
      .cash-operation-category-head { align-items: stretch; flex-direction: column; }
      .appointment-create-actions { flex-direction: column; }
      .appointment-create-summary { grid-template-columns: 1fr 1fr; }
      .cash-actions > button { flex: 1; }
      .cash-category-toolbar { align-items: stretch; flex-direction: column; }
      .cash-view-switch { width: 100%; }
      .cash-view-tab { flex: 1; }
      .cash-period-dates, .cash-period-movements, .cash-period-expense-filters, .cash-method-totals { grid-template-columns: 1fr; }
      .cash-period-highlight { grid-column: auto; }
      .cash-period-expense-row { grid-template-columns: 1fr auto; }
      .cash-period-expense-row > :nth-child(2), .cash-period-expense-row > :nth-child(3) { display: none; }
      .cash-category-row { grid-template-columns: 1fr auto; }
      .cash-category-row > :nth-child(2), .cash-category-row > :nth-child(3) { display: none; }
    }

    .cash-professional-view { display:grid; gap:16px; }
    .cash-treasury-view { display:grid; grid-template-columns:minmax(0,1fr); gap:16px; min-width:0; }
    .cash-treasury-panel { padding:18px; display:grid; grid-template-columns:minmax(0,1fr); gap:14px; min-width:0; }
    .cash-treasury-panel .cash-summary-grid, .cash-treasury-panel .cash-summary-card, .cash-treasury-panel .cash-treasury-form, .cash-treasury-panel .cash-treasury-period-row, .cash-treasury-panel .cash-treasury-filter-row { min-width:0; }
    .cash-treasury-panel .cash-summary-card { overflow-wrap:anywhere; }
    .cash-treasury-form { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; align-items:end; }
    .cash-treasury-form label { display:grid; gap:6px; }
    .cash-treasury-form input, .cash-treasury-form select { min-height:40px; padding:8px; border:1px solid #cbd5e1; border-radius:8px; }
    .cash-treasury-form input:focus-visible, .cash-treasury-form select:focus-visible { outline:2px solid #2563eb; outline-offset:2px; }
    .cash-treasury-form button { min-height:40px; }
    .cash-treasury-expense-fields { grid-column:1 / -1; display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; padding:12px; border:1px solid #dbe4f0; border-radius:10px; background:#f8fbff; }
    .cash-treasury-expense-fields[hidden] { display:none; }
    .cash-treasury-filter-row, .cash-treasury-period-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; align-items:end; }
    .cash-treasury-period-row label { display:grid; gap:6px; }
    .cash-treasury-period-row input { min-height:40px; padding:8px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; }
    .cash-treasury-period-row button { min-height:40px; }
    .cash-treasury-filter-row label { display:grid; gap:6px; }
    .cash-treasury-filter-row select { min-height:40px; padding:8px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; }
    @media (max-width:480px) { .cash-treasury-panel { padding:14px; } .cash-treasury-form, .cash-treasury-expense-fields, .cash-treasury-filter-row, .cash-treasury-period-row { grid-template-columns:minmax(0,1fr); } }
    .cash-today-table-wrap { overflow-x:auto; padding:12px 16px; }
    .cash-today-table { width:100%; min-width:440px; border-collapse:collapse; text-align:left; }
    .cash-today-table th, .cash-today-table td { padding:12px; border-bottom:1px solid #e2e8f0; }
    .cash-today-table th:last-child, .cash-today-table td:last-child { text-align:right; }
    .cash-professional-period { padding:14px 16px; display:grid; gap:12px; }
    .cash-professional-period-dates { display:grid; grid-template-columns:minmax(150px,210px) minmax(150px,210px) auto minmax(190px,1fr); gap:10px; align-items:end; }
    .cash-professional-period-dates label { display:grid; gap:5px; color:#475569; font-size:12px; font-weight:700; }
    .cash-professional-period-dates input { min-height:40px; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; }
    .cash-professional-period-selected { min-height:40px; padding:4px 12px; border-left:1px solid #dbe5f3; display:grid; align-content:center; }
    .cash-professional-period-selected span { color:#64748b; font-size:11px; }
    .cash-professional-period-selected strong { color:#0f172a; font-size:13px; }
    .cash-professional-summary-head, .cash-professional-summary-row { display:grid; grid-template-columns:34px minmax(150px,1.35fr) repeat(5,minmax(110px,1fr)); align-items:stretch; }
    .cash-professional-summary-head { color:#64748b; background:#f8fafc; font-size:11px; font-weight:750; }
    .cash-professional-summary-head > *, .cash-professional-summary-row > * { padding:11px 10px; border-bottom:1px solid #e2e8f0; display:flex; align-items:center; }
    .cash-professional-summary-row > :not(:last-child), .cash-professional-summary-head > :not(:last-child) { border-right:1px solid #eef2f7; }
    .cash-professional-toggle { min-height:42px; padding:0; color:#1e3a8a; background:transparent; font-size:17px; font-weight:900; }
    .cash-professional-current-balance { border-left:2px solid #60a5fa !important; justify-content:center; flex-direction:column; background:#eff6ff; color:#1d4ed8; font-size:20px; line-height:1.1; font-weight:900; text-align:center; }
    .cash-professional-current-balance small { margin-top:3px; color:#64748b; font-size:9px; font-weight:650; }
    .cash-professional-summary-head .cash-professional-current-balance { font-size:12px; }
    .cash-professional-current-balance.negative { color:#dc2626; background:#fff1f2; }
    .cash-professional-period-balance.positive { color:#15803d; font-weight:850; }
    .cash-professional-period-balance.negative { color:#dc2626; font-weight:850; }
    .cash-professional-services { padding:0 10px 10px 44px; background:#f8fbff; border-bottom:1px solid #dbeafe; }
    .cash-professional-services-head, .cash-professional-service-row { min-width:720px; display:grid; grid-template-columns:110px minmax(170px,1.2fr) minmax(160px,1fr) minmax(170px,1fr) 110px; gap:10px; align-items:center; padding:9px 10px; border-bottom:1px solid #e2e8f0; }
    .cash-professional-services-head { color:#64748b; font-size:10px; font-weight:800; }
    .cash-professional-service-row { font-size:12px; }
    .cash-professional-service-row strong:last-child { text-align:right; }
    .cash-professional-movement-head, .cash-professional-movement-row { min-width:760px; display:grid; grid-template-columns:140px minmax(130px,1fr) 130px minmax(180px,1.2fr) 120px 140px; gap:10px; align-items:center; padding:11px 10px; border-bottom:1px solid #e2e8f0; }
    .cash-professional-movement-head { color:#64748b; background:#f8fafc; font-size:11px; font-weight:800; }
    .cash-professional-movement-row { font-size:12px; }
    .cash-professional-movement-row .negative { color:#dc2626; }
    .cash-professional-movements { padding-bottom:0; overflow:hidden; }
    .cash-professional-heading { padding:16px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
    .cash-professional-heading h3, .cash-professional-payment-panel h3 { margin:0; }
    .cash-professional-heading p, .cash-professional-payment-panel p { margin:4px 0 0; color:#64748b; }
    .cash-professional-panel, .cash-professional-payment-panel { padding:16px; }
    .cash-professional-row { display:grid; grid-template-columns:minmax(180px,1.5fr) repeat(4,minmax(90px,1fr)); gap:12px; align-items:center; padding:12px 10px; border-bottom:1px solid #e2e8f0; }
    .cash-professional-row-head { color:#64748b; font-size:12px; }
    .cash-professional-row .negative { color:#dc2626; }
    .cash-professional-payment-panel { display:grid; gap:14px; }
    .cash-professional-payment-form { display:grid; grid-template-columns:1fr 1fr .8fr .8fr 1fr; gap:12px; align-items:end; }
    .cash-professional-payment-form label { display:grid; gap:6px; font-size:12px; font-weight:700; }
    .cash-professional-payment-form input, .cash-professional-payment-form select { min-height:40px; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; }
    .cash-professional-observation { grid-column:1 / -2; }
    @media (max-width:760px) { .cash-professional-row { min-width:650px; } .cash-professional-table { overflow:auto; } .cash-professional-payment-form { grid-template-columns:1fr; } .cash-professional-observation { grid-column:auto; } .cash-professional-period-dates { grid-template-columns:1fr 1fr; } .cash-professional-period-selected { border-left:0; padding-left:0; } .cash-professional-summary-head, .cash-professional-summary-row { min-width:900px; } }
`

export const cashRegisterMarkup = `
    <section class="cash-register-view" id="cash-register-view" data-section="cash">
      <div class="cash-shell">
        <header class="cash-header">
          <div><h2>Caja</h2><p>Jornadas, cobros y movimientos del negocio</p></div>
          <span class="cash-status" id="cash-status">Caja cerrada</span>
        </header>
        <nav class="cash-view-switch" aria-label="Vista de Caja">
          <button class="cash-view-tab active" id="cash-view-day" type="button">Jornada y sesiones</button>
          <button class="cash-view-tab" id="cash-view-period" type="button">Consultar per&iacute;odo</button>
          <button class="cash-view-tab" id="cash-view-professionals" type="button">Liquidaciones</button>
          <button class="cash-view-tab" id="cash-view-treasury" type="button" hidden>Tesorer&iacute;a</button>
        </nav>
        <section class="cash-treasury-view" id="cash-treasury-view" hidden>
          <section class="cash-panel cash-treasury-panel">
            <div class="cash-section-head"><div><h3>Tesorer&iacute;a · efectivo reservado</h3><p>Solo administraci&oacute;n. Los traspasos desde Caja no son gastos del negocio.</p></div></div>
            <div id="cash-treasury-inactive" hidden><p>Todav&iacute;a no est&aacute; habilitada la reserva de efectivo.</p><button class="primary" id="cash-treasury-enable" type="button">Habilitar reserva</button></div>
            <strong id="cash-treasury-balance" hidden>$ 0</strong>
            <p class="cash-feedback" id="cash-treasury-feedback" role="status"></p>
          </section>
          <section class="cash-panel cash-treasury-panel" id="cash-treasury-consolidated">
            <div class="cash-section-head"><div><h3>Resultado global del local</h3><p>Caja diaria + gastos y pagos de Tesorer&iacute;a. Traspasos y retiros internos no son egresos.</p></div></div>
            <div class="cash-treasury-period-row"><label>Desde<input id="cash-treasury-period-from" type="date"></label><label>Hasta<input id="cash-treasury-period-to" type="date"></label><button class="secondary" id="cash-treasury-period-apply" type="button">Consultar</button></div>
            <p class="cash-feedback" id="cash-treasury-period-feedback" role="status"></p>
            <div class="cash-summary-grid cash-period-summary-grid" aria-label="Resultado global del per&iacute;odo">
              <article class="cash-summary-card"><span>Cobrado</span><strong id="cash-treasury-consolidated-collected">$0</strong><small id="cash-treasury-consolidated-collected-methods"></small></article>
              <article class="cash-summary-card"><span>Egresos</span><strong id="cash-treasury-consolidated-outgoing">$0</strong><small id="cash-treasury-consolidated-outgoing-methods"></small><small id="cash-treasury-consolidated-sources"></small></article>
              <article class="cash-summary-card"><span>Total</span><strong id="cash-treasury-consolidated-total">$0</strong><small id="cash-treasury-consolidated-total-methods"></small></article>
            </div>
            <small>Resultado de movimientos del per&iacute;odo, no saldo f&iacute;sico. El efectivo reservado se muestra por separado arriba.</small>
          </section>
          <section class="cash-panel cash-treasury-panel" id="cash-treasury-operations" hidden>
            <form class="cash-treasury-form" id="cash-treasury-transfer-form">
              <label>Desde Caja diaria<input id="cash-treasury-transfer-amount" type="number" min="1" step="1" required></label>
              <button class="primary" type="submit">Transferir a reserva</button>
            </form>
            <small>Requiere una sesi&oacute;n de Caja abierta. Queda un retiro en Caja y un ingreso interno en Tesorer&iacute;a.</small>
            <form class="cash-treasury-form" id="cash-treasury-outflow-form">
              <label>Tipo<select id="cash-treasury-outflow-kind"><option value="EXPENSE">Gasto</option><option value="WITHDRAWAL">Retiro</option></select></label>
              <div class="cash-treasury-expense-fields" id="cash-treasury-expense-fields">
                <label>Categor&iacute;a<select id="cash-treasury-outflow-category" required><option value="">Eleg&iacute; una categor&iacute;a</option></select></label>
                <label>Subcategor&iacute;a (opcional)<select id="cash-treasury-outflow-subcategory"><option value="">Sin subcategor&iacute;a</option></select></label>
                <label>Destinatario (opcional)<input id="cash-treasury-outflow-counterparty" maxlength="100" placeholder="Ej.: proveedor o propietario"></label>
              </div>
              <label>Detalle<input id="cash-treasury-outflow-description" maxlength="160" required></label>
              <label>Importe<input id="cash-treasury-outflow-amount" type="number" min="1" step="1" required></label>
              <button class="primary" type="submit">Registrar salida</button>
            </form>
          </section>
          <section class="cash-panel cash-treasury-panel" id="cash-treasury-history-panel" hidden><h3>Movimientos de Tesorer&iacute;a</h3><div class="cash-treasury-filter-row"><label>Filtrar categor&iacute;a<select id="cash-treasury-filter-category"><option value="">Todas</option></select></label><label>Filtrar subcategor&iacute;a<select id="cash-treasury-filter-subcategory"><option value="">Todas</option></select></label></div><small>Los filtros afectan la lista, no el saldo total reservado. Se muestran los &uacute;ltimos 100 movimientos coincidentes.</small><div class="cash-today-table-wrap"><table class="cash-today-table"><thead><tr><th>Fecha</th><th>Movimiento</th><th>Categor&iacute;a</th><th>Destinatario</th><th>Detalle</th><th>Importe</th></tr></thead><tbody id="cash-treasury-entries"></tbody></table></div></section>
        </section>
        <section class="cash-professional-view" id="cash-professional-view" hidden>
          <section class="cash-panel cash-professional-heading"><div><h3>Liquidaciones a profesionales</h3><p>Consult&aacute; servicios realizados por per&iacute;odo sin perder de vista el saldo hist&oacute;rico.</p></div><button class="secondary" id="cash-professional-refresh" type="button">Actualizar</button></section>
          <section class="cash-panel" id="cash-professional-today-panel" hidden><div class="cash-today-table-wrap" id="cash-professional-today-table"></div></section>
          <section class="cash-panel cash-professional-period">
            <div class="cash-period-presets" role="group" aria-label="Per&iacute;odo de liquidaciones">
              <button class="cash-period-preset" data-cash-professional-preset="today" type="button">Hoy</button>
              <button class="cash-period-preset active" data-cash-professional-preset="week" type="button">Semana</button>
              <button class="cash-period-preset" data-cash-professional-preset="month" type="button">Mes</button>
              <button class="cash-period-preset" data-cash-professional-preset="custom" type="button">Personalizado</button>
            </div>
            <div class="cash-professional-period-dates">
              <label>Desde<input id="cash-professional-period-from" type="date"></label>
              <label>Hasta<input id="cash-professional-period-to" type="date"></label>
              <button class="primary" id="cash-professional-period-apply" type="button">Aplicar</button>
              <div class="cash-professional-period-selected"><span>Per&iacute;odo seleccionado</span><strong id="cash-professional-period-label">—</strong></div>
            </div>
            <p class="cash-feedback" id="cash-professional-period-feedback" role="status"></p>
          </section>
          <section class="cash-panel cash-professional-panel"><div class="cash-professional-table" id="cash-professional-summary"><div class="cash-inline-state">Cargando liquidaciones...</div></div></section>
          <section class="cash-panel cash-professional-payment-panel" id="cash-professional-payment-panel"><div><h3>Registrar pago o adelanto</h3><p>Eleg&iacute; si el dinero sale de Caja abierta o de Tesorer&iacute;a. Solo administraci&oacute;n puede usar la reserva.</p></div>
            <form class="cash-professional-payment-form" id="cash-professional-payment-form">
              <label>Profesional<select id="cash-professional-payment-professional" required></select></label><label>Origen<select id="cash-professional-payment-source"><option value="CASH_REGISTER">Caja diaria</option><option value="TREASURY">Tesorer&iacute;a (efectivo)</option></select></label><label>Tipo<select id="cash-professional-payment-type"><option value="PAYMENT">Pago</option><option value="ADVANCE">Adelanto</option></select></label><label>Importe<input id="cash-professional-payment-amount" type="number" min="1" step="1" required></label><label>Medio<select id="cash-professional-payment-method"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia</option><option value="CARD">Tarjeta</option></select></label><label class="cash-professional-observation">Observaci&oacute;n<input id="cash-professional-payment-observation" maxlength="160"></label><button class="primary" type="submit">Registrar</button>
            </form><p class="cash-feedback" id="cash-professional-payment-feedback"></p>
          </section>
          <section class="cash-panel cash-professional-panel cash-professional-movements"><div class="cash-section-head"><div><h3>Movimientos recientes</h3><p>Servicios realizados, pagos, adelantos y ajustes del per&iacute;odo.</p></div></div><div class="cash-professional-table" id="cash-professional-entries"><div class="cash-inline-state">Cargando movimientos...</div></div><div class="cash-pagination"><span id="cash-professional-page-info">P&aacute;gina 1 de 1</span><div class="cash-pagination-controls"><button class="secondary" id="cash-professional-previous" type="button">Anterior</button><button class="secondary" id="cash-professional-next" type="button">Siguiente</button></div></div></section>
        </section>
        <section class="cash-period-view" id="cash-period-view" hidden>
          <section class="cash-panel cash-period-toolbar">
            <div class="cash-period-toolbar-head"><div><h3>Consultar per&iacute;odo</h3><p>Analiz&aacute; ingresos y egresos sin mezclar el efectivo esperado de una jornada.</p></div><span class="cash-period-limit">M&aacute;ximo 31 d&iacute;as</span></div>
            <div class="cash-period-presets" role="group" aria-label="Per&iacute;odos r&aacute;pidos">
              <button class="cash-period-preset" data-cash-period-preset="today" type="button">Hoy</button>
              <button class="cash-period-preset" data-cash-period-preset="week" type="button">Esta semana</button>
              <button class="cash-period-preset active" data-cash-period-preset="month" type="button">Este mes</button>
              <button class="cash-period-preset" data-cash-period-preset="custom" type="button">Personalizado</button>
            </div>
            <div class="cash-period-dates">
              <label>Desde<input id="cash-period-from" type="date"></label>
              <label>Hasta<input id="cash-period-to" type="date"></label>
              <button class="primary" id="cash-period-apply" type="button">Consultar</button>
            </div>
            <p class="cash-feedback" id="cash-period-feedback" role="status"></p>
          </section>
          <section class="cash-summary-grid cash-period-summary-grid" aria-label="Resumen del per&iacute;odo">
            <article class="cash-summary-card"><span>Cobrado</span><strong id="cash-period-gross">$0</strong><div class="cash-method-totals"><div class="cash-method-total"><span>Efectivo</span><strong id="cash-period-cash">$0</strong></div><div class="cash-method-total"><span>Transferencia</span><strong id="cash-period-transfer">$0</strong></div><div class="cash-method-total"><span>Tarjeta</span><strong id="cash-period-card">$0</strong></div><div class="cash-method-total" id="cash-period-unknown-collected-row" hidden><span>Sin especificar</span><strong id="cash-period-unknown-collected">$0</strong></div></div></article>
            <article class="cash-summary-card"><span>Egresos</span><strong id="cash-period-expenses-total">$0</strong><div class="cash-method-totals"><div class="cash-method-total"><span>Efectivo</span><strong id="cash-period-outgoing-cash">$0</strong></div><div class="cash-method-total"><span>Transferencia</span><strong id="cash-period-outgoing-transfer">$0</strong></div><div class="cash-method-total"><span>Tarjeta</span><strong id="cash-period-outgoing-card">$0</strong></div><div class="cash-method-total" id="cash-period-unknown-outgoing-row" hidden><span>Sin especificar</span><strong id="cash-period-unknown-outgoing">$0</strong></div></div><small id="cash-period-refunds">Gastos y devoluciones</small></article>
            <article class="cash-summary-card"><span>Total</span><strong id="cash-period-result">$0</strong><div class="cash-method-totals"><div class="cash-method-total"><span>Efectivo</span><strong id="cash-period-total-cash">$0</strong></div><div class="cash-method-total"><span>Transferencia</span><strong id="cash-period-total-transfer">$0</strong></div><div class="cash-method-total"><span>Tarjeta</span><strong id="cash-period-total-card">$0</strong></div><div class="cash-method-total" id="cash-period-unknown-total-row" hidden><span>Sin especificar</span><strong id="cash-period-unknown-total">$0</strong></div></div><small>No incluye aportes ni retiros internos</small></article>
          </section>
          <section class="cash-panel" style="padding:16px;display:grid;gap:12px">
            <div class="cash-section-head"><div><h3>Otros movimientos de caja</h3><p>Se muestran separados del resultado operativo.</p></div></div>
            <div class="cash-period-movements"><div class="cash-period-movement"><span>Aportes a caja</span><strong id="cash-period-cash-in">$0</strong></div><div class="cash-period-movement"><span>Retiros</span><strong id="cash-period-withdrawals">$0</strong></div><div class="cash-period-movement"><span>Ajustes</span><strong id="cash-period-adjustments">$0</strong></div></div>
            <div class="cash-period-category-list" id="cash-period-category-list"></div>
          </section>
          <section class="cash-panel cash-period-expenses">
            <div class="cash-section-head"><div><h3>Gastos del per&iacute;odo</h3><p id="cash-period-expense-count">0 movimientos</p></div></div>
            <div class="cash-period-expense-filters">
              <select id="cash-period-category-filter" aria-label="Categor&iacute;a de gasto"><option value="">Todas las categor&iacute;as</option></select>
              <select id="cash-period-subcategory-filter" aria-label="Subcategor&iacute;a de gasto"><option value="">Todas las subcategor&iacute;as</option></select>
              <select id="cash-period-method-filter" aria-label="Medio de pago"><option value="">Todos los medios</option><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option><option value="UNSPECIFIED">Sin especificar</option></select>
              <input id="cash-period-search" type="search" placeholder="Buscar descripci&oacute;n o categor&iacute;a" autocomplete="off">
              <label>Por p&aacute;gina<select id="cash-period-page-size"><option value="10">10</option><option value="20">20</option><option value="50">50</option></select></label>
            </div>
            <div class="cash-period-expense-list" id="cash-period-expense-list"><div class="cash-inline-state">Eleg&iacute; un per&iacute;odo para consultar.</div></div>
            <div class="cash-pagination"><span id="cash-period-page-info">P&aacute;gina 1 de 1</span><div class="cash-pagination-controls"><button class="secondary" id="cash-period-previous" type="button">Anterior</button><button class="secondary" id="cash-period-next" type="button">Siguiente</button></div></div>
          </section>
        </section>
        <section class="cash-empty-state" id="cash-empty-state">
          <div>
            <h3>La caja est&aacute; cerrada</h3>
            <p id="cash-empty-copy">Abr&iacute; una jornada para registrar cobros y operaciones manuales.</p>
            <button class="primary" id="cash-open-empty" type="button">Abrir caja</button>
          </div>
        </section>
        <div class="cash-dashboard" id="cash-dashboard" hidden>
          <section class="cash-session-strip" id="cash-session-strip">
            <div class="cash-session-copy"><strong id="cash-responsible">Sin responsable</strong><span id="cash-session-time">Sesi&oacute;n activa</span></div>
            <div class="cash-actions">
              <button class="primary" id="cash-product-sale-open" type="button">Nueva venta</button>
              <button class="secondary" id="cash-product-catalog-open" type="button">Productos</button>
              <button class="secondary" id="cash-operation-open" type="button">Registrar operaci&oacute;n</button>
              <button class="secondary" id="cash-new-session" type="button">Nueva sesi&oacute;n</button>
              <button class="danger" id="cash-close-day" type="button">Cerrar caja</button>
            </div>
          </section>
          <section class="cash-toolbar">
            <label>Jornada <select id="cash-day-select"></select></label>
            <div class="cash-actions"><button class="primary" id="cash-open-toolbar" type="button" hidden>Abrir caja</button><button class="secondary" id="cash-refresh" type="button">Actualizar</button></div>
          </section>
          <section class="cash-summary-grid" aria-label="Resumen de Caja">
            <article class="cash-summary-card"><span>Cobrado</span><strong id="cash-gross">$0</strong><div class="cash-method-totals"><div class="cash-method-total"><span>Efectivo</span><strong id="cash-method-cash">$0</strong></div><div class="cash-method-total"><span>Transferencia</span><strong id="cash-method-transfer">$0</strong></div><div class="cash-method-total"><span>Tarjeta</span><strong id="cash-method-card">$0</strong></div><div class="cash-method-total" id="cash-unknown-collected-row" hidden><span>Sin especificar</span><strong id="cash-unknown-collected">$0</strong></div></div></article>
            <article class="cash-summary-card"><span>Egresos</span><strong id="cash-outgoing">$0</strong><div class="cash-method-totals"><div class="cash-method-total"><span>Efectivo</span><strong id="cash-outgoing-cash">$0</strong></div><div class="cash-method-total"><span>Transferencia</span><strong id="cash-outgoing-transfer">$0</strong></div><div class="cash-method-total"><span>Tarjeta</span><strong id="cash-outgoing-card">$0</strong></div><div class="cash-method-total" id="cash-unknown-outgoing-row" hidden><span>Sin especificar</span><strong id="cash-unknown-outgoing">$0</strong></div></div><small id="cash-refunds">Gastos y devoluciones</small></article>
            <article class="cash-summary-card"><span>Total</span><strong id="cash-net">$0</strong><div class="cash-method-totals"><div class="cash-method-total"><span>Efectivo</span><strong id="cash-total-cash">$0</strong></div><div class="cash-method-total"><span>Transferencia</span><strong id="cash-total-transfer">$0</strong></div><div class="cash-method-total"><span>Tarjeta</span><strong id="cash-total-card">$0</strong></div><div class="cash-method-total" id="cash-unknown-total-row" hidden><span>Sin especificar</span><strong id="cash-unknown-total">$0</strong></div></div><small id="cash-incoming">Sin aportes ni retiros internos</small></article>
            <article class="cash-summary-card"><span id="cash-balance-label">Efectivo esperado</span><strong id="cash-expected">$0</strong><small id="cash-opening">Inicial $0</small></article>
          </section>
          <section class="cash-reconciliation" id="cash-reconciliation" hidden>
            <div class="cash-reconciliation-copy"><strong>Diferencia de cierre</strong><span id="cash-reconciliation-copy">El efectivo contado no coincide con el esperado.</span></div>
            <strong id="cash-reconciliation-amount">$0</strong>
          </section>
          <section class="cash-session-history" id="cash-session-history">
            <div class="cash-section-head" style="padding:16px"><div><h3>Historial de sesiones</h3><p>Responsables, conteos y diferencias de la jornada.</p></div><strong id="cash-session-count">0 sesiones</strong></div>
            <div class="cash-session-list" id="cash-session-list"></div>
          </section>
          <section class="cash-panel">
            <div class="cash-filter-row">
              <div class="cash-filter-controls">
                <select id="cash-type-filter" aria-label="Filtrar por tipo"><option value="">Todos los tipos</option><option value="PAYMENT">Cobro</option><option value="EXPENSE">Gasto</option><option value="WITHDRAWAL">Retiro</option><option value="CASH_IN">Ingreso</option><option value="ADJUSTMENT">Ajuste</option><option value="REFUND">Devoluci&oacute;n</option><option value="REVERSAL">Contrapartida</option></select>
                <select id="cash-method-filter" aria-label="Filtrar por medio"><option value="">Todos los medios</option><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option><option value="UNSPECIFIED">Sin especificar</option></select>
                <select id="cash-category-filter" aria-label="Filtrar por categor&iacute;a"><option value="">Todas las categor&iacute;as</option></select>
                <select id="cash-subcategory-filter" aria-label="Filtrar por subcategor&iacute;a"><option value="">Todas las subcategor&iacute;as</option></select>
                <select id="cash-session-filter" aria-label="Filtrar por sesi&oacute;n"><option value="">Todas las sesiones</option></select>
                <input id="cash-search" type="search" placeholder="Buscar cliente o descripci&oacute;n" autocomplete="off">
              </div>
            </div>
            <div class="cash-entry-list" id="cash-entry-list"><div class="cash-inline-state">Cargando movimientos...</div></div>
            <button class="cash-load-more" id="cash-next-page" type="button" hidden>Cargar m&aacute;s movimientos</button>
          </section>
        </div>
      </div>
    </section>
    <div class="cash-dialog-backdrop" id="cash-session-dialog" hidden>
      <section class="cash-dialog" role="dialog" aria-modal="true" aria-labelledby="cash-session-title">
        <div class="cash-dialog-head"><h3 id="cash-session-title">Abrir caja</h3><button class="icon-button" id="cash-session-x" type="button" aria-label="Cerrar">X</button></div>
        <form class="cash-dialog-form" id="cash-session-form">
          <p class="cash-session-help" id="cash-session-help"></p>
          <label id="cash-responsible-field">Responsable<select id="cash-session-responsible"></select></label>
          <label id="cash-opening-field"><span id="cash-opening-label">Efectivo inicial</span><input id="cash-opening-cash" type="number" min="0" step="1" inputmode="numeric"></label>
          <label id="cash-counted-field" hidden><span id="cash-counted-label">Efectivo contado</span><input id="cash-counted-cash" type="number" min="0" step="1" inputmode="numeric"></label>
          <section class="cash-session-reconciliation" id="cash-session-reconciliation" hidden>
            <div><span>Esperado</span><strong id="cash-session-expected">$0</strong></div>
            <div><span>Contado</span><strong id="cash-session-counted">--</strong></div>
            <div><span>Diferencia</span><strong id="cash-session-difference">--</strong></div>
            <label class="cash-difference-confirm" id="cash-difference-confirm-field" hidden><input id="cash-difference-confirm" type="checkbox"><span id="cash-difference-confirm-copy">Confirmo que registr&eacute; la diferencia de caja.</span></label>
          </section>
          <section class="cash-close-change" id="cash-close-change-section" aria-label="Cambio al cierre" hidden>
            <label class="cash-close-change-toggle"><input id="cash-close-leave-change" type="checkbox"><span>Dejar cambio en caja</span></label>
            <label class="cash-close-change-field" id="cash-close-change-field" hidden>Cu&aacute;nto quer&eacute;s dejar para la pr&oacute;xima apertura<input id="cash-close-cash-to-leave" type="number" min="0" step="1" inputmode="numeric"></label>
            <div class="cash-close-change-preview" id="cash-close-change-preview" aria-live="polite" hidden>
              <div><span>Queda en Caja</span><strong id="cash-close-next-opening">--</strong></div>
              <div><span>Pasa a Tesorer&iacute;a</span><strong id="cash-close-transfer-amount">--</strong></div>
            </div>
            <p class="cash-close-change-note">Para transferir un excedente, habilit&aacute; antes la reserva de Tesorer&iacute;a. No es un gasto.</p>
          </section>
          <p class="cash-feedback" id="cash-session-feedback" role="status"></p>
          <div class="cash-session-loading" id="cash-session-loading" role="status" aria-live="polite" hidden><span class="cash-session-spinner" aria-hidden="true"></span><span id="cash-session-loading-text">Guardando y actualizando Caja...</span></div>
          <div class="cash-dialog-actions"><button class="secondary" id="cash-session-cancel" type="button">Cancelar</button><button class="primary" id="cash-session-submit" type="submit">Confirmar</button></div>
        </form>
      </section>
    </div>
    <div class="cash-dialog-backdrop" id="cash-operation-dialog" hidden>
      <section class="cash-dialog" role="dialog" aria-modal="true" aria-labelledby="cash-operation-title">
        <div class="cash-dialog-head"><h3 id="cash-operation-title">Registrar operaci&oacute;n</h3><button class="icon-button" id="cash-operation-x" type="button" aria-label="Cerrar">X</button></div>
        <form class="cash-dialog-form" id="cash-operation-form">
          <div class="cash-dialog-grid"><label>Tipo<select id="cash-operation-type"><option value="EXPENSE">Gasto</option><option value="WITHDRAWAL">Retiro</option><option value="CASH_IN">Ingreso</option><option value="ADJUSTMENT">Ajuste</option><option value="REFUND">Devoluci&oacute;n</option></select></label><label id="cash-operation-method-field">Medio<select id="cash-operation-method"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label></div>
          <section class="cash-operation-category-field" id="cash-operation-category-field">
            <div class="cash-operation-category-head"><label for="cash-operation-category">Categor&iacute;a del gasto</label><button class="secondary" id="cash-expense-category-manage" type="button">Administrar categor&iacute;as</button></div>
            <select id="cash-operation-category" aria-label="Categor&iacute;a del gasto"></select>
            <label>Subcategor&iacute;a opcional<select id="cash-operation-subcategory"><option value="">Sin subcategor&iacute;a</option></select></label>
          </section>
          <label id="cash-operation-amount-field">Importe<input id="cash-operation-amount" type="number" min="1" step="1" inputmode="numeric"></label>
          <label id="cash-operation-delta-field" hidden>Diferencia con signo<input id="cash-operation-delta" type="number" step="1" inputmode="numeric" placeholder="Ej: -500 o 500"></label>
          <label id="cash-operation-description-field">Descripci&oacute;n<input id="cash-operation-description" maxlength="180"></label>
          <label id="cash-operation-counterparty-field" hidden>Persona que retira<input id="cash-operation-counterparty" maxlength="180"></label>
          <label>Observaci&oacute;n<textarea id="cash-operation-observation" maxlength="500" rows="3"></textarea></label>
          <p class="cash-feedback" id="cash-operation-feedback" role="status"></p>
          <div class="cash-dialog-actions"><button class="secondary" id="cash-operation-cancel" type="button">Cancelar</button><button class="primary" id="cash-operation-submit" type="submit">Registrar</button></div>
        </form>
      </section>
    </div>
    <div class="cash-dialog-backdrop" id="cash-expense-category-dialog" hidden>
      <section class="cash-dialog" role="dialog" aria-modal="true" aria-labelledby="cash-expense-category-title">
        <div class="cash-dialog-head"><div><h3 id="cash-expense-category-title">Categor&iacute;as de gastos</h3><p class="cash-session-help">Organiz&aacute; los gastos sin perder el historial. Otros siempre queda disponible.</p></div><button class="icon-button" id="cash-expense-category-x" type="button" aria-label="Cerrar">X</button></div>
        <div class="cash-dialog-form">
          <div class="cash-category-toolbar"><button class="primary" id="cash-expense-category-new" type="button">Nueva categor&iacute;a</button></div>
          <form class="cash-category-editor" id="cash-expense-category-form" hidden>
            <div class="cash-dialog-grid"><label>Nombre<input id="cash-expense-category-name" maxlength="60" autocomplete="off"></label><label>Orden<input id="cash-expense-category-position" type="number" min="0" max="10000" step="1" value="0"></label></div>
            <label id="cash-expense-category-active-field"><span><input id="cash-expense-category-active" type="checkbox" checked> Categor&iacute;a activa</span></label>
            <p class="cash-feedback" id="cash-expense-category-feedback" role="status"></p>
            <div class="cash-dialog-actions"><button class="secondary" id="cash-expense-category-edit-cancel" type="button">Cancelar</button><button class="primary" id="cash-expense-category-save" type="submit">Guardar</button></div>
          </form>
          <div class="cash-category-list" id="cash-expense-category-list"></div>
          <section class="cash-subcategory-section" aria-label="Subcategor&iacute;as de gastos">
            <div class="cash-category-toolbar"><h4>Subcategor&iacute;as</h4><button class="secondary" id="cash-expense-subcategory-new" type="button">Nueva subcategor&iacute;a</button></div>
            <p>Por ejemplo: Servicios → Luz, Gas, Agua o Alquiler. Son opcionales y se pueden filtrar.</p>
            <form class="cash-category-editor" id="cash-expense-subcategory-form" hidden>
              <div class="cash-dialog-grid"><label>Categor&iacute;a<select id="cash-expense-subcategory-category" required></select></label><label>Nombre<input id="cash-expense-subcategory-name" maxlength="60" required autocomplete="off"></label></div>
              <div class="cash-dialog-grid"><label>Orden<input id="cash-expense-subcategory-position" type="number" min="0" max="10000" step="1" value="0"></label><label id="cash-expense-subcategory-active-field" hidden><span><input id="cash-expense-subcategory-active" type="checkbox" checked> Subcategor&iacute;a activa</span></label></div>
              <p class="cash-feedback" id="cash-expense-subcategory-feedback" role="status"></p>
              <div class="cash-dialog-actions"><button class="secondary" id="cash-expense-subcategory-cancel" type="button">Cancelar</button><button class="primary" id="cash-expense-subcategory-save" type="submit">Guardar</button></div>
            </form>
            <div class="cash-category-list" id="cash-expense-subcategory-list"></div>
          </section>
          <div class="cash-dialog-actions"><button class="secondary" id="cash-expense-category-close" type="button">Cerrar</button></div>
        </div>
      </section>
    </div>
    <div class="cash-dialog-backdrop" id="cash-product-catalog-dialog" hidden>
      <section class="cash-dialog cash-product-dialog" role="dialog" aria-modal="true" aria-labelledby="cash-product-catalog-title">
        <div class="cash-dialog-head"><div><h3 id="cash-product-catalog-title">Productos</h3><p class="cash-session-help">Administr&aacute; el cat&aacute;logo y sus categor&iacute;as. El control de stock se incorporar&aacute; en una etapa posterior.</p></div><button class="icon-button" id="cash-product-catalog-x" type="button" aria-label="Cerrar">X</button></div>
        <div class="cash-dialog-form cash-product-layout">
          <section class="cash-product-section"><div class="cash-product-section-head"><h4>Categor&iacute;as</h4><button class="secondary" id="cash-product-category-new" type="button">Nueva</button></div>
            <form class="cash-category-editor" id="cash-product-category-form" hidden><label>Nombre<input id="cash-product-category-name" maxlength="60" autocomplete="off"></label><div class="cash-dialog-grid"><label>Orden<input id="cash-product-category-sort-order" type="number" min="0" step="1" value="0"></label><label><span><input id="cash-product-category-active" type="checkbox" checked> Categor&iacute;a activa</span></label></div><p class="cash-feedback" id="cash-product-category-feedback" role="status"></p><div class="cash-dialog-actions"><button class="secondary" id="cash-product-category-cancel" type="button">Cancelar</button><button class="primary" type="submit">Guardar</button></div></form>
            <div class="cash-category-list" id="cash-product-category-list"></div></section>
          <section class="cash-product-section"><div class="cash-product-section-head"><h4>Cat&aacute;logo</h4><button class="primary" id="cash-product-new" type="button">Nuevo producto</button></div>
            <form class="cash-category-editor" id="cash-product-form" hidden><div class="cash-dialog-grid"><label>Nombre<input id="cash-product-name" maxlength="100" autocomplete="off"></label><label>Categor&iacute;a<select id="cash-product-category"></select></label></div><div class="cash-dialog-grid"><label>Precio de venta<input id="cash-product-price" type="number" min="0" step="1" inputmode="numeric"></label><label>Costo opcional<input id="cash-product-cost" type="number" min="0" step="1" inputmode="numeric"></label></div><label>Descripci&oacute;n opcional<textarea id="cash-product-description" maxlength="300" rows="2"></textarea></label><div class="cash-dialog-grid"><label>C&oacute;digo interno opcional<input id="cash-product-sku" maxlength="60" autocomplete="off"></label><label>Orden<input id="cash-product-sort-order" type="number" min="0" step="1" value="0"></label></div><label><span><input id="cash-product-active" type="checkbox" checked> Producto activo</span></label><p class="cash-session-help">Sin controlar stock en esta primera etapa.</p><p class="cash-feedback" id="cash-product-feedback" role="status"></p><div class="cash-dialog-actions"><button class="secondary" id="cash-product-cancel" type="button">Cancelar</button><button class="primary" type="submit">Guardar producto</button></div></form>
            <div class="cash-product-table" id="cash-product-list"></div></section>
        </div><div class="cash-dialog-actions"><button class="secondary" id="cash-product-catalog-close" type="button">Cerrar</button></div>
      </section>
    </div>
    <div class="cash-dialog-backdrop" id="cash-product-sale-dialog" hidden>
      <section class="cash-dialog cash-product-dialog" role="dialog" aria-modal="true" aria-labelledby="cash-product-sale-title">
        <div class="cash-dialog-head"><div><h3 id="cash-product-sale-title">Nueva venta</h3><p class="cash-session-help">Registr&aacute; productos y cobro juntos en la sesi&oacute;n de Caja activa.</p></div><button class="icon-button" id="cash-product-sale-x" type="button" aria-label="Cerrar">X</button></div>
        <form class="cash-dialog-form" id="cash-product-sale-form"><div class="cash-dialog-grid"><label>Cliente opcional<select id="cash-product-sale-customer"><option value="">Sin cliente</option></select></label><label>Medio de pago<select id="cash-product-sale-method"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label></div><section class="cash-sale-builder"><div class="cash-sale-add-row"><label>Producto<select id="cash-product-sale-product"></select></label><label>Cantidad<input id="cash-product-sale-quantity" type="number" min="1" step="1" value="1" inputmode="numeric"></label><button class="secondary" id="cash-product-sale-add" type="button">Agregar</button></div><div class="cash-sale-items" id="cash-product-sale-items"><div class="cash-inline-state">Agregá al menos un producto.</div></div><label>Descuento<input id="cash-product-sale-discount" type="number" min="0" step="1" value="0" inputmode="numeric"></label><div class="cash-sale-total"><span>Subtotal</span><strong id="cash-product-sale-subtotal">$0</strong><span>Descuento</span><strong id="cash-product-sale-discount-preview">$0</strong><span>Total</span><strong id="cash-product-sale-total">$0</strong></div></section><label>Observaci&oacute;n opcional<textarea id="cash-product-sale-observation" maxlength="500" rows="2"></textarea></label><p class="cash-session-help">No env&iacute;a ni cobra autom&aacute;ticamente hasta que confirmes la venta.</p><p class="cash-feedback" id="cash-product-sale-feedback" role="status"></p><div class="cash-dialog-actions"><button class="secondary" id="cash-product-sale-cancel" type="button">Cancelar</button><button class="primary" id="cash-product-sale-submit" type="submit">Registrar venta</button></div></form>
      </section>
    </div>
`

export const appointmentFinanceMarkup = `
          <details class="appointment-products" id="appointment-product-items" hidden>
            <summary><span>Productos comprados</span><span id="appointment-product-total">$0</span></summary>
            <div class="appointment-product-content"><p class="appointment-product-note">Agreg&aacute; esmaltes, cremas, geles u otros productos. El total del turno se actualiza al guardar cada producto.</p><div class="appointment-product-add-row"><label>Producto<select id="appointment-product-select"></select></label><label>Cantidad<input id="appointment-product-quantity" type="number" min="1" step="1" value="1" inputmode="numeric"></label><button class="secondary" id="appointment-product-add" type="button">Agregar</button></div><div class="appointment-product-list" id="appointment-product-list"><div class="cash-inline-state">Todav&iacute;a no hay productos.</div></div><p class="appointment-finance-feedback" id="appointment-product-feedback" role="status"></p></div>
          </details>
          <details class="appointment-finance" id="appointment-create-payment" hidden>
            <summary><span>Pago</span><span id="appointment-create-payment-status">Sin pago</span></summary>
            <div class="appointment-create-payment-content">
              <div class="appointment-create-payment-fields" id="appointment-create-payment-fields">
                <label id="appointment-create-estimated-total-row" hidden>Total acordado<input id="appointment-create-estimated-total" type="number" min="1" step="1" inputmode="numeric" placeholder="Ingres&aacute; el total final"></label>
                <div class="appointment-create-actions">
                  <button class="secondary" id="appointment-create-collect-total" type="button" aria-pressed="false">Cobrar total</button>
                  <button class="secondary" id="appointment-create-deposit" type="button" aria-pressed="false">Registrar se&ntilde;a</button>
                  <button class="secondary" id="appointment-create-discount-toggle" type="button" aria-pressed="false">Aplicar descuento</button>
                </div>
                <section class="appointment-create-panel" id="appointment-create-discount-panel" hidden>
                  <div class="appointment-create-panel-title"><strong>Descuento</strong><small>Se aplica antes de cobrar</small></div>
                  <div class="appointment-finance-row"><label>Tipo<select id="appointment-create-discount-type"><option value="AMOUNT">Monto</option><option value="PERCENTAGE">Porcentaje</option></select></label><label><span id="appointment-create-discount-value-label">Monto</span><input id="appointment-create-discount-value" type="number" min="1" step="1" inputmode="decimal"></label><span></span></div>
                </section>
                <section class="appointment-create-panel" id="appointment-create-deposit-panel" hidden>
                  <div class="appointment-create-panel-title"><strong>Se&ntilde;a</strong><small>Pago parcial</small></div>
                  <div class="appointment-finance-row"><label>Importe<input id="appointment-create-deposit-amount" type="number" min="1" step="1" inputmode="numeric" placeholder="Ingres&aacute; el importe"></label><label>Medio<select id="appointment-create-deposit-method"><option value="CASH">Efectivo</option><option value="TRANSFER" selected>Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label><span></span></div>
                </section>
                <section class="appointment-create-panel" id="appointment-create-payment-panel" hidden>
                  <div class="appointment-create-panel-title"><strong>Pago del saldo</strong><small>Calculado autom&aacute;ticamente</small></div>
                  <div class="appointment-finance-row"><label>Importe<input id="appointment-create-payment-amount" type="number" min="1" step="1" inputmode="numeric" readonly></label><label>Medio<select id="appointment-create-payment-method"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label><button class="secondary" id="appointment-create-add-payment-line" type="button">Pago mixto</button></div>
                  <div class="appointment-finance-row" id="appointment-create-payment-line-two" hidden><label>Segundo importe<input id="appointment-create-payment-amount-two" type="number" min="1" step="1" inputmode="numeric" readonly></label><label>Segundo medio<select id="appointment-create-payment-method-two"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label><span></span></div>
                </section>
                <div class="appointment-create-summary">
                  <div><span>Precio</span><strong id="appointment-create-summary-price">--</strong></div>
                  <div><span>Descuento</span><strong id="appointment-create-summary-discount">$ 0</strong></div>
                  <div><span>Total</span><strong id="appointment-create-summary-total">--</strong></div>
                  <div><span>Pagado</span><strong id="appointment-create-summary-paid">$ 0</strong></div>
                  <div class="appointment-create-summary-emphasis"><span>Pendiente</span><strong id="appointment-create-summary-due">--</strong></div>
                </div>
                <label class="appointment-create-observation" id="appointment-create-observation-row" hidden>Observaci&oacute;n<textarea id="appointment-create-payment-observation" maxlength="500" rows="2"></textarea></label>
                <div id="appointment-create-cash-required" hidden><p>Para cobrar necesit&aacute;s una sesi&oacute;n de Caja activa.</p><button class="primary" id="appointment-create-open-cash" type="button">Abrir caja</button></div>
              </div>
              <p class="appointment-finance-feedback" id="appointment-create-payment-feedback" role="status"></p>
            </div>
          </details>
          <details class="appointment-finance" id="appointment-finance" hidden>
            <summary><span>Pago</span><span id="appointment-finance-balance">Cargando...</span></summary>
            <div class="appointment-finance-content">
              <section class="appointment-edit-estimated-total" id="appointment-total-form" hidden>
                <div class="appointment-create-panel-title"><strong>Ajustar total acordado</strong><small>El cambio queda registrado en el historial</small></div>
                <div class="appointment-total-reference">
                  <div><span>Precio original</span><strong id="appointment-original-total">--</strong></div>
                  <div id="appointment-minimum-total-row"><span>M&iacute;nimo permitido</span><strong id="appointment-minimum-total">--</strong></div>
                </div>
                <div class="appointment-total-adjust-grid">
                  <label>Total final acordado<input id="appointment-estimated-total" type="number" min="0" step="1" inputmode="numeric"></label>
                  <label>Motivo del ajuste<textarea id="appointment-total-reason" maxlength="300" rows="2" placeholder="Ej: el cliente eligi&oacute; otra opci&oacute;n" required></textarea></label>
                </div>
                <small id="appointment-total-help"></small>
                <div class="appointment-total-adjust-actions"><button class="secondary" id="appointment-total-cancel" type="button">Cancelar</button><button class="primary" id="appointment-total-submit" type="button">Guardar ajuste</button></div>
              </section>
              <div class="appointment-create-actions appointment-edit-actions">
                <button class="secondary" id="appointment-adjust-total-toggle" type="button" aria-pressed="false">Ajustar total</button>
                <button class="secondary" id="appointment-edit-collect-total" type="button" aria-pressed="false">Cobrar total</button>
                <button class="secondary" id="appointment-edit-deposit" type="button" aria-pressed="false">Registrar se&ntilde;a</button>
                <button class="secondary" id="appointment-edit-discount-toggle" type="button" aria-pressed="false">Aplicar descuento</button>
              </div>
              <section class="appointment-create-panel" id="appointment-discount-form" hidden>
                <div class="appointment-create-panel-title"><strong>Descuento</strong><small>Se aplica sobre el precio</small></div>
                <div class="appointment-finance-row"><label>Tipo<select id="appointment-discount-type"><option value="AMOUNT">Monto</option><option value="PERCENTAGE">Porcentaje</option></select></label><label><span id="appointment-discount-value-label">Monto</span><input id="appointment-discount-value" type="number" min="0" step="1" inputmode="decimal"></label><button class="secondary" id="appointment-discount-submit" type="button">Aplicar</button></div>
                <small id="appointment-discount-help">Se guarda como un monto nominal sobre el total del turno.</small>
              </section>
              <section class="appointment-create-panel" id="appointment-edit-deposit-panel" hidden>
                <div class="appointment-create-panel-title"><strong>Se&ntilde;a</strong><small>Pago parcial</small></div>
                <div class="appointment-finance-row"><label>Importe<input id="appointment-edit-deposit-amount" type="number" min="1" step="1" inputmode="numeric" placeholder="Ingres&aacute; el importe"></label><label>Medio<select id="appointment-edit-deposit-method"><option value="CASH">Efectivo</option><option value="TRANSFER" selected>Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label><button class="primary" id="appointment-edit-deposit-submit" type="button">Registrar se&ntilde;a</button></div>
              </section>
              <section class="appointment-create-panel" id="appointment-edit-payment-panel" hidden>
                <div class="appointment-create-panel-title"><strong>Pago del saldo</strong><small>Calculado autom&aacute;ticamente</small></div>
                <div class="appointment-finance-row"><label>Importe<input id="appointment-payment-amount" type="number" min="1" step="1" inputmode="numeric" readonly></label><label>Medio<select id="appointment-payment-method"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label><button class="secondary" id="appointment-add-payment-line" type="button">Pago mixto</button></div>
                <div class="appointment-finance-row" id="appointment-payment-line-two" hidden><label>Segundo importe<input id="appointment-payment-amount-two" type="number" min="1" step="1" inputmode="numeric" readonly></label><label>Segundo medio<select id="appointment-payment-method-two"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia / Mercado Pago</option><option value="CARD">Tarjeta</option></select></label><span></span></div>
                <label class="appointment-payment-complete" id="appointment-payment-complete-row" hidden>
                  <input id="appointment-payment-complete" type="checkbox">
                  <span><strong>Marcar este turno como realizado</strong><small>Se registrar&aacute; junto con el pago. Pod&eacute;s desmarcarlo si el servicio todav&iacute;a no termin&oacute;.</small></span>
                </label>
                <button class="primary" id="appointment-payment-submit" type="button">Registrar pago</button>
              </section>
              <label class="appointment-create-observation" id="appointment-edit-observation-row" hidden>Observaci&oacute;n<textarea id="appointment-payment-observation" maxlength="500" rows="2"></textarea></label>
              <div class="appointment-create-summary">
                <div><span>Servicios</span><strong id="appointment-finance-service-subtotal">--</strong></div>
                <div><span>Productos</span><strong id="appointment-finance-product-subtotal">--</strong></div>
                <div><span>Descuento</span><strong id="appointment-finance-discount">--</strong></div>
                <div><span>Total</span><strong id="appointment-finance-total">--</strong></div>
                <div><span>Pagado</span><strong id="appointment-finance-paid">--</strong></div>
                <div class="appointment-create-summary-emphasis"><span>Pendiente</span><strong id="appointment-finance-due">--</strong></div>
              </div>
              <div id="appointment-cash-required" hidden><p>Para cobrar necesit&aacute;s una sesi&oacute;n de Caja activa.</p><button class="primary" id="appointment-open-cash" type="button">Abrir caja</button></div>
              <div class="appointment-edit-history"><strong>Historial</strong><div class="appointment-finance-history" id="appointment-finance-history"></div></div>
              <p class="appointment-finance-feedback" id="appointment-finance-feedback" role="status"></p>
            </div>
          </details>
`

export const cashRegisterScript = `
    const cashUi = {
      view: document.getElementById('cash-register-view'), status: document.getElementById('cash-status'), empty: document.getElementById('cash-empty-state'), emptyCopy: document.getElementById('cash-empty-copy'), dashboard: document.getElementById('cash-dashboard'), viewDay: document.getElementById('cash-view-day'), viewPeriod: document.getElementById('cash-view-period'), viewProfessionals: document.getElementById('cash-view-professionals'), viewTreasury: document.getElementById('cash-view-treasury'), treasuryView: document.getElementById('cash-treasury-view'), periodView: document.getElementById('cash-period-view'), professionalView: document.getElementById('cash-professional-view'), professionalSummary: document.getElementById('cash-professional-summary'), professionalRefresh: document.getElementById('cash-professional-refresh'), professionalPaymentPanel: document.getElementById('cash-professional-payment-panel'), professionalPaymentForm: document.getElementById('cash-professional-payment-form'), professionalEntries: document.getElementById('cash-professional-entries'), professionalPaymentProfessional: document.getElementById('cash-professional-payment-professional'), professionalPaymentSource: document.getElementById('cash-professional-payment-source'), professionalPaymentType: document.getElementById('cash-professional-payment-type'), professionalPaymentAmount: document.getElementById('cash-professional-payment-amount'), professionalPaymentMethod: document.getElementById('cash-professional-payment-method'), professionalPaymentObservation: document.getElementById('cash-professional-payment-observation'), professionalPaymentFeedback: document.getElementById('cash-professional-payment-feedback'), professionalPeriodFrom: document.getElementById('cash-professional-period-from'), professionalPeriodTo: document.getElementById('cash-professional-period-to'), professionalPeriodApply: document.getElementById('cash-professional-period-apply'), professionalPeriodLabel: document.getElementById('cash-professional-period-label'), professionalPeriodFeedback: document.getElementById('cash-professional-period-feedback'), professionalPageInfo: document.getElementById('cash-professional-page-info'), professionalPrevious: document.getElementById('cash-professional-previous'), professionalNext: document.getElementById('cash-professional-next'),
      openEmpty: document.getElementById('cash-open-empty'), openToolbar: document.getElementById('cash-open-toolbar'), sessionStrip: document.getElementById('cash-session-strip'), responsible: document.getElementById('cash-responsible'), sessionTime: document.getElementById('cash-session-time'), operationOpen: document.getElementById('cash-operation-open'), newSession: document.getElementById('cash-new-session'), closeDay: document.getElementById('cash-close-day'), daySelect: document.getElementById('cash-day-select'), refresh: document.getElementById('cash-refresh'),
      gross: document.getElementById('cash-gross'), methodCash: document.getElementById('cash-method-cash'), methodTransfer: document.getElementById('cash-method-transfer'), methodCard: document.getElementById('cash-method-card'), unknownCollected: document.getElementById('cash-unknown-collected'), unknownCollectedRow: document.getElementById('cash-unknown-collected-row'), unknownOutgoing: document.getElementById('cash-unknown-outgoing'), unknownOutgoingRow: document.getElementById('cash-unknown-outgoing-row'), unknownTotal: document.getElementById('cash-unknown-total'), unknownTotalRow: document.getElementById('cash-unknown-total-row'), net: document.getElementById('cash-net'), refunds: document.getElementById('cash-refunds'), outgoing: document.getElementById('cash-outgoing'), outgoingCash: document.getElementById('cash-outgoing-cash'), outgoingTransfer: document.getElementById('cash-outgoing-transfer'), outgoingCard: document.getElementById('cash-outgoing-card'), totalCash: document.getElementById('cash-total-cash'), totalTransfer: document.getElementById('cash-total-transfer'), totalCard: document.getElementById('cash-total-card'), incoming: document.getElementById('cash-incoming'), balanceLabel: document.getElementById('cash-balance-label'), expected: document.getElementById('cash-expected'), opening: document.getElementById('cash-opening'), reconciliation: document.getElementById('cash-reconciliation'), reconciliationCopy: document.getElementById('cash-reconciliation-copy'), reconciliationAmount: document.getElementById('cash-reconciliation-amount'), sessionHistory: document.getElementById('cash-session-history'), sessionCount: document.getElementById('cash-session-count'), sessionList: document.getElementById('cash-session-list'),
      typeFilter: document.getElementById('cash-type-filter'), methodFilter: document.getElementById('cash-method-filter'), categoryFilter: document.getElementById('cash-category-filter'), subcategoryFilter: document.getElementById('cash-subcategory-filter'), sessionFilter: document.getElementById('cash-session-filter'), categoryManage: document.getElementById('cash-expense-category-manage'), search: document.getElementById('cash-search'), entryList: document.getElementById('cash-entry-list'), nextPage: document.getElementById('cash-next-page'),
      periodFrom: document.getElementById('cash-period-from'), periodTo: document.getElementById('cash-period-to'), periodApply: document.getElementById('cash-period-apply'), periodFeedback: document.getElementById('cash-period-feedback'), periodGross: document.getElementById('cash-period-gross'), periodCash: document.getElementById('cash-period-cash'), periodTransfer: document.getElementById('cash-period-transfer'), periodCard: document.getElementById('cash-period-card'), periodUnknownCollected: document.getElementById('cash-period-unknown-collected'), periodUnknownCollectedRow: document.getElementById('cash-period-unknown-collected-row'), periodUnknownOutgoing: document.getElementById('cash-period-unknown-outgoing'), periodUnknownOutgoingRow: document.getElementById('cash-period-unknown-outgoing-row'), periodUnknownTotal: document.getElementById('cash-period-unknown-total'), periodUnknownTotalRow: document.getElementById('cash-period-unknown-total-row'), periodRefunds: document.getElementById('cash-period-refunds'), periodExpensesTotal: document.getElementById('cash-period-expenses-total'), periodOutgoingCash: document.getElementById('cash-period-outgoing-cash'), periodOutgoingTransfer: document.getElementById('cash-period-outgoing-transfer'), periodOutgoingCard: document.getElementById('cash-period-outgoing-card'), periodResult: document.getElementById('cash-period-result'), periodTotalCash: document.getElementById('cash-period-total-cash'), periodTotalTransfer: document.getElementById('cash-period-total-transfer'), periodTotalCard: document.getElementById('cash-period-total-card'), periodCashIn: document.getElementById('cash-period-cash-in'), periodWithdrawals: document.getElementById('cash-period-withdrawals'), periodAdjustments: document.getElementById('cash-period-adjustments'), periodCategoryList: document.getElementById('cash-period-category-list'), periodCategoryFilter: document.getElementById('cash-period-category-filter'), periodSubcategoryFilter: document.getElementById('cash-period-subcategory-filter'), periodMethodFilter: document.getElementById('cash-period-method-filter'), periodSearch: document.getElementById('cash-period-search'), periodPageSize: document.getElementById('cash-period-page-size'), periodExpenseList: document.getElementById('cash-period-expense-list'), periodExpenseCount: document.getElementById('cash-period-expense-count'), periodPageInfo: document.getElementById('cash-period-page-info'), periodPrevious: document.getElementById('cash-period-previous'), periodNext: document.getElementById('cash-period-next'),
      sessionDialog: document.getElementById('cash-session-dialog'), sessionTitle: document.getElementById('cash-session-title'), sessionForm: document.getElementById('cash-session-form'), sessionX: document.getElementById('cash-session-x'), sessionCancel: document.getElementById('cash-session-cancel'), sessionSubmit: document.getElementById('cash-session-submit'), sessionResponsible: document.getElementById('cash-session-responsible'), sessionHelp: document.getElementById('cash-session-help'), responsibleField: document.getElementById('cash-responsible-field'), openingField: document.getElementById('cash-opening-field'), openingLabel: document.getElementById('cash-opening-label'), countedField: document.getElementById('cash-counted-field'), countedLabel: document.getElementById('cash-counted-label'), openingCash: document.getElementById('cash-opening-cash'), countedCash: document.getElementById('cash-counted-cash'), sessionReconciliation: document.getElementById('cash-session-reconciliation'), sessionExpected: document.getElementById('cash-session-expected'), sessionCounted: document.getElementById('cash-session-counted'), sessionDifference: document.getElementById('cash-session-difference'), differenceConfirmField: document.getElementById('cash-difference-confirm-field'), differenceConfirm: document.getElementById('cash-difference-confirm'), differenceConfirmCopy: document.getElementById('cash-difference-confirm-copy'), closeChangeSection: document.getElementById('cash-close-change-section'), closeLeaveChange: document.getElementById('cash-close-leave-change'), closeChangeField: document.getElementById('cash-close-change-field'), closeCashToLeave: document.getElementById('cash-close-cash-to-leave'), closeChangePreview: document.getElementById('cash-close-change-preview'), closeNextOpening: document.getElementById('cash-close-next-opening'), closeTransferAmount: document.getElementById('cash-close-transfer-amount'), sessionFeedback: document.getElementById('cash-session-feedback'), sessionLoading: document.getElementById('cash-session-loading'),
      operationDialog: document.getElementById('cash-operation-dialog'), operationForm: document.getElementById('cash-operation-form'), operationX: document.getElementById('cash-operation-x'), operationCancel: document.getElementById('cash-operation-cancel'), operationType: document.getElementById('cash-operation-type'), operationMethod: document.getElementById('cash-operation-method'), operationMethodField: document.getElementById('cash-operation-method-field'), operationCategory: document.getElementById('cash-operation-category'), operationSubcategory: document.getElementById('cash-operation-subcategory'), operationCategoryField: document.getElementById('cash-operation-category-field'), operationAmount: document.getElementById('cash-operation-amount'), operationAmountField: document.getElementById('cash-operation-amount-field'), operationDelta: document.getElementById('cash-operation-delta'), operationDeltaField: document.getElementById('cash-operation-delta-field'), operationDescription: document.getElementById('cash-operation-description'), operationDescriptionField: document.getElementById('cash-operation-description-field'), operationCounterparty: document.getElementById('cash-operation-counterparty'), operationCounterpartyField: document.getElementById('cash-operation-counterparty-field'), operationObservation: document.getElementById('cash-operation-observation'), operationFeedback: document.getElementById('cash-operation-feedback'), operationSubmit: document.getElementById('cash-operation-submit'),
      categoryDialog: document.getElementById('cash-expense-category-dialog'), categoryX: document.getElementById('cash-expense-category-x'), categoryClose: document.getElementById('cash-expense-category-close'), categoryNew: document.getElementById('cash-expense-category-new'), categoryForm: document.getElementById('cash-expense-category-form'), categoryName: document.getElementById('cash-expense-category-name'), categoryPosition: document.getElementById('cash-expense-category-position'), categoryActive: document.getElementById('cash-expense-category-active'), categoryActiveField: document.getElementById('cash-expense-category-active-field'), categoryFeedback: document.getElementById('cash-expense-category-feedback'), categoryEditCancel: document.getElementById('cash-expense-category-edit-cancel'), categorySave: document.getElementById('cash-expense-category-save'), categoryList: document.getElementById('cash-expense-category-list'), subcategoryNew: document.getElementById('cash-expense-subcategory-new'), subcategoryForm: document.getElementById('cash-expense-subcategory-form'), subcategoryCategory: document.getElementById('cash-expense-subcategory-category'), subcategoryName: document.getElementById('cash-expense-subcategory-name'), subcategoryPosition: document.getElementById('cash-expense-subcategory-position'), subcategoryActive: document.getElementById('cash-expense-subcategory-active'), subcategoryActiveField: document.getElementById('cash-expense-subcategory-active-field'), subcategoryFeedback: document.getElementById('cash-expense-subcategory-feedback'), subcategoryCancel: document.getElementById('cash-expense-subcategory-cancel'), subcategorySave: document.getElementById('cash-expense-subcategory-save'), subcategoryList: document.getElementById('cash-expense-subcategory-list'),
      productCatalogOpen: document.getElementById('cash-product-catalog-open'), productSaleOpen: document.getElementById('cash-product-sale-open'),
      productCatalogDialog: document.getElementById('cash-product-catalog-dialog'), productCatalogX: document.getElementById('cash-product-catalog-x'), productCatalogClose: document.getElementById('cash-product-catalog-close'), productCategoryNew: document.getElementById('cash-product-category-new'), productCategoryForm: document.getElementById('cash-product-category-form'), productCategoryName: document.getElementById('cash-product-category-name'), productCategorySortOrder: document.getElementById('cash-product-category-sort-order'), productCategoryActive: document.getElementById('cash-product-category-active'), productCategoryFeedback: document.getElementById('cash-product-category-feedback'), productCategoryCancel: document.getElementById('cash-product-category-cancel'), productCategoryList: document.getElementById('cash-product-category-list'), productNew: document.getElementById('cash-product-new'), productForm: document.getElementById('cash-product-form'), productName: document.getElementById('cash-product-name'), productCategory: document.getElementById('cash-product-category'), productPrice: document.getElementById('cash-product-price'), productCost: document.getElementById('cash-product-cost'), productDescription: document.getElementById('cash-product-description'), productSku: document.getElementById('cash-product-sku'), productSortOrder: document.getElementById('cash-product-sort-order'), productActive: document.getElementById('cash-product-active'), productFeedback: document.getElementById('cash-product-feedback'), productCancel: document.getElementById('cash-product-cancel'), productList: document.getElementById('cash-product-list'),
      productSaleDialog: document.getElementById('cash-product-sale-dialog'), productSaleX: document.getElementById('cash-product-sale-x'), productSaleCancel: document.getElementById('cash-product-sale-cancel'), productSaleForm: document.getElementById('cash-product-sale-form'), productSaleCustomer: document.getElementById('cash-product-sale-customer'), productSaleMethod: document.getElementById('cash-product-sale-method'), productSaleProduct: document.getElementById('cash-product-sale-product'), productSaleQuantity: document.getElementById('cash-product-sale-quantity'), productSaleAdd: document.getElementById('cash-product-sale-add'), productSaleItems: document.getElementById('cash-product-sale-items'), productSaleDiscount: document.getElementById('cash-product-sale-discount'), productSaleSubtotal: document.getElementById('cash-product-sale-subtotal'), productSaleDiscountPreview: document.getElementById('cash-product-sale-discount-preview'), productSaleTotal: document.getElementById('cash-product-sale-total'), productSaleObservation: document.getElementById('cash-product-sale-observation'), productSaleFeedback: document.getElementById('cash-product-sale-feedback'), productSaleSubmit: document.getElementById('cash-product-sale-submit'),
      appointmentProducts: document.getElementById('appointment-product-items'), appointmentProductTotal: document.getElementById('appointment-product-total'), appointmentProductSelect: document.getElementById('appointment-product-select'), appointmentProductQuantity: document.getElementById('appointment-product-quantity'), appointmentProductAdd: document.getElementById('appointment-product-add'), appointmentProductList: document.getElementById('appointment-product-list'), appointmentProductFeedback: document.getElementById('appointment-product-feedback'),
      createPayment: document.getElementById('appointment-create-payment'), createPaymentStatus: document.getElementById('appointment-create-payment-status'), createPaymentFields: document.getElementById('appointment-create-payment-fields'), createEstimatedTotalRow: document.getElementById('appointment-create-estimated-total-row'), createEstimatedTotal: document.getElementById('appointment-create-estimated-total'),
      createCollectTotal: document.getElementById('appointment-create-collect-total'), createDeposit: document.getElementById('appointment-create-deposit'), createDiscountToggle: document.getElementById('appointment-create-discount-toggle'), createDiscountPanel: document.getElementById('appointment-create-discount-panel'), createDiscountType: document.getElementById('appointment-create-discount-type'), createDiscountValue: document.getElementById('appointment-create-discount-value'), createDiscountValueLabel: document.getElementById('appointment-create-discount-value-label'), createDepositPanel: document.getElementById('appointment-create-deposit-panel'), createDepositAmount: document.getElementById('appointment-create-deposit-amount'), createDepositMethod: document.getElementById('appointment-create-deposit-method'),
      createPaymentPanel: document.getElementById('appointment-create-payment-panel'), createPaymentAmount: document.getElementById('appointment-create-payment-amount'), createPaymentMethod: document.getElementById('appointment-create-payment-method'), createPaymentLineTwo: document.getElementById('appointment-create-payment-line-two'), createPaymentAmountTwo: document.getElementById('appointment-create-payment-amount-two'), createPaymentMethodTwo: document.getElementById('appointment-create-payment-method-two'), createAddPaymentLine: document.getElementById('appointment-create-add-payment-line'), createPaymentObservation: document.getElementById('appointment-create-payment-observation'), createObservationRow: document.getElementById('appointment-create-observation-row'),
      createSummaryPrice: document.getElementById('appointment-create-summary-price'), createSummaryDiscount: document.getElementById('appointment-create-summary-discount'), createSummaryTotal: document.getElementById('appointment-create-summary-total'), createSummaryPaid: document.getElementById('appointment-create-summary-paid'), createSummaryDue: document.getElementById('appointment-create-summary-due'), createCashRequired: document.getElementById('appointment-create-cash-required'), createOpenCash: document.getElementById('appointment-create-open-cash'), createPaymentFeedback: document.getElementById('appointment-create-payment-feedback'),
      finance: document.getElementById('appointment-finance'), financeBalance: document.getElementById('appointment-finance-balance'), financeServiceSubtotal: document.getElementById('appointment-finance-service-subtotal'), financeProductSubtotal: document.getElementById('appointment-finance-product-subtotal'), financeDiscount: document.getElementById('appointment-finance-discount'), financeTotal: document.getElementById('appointment-finance-total'), financePaid: document.getElementById('appointment-finance-paid'), financeDue: document.getElementById('appointment-finance-due'), financeHistory: document.getElementById('appointment-finance-history'), financeFeedback: document.getElementById('appointment-finance-feedback'), totalForm: document.getElementById('appointment-total-form'), totalToggle: document.getElementById('appointment-adjust-total-toggle'), totalSubmit: document.getElementById('appointment-total-submit'), totalCancel: document.getElementById('appointment-total-cancel'), estimatedTotal: document.getElementById('appointment-estimated-total'), totalReason: document.getElementById('appointment-total-reason'), originalTotal: document.getElementById('appointment-original-total'), minimumTotal: document.getElementById('appointment-minimum-total'), minimumTotalRow: document.getElementById('appointment-minimum-total-row'), totalHelp: document.getElementById('appointment-total-help'), editCollectTotal: document.getElementById('appointment-edit-collect-total'), editDeposit: document.getElementById('appointment-edit-deposit'), editDiscountToggle: document.getElementById('appointment-edit-discount-toggle'), discountForm: document.getElementById('appointment-discount-form'), discountSubmit: document.getElementById('appointment-discount-submit'), discountType: document.getElementById('appointment-discount-type'), discountValue: document.getElementById('appointment-discount-value'), discountValueLabel: document.getElementById('appointment-discount-value-label'), discountHelp: document.getElementById('appointment-discount-help'), editDepositPanel: document.getElementById('appointment-edit-deposit-panel'), editDepositAmount: document.getElementById('appointment-edit-deposit-amount'), editDepositMethod: document.getElementById('appointment-edit-deposit-method'), editDepositSubmit: document.getElementById('appointment-edit-deposit-submit'), paymentForm: document.getElementById('appointment-edit-payment-panel'), paymentSubmit: document.getElementById('appointment-payment-submit'), paymentAmount: document.getElementById('appointment-payment-amount'), paymentMethod: document.getElementById('appointment-payment-method'), paymentLineTwo: document.getElementById('appointment-payment-line-two'), paymentAmountTwo: document.getElementById('appointment-payment-amount-two'), paymentMethodTwo: document.getElementById('appointment-payment-method-two'), addPaymentLine: document.getElementById('appointment-add-payment-line'), paymentCompleteRow: document.getElementById('appointment-payment-complete-row'), paymentComplete: document.getElementById('appointment-payment-complete'), editObservationRow: document.getElementById('appointment-edit-observation-row'), paymentObservation: document.getElementById('appointment-payment-observation'), cashRequired: document.getElementById('appointment-cash-required'), appointmentOpenCash: document.getElementById('appointment-open-cash')
    }
    state.cashRegister = { viewMode: 'day', periodPreset: 'month', periodPage: 1, periodTotalPages: 1, periodLoaded: false, professionalPeriodPreset: 'week', professionalPage: 1, professionalTotalPages: 1, professionalExpandedIds: new Set(), professionalSummaryResult: null, current: null, days: [], selectedDayId: null, entries: [], nextCursor: null, permissions: {}, responsibleUsers: [], expenseCategories: [], expenseSubcategories: [], editingExpenseCategoryId: null, editingExpenseSubcategoryId: null, productCategories: [], products: [], editingProductCategoryId: null, editingProductId: null, productSaleItems: [], productSaleIdempotencyKey: null, appointmentProductItems: [], appointmentProductRemovalId: null, sessionMode: 'open', returnToAppointment: false, searchTimer: null, eventSource: null, loaded: false, appointmentFinance: null, appointmentFinanceRequestId: 0, appointmentFinanceSummaryCache: {}, appointmentFinanceCache: {}, appointmentFinanceInFlight: {}, financeSummaryRefreshTimer: null, createFinance: { collectTotal: false, deposit: false, discount: false }, editFinance: { adjust: false, collectTotal: false, deposit: false, discount: false } }

    function cashCollection(payload, collectionKey) {
      if (Array.isArray(payload)) return payload
      if (collectionKey && Array.isArray(payload?.[collectionKey])) return payload[collectionKey]
      if (Array.isArray(payload?.items)) return payload.items
      if (Array.isArray(payload?.data)) return payload.data
      return []
    }

    function activeCashProducts() { return state.cashRegister.products.filter((product) => product.isActive !== false) }
    function cashProductCategoryName(categoryId) { return state.cashRegister.productCategories.find((category) => category.id === categoryId)?.name || 'Sin categor&iacute;a' }

    function renderCashProductOptions() {
      const categoryOptions = state.cashRegister.productCategories.filter((category) => category.isActive !== false).map((category) => '<option value="' + escapeHtml(category.id) + '">' + escapeHtml(category.name) + '</option>').join('')
      cashUi.productCategory.innerHTML = categoryOptions || '<option value="">Sin categor&iacute;as</option>'
      const productOptions = activeCashProducts().map((product) => '<option value="' + escapeHtml(product.id) + '">' + escapeHtml(product.name) + ' · ' + escapeHtml(cashMoney(product.salePrice)) + '</option>').join('')
      cashUi.productSaleProduct.innerHTML = productOptions || '<option value="">No hay productos activos</option>'
      cashUi.appointmentProductSelect.innerHTML = productOptions || '<option value="">No hay productos activos</option>'
    }

    function renderCashProductCatalog() {
      const mayManage = canUseCashPermission('canManageProducts')
      cashUi.productCategoryNew.hidden = !mayManage
      cashUi.productNew.hidden = !mayManage
      if (!mayManage) { cashUi.productCategoryForm.hidden = true; cashUi.productForm.hidden = true }
      cashUi.productCategoryList.innerHTML = state.cashRegister.productCategories.map((category) => '<article class="cash-category-row' + (category.isActive === false ? ' inactive' : '') + '"><strong>' + escapeHtml(category.name) + '</strong><small>' + (category.isActive === false ? 'Inactiva' : 'Activa') + '</small><span></span>' + (mayManage ? '<button class="secondary" type="button" data-product-category-edit="' + escapeHtml(category.id) + '">Editar</button>' : '<span></span>') + '</article>').join('') || '<div class="cash-inline-state">Todav&iacute;a no hay categor&iacute;as.</div>'
      cashUi.productList.innerHTML = state.cashRegister.products.map((product) => '<article class="cash-product-row' + (product.isActive === false ? ' inactive' : '') + '"><div><strong>' + escapeHtml(product.name) + '</strong><small>' + escapeHtml(product.sku || 'Sin c&oacute;digo') + '</small></div><span>' + escapeHtml(cashProductCategoryName(product.categoryId)) + '</span><strong>' + escapeHtml(cashMoney(product.salePrice)) + '</strong>' + (mayManage ? '<button class="secondary" type="button" data-product-edit="' + escapeHtml(product.id) + '">Editar</button>' : '<span></span>') + '</article>').join('') || '<div class="cash-inline-state">Todav&iacute;a no hay productos.</div>'
      renderCashProductOptions()
    }

    async function loadCashProducts() {
      const [categoriesResult, productsResult] = await Promise.allSettled([getJson(cashScoped('/product-categories')), getJson(cashScoped('/products'))])
      state.cashRegister.productCategories = categoriesResult.status === 'fulfilled' ? cashCollection(categoriesResult.value, 'categories') : []
      state.cashRegister.products = productsResult.status === 'fulfilled' ? cashCollection(productsResult.value, 'products') : []
      renderCashProductCatalog()
      if (categoriesResult.status === 'rejected') {
        cashUi.productCategoryList.innerHTML = '<div class="cash-inline-state">No pudimos cargar las categor&iacute;as. ' + escapeHtml(categoriesResult.reason?.message || 'Revis&aacute; el permiso Ver productos.') + '</div>'
      }
      if (productsResult.status === 'rejected') {
        cashUi.productList.innerHTML = '<div class="cash-inline-state">No pudimos cargar los productos. ' + escapeHtml(productsResult.reason?.message || 'Revis&aacute; el permiso Ver productos.') + '</div>'
      }
    }

    async function openCashProductCatalog() {
      cashUi.productCatalogDialog.hidden = false
      renderCashProductCatalog()
      cashUi.productCategoryList.innerHTML = '<div class="cash-inline-state">Cargando categor&iacute;as...</div>'
      cashUi.productList.innerHTML = '<div class="cash-inline-state">Cargando productos...</div>'
      await loadCashProducts()
    }
    function closeCashProductCatalog() { cashUi.productCatalogDialog.hidden = true; cashUi.productForm.hidden = true; cashUi.productCategoryForm.hidden = true }

    function editCashProductCategory(categoryId) {
      const category = state.cashRegister.productCategories.find((item) => item.id === categoryId)
      state.cashRegister.editingProductCategoryId = category?.id || null
      cashUi.productCategoryName.value = category?.name || ''
      cashUi.productCategorySortOrder.value = String(category?.sortOrder || 0)
      cashUi.productCategoryActive.checked = category?.isActive !== false
      cashUi.productCategoryFeedback.textContent = ''
      cashUi.productCategoryForm.hidden = false
      requestAnimationFrame(() => cashUi.productCategoryName.focus())
    }

    async function submitCashProductCategory(event) {
      event.preventDefault()
      const categoryId = state.cashRegister.editingProductCategoryId
      const name = cashUi.productCategoryName.value.trim(); const sortOrder = Number(cashUi.productCategorySortOrder.value)
      if (!name) { cashUi.productCategoryFeedback.textContent = 'Ingresá un nombre.'; cashUi.productCategoryFeedback.className = 'cash-feedback error'; return }
      try {
        const path = categoryId ? '/product-categories/' + encodeURIComponent(categoryId) : '/product-categories'
        await getJson(path, { method: categoryId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, sortOrder, isActive: cashUi.productCategoryActive.checked, ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) }) })
        cashUi.productCategoryForm.hidden = true; await loadCashProducts(); showCrmToast('Categor&iacute;a de producto guardada.', 'success')
      } catch (error) { cashUi.productCategoryFeedback.textContent = error.message; cashUi.productCategoryFeedback.className = 'cash-feedback error' }
    }

    function editCashProduct(productId) {
      const product = state.cashRegister.products.find((item) => item.id === productId)
      state.cashRegister.editingProductId = product?.id || null
      cashUi.productName.value = product?.name || ''
      cashUi.productCategory.value = product?.categoryId || state.cashRegister.productCategories.find((item) => item.isActive !== false)?.id || ''
      cashUi.productPrice.value = product ? String(product.salePrice) : ''
      cashUi.productDescription.value = product?.description || ''
      cashUi.productCost.value = product?.cost === null || product?.cost === undefined ? '' : String(product.cost)
      cashUi.productSku.value = product?.sku || ''
      cashUi.productSortOrder.value = String(product?.sortOrder || 0)
      cashUi.productActive.checked = product?.isActive !== false
      cashUi.productFeedback.textContent = ''
      cashUi.productForm.hidden = false
      requestAnimationFrame(() => cashUi.productName.focus())
    }

    async function submitCashProduct(event) {
      event.preventDefault()
      const productId = state.cashRegister.editingProductId
      const name = cashUi.productName.value.trim(); const salePrice = Number(cashUi.productPrice.value); const sortOrder = Number(cashUi.productSortOrder.value); const costText = cashUi.productCost.value.trim(); const cost = costText ? Number(costText) : null
      if (!name || !cashUi.productCategory.value || !Number.isSafeInteger(salePrice) || salePrice < 0 || !Number.isSafeInteger(sortOrder) || sortOrder < 0 || (cost !== null && (!Number.isSafeInteger(cost) || cost < 0))) { cashUi.productFeedback.textContent = 'Completá nombre, categoría y montos enteros válidos.'; cashUi.productFeedback.className = 'cash-feedback error'; return }
      try {
        const path = productId ? '/products/' + encodeURIComponent(productId) : '/products'
        await getJson(path, { method: productId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, categoryId: cashUi.productCategory.value, description: cashUi.productDescription.value.trim() || null, salePrice, cost, sortOrder, sku: cashUi.productSku.value.trim() || null, isActive: cashUi.productActive.checked, ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) }) })
        cashUi.productForm.hidden = true; await loadCashProducts(); showCrmToast('Producto guardado.', 'success')
      } catch (error) { cashUi.productFeedback.textContent = error.message; cashUi.productFeedback.className = 'cash-feedback error' }
    }

    function renderCashProductSale() {
      const items = state.cashRegister.productSaleItems
      cashUi.productSaleItems.innerHTML = items.map((item) => '<article class="cash-sale-item"><div><strong>' + escapeHtml(item.name) + '</strong><small>Precio unitario ' + escapeHtml(cashMoney(item.unitPrice)) + '</small></div><span>' + item.quantity + ' u.</span><strong>' + escapeHtml(cashMoney(item.quantity * item.unitPrice)) + '</strong><button class="secondary" type="button" data-product-sale-remove="' + escapeHtml(item.productId) + '">Quitar</button></article>').join('') || '<div class="cash-inline-state">Agregá al menos un producto.</div>'
      const subtotal = items.reduce((total, item) => total + item.quantity * item.unitPrice, 0)
      const rawDiscount = Number(cashUi.productSaleDiscount.value || 0)
      const discountAmount = Number.isSafeInteger(rawDiscount) && rawDiscount >= 0 ? Math.min(rawDiscount, subtotal) : 0
      cashUi.productSaleSubtotal.textContent = cashMoney(subtotal)
      cashUi.productSaleDiscountPreview.textContent = cashMoney(discountAmount)
      cashUi.productSaleTotal.textContent = cashMoney(subtotal - discountAmount)
    }

    function addCashProductSaleItem() {
      const product = activeCashProducts().find((item) => item.id === cashUi.productSaleProduct.value); const quantity = Number(cashUi.productSaleQuantity.value)
      if (!product || !Number.isSafeInteger(quantity) || quantity <= 0) { cashUi.productSaleFeedback.textContent = 'Elegí un producto y una cantidad válida.'; cashUi.productSaleFeedback.className = 'cash-feedback error'; return }
      const existing = state.cashRegister.productSaleItems.find((item) => item.productId === product.id)
      if (existing) existing.quantity += quantity; else state.cashRegister.productSaleItems.push({ productId: product.id, name: product.name, quantity, unitPrice: Number(product.salePrice) })
      cashUi.productSaleQuantity.value = '1'; cashUi.productSaleFeedback.textContent = ''; renderCashProductSale()
    }

    async function openCashProductSale() {
      if (!state.cashRegister.current?.session?.id) { showCrmToast('Abr&iacute; una sesi&oacute;n de Caja antes de registrar una venta.', 'error'); return }
      cashUi.productSaleForm.reset(); state.cashRegister.productSaleItems = []; state.cashRegister.productSaleIdempotencyKey = window.crypto?.randomUUID ? window.crypto.randomUUID() : 'sale-' + Date.now() + '-' + Math.random().toString(36).slice(2); cashUi.productSaleFeedback.textContent = ''
      cashUi.productSaleCustomer.innerHTML = '<option value="">Sin cliente</option>' + state.customers.map((customer) => '<option value="' + escapeHtml(customer.id) + '">' + escapeHtml(customer.name) + (customer.phone ? ' · ' + escapeHtml(customer.phone) : '') + '</option>').join('')
      try { if (!state.cashRegister.products.length) await loadCashProducts() } catch (error) { showCrmToast(error.message, 'error'); return }
      renderCashProductSale(); cashUi.productSaleDialog.hidden = false
    }

    async function submitCashProductSale(event) {
      event.preventDefault()
      if (!state.cashRegister.productSaleItems.length) { cashUi.productSaleFeedback.textContent = 'Agregá al menos un producto.'; cashUi.productSaleFeedback.className = 'cash-feedback error'; return }
      const items = state.cashRegister.productSaleItems.map(({ productId, quantity }) => ({ productId, quantity }))
      const subtotal = state.cashRegister.productSaleItems.reduce((total, item) => total + item.quantity * item.unitPrice, 0)
      const discountAmount = Number(cashUi.productSaleDiscount.value || 0)
      if (!Number.isSafeInteger(discountAmount) || discountAmount < 0 || discountAmount > subtotal) { cashUi.productSaleFeedback.textContent = 'El descuento debe ser un monto entero entre $0 y el subtotal.'; cashUi.productSaleFeedback.className = 'cash-feedback error'; return }
      const payload = { idempotencyKey: state.cashRegister.productSaleIdempotencyKey, discountAmount, cashSessionId: state.cashRegister.current?.session?.id, customerId: cashUi.productSaleCustomer.value || undefined, paymentMethod: cashUi.productSaleMethod.value, items, observation: cashUi.productSaleObservation.value.trim() || undefined, ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) }
      if (!setButtonLoading(cashUi.productSaleSubmit, true, 'Registrando...')) return
      try { await getJson('/product-sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); cashUi.productSaleDialog.hidden = true; state.cashRegister.productSaleIdempotencyKey = null; await loadCashRegister(); showCrmToast('Venta registrada en Caja.', 'success') }
      catch (error) { cashUi.productSaleFeedback.textContent = error.message; cashUi.productSaleFeedback.className = 'cash-feedback error' }
      finally { setButtonLoading(cashUi.productSaleSubmit, false) }
    }

    function renderAppointmentProductItems() {
      const items = state.cashRegister.appointmentProductItems
      cashUi.appointmentProductList.innerHTML = items.map((item) => '<article class="appointment-product-item"><div><strong>' + escapeHtml(item.productName || item.name || 'Producto') + '</strong><small>Precio unitario ' + escapeHtml(cashMoney(item.unitPrice)) + '</small></div><label>Cantidad<input data-appointment-product-quantity="' + escapeHtml(item.id) + '" type="number" min="1" step="1" value="' + item.quantity + '"></label><strong>' + escapeHtml(cashMoney(item.totalAmount ?? item.lineTotal ?? item.subtotal ?? item.quantity * item.unitPrice)) + '</strong><span><button class="secondary" type="button" data-appointment-product-update="' + escapeHtml(item.id) + '">Actualizar</button> <button class="secondary" type="button" data-appointment-product-remove="' + escapeHtml(item.id) + '">' + (state.cashRegister.appointmentProductRemovalId === item.id ? 'Confirmar quitar' : 'Quitar') + '</button></span></article>').join('') || '<div class="cash-inline-state">Todav&iacute;a no hay productos.</div>'
      cashUi.appointmentProductTotal.textContent = cashMoney(items.reduce((total, item) => total + Number(item.totalAmount ?? item.lineTotal ?? item.subtotal ?? item.quantity * item.unitPrice), 0))
    }

    async function loadAppointmentProductItems(appointmentId) {
      const payload = await getJson('/appointments/' + encodeURIComponent(appointmentId) + '/product-items' + (isCashBusinessScopedRole() ? '?businessId=' + encodeURIComponent(state.businessId) : ''))
      if (appointmentId !== state.editingAppointmentId) return
      state.cashRegister.appointmentProductItems = cashCollection(payload); renderAppointmentProductItems()
    }

    function prepareAppointmentProducts(appointment) {
      const visible = Boolean(appointment) && canUseCashPermission('canSellProducts')
      cashUi.appointmentProducts.hidden = !visible; cashUi.appointmentProducts.open = false
      state.cashRegister.appointmentProductItems = []; state.cashRegister.appointmentProductRemovalId = null; renderAppointmentProductItems()
      if (!visible) return
      cashUi.appointmentProductFeedback.textContent = ''
      if (!state.cashRegister.products.length) loadCashProducts().catch((error) => { cashUi.appointmentProductFeedback.textContent = error.message })
      loadAppointmentProductItems(appointment.id).catch((error) => { cashUi.appointmentProductFeedback.textContent = error.message; cashUi.appointmentProductFeedback.className = 'appointment-finance-feedback error' })
    }

    async function addAppointmentProductItem() {
      const appointmentId = state.editingAppointmentId; const productId = cashUi.appointmentProductSelect.value; const quantity = Number(cashUi.appointmentProductQuantity.value)
      if (!appointmentId || !productId || !Number.isSafeInteger(quantity) || quantity <= 0) { cashUi.appointmentProductFeedback.textContent = 'Elegí un producto y una cantidad válida.'; cashUi.appointmentProductFeedback.className = 'appointment-finance-feedback error'; return }
      try {
        await getJson('/appointments/' + encodeURIComponent(appointmentId) + '/product-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId, quantity, ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) }) })
        cashUi.appointmentProductQuantity.value = '1'; await Promise.all([loadAppointmentProductItems(appointmentId), loadAppointmentFinance({ force: true, preserve: true })]); showCrmToast('Producto agregado al turno.', 'success')
      } catch (error) { cashUi.appointmentProductFeedback.textContent = error.message; cashUi.appointmentProductFeedback.className = 'appointment-finance-feedback error' }
    }

    async function updateAppointmentProductItem(itemId) {
      const appointmentId = state.editingAppointmentId
      const input = cashUi.appointmentProductList.querySelector('[data-appointment-product-quantity="' + CSS.escape(itemId) + '"]')
      const quantity = Number(input?.value)
      if (!Number.isSafeInteger(quantity) || quantity <= 0) { cashUi.appointmentProductFeedback.textContent = 'La cantidad debe ser un entero mayor a cero.'; cashUi.appointmentProductFeedback.className = 'appointment-finance-feedback error'; return }
      try {
        await getJson('/appointments/' + encodeURIComponent(appointmentId) + '/product-items/' + encodeURIComponent(itemId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity, ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) }) })
        await Promise.all([loadAppointmentProductItems(appointmentId), loadAppointmentFinance({ force: true, preserve: true })]); showCrmToast('Cantidad actualizada.', 'success')
      } catch (error) { cashUi.appointmentProductFeedback.textContent = error.message; cashUi.appointmentProductFeedback.className = 'appointment-finance-feedback error' }
    }

    async function removeAppointmentProductItem(itemId) {
      if (state.cashRegister.appointmentProductRemovalId !== itemId) { state.cashRegister.appointmentProductRemovalId = itemId; renderAppointmentProductItems(); return }
      const appointmentId = state.editingAppointmentId
      try {
        await getJson('/appointments/' + encodeURIComponent(appointmentId) + '/product-items/' + encodeURIComponent(itemId), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) })
        state.cashRegister.appointmentProductRemovalId = null; await Promise.all([loadAppointmentProductItems(appointmentId), loadAppointmentFinance({ force: true, preserve: true })]); showCrmToast('Producto quitado del turno.', 'success')
      } catch (error) { cashUi.appointmentProductFeedback.textContent = error.message; cashUi.appointmentProductFeedback.className = 'appointment-finance-feedback error' }
    }

    function canUseCashPermission(permission) {
      if (['BUSINESS_ADMIN', 'ACCOUNT_ADMIN', 'SUPER_ADMIN'].includes(state.currentUser?.role)) return true
      if (state.currentUser?.role !== 'STAFF') return false
      return state.currentUser?.[permission] === true
    }

    function isCashBusinessScopedRole() {
      return ['ACCOUNT_ADMIN', 'SUPER_ADMIN'].includes(state.currentUser?.role)
    }

    function cashMoney(value) {
      return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(value || 0))
    }

    function cashSignedMoney(value) {
      const amount = Number(value || 0)
      if (amount === 0) return cashMoney(0)
      return (amount > 0 ? '+' : '−') + cashMoney(Math.abs(amount))
    }

    function cashDate(value) {
      return value ? new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: state.business?.timezone }) : '--'
    }

    function cashScoped(path) {
      if (!isCashBusinessScopedRole() || !state.businessId) return path
      return path + (path.includes('?') ? '&' : '?') + 'businessId=' + encodeURIComponent(state.businessId)
    }

    function stopCashRealtimeEvents() {
      state.cashRegister.eventSource?.close()
      state.cashRegister.eventSource = null
    }

    function startCashRealtimeEvents() {
      stopCashRealtimeEvents()
      if (!window.EventSource || !state.businessId || !(canUseCashPermission('canViewCashRegister') || canUseCashPermission('canViewProfessionalSettlements') || canUseCashPermission('canRecordAppointmentPayments') || canUseCashPermission('canApplyDiscounts'))) return
      const source = new EventSource(cashScoped('/crm/cash-events'))
      state.cashRegister.eventSource = source
      source.addEventListener('cash_changed', (event) => {
        let payload
        try { payload = JSON.parse(event.data) } catch { return }
        if (payload.businessId !== state.businessId || !payload.entityId) return
        if (document.body.dataset.currentSection === 'cash') loadCashRegister({ preserve: true }).catch((error) => showCrmToast(error.message, 'error'))
        refreshVisibleAppointmentFinanceSummaries()
        if (state.editingAppointmentId && cashUi.finance.open && !cashUi.finance.hidden) loadAppointmentFinance({ force: true, preserve: true })
      })
    }

    function appointmentFinanceCacheKey(appointmentId) {
      return String(state.businessId || '') + ':' + String(appointmentId || '')
    }

    function cacheAppointmentFinanceSummary(appointmentId, summary) {
      const key = appointmentFinanceCacheKey(appointmentId)
      if (summary) state.cashRegister.appointmentFinanceSummaryCache[key] = summary
      else delete state.cashRegister.appointmentFinanceSummaryCache[key]
      const appointment = state.agendaAppointments.find((item) => item.id === appointmentId)
      if (appointment) appointment.financeSummary = summary || null
    }

    function cacheAgendaAppointmentFinanceSummaries(appointments) {
      for (const appointment of appointments || []) {
        if (Object.prototype.hasOwnProperty.call(appointment, 'financeSummary')) {
          cacheAppointmentFinanceSummary(appointment.id, appointment.financeSummary)
        }
      }
    }

    function refreshVisibleAppointmentFinanceSummaries() {
      clearTimeout(state.cashRegister.financeSummaryRefreshTimer)
      if (!state.businessId || !(canUseCashPermission('canRecordAppointmentPayments') || canUseCashPermission('canApplyDiscounts'))) return
      state.cashRegister.financeSummaryRefreshTimer = setTimeout(async () => {
        const businessId = state.businessId
        const rangeStart = startOfDay(state.agendaSelectedDate || new Date())
        const viewDays = [1, 3, 7].includes(Number(state.agendaViewDays)) ? Number(state.agendaViewDays) : 1
        const params = new URLSearchParams({
          businessId,
          from: rangeStart.toISOString(),
          to: addDays(rangeStart, viewDays).toISOString()
        })
        if (els.agendaProfessional.value) params.set('professionalId', els.agendaProfessional.value)
        try {
          const rows = await getJson('/appointments/finance-summaries?' + params.toString())
          if (state.businessId !== businessId) return
          for (const row of rows) {
            cacheAppointmentFinanceSummary(row.appointmentId, row.financeSummary)
            delete state.cashRegister.appointmentFinanceCache[appointmentFinanceCacheKey(row.appointmentId)]
          }
          if (els.appShell.dataset.section === 'agenda') renderAgenda()
          if (state.editingAppointmentId && !cashUi.finance.open) {
            const summary = state.cashRegister.appointmentFinanceSummaryCache[appointmentFinanceCacheKey(state.editingAppointmentId)]
            if (summary) renderAppointmentFinanceSummary(summary)
          }
        } catch {
          // El evento es una mejora oportunista: la próxima carga normal vuelve a sincronizar el resumen.
        }
      }, 140)
    }

    function renderCashResponsibleOptions() {
      const users = state.cashRegister.responsibleUsers.concat([state.currentUser ? { id: state.currentUser.id, name: state.currentUser.name || 'Administrador', role: state.currentUser.role } : null])
      const unique = new Map(users.filter((user) => user?.id && user.isActive !== false).map((user) => [user.id, user]))
      cashUi.sessionResponsible.innerHTML = Array.from(unique.values()).map((user) => {
        const label = user.role === 'BUSINESS_ADMIN' || user.role === 'ACCOUNT_ADMIN' || user.role === 'SUPER_ADMIN'
          ? 'Administrador del local · ' + user.name
          : user.name
        return '<option value="' + escapeHtml(user.id) + '">' + escapeHtml(label) + '</option>'
      }).join('')
      if (unique.has(state.currentUser?.id)) cashUi.sessionResponsible.value = state.currentUser.id
    }

    async function loadCashResponsibleOptions() {
      if (!canUseCashPermission('canManageCashSessions')) return
      state.cashRegister.responsibleUsers = await getJson(cashScoped('/cash-register/responsibles'))
      renderCashResponsibleOptions()
    }

    function renderCashCurrent() {
      const current = state.cashRegister.current
      const isOpen = Boolean(current?.day && current?.session)
      const hasHistory = Boolean(state.cashRegister.selectedDayId)
      cashUi.status.textContent = isOpen ? 'Caja abierta' : 'Caja cerrada'
      cashUi.status.classList.toggle('open', isOpen)
      const showingPeriod = state.cashRegister.viewMode === 'period'
      const showingProfessionals = state.cashRegister.viewMode === 'professionals'
      const showingOperationalCash = !showingPeriod && !showingProfessionals && state.cashRegister.viewMode !== 'treasury'
      cashUi.empty.hidden = !showingOperationalCash || isOpen || hasHistory
      cashUi.dashboard.hidden = !showingOperationalCash || (!isOpen && !hasHistory)
      cashUi.sessionStrip.hidden = !showingOperationalCash || !isOpen
      cashUi.openToolbar.hidden = !showingOperationalCash || isOpen || !canUseCashPermission('canManageCashSessions')
      cashUi.openEmpty.hidden = !showingOperationalCash || !canUseCashPermission('canManageCashSessions')
      cashUi.emptyCopy.textContent = canUseCashPermission('canManageCashSessions') ? 'Abrí una jornada para registrar cobros y operaciones manuales.' : 'Necesitás un responsable autorizado para abrir la Caja.'
      cashUi.daySelect.disabled = state.currentUser?.role === 'STAFF'
      cashUi.daySelect.innerHTML = state.cashRegister.days.map((day) => {
        const difference = day.closedAt && day.closingDifference !== null && Number(day.closingDifference) !== 0
          ? ' · Dif. ' + cashSignedMoney(day.closingDifference)
          : ''
        return '<option value="' + escapeHtml(day.id) + '"' + (day.id === state.cashRegister.selectedDayId ? ' selected' : '') + '>' + escapeHtml(cashDate(day.openedAt)) + (day.closedAt ? ' · Cerrada' : ' · Abierta') + escapeHtml(difference) + '</option>'
      }).join('')
      if (!isOpen) return
      cashUi.responsible.textContent = current.session.responsibleName || 'Responsable'
      cashUi.sessionTime.textContent = 'Desde ' + cashDate(current.session.openedAt)
      cashUi.operationOpen.hidden = !(canUseCashPermission('canManageCashOperations') || canUseCashPermission('canAdjustCash'))
      cashUi.productSaleOpen.hidden = !canUseCashPermission('canSellProducts')
      cashUi.productCatalogOpen.hidden = !canUseCashPermission('canViewProducts')
      cashUi.newSession.hidden = !canUseCashPermission('canManageCashSessions')
      cashUi.closeDay.hidden = !canUseCashPermission('canManageCashSessions')
    }

    function renderCashSessions(sessions, currentSessionExpectedCash) {
      const rows = Array.isArray(sessions) ? sessions : []
      cashUi.sessionCount.textContent = rows.length + (rows.length === 1 ? ' sesión' : ' sesiones')
      const selectedSession = cashUi.sessionFilter.value
      cashUi.sessionFilter.innerHTML = '<option value="">Todas las sesiones</option>' + rows.map((session) => '<option value="' + escapeHtml(session.id) + '">' + escapeHtml(session.responsibleName || 'Responsable') + ' · ' + escapeHtml(cashDate(session.openedAt)) + '</option>').join('')
      if (rows.some((session) => session.id === selectedSession)) cashUi.sessionFilter.value = selectedSession
      if (!rows.length) {
        cashUi.sessionList.innerHTML = '<div class="cash-inline-state">No hay sesiones registradas.</div>'
        return
      }
      cashUi.sessionList.innerHTML = rows.map((session) => {
        const expected = session.expectedCash ?? (session.closedAt ? null : currentSessionExpectedCash)
        const counted = session.countedCash
        const difference = session.cashDifference
        const differenceClass = Number(difference) > 0 ? ' positive' : Number(difference) < 0 ? ' negative' : ''
        const period = cashDate(session.openedAt) + (session.closedAt ? ' — ' + cashDate(session.closedAt) : ' — Activa')
        return '<article class="cash-session-row"><div><strong>' + escapeHtml(session.responsibleName || 'Responsable') + '</strong><small>' + escapeHtml(period) + '</small></div><div><span>Esperado</span><strong>' + (expected === null || expected === undefined ? '--' : escapeHtml(cashMoney(expected))) + '</strong></div><div><span>Contado</span><strong>' + (counted === null || counted === undefined ? '--' : escapeHtml(cashMoney(counted))) + '</strong></div><div><span>Diferencia</span><strong class="cash-session-difference' + differenceClass + '">' + (difference === null || difference === undefined ? '--' : escapeHtml(cashSignedMoney(difference))) + '</strong></div></article>'
      }).join('')
    }

    function renderCashSummary(day, summary, sessions = [], currentSessionExpectedCash = null) {
      if (!summary) return
      cashUi.gross.textContent = cashMoney(summary.grossCollected)
      cashUi.methodCash.textContent = cashMoney(summary.collectedByMethod?.CASH)
      cashUi.methodTransfer.textContent = cashMoney(summary.collectedByMethod?.TRANSFER)
      cashUi.methodCard.textContent = cashMoney(summary.collectedByMethod?.CARD)
      cashUi.net.textContent = cashMoney(summary.net)
      cashUi.outgoing.textContent = cashMoney(Number(summary.expenses || 0) + Number(summary.refunds || 0))
      cashUi.refunds.textContent = 'Gastos ' + cashMoney(summary.expenses) + ' · Devoluciones ' + cashMoney(summary.refunds)
      for (const [method, outgoingNode, totalNode] of [['CASH', cashUi.outgoingCash, cashUi.totalCash], ['TRANSFER', cashUi.outgoingTransfer, cashUi.totalTransfer], ['CARD', cashUi.outgoingCard, cashUi.totalCard]]) {
        const outgoing = Number(summary.outgoingByMethod?.[method] || 0)
        outgoingNode.textContent = cashMoney(outgoing)
        totalNode.textContent = cashMoney(Number(summary.collectedByMethod?.[method] || 0) - outgoing)
      }
      const unknownCollected = Number(summary.grossCollected || 0) - ['CASH', 'TRANSFER', 'CARD'].reduce((sum, method) => sum + Number(summary.collectedByMethod?.[method] || 0), 0)
      const unknownOutgoing = Number(summary.outgoingByMethod?.UNSPECIFIED || 0)
      for (const [row, node, amount] of [[cashUi.unknownCollectedRow, cashUi.unknownCollected, unknownCollected], [cashUi.unknownOutgoingRow, cashUi.unknownOutgoing, unknownOutgoing], [cashUi.unknownTotalRow, cashUi.unknownTotal, unknownCollected - unknownOutgoing]]) {
        row.hidden = amount === 0
        node.textContent = cashMoney(amount)
      }
      cashUi.incoming.textContent = 'No incluye aportes ' + cashMoney(summary.cashIn) + ' ni retiros ' + cashMoney(summary.withdrawals)
      const isClosed = Boolean(day?.closedAt)
      const expectedCash = Number(day?.expectedClosingCash ?? summary.expectedCash)
      const countedCash = Number(day?.countedClosingCash ?? expectedCash)
      const difference = Number(day?.closingDifference ?? countedCash - expectedCash)
      cashUi.balanceLabel.textContent = isClosed ? 'Efectivo contado' : 'Efectivo esperado'
      cashUi.expected.textContent = cashMoney(isClosed ? countedCash : summary.expectedCash)
      cashUi.opening.textContent = isClosed
        ? 'Esperado ' + cashMoney(expectedCash) + ' · Diferencia ' + cashSignedMoney(difference)
        : 'Inicial ' + cashMoney(day?.openingCash)
      cashUi.reconciliation.hidden = !isClosed || difference === 0
      cashUi.reconciliationAmount.textContent = cashSignedMoney(difference)
      cashUi.reconciliationCopy.textContent = difference > 0
        ? 'Se contó más efectivo del esperado. La diferencia quedó registrada y requiere revisión.'
        : 'Se contó menos efectivo del esperado. La diferencia quedó registrada y requiere revisión.'
      renderCashSessions(sessions, currentSessionExpectedCash)
    }

    const cashTypeLabels = { PAYMENT: 'Cobro', LEGACY_PAYMENT: 'Pago anterior sin especificar', EXPENSE: 'Gasto', WITHDRAWAL: 'Retiro', CASH_IN: 'Ingreso', ADJUSTMENT: 'Ajuste', REFUND: 'Devolución', REVERSAL: 'Contrapartida' }
    const cashMethodLabels = { CASH: 'Efectivo', TRANSFER: 'Transferencia / Mercado Pago', CARD: 'Tarjeta', UNSPECIFIED: 'Sin especificar' }

    function defaultCashExpenseCategory() {
      return state.cashRegister.expenseCategories.find((category) => category.isDefault) || null
    }

    function renderCashExpenseCategoryOptions() {
      const filterValue = cashUi.categoryFilter.value
      const operationValue = cashUi.operationCategory.value
      const categories = state.cashRegister.expenseCategories
      cashUi.categoryFilter.innerHTML = '<option value="">Todas las categor&iacute;as</option>' + categories.map((category) => '<option value="' + escapeHtml(category.id) + '">' + escapeHtml(category.name) + (category.isActive ? '' : ' (inactiva)') + '</option>').join('')
      if (categories.some((category) => category.id === filterValue)) cashUi.categoryFilter.value = filterValue
      const periodFilterValue = cashUi.periodCategoryFilter.value
      cashUi.periodCategoryFilter.innerHTML = '<option value="">Todas las categor&iacute;as</option>' + categories.map((category) => '<option value="' + escapeHtml(category.id) + '">' + escapeHtml(category.name) + '</option>').join('')
      if (categories.some((category) => category.id === periodFilterValue)) cashUi.periodCategoryFilter.value = periodFilterValue
      const active = categories.filter((category) => category.isActive)
      cashUi.operationCategory.innerHTML = active.map((category) => '<option value="' + escapeHtml(category.id) + '">' + escapeHtml(category.name) + '</option>').join('')
      const fallback = defaultCashExpenseCategory()
      cashUi.operationCategory.value = active.some((category) => category.id === operationValue)
        ? operationValue
        : (fallback?.id || active[0]?.id || '')
      cashUi.categoryManage.hidden = !canUseCashPermission('canManageCashOperations')
      renderCashExpenseSubcategoryOptions()
    }

    function renderCashExpenseSubcategoryOptions() {
      const subcategories = state.cashRegister.expenseSubcategories
      const categories = state.cashRegister.expenseCategories
      const option = (item) => {
        const category = categories.find((candidate) => candidate.id === item.categoryId)
        return '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(category?.name || 'Categor&iacute;a') + ' / ' + escapeHtml(item.name) + (item.isActive ? '' : ' (inactiva)') + '</option>'
      }
      for (const [categorySelect, subcategorySelect] of [[cashUi.categoryFilter, cashUi.subcategoryFilter], [cashUi.periodCategoryFilter, cashUi.periodSubcategoryFilter]]) {
        const previous = subcategorySelect.value
        const visible = subcategories.filter((item) => !categorySelect.value || item.categoryId === categorySelect.value)
        subcategorySelect.innerHTML = '<option value="">Todas las subcategor&iacute;as</option>' + visible.map(option).join('')
        if (visible.some((item) => item.id === previous)) subcategorySelect.value = previous
      }
      const current = cashUi.operationSubcategory.value
      const active = subcategories.filter((item) => item.isActive && item.categoryId === cashUi.operationCategory.value)
      cashUi.operationSubcategory.innerHTML = '<option value="">Sin subcategor&iacute;a</option>' + active.map((item) => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name) + '</option>').join('')
      if (active.some((item) => item.id === current)) cashUi.operationSubcategory.value = current
      const managerValue = cashUi.subcategoryCategory.value
      cashUi.subcategoryCategory.innerHTML = categories.filter((item) => item.isActive || item.id === state.cashRegister.expenseSubcategories.find((sub) => sub.id === state.cashRegister.editingExpenseSubcategoryId)?.categoryId).map((item) => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name) + '</option>').join('')
      if (categories.some((item) => item.id === managerValue && item.isActive)) cashUi.subcategoryCategory.value = managerValue
    }

    function renderCashExpenseSubcategoryList() {
      const categories = state.cashRegister.expenseCategories
      const subcategories = state.cashRegister.expenseSubcategories
      cashUi.subcategoryList.innerHTML = subcategories.length ? subcategories.map((item) => {
        const category = categories.find((candidate) => candidate.id === item.categoryId)
        return '<article class="cash-category-row' + (item.isActive ? '' : ' inactive') + '"><strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(category?.name || 'Categor&iacute;a') + '</small><small>' + (item.isActive ? 'Activa' : 'Inactiva') + '</small><button class="secondary" type="button" data-cash-subcategory-edit="' + escapeHtml(item.id) + '">Editar</button></article>'
      }).join('') : '<div class="cash-inline-state">Todav&iacute;a no hay subcategor&iacute;as.</div>'
    }

    function renderCashExpenseCategoryList() {
      const categories = state.cashRegister.expenseCategories
      if (!categories.length) {
        cashUi.categoryList.innerHTML = '<div class="cash-inline-state">No hay categor&iacute;as disponibles.</div>'
        return
      }
      cashUi.categoryList.innerHTML = categories.map((category) => '<article class="cash-category-row' + (category.isActive ? '' : ' inactive') + '">' +
        '<strong>' + escapeHtml(category.name) + (category.isDefault ? ' <small>Predeterminada</small>' : '') + '</strong>' +
        '<small>Orden ' + escapeHtml(String(category.position)) + '</small>' +
        '<small>' + (category.isActive ? 'Activa' : 'Inactiva') + '</small>' +
        '<button class="secondary" type="button" data-cash-category-edit="' + escapeHtml(category.id) + '">Editar</button>' +
        '</article>').join('')
    }

    async function loadCashExpenseCategories() {
      const params = new URLSearchParams({ includeInactive: 'true' })
      if (isCashBusinessScopedRole() && state.businessId) params.set('businessId', state.businessId)
      const [result, subcategories] = await Promise.all([
        getJson('/cash-register/expense-categories?' + params.toString()),
        getJson('/cash-register/expense-subcategories?' + params.toString())
      ])
      state.cashRegister.expenseCategories = result.categories || []
      state.cashRegister.expenseSubcategories = subcategories.subcategories || []
      renderCashExpenseCategoryOptions()
      renderCashExpenseCategoryList()
      renderCashExpenseSubcategoryList()
      renderTreasuryClassificationOptions()
    }

    function editCashExpenseCategory(categoryId) {
      const category = categoryId ? state.cashRegister.expenseCategories.find((item) => item.id === categoryId) : null
      state.cashRegister.editingExpenseCategoryId = category?.id || null
      cashUi.categoryForm.hidden = false
      cashUi.categoryFeedback.textContent = ''
      cashUi.categoryName.value = category?.name || ''
      cashUi.categoryName.readOnly = Boolean(category?.isDefault)
      cashUi.categoryPosition.value = String(category?.position ?? 0)
      cashUi.categoryActive.checked = category?.isActive ?? true
      cashUi.categoryActive.disabled = Boolean(category?.isDefault)
      cashUi.categoryActiveField.hidden = !category
      cashUi.categorySave.textContent = category ? 'Guardar cambios' : 'Crear categoría'
      requestAnimationFrame(() => (category?.isDefault ? cashUi.categoryPosition : cashUi.categoryName).focus())
    }

    function cancelCashExpenseCategoryEdit() {
      state.cashRegister.editingExpenseCategoryId = null
      cashUi.categoryForm.reset()
      cashUi.categoryForm.hidden = true
      cashUi.categoryName.readOnly = false
      cashUi.categoryActive.disabled = false
      cashUi.categoryFeedback.textContent = ''
    }

    function editCashExpenseSubcategory(subcategoryId) {
      const item = subcategoryId ? state.cashRegister.expenseSubcategories.find((candidate) => candidate.id === subcategoryId) : null
      state.cashRegister.editingExpenseSubcategoryId = item?.id || null
      cashUi.subcategoryForm.hidden = false
      cashUi.subcategoryFeedback.textContent = ''
      renderCashExpenseSubcategoryOptions()
      cashUi.subcategoryCategory.value = item?.categoryId || cashUi.operationCategory.value || cashUi.subcategoryCategory.value
      cashUi.subcategoryCategory.disabled = Boolean(item)
      cashUi.subcategoryName.value = item?.name || ''
      cashUi.subcategoryPosition.value = String(item?.position ?? 0)
      cashUi.subcategoryActive.checked = item?.isActive ?? true
      cashUi.subcategoryActiveField.hidden = !item
      cashUi.subcategorySave.textContent = item ? 'Guardar cambios' : 'Crear subcategoría'
      requestAnimationFrame(() => cashUi.subcategoryName.focus())
    }

    function cancelCashExpenseSubcategoryEdit() {
      state.cashRegister.editingExpenseSubcategoryId = null
      cashUi.subcategoryForm.reset()
      cashUi.subcategoryForm.hidden = true
      cashUi.subcategoryCategory.disabled = false
      cashUi.subcategoryFeedback.textContent = ''
    }

    async function submitCashExpenseSubcategory(event) {
      event.preventDefault()
      const editingId = state.cashRegister.editingExpenseSubcategoryId
      const payload = {
        categoryId: cashUi.subcategoryCategory.value,
        name: cashUi.subcategoryName.value,
        position: Number(cashUi.subcategoryPosition.value),
        ...(editingId ? { isActive: cashUi.subcategoryActive.checked } : {}),
        ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {})
      }
      if (!setButtonLoading(cashUi.subcategorySave, true, 'Guardando...')) return
      try {
        await getJson(editingId ? '/cash-register/expense-subcategories/' + encodeURIComponent(editingId) : '/cash-register/expense-subcategories', {
          method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        })
        cancelCashExpenseSubcategoryEdit()
        await loadCashExpenseCategories()
        cashUi.categoryFeedback.textContent = 'Subcategoría guardada.'
        cashUi.categoryFeedback.className = 'cash-feedback success'
      } catch (error) {
        cashUi.subcategoryFeedback.textContent = error.message
        cashUi.subcategoryFeedback.className = 'cash-feedback error'
      } finally { setButtonLoading(cashUi.subcategorySave, false) }
    }

    async function openCashExpenseCategoryDialog() {
      if (!canUseCashPermission('canManageCashOperations')) return
      cashUi.categoryDialog.hidden = false
      cancelCashExpenseCategoryEdit()
      cancelCashExpenseSubcategoryEdit()
      cashUi.categoryList.innerHTML = '<div class="cash-inline-state">Cargando categor&iacute;as...</div>'
      try {
        await loadCashExpenseCategories()
      } catch (error) {
        cashUi.categoryList.innerHTML = '<div class="cash-inline-state error">' + escapeHtml(error.message) + '</div>'
      }
    }

    function closeCashExpenseCategoryDialog() {
      cancelCashExpenseCategoryEdit()
      cancelCashExpenseSubcategoryEdit()
      cashUi.categoryDialog.hidden = true
    }

    async function submitCashExpenseCategory(event) {
      event.preventDefault()
      const editingId = state.cashRegister.editingExpenseCategoryId
      const payload = {
        name: cashUi.categoryName.value,
        position: Number(cashUi.categoryPosition.value),
        ...(editingId ? { isActive: cashUi.categoryActive.checked } : {}),
        ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {})
      }
      if (!setButtonLoading(cashUi.categorySave, true, 'Guardando...')) return
      try {
        await getJson(editingId ? '/cash-register/expense-categories/' + encodeURIComponent(editingId) : '/cash-register/expense-categories', {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        cancelCashExpenseCategoryEdit()
        await loadCashExpenseCategories()
        await loadCashEntries()
        showCrmToast(editingId ? 'Categoría actualizada.' : 'Categoría creada.', 'success')
      } catch (error) {
        cashUi.categoryFeedback.textContent = error.message
        cashUi.categoryFeedback.className = 'cash-feedback error'
      } finally { setButtonLoading(cashUi.categorySave, false) }
    }

    function renderCashEntries() {
      if (!state.cashRegister.entries.length) {
        cashUi.entryList.innerHTML = '<div class="cash-inline-state">No hay movimientos para estos filtros.</div>'
      } else {
        cashUi.entryList.innerHTML = state.cashRegister.entries.map((entry) => {
          const title = entry.description || entry.counterparty || (entry.customerNames || []).join(', ') || cashTypeLabels[entry.type] || entry.type
          const details = [cashTypeLabels[entry.type] || entry.type, entry.expenseCategoryName ? 'Categor&iacute;a: ' + escapeHtml(entry.expenseCategoryName) : '', entry.expenseSubcategoryName ? 'Subcategor&iacute;a: ' + escapeHtml(entry.expenseSubcategoryName) : '', entry.observation ? escapeHtml(entry.observation) : ''].filter(Boolean).join(' · ')
          return '<article class="cash-entry"><div class="cash-entry-main"><strong>' + escapeHtml(title) + '</strong><span>' + details + '</span></div><small>' + escapeHtml(cashMethodLabels[entry.method] || entry.method) + '</small><small>' + escapeHtml(cashDate(entry.effectiveAt)) + '</small><small>' + escapeHtml(entry.origin || '') + '</small><strong class="cash-entry-amount ' + entry.direction.toLowerCase() + '">' + (entry.direction === 'OUTFLOW' ? '−' : '+') + cashMoney(entry.amount) + '</strong></article>'
        }).join('')
      }
      cashUi.nextPage.hidden = !state.cashRegister.nextCursor
    }

    async function loadCashEntries(options = {}) {
      const dayId = state.cashRegister.selectedDayId
      if (!dayId) return
      if (!options.append && !options.preserve) cashUi.entryList.innerHTML = '<div class="cash-inline-state">Cargando movimientos...</div>'
      const params = new URLSearchParams({ limit: '40' })
      if (isCashBusinessScopedRole() && state.businessId) params.set('businessId', state.businessId)
      if (options.append && state.cashRegister.nextCursor) params.set('cursor', state.cashRegister.nextCursor)
      if (cashUi.typeFilter.value) params.set('type', cashUi.typeFilter.value)
      if (cashUi.methodFilter.value) params.set('method', cashUi.methodFilter.value)
      if (cashUi.categoryFilter.value) params.set('categoryId', cashUi.categoryFilter.value)
      if (cashUi.subcategoryFilter.value) params.set('subcategoryId', cashUi.subcategoryFilter.value)
      if (cashUi.sessionFilter.value) params.set('sessionId', cashUi.sessionFilter.value)
      if (cashUi.search.value.trim()) params.set('q', cashUi.search.value.trim())
      try {
        const page = await getJson('/cash-register/days/' + encodeURIComponent(dayId) + '/entries?' + params.toString())
        state.cashRegister.entries = options.append ? state.cashRegister.entries.concat(page.entries || []) : (page.entries || [])
        state.cashRegister.nextCursor = page.nextCursor || null
        renderCashEntries()
      } catch (error) {
        cashUi.entryList.innerHTML = '<div class="cash-inline-state error">' + escapeHtml(error.message) + '</div>'
      }
    }

    async function selectCashDay(dayId) {
      state.cashRegister.selectedDayId = dayId
      const result = await getJson(cashScoped('/cash-register/days/' + encodeURIComponent(dayId) + '/summary'))
      renderCashSummary(result.day, result.summary, result.sessions)
      await loadCashEntries()
    }

    function cashIsoDate(date) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return year + '-' + month + '-' + day
    }

    function cashPeriodDates(preset) {
      const today = new Date()
      const from = new Date(today.getFullYear(), today.getMonth(), today.getDate())
      const to = new Date(from)
      if (preset === 'week') {
        const mondayOffset = (from.getDay() + 6) % 7
        from.setDate(from.getDate() - mondayOffset)
        to.setDate(from.getDate() + 6)
      } else if (preset === 'month') {
        from.setDate(1)
        to.setMonth(to.getMonth() + 1, 0)
      }
      return { from: cashIsoDate(from), to: cashIsoDate(to) }
    }

    function setCashPeriodPreset(preset) {
      state.cashRegister.periodPreset = preset
      document.querySelectorAll('[data-cash-period-preset]').forEach((button) => button.classList.toggle('active', button.dataset.cashPeriodPreset === preset))
      if (preset !== 'custom') {
        const dates = cashPeriodDates(preset)
        cashUi.periodFrom.value = dates.from
        cashUi.periodTo.value = dates.to
      }
    }

    function validateCashPeriodDates() {
      if (!cashUi.periodFrom.value || !cashUi.periodTo.value) throw new Error('Elegí la fecha desde y hasta.')
      const from = new Date(cashUi.periodFrom.value + 'T00:00:00')
      const to = new Date(cashUi.periodTo.value + 'T00:00:00')
      const days = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1
      if (!Number.isFinite(days) || days < 1) throw new Error('La fecha hasta no puede ser anterior a la fecha desde.')
      if (days > 31) throw new Error('El período no puede superar 31 días.')
      return { from: cashUi.periodFrom.value, to: cashUi.periodTo.value }
    }

    function renderCashPeriodSummary(result) {
      const summary = result.summary || {}
      cashUi.periodGross.textContent = cashMoney(summary.grossCollected)
      cashUi.periodCash.textContent = cashMoney(summary.collectedByMethod?.CASH)
      cashUi.periodTransfer.textContent = cashMoney(summary.collectedByMethod?.TRANSFER)
      cashUi.periodCard.textContent = cashMoney(summary.collectedByMethod?.CARD)
      cashUi.periodExpensesTotal.textContent = cashMoney(Number(summary.expenses || 0) + Number(summary.refunds || 0))
      cashUi.periodRefunds.textContent = 'Gastos ' + cashMoney(summary.expenses) + ' · Devoluciones ' + cashMoney(summary.refunds)
      cashUi.periodResult.textContent = cashMoney(summary.operatingResult)
      for (const [method, outgoingNode, totalNode] of [['CASH', cashUi.periodOutgoingCash, cashUi.periodTotalCash], ['TRANSFER', cashUi.periodOutgoingTransfer, cashUi.periodTotalTransfer], ['CARD', cashUi.periodOutgoingCard, cashUi.periodTotalCard]]) {
        const outgoing = Number(summary.outgoingByMethod?.[method] || 0)
        outgoingNode.textContent = cashMoney(outgoing)
        totalNode.textContent = cashMoney(Number(summary.collectedByMethod?.[method] || 0) - outgoing)
      }
      const unknownCollected = Number(summary.grossCollected || 0) - ['CASH', 'TRANSFER', 'CARD'].reduce((sum, method) => sum + Number(summary.collectedByMethod?.[method] || 0), 0)
      const unknownOutgoing = Number(summary.outgoingByMethod?.UNSPECIFIED || 0)
      for (const [row, node, amount] of [[cashUi.periodUnknownCollectedRow, cashUi.periodUnknownCollected, unknownCollected], [cashUi.periodUnknownOutgoingRow, cashUi.periodUnknownOutgoing, unknownOutgoing], [cashUi.periodUnknownTotalRow, cashUi.periodUnknownTotal, unknownCollected - unknownOutgoing]]) {
        row.hidden = amount === 0
        node.textContent = cashMoney(amount)
      }
      cashUi.periodCashIn.textContent = cashMoney(summary.cashIn)
      cashUi.periodWithdrawals.textContent = cashMoney(summary.withdrawals)
      cashUi.periodAdjustments.textContent = cashSignedMoney(summary.adjustments)
      const categories = summary.expenseByCategory || []
      cashUi.periodCategoryList.innerHTML = categories.length
        ? categories.map((item) => '<span>' + escapeHtml(item.name) + ' · ' + escapeHtml(cashMoney(item.amount)) + '</span>').join('')
        : '<span>Sin gastos clasificados en el período</span>'
    }

    function renderCashPeriodExpenses(result) {
      const entries = result.entries || []
      state.cashRegister.periodPage = result.page || 1
      state.cashRegister.periodTotalPages = result.totalPages || 1
      cashUi.periodExpenseCount.textContent = String(result.total || 0) + ((result.total || 0) === 1 ? ' movimiento' : ' movimientos')
      cashUi.periodExpenseList.innerHTML = entries.length ? entries.map((entry) => {
        const isReversal = entry.type === 'REVERSAL'
        const title = entry.description || entry.observation || 'Gasto sin descripción'
        return '<article class="cash-period-expense-row' + (isReversal ? ' reversal' : '') + '"><div><strong>' + escapeHtml(title) + '</strong><br><small>' + escapeHtml(entry.expenseCategoryName || 'Otros') + (entry.expenseSubcategoryName ? ' / ' + escapeHtml(entry.expenseSubcategoryName) : '') + '</small></div><small>' + escapeHtml(cashMethodLabels[entry.method] || entry.method) + '</small><small>' + escapeHtml(cashDate(entry.effectiveAt)) + '</small><strong>' + (isReversal ? '+' : '−') + cashMoney(entry.amount) + '</strong></article>'
      }).join('') : '<div class="cash-inline-state">No hay gastos para estos filtros.</div>'
      cashUi.periodPageInfo.textContent = 'Página ' + state.cashRegister.periodPage + ' de ' + state.cashRegister.periodTotalPages
      cashUi.periodPrevious.disabled = state.cashRegister.periodPage <= 1
      cashUi.periodNext.disabled = state.cashRegister.periodPage >= state.cashRegister.periodTotalPages
    }

    async function loadCashPeriod(options = {}) {
      let dates
      try {
        dates = validateCashPeriodDates()
        cashUi.periodFeedback.textContent = ''
        cashUi.periodFeedback.className = 'cash-feedback'
      } catch (error) {
        cashUi.periodFeedback.textContent = error.message
        cashUi.periodFeedback.className = 'cash-feedback error'
        return
      }
      const page = options.page || state.cashRegister.periodPage || 1
      const base = new URLSearchParams({ from: dates.from, to: dates.to })
      if (isCashBusinessScopedRole() && state.businessId) base.set('businessId', state.businessId)
      const expense = new URLSearchParams(base)
      expense.set('page', String(page))
      expense.set('pageSize', cashUi.periodPageSize.value || '10')
      if (cashUi.periodCategoryFilter.value) expense.set('categoryId', cashUi.periodCategoryFilter.value)
      if (cashUi.periodSubcategoryFilter.value) expense.set('subcategoryId', cashUi.periodSubcategoryFilter.value)
      if (cashUi.periodMethodFilter.value) expense.set('method', cashUi.periodMethodFilter.value)
      if (cashUi.periodSearch.value.trim()) expense.set('q', cashUi.periodSearch.value.trim())
      cashUi.periodExpenseList.innerHTML = '<div class="cash-inline-state">Cargando gastos...</div>'
      try {
        const [summary, expenses] = await Promise.all([
          getJson('/cash-register/period/summary?' + base.toString()),
          getJson('/cash-register/period/expenses?' + expense.toString())
        ])
        renderCashPeriodSummary(summary)
        renderCashPeriodExpenses(expenses)
        state.cashRegister.periodLoaded = true
      } catch (error) {
        cashUi.periodExpenseList.innerHTML = '<div class="cash-inline-state error">' + escapeHtml(error.message) + '</div>'
      }
    }

    function setProfessionalPeriodPreset(preset) {
      state.cashRegister.professionalPeriodPreset = preset
      document.querySelectorAll('[data-cash-professional-preset]').forEach((button) => button.classList.toggle('active', button.dataset.cashProfessionalPreset === preset))
      if (preset !== 'custom') {
        const dates = cashPeriodDates(preset)
        cashUi.professionalPeriodFrom.value = dates.from
        cashUi.professionalPeriodTo.value = dates.to
      }
    }

    function professionalPeriodDates() {
      if (!cashUi.professionalPeriodFrom.value || !cashUi.professionalPeriodTo.value) throw new Error('Elegí la fecha desde y hasta.')
      const from = new Date(cashUi.professionalPeriodFrom.value + 'T00:00:00')
      const to = new Date(cashUi.professionalPeriodTo.value + 'T00:00:00')
      const days = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1
      if (!Number.isFinite(days) || days < 1) throw new Error('La fecha hasta no puede ser anterior a la fecha desde.')
      if (days > 31) throw new Error('El período no puede superar 31 días.')
      return { from: cashUi.professionalPeriodFrom.value, to: cashUi.professionalPeriodTo.value }
    }

    function professionalPeriodLabel(dates) {
      const format = (value) => new Date(value + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
      return format(dates.from) + ' — ' + format(dates.to)
    }

    function professionalRuleLabel(service) {
      if (service.ruleMode === 'PERCENTAGE') return escapeHtml(String(Number(service.rulePercentage || 0))) + '% sobre ' + escapeHtml(cashMoney(service.baseAmount))
      if (service.ruleMode === 'FIXED') return 'Fijo ' + escapeHtml(cashMoney(service.ruleFixedAmount))
      return 'Sin liquidaci&oacute;n'
    }

    function professionalSettlementEntryDate(entry) {
      return entry.type === 'EARNING' && entry.appointment?.startAt
        ? entry.appointment.startAt
        : entry.effectiveAt
    }

    function renderProfessionalServiceDetails(item) {
      if (!state.cashRegister.professionalExpandedIds.has(item.id)) return ''
      const services = item.services || []
      if (!services.length) return '<div class="cash-professional-services"><div class="cash-inline-state">No hay servicios realizados en este per&iacute;odo.</div></div>'
      return '<div class="cash-professional-services"><div class="cash-professional-services-head"><span>Fecha</span><span>Servicio</span><span>Turno / cliente</span><span>Forma de c&aacute;lculo</span><span>Importe</span></div>' + services.map((service) => '<div class="cash-professional-service-row"><span>' + escapeHtml(cashDate(professionalSettlementEntryDate(service))) + '</span><strong>' + escapeHtml(service.appointment?.service?.name || 'Servicio') + '</strong><span>' + escapeHtml((service.appointment?.startAt ? cashDate(service.appointment.startAt) : '—') + ' · ' + (service.appointment?.customer?.name || 'Cliente')) + '</span><span>' + professionalRuleLabel(service) + '</span><strong>' + escapeHtml(cashMoney(service.amount)) + '</strong></div>').join('') + '</div>'
    }

    function settlementBalanceClass(value) {
      const amount = Number(value || 0)
      return amount < 0 ? 'negative' : amount > 0 ? 'positive' : ''
    }

    function renderProfessionalSettlements(result) {
      state.cashRegister.professionalSummaryResult = result
      const items = result.items || []
      const currentProfessionalId = cashUi.professionalPaymentProfessional.value
      cashUi.professionalPaymentProfessional.innerHTML = items.map((item) => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name) + '</option>').join('') || '<option value="">Sin profesionales</option>'
      if (items.some((item) => item.id === currentProfessionalId)) cashUi.professionalPaymentProfessional.value = currentProfessionalId
      const head = '<div class="cash-professional-summary-head"><span></span><strong>Profesional</strong><span>Realizados</span><span>Generado per&iacute;odo</span><span>Pagos/adelantos per&iacute;odo</span><span>Saldo del per&iacute;odo</span><strong class="cash-professional-current-balance">Saldo actual<small>Hist&oacute;rico · no cambia con el filtro</small></strong></div>'
      cashUi.professionalSummary.innerHTML = items.length ? head + items.map((item) => {
        const expanded = state.cashRegister.professionalExpandedIds.has(item.id)
        const currentBalance = Number(item.currentBalance || 0)
        const periodBalance = Number(item.periodBalance || 0)
        return '<div class="cash-professional-summary-row"><button class="cash-professional-toggle" type="button" data-professional-settlement-toggle="' + escapeHtml(item.id) + '" aria-expanded="' + expanded + '" aria-label="' + (expanded ? 'Ocultar' : 'Ver') + ' servicios de ' + escapeHtml(item.name) + '">' + (expanded ? '⌄' : '›') + '</button><strong>' + escapeHtml(item.name) + '</strong><span>' + Number(item.completedServices || 0) + '</span><span>' + escapeHtml(cashMoney(item.periodEarned)) + '</span><span>' + escapeHtml(cashMoney(item.periodPaid)) + '</span><strong class="cash-professional-period-balance ' + settlementBalanceClass(periodBalance) + '">' + escapeHtml(cashMoney(periodBalance)) + '</strong><strong class="cash-professional-current-balance ' + settlementBalanceClass(currentBalance) + '">' + escapeHtml(cashMoney(currentBalance)) + (currentBalance < 0 ? '<small>a favor</small>' : '') + '</strong></div>' + renderProfessionalServiceDetails(item)
      }).join('') : '<div class="cash-inline-state">No hay profesionales cargados.</div>'
    }

    function renderProfessionalSettlementEntries(result) {
      const entries = result.items || []
      const labels = { EARNING: 'Servicio realizado', PAYMENT: 'Pago', ADVANCE: 'Adelanto', ADJUSTMENT: 'Ajuste', REVERSAL: 'Reversión' }
      const head = '<div class="cash-professional-movement-head"><span>Fecha</span><span>Profesional</span><span>Tipo</span><span>Servicio / detalle</span><span>Cliente</span><span>Importe</span></div>'
      cashUi.professionalEntries.innerHTML = entries.length
        ? head + entries.map((entry) => '<div class="cash-professional-movement-row"><span>' + escapeHtml(cashDate(professionalSettlementEntryDate(entry))) + '</span><strong>' + escapeHtml(entry.professional?.name || 'Profesional') + '</strong><span>' + escapeHtml(labels[entry.type] || entry.type) + '</span><span>' + escapeHtml(entry.appointment?.service?.name || entry.description || '—') + (entry.treasuryMovementId ? ' · Tesorer&iacute;a' : '') + '</span><span>' + escapeHtml(entry.appointment?.customer?.name || '—') + '</span><strong class="' + (entry.direction === 'DEBIT' ? 'negative' : '') + '">' + (entry.direction === 'DEBIT' ? '−' : '+') + escapeHtml(cashMoney(entry.amount)) + '</strong></div>').join('')
        : '<div class="cash-inline-state">Todav&iacute;a no hay movimientos profesionales en el per&iacute;odo.</div>'
      state.cashRegister.professionalPage = Number(result.page || 1)
      state.cashRegister.professionalTotalPages = Number(result.totalPages || 1)
      const total = Number(result.total || 0)
      const from = total ? (state.cashRegister.professionalPage - 1) * Number(result.pageSize || 10) + 1 : 0
      const to = Math.min(total, state.cashRegister.professionalPage * Number(result.pageSize || 10))
      cashUi.professionalPageInfo.textContent = total ? from + '–' + to + ' de ' + total : 'Sin movimientos'
      cashUi.professionalPrevious.disabled = state.cashRegister.professionalPage <= 1
      cashUi.professionalNext.disabled = state.cashRegister.professionalPage >= state.cashRegister.professionalTotalPages
    }

    async function loadProfessionalSettlements(options = {}) {
      const limited = state.currentUser?.role === 'STAFF'
      const todayPanel = document.getElementById('cash-professional-today-panel')
      const fullSummaryPanel = cashUi.professionalSummary.closest('.cash-panel')
      todayPanel.hidden = !limited
      cashUi.professionalView.querySelector('.cash-professional-period').hidden = limited
      cashUi.professionalView.querySelector('.cash-professional-movements').hidden = limited
      fullSummaryPanel.hidden = limited
      cashUi.professionalPaymentPanel.hidden = limited || !canUseCashPermission('canManageProfessionalSettlements')
      const heading = cashUi.professionalView.querySelector('.cash-professional-heading')
      heading.querySelector('h3').textContent = limited ? 'Actividad de profesionales de hoy' : 'Liquidaciones a profesionales'
      heading.querySelector('p').textContent = limited ? 'Servicios realizados y facturación de hoy. No incluye pagos ni saldos.' : 'Consultá servicios realizados por período sin perder de vista el saldo histórico.'
      if (limited) {
        if (!canUseCashPermission('canViewTodayProfessionalProduction')) return
        const target = document.getElementById('cash-professional-today-table')
        target.innerHTML = '<div class="cash-inline-state">Cargando actividad de hoy...</div>'
        try {
          const result = await getJson(cashScoped('/professional-settlements/today'))
          target.innerHTML = '<p>Hoy: ' + escapeHtml(result.date) + '</p><table class="cash-today-table"><thead><tr><th>Profesional</th><th>Servicios realizados</th><th>Facturado</th></tr></thead><tbody>' +
            (result.items || []).map((item) => '<tr><td>' + escapeHtml(item.name) + '</td><td>' + Number(item.completedServices || 0) + '</td><td>' + escapeHtml(cashMoney(item.billedAmount)) + '</td></tr>').join('') +
            '</tbody></table>'
        } catch (error) {
          target.innerHTML = '<div class="cash-inline-state error">' + escapeHtml(error.message) + '</div>'
        }
        return
      }
      let dates
      try {
        dates = professionalPeriodDates()
        cashUi.professionalPeriodFeedback.textContent = ''
        cashUi.professionalPeriodFeedback.className = 'cash-feedback'
      } catch (error) {
        cashUi.professionalPeriodFeedback.textContent = error.message
        cashUi.professionalPeriodFeedback.className = 'cash-feedback error'
        return
      }
      const page = options.page || state.cashRegister.professionalPage || 1
      const params = new URLSearchParams({ from: dates.from, to: dates.to })
      const entryParams = new URLSearchParams({ from: dates.from, to: dates.to, page: String(page), pageSize: '10' })
      cashUi.professionalPeriodLabel.textContent = professionalPeriodLabel(dates)
      cashUi.professionalSummary.innerHTML = '<div class="cash-inline-state">Cargando liquidaciones...</div>'
      cashUi.professionalEntries.innerHTML = '<div class="cash-inline-state">Cargando movimientos...</div>'
      cashUi.professionalPaymentPanel.hidden = !canUseCashPermission('canManageProfessionalSettlements')
      try {
        const [summary, entries] = await Promise.all([
          getJson(cashScoped('/professional-settlements/summary?' + params.toString())),
          getJson(cashScoped('/professional-settlements/entries?' + entryParams.toString()))
        ])
        renderProfessionalSettlements(summary)
        renderProfessionalSettlementEntries(entries)
      } catch (error) {
        const message = '<div class="cash-inline-state error">' + escapeHtml(error.message) + '</div>'
        cashUi.professionalSummary.innerHTML = message
        cashUi.professionalEntries.innerHTML = message
      }
    }

    function syncProfessionalPaymentSource() {
      const treasury = cashUi.professionalPaymentSource.value === 'TREASURY'
      if (treasury) cashUi.professionalPaymentMethod.value = 'CASH'
      cashUi.professionalPaymentMethod.disabled = treasury
    }

    async function submitProfessionalPayment(event) {
      event.preventDefault()
      const treasury = cashUi.professionalPaymentSource.value === 'TREASURY'
      const session = state.cashRegister.current?.session
      if (!treasury && !session?.id) { cashUi.professionalPaymentFeedback.textContent = 'Abrí una sesión de Caja para registrar el pago.'; cashUi.professionalPaymentFeedback.className = 'cash-feedback error'; return }
      const form = cashUi.professionalPaymentForm
      if (treasury && !form.dataset.key) form.dataset.key = crypto.randomUUID()
      const payload = {
        professionalId: cashUi.professionalPaymentProfessional.value,
        type: cashUi.professionalPaymentType.value,
        amount: Number(cashUi.professionalPaymentAmount.value),
        observation: cashUi.professionalPaymentObservation.value.trim() || undefined,
        ...(treasury ? { idempotencyKey: form.dataset.key } : { cashSessionId: session.id, method: cashUi.professionalPaymentMethod.value }),
        ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {})
      }
      try {
        await getJson(treasury ? '/treasury/pay-professional' : '/professional-settlements/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        delete form.dataset.key
        form.reset()
        syncProfessionalPaymentSource()
        cashUi.professionalPaymentFeedback.textContent = 'Pago registrado.'
        cashUi.professionalPaymentFeedback.className = 'cash-feedback success'
        await Promise.all([loadProfessionalSettlements(), treasury ? loadTreasury() : loadCashRegister({ preserve: true }), ...(treasury ? [loadTreasuryConsolidated()] : [])])
      } catch (error) { cashUi.professionalPaymentFeedback.textContent = error.message; cashUi.professionalPaymentFeedback.className = 'cash-feedback error' }
    }
    function renderTreasuryClassificationOptions() {
      const kind = document.getElementById('cash-treasury-outflow-kind').value
      const fields = document.getElementById('cash-treasury-expense-fields')
      fields.hidden = kind !== 'EXPENSE'
      const category = document.getElementById('cash-treasury-outflow-category')
      const subcategory = document.getElementById('cash-treasury-outflow-subcategory')
      const filterCategory = document.getElementById('cash-treasury-filter-category')
      const filterSubcategory = document.getElementById('cash-treasury-filter-subcategory')
      const previous = [category.value, subcategory.value, filterCategory.value, filterSubcategory.value]
      const categories = state.cashRegister.expenseCategories || []
      const subcategories = state.cashRegister.expenseSubcategories || []
      category.innerHTML = '<option value="">Eleg&iacute; una categor&iacute;a</option>' + categories.filter((item) => item.isActive).map((item) => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name) + '</option>').join('')
      filterCategory.innerHTML = '<option value="">Todas</option>' + categories.map((item) => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name) + '</option>').join('')
      if (categories.some((item) => item.id === previous[0] && item.isActive)) category.value = previous[0]
      if (categories.some((item) => item.id === previous[2])) filterCategory.value = previous[2]
      subcategory.innerHTML = '<option value="">Sin subcategor&iacute;a</option>' + subcategories.filter((item) => item.categoryId === category.value && item.isActive).map((item) => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name) + '</option>').join('')
      filterSubcategory.innerHTML = '<option value="">Todas</option>' + subcategories.filter((item) => !filterCategory.value || item.categoryId === filterCategory.value).map((item) => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name) + '</option>').join('')
      if (subcategories.some((item) => item.id === previous[1] && item.categoryId === category.value && item.isActive)) subcategory.value = previous[1]
      if (subcategories.some((item) => item.id === previous[3] && (!filterCategory.value || item.categoryId === filterCategory.value))) filterSubcategory.value = previous[3]
      category.required = kind === 'EXPENSE'
    }

    async function loadTreasury() {
      if (state.currentUser?.role === 'STAFF') return
      const inactive = document.getElementById('cash-treasury-inactive')
      const balance = document.getElementById('cash-treasury-balance')
      const operations = document.getElementById('cash-treasury-operations')
      const history = document.getElementById('cash-treasury-history-panel')
      const feedback = document.getElementById('cash-treasury-feedback')
      try {
        const filters = new URLSearchParams()
        const categoryId = document.getElementById('cash-treasury-filter-category').value
        const subcategoryId = document.getElementById('cash-treasury-filter-subcategory').value
        if (categoryId) filters.set('expenseCategoryId', categoryId)
        if (subcategoryId) filters.set('expenseSubcategoryId', subcategoryId)
        const result = await getJson(cashScoped('/treasury' + (filters.size ? '?' + filters.toString() : '')))
        const account = (result.accounts || []).find((item) => item.method === 'CASH')
        inactive.hidden = Boolean(account)
        balance.hidden = !account
        operations.hidden = !account
        history.hidden = !account
        balance.textContent = account ? 'Efectivo reservado: ' + cashMoney(account.balance) : ''
        document.getElementById('cash-treasury-entries').innerHTML = (result.movements || []).length
          ? result.movements.map((entry) => '<tr><td>' + escapeHtml(cashDate(entry.createdAt)) + '</td><td>' + escapeHtml(entry.kind === 'DAILY_TRANSFER' ? 'Traspaso interno' : entry.kind === 'PROFESSIONAL_PAYMENT' ? 'Pago profesional' : entry.kind === 'PROFESSIONAL_ADVANCE' ? 'Adelanto profesional' : entry.kind === 'EXPENSE' ? 'Gasto' : 'Retiro') + '</td><td>' + escapeHtml([entry.expenseCategoryName, entry.expenseSubcategoryName].filter(Boolean).join(' / ') || '—') + '</td><td>' + escapeHtml(entry.counterparty || '—') + '</td><td>' + escapeHtml(entry.description || '—') + '</td><td>' + (entry.direction === 'OUTFLOW' ? '−' : '+') + escapeHtml(cashMoney(entry.amount)) + '</td></tr>').join('')
          : '<tr><td colspan="6">Todavía no hay movimientos.</td></tr>'
        feedback.textContent = ''
      } catch (error) {
        feedback.textContent = error.message
        feedback.className = 'cash-feedback error'
      }
    }

    async function loadTreasuryConsolidated() {
      if (state.currentUser?.role === 'STAFF') return
      const feedback = document.getElementById('cash-treasury-period-feedback')
      const from = document.getElementById('cash-treasury-period-from').value
      const to = document.getElementById('cash-treasury-period-to').value
      const days = Math.floor((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86400000) + 1
      if (!from || !to || !Number.isFinite(days) || days < 1 || days > 31) {
        feedback.textContent = 'Elegí un período válido de hasta 31 días.'
        feedback.className = 'cash-feedback error'
        return
      }
      feedback.textContent = 'Calculando resultado global...'
      feedback.className = 'cash-feedback'
      try {
        const params = new URLSearchParams({ from, to })
        const result = await getJson(cashScoped('/treasury/consolidated?' + params.toString()))
        const summary = result.summary || {}
        document.getElementById('cash-treasury-consolidated-collected').textContent = cashMoney(summary.collected)
        document.getElementById('cash-treasury-consolidated-outgoing').textContent = cashMoney(summary.outgoing)
        document.getElementById('cash-treasury-consolidated-total').textContent = cashMoney(summary.total)
        const methods = (values) => 'Efectivo ' + cashMoney(values?.CASH) + ' · Transferencia ' + cashMoney(values?.TRANSFER) + ' · Tarjeta ' + cashMoney(values?.CARD) + (values?.UNSPECIFIED ? ' · Sin especificar ' + cashMoney(values.UNSPECIFIED) : '')
        document.getElementById('cash-treasury-consolidated-collected-methods').textContent = methods(summary.collectedByMethod)
        document.getElementById('cash-treasury-consolidated-outgoing-methods').textContent = methods(summary.outgoingByMethod)
        document.getElementById('cash-treasury-consolidated-total-methods').textContent = methods(summary.totalByMethod)
        document.getElementById('cash-treasury-consolidated-sources').textContent = 'Caja ' + cashMoney(summary.outgoingCash) + ' · Tesorería ' + cashMoney(summary.outgoingTreasury)
        feedback.textContent = ''
      } catch (error) {
        feedback.textContent = error.message
        feedback.className = 'cash-feedback error'
      }
    }

    async function submitTreasuryTransfer(event) {
      event.preventDefault()
      const feedback = document.getElementById('cash-treasury-feedback')
      const form = event.currentTarget
      const session = state.cashRegister.current?.session
      if (!session?.id) {
        feedback.textContent = 'Abrí una sesión de Caja para transferir efectivo.'
        feedback.className = 'cash-feedback error'
        return
      }
      if (!form.dataset.key) form.dataset.key = window.crypto.randomUUID()
      try {
        await getJson('/treasury/from-daily', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cashSessionId: session.id, amount: Number(document.getElementById('cash-treasury-transfer-amount').value), idempotencyKey: form.dataset.key, ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) })
        })
        form.reset()
        delete form.dataset.key
        await Promise.all([loadTreasury(), loadCashRegister({ preserve: true })])
        feedback.textContent = 'Traspaso registrado. No se contabiliza como gasto.'
        feedback.className = 'cash-feedback success'
      } catch (error) {
        feedback.textContent = error.message
        feedback.className = 'cash-feedback error'
      }
    }

    async function submitTreasuryOutflow(event) {
      event.preventDefault()
      const feedback = document.getElementById('cash-treasury-feedback')
      const form = event.currentTarget
      if (!form.dataset.key) form.dataset.key = window.crypto.randomUUID()
      const expense = document.getElementById('cash-treasury-outflow-kind').value === 'EXPENSE'
      try {
        await getJson('/treasury/outflow', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: document.getElementById('cash-treasury-outflow-kind').value,
            description: document.getElementById('cash-treasury-outflow-description').value.trim(),
            amount: Number(document.getElementById('cash-treasury-outflow-amount').value),
            ...(expense ? { expenseCategoryId: document.getElementById('cash-treasury-outflow-category').value, expenseSubcategoryId: document.getElementById('cash-treasury-outflow-subcategory').value || undefined, counterparty: document.getElementById('cash-treasury-outflow-counterparty').value.trim() || undefined } : {}),
            idempotencyKey: form.dataset.key,
            ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {})
          })
        })
        form.reset()
        delete form.dataset.key
        renderTreasuryClassificationOptions()
        await Promise.all([loadTreasury(), loadTreasuryConsolidated()])
        feedback.textContent = 'Salida registrada en Tesorería.'
        feedback.className = 'cash-feedback success'
      } catch (error) {
        feedback.textContent = error.message
        feedback.className = 'cash-feedback error'
      }
    }

    function setCashView(mode) {
      if (state.currentUser?.role === 'STAFF' && mode === 'period') mode = 'day'
      state.cashRegister.viewMode = mode
      const showingPeriod = mode === 'period'
      const showingProfessionals = mode === 'professionals'
      const showingTreasury = mode === 'treasury'
      cashUi.viewDay.classList.toggle('active', !showingPeriod && !showingProfessionals && !showingTreasury)
      cashUi.viewPeriod.classList.toggle('active', showingPeriod)
      cashUi.viewProfessionals.classList.toggle('active', showingProfessionals)
      cashUi.viewTreasury.classList.toggle('active', showingTreasury)
      cashUi.treasuryView.hidden = !showingTreasury
      cashUi.periodView.hidden = !showingPeriod
      cashUi.professionalView.hidden = !showingProfessionals
      renderCashCurrent()
      if (showingPeriod && !state.cashRegister.periodLoaded) loadCashPeriod({ page: 1 })
      if (showingProfessionals) loadProfessionalSettlements()
      if (showingTreasury) { loadTreasury(); loadTreasuryConsolidated() }
    }

    async function loadCashRegister(options = {}) {
      if (!state.businessId) return
      const isStaffCash = state.currentUser?.role === 'STAFF'
      if (isStaffCash && state.cashRegister.viewMode === 'period') {
        state.cashRegister.viewMode = 'day'
        cashUi.viewPeriod.classList.remove('active')
        cashUi.viewDay.classList.add('active')
        cashUi.periodView.hidden = true
      }
      const canViewCash = canUseCashPermission('canViewCashRegister')
      const canViewSettlements = canUseCashPermission('canViewProfessionalSettlements') || canUseCashPermission('canViewTodayProfessionalProduction')
      cashUi.viewDay.hidden = !canViewCash
      cashUi.viewPeriod.hidden = !canViewCash || isStaffCash
      cashUi.viewProfessionals.hidden = !canViewSettlements
      cashUi.viewTreasury.hidden = state.currentUser?.role === 'STAFF'
      if (!canViewCash && canViewSettlements) {
        setCashView('professionals')
        state.cashRegister.loaded = true
        return
      }
      if (!canViewCash) return
      const preserve = options.preserve ?? state.cashRegister.loaded
      const [current, daysResult] = await Promise.all([getJson(cashScoped('/cash-register/current')), getJson(cashScoped('/cash-register/days'))])
      state.cashRegister.current = current
      state.cashRegister.permissions = current.permissions || {}
      await loadCashExpenseCategories()
      state.cashRegister.days = daysResult.days || []
      state.cashRegister.selectedDayId = isStaffCash ? (current.day?.id || null) : (current.day?.id || state.cashRegister.selectedDayId || state.cashRegister.days[0]?.id || null)
      if (isStaffCash && !current.day) { state.cashRegister.entries = []; state.cashRegister.nextCursor = null; cashUi.entryList.innerHTML = '' }
      renderCashCurrent()
      if (current.day?.id === state.cashRegister.selectedDayId) {
        renderCashSummary(current.day, current.summary, current.sessions, current.sessionExpectedCash)
        await loadCashEntries({ preserve })
      } else if (state.cashRegister.selectedDayId) {
        await selectCashDay(state.cashRegister.selectedDayId)
      }
      state.cashRegister.loaded = true
    }

    let cashSessionSaving = false
    let cashSessionNeedsRefresh = false

    function closeCashSessionDialog() {
      if (cashSessionSaving) return
      cashUi.sessionDialog.hidden = true
      cashUi.sessionFeedback.textContent = ''
    }

    function currentSessionExpectedCash() {
      const value = state.cashRegister.current?.sessionExpectedCash ?? state.cashRegister.current?.summary?.expectedCash
      return Number.isSafeInteger(Number(value)) ? Number(value) : 0
    }

    function syncCashSessionReconciliation() {
      const mode = state.cashRegister.sessionMode
      cashUi.sessionReconciliation.hidden = mode === 'open'
      if (mode === 'open') return
      const expected = currentSessionExpectedCash()
      const countedText = cashUi.countedCash.value.trim()
      const counted = Number(countedText)
      cashUi.sessionExpected.textContent = cashMoney(expected)
      cashUi.sessionCounted.textContent = countedText && Number.isSafeInteger(counted) ? cashMoney(counted) : '--'
      cashUi.sessionDifference.textContent = countedText && Number.isSafeInteger(counted) ? cashSignedMoney(counted - expected) : '--'
      cashUi.sessionDifference.classList.toggle('positive', countedText !== '' && counted > expected)
      cashUi.sessionDifference.classList.toggle('negative', countedText !== '' && counted < expected)
      const difference = countedText && Number.isSafeInteger(counted) ? counted - expected : 0
      cashUi.differenceConfirmField.hidden = !countedText || !Number.isSafeInteger(counted) || difference === 0
      cashUi.differenceConfirmCopy.textContent = difference > 0
        ? 'Confirmo que hay más efectivo del esperado y quiero dejar la diferencia registrada.'
        : 'Confirmo que hay menos efectivo del esperado y quiero dejar la diferencia registrada.'
      cashUi.sessionSubmit.textContent = mode === 'new'
        ? difference === 0 ? 'Cambiar responsable' : 'Cambiar con diferencia'
        : difference === 0 ? 'Cerrar caja' : 'Cerrar con diferencia'
    }

    function syncCashCloseChange() {
      const enabled = state.cashRegister.sessionMode === 'close' && cashUi.closeLeaveChange.checked
      cashUi.closeChangeField.hidden = !enabled
      cashUi.closeCashToLeave.required = enabled
      const countedText = cashUi.countedCash.value.trim()
      const counted = Number(countedText)
      const leaveText = cashUi.closeCashToLeave.value.trim()
      const leave = Number(leaveText)
      const valid = enabled && countedText !== '' && leaveText !== '' && Number.isSafeInteger(counted) && counted >= 0 && Number.isSafeInteger(leave) && leave >= 0 && leave <= counted
      cashUi.closeChangePreview.hidden = !valid
      cashUi.closeNextOpening.textContent = valid ? cashMoney(leave) : '--'
      cashUi.closeTransferAmount.textContent = valid ? cashMoney(counted - leave) : '--'
    }

    async function openCashSessionDialog(mode) {
      if (!canUseCashPermission('canManageCashSessions')) return
      state.cashRegister.sessionMode = mode
      cashSessionNeedsRefresh = false
      cashUi.sessionForm.reset()
      renderCashResponsibleOptions()
      cashUi.differenceConfirm.checked = false
      cashUi.closeChangeSection.hidden = mode !== 'close' || !['BUSINESS_ADMIN', 'ACCOUNT_ADMIN', 'SUPER_ADMIN'].includes(state.currentUser?.role)
      cashUi.closeLeaveChange.checked = false
      cashUi.closeCashToLeave.value = ''
      syncCashCloseChange()
      const previousClosedDay = state.cashRegister.days.find((day) => day.closedAt && day.countedClosingCash !== null && day.countedClosingCash !== undefined)
      const inheritedOpeningCash = state.cashRegister.current?.nextOpeningCash ?? (previousClosedDay && Number.isSafeInteger(Number(previousClosedDay.countedClosingCash)) ? Number(previousClosedDay.countedClosingCash) : null)
      cashUi.sessionTitle.textContent = mode === 'open' ? 'Abrir caja' : mode === 'new' ? 'Nueva sesión' : 'Cerrar caja'
      cashUi.responsibleField.hidden = mode === 'close'
      cashUi.openingField.hidden = mode !== 'open' || inheritedOpeningCash !== null
      cashUi.countedField.hidden = mode === 'open'
      cashUi.openingLabel.textContent = 'Efectivo inicial (solo primera apertura)'
      cashUi.countedLabel.textContent = mode === 'new' ? 'Efectivo contado al cambiar responsable' : 'Efectivo contado al cerrar'
      cashUi.sessionHelp.textContent = mode === 'open'
        ? inheritedOpeningCash !== null
          ? 'La jornada abrirá con ' + cashMoney(inheritedOpeningCash) + ', heredado automáticamente del efectivo contado en el cierre anterior.'
          : 'Solo se usa en la primera apertura. Después, la próxima jornada conserva automáticamente el efectivo contado del cierre anterior.'
        : mode === 'new'
          ? 'Dejá asentado el efectivo físico al cambiar de responsable. Esto no reinicia ni modifica los totales del día.'
          : 'Contá el efectivo físico para compararlo con el efectivo esperado y registrar cualquier diferencia.'
      cashUi.sessionSubmit.textContent = mode === 'open' ? 'Abrir caja' : mode === 'new' ? 'Cambiar responsable' : 'Cerrar caja'
      cashUi.sessionFeedback.textContent = ''
      cashUi.sessionFeedback.className = 'cash-feedback'
      cashUi.sessionLoading.hidden = true
      syncCashSessionReconciliation()
      cashUi.sessionDialog.hidden = false
      await loadCashResponsibleOptions().catch((error) => {
        cashUi.sessionFeedback.textContent = error.message
        cashUi.sessionFeedback.className = 'cash-feedback error'
      })
    }

    function returnToAppointmentDraft() {
      if (!state.cashRegister.returnToAppointment) return
      state.cashRegister.returnToAppointment = false
      setSection('agenda')
      els.appointmentDialog.hidden = false
    }

    async function submitCashSession(event) {
      event.preventDefault()
      const mode = state.cashRegister.sessionMode
      if (cashSessionNeedsRefresh) {
        if (cashSessionSaving || !setButtonLoading(cashUi.sessionSubmit, true, 'Actualizando...')) return
        cashSessionSaving = true
        cashUi.sessionLoading.hidden = false
        cashUi.sessionForm.setAttribute('aria-busy', 'true')
        cashUi.sessionX.disabled = true
        cashUi.sessionCancel.disabled = true
        try {
          await loadCashRegister()
          cashSessionNeedsRefresh = false
          cashSessionSaving = false
          closeCashSessionDialog()
          showCrmToast('Caja actualizada.', 'success')
        } catch (error) {
          cashUi.sessionFeedback.textContent = 'La operación ya se guardó, pero no se pudo actualizar: ' + error.message
          cashUi.sessionFeedback.className = 'cash-feedback error'
        } finally {
          cashSessionSaving = false
          cashUi.sessionLoading.hidden = true
          cashUi.sessionForm.removeAttribute('aria-busy')
          cashUi.sessionX.disabled = false
          cashUi.sessionCancel.disabled = false
          setButtonLoading(cashUi.sessionSubmit, false)
          if (cashSessionNeedsRefresh) cashUi.sessionSubmit.textContent = 'Reintentar actualización'
        }
        return
      }
      const currentSessionId = state.cashRegister.current?.session?.id
      const openingText = cashUi.openingCash.value.trim()
      const counted = Number(cashUi.countedCash.value)
      const payload = mode === 'open'
        ? { responsibleUserId: cashUi.sessionResponsible.value, ...(openingText ? { openingCash: Number(openingText) } : {}) }
        : mode === 'new'
          ? { currentSessionId, responsibleUserId: cashUi.sessionResponsible.value, countedCash: counted, acknowledgeDifference: cashUi.differenceConfirm.checked }
          : { currentSessionId, countedCash: counted, acknowledgeDifference: cashUi.differenceConfirm.checked }
      if (mode === 'close' && cashUi.closeLeaveChange.checked) {
        const cashToLeave = Number(cashUi.closeCashToLeave.value)
        if (!cashUi.closeCashToLeave.value.trim() || !Number.isSafeInteger(cashToLeave) || cashToLeave < 0 || cashToLeave > counted) {
          cashUi.sessionFeedback.textContent = 'El monto a dejar debe estar entre cero y el efectivo contado.'
          cashUi.sessionFeedback.className = 'cash-feedback error'
          return
        }
        payload.cashToLeave = cashToLeave
      }
      if (isCashBusinessScopedRole()) payload.businessId = state.businessId
      if ((mode !== 'open' && !Number.isSafeInteger(counted)) || (openingText && !Number.isSafeInteger(Number(openingText)))) {
        cashUi.sessionFeedback.textContent = 'Ingresá un importe entero válido.'
        cashUi.sessionFeedback.className = 'cash-feedback error'
        return
      }
      const difference = mode === 'open' ? 0 : counted - currentSessionExpectedCash()
      if (difference !== 0 && !cashUi.differenceConfirm.checked) {
        cashUi.sessionFeedback.textContent = 'Revisá la diferencia y confirmá que querés dejarla registrada.'
        cashUi.sessionFeedback.className = 'cash-feedback error'
        return
      }
      if (cashSessionSaving || !setButtonLoading(cashUi.sessionSubmit, true, 'Guardando...')) return
      cashSessionSaving = true
      cashUi.sessionLoading.hidden = false
      cashUi.sessionForm.setAttribute('aria-busy', 'true')
      cashUi.sessionX.disabled = true
      cashUi.sessionCancel.disabled = true
      let operationSaved = false
      try {
        await getJson('/cash-register/' + (mode === 'open' ? 'open' : mode === 'new' ? 'new-session' : 'close'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        operationSaved = true
        await loadCashRegister()
        cashSessionSaving = false
        closeCashSessionDialog()
        showCrmToast(mode === 'close' ? 'Caja cerrada.' : 'Sesión de Caja activa.', 'success')
        if (state.cashRegister.returnToAppointment && mode !== 'close') {
          returnToAppointmentDraft()
          if (state.editingAppointmentId) await loadAppointmentFinance()
          else await loadCreateAppointmentCashState()
        }
      } catch (error) {
        cashSessionNeedsRefresh = operationSaved
        cashUi.sessionFeedback.textContent = operationSaved
          ? 'La operación ya se guardó, pero no se pudo actualizar: ' + error.message
          : error.message
        cashUi.sessionFeedback.className = 'cash-feedback error'
      } finally {
        cashSessionSaving = false
        cashUi.sessionLoading.hidden = true
        cashUi.sessionForm.removeAttribute('aria-busy')
        cashUi.sessionX.disabled = false
        cashUi.sessionCancel.disabled = false
        setButtonLoading(cashUi.sessionSubmit, false)
        if (cashSessionNeedsRefresh) cashUi.sessionSubmit.textContent = 'Reintentar actualización'
      }
    }

    function syncCashOperationFields() {
      const type = cashUi.operationType.value
      cashUi.operationDeltaField.hidden = type !== 'ADJUSTMENT'
      cashUi.operationAmountField.hidden = type === 'ADJUSTMENT'
      cashUi.operationCounterpartyField.hidden = type !== 'WITHDRAWAL'
      cashUi.operationDescriptionField.hidden = type === 'WITHDRAWAL' || type === 'ADJUSTMENT'
      cashUi.operationMethodField.hidden = ['WITHDRAWAL', 'CASH_IN', 'ADJUSTMENT'].includes(type)
      cashUi.operationCategoryField.hidden = type !== 'EXPENSE'
      cashUi.operationCategory.required = type === 'EXPENSE'
      cashUi.operationSubcategory.disabled = type !== 'EXPENSE'
      if (type === 'EXPENSE' && !cashUi.operationCategory.value) {
        cashUi.operationCategory.value = defaultCashExpenseCategory()?.id || ''
      }
    }

    async function openCashOperationDialog() {
      cashUi.operationForm.reset()
      cashUi.operationFeedback.textContent = ''
      const mayOperate = canUseCashPermission('canManageCashOperations')
      for (const option of cashUi.operationType.options) option.hidden = option.value !== 'ADJUSTMENT' && !mayOperate || option.value === 'ADJUSTMENT' && !canUseCashPermission('canAdjustCash')
      cashUi.operationType.value = Array.from(cashUi.operationType.options).find((option) => !option.hidden)?.value || 'ADJUSTMENT'
      try {
        if (!state.cashRegister.expenseCategories.length) await loadCashExpenseCategories()
      } catch (error) {
        cashUi.operationFeedback.textContent = error.message
        cashUi.operationFeedback.className = 'cash-feedback error'
      }
      const fallback = defaultCashExpenseCategory()
      cashUi.operationCategory.value = fallback?.id || ''
      syncCashOperationFields()
      renderCashExpenseSubcategoryOptions()
      cashUi.operationDialog.hidden = false
    }

    function closeCashOperationDialog() { cashUi.operationDialog.hidden = true }

    async function submitCashOperation(event) {
      event.preventDefault()
      const type = cashUi.operationType.value
      const payload = { type, cashSessionId: state.cashRegister.current?.session?.id, observation: cashUi.operationObservation.value.trim() || undefined }
      if (isCashBusinessScopedRole()) payload.businessId = state.businessId
      if (type === 'ADJUSTMENT') payload.delta = Number(cashUi.operationDelta.value)
      else payload.amount = Number(cashUi.operationAmount.value)
      if (type === 'WITHDRAWAL') payload.counterparty = cashUi.operationCounterparty.value.trim()
      if (!['WITHDRAWAL', 'ADJUSTMENT'].includes(type)) payload.description = cashUi.operationDescription.value.trim()
      if (['EXPENSE', 'REFUND'].includes(type)) payload.method = cashUi.operationMethod.value
      if (type === 'EXPENSE') { payload.categoryId = cashUi.operationCategory.value; if (cashUi.operationSubcategory.value) payload.subcategoryId = cashUi.operationSubcategory.value }
      if (!setButtonLoading(cashUi.operationSubmit, true, 'Registrando...')) return
      try {
        await getJson('/cash-register/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        closeCashOperationDialog()
        await loadCashRegister()
        showCrmToast('Operación registrada.', 'success')
      } catch (error) {
        cashUi.operationFeedback.textContent = error.message
        cashUi.operationFeedback.className = 'cash-feedback error'
      } finally { setButtonLoading(cashUi.operationSubmit, false) }
    }

    function financeEntryLabel(entry) {
      return cashTypeLabels[entry.type] || entry.type
    }

    function selectedCreateAppointmentPrice() {
      const service = state.services.find((item) => item.id === els.appointmentService.value)
      const estimated = service?.priceMode === 'STARTING_AT' || !Number.isSafeInteger(Number(service?.price))
      const enteredTotal = Number(cashUi.createEstimatedTotal.value)
      return {
        estimated,
        total: estimated ? (Number.isSafeInteger(enteredTotal) && enteredTotal > 0 ? enteredTotal : null) : (service ? Number(service.price) : null)
      }
    }

    function calculateCreateAppointmentTotals() {
      const price = selectedCreateAppointmentPrice()
      const rawDiscount = Number(cashUi.createDiscountValue.value)
      let discountAmount = 0
      if (state.cashRegister.createFinance.discount && price.total !== null && Number.isFinite(rawDiscount) && rawDiscount >= 0) {
        discountAmount = cashUi.createDiscountType.value === 'PERCENTAGE'
          ? Math.round(price.total * rawDiscount / 100)
          : rawDiscount
      }
      const final = price.total === null ? null : Math.max(0, price.total - discountAmount)
      const rawDeposit = Number(cashUi.createDepositAmount.value)
      const depositAmount = state.cashRegister.createFinance.deposit && Number.isSafeInteger(rawDeposit) && rawDeposit > 0 ? rawDeposit : 0
      const payableAfterDeposit = final === null ? 0 : Math.max(0, final - depositAmount)
      let collectedAmount = 0
      if (state.cashRegister.createFinance.collectTotal && final !== null) collectedAmount = payableAfterDeposit
      return {
        price,
        discountAmount,
        final,
        depositAmount,
        payableAfterDeposit,
        paid: depositAmount + collectedAmount,
        due: final === null ? null : Math.max(0, final - depositAmount - collectedAmount)
      }
    }

    function setCreateFinanceAction(button, active) {
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    }

    function syncCreateAppointmentPayment() {
      if (cashUi.createPayment.hidden) return
      const actions = state.cashRegister.createFinance
      const totals = calculateCreateAppointmentTotals()
      const hasPaymentIntent = actions.collectTotal || actions.deposit
      cashUi.createPaymentFields.hidden = false
      cashUi.createEstimatedTotalRow.hidden = !totals.price.estimated
      cashUi.createDiscountPanel.hidden = !actions.discount
      cashUi.createDepositPanel.hidden = !actions.deposit
      cashUi.createPaymentPanel.hidden = !actions.collectTotal
      cashUi.createObservationRow.hidden = !hasPaymentIntent
      cashUi.createDiscountValueLabel.textContent = cashUi.createDiscountType.value === 'PERCENTAGE' ? 'Porcentaje' : 'Monto'
      setCreateFinanceAction(cashUi.createCollectTotal, actions.collectTotal)
      setCreateFinanceAction(cashUi.createDeposit, actions.deposit)
      setCreateFinanceAction(cashUi.createDiscountToggle, actions.discount)
      cashUi.createCollectTotal.hidden = !canUseCashPermission('canRecordAppointmentPayments')
      cashUi.createDeposit.hidden = !canUseCashPermission('canRecordAppointmentPayments')
      cashUi.createDiscountToggle.hidden = !canUseCashPermission('canApplyDiscounts')

      if (actions.collectTotal) {
        if (cashUi.createPaymentLineTwo.hidden) {
          cashUi.createPaymentAmount.readOnly = true
          cashUi.createPaymentAmount.value = totals.final === null ? '' : String(totals.payableAfterDeposit)
        } else {
          cashUi.createPaymentAmount.readOnly = false
          const firstAmount = Number(cashUi.createPaymentAmount.value)
          const secondAmount = Number.isSafeInteger(firstAmount) && firstAmount > 0 && firstAmount < totals.payableAfterDeposit
            ? totals.payableAfterDeposit - firstAmount
            : 0
          cashUi.createPaymentAmountTwo.value = secondAmount > 0 ? String(secondAmount) : ''
        }
      }

      cashUi.createSummaryPrice.textContent = totals.price.total === null ? 'A definir' : cashMoney(totals.price.total)
      cashUi.createSummaryDiscount.textContent = cashMoney(totals.discountAmount)
      cashUi.createSummaryTotal.textContent = totals.final === null ? 'A definir' : cashMoney(totals.final)
      cashUi.createSummaryPaid.textContent = cashMoney(totals.paid)
      cashUi.createSummaryDue.textContent = totals.due === null ? 'A definir' : cashMoney(totals.due)
      cashUi.createPaymentStatus.textContent = actions.collectTotal
        ? 'Pago total'
        : actions.deposit
          ? (totals.depositAmount > 0 ? 'Seña ' + cashMoney(totals.depositAmount) : 'Seña pendiente')
          : actions.discount
            ? 'Con descuento'
            : 'Sin pago'
      const hasSession = Boolean(state.cashRegister.current?.session?.id)
      cashUi.createCashRequired.hidden = !hasPaymentIntent || hasSession
      cashUi.createOpenCash.hidden = !canUseCashPermission('canManageCashSessions')
      cashUi.createCashRequired.querySelector('p').textContent = canUseCashPermission('canManageCashSessions') ? 'Para cobrar necesitás una sesión de Caja activa.' : 'Pedile a un responsable autorizado que abra la Caja.'
      cashUi.createPaymentFeedback.textContent = ''
    }

    async function loadCreateAppointmentCashState() {
      try {
        state.cashRegister.current = await getJson(cashScoped('/cash-register/payment-context'))
      } catch {
        state.cashRegister.current = { day: null, session: null }
      }
      syncCreateAppointmentPayment()
    }

    function prepareCreateAppointmentPayment(appointment) {
      const visible = !appointment && (canUseCashPermission('canRecordAppointmentPayments') || canUseCashPermission('canApplyDiscounts'))
      cashUi.createPayment.hidden = !visible
      cashUi.createPayment.open = false
      state.cashRegister.createFinance = { collectTotal: false, deposit: false, discount: false }
      cashUi.createPaymentFields.hidden = false
      cashUi.createPaymentAmount.value = ''
      cashUi.createPaymentAmount.readOnly = true
      cashUi.createPaymentMethod.value = 'CASH'
      cashUi.createPaymentLineTwo.hidden = true
      cashUi.createPaymentAmountTwo.value = ''
      cashUi.createPaymentMethodTwo.value = 'TRANSFER'
      cashUi.createDepositAmount.value = ''
      cashUi.createDepositMethod.value = 'TRANSFER'
      cashUi.createDiscountType.value = 'AMOUNT'
      cashUi.createDiscountValue.value = ''
      cashUi.createEstimatedTotal.value = ''
      cashUi.createPaymentObservation.value = ''
      cashUi.createPaymentFeedback.textContent = ''
      cashUi.createPaymentStatus.textContent = 'Sin pago'
      syncCreateAppointmentPayment()
      if (visible && canUseCashPermission('canRecordAppointmentPayments')) loadCreateAppointmentCashState()
    }

    function readCreateAppointmentPayment() {
      const actions = state.cashRegister.createFinance
      const enteredEstimatedTotal = cashUi.createEstimatedTotal.value.trim()
      const hasFinanceIntent = actions.collectTotal || actions.deposit || actions.discount || Boolean(enteredEstimatedTotal)
      if (!hasFinanceIntent) return null
      const totals = calculateCreateAppointmentTotals()
      if (totals.price.total === null) throw new Error('Ingresá el total acordado para este servicio estimativo.')

      let discountValue
      if (actions.discount) {
        discountValue = Number(cashUi.createDiscountValue.value)
        if (cashUi.createDiscountType.value === 'PERCENTAGE') {
          if (!Number.isFinite(discountValue) || discountValue <= 0 || discountValue > 100) throw new Error('El porcentaje debe ser mayor a 0 y no superar 100.')
        } else if (!Number.isSafeInteger(discountValue) || discountValue <= 0) {
          throw new Error('El descuento debe ser un monto entero mayor a cero.')
        }
        if (totals.discountAmount > totals.price.total) throw new Error('El descuento no puede superar el precio del turno.')
      }

      const lines = []
      if (actions.deposit) {
        const depositAmount = Number(cashUi.createDepositAmount.value)
        if (!Number.isSafeInteger(depositAmount) || depositAmount <= 0) throw new Error('Ingresá una seña entera mayor a cero.')
        lines.push({ amount: depositAmount, method: cashUi.createDepositMethod.value })
      }
      const payableAfterDeposit = Math.max(0, totals.final - totals.depositAmount)
      if (actions.collectTotal && payableAfterDeposit > 0) {
        lines.push({ amount: Number(cashUi.createPaymentAmount.value), method: cashUi.createPaymentMethod.value })
        if (!cashUi.createPaymentLineTwo.hidden) lines.push({ amount: Number(cashUi.createPaymentAmountTwo.value), method: cashUi.createPaymentMethodTwo.value })
      }
      if (lines.some((line) => !Number.isSafeInteger(line.amount) || line.amount <= 0)) {
        throw new Error('Cada pago debe ser un importe entero mayor a cero.')
      }
      const paymentTotal = lines.reduce((total, line) => total + line.amount, 0)
      if (paymentTotal > totals.final) throw new Error('El pago no puede superar el saldo pendiente del turno.')
      if (actions.collectTotal && paymentTotal !== totals.final) throw new Error('Los medios de pago deben completar exactamente el total pendiente.')
      const hasPaymentLines = lines.length > 0
      if (hasPaymentLines && !state.cashRegister.current?.session?.id) throw new Error('Para registrar el pago necesitás una sesión de Caja activa.')
      return {
        ...(hasPaymentLines ? { cashSessionId: state.cashRegister.current.session.id, lines } : {}),
        ...(hasPaymentLines && cashUi.createPaymentObservation.value.trim() ? { observation: cashUi.createPaymentObservation.value.trim() } : {}),
        ...(totals.price.estimated ? { agreedAmount: totals.price.total } : {}),
        ...(actions.discount ? { discountType: cashUi.createDiscountType.value, discountValue } : {}),
        ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {})
      }
    }

    function syncEditAppointmentFinanceActions() {
      const finance = state.cashRegister.appointmentFinance
      if (!finance) return
      const actions = state.cashRegister.editFinance
      const canRecord = canUseCashPermission('canRecordAppointmentPayments')
      const canDiscount = canUseCashPermission('canApplyDiscounts')
      const activeSession = Boolean(state.cashRegister.current?.session?.id)
      const hasPaymentIntent = actions.collectTotal || actions.deposit
      const appointment = editingAgendaAppointment()
      const canCompleteWithPayment = Boolean(
        appointment &&
        canEditAppointments() &&
        !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(appointment.status) &&
        new Date(appointment.startAt).getTime() <= Date.now()
      )

      cashUi.totalToggle.hidden = !canRecord
      cashUi.editCollectTotal.hidden = !canRecord || finance.balanceAmount <= 0
      cashUi.editDeposit.hidden = !canRecord || finance.balanceAmount <= 0
      cashUi.editDiscountToggle.hidden = !canDiscount
      setCreateFinanceAction(cashUi.editCollectTotal, actions.collectTotal)
      setCreateFinanceAction(cashUi.editDeposit, actions.deposit)
      setCreateFinanceAction(cashUi.editDiscountToggle, actions.discount)
      setCreateFinanceAction(cashUi.totalToggle, actions.adjust)
      cashUi.totalForm.hidden = !actions.adjust || !canRecord
      cashUi.paymentForm.hidden = !actions.collectTotal || !canRecord || !activeSession
      cashUi.paymentCompleteRow.hidden = !actions.collectTotal || !canRecord || !activeSession || !canCompleteWithPayment
      if (!canCompleteWithPayment) cashUi.paymentComplete.checked = false
      cashUi.editDepositPanel.hidden = !actions.deposit || !canRecord || !activeSession
      cashUi.discountForm.hidden = !actions.discount || !canDiscount
      cashUi.editObservationRow.hidden = !hasPaymentIntent || !activeSession
      cashUi.cashRequired.hidden = !hasPaymentIntent || activeSession
      cashUi.appointmentOpenCash.hidden = !canUseCashPermission('canManageCashSessions')
      cashUi.cashRequired.querySelector('p').textContent = canUseCashPermission('canManageCashSessions') ? 'Para cobrar necesitás una sesión de Caja activa.' : 'Pedile a un responsable autorizado que abra la Caja.'

      if (actions.collectTotal) {
        if (cashUi.paymentLineTwo.hidden) {
          cashUi.paymentAmount.readOnly = true
          cashUi.paymentAmount.value = String(finance.balanceAmount)
        } else {
          cashUi.paymentAmount.readOnly = false
          const firstAmount = Number(cashUi.paymentAmount.value)
          const secondAmount = Number.isSafeInteger(firstAmount) && firstAmount > 0 && firstAmount < finance.balanceAmount
            ? finance.balanceAmount - firstAmount
            : 0
          cashUi.paymentAmountTwo.value = secondAmount > 0 ? String(secondAmount) : ''
        }
      }
    }

    function renderAppointmentFinanceSummary(finance) {
      state.cashRegister.appointmentFinance = finance
      cashUi.financeBalance.textContent = finance.balanceAmount > 0 ? 'Saldo ' + cashMoney(finance.balanceAmount) : 'Pagado'
      cashUi.financeServiceSubtotal.textContent = cashMoney(finance.serviceSubtotal ?? finance.agreedAmount)
      cashUi.financeProductSubtotal.textContent = cashMoney(finance.productSubtotal)
      cashUi.financeDiscount.textContent = cashMoney(finance.discountAmount)
      cashUi.financeTotal.textContent = cashMoney(finance.finalAmount)
      cashUi.financePaid.textContent = cashMoney(finance.paidAmount)
      cashUi.financeDue.textContent = cashMoney(finance.balanceAmount)
      cashUi.estimatedTotal.value = finance.agreedAmount
      cashUi.originalTotal.textContent = finance.originalAmount === null ? 'Sin referencia' : cashMoney(finance.originalAmount)
      cashUi.minimumTotalRow.hidden = finance.pricingMode !== 'ESTIMATED'
      cashUi.minimumTotal.textContent = cashMoney(finance.minimumAmount)
      cashUi.estimatedTotal.min = String(finance.pricingMode === 'ESTIMATED' ? finance.minimumAmount : 0)
      cashUi.totalHelp.textContent = finance.pricingMode === 'ESTIMATED'
        ? 'Podés bajar el estimado, pero nunca por debajo del precio base ni de lo ya cobrado.'
        : 'El precio fijo solo cambia mediante este ajuste explícito y auditado.'
      cashUi.discountType.value = 'AMOUNT'
      cashUi.discountValue.value = finance.discountAmount
      syncAppointmentDiscountField()
      cashUi.totalForm.hidden = !state.cashRegister.editFinance.adjust || !canUseCashPermission('canRecordAppointmentPayments')
      cashUi.financeHistory.innerHTML = '<div class="cash-inline-state">Abr&iacute; Pago para ver los movimientos.</div>'
      syncEditAppointmentFinanceActions()
    }

    function renderAppointmentFinance(finance) {
      renderAppointmentFinanceSummary(finance)
      const adjustments = (finance.totalAdjustments || []).map((adjustment) => '<article><span><strong>Ajuste de total</strong> · ' + escapeHtml(adjustment.actorName) + '<small> · ' + escapeHtml(cashDate(adjustment.createdAt)) + ' · ' + escapeHtml(adjustment.reason) + '</small></span><strong>' + cashMoney(adjustment.previousAmount) + ' &rarr; ' + cashMoney(adjustment.newAmount) + '</strong></article>')
      const payments = (finance.entries || []).map((entry) => '<article><span>' + escapeHtml(financeEntryLabel(entry)) + ' · ' + escapeHtml(cashMethodLabels[entry.method] || entry.method) + (entry.effectiveAt ? '<small> · ' + escapeHtml(cashDate(entry.effectiveAt)) + '</small>' : '') + '</span><strong>' + (entry.direction === 'OUTFLOW' ? '−' : '+') + cashMoney(entry.amount) + '</strong></article>')
      cashUi.financeHistory.innerHTML = adjustments.concat(payments).join('') || '<div class="cash-inline-state">Todav&iacute;a no hay movimientos.</div>'
    }

    function resetAppointmentFinanceView() {
      state.cashRegister.appointmentFinance = null
      state.cashRegister.editFinance = { adjust: false, collectTotal: false, deposit: false, discount: false }
      cashUi.financeBalance.textContent = 'Cargando...'
      cashUi.financeServiceSubtotal.textContent = '--'
      cashUi.financeProductSubtotal.textContent = '--'
      cashUi.financeDiscount.textContent = '--'
      cashUi.financeTotal.textContent = '--'
      cashUi.financePaid.textContent = '--'
      cashUi.financeDue.textContent = '--'
      cashUi.estimatedTotal.value = ''
      cashUi.totalReason.value = ''
      cashUi.originalTotal.textContent = '--'
      cashUi.minimumTotal.textContent = '--'
      cashUi.discountType.value = 'AMOUNT'
      cashUi.discountValue.value = ''
      syncAppointmentDiscountField()
      cashUi.totalForm.hidden = true
      cashUi.totalToggle.hidden = true
      cashUi.editCollectTotal.hidden = true
      cashUi.editDeposit.hidden = true
      cashUi.editDiscountToggle.hidden = true
      cashUi.discountForm.hidden = true
      cashUi.paymentForm.hidden = true
      cashUi.editDepositPanel.hidden = true
      cashUi.editObservationRow.hidden = true
      cashUi.paymentAmount.value = ''
      cashUi.paymentAmount.readOnly = true
      cashUi.paymentMethod.value = 'CASH'
      cashUi.paymentLineTwo.hidden = true
      cashUi.paymentAmountTwo.value = ''
      cashUi.paymentMethodTwo.value = 'TRANSFER'
      cashUi.paymentComplete.checked = false
      cashUi.paymentCompleteRow.hidden = true
      cashUi.editDepositAmount.value = ''
      cashUi.editDepositMethod.value = 'TRANSFER'
      cashUi.paymentObservation.value = ''
      cashUi.cashRequired.hidden = true
      cashUi.financeHistory.innerHTML = '<div class="cash-inline-state">Cargando movimientos...</div>'
      cashUi.financeFeedback.textContent = 'Cargando estado financiero...'
      cashUi.financeFeedback.className = 'appointment-finance-feedback'
    }

    function scrollAppointmentFinanceIntoView() {
      requestAnimationFrame(() => cashUi.finance.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }

    async function loadAppointmentFinance(options = {}) {
      const appointmentId = state.editingAppointmentId
      if (!appointmentId || !(canUseCashPermission('canRecordAppointmentPayments') || canUseCashPermission('canApplyDiscounts'))) return
      const requestId = ++state.cashRegister.appointmentFinanceRequestId
      const key = appointmentFinanceCacheKey(appointmentId)
      const cached = state.cashRegister.appointmentFinanceCache[key]
      if (cached && options.force === false) {
        renderAppointmentFinance(cached)
        cashUi.financeFeedback.textContent = ''
        return cached
      }
      const preserve = options.preserve !== false && Boolean(state.cashRegister.appointmentFinance)
      if (!preserve) resetAppointmentFinanceView()
      else {
        cashUi.financeFeedback.textContent = 'Actualizando...'
        cashUi.financeFeedback.className = 'appointment-finance-feedback'
      }
      try {
        let pending = state.cashRegister.appointmentFinanceInFlight[key]
        if (!pending) {
          const paymentContext = canUseCashPermission('canRecordAppointmentPayments')
            ? getJson(cashScoped('/cash-register/payment-context')).catch(() => ({ day: null, session: null }))
            : Promise.resolve({ day: null, session: null })
          pending = Promise.all([getJson(cashScoped('/appointments/' + encodeURIComponent(appointmentId) + '/finance')), paymentContext])
          state.cashRegister.appointmentFinanceInFlight[key] = pending
        }
        const [finance, current] = await pending
        if (state.cashRegister.appointmentFinanceInFlight[key] === pending) delete state.cashRegister.appointmentFinanceInFlight[key]
        state.cashRegister.appointmentFinanceCache[key] = finance
        cacheAppointmentFinanceSummary(appointmentId, {
          accountId: finance.accountId,
          pricingMode: finance.pricingMode,
          originalAmount: finance.originalAmount,
          minimumAmount: finance.minimumAmount,
          agreedAmount: finance.agreedAmount,
          discountAmount: finance.discountAmount,
          finalAmount: finance.finalAmount,
          paidAmount: finance.paidAmount,
          balanceAmount: finance.balanceAmount
        })
        if (els.appShell.dataset.section === 'agenda') renderAgenda()
        if (appointmentId !== state.editingAppointmentId || requestId !== state.cashRegister.appointmentFinanceRequestId) return
        state.cashRegister.current = current
        renderAppointmentFinance(finance)
        cashUi.financeFeedback.textContent = ''
      } catch (error) {
        delete state.cashRegister.appointmentFinanceInFlight[key]
        if (appointmentId !== state.editingAppointmentId || requestId !== state.cashRegister.appointmentFinanceRequestId) return
        cashUi.financeFeedback.textContent = error.message
        cashUi.financeFeedback.className = 'appointment-finance-feedback error'
      }
    }

    function prepareAppointmentFinance(appointment) {
      state.cashRegister.appointmentFinanceRequestId += 1
      cashUi.finance.hidden = !appointment || !(canUseCashPermission('canRecordAppointmentPayments') || canUseCashPermission('canApplyDiscounts'))
      cashUi.finance.open = false
      cashUi.financeFeedback.textContent = ''
      state.cashRegister.editFinance = { adjust: false, collectTotal: false, deposit: false, discount: false }
      const summary = appointment
        ? state.cashRegister.appointmentFinanceSummaryCache[appointmentFinanceCacheKey(appointment.id)] || appointment.financeSummary
        : null
      if (summary && !cashUi.finance.hidden) renderAppointmentFinanceSummary(summary)
      else resetAppointmentFinanceView()
      prepareCreateAppointmentPayment(appointment)
      prepareAppointmentProducts(appointment)
    }

    async function submitAppointmentTotalAdjustment(event) {
      event.preventDefault()
      const value = Number(cashUi.estimatedTotal.value)
      const reason = cashUi.totalReason.value.trim()
      if (!Number.isSafeInteger(value) || value < 0) {
        cashUi.financeFeedback.textContent = 'Ingresá un monto nominal entero válido.'
        cashUi.financeFeedback.className = 'appointment-finance-feedback error'
        return
      }
      if (!reason) {
        showAppointmentFinanceError('Ingresá un motivo breve para el ajuste.')
        cashUi.totalReason.focus()
        return
      }
      const finance = state.cashRegister.appointmentFinance
      if (finance?.pricingMode === 'ESTIMATED' && value < finance.minimumAmount) {
        showAppointmentFinanceError('El total no puede ser menor al precio base de ' + cashMoney(finance.minimumAmount) + '.')
        return
      }
      if (finance && value < finance.paidAmount) {
        showAppointmentFinanceError('El total no puede ser menor a lo ya cobrado: ' + cashMoney(finance.paidAmount) + '.')
        return
      }
      try {
        await getJson('/appointments/' + encodeURIComponent(state.editingAppointmentId) + '/adjust-total', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newAmount: value, reason, ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) }) })
        state.cashRegister.editFinance.adjust = false
        cashUi.totalReason.value = ''
        await loadAppointmentFinance()
        showCrmToast('Total ajustado y registrado en el historial.', 'success')
      } catch (error) {
        showAppointmentFinanceError(error.message)
      }
    }

    function syncAppointmentDiscountField() {
      const percentage = cashUi.discountType.value === 'PERCENTAGE'
      cashUi.discountValueLabel.textContent = percentage ? 'Porcentaje' : 'Monto'
      cashUi.discountValue.min = percentage ? '0.01' : '0'
      cashUi.discountValue.max = percentage ? '100' : ''
      cashUi.discountValue.step = percentage ? '0.01' : '1'
      cashUi.discountHelp.textContent = percentage
        ? 'Se calcula sobre el total acordado y se redondea al peso entero más cercano.'
        : 'Se guarda como un monto nominal sobre el total del turno.'
    }

    function showAppointmentFinanceError(message) {
      cashUi.financeFeedback.textContent = message
      cashUi.financeFeedback.className = 'appointment-finance-feedback error'
      showCrmToast(message, 'error')
    }

    async function submitAppointmentDiscount(event) {
      event.preventDefault()
      const discountType = cashUi.discountType.value
      const discountValue = Number(cashUi.discountValue.value)
      if (discountType === 'AMOUNT' && (!Number.isSafeInteger(discountValue) || discountValue < 0)) {
        showAppointmentFinanceError('El monto del descuento debe ser un número entero mayor o igual a cero.')
        return
      }
      if (discountType === 'PERCENTAGE' && (!Number.isFinite(discountValue) || discountValue <= 0 || discountValue > 100)) {
        showAppointmentFinanceError('El porcentaje debe ser mayor a 0 y no superar 100.')
        return
      }
      try {
        await getJson('/appointments/' + encodeURIComponent(state.editingAppointmentId) + '/discount', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discountType, discountValue, ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) }) })
        await loadAppointmentFinance()
        showCrmToast('Descuento actualizado.', 'success')
      } catch (error) {
        showAppointmentFinanceError(error.message)
      }
    }

    async function submitAppointmentPayment(event) {
      event.preventDefault()
      const lines = [{ amount: Number(cashUi.paymentAmount.value), method: cashUi.paymentMethod.value }]
      if (!cashUi.paymentLineTwo.hidden) lines.push({ amount: Number(cashUi.paymentAmountTwo.value), method: cashUi.paymentMethodTwo.value })
      if (lines.some((line) => !Number.isSafeInteger(line.amount) || line.amount <= 0)) {
        cashUi.financeFeedback.textContent = 'Cada pago debe ser un importe entero mayor a cero.'
        cashUi.financeFeedback.className = 'appointment-finance-feedback error'
        return
      }
      const pendingAmount = Number(state.cashRegister.appointmentFinance?.balanceAmount || 0)
      if (lines.reduce((total, line) => total + line.amount, 0) !== pendingAmount) {
        showAppointmentFinanceError('Los medios de pago deben completar exactamente el saldo pendiente.')
        return
      }
      const completedWithPayment = !cashUi.paymentCompleteRow.hidden && cashUi.paymentComplete.checked
      try {
        await getJson('/appointments/' + encodeURIComponent(state.editingAppointmentId) + '/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cashSessionId: state.cashRegister.current?.session?.id, lines, completeAppointment: completedWithPayment, observation: cashUi.paymentObservation.value.trim() || undefined, ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) }) })
        cashUi.paymentAmount.value = ''
        cashUi.paymentMethod.value = 'CASH'
        cashUi.paymentAmountTwo.value = ''
        cashUi.paymentMethodTwo.value = 'TRANSFER'
        cashUi.paymentObservation.value = ''
        cashUi.paymentLineTwo.hidden = true
        cashUi.paymentComplete.checked = false
        state.cashRegister.editFinance.collectTotal = false
        await loadAppointmentFinance()
        if (completedWithPayment) await loadAgenda()
        showCrmToast(completedWithPayment ? 'Pago registrado y turno marcado como realizado.' : 'Pago registrado.', 'success')
      } catch (error) {
        if (error.body?.code === 'CASH_CLOSED' || error.body?.code === 'STALE_SESSION') await loadAppointmentFinance()
        cashUi.financeFeedback.textContent = error.message
        cashUi.financeFeedback.className = 'appointment-finance-feedback error'
      }
    }

    async function submitAppointmentDeposit(event) {
      event.preventDefault()
      const amount = Number(cashUi.editDepositAmount.value)
      const pendingAmount = Number(state.cashRegister.appointmentFinance?.balanceAmount || 0)
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        showAppointmentFinanceError('Ingresá una seña entera mayor a cero.')
        return
      }
      if (amount > pendingAmount) {
        showAppointmentFinanceError('La seña no puede superar el saldo pendiente del turno.')
        return
      }
      try {
        await getJson('/appointments/' + encodeURIComponent(state.editingAppointmentId) + '/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cashSessionId: state.cashRegister.current?.session?.id, lines: [{ amount, method: cashUi.editDepositMethod.value }], observation: cashUi.paymentObservation.value.trim() || undefined, ...(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) }) })
        cashUi.editDepositAmount.value = ''
        cashUi.editDepositMethod.value = 'TRANSFER'
        cashUi.paymentObservation.value = ''
        await loadAppointmentFinance()
        showCrmToast('Seña registrada.', 'success')
      } catch (error) {
        if (error.body?.code === 'CASH_CLOSED' || error.body?.code === 'STALE_SESSION') await loadAppointmentFinance()
        showAppointmentFinanceError(error.message)
      }
    }

    cashUi.productCatalogOpen.addEventListener('click', openCashProductCatalog)
    cashUi.productCatalogX.addEventListener('click', closeCashProductCatalog)
    cashUi.productCatalogClose.addEventListener('click', closeCashProductCatalog)
    cashUi.productCategoryNew.addEventListener('click', () => editCashProductCategory(null))
    cashUi.productCategoryCancel.addEventListener('click', () => { cashUi.productCategoryForm.hidden = true })
    cashUi.productCategoryForm.addEventListener('submit', submitCashProductCategory)
    cashUi.productCategoryList.addEventListener('click', (event) => { const button = event.target.closest('[data-product-category-edit]'); if (button) editCashProductCategory(button.dataset.productCategoryEdit) })
    cashUi.productNew.addEventListener('click', () => editCashProduct(null))
    cashUi.productCancel.addEventListener('click', () => { cashUi.productForm.hidden = true })
    cashUi.productForm.addEventListener('submit', submitCashProduct)
    cashUi.productList.addEventListener('click', (event) => { const button = event.target.closest('[data-product-edit]'); if (button) editCashProduct(button.dataset.productEdit) })
    cashUi.productSaleOpen.addEventListener('click', openCashProductSale)
    cashUi.productSaleX.addEventListener('click', () => { cashUi.productSaleDialog.hidden = true })
    cashUi.productSaleCancel.addEventListener('click', () => { cashUi.productSaleDialog.hidden = true })
    cashUi.productSaleAdd.addEventListener('click', addCashProductSaleItem)
    cashUi.productSaleDiscount.addEventListener('input', renderCashProductSale)
    cashUi.productSaleItems.addEventListener('click', (event) => { const button = event.target.closest('[data-product-sale-remove]'); if (!button) return; state.cashRegister.productSaleItems = state.cashRegister.productSaleItems.filter((item) => item.productId !== button.dataset.productSaleRemove); renderCashProductSale() })
    cashUi.productSaleForm.addEventListener('submit', submitCashProductSale)
    cashUi.appointmentProductAdd.addEventListener('click', addAppointmentProductItem)
    cashUi.appointmentProductList.addEventListener('click', (event) => { const update = event.target.closest('[data-appointment-product-update]'); if (update) { updateAppointmentProductItem(update.dataset.appointmentProductUpdate); return }; const button = event.target.closest('[data-appointment-product-remove]'); if (button) removeAppointmentProductItem(button.dataset.appointmentProductRemove) })
    cashUi.openEmpty.addEventListener('click', () => openCashSessionDialog('open'))
    cashUi.openToolbar.addEventListener('click', () => openCashSessionDialog('open'))
    cashUi.newSession.addEventListener('click', () => openCashSessionDialog('new'))
    cashUi.closeDay.addEventListener('click', () => openCashSessionDialog('close'))
    cashUi.sessionX.addEventListener('click', () => { closeCashSessionDialog(); returnToAppointmentDraft() })
    cashUi.sessionCancel.addEventListener('click', () => { closeCashSessionDialog(); returnToAppointmentDraft() })
    cashUi.countedCash.addEventListener('input', () => {
      cashUi.differenceConfirm.checked = false
      syncCashSessionReconciliation()
      syncCashCloseChange()
    })
    cashUi.closeLeaveChange.addEventListener('change', () => {
      if (cashUi.closeLeaveChange.checked && !cashUi.closeCashToLeave.value.trim()) {
        const counted = Number(cashUi.countedCash.value)
        cashUi.closeCashToLeave.value = String(cashUi.countedCash.value.trim() && Number.isSafeInteger(counted) && counted >= 0 ? Math.min(counted, 20_000) : 20_000)
      }
      syncCashCloseChange()
    })
    cashUi.closeCashToLeave.addEventListener('input', syncCashCloseChange)
    cashUi.sessionForm.addEventListener('submit', submitCashSession)
    cashUi.operationOpen.addEventListener('click', openCashOperationDialog)
    cashUi.operationX.addEventListener('click', closeCashOperationDialog)
    cashUi.operationCancel.addEventListener('click', closeCashOperationDialog)
    cashUi.operationType.addEventListener('change', syncCashOperationFields)
    cashUi.operationCategory.addEventListener('change', renderCashExpenseSubcategoryOptions)
    cashUi.operationForm.addEventListener('submit', submitCashOperation)
    cashUi.categoryManage.addEventListener('click', () => openCashExpenseCategoryDialog())
    cashUi.categoryX.addEventListener('click', closeCashExpenseCategoryDialog)
    cashUi.categoryClose.addEventListener('click', closeCashExpenseCategoryDialog)
    cashUi.categoryNew.addEventListener('click', () => editCashExpenseCategory(null))
    cashUi.categoryEditCancel.addEventListener('click', cancelCashExpenseCategoryEdit)
    cashUi.categoryForm.addEventListener('submit', submitCashExpenseCategory)
    cashUi.subcategoryNew.addEventListener('click', () => editCashExpenseSubcategory(null))
    cashUi.subcategoryCancel.addEventListener('click', cancelCashExpenseSubcategoryEdit)
    cashUi.subcategoryForm.addEventListener('submit', submitCashExpenseSubcategory)
    cashUi.subcategoryList.addEventListener('click', (event) => { const button = event.target.closest('[data-cash-subcategory-edit]'); if (button) editCashExpenseSubcategory(button.dataset.cashSubcategoryEdit) })
    cashUi.categoryList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-cash-category-edit]')
      if (button) editCashExpenseCategory(button.dataset.cashCategoryEdit)
    })
    cashUi.viewDay.addEventListener('click', () => setCashView('day'))
    cashUi.viewPeriod.addEventListener('click', () => setCashView('period'))
    cashUi.viewProfessionals.addEventListener('click', () => setCashView('professionals'))
    cashUi.viewTreasury.addEventListener('click', () => setCashView('treasury'))
    document.getElementById('cash-treasury-enable').addEventListener('click', async () => {
      const feedback = document.getElementById('cash-treasury-feedback')
      try {
        await getJson('/treasury/enable-cash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isCashBusinessScopedRole() ? { businessId: state.businessId } : {}) })
        await loadTreasury()
      } catch (error) { feedback.textContent = error.message; feedback.className = 'cash-feedback error' }
    })
    for (const id of ['cash-treasury-transfer-form', 'cash-treasury-outflow-form']) for (const eventName of ['input', 'change']) document.getElementById(id).addEventListener(eventName, (event) => { delete event.currentTarget.dataset.key })
    document.getElementById('cash-treasury-outflow-kind').addEventListener('change', renderTreasuryClassificationOptions)
    document.getElementById('cash-treasury-outflow-category').addEventListener('change', renderTreasuryClassificationOptions)
    document.getElementById('cash-treasury-filter-category').addEventListener('change', () => { renderTreasuryClassificationOptions(); loadTreasury() })
    document.getElementById('cash-treasury-filter-subcategory').addEventListener('change', loadTreasury)
    document.getElementById('cash-treasury-period-apply').addEventListener('click', loadTreasuryConsolidated)
    document.getElementById('cash-treasury-transfer-form').addEventListener('submit', submitTreasuryTransfer)
    document.getElementById('cash-treasury-outflow-form').addEventListener('submit', submitTreasuryOutflow)
    cashUi.professionalRefresh.addEventListener('click', () => loadProfessionalSettlements({ page: state.cashRegister.professionalPage }))
    cashUi.professionalPaymentForm.addEventListener('submit', submitProfessionalPayment)
    for (const eventName of ['input', 'change']) cashUi.professionalPaymentForm.addEventListener(eventName, () => { delete cashUi.professionalPaymentForm.dataset.key })
    cashUi.professionalPaymentSource.addEventListener('change', syncProfessionalPaymentSource)
    cashUi.professionalSummary.addEventListener('click', (event) => {
      const button = event.target.closest('[data-professional-settlement-toggle]')
      if (!button) return
      const professionalId = button.dataset.professionalSettlementToggle
      if (state.cashRegister.professionalExpandedIds.has(professionalId)) state.cashRegister.professionalExpandedIds.delete(professionalId)
      else state.cashRegister.professionalExpandedIds.add(professionalId)
      if (state.cashRegister.professionalSummaryResult) renderProfessionalSettlements(state.cashRegister.professionalSummaryResult)
    })
    document.querySelectorAll('[data-cash-professional-preset]').forEach((button) => button.addEventListener('click', () => {
      setProfessionalPeriodPreset(button.dataset.cashProfessionalPreset)
      if (button.dataset.cashProfessionalPreset !== 'custom') {
        state.cashRegister.professionalPage = 1
        loadProfessionalSettlements({ page: 1 })
      }
    }))
    cashUi.professionalPeriodFrom.addEventListener('change', () => setProfessionalPeriodPreset('custom'))
    cashUi.professionalPeriodTo.addEventListener('change', () => setProfessionalPeriodPreset('custom'))
    cashUi.professionalPeriodApply.addEventListener('click', () => {
      state.cashRegister.professionalPage = 1
      loadProfessionalSettlements({ page: 1 })
    })
    cashUi.professionalPrevious.addEventListener('click', () => loadProfessionalSettlements({ page: Math.max(1, state.cashRegister.professionalPage - 1) }))
    cashUi.professionalNext.addEventListener('click', () => loadProfessionalSettlements({ page: Math.min(state.cashRegister.professionalTotalPages, state.cashRegister.professionalPage + 1) }))
    document.querySelectorAll('[data-cash-period-preset]').forEach((button) => button.addEventListener('click', () => {
      setCashPeriodPreset(button.dataset.cashPeriodPreset)
      if (button.dataset.cashPeriodPreset !== 'custom') { state.cashRegister.periodPage = 1; loadCashPeriod({ page: 1 }) }
    }))
    cashUi.periodFrom.addEventListener('change', () => setCashPeriodPreset('custom'))
    cashUi.periodTo.addEventListener('change', () => setCashPeriodPreset('custom'))
    cashUi.periodApply.addEventListener('click', () => { state.cashRegister.periodPage = 1; loadCashPeriod({ page: 1 }) })
    cashUi.periodCategoryFilter.addEventListener('change', () => { renderCashExpenseSubcategoryOptions(); state.cashRegister.periodPage = 1; loadCashPeriod({ page: 1 }) })
    cashUi.periodSubcategoryFilter.addEventListener('change', () => { state.cashRegister.periodPage = 1; loadCashPeriod({ page: 1 }) })
    cashUi.periodMethodFilter.addEventListener('change', () => { state.cashRegister.periodPage = 1; loadCashPeriod({ page: 1 }) })
    cashUi.periodPageSize.addEventListener('change', () => { state.cashRegister.periodPage = 1; loadCashPeriod({ page: 1 }) })
    cashUi.periodSearch.addEventListener('input', () => { clearTimeout(state.cashRegister.searchTimer); state.cashRegister.searchTimer = setTimeout(() => { state.cashRegister.periodPage = 1; loadCashPeriod({ page: 1 }) }, 250) })
    cashUi.periodPrevious.addEventListener('click', () => loadCashPeriod({ page: Math.max(1, state.cashRegister.periodPage - 1) }))
    cashUi.periodNext.addEventListener('click', () => loadCashPeriod({ page: Math.min(state.cashRegister.periodTotalPages, state.cashRegister.periodPage + 1) }))
    setCashPeriodPreset('month')
    const treasuryPeriod = cashPeriodDates('month')
    document.getElementById('cash-treasury-period-from').value = treasuryPeriod.from
    document.getElementById('cash-treasury-period-to').value = treasuryPeriod.to
    setProfessionalPeriodPreset('week')
    cashUi.refresh.addEventListener('click', () => loadCashRegister().catch((error) => showCrmToast(error.message, 'error')))
    cashUi.daySelect.addEventListener('change', () => selectCashDay(cashUi.daySelect.value).catch((error) => showCrmToast(error.message, 'error')))
    cashUi.typeFilter.addEventListener('change', () => loadCashEntries())
    cashUi.methodFilter.addEventListener('change', () => loadCashEntries())
    cashUi.categoryFilter.addEventListener('change', () => { renderCashExpenseSubcategoryOptions(); loadCashEntries() })
    cashUi.subcategoryFilter.addEventListener('change', () => loadCashEntries())
    cashUi.sessionFilter.addEventListener('change', () => loadCashEntries())
    cashUi.search.addEventListener('input', () => { clearTimeout(state.cashRegister.searchTimer); state.cashRegister.searchTimer = setTimeout(() => loadCashEntries(), 250) })
    cashUi.nextPage.addEventListener('click', () => loadCashEntries({ append: true }))
    cashUi.finance.addEventListener('toggle', () => { if (cashUi.finance.open) { scrollAppointmentFinanceIntoView(); loadAppointmentFinance({ force: false, preserve: true }) } })
    cashUi.totalToggle.addEventListener('click', () => {
      state.cashRegister.editFinance.adjust = !state.cashRegister.editFinance.adjust
      if (state.cashRegister.editFinance.adjust) {
        cashUi.estimatedTotal.value = String(state.cashRegister.appointmentFinance?.agreedAmount ?? '')
        requestAnimationFrame(() => cashUi.estimatedTotal.focus())
      } else {
        cashUi.totalReason.value = ''
      }
      syncEditAppointmentFinanceActions()
    })
    cashUi.totalCancel.addEventListener('click', () => {
      state.cashRegister.editFinance.adjust = false
      cashUi.totalReason.value = ''
      syncEditAppointmentFinanceActions()
    })
    cashUi.totalSubmit.addEventListener('click', submitAppointmentTotalAdjustment)
    cashUi.discountType.addEventListener('change', () => { cashUi.discountValue.value = ''; syncAppointmentDiscountField() })
    cashUi.discountSubmit.addEventListener('click', submitAppointmentDiscount)
    cashUi.editCollectTotal.addEventListener('click', () => {
      state.cashRegister.editFinance.collectTotal = !state.cashRegister.editFinance.collectTotal
      if (state.cashRegister.editFinance.collectTotal) {
        state.cashRegister.editFinance.deposit = false
        cashUi.paymentMethod.value = 'CASH'
        const appointment = editingAgendaAppointment()
        cashUi.paymentComplete.checked = Boolean(
          appointment &&
          canEditAppointments() &&
          !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(appointment.status) &&
          new Date(appointment.startAt).getTime() <= Date.now()
        )
      } else {
        cashUi.paymentComplete.checked = false
      }
      cashUi.paymentLineTwo.hidden = true
      cashUi.paymentAmountTwo.value = ''
      syncEditAppointmentFinanceActions()
    })
    cashUi.editDeposit.addEventListener('click', () => {
      state.cashRegister.editFinance.deposit = !state.cashRegister.editFinance.deposit
      if (state.cashRegister.editFinance.deposit) {
        state.cashRegister.editFinance.collectTotal = false
        cashUi.editDepositMethod.value = 'TRANSFER'
      }
      syncEditAppointmentFinanceActions()
    })
    cashUi.editDiscountToggle.addEventListener('click', () => {
      state.cashRegister.editFinance.discount = !state.cashRegister.editFinance.discount
      syncEditAppointmentFinanceActions()
    })
    cashUi.addPaymentLine.addEventListener('click', () => {
      cashUi.paymentLineTwo.hidden = !cashUi.paymentLineTwo.hidden
      if (cashUi.paymentLineTwo.hidden) cashUi.paymentAmount.value = String(state.cashRegister.appointmentFinance?.balanceAmount || '')
      syncEditAppointmentFinanceActions()
    })
    cashUi.paymentAmount.addEventListener('input', syncEditAppointmentFinanceActions)
    cashUi.paymentSubmit.addEventListener('click', submitAppointmentPayment)
    cashUi.editDepositSubmit.addEventListener('click', submitAppointmentDeposit)
    cashUi.createPayment.addEventListener('toggle', syncCreateAppointmentPayment)
    cashUi.createCollectTotal.addEventListener('click', () => {
      state.cashRegister.createFinance.collectTotal = !state.cashRegister.createFinance.collectTotal
      if (state.cashRegister.createFinance.collectTotal) cashUi.createPaymentMethod.value = 'CASH'
      cashUi.createPaymentLineTwo.hidden = true
      cashUi.createPaymentAmountTwo.value = ''
      syncCreateAppointmentPayment()
    })
    cashUi.createDeposit.addEventListener('click', () => {
      state.cashRegister.createFinance.deposit = !state.cashRegister.createFinance.deposit
      if (state.cashRegister.createFinance.deposit) cashUi.createDepositMethod.value = 'TRANSFER'
      syncCreateAppointmentPayment()
    })
    cashUi.createDiscountToggle.addEventListener('click', () => {
      state.cashRegister.createFinance.discount = !state.cashRegister.createFinance.discount
      syncCreateAppointmentPayment()
    })
    cashUi.createDiscountType.addEventListener('change', () => {
      cashUi.createDiscountValue.value = ''
      syncCreateAppointmentPayment()
    })
    cashUi.createDiscountValue.addEventListener('input', syncCreateAppointmentPayment)
    cashUi.createDepositAmount.addEventListener('input', syncCreateAppointmentPayment)
    cashUi.createEstimatedTotal.addEventListener('input', syncCreateAppointmentPayment)
    cashUi.createPaymentAmount.addEventListener('input', syncCreateAppointmentPayment)
    cashUi.createAddPaymentLine.addEventListener('click', () => {
      cashUi.createPaymentLineTwo.hidden = !cashUi.createPaymentLineTwo.hidden
      if (!cashUi.createPaymentLineTwo.hidden) cashUi.createPaymentAmount.value = ''
      syncCreateAppointmentPayment()
    })
    els.appointmentService.addEventListener('change', () => {
      syncCreateAppointmentPayment()
    })
    els.appointmentProfessional.addEventListener('change', () => {
      syncCreateAppointmentPayment()
    })
    cashUi.createOpenCash.addEventListener('click', () => {
      if (!canUseCashPermission('canManageCashSessions')) return
      state.cashRegister.returnToAppointment = true
      els.appointmentDialog.hidden = true
      setSection('cash')
      openCashSessionDialog('open')
    })
    cashUi.appointmentOpenCash.addEventListener('click', () => {
      if (!canUseCashPermission('canManageCashSessions')) return
      state.cashRegister.returnToAppointment = true
      els.appointmentDialog.hidden = true
      setSection('cash')
      openCashSessionDialog('open')
    })
`
