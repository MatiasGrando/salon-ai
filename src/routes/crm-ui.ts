import type { FastifyInstance } from 'fastify'

export async function crmUiRoutes(app: FastifyInstance) {
  app.get('/crm', async (_request, reply) => {
    return reply.type('text/html').send(crmHtml)
  })
}

const crmHtml = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CRM Salon AI</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f6f8;
      --surface: #ffffff;
      --surface-soft: #f9f9fb;
      --line: #e4e6eb;
      --line-strong: #cccfd8;
      --text: #111318;
      --muted: #6b7280;
      --accent: #2563eb;
      --accent-strong: #1d4ed8;
      --accent-soft: #eff6ff;
      --warn: #b45309;
      --warn-soft: #fffbeb;
      --danger: #dc2626;
      --danger-soft: #fef2f2;
      --shadow: 0 1px 4px rgba(0,0,0,0.06);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      height: 100%;
      overflow: hidden;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
    }

    button,
    input,
    textarea,
    select {
      font: inherit;
    }

    button {
      border: 0;
      cursor: pointer;
    }

    .app {
      display: grid;
      grid-template-columns: minmax(280px, 340px) minmax(360px, 1fr) minmax(300px, 360px);
      height: 100dvh;
      overflow: hidden;
      min-height: 0;
    }

    .sidebar,
    .details {
      min-width: 0;
      min-height: 0;
      height: 100%;
      background: var(--surface);
      border-color: var(--line);
      border-style: solid;
      display: flex;
      flex-direction: column;
    }

    .sidebar {
      border-width: 0 1px 0 0;
    }

    .details {
      border-width: 0 0 0 1px;
      overflow: auto;
    }

    .mobile-nav,
    .mobile-only {
      display: none;
    }

    .topbar {
      min-height: 64px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: var(--surface);
      flex-shrink: 0;
    }

    .brand {
      min-width: 0;
    }

    .brand h1,
    .panel-title {
      margin: 0;
      font-size: 16px;
      line-height: 1.2;
      font-weight: 750;
      letter-spacing: 0;
    }

    .brand p,
    .hint,
    .meta {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .search {
      padding: 12px;
      border-bottom: 1px solid var(--line);
      display: flex;
      gap: 8px;
      background: var(--surface-soft);
      flex-shrink: 0;
    }

    .ops-panel {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      display: grid;
      gap: 8px;
      background: var(--surface);
      flex-shrink: 0;
    }

    .ops-panel .row {
      align-items: center;
    }

    .counter {
      min-width: 28px;
      height: 24px;
      padding: 0 8px;
      border-radius: 999px;
      display: inline-grid;
      place-items: center;
      color: var(--danger);
      background: var(--danger-soft);
      font-weight: 800;
      font-size: 12px;
    }

    .search input,
    .field,
    textarea,
    select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #fff;
      color: var(--text);
      outline: none;
    }

    .search input,
    .field,
    select {
      height: 38px;
      padding: 0 10px;
    }

    .search input:focus,
    .field:focus,
    textarea:focus,
    select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }

    .icon-button,
    .primary,
    .secondary,
    .danger {
      height: 38px;
      border-radius: 7px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      white-space: nowrap;
      font-weight: 650;
      font-size: 13px;
    }

    .icon-button {
      width: 38px;
      color: var(--text);
      background: #fff;
      border: 1px solid var(--line);
    }

    .primary {
      padding: 0 14px;
      color: #fff;
      background: var(--accent);
    }

    .primary:hover {
      background: var(--accent-strong);
    }

    .secondary {
      padding: 0 12px;
      color: var(--text);
      background: #fff;
      border: 1px solid var(--line);
    }

    .danger {
      padding: 0 12px;
      color: var(--danger);
      background: var(--danger-soft);
    }

    .conversation-list,
    .scroll {
      overflow: auto;
      min-height: 0;
    }

    .conversation-list {
      flex: 1;
    }

    .conversation {
      width: 100%;
      min-height: 78px;
      padding: 12px 14px;
      display: grid;
      grid-template-columns: 42px 1fr;
      gap: 10px;
      text-align: left;
      background: var(--surface);
      border-bottom: 1px solid var(--line);
    }

    .conversation:hover,
    .conversation.active {
      background: var(--accent-soft);
    }

    .avatar {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #fff;
      background: var(--accent);
      font-size: 14px;
      font-weight: 800;
    }

    .conversation-main {
      min-width: 0;
    }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }

    .phone,
    .item-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 14px;
      font-weight: 720;
      color: var(--text);
    }

    .preview {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .chip {
      height: 22px;
      padding: 0 8px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      color: var(--accent-strong);
      background: var(--accent-soft);
      font-size: 11px;
      font-weight: 750;
      white-space: nowrap;
    }

    .chip.warn {
      color: var(--warn);
      background: var(--warn-soft);
    }

    .chip.handoff {
      color: var(--danger);
      background: var(--danger-soft);
    }

    .chip.manual {
      color: var(--warn);
      background: var(--warn-soft);
    }

    .chat {
      min-width: 0;
      min-height: 0;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: #eef3f1;
    }

    .chat-header {
      min-height: 64px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: var(--surface);
      flex-shrink: 0;
    }

    .chat-title {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .chat-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .messages {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .message {
      max-width: min(680px, 78%);
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--surface);
      box-shadow: 0 1px 0 rgba(31, 42, 38, 0.04);
      line-height: 1.45;
      font-size: 14px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .message.outbound {
      align-self: flex-end;
      background: #d9f2ed;
    }

    .message.inbound {
      align-self: flex-start;
    }

    .message-time {
      margin-top: 6px;
      color: var(--muted);
      font-size: 11px;
      text-align: right;
    }

    .composer {
      padding: 12px 14px;
      border-top: 1px solid var(--line);
      background: var(--surface);
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: end;
      flex-shrink: 0;
    }

    textarea {
      min-height: 44px;
      max-height: 140px;
      resize: vertical;
      padding: 10px 12px;
      line-height: 1.35;
    }

    .send-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: stretch;
    }

    .toggle {
      height: 28px;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }

    .toggle input {
      width: 16px;
      height: 16px;
      accent-color: var(--accent);
    }

    .details-section {
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
    }

    .stack {
      display: grid;
      gap: 10px;
    }

    .data-grid {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }

    .data-row {
      display: grid;
      grid-template-columns: 92px 1fr;
      gap: 8px;
      font-size: 13px;
    }

    .label {
      color: var(--muted);
    }

    .value {
      min-width: 0;
      overflow-wrap: anywhere;
      font-weight: 650;
    }

    .item {
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }

    .item p {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .block-form {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }

    .block-grid,
    .config-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .config-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .config-list {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }

    .config-list .item {
      display: grid;
      gap: 6px;
    }

    .config-panel {
      border-bottom: 1px solid var(--line);
    }

    .config-panel > summary {
      min-height: 48px;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      cursor: pointer;
      list-style: none;
    }

    .config-panel > summary::-webkit-details-marker {
      display: none;
    }

    .config-panel > summary::after {
      content: ">";
      color: var(--muted);
      font-weight: 800;
      transform: rotate(90deg);
    }

    .config-panel:not([open]) > summary::after {
      transform: rotate(0);
    }

    .config-panel-body {
      padding: 0 16px 14px;
    }

    .schedule-row {
      display: grid;
      grid-template-columns: minmax(92px, 1fr) 86px 86px;
      gap: 8px;
      align-items: center;
    }

    .schedule-row label {
      min-width: 0;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: var(--text);
      font-size: 13px;
      font-weight: 650;
    }

    .empty,
    .error {
      padding: 18px;
      color: var(--muted);
      text-align: center;
      font-size: 13px;
      line-height: 1.4;
    }

    .error {
      color: var(--danger);
    }

    @media (max-width: 1120px) {
      .app {
        grid-template-columns: minmax(260px, 320px) 1fr;
      }

      .details {
        display: none;
      }
    }

    @media (max-width: 760px) {
      body {
        min-height: 100dvh;
      }

      .mobile-nav {
        height: 52px;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
        padding: 6px;
        border-bottom: 1px solid var(--line);
        background: var(--surface);
      }

      .mobile-nav button {
        height: 40px;
        border-radius: 7px;
        color: var(--muted);
        background: var(--surface-soft);
        font-size: 13px;
        font-weight: 750;
      }

      .mobile-nav button.active {
        color: #fff;
        background: var(--accent);
      }

      .mobile-only {
        display: inline-flex;
      }

      .app {
        display: block;
        height: calc(100dvh - 52px);
        min-height: 0;
      }

      .sidebar,
      .chat,
      .details {
        width: 100%;
        height: 100%;
        min-height: 0;
        border-width: 0;
      }

      .sidebar {
        display: none;
      }

      .chat,
      .details {
        display: none;
      }

      body[data-mobile-view="inbox"] .sidebar,
      body[data-mobile-view="chat"] .chat,
      body[data-mobile-view="details"] .details {
        display: flex;
      }

      body[data-mobile-view="details"] .details {
        overflow: auto;
      }

      .topbar,
      .chat-header {
        min-height: 58px;
        padding: 10px 12px;
      }

      .search {
        padding: 10px;
      }

      .conversation {
        min-height: 84px;
      }

      .messages {
        padding: 14px;
      }

      .composer {
        grid-template-columns: 1fr;
      }

      .message {
        max-width: 92%;
      }
    }

    .crm-top {
      height: 82px;
      padding: 12px 24px;
      display: grid;
      grid-template-columns: 250px 136px repeat(3, minmax(132px, 1fr)) auto 48px;
      gap: 12px;
      align-items: center;
      border-bottom: 1px solid #e4e6eb;
      background: #ffffff;
    }

    .crm-brand,
    .metric-card,
    .user-pill {
      min-width: 0;
    }

    .crm-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand-mark {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      color: #fff;
      background: #2563eb;
      font-weight: 850;
    }

    .crm-brand strong {
      display: block;
      color: #111318;
      font-size: 18px;
      line-height: 1.1;
    }

    .crm-brand span,
    .metric-card span {
      display: block;
      color: #64746f;
      font-size: 12px;
      line-height: 1.25;
    }

    .metric-card {
      height: 58px;
      padding: 10px 14px;
      border: 1px solid #e3ebe7;
      border-radius: 8px;
      background: #fff;
    }

    .metric-card.active {
      position: relative;
      display: grid;
      align-content: center;
      gap: 2px;
    }

    .metric-card.active::after {
      content: "";
      position: absolute;
      left: 18px;
      right: 18px;
      bottom: 0;
      height: 3px;
      border-radius: 999px 999px 0 0;
      background: #2563eb;
    }

    .metric-card strong {
      display: block;
      margin-top: 2px;
      color: #16231f;
      font-size: 22px;
      line-height: 1;
      font-weight: 850;
    }

    .metric-card.active strong {
      font-size: 14px;
    }

    .top-action {
      height: 46px;
      padding: 0 16px;
      border-radius: 8px;
    }

    .user-pill {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #2563eb;
      background: #eff6ff;
      font-weight: 850;
    }

    .app {
      grid-template-columns: 92px minmax(290px, 336px) minmax(420px, 1fr) minmax(310px, 360px);
      height: calc(100dvh - 82px);
      background: #f5f6f8;
    }

    .workspace-nav {
      min-height: 0;
      padding: 20px 8px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      background: #ffffff;
      color: #6b7280;
      border-right: 1px solid #e4e6eb;
    }

    .workspace-nav button {
      width: 76px;
      min-height: 66px;
      padding: 8px 6px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      gap: 4px;
      color: #9ca3af;
      background: transparent;
    }

    .workspace-nav button.active,
    .workspace-nav button:hover {
      color: #2563eb;
      background: #eff6ff;
      box-shadow: none;
    }

    .workspace-nav span {
      font-size: 20px;
      line-height: 1;
    }

    .workspace-nav strong {
      font-size: 11px;
      line-height: 1.15;
      font-weight: 780;
    }

    .nav-user {
      margin-top: auto;
      display: grid;
      justify-items: center;
      gap: 6px;
      color: #9ca3af;
      font-size: 11px;
      font-weight: 700;
    }

    .mini-avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #2563eb;
      background: #eff6ff;
      font-weight: 850;
    }

    .sidebar,
    .details,
    .chat-header,
    .composer {
      background: #ffffff;
    }

    .sidebar {
      border-width: 0 1px 0 0;
      border-color: #e4e6eb;
    }

    .sidebar .topbar,
    .details .topbar {
      min-height: 72px;
      border-color: #e4e6eb;
    }

    .search {
      padding: 14px 18px;
      gap: 10px;
      background: #fff;
    }

    .search input,
    .field,
    textarea,
    select {
      border-color: #e4e6eb;
      border-radius: 8px;
    }

    .ops-panel {
      margin: 0 18px 12px;
      padding: 12px;
      border: 1px solid #e4e6eb;
      border-radius: 8px;
      background: #f9f9fb;
    }

    .conversation {
      width: calc(100% - 20px);
      min-height: 88px;
      margin: 0 10px 8px;
      padding: 14px;
      border: 1px solid transparent;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }

    .conversation:hover,
    .conversation.active {
      border-color: #bfdbfe;
      background: #eff6ff;
    }

    .avatar {
      background: #2563eb;
      box-shadow: none;
    }

    .chat {
      background: #f5f6f8;
    }

    .chat-header {
      min-height: 76px;
      border-color: #e4e6eb;
    }

    .chat-actions .secondary,
    .chat-actions .danger {
      height: 34px;
    }

    .messages {
      padding: 24px 32px 28px;
      gap: 14px;
    }

    .message {
      border: 1px solid #e4e6eb;
      border-radius: 10px;
      box-shadow: none;
    }

    .message.outbound {
      background: #eff6ff;
      border-color: #bfdbfe;
    }

    .message.inbound {
      background: #fff;
    }

    .composer {
      margin: 0 24px 18px;
      padding: 10px;
      border: 1px solid #e4e6eb;
      border-radius: 10px;
      box-shadow: none;
    }

    textarea {
      min-height: 42px;
      border-color: transparent;
      background: #fff;
    }

    .details {
      padding: 14px;
      gap: 14px;
      border-color: #e4e6eb;
      background: #f5f6f8;
    }

    .details .topbar,
    .details-section {
      border: 1px solid #e4e6eb;
      border-radius: 10px;
      background: #fff;
      box-shadow: none;
    }

    .details-section {
      padding: 16px;
    }

    .data-grid {
      gap: 14px;
    }

    .data-row {
      grid-template-columns: 1fr;
      gap: 4px;
      padding-bottom: 12px;
      border-bottom: 1px solid #f0f1f5;
    }

    .data-row:last-child {
      padding-bottom: 0;
      border-bottom: 0;
    }

    .item {
      border-color: #e4e6eb;
      border-radius: 8px;
      background: #f9f9fb;
    }

    .details .config-panel {
      display: none;
    }

    .app[data-section="agenda"] {
      grid-template-columns: 92px minmax(0, 1fr);
    }

    .app[data-section="agenda"] .sidebar,
    .app[data-section="agenda"] .chat,
    .app[data-section="agenda"] .details {
      display: none;
    }

    .agenda-view {
      grid-column: 2;
      min-width: 0;
      min-height: 0;
      display: none;
      grid-template-columns: 286px minmax(0, 1fr);
      gap: 14px;
      padding: 14px;
      background: #f5f6f8;
      overflow: hidden;
    }

    .app[data-section="agenda"] .agenda-view {
      display: grid;
    }

    .app[data-section="services"],
    .app[data-section="professionals"],
    .app[data-section="reports"] {
      grid-template-columns: 92px minmax(0, 1fr);
    }

    .app[data-section="services"] .sidebar,
    .app[data-section="services"] .chat,
    .app[data-section="services"] .details,
    .app[data-section="professionals"] .sidebar,
    .app[data-section="professionals"] .chat,
    .app[data-section="professionals"] .details,
    .app[data-section="reports"] .sidebar,
    .app[data-section="reports"] .chat,
    .app[data-section="reports"] .details {
      display: none;
    }

    .services-view,
    .professionals-view,
    .reports-view {
      grid-column: 2;
      min-width: 0;
      min-height: 0;
      display: none;
      padding: 14px;
      background: #f5f6f8;
      overflow: auto;
    }

    .app[data-section="services"] .services-view {
      display: block;
    }

    .app[data-section="professionals"] .professionals-view {
      display: block;
    }

    .app[data-section="reports"] .reports-view {
      display: block;
    }

    .services-shell,
    .professionals-shell,
    .reports-shell {
      max-width: 1080px;
      margin: 0 auto;
      display: grid;
      gap: 14px;
    }

    .services-header,
    .services-manager,
    .professionals-header,
    .professionals-manager,
    .impact-panel {
      border: 1px solid #e4e6eb;
      border-radius: 10px;
      background: #fff;
      box-shadow: none;
    }

    .services-header,
    .professionals-header {
      min-height: 96px;
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .services-header h2,
    .services-manager h3,
    .professionals-header h2,
    .professionals-manager h3,
    .impact-panel h3 {
      margin: 0;
      font-size: 20px;
      line-height: 1.2;
    }

    .services-header p,
    .services-manager p,
    .professionals-header p,
    .professionals-manager p,
    .impact-panel p {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
    }

    .services-manager,
    .professionals-manager {
      padding: 18px;
      display: grid;
      grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }

    .services-form-panel,
    .professionals-form-panel {
      padding: 14px;
      border: 1px solid #e4e6eb;
      border-radius: 8px;
      background: #f9f9fb;
    }

    .services-list-panel,
    .professionals-list-panel {
      min-width: 0;
    }

    .impact-panel {
      display: none;
      padding: 16px;
      border-color: #f5d39a;
      background: #fffaf0;
    }

    .impact-panel.visible {
      display: grid;
      gap: 12px;
    }

    .impact-list {
      display: grid;
      gap: 8px;
      max-height: 280px;
      overflow: auto;
    }

    .impact-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .status-line {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      margin-top: 6px;
    }

    .reports-header,
    .reports-panel,
    .reports-table-panel {
      border: 1px solid #e4e6eb;
      border-radius: 10px;
      background: #fff;
      box-shadow: none;
    }

    .reports-header {
      min-height: 96px;
      padding: 18px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .reports-header h2,
    .reports-panel h3,
    .reports-table-panel h3 {
      margin: 0;
      font-size: 20px;
      line-height: 1.2;
    }

    .reports-header p,
    .reports-panel p,
    .reports-table-panel p {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
    }

    .reports-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }

    .reports-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(150px, 1fr));
      gap: 12px;
    }

    .report-kpi {
      min-height: 112px;
      padding: 14px;
      border: 1px solid #e4e6eb;
      border-radius: 10px;
      background: #f9f9fb;
      display: grid;
      align-content: space-between;
      gap: 10px;
    }

    .report-kpi span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
    }

    .report-kpi strong {
      color: var(--text);
      font-size: 28px;
      line-height: 1;
      font-weight: 850;
    }

    .report-kpi small {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .reports-panels {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
      gap: 14px;
      align-items: stretch;
    }

    .reports-panel,
    .reports-table-panel {
      padding: 16px;
      min-width: 0;
    }

    .future-agenda-panel {
      padding: 16px;
      border: 1px solid #e4e6eb;
      border-radius: 10px;
      background: #fff;
      display: grid;
      gap: 12px;
    }

    .future-agenda-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .future-agenda-head h3 {
      margin: 0;
      font-size: 20px;
      line-height: 1.2;
    }

    .future-agenda-head p {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
    }

    .future-agenda-head select {
      width: min(220px, 100%);
    }

    .future-agenda-summary {
      display: grid;
      grid-template-columns: minmax(150px, 170px) minmax(0, 1fr);
      gap: 10px;
      align-items: stretch;
    }

    .future-total {
      min-width: 0;
      padding: 12px 14px;
      border: 1px solid #e4e6eb;
      border-radius: 10px;
      background: #f9f9fb;
      display: grid;
      align-content: center;
    }

    .future-total span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
    }

    .future-total strong {
      display: block;
      margin-top: 4px;
      font-size: 26px;
      line-height: 1;
    }

    .future-professionals {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      min-width: 0;
    }

    .future-professional {
      min-width: 0;
      padding: 10px 12px;
      border: 1px solid #e4e6eb;
      border-radius: 10px;
      background: #f9f9fb;
      display: grid;
      gap: 7px;
    }

    .future-professional-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 13px;
      min-width: 0;
    }

    .future-professional-row strong {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .report-bars {
      display: grid;
      gap: 12px;
      margin-top: 16px;
    }

    .report-bar-row {
      display: grid;
      grid-template-columns: 128px minmax(0, 1fr) 44px;
      gap: 10px;
      align-items: center;
      font-size: 13px;
    }

    .report-bar-track {
      height: 12px;
      border-radius: 999px;
      background: #f0f1f5;
      overflow: hidden;
    }

    .report-bar-fill {
      height: 100%;
      min-width: 2px;
      border-radius: inherit;
      background: #2563eb;
    }

    .report-bar-fill.warn {
      background: #d97706;
    }

    .report-bar-fill.soft {
      background: #60a5fa;
    }

    .report-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      font-size: 13px;
    }

    .report-table th,
    .report-table td {
      padding: 10px 8px;
      border-bottom: 1px solid #f0f1f5;
      text-align: left;
      vertical-align: middle;
    }

    .report-table th {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .report-table td:last-child,
    .report-table th:last-child {
      text-align: right;
    }

    .report-empty-note {
      padding: 18px;
      color: var(--muted);
      text-align: center;
      border: 1px dashed #e4e6eb;
      border-radius: 8px;
      background: #f9f9fb;
    }

    @media (max-width: 900px) {
      .services-manager,
      .professionals-manager,
      .reports-panels {
        grid-template-columns: 1fr;
      }

      .reports-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .future-agenda-summary {
        grid-template-columns: 1fr;
      }
    }

    .agenda-sidebar,
    .agenda-board {
      min-height: 0;
      border: 1px solid #e4e6eb;
      border-radius: 10px;
      background: #fff;
      box-shadow: none;
    }

    .agenda-sidebar {
      padding: 16px;
      overflow: auto;
    }

    .agenda-sidebar h2,
    .agenda-board h2 {
      margin: 0;
      font-size: 16px;
      line-height: 1.2;
    }

    .agenda-filters {
      display: grid;
      gap: 14px;
    }

    .agenda-filter {
      display: grid;
      gap: 7px;
    }

    .agenda-filter label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }

    .month-card {
      margin-top: 18px;
      padding-top: 16px;
      border-top: 1px solid #e4e6eb;
    }

    .month-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 12px;
    }

    .month-grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 6px;
    }

    .month-weekday,
    .month-day {
      height: 32px;
      display: grid;
      place-items: center;
      border-radius: 7px;
      font-size: 12px;
    }

    .month-weekday {
      color: var(--muted);
      font-weight: 800;
    }

    .month-day {
      color: var(--text);
      background: transparent;
    }

    .month-day.outside {
      color: #a4afaa;
    }

    .month-day.has-items {
      box-shadow: inset 0 0 0 1px #bfdbfe;
    }

    .month-day.selected {
      color: #fff;
      background: #2563eb;
      font-weight: 850;
    }

    .agenda-board {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
    }

    .agenda-toolbar {
      min-height: 72px;
      padding: 14px 18px;
      border-bottom: 1px solid #e4e6eb;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 12px;
    }

    .agenda-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: flex-end;
    }

    .agenda-range {
      text-align: center;
      font-weight: 800;
    }

    .agenda-grid-wrap {
      overflow: auto;
      min-height: 0;
    }

    .agenda-grid {
      display: grid;
      grid-template-columns: 54px repeat(7, minmax(132px, 1fr));
      min-width: 980px;
      position: relative;
    }

    .agenda-corner,
    .agenda-day-head,
    .agenda-time,
    .agenda-cell {
      border-right: 1px solid #e4e6eb;
      border-bottom: 1px solid #e4e6eb;
    }

    .agenda-corner,
    .agenda-day-head {
      position: sticky;
      top: 0;
      z-index: 3;
      height: 38px;
      background: #fff;
    }

    .agenda-corner {
      left: 0;
      z-index: 4;
    }

    .agenda-day-head {
      display: grid;
      place-items: center;
      color: #2563eb;
      font-weight: 850;
      text-decoration: underline;
    }

    .agenda-time {
      position: sticky;
      left: 0;
      z-index: 2;
      height: 28px;
      padding-right: 5px;
      display: flex;
      align-items: flex-start;
      justify-content: flex-end;
      background: #fff;
      color: #6b7280;
      font-size: 12px;
    }

    .agenda-cell {
      position: relative;
      height: 28px;
      background: #fff;
    }

    .agenda-cell.today {
      background: #fff8d8;
    }

    .agenda-cell.closed {
      background:
        repeating-linear-gradient(45deg, rgba(31, 42, 38, 0.2) 0 2px, rgba(31, 42, 38, 0.08) 2px 8px),
        #7e8782;
    }

    .agenda-event {
      position: absolute;
      left: 5px;
      right: 5px;
      top: 2px;
      z-index: 2;
      min-height: 24px;
      padding: 5px 7px;
      border-radius: 6px;
      color: #fff;
      background: #2563eb;
      border-left: 5px solid #1d4ed8;
      box-shadow: none;
      overflow: hidden;
      font-size: 11px;
      line-height: 1.25;
    }

    .agenda-event.is-overlap {
      padding-inline: 5px;
      border-left-width: 4px;
    }

    .agenda-event.no-show {
      background: #6b7280;
      border-left-color: #d57920;
    }

    .agenda-event strong {
      display: block;
      font-size: 11px;
      line-height: 1.2;
    }

    .agenda-event span {
      display: block;
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .agenda-empty {
      padding: 24px;
      color: var(--muted);
      text-align: center;
    }

    .dialog-backdrop {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: grid;
      place-items: center;
      padding: 18px;
      background: rgba(15, 23, 42, 0.34);
    }

    .dialog-backdrop[hidden] {
      display: none;
    }

    .dialog {
      width: min(560px, 100%);
      max-height: min(720px, calc(100dvh - 36px));
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 8px 40px rgba(0,0,0,0.14);
      overflow: hidden;
    }

    .dialog-header {
      min-height: 58px;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid #e4e6eb;
    }

    .dialog-header h3 {
      margin: 0;
      font-size: 16px;
      line-height: 1.2;
    }

    .appointment-form {
      padding: 16px;
      display: grid;
      gap: 12px;
      overflow: auto;
    }

    .appointment-form .form-row {
      display: grid;
      gap: 7px;
    }

    .appointment-form label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
    }

    .appointment-form .split-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .dialog-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding-top: 4px;
    }

    @media (max-width: 620px) {
      .appointment-form .split-row {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 1180px) {
      .crm-top {
        grid-template-columns: 220px repeat(2, minmax(120px, 1fr)) auto 42px;
      }

      .metric-card:nth-of-type(n+4) {
        display: none;
      }

      .app {
        grid-template-columns: 84px minmax(270px, 320px) 1fr;
      }

      .details {
        display: none;
      }
    }

    @media (max-width: 760px) {
      .crm-top,
      .workspace-nav {
        display: none;
      }

      .app {
        height: calc(100dvh - 52px);
      }

      .composer {
        margin: 0;
        border-radius: 0;
      }
    }
  </style>
</head>
<body data-mobile-view="inbox">
  <nav class="mobile-nav" aria-label="Vistas CRM">
    <button class="active" id="mobile-inbox" type="button">Chats</button>
    <button id="mobile-chat" type="button">Conversacion</button>
    <button id="mobile-details" type="button">Cliente</button>
  </nav>

  <header class="crm-top">
    <div class="crm-brand">
      <div class="brand-mark">S</div>
      <div>
        <strong>CRM Salon AI</strong>
        <span>Atencion y reservas</span>
      </div>
    </div>
    <div class="metric-card active">
      <span>Resumen</span>
      <strong>Chats</strong>
    </div>
    <div class="metric-card">
      <span>Conversaciones</span>
      <strong id="top-conversation-total">0</strong>
    </div>
    <div class="metric-card">
      <span>Turnos del cliente</span>
      <strong id="top-appointment-total">0</strong>
    </div>
    <div class="metric-card">
      <span>Derivados</span>
      <strong id="top-handoff-total">0</strong>
    </div>
    <button class="primary top-action" type="button">Nueva accion</button>
    <div class="user-pill">JS</div>
  </header>

  <main class="app" id="app-shell" data-section="conversations">
    <nav class="workspace-nav" aria-label="Secciones CRM">
      <button class="active" type="button"><span>💬</span><strong>Conversaciones</strong></button>
      <button type="button"><span>📅</span><strong>Agenda</strong></button>
      <button type="button"><span>👥</span><strong>Clientes</strong></button>
      <button type="button"><span>PR</span><strong>Profesionales</strong></button>
      <button type="button"><span>✂</span><strong>Servicios</strong></button>
      <button type="button"><span>📣</span><strong>Campañas</strong></button>
      <button type="button"><span>📊</span><strong>Reportes</strong></button>
      <button type="button"><span>⚙</span><strong>Ajustes</strong></button>
      <div class="nav-user">
        <div class="mini-avatar">C</div>
        <span>Online</span>
      </div>
    </nav>
    <aside class="sidebar">
      <div class="topbar">
        <div class="brand">
          <h1>Conversaciones</h1>
          <p id="conversation-count">Conversaciones</p>
        </div>
        <button class="icon-button" id="refresh" title="Actualizar">R</button>
      </div>
      <div class="search">
        <input id="search" type="search" placeholder="Buscar telefono">
        <button class="secondary" id="search-button">Buscar</button>
      </div>
      <div class="ops-panel">
        <div class="row">
          <span class="hint">Derivados sin responder</span>
          <span class="counter" id="handoff-count">0</span>
        </div>
        <button class="secondary" id="global-bot-toggle" type="button">Bot automatico activo</button>
        <button class="secondary" id="global-ai-toggle" type="button">IA general activa</button>
      </div>
      <div class="conversation-list" id="conversation-list">
        <div class="empty">Cargando conversaciones...</div>
      </div>
    </aside>

    <section class="chat">
      <header class="chat-header">
        <div class="chat-title">
          <button class="icon-button mobile-only" id="mobile-back" type="button" title="Volver a chats">&lt;</button>
          <div class="avatar" id="chat-avatar">--</div>
          <div>
            <div class="panel-title" id="chat-phone">Selecciona una conversacion</div>
            <div class="hint" id="chat-status">Historial y respuesta manual</div>
          </div>
        </div>
        <div class="chat-actions">
          <button class="secondary" id="resolve-handoff" type="button" disabled hidden>Resolver y activar IA</button>
          <button class="secondary" id="conversation-ai-toggle" type="button" disabled>Desactivar IA</button>
          <span class="chip" id="step-chip">CRM</span>
        </div>
      </header>
      <div class="messages" id="messages">
        <div class="empty">Elegi un chat para ver los mensajes.</div>
      </div>
      <form class="composer" id="reply-form">
        <textarea id="reply-text" placeholder="Escribir respuesta manual" disabled></textarea>
        <div class="send-options">
          <label class="toggle">
            <input id="send-whatsapp" type="checkbox" checked>
            Enviar WhatsApp
          </label>
          <button class="primary" id="send-button" type="submit" disabled>Enviar</button>
        </div>
      </form>
    </section>

    <aside class="details">
      <div class="topbar">
        <div>
          <div class="panel-title">Informacion del cliente</div>
          <p class="hint">Datos de la conversacion</p>
        </div>
      </div>

      <div class="details-section">
        <div class="data-grid">
          <div class="data-row">
            <div class="label">Telefono</div>
            <div class="value" id="detail-phone">--</div>
          </div>
          <div class="data-row">
            <div class="label">Estado bot</div>
            <div class="value" id="detail-step">--</div>
          </div>
          <div class="data-row">
            <div class="label">Ultimo msg</div>
            <div class="value" id="detail-updated">--</div>
          </div>
        </div>
      </div>

      <div class="details-section">
        <div class="row">
          <div class="panel-title">Turnos activos</div>
          <span class="chip" id="appointment-count">0</span>
        </div>
        <div class="stack" id="appointments">
          <div class="empty">Sin cliente seleccionado.</div>
        </div>
      </div>

      <details class="config-panel">
        <summary>
          <div class="panel-title">Bloquear agenda</div>
          <span class="chip warn">Manual</span>
        </summary>
        <div class="config-panel-body">
          <form class="block-form" id="block-form">
            <select id="block-reason">
              <option value="ABSENCE">Falta</option>
              <option value="VACATION">Vacaciones</option>
              <option value="LATE_ARRIVAL">Llegada tarde</option>
              <option value="SICK_LEAVE">Enfermedad</option>
              <option value="PERSONAL">Personal</option>
              <option value="HOLIDAY">Feriado</option>
              <option value="OTHER">Otro</option>
            </select>
            <select id="block-professional">
              <option value="">Todo el salon</option>
            </select>
            <div class="block-grid">
              <input class="field" id="block-start" type="datetime-local">
              <input class="field" id="block-end" type="datetime-local">
            </div>
            <input class="field" id="block-title" placeholder="Titulo opcional">
            <button class="secondary" type="submit">Crear bloqueo</button>
            <p class="hint" id="block-feedback"></p>
          </form>
        </div>
      </details>

    </aside>

    <section class="agenda-view" id="agenda-view">
      <aside class="agenda-sidebar">
        <div class="agenda-filters">
          <div>
            <h2>Agenda</h2>
            <p class="hint">Turnos por dia y profesional</p>
          </div>
          <div class="agenda-filter">
            <label for="agenda-professional">Profesional</label>
            <select id="agenda-professional">
              <option value="">Todos los profesionales</option>
            </select>
          </div>
          <div class="agenda-filter">
            <label for="agenda-service">Servicio</label>
            <select id="agenda-service">
              <option value="">Todos los servicios</option>
            </select>
          </div>
        </div>

        <div class="month-card">
          <div class="month-header">
            <button class="icon-button" id="agenda-month-prev" type="button" title="Mes anterior">&lt;</button>
            <strong id="agenda-month-title">Mes</strong>
            <button class="icon-button" id="agenda-month-next" type="button" title="Mes siguiente">&gt;</button>
          </div>
          <div class="month-grid" id="agenda-month-grid"></div>
        </div>
      </aside>

      <section class="agenda-board">
        <div class="agenda-toolbar">
          <div class="agenda-toolbar-actions">
            <button class="secondary" id="agenda-today" type="button">Hoy</button>
            <button class="icon-button" id="agenda-prev" type="button" title="Semana anterior">&lt;</button>
            <button class="icon-button" id="agenda-next" type="button" title="Semana siguiente">&gt;</button>
          </div>
          <div class="agenda-range" id="agenda-range">Semana</div>
          <div class="agenda-toolbar-actions">
            <button class="primary" id="agenda-new-appointment" type="button">Nuevo turno</button>
            <button class="icon-button" id="agenda-refresh" type="button" title="Actualizar">R</button>
            <select id="agenda-step">
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="60">60 min</option>
            </select>
          </div>
        </div>
        <div class="agenda-grid-wrap" id="agenda-grid-wrap">
          <div class="agenda-empty">Cargando agenda...</div>
        </div>
      </section>
    </section>

    <div class="dialog-backdrop" id="appointment-dialog" hidden>
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="appointment-dialog-title">
        <header class="dialog-header">
          <h3 id="appointment-dialog-title">Nuevo turno</h3>
          <button class="icon-button" id="appointment-close" type="button" title="Cerrar">X</button>
        </header>
        <form class="appointment-form" id="appointment-form">
          <div class="form-row">
            <label for="appointment-start">Fecha y hora</label>
            <input class="field" id="appointment-start" type="datetime-local" required>
          </div>
          <div class="split-row">
            <div class="form-row">
              <label for="appointment-professional">Profesional</label>
              <select id="appointment-professional" required></select>
            </div>
            <div class="form-row">
              <label for="appointment-service">Servicio</label>
              <select id="appointment-service" required></select>
            </div>
          </div>
          <div class="form-row">
            <label for="appointment-customer">Cliente existente</label>
            <select id="appointment-customer">
              <option value="">Crear cliente nuevo</option>
            </select>
          </div>
          <div class="split-row">
            <div class="form-row">
              <label for="appointment-customer-name">Nombre</label>
              <input class="field" id="appointment-customer-name" placeholder="Nombre del cliente">
            </div>
            <div class="form-row">
              <label for="appointment-customer-phone">Telefono</label>
              <input class="field" id="appointment-customer-phone" placeholder="Telefono">
            </div>
          </div>
          <p class="hint" id="appointment-feedback"></p>
          <div class="dialog-actions">
            <button class="danger" id="appointment-no-show" type="button" hidden>Marcar ausente</button>
            <button class="danger" id="appointment-delete" type="button" hidden>Eliminar</button>
            <button class="secondary" id="appointment-cancel" type="button">Cancelar</button>
            <button class="primary" id="appointment-submit" type="submit">Guardar turno</button>
          </div>
        </form>
      </section>
    </div>

    <section class="professionals-view" id="professionals-view">
      <div class="professionals-shell">
        <header class="professionals-header">
          <div>
            <h2>Profesionales</h2>
            <p>Gestiona quienes atienden turnos y sus horarios de disponibilidad.</p>
          </div>
          <span class="chip" id="professional-count">0</span>
        </header>

        <section class="impact-panel" id="professional-impact-panel">
          <div>
            <h3 id="professional-impact-title">Turnos afectados</h3>
            <p id="professional-impact-copy">Revisa estos turnos antes de guardar el cambio.</p>
          </div>
          <div class="impact-list" id="professional-impact-list"></div>
          <div class="impact-actions">
            <button class="secondary" id="professional-impact-reprogram" type="button">Reprogramar</button>
            <button class="danger" id="professional-impact-cancel" type="button">Cancelar turnos</button>
            <button class="primary" id="professional-impact-keep" type="button">Mantener como excepcion</button>
          </div>
        </section>

        <section class="professionals-manager">
          <div class="professionals-form-panel">
            <h3 id="professional-form-title">Nuevo profesional</h3>
            <p>Carga el nombre y los rangos horarios que el bot puede ofrecer.</p>
            <form class="block-form" id="professional-form">
              <input id="professional-id" type="hidden">
              <input class="field" id="professional-name" placeholder="Nombre del profesional">
              <div class="schedule-row">
                <label><input id="professional-weekdays-enabled" type="checkbox" checked> Lun a vie</label>
                <input class="field" id="professional-weekdays-start" type="time" value="09:00">
                <input class="field" id="professional-weekdays-end" type="time" value="18:00">
              </div>
              <div class="schedule-row">
                <label><input id="professional-saturday-enabled" type="checkbox"> Sabado</label>
                <input class="field" id="professional-saturday-start" type="time" value="09:00">
                <input class="field" id="professional-saturday-end" type="time" value="13:00">
              </div>
              <div class="schedule-row">
                <label><input id="professional-sunday-enabled" type="checkbox"> Domingo</label>
                <input class="field" id="professional-sunday-start" type="time" value="09:00">
                <input class="field" id="professional-sunday-end" type="time" value="13:00">
              </div>
              <div class="config-actions">
                <button class="secondary" id="professional-cancel" type="button" hidden>Cancelar</button>
                <button class="primary" id="professional-submit" type="submit">Guardar profesional</button>
              </div>
              <p class="hint" id="professional-feedback"></p>
            </form>
          </div>

          <div class="professionals-list-panel">
            <div class="row">
              <div>
                <h3>Profesionales cargados</h3>
                <p>Los inactivos conservan historial y no aceptan nuevos turnos.</p>
              </div>
            </div>
            <div class="config-list" id="professional-list"></div>
          </div>
        </section>
      </div>
    </section>

    <section class="services-view" id="services-view">
      <div class="services-shell">
        <header class="services-header">
          <div>
            <h2>Servicios</h2>
            <p>Gestiona los servicios que el bot puede ofrecer al tomar reservas.</p>
          </div>
          <span class="chip" id="service-count">0</span>
        </header>

        <section class="services-manager">
          <div class="services-form-panel">
            <h3>Nuevo servicio</h3>
            <p>Completa los datos basicos para agregarlo a la agenda.</p>
            <form class="block-form" id="service-form">
              <input id="service-id" type="hidden">
              <input class="field" id="service-name" placeholder="Nombre del servicio">
              <div class="config-grid">
                <input class="field" id="service-duration" type="number" min="1" step="1" placeholder="Duracion en minutos">
                <input class="field" id="service-category" placeholder="Categoria opcional">
              </div>
              <input class="field" id="service-aliases" placeholder="Alias opcionales separados por coma">
              <div class="config-actions">
                <button class="secondary" id="service-cancel" type="button" hidden>Cancelar</button>
                <button class="primary" id="service-submit" type="submit">Guardar servicio</button>
              </div>
              <p class="hint" id="service-feedback"></p>
            </form>
          </div>

          <div class="services-list-panel">
            <div class="row">
              <div>
                <h3>Servicios cargados</h3>
                <p>Desde aca podes editar o eliminar cada servicio.</p>
              </div>
            </div>
            <div class="config-list" id="service-list"></div>
          </div>
        </section>
      </div>
    </section>

    <section class="reports-view" id="reports-view">
      <div class="reports-shell">
        <header class="reports-header">
          <div>
            <h2>Reportes</h2>
            <p id="reports-subtitle">Resumen operativo del salon.</p>
          </div>
          <div class="reports-actions">
            <select id="reports-range">
              <option value="7">Ultimos 7 dias</option>
              <option value="30" selected>Ultimos 30 dias</option>
              <option value="90">Ultimos 90 dias</option>
              <option value="365">Ultimo ano</option>
            </select>
            <button class="icon-button" id="reports-refresh" type="button" title="Actualizar">R</button>
          </div>
        </header>

        <section class="reports-grid">
          <article class="report-kpi">
            <span>Turnos agendados</span>
            <strong id="report-total-appointments">0</strong>
            <small id="report-total-copy">Sin datos del periodo.</small>
          </article>
          <article class="report-kpi">
            <span>Turnos realizados</span>
            <strong id="report-completed-appointments">0</strong>
            <small id="report-completed-copy">Incluye turnos pasados no cancelados.</small>
          </article>
          <article class="report-kpi">
            <span>Cancelaciones</span>
            <strong id="report-cancelled-appointments">0</strong>
            <small id="report-cancelled-copy">0% del periodo.</small>
          </article>
          <article class="report-kpi">
            <span>Clientes atendidos</span>
            <strong id="report-active-customers">0</strong>
            <small id="report-customers-copy">Clientes con al menos un turno.</small>
          </article>
          <article class="report-kpi">
            <span>Conversion chat a turno</span>
            <strong id="report-chat-conversion">0%</strong>
            <small id="report-chat-conversion-copy">0 de 0 conversaciones.</small>
          </article>
          <article class="report-kpi">
            <span>Nuevos vs recurrentes</span>
            <strong id="report-customer-mix">0 / 0</strong>
            <small id="report-customer-mix-copy">Nuevos / recurrentes.</small>
          </article>
          <article class="report-kpi">
            <span>Tiempo entre visitas</span>
            <strong id="report-visit-gap">--</strong>
            <small id="report-visit-gap-copy">Promedio de clientes que volvieron.</small>
          </article>
        </section>

        <section class="reports-panels">
          <article class="reports-panel">
            <div>
              <h3>Estado de turnos</h3>
              <p>De los turnos confirmados del periodo, cuantos se realizaron, cancelaron o quedaron ausentes.</p>
            </div>
            <div class="report-bars" id="report-status-bars"></div>
          </article>

          <article class="reports-panel">
            <div>
              <h3>Ingresos</h3>
              <p>Para calcular facturacion real falta cargar precio por servicio.</p>
            </div>
            <div class="report-empty-note" id="report-revenue-note">Listo para activar cuando agreguemos precios.</div>
          </article>
        </section>

        <section class="reports-panels">
          <article class="reports-table-panel">
            <div>
              <h3>Servicios mas vendidos</h3>
              <p>Ranking por cantidad de turnos no cancelados.</p>
            </div>
            <div id="report-services-table"></div>
          </article>

          <article class="reports-table-panel">
            <div>
              <h3>Rendimiento por profesional</h3>
              <p>Turnos atendidos y cancelaciones por profesional.</p>
            </div>
            <div id="report-professionals-table"></div>
          </article>
        </section>

        <section class="reports-panels">
          <article class="reports-table-panel">
            <div class="row">
              <div>
                <h3>Clientes inactivos</h3>
                <p>Clientes con turnos anteriores que no sacaron otro turno en la cantidad de dias elegida.</p>
              </div>
              <select id="reports-inactive-days" title="Dias sin sacar turnos">
                <option value="30">30 dias sin turno</option>
                <option value="45">45 dias sin turno</option>
                <option value="60" selected>60 dias sin turno</option>
                <option value="90">90 dias sin turno</option>
                <option value="120">120 dias sin turno</option>
              </select>
            </div>
            <div id="report-inactive-table"></div>
          </article>

          <article class="reports-table-panel">
            <div>
              <h3>Clientes que deberian haber vuelto</h3>
              <p>Clientes recurrentes cuyo patron de visitas indica riesgo de perdida.</p>
            </div>
            <div id="report-risk-table"></div>
          </article>
        </section>

        <section class="future-agenda-panel">
          <div class="future-agenda-head">
            <div>
              <h3>Agenda futura</h3>
              <p>Turnos confirmados hacia adelante, separados por profesional.</p>
            </div>
            <select id="reports-future-days">
              <option value="7">Proximos 7 dias</option>
              <option value="15">Proximos 15 dias</option>
              <option value="30" selected>Proximos 30 dias</option>
              <option value="60">Proximos 60 dias</option>
            </select>
          </div>
          <div class="future-agenda-summary">
            <div class="future-total">
              <span>Turnos futuros totales</span>
              <strong id="report-future-total">0</strong>
            </div>
            <div class="future-professionals" id="report-future-professionals"></div>
          </div>
        </section>
      </div>
    </section>
  </main>

  <script>
    const state = {
      conversations: [],
      selected: null,
      messages: [],
      appointments: [],
      professionals: [],
      services: [],
      customers: [],
      agendaAppointments: [],
      reportAppointments: [],
      agendaBlocks: [],
      agendaSelectedDate: new Date(),
      agendaMonthDate: new Date(),
      editingAppointmentId: null,
      aiSettings: {
        botEnabled: true,
        aiEnabled: true
      },
      pendingProfessionalSave: null,
      businessId: null,
      isRefreshing: false
    }

    const els = {
      list: document.getElementById('conversation-list'),
      count: document.getElementById('conversation-count'),
      search: document.getElementById('search'),
      searchButton: document.getElementById('search-button'),
      refresh: document.getElementById('refresh'),
      handoffCount: document.getElementById('handoff-count'),
      topConversationTotal: document.getElementById('top-conversation-total'),
      topAppointmentTotal: document.getElementById('top-appointment-total'),
      topHandoffTotal: document.getElementById('top-handoff-total'),
      globalBotToggle: document.getElementById('global-bot-toggle'),
      globalAiToggle: document.getElementById('global-ai-toggle'),
      messages: document.getElementById('messages'),
      chatAvatar: document.getElementById('chat-avatar'),
      chatPhone: document.getElementById('chat-phone'),
      chatStatus: document.getElementById('chat-status'),
      stepChip: document.getElementById('step-chip'),
      resolveHandoff: document.getElementById('resolve-handoff'),
      conversationAiToggle: document.getElementById('conversation-ai-toggle'),
      replyForm: document.getElementById('reply-form'),
      replyText: document.getElementById('reply-text'),
      sendButton: document.getElementById('send-button'),
      sendWhatsApp: document.getElementById('send-whatsapp'),
      detailPhone: document.getElementById('detail-phone'),
      detailStep: document.getElementById('detail-step'),
      detailUpdated: document.getElementById('detail-updated'),
      appointments: document.getElementById('appointments'),
      appointmentCount: document.getElementById('appointment-count'),
      blockForm: document.getElementById('block-form'),
      blockReason: document.getElementById('block-reason'),
      blockProfessional: document.getElementById('block-professional'),
      blockStart: document.getElementById('block-start'),
      blockEnd: document.getElementById('block-end'),
      blockTitle: document.getElementById('block-title'),
      blockFeedback: document.getElementById('block-feedback'),
      professionalForm: document.getElementById('professional-form'),
      professionalId: document.getElementById('professional-id'),
      professionalName: document.getElementById('professional-name'),
      professionalWeekdaysEnabled: document.getElementById('professional-weekdays-enabled'),
      professionalWeekdaysStart: document.getElementById('professional-weekdays-start'),
      professionalWeekdaysEnd: document.getElementById('professional-weekdays-end'),
      professionalSaturdayEnabled: document.getElementById('professional-saturday-enabled'),
      professionalSaturdayStart: document.getElementById('professional-saturday-start'),
      professionalSaturdayEnd: document.getElementById('professional-saturday-end'),
      professionalSundayEnabled: document.getElementById('professional-sunday-enabled'),
      professionalSundayStart: document.getElementById('professional-sunday-start'),
      professionalSundayEnd: document.getElementById('professional-sunday-end'),
      professionalCancel: document.getElementById('professional-cancel'),
      professionalSubmit: document.getElementById('professional-submit'),
      professionalFormTitle: document.getElementById('professional-form-title'),
      professionalFeedback: document.getElementById('professional-feedback'),
      professionalList: document.getElementById('professional-list'),
      professionalCount: document.getElementById('professional-count'),
      professionalImpactPanel: document.getElementById('professional-impact-panel'),
      professionalImpactTitle: document.getElementById('professional-impact-title'),
      professionalImpactCopy: document.getElementById('professional-impact-copy'),
      professionalImpactList: document.getElementById('professional-impact-list'),
      professionalImpactReprogram: document.getElementById('professional-impact-reprogram'),
      professionalImpactCancel: document.getElementById('professional-impact-cancel'),
      professionalImpactKeep: document.getElementById('professional-impact-keep'),
      serviceForm: document.getElementById('service-form'),
      serviceId: document.getElementById('service-id'),
      serviceName: document.getElementById('service-name'),
      serviceDuration: document.getElementById('service-duration'),
      serviceCategory: document.getElementById('service-category'),
      serviceAliases: document.getElementById('service-aliases'),
      serviceCancel: document.getElementById('service-cancel'),
      serviceFeedback: document.getElementById('service-feedback'),
      serviceList: document.getElementById('service-list'),
      serviceCount: document.getElementById('service-count'),
      reportsRange: document.getElementById('reports-range'),
      reportsInactiveDays: document.getElementById('reports-inactive-days'),
      reportsFutureDays: document.getElementById('reports-future-days'),
      reportsRefresh: document.getElementById('reports-refresh'),
      reportsSubtitle: document.getElementById('reports-subtitle'),
      reportTotalAppointments: document.getElementById('report-total-appointments'),
      reportTotalCopy: document.getElementById('report-total-copy'),
      reportCompletedAppointments: document.getElementById('report-completed-appointments'),
      reportCompletedCopy: document.getElementById('report-completed-copy'),
      reportCancelledAppointments: document.getElementById('report-cancelled-appointments'),
      reportCancelledCopy: document.getElementById('report-cancelled-copy'),
      reportActiveCustomers: document.getElementById('report-active-customers'),
      reportCustomersCopy: document.getElementById('report-customers-copy'),
      reportChatConversion: document.getElementById('report-chat-conversion'),
      reportChatConversionCopy: document.getElementById('report-chat-conversion-copy'),
      reportCustomerMix: document.getElementById('report-customer-mix'),
      reportCustomerMixCopy: document.getElementById('report-customer-mix-copy'),
      reportVisitGap: document.getElementById('report-visit-gap'),
      reportVisitGapCopy: document.getElementById('report-visit-gap-copy'),
      reportFutureTotal: document.getElementById('report-future-total'),
      reportFutureProfessionals: document.getElementById('report-future-professionals'),
      reportStatusBars: document.getElementById('report-status-bars'),
      reportServicesTable: document.getElementById('report-services-table'),
      reportProfessionalsTable: document.getElementById('report-professionals-table'),
      reportInactiveTable: document.getElementById('report-inactive-table'),
      reportRiskTable: document.getElementById('report-risk-table'),
      mobileInbox: document.getElementById('mobile-inbox'),
      mobileChat: document.getElementById('mobile-chat'),
      mobileDetails: document.getElementById('mobile-details'),
      mobileBack: document.getElementById('mobile-back'),
      appShell: document.getElementById('app-shell'),
      agendaProfessional: document.getElementById('agenda-professional'),
      agendaService: document.getElementById('agenda-service'),
      agendaMonthPrev: document.getElementById('agenda-month-prev'),
      agendaMonthNext: document.getElementById('agenda-month-next'),
      agendaMonthTitle: document.getElementById('agenda-month-title'),
      agendaMonthGrid: document.getElementById('agenda-month-grid'),
      agendaToday: document.getElementById('agenda-today'),
      agendaPrev: document.getElementById('agenda-prev'),
      agendaNext: document.getElementById('agenda-next'),
      agendaRefresh: document.getElementById('agenda-refresh'),
      agendaStep: document.getElementById('agenda-step'),
      agendaRange: document.getElementById('agenda-range'),
      agendaGridWrap: document.getElementById('agenda-grid-wrap'),
      agendaNewAppointment: document.getElementById('agenda-new-appointment'),
      appointmentDialog: document.getElementById('appointment-dialog'),
      appointmentForm: document.getElementById('appointment-form'),
      appointmentTitle: document.getElementById('appointment-dialog-title'),
      appointmentClose: document.getElementById('appointment-close'),
      appointmentCancel: document.getElementById('appointment-cancel'),
      appointmentDelete: document.getElementById('appointment-delete'),
      appointmentNoShow: document.getElementById('appointment-no-show'),
      appointmentSubmit: document.getElementById('appointment-submit'),
      appointmentStart: document.getElementById('appointment-start'),
      appointmentProfessional: document.getElementById('appointment-professional'),
      appointmentService: document.getElementById('appointment-service'),
      appointmentCustomer: document.getElementById('appointment-customer'),
      appointmentCustomerName: document.getElementById('appointment-customer-name'),
      appointmentCustomerPhone: document.getElementById('appointment-customer-phone'),
      appointmentFeedback: document.getElementById('appointment-feedback')
    }

    function initials(phone) {
      const digits = String(phone || '').replace(/\\D/g, '')
      return digits.slice(-2) || '--'
    }

    function normalizePhone(phone) {
      return String(phone || '').replace(/\\D/g, '')
    }

    function isActiveAppointment(appointment) {
      return appointment.status !== 'CANCELLED' && appointment.status !== 'NO_SHOW'
    }

    function isVisitAppointment(appointment) {
      return isActiveAppointment(appointment)
    }

    function formatDateTime(value) {
      if (!value) return '--'
      return new Intl.DateTimeFormat('es-AR', {
        dateStyle: 'short',
        timeStyle: 'short'
      }).format(new Date(value))
    }

    function formatAppointment(value) {
      return new Intl.DateTimeFormat('es-AR', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(value))
    }

    async function getJson(url, options) {
      const response = await fetch(url, options)
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        const error = new Error(body.message || 'Error de servidor')
        error.body = body
        throw error
      }
      return response.json()
    }

    async function loadBasics() {
      const businesses = await getJson('/businesses')
      state.businessId = businesses[0]?.id || null
      state.aiSettings = await getJson('/crm/ai-settings' + (state.businessId ? '?businessId=' + encodeURIComponent(state.businessId) : ''))
      state.professionals = await getJson('/professionals')
      state.services = await getJson('/services')
      state.customers = await getJson('/customers')
      renderAiControls()
      renderProfessionals()
      renderServices()
      renderAgendaFilters()
      renderAppointmentFormOptions()
      renderAgenda()
    }

    async function loadConversations(options = {}) {
      if (state.isRefreshing) return
      state.isRefreshing = true
      const params = new URLSearchParams()
      const phone = els.search.value.trim()
      if (phone) params.set('phone', phone)
      params.set('take', '100')
      const query = params.toString() ? '?' + params.toString() : ''

      try {
        state.conversations = await getJson('/crm/conversations' + query)
        state.conversations.sort((left, right) => latestConversationActivityAt(right) - latestConversationActivityAt(left))
        els.topConversationTotal.textContent = String(state.conversations.length)
        renderConversations()
        renderAiControls()

        if (!state.selected && state.conversations[0]) {
          await selectConversation(state.conversations[0].id)
        } else if (state.selected) {
          const fresh = state.conversations.find((item) => item.id === state.selected.id)
          if (fresh) {
            state.selected = fresh
            await refreshSelectedConversation()
          }
          renderConversations()
        }

        els.count.textContent = state.conversations.length + ' conversaciones · actualizado ' + new Date().toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit'
        })
      } catch (error) {
        if (!options.silent) {
          els.list.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>'
        }
      } finally {
        state.isRefreshing = false
      }
    }

    function renderConversations() {
      els.count.textContent = state.conversations.length + ' conversaciones'
      if (state.conversations.length === 0) {
        els.list.innerHTML = '<div class="empty">No hay conversaciones.</div>'
        return
      }

      els.list.innerHTML = state.conversations.map((conversation) => {
        const last = conversation.messages?.[0]
        const active = state.selected?.id === conversation.id ? ' active' : ''
        return '<button class="conversation' + active + '" data-id="' + conversation.id + '">' +
          '<div class="avatar">' + initials(conversation.phone) + '</div>' +
          '<div class="conversation-main">' +
            '<div class="row">' +
              '<div class="phone">' + escapeHtml(conversation.phone) + '</div>' +
              '<span class="' + conversationStepChipClass(conversation.currentStep, conversation.aiEnabled) + '">' + escapeHtml(conversation.aiEnabled === false ? 'IA OFF' : conversation.currentStep) + '</span>' +
            '</div>' +
            '<p class="preview">' + escapeHtml(last?.body || conversation.lastMessage || 'Sin mensajes') + '</p>' +
            '<p class="meta">' + formatDateTime(latestConversationActivityValue(conversation)) + '</p>' +
          '</div>' +
        '</button>'
      }).join('')

      for (const button of els.list.querySelectorAll('.conversation')) {
        button.addEventListener('click', () => selectConversation(button.dataset.id))
      }
    }

    async function selectConversation(id) {
      const conversation = state.conversations.find((item) => item.id === id)
      if (!conversation) return
      state.selected = conversation
      await refreshSelectedConversation()
      if (isMobile()) {
        setMobileView('chat')
      }
    }

    async function refreshSelectedConversation() {
      if (!state.selected) return
      state.messages = await getJson('/crm/conversations/' + state.selected.id + '/messages')
      await loadAppointments()
      renderSelected()
      renderConversations()
    }

    async function loadAppointments() {
      state.appointments = []
      if (!state.selected) return
      const all = await getJson('/appointments')
      const now = Date.now()
      state.appointments = all
        .filter((appointment) => appointment.customer?.phone === state.selected.phone)
        .filter(isActiveAppointment)
        .filter((appointment) => new Date(appointment.startAt).getTime() >= now)
        .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime())
    }

    function renderSelected() {
      const selected = state.selected
      if (!selected) return

      els.chatAvatar.textContent = initials(selected.phone)
      els.chatPhone.textContent = selected.phone
      els.chatStatus.textContent = 'Actualizado ' + formatDateTime(latestConversationActivityValue(selected))
      els.stepChip.textContent = selected.currentStep
      els.stepChip.className = conversationStepChipClass(selected.currentStep, selected.aiEnabled)
      const canResolveHandoff = selected.currentStep === 'HUMAN_HANDOFF' || selected.aiEnabled === false
      els.resolveHandoff.hidden = !canResolveHandoff
      els.resolveHandoff.disabled = !canResolveHandoff
      els.conversationAiToggle.disabled = false
      els.conversationAiToggle.textContent = selected.aiEnabled === false ? 'Activar IA' : 'Desactivar IA'
      els.conversationAiToggle.className = selected.aiEnabled === false ? 'secondary' : 'danger'
      els.detailPhone.textContent = selected.phone
      els.detailStep.textContent = selected.currentStep
      els.detailUpdated.textContent = formatDateTime(latestConversationActivityValue(selected))
      els.replyText.disabled = false
      els.sendButton.disabled = false

      renderMessages()
      renderAppointments()
    }

    function renderMessages() {
      if (!state.messages.length) {
        els.messages.innerHTML = '<div class="empty">Esta conversacion no tiene mensajes guardados.</div>'
        return
      }

      els.messages.innerHTML = state.messages.map((message) => {
        const direction = message.direction === 'OUTBOUND' ? 'outbound' : 'inbound'
        return '<article class="message ' + direction + '">' +
          escapeHtml(message.body) +
          '<div class="message-time">' + formatDateTime(message.createdAt) + '</div>' +
        '</article>'
      }).join('')
      els.messages.scrollTop = els.messages.scrollHeight
    }

    function renderAppointments() {
      els.appointmentCount.textContent = String(state.appointments.length)
      els.topAppointmentTotal.textContent = String(state.appointments.length)
      if (!state.selected) {
        els.appointments.innerHTML = '<div class="empty">Sin cliente seleccionado.</div>'
        return
      }

      if (state.appointments.length === 0) {
        els.appointments.innerHTML = '<div class="empty">No hay turnos activos.</div>'
        return
      }

      els.appointments.innerHTML = state.appointments.map((appointment) => {
        return '<div class="item">' +
          '<div class="item-title">' + escapeHtml(appointment.service?.name || 'Servicio') + '</div>' +
          '<p>' + escapeHtml(appointment.professional?.name || 'Profesional') + ' · ' + formatAppointment(appointment.startAt) + '</p>' +
        '</div>'
      }).join('')
    }

    function renderProfessionals() {
      const options = ['<option value="">Todo el salon</option>']
      for (const professional of activeProfessionals()) {
        options.push('<option value="' + professional.id + '">' + escapeHtml(professional.name) + '</option>')
      }
      els.blockProfessional.innerHTML = options.join('')
      els.professionalCount.textContent = String(activeProfessionals().length)
      els.professionalList.innerHTML = state.professionals.length
        ? state.professionals.map((professional) => {
            const statusText = professional.isActive === false ? 'Inactivo' : 'Activo'
            const statusClass = professional.isActive === false ? 'chip warn' : 'chip'
            const appointmentCount = professional._count?.appointments || 0
            return '<details class="item">' +
              '<summary class="row">' +
                '<div>' +
                  '<div class="item-title">' + escapeHtml(professional.name) + '</div>' +
                  '<p>' + escapeHtml(summarizeWorkingHours(professional.workingHours || [])) + '</p>' +
                  '<div class="status-line">' +
                    '<span class="' + statusClass + '">' + statusText + '</span>' +
                    '<span class="hint">' + appointmentCount + ' turnos historicos</span>' +
                  '</div>' +
                '</div>' +
              '</summary>' +
              '<div>' +
                '<div class="config-actions">' +
                  '<button class="secondary" type="button" data-edit-professional="' + professional.id + '">Editar</button>' +
                  (professional.isActive === false
                    ? '<button class="secondary" type="button" data-activate-professional="' + professional.id + '">Activar</button>'
                    : '<button class="secondary" type="button" data-deactivate-professional="' + professional.id + '">Desactivar</button>') +
                  '<button class="danger" type="button" data-delete-professional="' + professional.id + '">Eliminar</button>' +
                '</div>' +
              '</div>' +
            '</details>'
          }).join('')
        : '<div class="empty">No hay profesionales cargados.</div>'

      for (const button of els.professionalList.querySelectorAll('[data-edit-professional]')) {
        button.addEventListener('click', () => editProfessional(button.dataset.editProfessional))
      }

      for (const button of els.professionalList.querySelectorAll('[data-delete-professional]')) {
        button.addEventListener('click', () => deleteProfessional(button.dataset.deleteProfessional))
      }

      for (const button of els.professionalList.querySelectorAll('[data-deactivate-professional]')) {
        button.addEventListener('click', () => setProfessionalStatus(button.dataset.deactivateProfessional, false))
      }

      for (const button of els.professionalList.querySelectorAll('[data-activate-professional]')) {
        button.addEventListener('click', () => setProfessionalStatus(button.dataset.activateProfessional, true))
      }
    }

    function renderServices() {
      els.serviceCount.textContent = String(state.services.length)
      els.serviceList.innerHTML = state.services.length
        ? state.services.map((service) => {
            const aliases = (service.aliases || []).map((alias) => alias.name).join(', ')
            return '<details class="item">' +
              '<summary class="row">' +
                '<div>' +
                  '<div class="item-title">' + escapeHtml(service.name) + '</div>' +
                  '<p>' + escapeHtml(service.duration + ' min' + (service.category ? ' · ' + service.category : '')) + '</p>' +
                '</div>' +
              '</summary>' +
              '<div>' +
                (aliases ? '<p>Alias: ' + escapeHtml(aliases) + '</p>' : '<p>Sin alias cargados.</p>') +
                '<div class="config-actions">' +
                  '<button class="secondary" type="button" data-edit-service="' + service.id + '">Editar</button>' +
                  '<button class="danger" type="button" data-delete-service="' + service.id + '">Eliminar</button>' +
                '</div>' +
              '</div>' +
            '</details>'
          }).join('')
        : '<div class="empty">No hay servicios cargados.</div>'

      for (const button of els.serviceList.querySelectorAll('[data-edit-service]')) {
        button.addEventListener('click', () => editService(button.dataset.editService))
      }

      for (const button of els.serviceList.querySelectorAll('[data-delete-service]')) {
        button.addEventListener('click', () => deleteService(button.dataset.deleteService))
      }
    }

    function renderAiControls() {
      const pending = state.conversations.filter((conversation) => {
        return conversation.currentStep === 'HUMAN_HANDOFF' && !conversation.humanHandoffResolvedAt
      }).length
      els.handoffCount.textContent = String(pending)
      els.topHandoffTotal.textContent = String(pending)
      els.globalBotToggle.textContent = state.aiSettings.botEnabled === false ? 'Bot automatico apagado' : 'Bot automatico activo'
      els.globalBotToggle.className = state.aiSettings.botEnabled === false ? 'danger' : 'secondary'
      els.globalAiToggle.textContent = state.aiSettings.aiEnabled === false ? 'IA general apagada' : 'IA general activa'
      els.globalAiToggle.className = state.aiSettings.aiEnabled === false ? 'danger' : 'secondary'
    }

    async function loadReports() {
      els.reportStatusBars.innerHTML = '<div class="empty">Cargando reportes...</div>'
      const [appointments, conversations] = await Promise.all([
        getJson('/appointments'),
        getJson('/crm/conversations?take=500')
      ])
      state.reportAppointments = appointments
      state.conversations = conversations
      renderReports()
    }

    function renderReports() {
      const days = Number(els.reportsRange.value || 30)
      const inactiveDays = Number(els.reportsInactiveDays.value || 60)
      const futureDays = Number(els.reportsFutureDays.value || 30)
      const periodEnd = new Date()
      const periodStart = addDays(startOfDay(periodEnd), -(days - 1))
      const appointments = state.reportAppointments.filter((appointment) => {
        const start = new Date(appointment.startAt)
        return start >= periodStart && start <= periodEnd
      })
      const nonCancelled = appointments.filter(isActiveAppointment)
      const cancelled = appointments.filter((appointment) => appointment.status === 'CANCELLED')
      const noShow = appointments.filter((appointment) => appointment.status === 'NO_SHOW')
      const completed = nonCancelled.filter((appointment) => {
        return appointment.status === 'COMPLETED' || new Date(appointment.startAt) < periodEnd
      })
      const futureAgenda = calculateFutureAgenda({
        days: futureDays,
        now: periodEnd,
        allAppointments: state.reportAppointments
      })
      const activeCustomerIds = new Set(nonCancelled.map((appointment) => appointment.customerId).filter(Boolean))
      const cancellationRate = appointments.length ? Math.round((cancelled.length / appointments.length) * 100) : 0
      const chatConversion = calculateChatConversion({
        periodStart,
        periodEnd,
        appointments: nonCancelled
      })
      const customerMix = calculateCustomerMix({
        periodStart,
        periodAppointments: nonCancelled,
        allAppointments: state.reportAppointments
      })
      const visitGap = calculateAverageVisitGap({
        periodStart,
        periodEnd,
        allAppointments: state.reportAppointments
      })
      const inactiveCustomers = calculateInactiveCustomers({
        inactiveDays,
        now: periodEnd,
        allAppointments: state.reportAppointments
      })
      const riskCustomers = calculateRiskCustomers({
        now: periodEnd,
        allAppointments: state.reportAppointments
      })

      els.reportsSubtitle.textContent = formatReportRange(periodStart, periodEnd)
      els.reportTotalAppointments.textContent = String(appointments.length)
      els.reportTotalCopy.textContent = nonCancelled.length + ' activos en el periodo.'
      els.reportCompletedAppointments.textContent = String(completed.length)
      els.reportCompletedCopy.textContent = completed.length + ' realizados del periodo.'
      els.reportCancelledAppointments.textContent = String(cancelled.length)
      els.reportCancelledCopy.textContent = cancellationRate + '% del periodo.'
      els.reportActiveCustomers.textContent = String(activeCustomerIds.size)
      els.reportCustomersCopy.textContent = countNewCustomers(periodStart, periodEnd) + ' clientes nuevos cargados.'
      els.reportChatConversion.textContent = chatConversion.rate + '%'
      els.reportChatConversionCopy.textContent = chatConversion.converted + ' de ' + chatConversion.total + ' conversaciones.'
      els.reportCustomerMix.textContent = customerMix.newCustomers + ' / ' + customerMix.returningCustomers
      els.reportCustomerMixCopy.textContent = customerMix.newRate + '% nuevos, ' + customerMix.returningRate + '% recurrentes.'
      els.reportVisitGap.textContent = visitGap.averageDays === null ? '--' : visitGap.averageDays + ' dias'
      els.reportVisitGapCopy.textContent = visitGap.sampleSize + ' intervalos entre visitas.'
      els.reportFutureTotal.textContent = String(futureAgenda.total)

      renderReportStatusBars({
        confirmados: appointments.length,
        realizados: completed.length,
        cancelados: cancelled.length,
        ausentes: noShow.length
      })
      renderFutureAgenda(futureAgenda)
      renderReportServices(nonCancelled)
      renderReportProfessionals(appointments)
      renderInactiveCustomers(inactiveCustomers)
      renderRiskCustomers(riskCustomers)
    }

    function calculateChatConversion(input) {
      const periodConversations = state.conversations.filter((conversation) => {
        const activityAt = new Date(latestConversationActivityValue(conversation))
        return activityAt >= input.periodStart && activityAt <= input.periodEnd
      })
      const convertedPhones = new Set(input.appointments
        .map((appointment) => normalizePhone(appointment.customer?.phone))
        .filter(Boolean))
      const converted = periodConversations.filter((conversation) => {
        return convertedPhones.has(normalizePhone(conversation.phone))
      }).length
      const total = periodConversations.length

      return {
        total,
        converted,
        rate: total ? Math.round((converted / total) * 100) : 0
      }
    }

    function calculateCustomerMix(input) {
      const customerIds = Array.from(new Set(input.periodAppointments
        .map((appointment) => appointment.customerId)
        .filter(Boolean)))
      let newCustomers = 0
      let returningCustomers = 0

      for (const customerId of customerIds) {
        const firstAppointment = input.allAppointments
          .filter((appointment) => appointment.customerId === customerId && isVisitAppointment(appointment))
          .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime())[0]

        if (firstAppointment && new Date(firstAppointment.startAt) >= input.periodStart) {
          newCustomers += 1
        } else {
          returningCustomers += 1
        }
      }

      const total = newCustomers + returningCustomers
      return {
        newCustomers,
        returningCustomers,
        newRate: total ? Math.round((newCustomers / total) * 100) : 0,
        returningRate: total ? Math.round((returningCustomers / total) * 100) : 0
      }
    }

    function calculateAverageVisitGap(input) {
      const visitsByCustomer = new Map()
      for (const appointment of input.allAppointments) {
        if (!isVisitAppointment(appointment) || !appointment.customerId) continue
        const start = new Date(appointment.startAt)
        if (start > input.periodEnd) continue
        visitsByCustomer.set(appointment.customerId, (visitsByCustomer.get(appointment.customerId) || []).concat(start))
      }

      const gaps = []
      for (const visits of visitsByCustomer.values()) {
        const sortedVisits = visits.sort((left, right) => left.getTime() - right.getTime())
        for (let index = 1; index < sortedVisits.length; index += 1) {
          const currentVisit = sortedVisits[index]
          if (currentVisit < input.periodStart || currentVisit > input.periodEnd) continue
          const previousVisit = sortedVisits[index - 1]
          gaps.push(Math.round((currentVisit.getTime() - previousVisit.getTime()) / (24 * 60 * 60 * 1000)))
        }
      }

      if (gaps.length === 0) {
        return {
          averageDays: null,
          sampleSize: 0
        }
      }

      return {
        averageDays: Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length),
        sampleSize: gaps.length
      }
    }

    function calculateFutureAgenda(input) {
      const futureEnd = addDays(input.now, input.days)
      const appointments = input.allAppointments.filter((appointment) => {
        const start = new Date(appointment.startAt)
        return isActiveAppointment(appointment) && start >= input.now && start < futureEnd
      })
      const byProfessional = rankedCounts(appointments, (appointment) => appointment.professional?.name || 'Profesional')

      return {
        total: appointments.length,
        byProfessional
      }
    }

    function calculateInactiveCustomers(input) {
      const cutoff = addDays(startOfDay(input.now), -input.inactiveDays)
      return buildCustomerVisitSummaries(input.allAppointments)
        .filter((customer) => customer.lastVisit < cutoff)
        .sort((left, right) => right.daysSinceLastVisit - left.daysSinceLastVisit)
    }

    function calculateRiskCustomers(input) {
      return buildCustomerVisitSummaries(input.allAppointments)
        .filter((customer) => customer.visitCount >= 2)
        .map((customer) => {
          const expectedReturnDays = Math.max(14, Math.round(customer.averageGapDays * 1.25))
          const overdueDays = customer.daysSinceLastVisit - expectedReturnDays
          return {
            ...customer,
            expectedReturnDays,
            overdueDays
          }
        })
        .filter((customer) => customer.overdueDays > 0)
        .sort((left, right) => right.overdueDays - left.overdueDays)
    }

    function buildCustomerVisitSummaries(appointments) {
      const byCustomer = new Map()
      for (const appointment of appointments) {
        if (!isVisitAppointment(appointment) || !appointment.customerId) continue
        const start = new Date(appointment.startAt)
        if (start > new Date()) continue
        const current = byCustomer.get(appointment.customerId) || {
          customerId: appointment.customerId,
          name: appointment.customer?.name || 'Cliente',
          phone: appointment.customer?.phone || '',
          visits: []
        }
        current.visits.push(start)
        byCustomer.set(appointment.customerId, current)
      }

      return Array.from(byCustomer.values()).map((customer) => {
        const visits = customer.visits.sort((left, right) => left.getTime() - right.getTime())
        const gaps = []
        for (let index = 1; index < visits.length; index += 1) {
          gaps.push(Math.round((visits[index].getTime() - visits[index - 1].getTime()) / (24 * 60 * 60 * 1000)))
        }
        const lastVisit = visits[visits.length - 1]
        const averageGapDays = gaps.length
          ? Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length)
          : null

        return {
          customerId: customer.customerId,
          name: customer.name,
          phone: customer.phone,
          visitCount: visits.length,
          lastVisit,
          daysSinceLastVisit: Math.max(0, Math.round((new Date().getTime() - lastVisit.getTime()) / (24 * 60 * 60 * 1000))),
          averageGapDays
        }
      })
    }

    function renderReportStatusBars(counts) {
      const rows = [
        { label: 'Confirmados', value: counts.confirmados, className: 'soft' },
        { label: 'Realizados', value: counts.realizados, className: '' },
        { label: 'Cancelados', value: counts.cancelados, className: 'warn' },
        { label: 'Ausentes', value: counts.ausentes, className: 'warn' }
      ]
      const max = Math.max(1, ...rows.map((row) => row.value))

      els.reportStatusBars.innerHTML = rows.map((row) => {
        const width = Math.round((row.value / max) * 100)
        return '<div class="report-bar-row">' +
          '<span>' + escapeHtml(row.label) + '</span>' +
          '<div class="report-bar-track"><div class="report-bar-fill ' + row.className + '" style="width: ' + width + '%"></div></div>' +
          '<strong>' + row.value + '</strong>' +
        '</div>'
      }).join('')
    }

    function renderFutureAgenda(input) {
      if (input.byProfessional.length === 0) {
        els.reportFutureProfessionals.innerHTML = '<div class="report-empty-note">No hay turnos futuros en este rango.</div>'
        return
      }

      const max = Math.max(1, ...input.byProfessional.map((row) => row.count))
      els.reportFutureProfessionals.innerHTML = input.byProfessional.map((row) => {
        const width = Math.round((row.count / max) * 100)
        const share = input.total ? Math.round((row.count / input.total) * 100) : 0
        return '<article class="future-professional">' +
          '<div class="future-professional-row">' +
            '<strong>' + escapeHtml(row.label) + '</strong>' +
            '<span>' + row.count + ' turnos</span>' +
          '</div>' +
          '<div class="report-bar-track"><div class="report-bar-fill" style="width: ' + width + '%"></div></div>' +
          '<div class="future-professional-row">' +
            '<span class="hint">' + share + '% de agenda futura</span>' +
          '</div>' +
        '</article>'
      }).join('')
    }

    function renderReportServices(appointments) {
      const rows = rankedCounts(appointments, (appointment) => appointment.service?.name || 'Servicio')
        .slice(0, 6)

      if (rows.length === 0) {
        els.reportServicesTable.innerHTML = '<div class="report-empty-note">No hay turnos en este periodo.</div>'
        return
      }

      const total = rows.reduce((sum, row) => sum + row.count, 0)
      els.reportServicesTable.innerHTML = '<table class="report-table">' +
        '<thead><tr><th>Servicio</th><th>Turnos</th><th>Participacion</th></tr></thead>' +
        '<tbody>' + rows.map((row) => {
          return '<tr>' +
            '<td>' + escapeHtml(row.label) + '</td>' +
            '<td>' + row.count + '</td>' +
            '<td>' + Math.round((row.count / Math.max(1, total)) * 100) + '%</td>' +
          '</tr>'
        }).join('') + '</tbody>' +
      '</table>'
    }

    function renderReportProfessionals(appointments) {
      const rows = state.professionals.map((professional) => {
        const ownAppointments = appointments.filter((appointment) => appointment.professionalId === professional.id)
        const cancelled = ownAppointments.filter((appointment) => appointment.status === 'CANCELLED').length
        const noShow = ownAppointments.filter((appointment) => appointment.status === 'NO_SHOW').length
        const attended = ownAppointments.filter((appointment) => {
          return isVisitAppointment(appointment) && new Date(appointment.startAt) < new Date()
        }).length
        return {
          name: professional.name,
          attended,
          cancelled,
          noShow,
          total: ownAppointments.length
        }
      }).filter((row) => row.total > 0)
        .sort((left, right) => right.attended - left.attended || right.total - left.total)
        .slice(0, 6)

      if (rows.length === 0) {
        els.reportProfessionalsTable.innerHTML = '<div class="report-empty-note">No hay actividad por profesional en este periodo.</div>'
        return
      }

      els.reportProfessionalsTable.innerHTML = '<table class="report-table">' +
        '<thead><tr><th>Profesional</th><th>Realizados</th><th>Aus.</th></tr></thead>' +
        '<tbody>' + rows.map((row) => {
          return '<tr>' +
            '<td>' + escapeHtml(row.name) + '</td>' +
            '<td>' + row.attended + '</td>' +
            '<td>' + row.noShow + '</td>' +
          '</tr>'
        }).join('') + '</tbody>' +
      '</table>'
    }

    function renderInactiveCustomers(customers) {
      const rows = customers.slice(0, 8)
      if (rows.length === 0) {
        els.reportInactiveTable.innerHTML = '<div class="report-empty-note">No hay clientes inactivos con este filtro.</div>'
        return
      }

      els.reportInactiveTable.innerHTML = '<table class="report-table">' +
        '<thead><tr><th>Cliente</th><th>Ultima visita</th><th>Dias</th></tr></thead>' +
        '<tbody>' + rows.map((customer) => {
          return '<tr>' +
            '<td>' + escapeHtml(formatCustomerLabel(customer)) + '</td>' +
            '<td>' + escapeHtml(formatShortDate(customer.lastVisit)) + '</td>' +
            '<td>' + customer.daysSinceLastVisit + '</td>' +
          '</tr>'
        }).join('') + '</tbody>' +
      '</table>'
    }

    function renderRiskCustomers(customers) {
      const rows = customers.slice(0, 8)
      if (rows.length === 0) {
        els.reportRiskTable.innerHTML = '<div class="report-empty-note">Todavia no hay clientes con patron de riesgo.</div>'
        return
      }

      els.reportRiskTable.innerHTML = '<table class="report-table">' +
        '<thead><tr><th>Cliente</th><th>Esperado</th><th>Atraso</th></tr></thead>' +
        '<tbody>' + rows.map((customer) => {
          return '<tr>' +
            '<td>' + escapeHtml(formatCustomerLabel(customer)) + '</td>' +
            '<td>Cada ' + customer.expectedReturnDays + ' dias</td>' +
            '<td>' + customer.overdueDays + ' dias</td>' +
          '</tr>'
        }).join('') + '</tbody>' +
      '</table>'
    }

    function formatCustomerLabel(customer) {
      return customer.name + (customer.phone ? ' · ' + customer.phone : '')
    }

    function formatShortDate(value) {
      return new Intl.DateTimeFormat('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit'
      }).format(new Date(value))
    }

    function rankedCounts(items, getLabel) {
      const counts = new Map()
      for (const item of items) {
        const label = getLabel(item)
        counts.set(label, (counts.get(label) || 0) + 1)
      }

      return Array.from(counts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    }

    function countNewCustomers(periodStart, periodEnd) {
      return state.customers.filter((customer) => {
        const createdAt = new Date(customer.createdAt)
        return createdAt >= periodStart && createdAt <= periodEnd
      }).length
    }

    function formatReportRange(start, end) {
      const formatter = new Intl.DateTimeFormat('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      })
      return formatter.format(start) + ' a ' + formatter.format(end)
    }

    async function sendReply(event) {
      event.preventDefault()
      if (!state.selected) return
      const text = els.replyText.value.trim()
      if (!text) return

      els.sendButton.disabled = true
      try {
        await getJson('/crm/conversations/' + state.selected.id + '/manual-replies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            sendWhatsApp: els.sendWhatsApp.checked
          })
        })
        els.replyText.value = ''
        await selectConversation(state.selected.id)
        await loadConversations()
      } catch (error) {
        alert(error.message)
      } finally {
        els.sendButton.disabled = false
      }
    }

    async function toggleGlobalAi() {
      const nextValue = state.aiSettings.aiEnabled === false
      try {
        state.aiSettings = await getJson('/crm/ai-settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessId: state.businessId,
            aiEnabled: nextValue
          })
        })
        renderAiControls()
      } catch (error) {
        alert(error.message)
      }
    }

    async function toggleGlobalBot() {
      const nextValue = state.aiSettings.botEnabled === false
      try {
        state.aiSettings = await getJson('/crm/ai-settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessId: state.businessId,
            botEnabled: nextValue
          })
        })
        renderAiControls()
      } catch (error) {
        alert(error.message)
      }
    }

    async function toggleConversationAi() {
      if (!state.selected) return
      const nextValue = state.selected.aiEnabled === false
      els.conversationAiToggle.disabled = true
      try {
        const updated = await getJson('/crm/conversations/' + state.selected.id + '/ai', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aiEnabled: nextValue
          })
        })
        state.selected = updated
        await loadConversations()
        renderSelected()
      } catch (error) {
        alert(error.message)
      } finally {
        els.conversationAiToggle.disabled = false
      }
    }

    async function resolveHandoff() {
      if (!state.selected) return
      els.resolveHandoff.disabled = true
      try {
        const updated = await getJson('/crm/conversations/' + state.selected.id + '/ai', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aiEnabled: true
          })
        })
        state.selected = updated
        await loadConversations()
        renderSelected()
      } catch (error) {
        alert(error.message)
      } finally {
        els.resolveHandoff.disabled = false
      }
    }

    async function createBlock(event) {
      event.preventDefault()
      if (!state.businessId) {
        els.blockFeedback.textContent = 'No encontre un negocio cargado.'
        return
      }

      const startAt = els.blockStart.value
      const endAt = els.blockEnd.value
      if (!startAt || !endAt) {
        els.blockFeedback.textContent = 'Completa inicio y fin.'
        return
      }

      try {
        await getJson('/schedule-blocks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessId: state.businessId,
            professionalId: els.blockProfessional.value || undefined,
            reason: els.blockReason.value,
            title: els.blockTitle.value.trim() || undefined,
            startAt: new Date(startAt).toISOString(),
            endAt: new Date(endAt).toISOString()
          })
        })
        els.blockFeedback.textContent = 'Bloqueo creado.'
        els.blockTitle.value = ''
      } catch (error) {
        els.blockFeedback.textContent = error.message
      }
    }

    async function saveProfessional(event, options = {}) {
      event.preventDefault()
      if (!state.businessId) {
        els.professionalFeedback.textContent = 'No encontre un negocio cargado.'
        return
      }

      const id = els.professionalId.value
      const name = els.professionalName.value.trim()
      if (!name) {
        els.professionalFeedback.textContent = 'Escribi un nombre.'
        return
      }

      try {
        await getJson(id ? '/professionals/' + id : '/professionals', {
          method: id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            businessId: state.businessId,
            workingHours: buildProfessionalWorkingHours(),
            ...(options.conflictStrategy ? { conflictStrategy: options.conflictStrategy } : {})
          })
        })
        els.professionalFeedback.textContent = id ? 'Profesional actualizado.' : 'Profesional creado.'
        resetProfessionalForm(false)
        hideProfessionalImpact()
        state.professionals = await getJson('/professionals')
        renderProfessionals()
        renderAgendaFilters()
        renderAppointmentFormOptions()
        renderAgenda()
      } catch (error) {
        if (error.body?.code === 'WORKING_HOURS_CONFLICT') {
          state.pendingProfessionalSave = {
            id,
            name,
            workingHours: buildProfessionalWorkingHours()
          }
          showProfessionalImpact({
            title: 'Turnos fuera del nuevo horario',
            copy: 'Estos turnos ya estaban confirmados. Podes mantenerlos como excepcion, revisarlos para reprogramar o contactar clientes para cancelar.',
            appointments: error.body.impact?.outsideWorkingHours || []
          })
        } else {
          els.professionalFeedback.textContent = error.message
        }
      }
    }

    function editProfessional(id) {
      const professional = state.professionals.find((item) => item.id === id)
      if (!professional) return
      els.professionalId.value = professional.id
      els.professionalName.value = professional.name
      setProfessionalWorkingHours(professional.workingHours || [])
      els.professionalCancel.hidden = false
      els.professionalFormTitle.textContent = 'Editar profesional'
      els.professionalSubmit.textContent = 'Guardar cambios'
      els.professionalFeedback.textContent = 'Editando profesional.'
      hideProfessionalImpact()
      setSection('professionals')
    }

    async function deleteProfessional(id) {
      const professional = state.professionals.find((item) => item.id === id)
      if (!professional) return

      const impact = await getProfessionalImpact(id)
      if (impact.futureAppointments.length > 0) {
        showProfessionalImpact({
          title: 'No conviene eliminar todavia',
          copy: 'Este profesional tiene turnos futuros. Podes desactivarlo para que no tome nuevos turnos, revisar la lista para reprogramar o contactar clientes para cancelar.',
          appointments: impact.futureAppointments,
          professionalId: id
        })
        els.professionalFeedback.textContent = 'Resolve los turnos futuros antes de eliminar definitivamente.'
        return
      }

      if (!confirm('Eliminar profesional ' + professional.name + '?')) return

      try {
        await getJson('/professionals/' + id, {
          method: 'DELETE'
        })
        els.professionalFeedback.textContent = professional._count?.appointments ? 'Profesional desactivado y oculto de nuevas reservas.' : 'Profesional eliminado.'
        state.professionals = await getJson('/professionals')
        renderProfessionals()
        renderAgendaFilters()
        renderAppointmentFormOptions()
        renderAgenda()
      } catch (error) {
        els.professionalFeedback.textContent = error.message
      }
    }

    function resetProfessionalForm(clearFeedback = true) {
      els.professionalId.value = ''
      els.professionalName.value = ''
      els.professionalCancel.hidden = true
      els.professionalFormTitle.textContent = 'Nuevo profesional'
      els.professionalSubmit.textContent = 'Guardar profesional'
      state.pendingProfessionalSave = null
      hideProfessionalImpact()
      setProfessionalWorkingHours([
        { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
        { dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },
        { dayOfWeek: 3, startTime: '09:00', endTime: '18:00' },
        { dayOfWeek: 4, startTime: '09:00', endTime: '18:00' },
        { dayOfWeek: 5, startTime: '09:00', endTime: '18:00' }
      ])
      if (clearFeedback) {
        els.professionalFeedback.textContent = ''
      }
    }

    async function setProfessionalStatus(id, isActive) {
      const professional = state.professionals.find((item) => item.id === id)
      if (!professional) return

      if (!isActive) {
        const impact = await getProfessionalImpact(id)
        if (impact.futureAppointments.length > 0) {
          showProfessionalImpact({
            title: 'Turnos futuros de ' + professional.name,
            copy: 'Si lo desactivas, no se ofreceran nuevos turnos, pero estos turnos siguen vigentes hasta que los reprogrames o canceles.',
            appointments: impact.futureAppointments,
            professionalId: id
          })
        }
      }

      try {
        await getJson('/professionals/' + id + '/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive })
        })
        els.professionalFeedback.textContent = isActive ? 'Profesional activado.' : 'Profesional desactivado para nuevas reservas.'
        state.professionals = await getJson('/professionals')
        renderProfessionals()
        renderAgendaFilters()
        renderAppointmentFormOptions()
        renderAgenda()
      } catch (error) {
        els.professionalFeedback.textContent = error.message
      }
    }

    async function getProfessionalImpact(id) {
      return getJson('/professionals/' + id + '/appointments-impact')
    }

    function showProfessionalImpact(input) {
      els.professionalImpactTitle.textContent = input.title
      els.professionalImpactCopy.textContent = input.copy
      els.professionalImpactList.innerHTML = input.appointments.length
        ? input.appointments.map((appointment) => {
            const customer = appointment.customer?.name || 'Cliente'
            const phone = appointment.customer?.phone || 'Sin telefono'
            const service = appointment.service?.name || 'Servicio'
            return '<div class="item">' +
              '<div class="item-title">' + escapeHtml(customer + ' - ' + service) + '</div>' +
              '<p>' + escapeHtml(formatAppointment(appointment.startAt) + ' · ' + phone) + '</p>' +
            '</div>'
          }).join('')
        : '<div class="empty">No hay turnos futuros afectados.</div>'

      els.professionalImpactPanel.classList.add('visible')
      els.professionalImpactPanel.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    function hideProfessionalImpact() {
      els.professionalImpactPanel.classList.remove('visible')
      els.professionalImpactList.innerHTML = ''
    }

    function buildProfessionalWorkingHours() {
      const hours = []

      if (els.professionalWeekdaysEnabled.checked) {
        for (const dayOfWeek of [1, 2, 3, 4, 5]) {
          hours.push({
            dayOfWeek,
            startTime: els.professionalWeekdaysStart.value,
            endTime: els.professionalWeekdaysEnd.value
          })
        }
      }

      if (els.professionalSaturdayEnabled.checked) {
        hours.push({
          dayOfWeek: 6,
          startTime: els.professionalSaturdayStart.value,
          endTime: els.professionalSaturdayEnd.value
        })
      }

      if (els.professionalSundayEnabled.checked) {
        hours.push({
          dayOfWeek: 0,
          startTime: els.professionalSundayStart.value,
          endTime: els.professionalSundayEnd.value
        })
      }

      return hours
    }

    function setProfessionalWorkingHours(hours) {
      const byDay = new Map((hours || []).map((hour) => [hour.dayOfWeek, hour]))
      const weekdays = [1, 2, 3, 4, 5].map((day) => byDay.get(day)).filter(Boolean)
      const firstWeekday = weekdays[0]
      const saturday = byDay.get(6)
      const sunday = byDay.get(0)

      els.professionalWeekdaysEnabled.checked = weekdays.length > 0
      els.professionalWeekdaysStart.value = firstWeekday?.startTime || '09:00'
      els.professionalWeekdaysEnd.value = firstWeekday?.endTime || '18:00'
      els.professionalSaturdayEnabled.checked = Boolean(saturday)
      els.professionalSaturdayStart.value = saturday?.startTime || '09:00'
      els.professionalSaturdayEnd.value = saturday?.endTime || '13:00'
      els.professionalSundayEnabled.checked = Boolean(sunday)
      els.professionalSundayStart.value = sunday?.startTime || '09:00'
      els.professionalSundayEnd.value = sunday?.endTime || '13:00'
    }

    function summarizeWorkingHours(hours) {
      if (!hours.length) {
        return 'Sin horarios cargados'
      }

      const grouped = new Map()
      for (const hour of hours) {
        const key = hour.startTime + '-' + hour.endTime
        const days = grouped.get(key) || []
        days.push(hour.dayOfWeek)
        grouped.set(key, days)
      }

      return Array.from(grouped.entries()).map(([timeRange, days]) => {
        return summarizeDays(days) + ' ' + timeRange.replace('-', ' a ')
      }).join(' · ')
    }

    function summarizeDays(days) {
      const sorted = [...days].sort((left, right) => left - right)
      if ([1, 2, 3, 4, 5].every((day) => sorted.includes(day))) {
        const weekend = sorted.filter((day) => day === 0 || day === 6)
        return ['Lun a vie', ...weekend.map(dayName)].join(', ')
      }

      return sorted.map(dayName).join(', ')
    }

    function dayName(dayOfWeek) {
      return ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'][dayOfWeek] || 'Dia'
    }

    function activeProfessionals() {
      return state.professionals.filter((professional) => professional.isActive !== false)
    }

    function renderAgendaFilters() {
      els.agendaProfessional.innerHTML = ['<option value="">Todos los profesionales</option>']
        .concat(activeProfessionals().map((professional) => {
          return '<option value="' + professional.id + '">' + escapeHtml(professional.name) + '</option>'
        }))
        .join('')

      els.agendaService.innerHTML = ['<option value="">Todos los servicios</option>']
        .concat(state.services.map((service) => {
          return '<option value="' + service.id + '">' + escapeHtml(service.name) + '</option>'
        }))
        .join('')
    }

    function renderAppointmentFormOptions() {
      els.appointmentProfessional.innerHTML = activeProfessionals().map((professional) => {
        return '<option value="' + professional.id + '">' + escapeHtml(professional.name) + '</option>'
      }).join('')

      els.appointmentService.innerHTML = state.services.map((service) => {
        return '<option value="' + service.id + '">' + escapeHtml(service.name) + ' · ' + service.duration + ' min</option>'
      }).join('')

      els.appointmentCustomer.innerHTML = ['<option value="">Crear cliente nuevo</option>']
        .concat(state.customers.map((customer) => {
          return '<option value="' + customer.id + '">' + escapeHtml(customer.name + ' · ' + customer.phone) + '</option>'
        }))
        .join('')
    }

    async function loadAgenda() {
      const weekStart = startOfWeek(state.agendaSelectedDate)
      const weekEnd = addDays(weekStart, 7)
      const params = new URLSearchParams({
        from: weekStart.toISOString(),
        to: weekEnd.toISOString()
      })

      if (state.businessId) {
        params.set('businessId', state.businessId)
      }

      if (els.agendaProfessional.value) {
        params.set('professionalId', els.agendaProfessional.value)
      }

      state.agendaAppointments = await getJson('/appointments')
      state.agendaBlocks = await getJson('/schedule-blocks?' + params.toString())
      renderAgenda()
    }

    function renderAgenda() {
      renderAgendaMonth()
      renderAgendaGrid()
    }

    function renderAgendaMonth() {
      const monthDate = new Date(state.agendaMonthDate.getFullYear(), state.agendaMonthDate.getMonth(), 1)
      els.agendaMonthTitle.textContent = new Intl.DateTimeFormat('es-AR', {
        month: 'long',
        year: 'numeric'
      }).format(monthDate)

      const first = startOfWeek(monthDate)
      const selectedKey = dateKey(state.agendaSelectedDate)
      const appointmentKeys = new Set(filteredAgendaAppointments().map((appointment) => dateKey(new Date(appointment.startAt))))
      const cells = ['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((day) => {
        return '<div class="month-weekday">' + day + '</div>'
      })

      for (let index = 0; index < 42; index += 1) {
        const day = addDays(first, index)
        const key = dateKey(day)
        const className = [
          'month-day',
          day.getMonth() !== monthDate.getMonth() ? 'outside' : '',
          key === selectedKey ? 'selected' : '',
          appointmentKeys.has(key) ? 'has-items' : ''
        ].filter(Boolean).join(' ')

        cells.push('<button class="' + className + '" type="button" data-agenda-date="' + key + '">' + day.getDate() + '</button>')
      }

      els.agendaMonthGrid.innerHTML = cells.join('')
      for (const button of els.agendaMonthGrid.querySelectorAll('[data-agenda-date]')) {
        button.addEventListener('click', async () => {
          state.agendaSelectedDate = parseDateKey(button.dataset.agendaDate)
          state.agendaMonthDate = new Date(state.agendaSelectedDate)
          await loadAgenda()
        })
      }
    }

    function renderAgendaGrid() {
      const step = Number(els.agendaStep.value || 15)
      const weekStart = startOfWeek(state.agendaSelectedDate)
      const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
      const startMinute = 9 * 60
      const endMinute = 19 * 60
      const rowHeight = 28
      const rows = []

      els.agendaRange.textContent = formatAgendaRange(days[0], days[6])

      rows.push('<div class="agenda-grid">')
      rows.push('<div class="agenda-corner"></div>')

      for (const day of days) {
        rows.push('<button class="agenda-day-head" type="button" data-agenda-date="' + dateKey(day) + '">' + formatAgendaDayHeader(day) + '</button>')
      }

      for (let minute = startMinute; minute < endMinute; minute += step) {
        rows.push('<div class="agenda-time">' + formatMinuteLabel(minute) + '</div>')
        for (const day of days) {
          const closed = isClosedAgendaSlot(day, minute)
          const today = dateKey(day) === dateKey(new Date())
          rows.push('<div class="agenda-cell' + (today ? ' today' : '') + (closed ? ' closed' : '') + '" data-cell-date="' + dateKey(day) + '" data-cell-minute="' + minute + '"></div>')
        }
      }

      rows.push('</div>')
      els.agendaGridWrap.innerHTML = rows.join('')

      for (const button of els.agendaGridWrap.querySelectorAll('[data-agenda-date]')) {
        button.addEventListener('click', async () => {
          state.agendaSelectedDate = parseDateKey(button.dataset.agendaDate)
          state.agendaMonthDate = new Date(state.agendaSelectedDate)
          await loadAgenda()
        })
      }

      for (const cell of els.agendaGridWrap.querySelectorAll('[data-cell-date][data-cell-minute]')) {
        cell.addEventListener('click', (event) => {
          if (event.target.closest('.agenda-event')) return
          openAppointmentDialog({
            date: parseDateKey(cell.dataset.cellDate),
            minute: Number(cell.dataset.cellMinute || startMinute)
          })
        })
      }

      renderAgendaEvents({
        step,
        rowHeight,
        startMinute
      })
    }

    function renderAgendaEvents(input) {
      const appointments = filteredAgendaAppointments()
      const layout = buildAgendaEventLayout(appointments)
      const cells = new Map()
      for (const cell of els.agendaGridWrap.querySelectorAll('[data-cell-date][data-cell-minute]')) {
        cells.set(cell.dataset.cellDate + ':' + cell.dataset.cellMinute, cell)
      }

      for (const appointment of appointments) {
        const start = new Date(appointment.startAt)
        const minute = start.getHours() * 60 + start.getMinutes()
        const roundedMinute = minute - (minute % input.step)
        const cell = cells.get(dateKey(start) + ':' + roundedMinute)
        if (!cell) continue

        const duration = appointment.service?.duration || input.step
        const height = Math.max(24, Math.ceil(duration / input.step) * input.rowHeight - 4)
        const top = Math.max(2, ((minute - roundedMinute) / input.step) * input.rowHeight + 2)
        const customer = appointment.customer?.name || 'Cliente'
        const professional = appointment.professional?.name || 'Profesional'
        const service = appointment.service?.name || 'Servicio'
        const placement = layout.get(appointment.id) || { column: 0, columns: 1 }
        const gap = 3
        const leftOffset = 5 + (gap / 2)
        const widthOffset = gap + (10 / placement.columns)
        const noShow = appointment.status === 'NO_SHOW'

        const event = document.createElement('article')
        event.className = 'agenda-event' + (placement.columns > 1 ? ' is-overlap' : '') + (noShow ? ' no-show' : '')
        event.style.height = height + 'px'
        event.style.top = top + 'px'
        event.style.left = 'calc(' + ((placement.column * 100) / placement.columns) + '% + ' + leftOffset + 'px)'
        event.style.right = 'auto'
        event.style.width = 'calc(' + (100 / placement.columns) + '% - ' + widthOffset + 'px)'
        event.title = customer + ' - ' + service + ' con ' + professional + (noShow ? ' - Ausente' : '')
        event.innerHTML = '<strong>' + escapeHtml(formatTimeOnly(start) + ' - ' + formatTimeOnly(addMinutes(start, duration))) + '</strong>' +
          '<span>' + escapeHtml(customer + ' · ' + service) + '</span>' +
          '<span>' + escapeHtml(professional + (noShow ? ' · Ausente' : '')) + '</span>'
        event.addEventListener('click', (clickEvent) => {
          clickEvent.stopPropagation()
          openAppointmentDialog({ appointment })
        })
        cell.appendChild(event)
      }
    }

    function buildAgendaEventLayout(appointments) {
      const byDay = new Map()
      for (const appointment of appointments) {
        const start = new Date(appointment.startAt)
        const startMinute = start.getHours() * 60 + start.getMinutes()
        const duration = appointment.service?.duration || Number(els.agendaStep.value || 15)
        const item = {
          id: appointment.id,
          start: startMinute,
          end: startMinute + duration,
          column: 0
        }
        const key = dateKey(start)
        byDay.set(key, (byDay.get(key) || []).concat(item))
      }

      const layout = new Map()
      for (const items of byDay.values()) {
        const sorted = items.sort((left, right) => left.start - right.start || left.end - right.end)
        let cluster = []
        let clusterEnd = 0

        for (const item of sorted) {
          if (cluster.length && item.start >= clusterEnd) {
            assignAgendaClusterLayout(cluster, layout)
            cluster = []
          }

          cluster.push(item)
          clusterEnd = Math.max(clusterEnd, item.end)
        }

        if (cluster.length) {
          assignAgendaClusterLayout(cluster, layout)
        }
      }

      return layout
    }

    function assignAgendaClusterLayout(cluster, layout) {
      const columns = []
      for (const item of cluster) {
        let column = columns.findIndex((end) => end <= item.start)
        if (column === -1) {
          column = columns.length
          columns.push(item.end)
        } else {
          columns[column] = item.end
        }
        item.column = column
      }

      const columnCount = Math.max(1, columns.length)
      for (const item of cluster) {
        layout.set(item.id, {
          column: item.column,
          columns: columnCount
        })
      }
    }

    function filteredAgendaAppointments() {
      const weekStart = startOfWeek(state.agendaSelectedDate)
      const weekEnd = addDays(weekStart, 7)
      const professionalId = els.agendaProfessional?.value || ''
      const serviceId = els.agendaService?.value || ''

      return state.agendaAppointments
        .filter((appointment) => appointment.status !== 'CANCELLED')
        .filter((appointment) => {
          const start = new Date(appointment.startAt)
          return start >= weekStart && start < weekEnd
        })
        .filter((appointment) => !professionalId || appointment.professionalId === professionalId)
        .filter((appointment) => !serviceId || appointment.serviceId === serviceId)
        .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime())
    }

    function isClosedAgendaSlot(day, minute) {
      const professionalId = els.agendaProfessional?.value || ''
      const professionals = professionalId
        ? state.professionals.filter((professional) => professional.id === professionalId)
        : activeProfessionals()

      if (professionals.length === 0) {
        return false
      }

      return !professionals.some((professional) => {
        return (professional.workingHours || []).some((hour) => {
          return hour.dayOfWeek === day.getDay() &&
            minute >= timeToMinutes(hour.startTime) &&
            minute < timeToMinutes(hour.endTime)
        })
      })
    }

    function openAppointmentDialog(input = {}) {
      renderAppointmentFormOptions()
      els.appointmentFeedback.textContent = ''
      const appointment = input.appointment
      state.editingAppointmentId = appointment?.id || null
      els.appointmentTitle.textContent = appointment ? 'Editar turno' : 'Nuevo turno'
      els.appointmentSubmit.textContent = appointment ? 'Guardar cambios' : 'Guardar turno'
      els.appointmentDelete.hidden = !appointment
      els.appointmentNoShow.hidden = !appointment || appointment.status === 'CANCELLED'

      if (appointment) {
        els.appointmentStart.value = toDatetimeLocalValue(new Date(appointment.startAt))
        els.appointmentProfessional.value = appointment.professionalId || ''
        els.appointmentService.value = appointment.serviceId || ''
        els.appointmentCustomer.value = appointment.customerId || ''
        els.appointmentCustomerName.value = appointment.customer?.name || ''
        els.appointmentCustomerPhone.value = appointment.customer?.phone || ''
        els.appointmentNoShow.textContent = appointment.status === 'NO_SHOW' ? 'Quitar ausente' : 'Marcar ausente'
        els.appointmentNoShow.className = appointment.status === 'NO_SHOW' ? 'secondary' : 'danger'
        els.appointmentFeedback.textContent = appointment.status === 'NO_SHOW' ? 'Este turno esta marcado como ausente.' : ''
      } else {
        const date = input.date || state.agendaSelectedDate || new Date()
        const minute = Number.isFinite(input.minute) ? input.minute : 9 * 60
        els.appointmentStart.value = toDatetimeLocalValue(addMinutes(startOfDay(date), minute))

        const selectedProfessionalId = els.agendaProfessional.value
        const selectedServiceId = els.agendaService.value
        els.appointmentProfessional.value = selectedProfessionalId || activeProfessionals()[0]?.id || ''
        els.appointmentService.value = selectedServiceId || state.services[0]?.id || ''
        els.appointmentCustomer.value = ''
        els.appointmentCustomerName.value = ''
        els.appointmentCustomerPhone.value = ''
      }

      syncAppointmentCustomerFields()
      els.appointmentDialog.hidden = false
      els.appointmentStart.focus()
    }

    function closeAppointmentDialog() {
      els.appointmentDialog.hidden = true
      els.appointmentFeedback.textContent = ''
      state.editingAppointmentId = null
      els.appointmentDelete.hidden = true
      els.appointmentNoShow.hidden = true
    }

    function syncAppointmentCustomerFields() {
      const customer = state.customers.find((item) => item.id === els.appointmentCustomer.value)
      if (customer) {
        els.appointmentCustomerName.value = customer.name
        els.appointmentCustomerPhone.value = customer.phone
      } else if (!els.appointmentCustomer.value) {
        els.appointmentCustomerName.value = ''
        els.appointmentCustomerPhone.value = ''
      }
    }

    async function saveManualAppointment(event) {
      event.preventDefault()
      els.appointmentFeedback.textContent = ''

      const startAt = els.appointmentStart.value
      const professionalId = els.appointmentProfessional.value
      const serviceId = els.appointmentService.value
      let customerId = els.appointmentCustomer.value

      if (!startAt || !professionalId || !serviceId) {
        els.appointmentFeedback.textContent = 'Completa fecha, profesional y servicio.'
        return
      }

      try {
        if (!customerId) {
          const name = els.appointmentCustomerName.value.trim()
          const phone = els.appointmentCustomerPhone.value.trim()
          if (!name || !phone) {
            els.appointmentFeedback.textContent = 'Elegi un cliente o carga nombre y telefono.'
            return
          }

          const customer = await getJson('/customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone })
          })
          customerId = customer.id
          state.customers = await getJson('/customers')
          renderAppointmentFormOptions()
        }

        const appointmentId = state.editingAppointmentId
        await getJson(appointmentId ? '/appointments/' + appointmentId : '/appointments', {
          method: appointmentId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId,
            professionalId,
            serviceId,
            startAt: new Date(startAt).toISOString()
          })
        })

        closeAppointmentDialog()
        await loadAgenda()
        if (state.selected) {
          await loadAppointments()
          renderAppointments()
        }
      } catch (error) {
        els.appointmentFeedback.textContent = error.message
      }
    }

    async function deleteManualAppointment() {
      const appointmentId = state.editingAppointmentId
      if (!appointmentId) return
      if (!confirm('Eliminar este turno de la agenda?')) return

      try {
        await getJson('/appointments/' + appointmentId, {
          method: 'DELETE'
        })
        closeAppointmentDialog()
        await loadAgenda()
        if (state.selected) {
          await loadAppointments()
          renderAppointments()
        }
      } catch (error) {
        els.appointmentFeedback.textContent = error.message
      }
    }

    async function toggleManualAppointmentNoShow() {
      const appointmentId = state.editingAppointmentId
      if (!appointmentId) return
      const appointment = state.agendaAppointments.find((item) => item.id === appointmentId)
      const isNoShow = appointment?.status === 'NO_SHOW'
      const nextStatus = isNoShow ? 'CONFIRMED' : 'NO_SHOW'
      if (!confirm(isNoShow ? 'Quitar el estado ausente de este turno?' : 'Marcar este turno como ausente?')) return

      try {
        await getJson('/appointments/' + appointmentId + '/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: nextStatus
          })
        })
        closeAppointmentDialog()
        await loadAgenda()
        if (state.selected) {
          await loadAppointments()
          renderAppointments()
        }
        if (els.appShell.dataset.section === 'reports') {
          await loadReports()
        }
      } catch (error) {
        els.appointmentFeedback.textContent = error.message
      }
    }

    function setSection(section) {
      els.appShell.dataset.section = section
      const buttons = document.querySelectorAll('.workspace-nav button')
      buttons.forEach((button, index) => {
        const sectionByIndex = ['conversations', 'agenda', 'customers', 'professionals', 'services', 'campaigns', 'reports', 'settings']
        button.classList.toggle('active', sectionByIndex[index] === section)
      })

      if (section === 'agenda') {
        loadAgenda().catch((error) => {
          els.agendaGridWrap.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>'
        })
      }

      if (section === 'reports') {
        loadReports().catch((error) => {
          els.reportStatusBars.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>'
        })
      }
    }

    function startOfWeek(date) {
      const copy = startOfDay(date)
      copy.setDate(copy.getDate() - copy.getDay())
      return copy
    }

    function startOfDay(date) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate())
    }

    function addDays(date, days) {
      const copy = new Date(date)
      copy.setDate(copy.getDate() + days)
      return copy
    }

    function addMinutes(date, minutes) {
      return new Date(date.getTime() + minutes * 60 * 1000)
    }

    function dateKey(date) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return year + '-' + month + '-' + day
    }

    function toDatetimeLocalValue(date) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hour = String(date.getHours()).padStart(2, '0')
      const minute = String(date.getMinutes()).padStart(2, '0')
      return year + '-' + month + '-' + day + 'T' + hour + ':' + minute
    }

    function parseDateKey(value) {
      const [year, month, day] = String(value).split('-').map(Number)
      return new Date(year, month - 1, day)
    }

    function timeToMinutes(value) {
      const [hours, minutes] = String(value || '00:00').split(':').map(Number)
      return hours * 60 + minutes
    }

    function formatMinuteLabel(minute) {
      const hours = Math.floor(minute / 60)
      const minutes = minute % 60
      return minutes === 0 ? String(hours) : String(hours) + ':' + String(minutes).padStart(2, '0')
    }

    function formatTimeOnly(date) {
      return new Intl.DateTimeFormat('es-AR', {
        hour: '2-digit',
        minute: '2-digit'
      }).format(date)
    }

    function formatAgendaRange(start, end) {
      return new Intl.DateTimeFormat('es-AR').format(start) + ' a ' + new Intl.DateTimeFormat('es-AR').format(end)
    }

    function formatAgendaDayHeader(date) {
      const weekday = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'][date.getDay()]
      return weekday + ' ' + date.getDate() + '/' + (date.getMonth() + 1)
    }

    async function saveService(event) {
      event.preventDefault()
      if (!state.businessId) {
        els.serviceFeedback.textContent = 'No encontre un negocio cargado.'
        return
      }

      const id = els.serviceId.value
      const name = els.serviceName.value.trim()
      const duration = Number(els.serviceDuration.value)
      const category = els.serviceCategory.value.trim()
      const aliases = els.serviceAliases.value
        .split(',')
        .map((alias) => alias.trim())
        .filter(Boolean)

      if (!name || !Number.isFinite(duration) || duration <= 0) {
        els.serviceFeedback.textContent = 'Completa nombre y duracion.'
        return
      }

      try {
        await getJson(id ? '/services/' + id : '/services', {
          method: id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            duration,
            businessId: state.businessId,
            category: category || undefined,
            aliases
          })
        })
        const successMessage = id ? 'Servicio actualizado.' : 'Servicio creado.'
        resetServiceForm()
        els.serviceFeedback.textContent = successMessage
        state.services = await getJson('/services')
        renderServices()
        renderAgendaFilters()
        renderAppointmentFormOptions()
        renderAgenda()
      } catch (error) {
        els.serviceFeedback.textContent = error.message
      }
    }

    function editService(id) {
      const service = state.services.find((item) => item.id === id)
      if (!service) return
      els.serviceId.value = service.id
      els.serviceName.value = service.name
      els.serviceDuration.value = service.duration
      els.serviceCategory.value = service.category || ''
      els.serviceAliases.value = (service.aliases || []).map((alias) => alias.name).join(', ')
      els.serviceCancel.hidden = false
      els.serviceFeedback.textContent = 'Editando servicio.'
      document.querySelector('.services-form-panel h3').textContent = 'Editar servicio'
      document.getElementById('service-submit').textContent = 'Guardar cambios'
      setSection('services')
    }

    async function deleteService(id) {
      const service = state.services.find((item) => item.id === id)
      if (!service || !confirm('Eliminar servicio ' + service.name + '?')) return

      try {
        await getJson('/services/' + id, {
          method: 'DELETE'
        })
        els.serviceFeedback.textContent = 'Servicio eliminado.'
        state.services = await getJson('/services')
        renderServices()
        renderAgendaFilters()
        renderAppointmentFormOptions()
        renderAgenda()
      } catch (error) {
        els.serviceFeedback.textContent = error.message
      }
    }

    function resetServiceForm() {
      els.serviceId.value = ''
      els.serviceName.value = ''
      els.serviceDuration.value = ''
      els.serviceCategory.value = ''
      els.serviceAliases.value = ''
      els.serviceCancel.hidden = true
      els.serviceFeedback.textContent = ''
      document.querySelector('.services-form-panel h3').textContent = 'Nuevo servicio'
      document.getElementById('service-submit').textContent = 'Guardar servicio'
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
    }

    function latestConversationActivityValue(conversation) {
      return conversation.messages?.[0]?.createdAt || conversation.updatedAt || conversation.createdAt
    }

    function latestConversationActivityAt(conversation) {
      const value = latestConversationActivityValue(conversation)
      return value ? new Date(value).getTime() : 0
    }

    function conversationStepChipClass(step, aiEnabled) {
      if (aiEnabled === false) return 'chip manual'
      return step === 'HUMAN_HANDOFF' ? 'chip handoff' : 'chip'
    }

    function isMobile() {
      return window.matchMedia('(max-width: 760px)').matches
    }

    function setMobileView(view) {
      document.body.dataset.mobileView = view
      els.mobileInbox.classList.toggle('active', view === 'inbox')
      els.mobileChat.classList.toggle('active', view === 'chat')
      els.mobileDetails.classList.toggle('active', view === 'details')
    }

    els.replyForm.addEventListener('submit', sendReply)
    els.blockForm.addEventListener('submit', createBlock)
    els.professionalForm.addEventListener('submit', saveProfessional)
    els.professionalCancel.addEventListener('click', resetProfessionalForm)
    els.professionalImpactKeep.addEventListener('click', () => {
      if (!state.pendingProfessionalSave) return
      saveProfessional(new Event('submit'), { conflictStrategy: 'KEEP_EXISTING' })
    })
    els.professionalImpactReprogram.addEventListener('click', () => {
      els.professionalFeedback.textContent = 'Usa la lista de turnos afectados para contactar clientes y reprogramar desde Agenda.'
      setSection('agenda')
    })
    els.professionalImpactCancel.addEventListener('click', () => {
      els.professionalFeedback.textContent = 'Antes de cancelar, contacta a los clientes de la lista. La cancelacion automatica la dejamos para el siguiente paso.'
    })
    els.serviceForm.addEventListener('submit', saveService)
    els.serviceCancel.addEventListener('click', resetServiceForm)
    els.globalBotToggle.addEventListener('click', toggleGlobalBot)
    els.globalAiToggle.addEventListener('click', toggleGlobalAi)
    els.conversationAiToggle.addEventListener('click', toggleConversationAi)
    els.resolveHandoff.addEventListener('click', resolveHandoff)
    els.refresh.addEventListener('click', loadConversations)
    els.searchButton.addEventListener('click', loadConversations)
    els.search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') loadConversations()
    })
    els.mobileInbox.addEventListener('click', () => setMobileView('inbox'))
    els.mobileChat.addEventListener('click', () => setMobileView('chat'))
    els.mobileDetails.addEventListener('click', () => setMobileView('details'))
    els.mobileBack.addEventListener('click', () => setMobileView('inbox'))
    document.querySelectorAll('.workspace-nav button')[0]?.addEventListener('click', () => setSection('conversations'))
    document.querySelectorAll('.workspace-nav button')[1]?.addEventListener('click', () => setSection('agenda'))
    document.querySelectorAll('.workspace-nav button')[3]?.addEventListener('click', () => setSection('professionals'))
    document.querySelectorAll('.workspace-nav button')[4]?.addEventListener('click', () => setSection('services'))
    document.querySelectorAll('.workspace-nav button')[6]?.addEventListener('click', () => setSection('reports'))
    els.reportsRange.addEventListener('change', renderReports)
    els.reportsInactiveDays.addEventListener('change', renderReports)
    els.reportsFutureDays.addEventListener('change', renderReports)
    els.reportsRefresh.addEventListener('click', loadReports)
    els.agendaProfessional.addEventListener('change', loadAgenda)
    els.agendaService.addEventListener('change', renderAgenda)
    els.agendaStep.addEventListener('change', renderAgenda)
    els.agendaToday.addEventListener('click', async () => {
      state.agendaSelectedDate = new Date()
      state.agendaMonthDate = new Date()
      await loadAgenda()
    })
    els.agendaPrev.addEventListener('click', async () => {
      state.agendaSelectedDate = addDays(state.agendaSelectedDate, -7)
      state.agendaMonthDate = new Date(state.agendaSelectedDate)
      await loadAgenda()
    })
    els.agendaNext.addEventListener('click', async () => {
      state.agendaSelectedDate = addDays(state.agendaSelectedDate, 7)
      state.agendaMonthDate = new Date(state.agendaSelectedDate)
      await loadAgenda()
    })
    els.agendaMonthPrev.addEventListener('click', () => {
      state.agendaMonthDate = new Date(state.agendaMonthDate.getFullYear(), state.agendaMonthDate.getMonth() - 1, 1)
      renderAgendaMonth()
    })
    els.agendaMonthNext.addEventListener('click', () => {
      state.agendaMonthDate = new Date(state.agendaMonthDate.getFullYear(), state.agendaMonthDate.getMonth() + 1, 1)
      renderAgendaMonth()
    })
    els.agendaRefresh.addEventListener('click', loadAgenda)
    els.agendaNewAppointment.addEventListener('click', () => openAppointmentDialog())
    els.appointmentForm.addEventListener('submit', saveManualAppointment)
    els.appointmentClose.addEventListener('click', closeAppointmentDialog)
    els.appointmentCancel.addEventListener('click', closeAppointmentDialog)
    els.appointmentDelete.addEventListener('click', deleteManualAppointment)
    els.appointmentNoShow.addEventListener('click', toggleManualAppointmentNoShow)
    els.appointmentCustomer.addEventListener('change', syncAppointmentCustomerFields)
    els.appointmentDialog.addEventListener('click', (event) => {
      if (event.target === els.appointmentDialog) {
        closeAppointmentDialog()
      }
    })

    loadBasics()
      .then(loadConversations)
      .catch((error) => {
        els.list.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>'
      })

    setInterval(() => {
      loadConversations({ silent: true })
    }, 5000)
  </script>
</body>
</html>`
