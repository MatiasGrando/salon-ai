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

    .crm-toast {
      position: fixed;
      right: 22px;
      bottom: 22px;
      z-index: 60;
      max-width: min(420px, calc(100vw - 32px));
      padding: 13px 15px;
      display: none;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      color: #1d4ed8;
      background: #eff6ff;
      box-shadow: 0 16px 34px rgba(15, 23, 42, .14);
      font-size: 13px;
      line-height: 1.45;
    }

    .crm-toast.visible {
      display: block;
    }

    .crm-toast.error {
      color: #b42318;
      border-color: #fecaca;
      background: #fff1f2;
    }

    .crm-toast.success {
      color: #166534;
      border-color: #bbf7d0;
      background: #f0fdf4;
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

    .chip.success {
      color: #087a3d;
      background: #e8f8ee;
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
      display: none;
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
      overflow: hidden;
    }

    .brand-mark img,
    .mini-avatar img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
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
      grid-template-columns: 224px minmax(290px, 336px) minmax(420px, 1fr) minmax(310px, 360px);
      height: 100dvh;
      background: #f8fbff;
    }

    .workspace-nav {
      min-height: 0;
      padding: 22px 10px 18px;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 7px;
      background: linear-gradient(180deg, #061a31 0%, #06213d 55%, #041a31 100%);
      color: #d7e3f1;
      border-right: 0;
      border-radius: 0;
      box-shadow: 10px 0 28px rgba(3, 17, 34, 0.14);
    }

    .workspace-nav .crm-brand {
      min-height: 54px;
      margin: 0 10px 24px;
      gap: 11px;
    }

    .workspace-nav .brand-mark {
      width: 40px;
      height: 40px;
      border: 1px solid rgba(255, 255, 255, .2);
      border-radius: 9px;
      font-size: 17px;
      box-shadow: 0 10px 24px rgba(0, 0, 0, .2);
    }

    .workspace-nav .crm-brand strong {
      color: #ffffff;
      font-size: 18px;
      font-weight: 750;
      letter-spacing: 0;
    }

    .workspace-nav .crm-brand span {
      margin-top: 3px;
      color: #a8bad0;
      font-size: 12px;
    }

    .workspace-nav button {
      width: 100%;
      min-height: 52px;
      padding: 8px 10px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 9px;
      color: #d5e0ed;
      background: transparent;
      font-size: 14px;
      position: relative;
    }

    .workspace-nav button.active,
    .workspace-nav button.active:hover {
      color: #ffffff;
      background: #0d63f3;
      box-shadow: 0 10px 22px rgba(13, 99, 243, .28);
    }

    .workspace-nav button:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, .08);
      box-shadow: none;
    }

    .workspace-nav button > span {
      width: 32px;
      height: 32px;
      border-radius: 7px;
      display: grid;
      place-items: center;
      font-size: 13px;
      line-height: 1;
      color: currentColor;
      background: transparent;
      font-weight: 800;
      flex-shrink: 0;
    }

    .workspace-nav button > span .ti {
      width: 22px;
      height: 22px;
      stroke-width: 2;
    }

    .workspace-nav button.active > span {
      background: transparent;
    }

    .workspace-nav button > strong {
      font-size: 14px;
      line-height: 1.15;
      font-weight: 600;
    }

    .nav-subitems {
      margin: -3px 0 4px 41px;
      padding-left: 13px;
      display: grid;
      gap: 4px;
      border-left: 1px solid rgba(213, 224, 237, .22);
    }

    .workspace-nav .nav-subitems button {
      min-height: 32px;
      padding: 6px 10px;
      border-radius: 8px;
      color: #9fb4ce;
      font-size: 13px;
      font-weight: 650;
    }

    .workspace-nav .nav-subitems button.active {
      color: #ffffff;
      background: rgba(13, 99, 243, .28);
      box-shadow: none;
    }

    .nav-badge {
      min-width: 22px;
      height: 22px;
      margin-left: auto;
      padding: 0 7px;
      border-radius: 999px;
      display: inline-grid;
      place-items: center;
      color: #0d63f3;
      background: #ffffff;
      font-size: 12px;
      line-height: 1;
      font-weight: 850;
      box-shadow: none;
    }

    .nav-badge[hidden] {
      display: none;
    }

    .nav-user {
      margin-top: auto;
      min-height: 112px;
      padding: 14px;
      border: 1px solid rgba(255, 255, 255, .1);
      border-radius: 8px;
      display: grid;
      grid-template-columns: 38px 1fr;
      gap: 12px;
      align-items: center;
      color: #e7eef7;
      background: rgba(255, 255, 255, .075);
      box-shadow: none;
    }

    .mini-avatar {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #fff;
      background: #1d64d8;
      font-weight: 850;
      font-size: 13px;
      grid-row: 1;
    }

    .nav-user-info {
      min-width: 0;
    }

    .nav-user-info strong {
      display: block;
      color: #ffffff;
      font-size: 13px;
      line-height: 1.2;
      font-weight: 700;
    }

    .nav-user-info span {
      display: block;
      margin-top: 2px;
      color: #b7c6d8;
      font-size: 11px;
      line-height: 1.2;
      font-weight: 550;
    }

    .nav-user-status {
      grid-column: 1 / -1;
      min-height: 28px;
      padding-top: 10px;
      border-top: 1px solid rgba(255, 255, 255, .1);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #c6d3e2;
      font-size: 12px;
      font-weight: 700;
    }

    .nav-online-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #22c55e;
      flex-shrink: 0;
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

    .app[data-section="conversations"] {
      grid-template-columns: 224px minmax(280px, 320px) minmax(420px, 1fr) minmax(300px, 340px);
      grid-template-rows: 104px minmax(0, 1fr);
      background: #f8fbff;
    }

    .app[data-section="conversations"] .workspace-nav {
      grid-column: 1;
      grid-row: 1 / 3;
    }

    .conversation-page-header {
      grid-column: 2 / 5;
      grid-row: 1;
      min-width: 0;
      padding: 20px 24px 16px;
      display: none;
      grid-template-columns: auto minmax(260px, 1fr);
      align-items: center;
      gap: 24px;
      background: #fff;
      border-bottom: 1px solid #e5eaf3;
    }

    .app[data-section="conversations"] .conversation-page-header {
      display: grid;
    }

    .conversation-heading {
      display: flex;
      align-items: center;
      gap: 12px;
      white-space: nowrap;
    }

    .conversation-heading-icon {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      color: #2563eb;
      background: #eef3ff;
    }

    .conversation-heading-icon .ti {
      width: 23px;
      height: 23px;
    }

    .conversation-heading h1 {
      margin: 0;
      color: #071033;
      font-size: 24px;
      line-height: 1.15;
      font-weight: 750;
    }

    .conversation-heading p {
      margin: 5px 0 0;
      color: #52617f;
      font-size: 13px;
    }

    .conversation-global-search {
      height: 46px;
      min-width: 0;
      padding: 0 12px;
      border: 1px solid #dfe6f1;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 9px;
      background: #fff;
    }

    .conversation-global-search > .ti {
      width: 18px;
      height: 18px;
      color: #6f7f9f;
      flex-shrink: 0;
    }

    .conversation-global-search input {
      width: 100%;
      min-width: 0;
      border: 0;
      outline: 0;
      color: #15213f;
      background: transparent;
      font-size: 13px;
    }

    .conversation-global-search .icon-button {
      display: none;
    }

    .conversation-refresh {
      display: none !important;
    }

    .conversation-sidebar {
      grid-column: 2;
      grid-row: 2;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      background: #fff;
      border-right: 1px solid #e5eaf3;
    }

    .app[data-section="conversations"] .chat-header .mobile-only,
    .app[data-section="conversations"] .chat-actions > #step-chip {
      display: none !important;
    }

    .conversation-tabs {
      min-height: 58px;
      padding: 0 10px;
      border-bottom: 1px solid #e5eaf3;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      align-items: stretch;
      flex-shrink: 0;
    }

    .conversation-tabs button {
      position: relative;
      min-width: 0;
      padding: 0 5px;
      border-radius: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      color: #52617f;
      background: transparent;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }

    .conversation-tabs button::after {
      content: "";
      position: absolute;
      right: 10px;
      bottom: 0;
      left: 10px;
      height: 2px;
      border-radius: 2px 2px 0 0;
      background: transparent;
    }

    .conversation-tabs button.active {
      color: #175cf5;
    }

    .conversation-tabs button.active::after {
      background: #2563eb;
    }

    .conversation-tabs span {
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      border-radius: 999px;
      display: inline-grid;
      place-items: center;
      color: #2563eb;
      background: #eef3ff;
      font-size: 10px;
    }

    .conversation-list {
      padding: 10px 8px 4px;
    }

    .conversation {
      width: 100%;
      min-height: 94px;
      margin: 0 0 6px;
      padding: 13px 12px;
      border: 1px solid transparent;
      border-radius: 8px;
      grid-template-columns: 42px minmax(0, 1fr);
      background: #fff;
      box-shadow: none;
    }

    .conversation:hover,
    .conversation.active {
      border-color: #dbe7ff;
      background: #f0f5ff;
    }

    .conversation-avatar-wrap {
      position: relative;
      width: 42px;
      height: 42px;
    }

    .conversation-avatar-wrap .avatar {
      width: 42px;
      height: 42px;
      color: #175cf5;
      background: #eaf0ff;
      font-size: 16px;
    }

    .conversation-online-dot {
      position: absolute;
      right: -1px;
      bottom: 0;
      width: 11px;
      height: 11px;
      border: 2px solid #fff;
      border-radius: 50%;
      background: #16b364;
    }

    .conversation-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #101936;
      font-size: 13px;
      font-weight: 750;
    }

    .conversation-time {
      color: #3369dd;
      font-size: 10px;
      font-weight: 650;
      white-space: nowrap;
    }

    .conversation .preview {
      margin: 4px 0 6px;
      -webkit-line-clamp: 1;
      color: #52617f;
      font-size: 11px;
    }

    .conversation-status-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .conversation-unread-dot {
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      display: inline-grid;
      place-items: center;
      color: #fff;
      background: #2563eb;
      font-size: 10px;
      font-weight: 750;
    }

    .conversation-more {
      height: 48px;
      margin: 2px 8px 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: #175cf5;
      background: transparent;
      font-size: 12px;
      font-weight: 700;
      flex-shrink: 0;
    }

    .conversation-more .ti {
      width: 14px;
      height: 14px;
    }

    .app[data-section="conversations"] .chat {
      grid-column: 3;
      grid-row: 2;
      border-right: 1px solid #e5eaf3;
      background: #fbfcff;
    }

    .app[data-section="conversations"] .chat-header {
      min-height: 74px;
      padding: 12px 18px;
      border-color: #e5eaf3;
    }

    .chat-contact-name {
      margin-top: 3px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .whatsapp-chip {
      height: 20px;
      padding: 0 8px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      color: #16883e;
      background: #dcfce7;
      font-size: 10px;
      font-weight: 750;
    }

    .chat-more-menu {
      position: relative;
    }

    .chat-more-menu > summary {
      list-style: none;
      cursor: pointer;
    }

    .chat-more-menu > summary::-webkit-details-marker {
      display: none;
    }

    .chat-more-popover {
      position: absolute;
      z-index: 20;
      top: calc(100% + 8px);
      right: 0;
      width: 210px;
      padding: 8px;
      border: 1px solid #dfe6f1;
      border-radius: 8px;
      display: grid;
      gap: 6px;
      background: #fff;
      box-shadow: 0 18px 34px rgba(15, 23, 42, .14);
    }

    .chat-more-popover button {
      width: 100%;
      min-height: 36px;
      justify-content: flex-start;
    }

    .chat-more-popover button[hidden] {
      display: none;
    }

    .app[data-section="conversations"] .messages {
      padding: 20px 18px 24px;
      gap: 12px;
      background: #fbfcff;
    }

    .message-day {
      align-self: center;
      margin: 2px 0 8px;
      padding: 5px 12px;
      border-radius: 999px;
      color: #52617f;
      background: #eef1f6;
      font-size: 11px;
      font-weight: 700;
    }

    .message-load-older {
      align-self: center;
      min-height: 30px;
      padding: 0 12px;
      border: 1px solid #dbe3ef;
      border-radius: 999px;
      color: #175cf5;
      background: #fff;
      font-size: 10px;
      font-weight: 700;
    }

    .message {
      max-width: min(500px, 78%);
      padding: 11px 13px 8px;
      border-color: #e4e9f2;
      border-radius: 9px;
      color: #17213c;
      font-size: 12px;
    }

    .message.outbound {
      border-color: #cbdcff;
      background: #eef4ff;
    }

    .message.outbound.failed {
      border-color: #fecaca;
      background: #fff1f2;
    }

    .message-time {
      margin-top: 5px;
      font-size: 9px;
    }

    .message-checks {
      margin-left: 4px;
      color: #2563eb;
      font-weight: 800;
    }

    .message-status-failed {
      margin-left: 6px;
      color: #dc2626;
      font-weight: 800;
    }

    .app[data-section="conversations"] .composer {
      margin: 0 14px 14px;
      padding: 10px 12px 9px;
      border-color: #dfe6f1;
      border-radius: 8px;
      grid-template-columns: 1fr;
      gap: 4px;
      background: #fff;
    }

    .app[data-section="conversations"] .composer.is-locked {
      border-color: #fed7aa;
      background: #fff7ed;
    }

    .app[data-section="conversations"] .composer textarea {
      min-height: 38px;
      max-height: 100px;
      padding: 7px 3px;
      resize: none;
      font-size: 12px;
    }

    .app[data-section="conversations"] .composer.is-locked textarea {
      color: #9a3412;
      background: #fff7ed;
    }

    .composer-window-notice {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid #fed7aa;
      border-radius: 8px;
      color: #9a3412;
      background: #fffbeb;
      font-size: 12px;
      line-height: 1.35;
    }

    .composer-window-notice[hidden] {
      display: none;
    }

    .composer-window-notice span {
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

    .composer-window-notice .ti {
      width: 17px;
      height: 17px;
      flex: 0 0 17px;
      stroke-width: 2.2;
    }

    .composer-window-notice a {
      color: #2563eb;
      font-weight: 750;
      text-decoration: none;
      white-space: nowrap;
    }

    .composer-tools {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .composer-icon {
      width: 30px;
      height: 30px;
      border-radius: 7px;
      display: grid;
      place-items: center;
      color: #52617f;
      background: transparent;
    }

    .composer-icon:hover {
      color: #2563eb;
      background: #eef3ff;
    }

    .composer-icon .ti {
      width: 17px;
      height: 17px;
    }

    .composer-tools .primary {
      margin-left: auto;
      height: 34px;
      padding: 0 13px;
      border-radius: 7px;
      font-size: 11px;
    }

    .composer-tools .primary .ti {
      width: 14px;
      height: 14px;
    }

    .app[data-section="conversations"] .details {
      grid-column: 4;
      grid-row: 2;
      padding: 10px;
      gap: 10px;
      overflow: auto;
      background: #f8fbff;
    }

    .app[data-section="conversations"] .details .topbar,
    .app[data-section="conversations"] .details-section {
      border-color: #e2e8f2;
      border-radius: 8px;
    }

    .app[data-section="conversations"] .details .topbar {
      min-height: 50px;
      padding: 10px 13px;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }

    .details-edit,
    .details-link {
      padding: 0;
      color: #175cf5;
      background: transparent;
      font-size: 10px;
      font-weight: 700;
    }

    .customer-summary {
      display: grid;
      gap: 16px;
    }

    .customer-summary-main {
      display: flex;
      align-items: center;
      gap: 11px;
    }

    .customer-avatar {
      width: 46px;
      height: 46px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #175cf5;
      background: #eee8ff;
      font-size: 17px;
      font-weight: 800;
      flex-shrink: 0;
    }

    .customer-summary-main strong {
      display: inline;
      color: #101936;
      font-size: 12px;
    }

    .customer-type {
      margin-left: 5px;
      padding: 3px 6px;
      border-radius: 999px;
      color: #175cf5;
      background: #eef3ff;
      font-size: 9px;
      font-weight: 700;
    }

    .customer-summary-main a {
      display: block;
      margin-top: 5px;
      color: #175cf5;
      font-size: 11px;
      font-weight: 700;
      text-decoration: none;
    }

    .customer-last-message,
    .customer-bot-status {
      display: grid;
      gap: 5px;
    }

    .customer-last-message > span,
    .customer-bot-status > span:first-child {
      color: #66738e;
      font-size: 10px;
    }

    .customer-last-message strong {
      color: #17213c;
      font-size: 11px;
      font-weight: 650;
    }

    .app[data-section="conversations"] .details-section {
      padding: 13px;
    }

    .app[data-section="conversations"] .details .item {
      padding: 11px;
      background: #fbfcff;
    }

    .details-wide-action {
      width: 100%;
      height: 34px;
      margin-top: 10px;
      border: 1px solid #dfe6f1;
      border-radius: 7px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      color: #175cf5;
      background: #fff;
      font-size: 10px;
      font-weight: 700;
    }

    .details-wide-action .ti {
      width: 14px;
      height: 14px;
    }

    .customer-note-empty {
      margin-top: 10px;
      padding: 12px;
      border: 1px solid #e4e9f2;
      border-radius: 7px;
      color: #6b7892;
      background: #fbfcff;
      font-size: 10px;
      line-height: 1.45;
    }

    .customer-note-list {
      max-height: 160px;
      margin-top: 10px;
      display: grid;
      gap: 7px;
      overflow: auto;
    }

    .customer-note-item {
      padding: 10px;
      border: 1px solid #e4e9f2;
      border-radius: 7px;
      background: #fbfcff;
    }

    .customer-note-item p {
      margin: 0;
      color: #263958;
      font-size: 10px;
      line-height: 1.45;
      white-space: pre-wrap;
    }

    .customer-note-item span {
      display: block;
      margin-top: 6px;
      color: #7a869e;
      font-size: 9px;
    }

    .quick-actions .panel-title {
      margin-bottom: 10px;
    }

    .quick-actions-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 7px;
    }

    .quick-actions-grid button {
      min-height: 38px;
      padding: 6px 8px;
      border: 1px solid #dfe6f1;
      border-radius: 7px;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 6px;
      color: #263958;
      background: #fff;
      font-size: 9px;
      font-weight: 650;
      text-align: left;
    }

    .quick-actions-grid button:hover {
      color: #175cf5;
      border-color: #bcd0f8;
      background: #f5f8ff;
    }

    .quick-actions-grid .ti {
      width: 14px;
      height: 14px;
      color: #2563eb;
      flex-shrink: 0;
    }

    .chip.step-start {
      color: #52617f;
      background: #eef1f6;
    }

    .chip.step-progress {
      color: #175cd3;
      background: #eaf2ff;
    }

    .chip.step-confirm {
      color: #a15c07;
      background: #fff4d6;
    }

    .chip.step-completed {
      color: #16883e;
      background: #dcfce7;
    }

    .chip.step-change {
      color: #6941c6;
      background: #f0eaff;
    }

    .chip.step-handoff {
      color: #c4320a;
      background: #ffead5;
    }

    .conversation .chip {
      max-width: 100%;
      height: 18px;
      padding: 0 7px;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 8px;
      text-transform: uppercase;
    }

    /* Conversation workspace polish */
    .app[data-section="conversations"] {
      grid-template-columns: 224px minmax(300px, 340px) minmax(400px, 1fr) minmax(300px, 350px);
      grid-template-rows: 100px minmax(0, 1fr);
    }

    .app[data-section="conversations"] .conversation-page-header {
      padding: 18px 28px;
    }

    .conversation-heading h1 {
      font-weight: 700;
    }

    .conversation-heading p {
      font-size: 13.5px;
    }

    .conversation-tabs {
      min-height: 62px;
      padding: 0 12px;
    }

    .conversation-tabs button {
      font-size: 11.5px;
      font-weight: 650;
    }

    .conversation-list {
      padding: 12px 10px 6px;
      scrollbar-width: thin;
      scrollbar-color: transparent transparent;
    }

    .conversation-list:hover {
      scrollbar-color: #cbd5e1 transparent;
    }

    .conversation-list::-webkit-scrollbar,
    .app[data-section="conversations"] .messages::-webkit-scrollbar,
    .app[data-section="conversations"] .details::-webkit-scrollbar {
      width: 6px;
    }

    .conversation-list::-webkit-scrollbar-thumb,
    .app[data-section="conversations"] .messages::-webkit-scrollbar-thumb,
    .app[data-section="conversations"] .details::-webkit-scrollbar-thumb {
      border-radius: 999px;
      background: transparent;
    }

    .conversation-list:hover::-webkit-scrollbar-thumb,
    .app[data-section="conversations"] .messages:hover::-webkit-scrollbar-thumb,
    .app[data-section="conversations"] .details:hover::-webkit-scrollbar-thumb {
      background: #cbd5e1;
    }

    .conversation {
      min-height: 102px;
      margin-bottom: 8px;
      padding: 15px 14px;
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 12px;
    }

    .conversation-avatar-wrap,
    .conversation-avatar-wrap .avatar {
      width: 44px;
      height: 44px;
    }

    .conversation-name {
      font-size: 13.5px;
      font-weight: 700;
    }

    .conversation-time {
      font-size: 10.5px;
      font-weight: 600;
    }

    .conversation .preview {
      margin: 5px 0 8px;
      font-size: 11.5px;
    }

    .app[data-section="conversations"] .chat-header {
      min-height: 76px;
      padding: 12px 20px;
    }

    .app[data-section="conversations"] .messages {
      padding: 22px 24px 26px;
      gap: 14px;
      scrollbar-width: thin;
      scrollbar-color: transparent transparent;
    }

    .app[data-section="conversations"] .message {
      max-width: min(480px, 70%);
      padding: 12px 14px 9px;
      font-size: 13px;
      line-height: 1.5;
    }

    .app[data-section="conversations"] .message-time {
      margin-top: 6px;
      font-size: 9.5px;
    }

    .app[data-section="conversations"] .composer {
      margin: 0 18px 18px;
      padding: 10px 12px;
      gap: 6px;
    }

    .app[data-section="conversations"] .composer textarea {
      min-height: 42px;
      font-size: 13px;
    }

    .app[data-section="conversations"] .composer-tools .primary {
      height: 36px;
      padding: 0 15px;
      font-size: 12px;
    }

    .app[data-section="conversations"] .details {
      padding: 12px;
      gap: 12px;
      scrollbar-width: thin;
      scrollbar-color: transparent transparent;
    }

    .app[data-section="conversations"] .details-section {
      padding: 15px;
    }

    .customer-summary-copy {
      min-width: 0;
      flex: 1;
    }

    .customer-whatsapp {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #16a34a;
      background: #ecfdf3;
      flex-shrink: 0;
    }

    .customer-whatsapp .ti {
      width: 17px;
      height: 17px;
    }

    .customer-summary-main strong {
      font-size: 13px;
      font-weight: 700;
    }

    .customer-summary-main a:not(.customer-whatsapp) {
      font-size: 11.5px;
    }

    .customer-last-message > span,
    .customer-bot-status > span:first-child {
      font-size: 10.5px;
    }

    .customer-last-message strong {
      font-size: 11.5px;
    }

    .customer-bot-status .chip {
      width: auto;
      justify-self: start;
    }

    .appointment-card {
      display: grid;
      grid-template-columns: 54px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }

    .appointment-date-tile {
      width: 54px;
      height: 58px;
      border-radius: 8px;
      display: grid;
      place-content: center;
      text-align: center;
      color: #17213c;
      background: #eef3ff;
    }

    .appointment-date-tile strong {
      font-size: 19px;
      line-height: 1;
      font-weight: 700;
    }

    .appointment-date-tile span {
      margin-top: 4px;
      color: #2563eb;
      font-size: 9px;
      font-weight: 750;
    }

    .appointment-card-copy {
      min-width: 0;
    }

    .appointment-card-copy .item-title {
      font-size: 13px;
      font-weight: 700;
    }

    .appointment-card-copy p {
      font-size: 11px;
      line-height: 1.35;
    }

    .appointment-card-copy .chip {
      margin-top: 8px;
    }

    .quick-actions-grid button {
      min-height: 40px;
      padding: 7px 9px;
      font-size: 10px;
      font-weight: 600;
    }

    /* Right customer panel refinement */
    .app[data-section="conversations"] .details {
      gap: 13px;
      background: #f7faff;
    }

    .app[data-section="conversations"] .details .topbar,
    .app[data-section="conversations"] .details-section {
      border-color: #e6ebf3;
      box-shadow: 0 1px 2px rgba(15, 23, 42, .025);
    }

    .app[data-section="conversations"] .details .topbar {
      min-height: 52px;
      padding: 11px 15px;
    }

    .app[data-section="conversations"] .details .panel-title {
      font-size: 15px;
      font-weight: 700;
    }

    .details-edit,
    .details-link {
      font-size: 10.5px;
      font-weight: 650;
    }

    .customer-summary {
      gap: 18px;
    }

    .customer-avatar {
      width: 50px;
      height: 50px;
      font-size: 18px;
    }

    .customer-summary-main strong {
      font-size: 13.5px;
    }

    .customer-type {
      font-size: 9.5px;
    }

    .customer-summary-main a:not(.customer-whatsapp) {
      margin-top: 6px;
      font-size: 12px;
    }

    .customer-summary-main .customer-whatsapp {
      width: 36px;
      height: 36px;
      margin: 0;
      padding: 0;
      display: grid;
      place-items: center;
      color: #16a34a;
      background: #eafaf0;
      line-height: 0;
    }

    .customer-summary-main .customer-whatsapp .ti {
      width: 21px;
      height: 21px;
      display: block;
    }

    .customer-summary-main strong {
      font-size: 14.5px;
    }

    .customer-summary-main a:not(.customer-whatsapp) {
      font-size: 13px;
    }

    .customer-last-message > span,
    .customer-bot-status > span:first-child {
      color: #64748b;
      font-size: 11.5px;
    }

    .customer-last-message strong {
      font-size: 12.5px;
      font-weight: 650;
    }

    .customer-bot-status .chip {
      height: 23px;
      padding: 0 9px;
      font-size: 10.5px;
    }

    .app[data-section="conversations"] .details .stack {
      gap: 12px;
    }

    .app[data-section="conversations"] .details .item {
      padding: 13px;
      border-color: #e8edf5;
      background: #fff;
    }

    .appointment-card {
      grid-template-columns: 58px minmax(0, 1fr);
      gap: 14px;
    }

    .appointment-date-tile {
      width: 58px;
      height: 62px;
      background: #edf3ff;
    }

    .appointment-date-tile strong {
      font-size: 20px;
    }

    .appointment-date-tile span {
      font-size: 9.5px;
    }

    .appointment-card-copy .item-title {
      font-size: 14.5px;
    }

    .appointment-card-copy p {
      margin-top: 5px;
      color: #65728a;
      font-size: 12px;
      line-height: 1.4;
    }

    .appointment-card-copy .chip {
      height: 22px;
      margin-top: 9px;
      font-size: 10px;
    }

    .details-wide-action {
      height: 36px;
      margin-top: 11px;
      font-size: 10.5px;
    }

    .customer-note-empty {
      min-height: 54px;
      padding: 14px;
      border-style: dashed;
      border-color: #dce4f0;
      display: flex;
      align-items: center;
      color: #64748b;
      background: #f8faff;
      font-size: 10.5px;
    }

    .quick-actions .panel-title {
      margin-bottom: 12px;
    }

    .quick-actions-grid {
      gap: 7px;
    }

    .quick-actions-grid button {
      min-height: 48px;
      margin: 0;
      padding: 7px 8px;
      border-color: #e2e8f1;
      font-size: 11.5px;
    }

    .quick-actions-grid .ti {
      width: 17px;
      height: 17px;
    }

    /* Campaigns mock */
    .app[data-section="campaigns"] {
      grid-template-columns: 224px minmax(0, 1fr);
      background: #f8faff;
    }

    .app[data-section="campaigns"] .sidebar,
    .app[data-section="campaigns"] .chat,
    .app[data-section="campaigns"] .details {
      display: none;
    }

    .campaigns-view {
      grid-column: 2;
      min-width: 0;
      min-height: 0;
      display: none;
      overflow: auto;
      background: #f8faff;
    }

    .app[data-section="campaigns"] .campaigns-view {
      display: block;
    }

    .campaigns-shell {
      width: 100%;
      max-width: 1540px;
      min-height: 100%;
      margin: 0 auto;
      padding: 24px 26px 28px;
      color: #101b36;
    }

    .campaigns-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
    }

    .campaigns-title h2 {
      margin: 0 0 4px;
      color: #101b36;
      font-size: 26px;
      line-height: 1.2;
      letter-spacing: -.45px;
    }

    .campaigns-title p {
      margin: 0;
      color: #60708f;
      font-size: 15px;
    }

    .campaigns-header-actions {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .campaigns-search {
      width: min(300px, 25vw);
      height: 44px;
      padding: 0 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      border: 1px solid #d7deea;
      border-radius: 8px;
      background: #fff;
      color: #73809a;
    }

    .campaigns-search span {
      font-size: 19px;
    }

    .campaigns-search input {
      width: 100%;
      border: 0;
      outline: 0;
      background: transparent;
      color: #17223b;
      font: inherit;
      font-size: 14px;
    }

    .campaigns-new {
      height: 44px;
      padding: 0 19px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 8px;
      background: #0866ed;
      color: #fff;
      font-size: 14px;
      font-weight: 750;
      line-height: 1;
      box-shadow: 0 7px 16px rgba(8, 102, 237, .18);
    }

    .campaign-new-plus {
      position: relative;
      display: inline-block;
      width: 18px;
      margin-right: 8px;
      height: 18px;
      flex: 0 0 18px;
      color: transparent;
      font-size: 0;
    }

    .campaign-new-plus::before,
    .campaign-new-plus::after {
      content: "";
      position: absolute;
      left: 50%;
      top: 50%;
      border-radius: 999px;
      background: currentColor;
      background: #fff;
      transform: translate(-50%, -50%);
    }

    .campaign-new-plus::before {
      width: 16px;
      height: 2px;
    }

    .campaign-new-plus::after {
      width: 2px;
      height: 16px;
    }

    .campaigns-main-tabs {
      height: 51px;
      margin-top: 8px;
      display: flex;
      align-items: flex-end;
      gap: 8px;
      border-bottom: 1px solid #dce3ef;
    }

    .campaigns-main-tabs button {
      height: 42px;
      padding: 0 11px;
      border: 0;
      border-bottom: 3px solid transparent;
      background: transparent;
      color: #42516e;
      font-size: 14px;
      font-weight: 650;
    }

    .campaigns-main-tabs button.active {
      border-color: #0866ed;
      color: #0866ed;
    }

    .campaign-metrics {
      margin: 20px 0;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 18px;
    }

    .campaign-metric {
      min-height: 96px;
      padding: 18px 20px;
      display: flex;
      align-items: center;
      gap: 16px;
      border: 1px solid #dfe5ef;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 1px 2px rgba(16, 27, 54, .025);
    }

    .campaign-metric-icon,
    .campaign-row-icon,
    .campaign-detail-icon,
    .campaign-message-icon {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      border-radius: 50%;
      font-weight: 800;
    }

    .campaign-metric-icon {
      width: 48px;
      height: 48px;
      font-size: 21px;
    }

    .campaign-metric-icon.green { background: #e4f8ec; color: #05a84f; }
    .campaign-metric-icon.orange { background: #fff1df; color: #f28a16; }
    .campaign-metric-icon.violet { background: #f0eaff; color: #6938ef; }
    .campaign-metric-icon.blue { background: #e9f2ff; color: #0866ed; }
    .campaign-metric-icon.red { background: #feecec; color: #dc2626; }

    .campaign-metric strong {
      display: block;
      margin-bottom: 5px;
      color: #111c37;
      font-size: 25px;
      line-height: 1;
    }

    .campaign-metric span {
      color: #52617d;
      font-size: 14px;
    }

    .campaign-metric small {
      display: block;
      margin-top: 4px;
      color: #8792a8;
      font-size: 11px;
    }

    .template-manager[hidden] { display: none; }
    .template-workspace { grid-template-columns: minmax(650px, 1.35fr) minmax(360px, .75fr); }
    .template-table th:nth-child(1) { width: 20%; }
    .template-table th:nth-child(2) { width: 20%; }
    .template-table th:nth-child(3) { width: 14%; }
    .template-table th:nth-child(4) { width: 10%; }
    .template-table th:nth-child(5) { width: 15%; }
    .template-table th:nth-child(6) { width: 21%; }
    .template-detail-panel { padding: 18px; }
    .template-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .template-detail-head h3 { margin: 10px 0 4px; font-size: 20px; }
    .template-meta-line { margin: 0; color: #687790; font-size: 12px; }
    .template-preview { margin-top: 18px; padding: 18px; border-radius: 10px; background: #efe9df; }
    .template-preview-message { padding: 14px; border-radius: 8px; background: #fff; color: #26354f; font-size: 13px; line-height: 1.55; box-shadow: 0 1px 4px rgba(15,23,42,.08); white-space: pre-wrap; }
    .template-detail-meta { margin-top: 18px; display: grid; gap: 10px; }
    .template-detail-meta div { display: flex; justify-content: space-between; gap: 12px; padding-bottom: 9px; border-bottom: 1px solid #edf0f5; color: #64748b; font-size: 12px; }
    .template-detail-meta strong { color: #17213c; text-align: right; }
    .template-detail-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
    .template-rejection { margin-top: 14px; padding: 11px; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b; background: #fff7f7; font-size: 12px; }
    .template-detail-preview-image { width: 100%; max-height: 260px; display: block; object-fit: cover; border-radius: 10px 10px 0 0; }
    .template-review-note { margin-top: 14px; padding: 11px 13px; display: grid; gap: 3px; border: 1px solid #fde68a; border-radius: 10px; color: #92400e; background: #fffbeb; font-size: 12px; }
    .template-review-note span { color: #a16207; }
    .template-test-card { margin-top: 18px; padding: 14px; border: 1px solid #bfdbfe; border-radius: 12px; background: #f8fbff; }
    .template-test-card strong { display: block; margin-bottom: 5px; color: #15233e; font-size: 13px; }
    .template-test-card > p { margin: 0 0 12px; color: #64748b; font-size: 12px; line-height: 1.45; }
    .template-test-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
    .template-test-confirm { margin-top: 10px; display: flex; align-items: flex-start; gap: 8px; color: #52617d; font-size: 12px; line-height: 1.4; }
    .template-test-confirm input { width: auto; margin-top: 2px; }
    .template-test-feedback { min-height: 18px; margin: 9px 0 0; color: #52617d; font-size: 12px; }
    .template-test-feedback.error { color: #b42318; }
    .template-test-feedback.success { color: #047857; }
    .template-category-badge.utility { background: #dbeafe; color: #1d4ed8; }
    .reminder-list-button { width: 100%; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .reminder-list-button.selected { background: #eff6ff; box-shadow: inset 3px 0 0 #0d63f3; }
    .reminder-list-button .campaign-recipient-row { grid-template-columns: 38px minmax(0, 1fr) auto; }
    .reminder-channel-chip { display: inline-flex; align-items: center; padding: 5px 8px; border-radius: 999px; background: #eef4ff; color: #1d4ed8; font-size: 11px; font-weight: 800; }
    .template-dialog { width: min(1080px, calc(100vw - 42px)); max-height: min(880px, calc(100vh - 36px)); }
    .template-builder-grid { display: grid; grid-template-columns: minmax(520px, 1.2fr) minmax(340px, .8fr); gap: 20px; align-items: start; }
    .template-builder-main { display: grid; gap: 18px; }
    .template-builder-card { padding: 16px; border: 1px solid #e1e7f2; border-radius: 14px; background: #fff; }
    .template-builder-card h4 { margin: 0 0 6px; color: #13213a; font-size: 15px; }
    .template-builder-card > p { margin: 0 0 14px; color: #687790; font-size: 12px; line-height: 1.45; }
    .template-type-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .template-type-card { position: relative; display: grid; grid-template-columns: 42px 1fr; gap: 12px; align-items: center; padding: 14px; border: 1px solid #dde6f3; border-radius: 13px; background: #fbfdff; color: #1f2e48; cursor: pointer; transition: .18s ease; }
    .template-type-card input { position: absolute; opacity: 0; pointer-events: none; }
    .template-type-card span { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 12px; background: #eef4ff; color: #0d63f3; font-size: 20px; }
    .template-type-card strong { display: block; font-size: 14px; }
    .template-type-card small { display: block; margin-top: 3px; color: #6b7890; font-size: 11px; line-height: 1.35; }
    .template-type-card:has(input:checked) { border-color: #0d63f3; background: #eff6ff; box-shadow: 0 10px 24px rgba(13, 99, 243, .12); }
    .template-type-card:has(input:checked)::after { content: "✓"; position: absolute; right: 12px; top: 12px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: #0d63f3; font-size: 12px; font-weight: 800; }
    .template-meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .template-category-readonly { height: 42px; display: flex; align-items: center; padding: 0 12px; border: 1px solid #dce4ef; border-radius: 8px; color: #16213a; background: #f8fafc; font-weight: 700; }
    .template-variable-panel { display: grid; gap: 10px; }
    .template-variable-empty { padding: 12px; border-radius: 10px; background: #f8fafc; color: #687790; font-size: 12px; }
    .template-variable-row { display: grid; grid-template-columns: minmax(150px, .75fr) minmax(220px, 1fr); gap: 10px; align-items: center; padding: 10px; border: 1px solid #e5eaf2; border-radius: 11px; background: #fbfdff; }
    .template-variable-row.unsupported { border-color: #fecaca; background: #fff7f7; }
    .template-variable-chip { display: inline-flex; align-items: center; gap: 7px; color: #4f46e5; font-size: 12px; font-weight: 800; }
    .template-variable-row.unsupported .template-variable-chip { color: #dc2626; }
    .template-variable-chip::before { content: attr(data-index); width: 22px; height: 22px; display: grid; place-items: center; border-radius: 999px; color: #fff; background: #8b5cf6; font-size: 11px; }
    .template-variable-row.unsupported .template-variable-chip::before { background: #dc2626; }
    .template-variable-help { margin: 4px 0 0; color: #6b7890; font-size: 11px; line-height: 1.35; }
    .template-variable-row.unsupported .template-variable-help { color: #b42318; }
    .template-helper-callout { padding: 12px 14px; border: 1px solid #bfdbfe; border-radius: 12px; background: #eff6ff; color: #1d4ed8; font-size: 12px; line-height: 1.45; }
    .template-preview-panel { position: sticky; top: 14px; padding: 18px; border: 1px solid #dfe5ef; border-radius: 16px; background: #fff; box-shadow: 0 16px 34px rgba(16, 27, 54, .08); }
    .template-preview-panel h4 { margin: 0 0 12px; font-size: 15px; color: #15233e; }
    .template-phone-preview { padding: 18px; min-height: 230px; border-radius: 16px; background: linear-gradient(135deg, #efe9df, #f7f2ea); }
    .template-phone-bubble { max-width: 92%; margin-left: auto; padding: 14px 14px 20px; border-radius: 12px 12px 4px 12px; background: #fff; color: #1f2e48; font-size: 13px; line-height: 1.5; white-space: pre-wrap; box-shadow: 0 2px 8px rgba(15,23,42,.10); position: relative; }
    .template-live-image { width: calc(100% + 20px); max-height: 210px; margin: -10px -10px 10px; display: block; object-fit: cover; border-radius: 9px; }
    .template-live-image[hidden] { display: none; }
    .template-emoji-picker { margin: 10px 0; padding: 10px; display: flex; flex-wrap: wrap; gap: 6px; border: 1px solid #dbe3ef; border-radius: 10px; background: #fff; }
    .template-emoji-picker[hidden] { display: none; }
    emoji-picker.template-emoji-picker { width: 100%; height: 360px; padding: 0; --border-color: transparent; --border-radius: 10px; --category-emoji-size: 1.15rem; --emoji-size: 1.45rem; --num-columns: 9; }
    .template-phone-bubble::after { content: "11:30"; position: absolute; right: 12px; bottom: 5px; color: #99a3b5; font-size: 10px; }
    .template-checklist { margin-top: 14px; display: grid; gap: 9px; }
    .template-checklist div { display: flex; align-items: center; gap: 8px; color: #52617d; font-size: 12px; }
    .template-checklist span { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 50%; color: #fff; background: #16a34a; font-size: 11px; font-weight: 800; }
    .template-checklist .warn span { background: #f59e0b; }
    .template-form-feedback.error { color: #b42318; }
    .template-form-feedback.success { color: #047857; }

    .campaigns-workspace {
      display: grid;
      grid-template-columns: minmax(650px, 1.25fr) minmax(480px, 1fr);
      gap: 18px;
      align-items: stretch;
    }

    .campaign-list-panel,
    .campaign-detail-panel {
      min-width: 0;
      border: 1px solid #dfe5ef;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 1px 2px rgba(16, 27, 54, .025);
    }

    .campaign-list-panel {
      overflow: hidden;
    }

    .campaign-list-toolbar {
      min-height: 66px;
      padding: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      border-bottom: 1px solid #edf0f5;
    }

    .campaign-filter-tabs {
      display: flex;
      gap: 8px;
    }

    .campaign-filter-tabs button,
    .campaign-filter-button,
    .campaign-outline-button {
      height: 34px;
      padding: 0 13px;
      border: 1px solid #dce3ed;
      border-radius: 7px;
      background: #fff;
      color: #43516b;
      font-size: 12px;
      font-weight: 650;
    }

    .campaign-filter-tabs button.active {
      border-color: #0866ed;
      color: #0866ed;
      background: #f5f9ff;
      box-shadow: inset 0 0 0 1px rgba(8, 102, 237, .08);
    }

    .campaign-filter-button {
      white-space: nowrap;
    }

    .campaign-table-wrap {
      overflow-x: auto;
    }

    .campaign-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 12.5px;
    }

    .campaign-table th {
      height: 46px;
      padding: 0 10px;
      color: #53617a;
      text-align: left;
      font-size: 11px;
      font-weight: 750;
      white-space: nowrap;
    }

    .campaign-table td {
      height: 61px;
      padding: 7px 10px;
      border-top: 1px solid #edf0f5;
      color: #3f4d66;
      vertical-align: middle;
    }

    .campaign-table tr.selected td {
      border-top-color: #0866ed;
      border-bottom: 1px solid #0866ed;
      background: #f8fbff;
    }

    .campaign-table tr.selected td:first-child {
      border-left: 1px solid #0866ed;
      border-radius: 8px 0 0 8px;
    }

    .campaign-table tr.selected td:last-child {
      border-right: 1px solid #0866ed;
      border-radius: 0 8px 8px 0;
    }

    .campaign-name-cell {
      display: flex;
      align-items: center;
      gap: 10px;
      color: #17213a;
      font-weight: 750;
      line-height: 1.25;
    }

    .campaign-row-icon {
      width: 31px;
      height: 31px;
      background: #e7f8ed;
      color: #08a950;
      font-size: 13px;
    }

    .campaign-row-icon.email { background: #fff0df; color: #f47e0a; }
    .campaign-row-icon.calendar { background: #f0eaff; color: #6a38ef; }
    .campaign-row-icon.tag { background: #e9f2ff; color: #0866ed; }

    .campaign-badge {
      min-height: 23px;
      padding: 4px 8px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 1px solid transparent;
      border-radius: 6px;
      font-size: 10.5px;
      font-weight: 700;
      white-space: nowrap;
    }

    .campaign-badge.automatic { background: #f0eaff; color: #6636de; }
    .campaign-badge.single { background: #eaf3ff; color: #0866ed; }
    .campaign-badge.whatsapp { border-color: #b9e9c9; background: #e8f8ed; color: #07883e; }
    .campaign-badge.email { border-color: #ffd7ae; background: #fff4e8; color: #d56c05; }
    .campaign-badge.both { border-color: #c9d9ec; background: #f4f7fb; color: #45546e; }
    .campaign-badge.active { background: #e3f7e9; color: #07853c; }
    .campaign-badge.scheduled { background: #e8f2ff; color: #0866ed; }
    .campaign-badge.paused { background: #fff0df; color: #d96b05; }
    .campaign-badge.draft { background: #eef1f5; color: #53617a; }
    .campaign-badge.rejected { background: #fee2e2; color: #b42318; }

    .campaign-list-footer {
      min-height: 66px;
      padding: 0 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-top: 1px solid #edf0f5;
      color: #66748d;
      font-size: 14px;
      font-weight: 600;
    }

    .campaign-pagination {
      display: flex;
      align-items: center;
      gap: 9px;
    }

    .campaign-pagination button {
      width: 38px;
      height: 38px;
      border: 1px solid #dfe5ef;
      border-radius: 6px;
      background: #fff;
      color: #42516e;
      font-size: 14px;
      font-weight: 750;
    }

    .campaign-pagination button.active {
      border-color: #0866ed;
      background: #0866ed;
      color: #fff;
    }

    .campaign-detail-panel {
      padding: 15px;
    }

    .campaign-detail-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-items: flex-start;
      gap: 10px;
    }

    .campaign-detail-heading {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .campaign-detail-icon {
      width: 44px;
      height: 44px;
      background: #e4f8ec;
      color: #05a84f;
      font-size: 20px;
    }

    .campaign-detail-heading h3 {
      margin: 0 0 5px;
      color: #111c36;
      font-size: 20px;
      line-height: 1.2;
    }

    .campaign-detail-badges,
    .campaign-detail-actions {
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .campaign-detail-actions {
      flex-wrap: wrap;
      justify-content: flex-end;
      width: 100%;
      max-width: none;
      padding-left: 56px;
    }

    .campaign-outline-button {
      border-color: #0866ed;
      color: #0866ed;
    }

    .campaign-outline-button.danger {
      border-color: #fecaca;
      color: #dc2626;
      background: #fff7f7;
    }

    .campaign-duplicate-button {
      height: 35px;
      padding: 0 13px;
      border: 0;
      border-radius: 7px;
      background: #0866ed;
      color: #fff;
      font-size: 12px;
      font-weight: 750;
    }

    .campaign-more-button {
      width: 35px;
      height: 35px;
      border: 1px solid #dce3ed;
      border-radius: 7px;
      background: #fff;
      color: #34435f;
      font-weight: 900;
    }

    .campaign-detail-stats {
      min-height: 76px;
      margin-top: 15px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      border: 1px solid #e1e6ef;
      border-radius: 8px;
    }

    .campaign-detail-stat {
      align-self: center;
      text-align: center;
      border-right: 1px solid #e8ecf3;
    }

    .campaign-detail-stat:last-child { border-right: 0; }
    .campaign-detail-stat strong { display: block; margin-bottom: 3px; color: #17213a; font-size: 20px; }
    .campaign-detail-stat span { color: #67758d; font-size: 13px; }

    .campaign-detail-tabs {
      height: 54px;
      margin-top: 8px;
      display: flex;
      align-items: flex-end;
      gap: 28px;
      border-bottom: 1px solid #dfe5ef;
    }

    .campaign-detail-tabs button {
      height: 44px;
      padding: 0 2px;
      border: 0;
      border-bottom: 3px solid transparent;
      background: transparent;
      color: #50607b;
      font-size: 14px;
    }

    .campaign-detail-tabs button.active {
      border-color: #0866ed;
      color: #0866ed;
      font-weight: 750;
    }

    .campaign-message-label {
      margin: 13px 0 8px;
      color: #26324a;
      font-size: 14px;
      font-weight: 750;
    }

    .campaign-message-preview {
      display: flex;
      align-items: flex-start;
      gap: 9px;
    }

    .campaign-message-icon {
      width: 38px;
      height: 38px;
      background: #e6f8ec;
      color: #09a84e;
      font-size: 16px;
    }

    .campaign-message-bubble {
      max-width: 370px;
      padding: 13px 15px 10px;
      border: 1px solid #bfe8c9;
      border-radius: 9px;
      background: #e8f8e9;
      color: #17223a;
      font-size: 14px;
      line-height: 1.5;
    }

    .campaign-message-bubble time {
      display: block;
      margin-top: 4px;
      color: #6b7b73;
      text-align: right;
      font-size: 12px;
    }

    .campaign-detail-lower {
      margin-top: 13px;
      display: grid;
      grid-template-columns: 1fr 1.08fr;
      gap: 12px;
    }

    .campaign-result-card,
    .campaign-budget-card {
      min-height: 178px;
      padding: 13px;
      border: 1px solid #e1e6ef;
      border-radius: 8px;
      background: #fff;
    }

    .campaign-result-card h4,
    .campaign-budget-card h4 {
      margin: 0 0 13px;
      color: #1c2840;
      font-size: 15px;
    }

    .campaign-result-list,
    .campaign-budget-list {
      display: grid;
      gap: 11px;
    }

    .campaign-result-item,
    .campaign-budget-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: #53617a;
      font-size: 14px;
      line-height: 1.35;
    }

    .campaign-result-item strong,
    .campaign-budget-item strong {
      color: #17223b;
    }

    .campaign-budget-track {
      height: 7px;
      margin: 11px 0 8px;
      overflow: hidden;
      border-radius: 999px;
      background: #e9edf3;
    }

    .campaign-budget-track span {
      width: 75%;
      height: 100%;
      display: block;
      border-radius: inherit;
      background: #0866ed;
    }

    .campaign-budget-link {
      border: 0;
      padding: 0;
      background: transparent;
      color: #0866ed;
      font-size: 12px;
      font-weight: 700;
    }

    .campaign-rule-note {
      min-height: 44px;
      margin-top: 12px;
      padding: 8px 11px;
      display: flex;
      align-items: center;
      border: 1px solid #e2e7ef;
      border-radius: 7px;
      background: #f8fafc;
      color: #61708a;
      font-size: 13.5px;
      font-weight: 600;
      line-height: 1.4;
    }

    .campaign-recipient-view {
      padding: 18px 0 4px;
    }

    .campaign-recipient-head {
      margin-bottom: 12px;
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 12px;
    }

    .campaign-recipient-head h4,
    .campaign-recipient-head p {
      margin: 0;
    }

    .campaign-recipient-head p {
      margin-top: 4px;
      color: #687790;
      font-size: 13px;
    }

    .campaign-recipient-list {
      max-height: 420px;
      overflow: auto;
      border: 1px solid #e0e6ef;
      border-radius: 10px;
      background: #fff;
    }

    .campaign-recipient-row {
      min-height: 62px;
      padding: 10px 13px;
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr) auto;
      align-items: center;
      gap: 11px;
      border-bottom: 1px solid #edf1f6;
    }

    .campaign-recipient-row:last-child {
      border-bottom: 0;
    }

    .campaign-recipient-avatar {
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: #e7f8ee;
      color: #079447;
      font-size: 13px;
      font-weight: 800;
    }

    .campaign-recipient-copy {
      min-width: 0;
      display: grid;
      gap: 3px;
    }

    .campaign-recipient-copy strong {
      color: #17223b;
      font-size: 14px;
    }

    .campaign-recipient-copy span {
      color: #687790;
      font-size: 12.5px;
    }

    .campaign-recipient-status {
      padding: 5px 8px;
      border-radius: 999px;
      background: #eaf8ef;
      color: #087a3d;
      font-size: 11px;
      font-weight: 750;
    }

    .dialog.campaign-dialog {
      width: min(820px, calc(100vw - 32px));
      height: min(900px, calc(100vh - 48px));
      max-height: calc(100vh - 48px);
      grid-template-rows: auto minmax(0, 1fr);
      border-radius: 16px;
      overflow: hidden;
    }

    .campaign-dialog .dialog-header {
      min-height: 78px;
      padding: 18px 24px;
      align-items: flex-start;
      background: #fff;
    }

    .campaign-dialog .dialog-header h3 {
      font-size: 20px;
      line-height: 1.25;
    }

    .campaign-dialog .dialog-header .hint {
      margin: 5px 0 0;
      font-size: 13px;
      line-height: 1.4;
    }

    .campaign-dialog .dialog-header .icon-button {
      width: 38px;
      height: 38px;
      flex: 0 0 38px;
      font-size: 19px;
    }

    .campaign-form {
      min-height: 0;
      padding: 0;
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto auto;
      gap: 0;
      overflow: hidden;
    }

    .campaign-form-grid {
      min-height: 0;
      padding: 20px 24px 18px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      column-gap: 18px;
      row-gap: 16px;
      align-content: start;
      overflow-y: auto;
      scrollbar-gutter: stable;
    }

    .campaign-form-field {
      display: grid;
      gap: 7px;
    }

    .campaign-form-field[hidden] {
      display: none;
    }

    .campaign-form-field.full {
      grid-column: 1 / -1;
    }

    .campaign-form-field label {
      color: #26344f;
      font-size: 14px;
      font-weight: 750;
    }

    .campaign-form-field input,
    .campaign-form-field select,
    .campaign-form-field textarea {
      width: 100%;
      min-height: 46px;
      padding: 11px 13px;
      border: 1px solid #d7deea;
      border-radius: 8px;
      outline: 0;
      background: #fff;
      color: #17223b;
      font: inherit;
      font-size: 14px;
    }

    .campaign-form-field textarea {
      min-height: 118px;
      resize: vertical;
      line-height: 1.5;
    }

    .money-input-shell {
      min-height: 46px;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      border: 1px solid #d7deea;
      border-radius: 10px;
      background: #fff;
      overflow: hidden;
      transition: .16s ease;
    }

    .money-input-shell:focus-within {
      border-color: #0d63f3;
      box-shadow: 0 0 0 3px rgba(13, 99, 243, .12);
    }

    .money-input-prefix,
    .money-input-currency {
      height: 100%;
      display: grid;
      place-items: center;
      padding: 0 12px;
      color: #64748b;
      background: #f8fafc;
      font-size: 13px;
      font-weight: 800;
    }

    .money-input-currency {
      border-left: 1px solid #edf1f6;
      letter-spacing: .02em;
    }

    .money-input-shell input {
      min-height: 44px;
      border: 0;
      border-radius: 0;
      padding: 11px 12px;
      box-shadow: none;
    }

    .money-input-shell input:focus {
      box-shadow: none;
    }

    .money-preview {
      margin: 0;
      color: #64748b;
      font-size: 12px;
    }

    .money-preview strong {
      color: #17213c;
    }

    .campaign-automation-settings {
      grid-column: 1 / -1;
      padding: 16px;
      display: grid;
      gap: 14px;
      border: 1px solid #dce5f2;
      border-radius: 12px;
      background: #f8fbff;
    }

    .campaign-automation-settings[hidden] {
      display: none;
    }

    .campaign-punctual-settings {
      grid-column: 1 / -1;
      padding: 14px 16px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 190px;
      gap: 16px;
      align-items: end;
      border: 1px solid #dce5f2;
      border-radius: 12px;
      background: #f8fbff;
    }

    .campaign-punctual-settings[hidden] {
      display: none;
    }

    .campaign-punctual-copy {
      display: grid;
      gap: 6px;
      align-self: center;
    }

    .campaign-punctual-copy p {
      margin: 0 0 0 25px;
      color: #61708a;
      font-size: 12.5px;
      line-height: 1.4;
    }

    .campaign-manual-settings {
      grid-column: 1 / -1;
      padding: 14px 16px;
      display: grid;
      gap: 11px;
      border: 1px solid #dce5f2;
      border-radius: 12px;
      background: #f8fbff;
    }

    .campaign-manual-settings[hidden] {
      display: none;
    }

    .campaign-manual-settings h4,
    .campaign-manual-settings p {
      margin: 0;
    }

    .campaign-manual-toolbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
    }

    .campaign-manual-search {
      width: 100%;
      min-height: 42px;
      padding: 9px 12px;
      border: 1px solid #d7deea;
      border-radius: 8px;
      outline: 0;
      background: #fff;
      font: inherit;
      font-size: 13px;
    }

    .campaign-manual-count {
      color: #0866ed;
      font-size: 12.5px;
      font-weight: 750;
      white-space: nowrap;
    }

    .campaign-manual-more {
      min-height: 38px;
      border: 1px solid #cfd9e8;
      border-radius: 8px;
      background: #fff;
      color: #315077;
      font-size: 12.5px;
      font-weight: 700;
    }

    .campaign-manual-settings p {
      margin-top: 3px;
      color: #687790;
      font-size: 12.5px;
    }

    .campaign-manual-list {
      max-height: 275px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      overflow: auto;
    }

    .campaign-manual-option {
      min-width: 0;
      padding: 9px 10px;
      display: grid;
      grid-template-columns: 17px minmax(0, 1fr);
      gap: 8px;
      align-items: center;
      border: 1px solid #dce5ef;
      border-radius: 8px;
      background: #fff;
      cursor: pointer;
    }

    .campaign-manual-option input {
      width: 17px;
      height: 17px;
      margin: 0;
      accent-color: #0866ed;
    }

    .campaign-manual-option span {
      min-width: 0;
      display: grid;
      gap: 2px;
    }

    .campaign-manual-option strong,
    .campaign-manual-option small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .campaign-manual-option strong { font-size: 13px; }
    .campaign-manual-option small { color: #687790; font-size: 11.5px; }

    .campaign-automation-heading h4 {
      margin: 0;
      color: #17223b;
      font-size: 15px;
    }

    .campaign-automation-heading p {
      margin: 4px 0 0;
      color: #61708a;
      font-size: 13px;
      line-height: 1.4;
    }

    .campaign-automation-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .campaign-stop-rules {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 18px;
    }

    .campaign-stop-rules[hidden] {
      display: none;
    }

    .campaign-stop-rule {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #34435f;
      font-size: 13px;
      font-weight: 650;
    }

    .campaign-stop-rule input {
      width: 17px;
      height: 17px;
      margin: 0;
      accent-color: #0866ed;
    }

    .campaign-message-tools {
      display: flex;
      align-items: center;
      gap: 9px;
    }

    .campaign-message-tools[hidden] { display: none; }

    .campaign-message-tool,
    .campaign-image-picker {
      min-height: 38px;
      padding: 0 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      border: 1px solid #d7deea;
      border-radius: 8px;
      background: #fff;
      color: #34435f;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }

    .campaign-message-tool:hover,
    .campaign-image-picker:hover {
      border-color: #9db8e4;
      background: #f7faff;
    }

    .campaign-image-picker input {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      opacity: 0;
      pointer-events: none;
    }

    .campaign-emoji-picker {
      padding: 12px;
      display: grid;
      gap: 10px;
      border: 1px solid #dfe5ef;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 10px 28px rgba(15, 23, 42, .1);
    }

    .campaign-emoji-picker[hidden] {
      display: none;
    }

    .campaign-emoji-search {
      width: 100%;
      min-height: 40px !important;
      padding: 8px 12px !important;
      border: 1px solid #d7deea !important;
      border-radius: 8px !important;
      background: #f8fafc !important;
      font-size: 13px !important;
    }

    .campaign-emoji-categories {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 4px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e7ebf2;
    }

    .campaign-emoji-categories button {
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #697790;
      font-size: 17px;
      cursor: pointer;
    }

    .campaign-emoji-categories button:hover,
    .campaign-emoji-categories button.active {
      background: #eaf2ff;
      color: #0866ed;
    }

    .campaign-emoji-grid {
      max-height: 230px;
      display: grid;
      grid-template-columns: repeat(10, minmax(34px, 1fr));
      gap: 4px;
      overflow-y: auto;
      scrollbar-width: thin;
    }

    .campaign-emoji-grid button {
      min-width: 34px;
      height: 38px;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      font-size: 22px;
      cursor: pointer;
    }

    .campaign-emoji-grid button:hover {
      border-color: #d5e2f5;
      background: #f2f6fc;
      transform: scale(1.08);
    }

    .campaign-emoji-empty {
      grid-column: 1 / -1;
      padding: 28px 12px;
      color: #697790;
      text-align: center;
      font-size: 13px;
    }

    .campaign-image-preview {
      padding: 10px;
      display: flex;
      align-items: center;
      gap: 12px;
      border: 1px solid #dfe5ef;
      border-radius: 10px;
      background: #f8fafc;
    }

    .campaign-image-preview[hidden] {
      display: none;
    }

    .campaign-image-preview img {
      width: 96px;
      height: 64px;
      border-radius: 8px;
      object-fit: cover;
      background: #edf1f6;
    }

    .campaign-image-preview div {
      display: grid;
      gap: 5px;
    }

    .campaign-image-preview strong {
      color: #26344f;
      font-size: 13px;
    }

    .campaign-image-remove {
      width: fit-content;
      border: 0;
      padding: 0;
      background: transparent;
      color: #dc2626;
      font-size: 12px;
      font-weight: 700;
    }

    .campaign-message-media {
      width: calc(100% + 30px);
      max-height: 220px;
      margin: -13px -15px 12px;
      display: block;
      border-radius: 9px 9px 0 0;
      object-fit: cover;
      background: #dbe8df;
    }

    .campaign-form-field input:focus,
    .campaign-form-field select:focus,
    .campaign-form-field textarea:focus {
      border-color: #0866ed;
      box-shadow: 0 0 0 3px rgba(8, 102, 237, .1);
    }

    .campaign-form-help {
      margin: 0;
      color: #687790;
      font-size: 12px;
      line-height: 1.45;
    }

    .campaign-form-feedback {
      min-height: 0;
      margin: 0;
      padding: 10px 24px 0;
      color: #c2410c;
      font-size: 13px;
      font-weight: 650;
    }

    .campaign-form-feedback:empty {
      display: none;
    }

    .campaign-form-feedback.success { color: #15803d; }
    .campaign-form-feedback.error { color: #b42318; }

    .campaign-template-state {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 10px;
    }

    .campaign-template-state small {
      color: #687790;
      line-height: 1.4;
    }

    .campaign-template-status {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 750;
    }

    .campaign-template-status.approved { background: #dcfce7; color: #166534; }
    .campaign-template-status.pending { background: #fef3c7; color: #92400e; }
    .campaign-template-status.rejected { background: #fee2e2; color: #991b1b; }
    .campaign-template-status.neutral { background: #eef2f7; color: #52627a; }

    .campaign-form .dialog-actions {
      position: relative;
      z-index: 4;
      margin: 0;
      padding: 14px 24px 16px;
      border-top: 1px solid #e7ebf2;
      background: #fff;
      box-shadow: 0 -8px 18px rgba(15, 35, 64, .04);
    }

    .campaign-form .dialog-actions button {
      min-width: 126px;
      min-height: 42px;
      font-size: 13px;
    }

    .dialog.campaign-dialog.template-dialog {
      width: min(1120px, calc(100vw - 40px));
      height: min(920px, calc(100vh - 36px));
      max-height: calc(100vh - 36px);
    }

    .template-dialog .dialog-header p {
      margin: 6px 0 0;
      color: #64748b;
      font-size: 13px;
    }

    .template-dialog .campaign-form-body {
      min-width: 0;
      min-height: 0;
      padding: 20px 24px;
      overflow-x: hidden;
      overflow-y: auto;
      scrollbar-gutter: stable;
    }

    .template-dialog .template-builder-grid {
      grid-template-columns: minmax(0, 1.45fr) minmax(310px, .85fr);
    }

    .template-dialog .template-builder-main,
    .template-dialog .template-preview-panel {
      min-width: 0;
    }

    .template-dialog .dialog-actions {
      flex-wrap: wrap;
    }

    .template-dialog .dialog-actions button {
      white-space: nowrap;
    }

    @media (max-width: 980px) {
      .dialog.campaign-dialog.template-dialog {
        width: min(760px, calc(100vw - 28px));
      }

      .template-dialog .template-builder-grid {
        grid-template-columns: 1fr;
      }

      .template-dialog .template-preview-panel {
        position: static;
      }
    }

    .campaign-empty-row td {
      height: 220px;
      color: #687790;
      text-align: center;
      font-size: 14px;
      line-height: 1.5;
    }

    .campaign-detail-empty {
      min-height: 420px;
      display: grid;
      place-items: center;
      padding: 30px;
      color: #687790;
      text-align: center;
      font-size: 14px;
      line-height: 1.5;
    }

    @media (max-width: 1350px) {
      .campaigns-workspace {
        grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
      }

      .campaign-filter-tabs button {
        padding: 0 9px;
      }

      .campaign-detail-actions {
        padding-left: 56px;
      }

      .campaign-table th:nth-child(5),
      .campaign-table td:nth-child(5) {
        display: none;
      }
    }

    @media (max-width: 1080px) {
      .campaign-metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .campaigns-workspace {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 760px) {
      .campaigns-view {
        grid-column: 1;
      }

      .campaigns-shell {
        padding: 18px 14px;
      }

      .campaigns-header,
      .campaigns-header-actions {
        display: grid;
      }

      .campaigns-header-actions,
      .campaigns-search {
        width: 100%;
      }

      .campaign-metrics {
        grid-template-columns: 1fr;
      }

      .campaign-list-toolbar,
      .campaign-filter-tabs {
        align-items: stretch;
        flex-wrap: wrap;
      }

      .campaign-detail-header {
        display: grid;
      }

      .campaign-detail-lower {
        grid-template-columns: 1fr;
      }

      .campaign-form-grid {
        grid-template-columns: 1fr;
      }

      .campaign-automation-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .campaign-punctual-settings {
        grid-template-columns: 1fr;
      }

      .campaign-emoji-grid {
        grid-template-columns: repeat(7, minmax(34px, 1fr));
      }
    }

    @media (max-width: 1180px) {
      .app[data-section="conversations"] {
        grid-template-columns: 220px minmax(270px, 310px) minmax(420px, 1fr);
      }

      .conversation-page-header {
        grid-column: 2 / 4;
      }

      .app[data-section="conversations"] .details {
        display: none;
      }
    }

    @media (max-width: 760px) {
      .campaign-automation-grid {
        grid-template-columns: 1fr;
      }

      .app[data-section="conversations"] {
        display: block;
      }

      .conversation-page-header,
      .app[data-section="conversations"] .workspace-nav {
        display: none;
      }

      .conversation-sidebar,
      .app[data-section="conversations"] .chat,
      .app[data-section="conversations"] .details {
        width: 100%;
        height: 100%;
      }

      .conversation-tabs {
        min-height: 54px;
      }

      .app[data-section="conversations"] .chat-header .mobile-only {
        display: inline-flex !important;
      }

      .app[data-section="conversations"] .composer {
        margin: 0 8px 8px;
      }

    }

    .app[data-section="agenda"] {
      grid-template-columns: 224px minmax(0, 1fr);
    }

    .app[data-section="agenda"] .sidebar,
    .app[data-section="agenda"] .chat,
    .app[data-section="agenda"] .details {
      display: none;
    }

    .agenda-view {
      font-family: "Segoe UI Variable Text", "Segoe UI", Inter, ui-sans-serif, system-ui, sans-serif;
      grid-column: 2;
      min-width: 0;
      min-height: 0;
      display: none;
      grid-template-columns: 208px minmax(0, 1fr);
      gap: 14px;
      padding: 22px 18px 28px;
      background: #f8fbff;
      overflow: hidden;
    }

    .app[data-section="agenda"] .agenda-view {
      display: grid;
    }

    .app[data-section="customers"] {
      grid-template-columns: 224px minmax(0, 1fr);
    }

    .app[data-section="customers"] .sidebar,
    .app[data-section="customers"] .chat,
    .app[data-section="customers"] .details {
      display: none;
    }

    .customers-view {
      grid-column: 2;
      min-width: 0;
      min-height: 0;
      display: none;
      padding: 18px;
      background: #f7f9fc;
      overflow: hidden;
    }

    .app[data-section="customers"] .customers-view {
      display: grid;
    }

    .customers-shell {
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: 14px;
    }

    .customers-header {
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
    }

    .customers-header h2 {
      margin: 0;
      color: #101936;
      font-size: 26px;
      line-height: 1.1;
    }

    .customers-header p {
      margin: 5px 0 0;
      color: #64748b;
      font-size: 13px;
    }

    .customers-header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .customers-search {
      width: min(360px, 36vw);
      height: 42px;
      padding: 0 12px;
      border: 1px solid #dce3ed;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 9px;
      background: #fff;
    }

    .customers-search .ti {
      width: 18px;
      height: 18px;
      color: #64748b;
    }

    .customers-search input {
      min-width: 0;
      width: 100%;
      border: 0;
      outline: 0;
      color: #17213c;
      background: transparent;
      font-size: 13px;
    }

    .customer-new-button {
      height: 42px;
      padding: 0 16px;
    }

    .customer-metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .customer-metric-card {
      min-height: 88px;
      padding: 16px;
      border: 1px solid #e0e6ef;
      border-radius: 10px;
      display: flex;
      align-items: center;
      gap: 13px;
      background: #fff;
    }

    .customer-metric-icon {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #2563eb;
      background: #edf4ff;
    }

    .customer-metric-card:nth-child(2) .customer-metric-icon {
      color: #16835f;
      background: #eaf8f1;
    }

    .customer-metric-card:nth-child(3) .customer-metric-icon {
      color: #c45d12;
      background: #fff4e8;
    }

    .customer-metric-card:nth-child(4) .customer-metric-icon {
      color: #7047cf;
      background: #f2edff;
    }

    .customer-metric-icon .ti {
      width: 21px;
      height: 21px;
    }

    .customer-metric-card strong {
      display: block;
      color: #101936;
      font-size: 25px;
      line-height: 1;
    }

    .customer-metric-card span {
      display: block;
      margin-top: 5px;
      color: #64748b;
      font-size: 12px;
    }

    .customers-workspace {
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(590px, 1.42fr) minmax(410px, 1fr);
      gap: 14px;
    }

    .customer-list-panel,
    .customer-profile-panel {
      min-width: 0;
      min-height: 0;
      border: 1px solid #e0e6ef;
      border-radius: 10px;
      background: #fff;
      overflow: hidden;
    }

    .customer-list-panel {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
    }

    .customer-list-toolbar {
      min-height: 58px;
      padding: 10px 12px;
      border-bottom: 1px solid #edf0f4;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .customer-filter-tabs {
      display: flex;
      gap: 7px;
    }

    .customer-filter-tabs button {
      height: 34px;
      padding: 0 12px;
      border: 1px solid #e1e6ee;
      border-radius: 7px;
      color: #52617a;
      background: #fff;
      font-size: 13px;
      font-weight: 650;
    }

    .customer-filter-tabs button.active {
      border-color: #2563eb;
      color: #1d4ed8;
      background: #f4f8ff;
    }

    .customer-inactive-select {
      width: auto;
      min-width: 190px;
      height: 34px;
      padding: 0 10px;
      border-radius: 7px;
      color: #42516b;
      background: #fff;
      font-size: 12px;
    }

    .customer-table-wrap {
      min-height: 0;
      overflow: auto;
    }

    .customer-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 12px;
    }

    .customer-table th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 13px 11px;
      border-bottom: 1px solid #e8edf4;
      color: #64748b;
      background: #fff;
      text-align: left;
      font-size: 11px;
      font-weight: 750;
    }

    .customer-table th:first-child { width: 28%; }
    .customer-table th:nth-child(2) { width: 15%; }
    .customer-table th:nth-child(3) { width: 17%; }
    .customer-table th:nth-child(4) { width: 14%; }
    .customer-table th:nth-child(5) { width: 15%; }
    .customer-table th:nth-child(6) { width: 11%; }

    .customer-table td {
      padding: 11px;
      border-bottom: 1px solid #edf0f4;
      color: #34425c;
      vertical-align: middle;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .customer-table tbody tr {
      cursor: pointer;
    }

    .customer-table tbody tr:hover {
      background: #f8fbff;
    }

    .customer-table tbody tr.active {
      outline: 1px solid #3b82f6;
      outline-offset: -1px;
      background: #f5f9ff;
    }

    .customer-cell {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 9px;
    }

    .customer-list-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #31527b;
      background: #eaf2ff;
      font-size: 12px;
      font-weight: 800;
      flex-shrink: 0;
    }

    .customer-cell-copy {
      min-width: 0;
    }

    .customer-cell-copy strong,
    .customer-cell-copy span {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .customer-cell-copy strong {
      color: #17213c;
      font-size: 13px;
    }

    .customer-cell-copy span {
      margin-top: 2px;
      color: #718096;
      font-size: 11px;
    }

    .customer-list-avatar.tone-0,
    .customer-profile-avatar.tone-0 { color: #2458a6; background: #e7f0ff; border-color: #bdd2f4; }
    .customer-list-avatar.tone-1,
    .customer-profile-avatar.tone-1 { color: #7440a8; background: #f2e9fb; border-color: #d9c1ef; }
    .customer-list-avatar.tone-2,
    .customer-profile-avatar.tone-2 { color: #18705b; background: #e4f5ef; border-color: #b9dfd2; }
    .customer-list-avatar.tone-3,
    .customer-profile-avatar.tone-3 { color: #9a5318; background: #fff0df; border-color: #f1d0aa; }
    .customer-list-avatar.tone-4,
    .customer-profile-avatar.tone-4 { color: #9a3d62; background: #fbe8f0; border-color: #edbfd2; }
    .customer-list-avatar.tone-5,
    .customer-profile-avatar.tone-5 { color: #426423; background: #edf5df; border-color: #cedfab; }
    .customer-list-avatar.tone-6,
    .customer-profile-avatar.tone-6 { color: #38667a; background: #e6f3f7; border-color: #bfdce5; }
    .customer-list-avatar.tone-7,
    .customer-profile-avatar.tone-7 { color: #6b4d31; background: #f4eadf; border-color: #dfc8ad; }

    .customer-status {
      padding: 4px 7px;
      border-radius: 5px;
      display: inline-flex;
      color: #187a57;
      background: #eaf8f1;
      font-size: 11px;
      font-weight: 750;
    }

    .customer-status.inactive {
      color: #64748b;
      background: #f0f2f5;
    }

    .customer-list-empty {
      padding: 40px 20px;
      color: #64748b;
      text-align: center;
      font-size: 13px;
    }

    .customer-pagination {
      min-height: 50px;
      padding: 8px 12px;
      border-top: 1px solid #edf0f4;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: #64748b;
      font-size: 11px;
    }

    .customer-page-actions {
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .customer-page-actions button {
      width: 32px;
      height: 32px;
      border: 1px solid #dfe5ed;
      border-radius: 6px;
      color: #3b4b66;
      background: #fff;
    }

    .customer-page-actions button:disabled {
      opacity: .4;
      cursor: default;
    }

    .customer-profile-panel {
      overflow: auto;
    }

    .customer-profile-empty {
      min-height: 100%;
      padding: 40px 24px;
      display: grid;
      place-items: center;
      color: #64748b;
      text-align: center;
      font-size: 13px;
    }

    .customer-profile-content {
      padding: 16px;
      display: grid;
      gap: 14px;
    }

    .customer-profile-head {
      display: grid;
      grid-template-columns: 64px minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
    }

    .customer-profile-avatar {
      width: 64px;
      height: 64px;
      border: 1px solid #bcd2f1;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #17213c;
      background: #eaf2ff;
      font-size: 24px;
      font-weight: 800;
    }

    .customer-profile-head h3 {
      margin: 0;
      color: #101936;
      font-size: 20px;
    }

    .customer-profile-head a {
      display: inline-block;
      margin-top: 4px;
      color: #64748b;
      font-size: 12px;
      text-decoration: none;
    }

    .customer-profile-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }

    .customer-profile-contact-row {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 38px;
    }

    .customer-profile-actions a.customer-contact-action,
    .customer-profile-actions button.customer-contact-action {
      appearance: none;
      -webkit-appearance: none;
      box-sizing: border-box;
      width: 38px;
      min-width: 38px;
      max-width: 38px;
      height: 38px;
      min-height: 38px;
      max-height: 38px;
      border: 1px solid #dce5ee;
      border-radius: 9px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #fff;
      text-decoration: none;
      padding: 0;
      margin: 0;
      line-height: 0;
      flex: 0 0 38px;
      overflow: hidden;
      vertical-align: middle;
    }

    .customer-profile-actions .customer-contact-action.whatsapp {
      color: #0d9f5f;
    }

    .customer-profile-actions .customer-contact-action.conversation {
      color: #2563eb;
    }

    .customer-profile-actions button.customer-contact-action:disabled {
      color: #9aa5b5;
      background: #f5f6f8;
      cursor: not-allowed;
    }

    .customer-profile-actions .customer-contact-action .ti {
      display: block;
      width: 22px;
      height: 22px;
      flex: 0 0 22px;
      margin: 0;
      stroke-width: 2.2;
    }

    .customer-profile-actions .primary {
      height: 42px;
      padding: 0 14px;
      font-size: 12px;
    }

    .customer-profile-actions .primary .ti {
      width: 19px;
      height: 19px;
      stroke-width: 2.15;
    }

    .customer-profile-menu {
      position: relative;
    }

    .customer-profile-menu summary {
      width: 38px;
      height: 42px;
      border: 1px solid #dce5ee;
      border-radius: 7px;
      display: grid;
      place-items: center;
      color: #52617a;
      background: #fff;
      cursor: pointer;
      list-style: none;
      box-sizing: border-box;
    }

    .customer-profile-menu summary::-webkit-details-marker {
      display: none;
    }

    .customer-profile-menu summary .ti {
      width: 20px;
      height: 20px;
    }

    .customer-profile-menu-popover {
      position: absolute;
      z-index: 5;
      top: calc(100% + 7px);
      right: 0;
      width: 178px;
      padding: 6px;
      border: 1px solid #dce3ed;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 12px 28px rgba(15, 23, 42, .14);
    }

    .customer-profile-menu-popover button {
      width: 100%;
      min-height: 36px;
      padding: 0 9px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #c62828;
      background: transparent;
      font-size: 12px;
      font-weight: 700;
      text-align: left;
    }

    .customer-profile-menu-popover button:hover {
      background: #fff1f1;
    }

    .customer-profile-stats {
      padding: 12px 4px;
      border: 1px solid #e4e9f0;
      border-radius: 8px;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .customer-profile-stat {
      padding: 0 8px;
      border-right: 1px solid #e4e9f0;
      text-align: center;
    }

    .customer-profile-stat:last-child {
      border-right: 0;
    }

    .customer-profile-stat strong,
    .customer-profile-stat span {
      display: block;
    }

    .customer-profile-stat strong {
      color: #17213c;
      font-size: 15px;
    }

    .customer-profile-stat span {
      margin-top: 3px;
      color: #64748b;
      font-size: 10px;
    }

    .customer-next-card {
      min-height: 68px;
      padding: 12px 14px;
      border: 1px solid #bcd4fa;
      border-radius: 7px;
      display: flex;
      align-items: center;
      gap: 12px;
      color: #263958;
      background: #f7faff;
      font-size: 12px;
    }

    .customer-next-card .customer-next-icon {
      width: 40px;
      height: 40px;
      border-radius: 9px;
      display: grid;
      place-items: center;
      color: #fff;
      background: #2563eb;
      flex-shrink: 0;
    }

    .customer-next-card .customer-next-icon .ti {
      width: 21px;
      height: 21px;
      color: #fff;
      stroke-width: 2.15;
    }

    .customer-next-card span,
    .customer-next-card strong,
    .customer-next-card small {
      display: block;
    }

    .customer-next-card span {
      color: #64748b;
      font-size: 11px;
    }

    .customer-next-card strong {
      margin-top: 4px;
      color: #17213c;
      font-size: 14px;
      line-height: 1.35;
    }

    .customer-next-card small {
      margin-top: 3px;
      color: #52617a;
      font-size: 11px;
    }

    .customer-frequent-grid {
      border: 1px solid #e4e9f0;
      border-radius: 7px;
      display: grid;
      grid-template-columns: 1fr 1fr;
    }

    .customer-frequent-item {
      padding: 12px 14px;
      border-right: 1px solid #e4e9f0;
    }

    .customer-frequent-item:last-child {
      border-right: 0;
    }

    .customer-frequent-item span,
    .customer-frequent-item strong,
    .customer-frequent-item small {
      display: block;
    }

    .customer-frequent-item span {
      color: #52617a;
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 11px;
      font-weight: 750;
    }

    .customer-frequent-item strong {
      margin-top: 4px;
      color: #17213c;
      font-size: 14px;
    }

    .customer-frequent-item small {
      margin-top: 3px;
      color: #8490a3;
      font-size: 10px;
    }

    .customer-frequent-item .ti,
    .customer-section-title .ti {
      width: 17px;
      height: 17px;
      color: #2563eb;
      stroke-width: 2.1;
    }

    .customer-profile-section h4 {
      margin: 0 0 7px;
      color: #17213c;
      font-size: 14px;
    }

    .customer-section-title {
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

    .customer-open-conversation {
      width: 100%;
      min-height: 38px;
      padding: 8px 10px;
      border: 1px solid #8fb9fa;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: #1d4ed8;
      background: #f4f8ff;
      font-size: 12px;
      text-align: left;
    }

    .customer-open-conversation strong {
      font-size: 12px;
    }

    .customer-history,
    .customer-profile-notes {
      border: 1px solid #e4e9f0;
      border-radius: 7px;
      overflow: hidden;
    }

    .customer-history-row {
      min-height: 48px;
      padding: 9px 11px;
      border-bottom: 1px solid #edf0f4;
      display: grid;
      grid-template-columns: 24px 96px minmax(0, 1fr) minmax(0, .8fr) auto;
      gap: 9px;
      align-items: center;
      color: #52617a;
      font-size: 11px;
    }

    .customer-history-icon {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      display: grid;
      place-items: center;
      color: #2563eb;
      background: #edf4ff;
    }

    .customer-history-icon .ti {
      width: 14px;
      height: 14px;
    }

    .customer-history-row:last-child,
    .customer-profile-note:last-child {
      border-bottom: 0;
    }

    .customer-history-row strong {
      color: #34425c;
      font-weight: 650;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .customer-history-price {
      color: #52617a;
      text-align: right;
      white-space: nowrap;
    }

    .customer-profile-note {
      padding: 11px 12px;
      border-bottom: 1px solid #edf0f4;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      color: #52617a;
      font-size: 11px;
    }

    .customer-profile-note time {
      color: #8490a3;
      white-space: nowrap;
    }

    @media (max-width: 1280px) {
      .customers-workspace {
        grid-template-columns: minmax(560px, 1.45fr) minmax(340px, 1fr);
      }

      .customer-table th:nth-child(4),
      .customer-table td:nth-child(4) {
        display: none;
      }
    }

    .app[data-section="services"],
    .app[data-section="professionals"],
    .app[data-section="reports"],
    .app[data-section="settings"] {
      grid-template-columns: 224px minmax(0, 1fr);
    }

    .app[data-section="services"] .sidebar,
    .app[data-section="services"] .chat,
    .app[data-section="services"] .details,
    .app[data-section="professionals"] .sidebar,
    .app[data-section="professionals"] .chat,
    .app[data-section="professionals"] .details,
    .app[data-section="reports"] .sidebar,
    .app[data-section="reports"] .chat,
    .app[data-section="reports"] .details,
    .app[data-section="settings"] .sidebar,
    .app[data-section="settings"] .chat,
    .app[data-section="settings"] .details {
      display: none;
    }

    .services-view,
    .professionals-view,
    .reports-view,
    .settings-view {
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
      display: grid;
    }

    .app[data-section="reports"] .reports-view {
      display: block;
    }

    .app[data-section="settings"] .settings-view {
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

    .reports-shell {
      width: 100%;
      max-width: none;
      padding: 20px;
      border-radius: 12px;
      background: #f7f6f1;
      gap: 16px;
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

    .app[data-section="services"] {
      background: #f8fbff;
    }

    .services-view {
      padding: 0;
      background: #f8fbff;
    }

    .services-shell {
      width: 100%;
      max-width: 1120px;
      margin: 0 auto;
      padding: 28px 28px 34px;
      display: grid;
      gap: 22px;
    }

    .services-header {
      min-height: 66px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
    }

    .services-title-group {
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 0;
    }

    .services-title-icon,
    .service-count-icon,
    .service-item-icon,
    .service-tip-icon {
      display: grid;
      place-items: center;
      color: #2563eb;
      background: #eef3ff;
    }

    .services-title-icon {
      width: 52px;
      height: 52px;
      border-radius: 12px;
      flex-shrink: 0;
    }

    .services-header h2 {
      margin: 0;
      color: #081235;
      font-size: 28px;
      line-height: 1.1;
      font-weight: 850;
    }

    .services-header p {
      margin: 8px 0 0;
      color: #52617f;
      font-size: 14px;
      line-height: 1.35;
    }

    .service-count-card {
      min-width: 172px;
      min-height: 62px;
      padding: 12px 18px;
      border: 1px solid #dfe6f1;
      border-radius: 11px;
      display: flex;
      align-items: center;
      gap: 13px;
      background: #fff;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.035);
    }

    .service-count-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      flex-shrink: 0;
    }

    .service-count-card strong {
      display: block;
      color: #071033;
      font-size: 18px;
      line-height: 1;
      font-weight: 850;
    }

    .service-count-card span {
      display: block;
      margin-top: 5px;
      color: #52617f;
      font-size: 12px;
      font-weight: 700;
    }

    .services-manager {
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      display: grid;
      grid-template-columns: minmax(340px, 0.82fr) minmax(420px, 1.18fr);
      gap: 14px;
      align-items: stretch;
    }

    .services-form-panel,
    .services-list-panel {
      min-width: 0;
      padding: 22px;
      border: 1px solid #dfe6f1;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 16px 32px rgba(15, 23, 42, 0.035);
    }

    .services-form-panel h3,
    .services-list-panel h3 {
      margin: 0;
      color: #101936;
      font-size: 18px;
      line-height: 1.2;
      font-weight: 850;
    }

    .services-form-panel p,
    .services-list-panel p {
      margin: 9px 0 0;
      color: #52617f;
      font-size: 13px;
      line-height: 1.4;
    }

    .service-form {
      margin-top: 28px;
      display: grid;
      gap: 22px;
    }

    .service-form-group {
      display: grid;
      gap: 9px;
    }

    .service-form-group label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #405176;
      font-size: 12px;
      font-weight: 850;
    }

    .service-form-group label .ti {
      width: 14px;
      height: 14px;
    }

    .service-form .field,
    .service-form select {
      width: 100%;
      height: 44px;
      padding: 0 12px;
      border: 1px solid #dfe6f1;
      border-radius: 7px;
      color: #263958;
      background: #fff;
    }

    .service-form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }

    .service-input-addon {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      border: 1px solid #dfe6f1;
      border-radius: 7px;
      background: #fff;
      overflow: hidden;
    }

    .service-input-addon.prefix {
      grid-template-columns: 42px 1fr;
    }

    .service-input-addon input {
      height: 42px;
      border: 0;
      outline: 0;
      color: #263958;
      background: transparent;
    }

    .service-input-addon input:first-child {
      padding-left: 12px;
    }

    .service-input-addon.prefix input {
      padding-left: 0;
    }

    .service-input-addon .addon {
      min-width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      color: #52617f;
      font-size: 13px;
      font-weight: 800;
    }

    .service-form-help {
      margin-top: -2px;
      color: #52617f;
      font-size: 12px;
      line-height: 1.35;
    }

    .service-actions {
      display: grid;
      grid-template-columns: 0.82fr 1fr;
      gap: 10px;
      margin-top: 12px;
    }

    .service-actions button {
      height: 44px;
      border-radius: 7px;
    }

    .services-list-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 28px;
    }

    .service-search {
      width: min(230px, 42%);
      height: 42px;
      padding: 0 12px;
      border: 1px solid #dfe6f1;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #52617f;
      background: #fff;
      flex-shrink: 0;
    }

    .service-search input {
      width: 100%;
      border: 0;
      outline: 0;
      color: #263958;
      background: transparent;
      font: inherit;
    }

    .service-card-list {
      display: grid;
      gap: 10px;
    }

    .service-card {
      min-height: 86px;
      padding: 16px 14px;
      border: 1px solid #dfe6f1;
      border-radius: 10px;
      display: grid;
      grid-template-columns: 58px 1fr auto;
      gap: 16px;
      align-items: center;
      background: #fff;
    }

    .service-item-icon {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      color: #2563eb;
      background: #eaf0ff;
    }

    .service-card:nth-child(2n) .service-item-icon {
      color: #7c3aed;
      background: #f0e9ff;
    }

    .service-card-title {
      color: #101936;
      font-size: 15px;
      line-height: 1.2;
      font-weight: 850;
    }

    .service-card-meta {
      margin-top: 10px;
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      color: #52617f;
      font-size: 12px;
      font-weight: 750;
    }

    .service-card-meta span {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .service-card-meta .ti {
      width: 14px;
      height: 14px;
    }

    .service-card-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .service-icon-button {
      width: 38px;
      height: 38px;
      border: 1px solid #dfe6f1;
      border-radius: 8px;
      display: grid;
      place-items: center;
      color: #405176;
      background: #fff;
    }

    .service-icon-button.danger {
      color: #ef4444;
      border-color: #fecaca;
      background: #fff;
    }

    .service-icon-button .ti,
    .services-title-icon .ti,
    .service-count-icon .ti,
    .service-item-icon .ti,
    .service-tip-icon .ti {
      width: 22px;
      height: 22px;
    }

    .service-icon-button .ti {
      width: 17px;
      height: 17px;
    }

    .service-tip {
      min-height: 78px;
      padding: 18px;
      border: 1px solid #bfdbfe;
      border-radius: 10px;
      display: flex;
      align-items: center;
      gap: 16px;
      background: #f8fbff;
    }

    .service-tip-icon {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      flex-shrink: 0;
    }

    .service-tip strong {
      display: block;
      color: #2563eb;
      font-size: 14px;
      line-height: 1.2;
      font-weight: 850;
    }

    .service-tip p {
      margin: 6px 0 0;
      color: #52617f;
      font-size: 13px;
      line-height: 1.35;
    }

    .settings-view {
      padding: 0;
      background: #f8fbff;
      overflow: auto;
      height: 100%;
      box-sizing: border-box;
      overscroll-behavior: contain;
    }

    .settings-shell {
      width: min(820px, 100%);
      margin: 0 auto;
      padding: 34px 28px 96px;
      display: grid;
      gap: 22px;
    }

    .settings-header {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .settings-header-icon {
      width: 52px;
      height: 52px;
      border-radius: 12px;
      display: grid;
      place-items: center;
      color: #2563eb;
      background: #eef3ff;
    }

    .settings-header h2 {
      margin: 0;
      color: #081235;
      font-size: 28px;
      font-weight: 700;
    }

    .settings-header p,
    .settings-panel > p {
      margin: 7px 0 0;
      color: #52617f;
      font-size: 14px;
    }

    .settings-panel {
      padding: 24px;
      border: 1px solid #dfe6f1;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 16px 32px rgba(15, 23, 42, 0.035);
    }

    .settings-panel h3 {
      margin: 0;
      color: #101936;
      font-size: 18px;
      font-weight: 700;
    }

    .whatsapp-settings-grid {
      margin-top: 20px;
      display: grid;
      gap: 12px;
    }

    .whatsapp-status-card {
      padding: 16px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      border: 1px solid #dfe6f1;
      border-radius: 8px;
      background: #f8fbff;
    }

    .whatsapp-status-card strong {
      display: block;
      color: #101936;
      font-size: 14px;
    }

    .whatsapp-status-card span {
      display: block;
      margin-top: 4px;
      color: #52617f;
      font-size: 12px;
      line-height: 1.4;
    }

    .whatsapp-status-badge {
      min-width: 118px;
      padding: 8px 10px;
      border-radius: 999px;
      text-align: center;
      color: #92400e;
      background: #fffbeb;
      font-size: 11px;
      font-weight: 800;
    }

    .whatsapp-status-badge.connected {
      color: #166534;
      background: #dcfce7;
    }

    .whatsapp-control-list {
      display: grid;
      gap: 10px;
    }

    .whatsapp-technical-form {
      padding-top: 14px;
      border-top: 1px solid #e5eaf3;
      display: grid;
      gap: 12px;
    }

    .whatsapp-technical-form h4 {
      margin: 0;
      color: #101936;
      font-size: 14px;
    }

    .whatsapp-technical-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .whatsapp-technical-grid .settings-field.full {
      grid-column: 1 / -1;
    }

    .settings-form {
      margin-top: 24px;
      display: grid;
      gap: 20px;
    }

    .settings-field {
      display: grid;
      gap: 8px;
    }

    .settings-field > label,
    .business-hours-title {
      color: #405176;
      font-size: 12px;
      font-weight: 700;
    }

    .settings-field input {
      height: 44px;
    }

    .business-logo-field {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .business-logo-picker {
      width: 76px;
      height: 76px;
      border: 1px dashed #b8c5da;
      border-radius: 10px;
      display: grid;
      place-items: center;
      overflow: hidden;
      color: #2563eb;
      background: #f6f8ff;
      cursor: pointer;
      flex-shrink: 0;
    }

    .business-logo-picker:hover {
      border-color: #2563eb;
      background: #eef3ff;
    }

    .business-logo-picker input,
    .business-logo-picker img {
      display: none;
    }

    .business-logo-picker.has-image img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
    }

    .business-logo-picker.has-image .ti {
      display: none;
    }

    .business-logo-copy {
      display: grid;
      gap: 7px;
    }

    .business-logo-copy strong {
      color: #405176;
      font-size: 12px;
    }

    .business-logo-copy span {
      color: #6b7892;
      font-size: 12px;
    }

    .business-logo-remove {
      width: max-content;
      padding: 0;
      color: #b42318;
      background: transparent;
      font-size: 12px;
      font-weight: 700;
    }

    .business-hours-grid {
      display: grid;
      gap: 12px;
    }

    .business-hours-row {
      min-height: 48px;
      display: grid;
      grid-template-columns: 150px 1fr 18px 1fr;
      gap: 10px;
      align-items: center;
    }

    .business-hours-row label {
      display: flex;
      align-items: center;
      gap: 9px;
      color: #101936;
      font-size: 13px;
      font-weight: 600;
    }

    .business-hours-row input[type="time"] {
      height: 42px;
    }

    .settings-actions {
      display: flex;
      justify-content: flex-end;
    }

    .settings-actions button {
      min-width: 180px;
      height: 44px;
    }

    .settings-actions button:disabled {
      cursor: wait;
      opacity: .72;
    }

    .settings-feedback {
      display: none;
      margin: -4px 0 0;
      padding: 11px 13px;
      border: 1px solid transparent;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.4;
    }

    .settings-feedback.visible {
      display: block;
    }

    .settings-feedback.success {
      color: #166534;
      border-color: #bbf7d0;
      background: #f0fdf4;
    }

    .settings-feedback.error {
      color: #b42318;
      border-color: #fecaca;
      background: #fff1f2;
    }

    .settings-automation-list {
      margin-top: 20px;
      border-top: 1px solid #e5eaf3;
      display: grid;
    }

    .automation-control {
      min-height: 86px;
      padding: 18px 0;
      border-bottom: 1px solid #e5eaf3;
      display: flex;
      align-items: center;
      gap: 18px;
      cursor: pointer;
    }

    .automation-control:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }

    .automation-copy {
      min-width: 0;
      flex: 1;
      display: grid;
      gap: 5px;
    }

    .automation-copy strong {
      color: #101936;
      font-size: 14px;
    }

    .automation-copy span {
      color: #52617f;
      font-size: 12px;
      line-height: 1.45;
    }

    .automation-copy small {
      width: max-content;
      padding: 3px 8px;
      border-radius: 999px;
      color: #166534;
      background: #dcfce7;
      font-size: 10px;
      font-weight: 800;
    }

    .automation-copy small.paused {
      color: #991b1b;
      background: #fee2e2;
    }

    .automation-copy small.basic {
      color: #92400e;
      background: #fef3c7;
    }

    .automation-control input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .automation-switch {
      position: relative;
      width: 44px;
      height: 24px;
      border-radius: 999px;
      background: #cbd5e1;
      transition: background .18s ease;
      flex-shrink: 0;
    }

    .automation-switch::after {
      content: "";
      position: absolute;
      top: 3px;
      left: 3px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 4px rgba(15, 23, 42, .2);
      transition: transform .18s ease;
    }

    .automation-control input:checked + .automation-switch {
      background: #2563eb;
    }

    .automation-control input:checked + .automation-switch::after {
      transform: translateX(20px);
    }

    .automation-control input:focus-visible + .automation-switch {
      box-shadow: 0 0 0 3px #dbeafe;
    }

    .exceptional-option {
      padding: 12px;
      border: 1px solid #fed7aa;
      border-radius: 8px;
      display: grid;
      gap: 5px;
      background: #fff7ed;
    }

    .exceptional-option label {
      display: flex;
      align-items: center;
      gap: 9px;
      color: #9a3412;
      font-size: 13px;
      font-weight: 700;
    }

    .exceptional-option small {
      color: #9a3412;
      font-size: 12px;
      line-height: 1.4;
    }

    .app[data-section="professionals"] {
      background: #f8fbff;
    }

    .professionals-view {
      padding: 0;
      overflow: hidden;
      background: #f8fbff;
    }

    .professionals-shell {
      max-width: none;
      min-height: 100dvh;
      margin: 0;
      display: grid;
      grid-template-columns: minmax(620px, 1fr);
      gap: 0;
    }

    .professionals-view.form-open .professionals-shell {
      grid-template-columns: minmax(620px, 1fr) 430px;
    }

    .professionals-main {
      min-width: 0;
      padding: 36px 28px 34px;
      overflow: auto;
    }

    .professionals-header {
      min-height: 64px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 34px;
    }

    .professionals-title-group {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      min-width: 0;
    }

    .professionals-title-icon,
    .professional-stat-icon,
    .professional-form-photo,
    .add-professional-icon {
      display: grid;
      place-items: center;
      color: #2563eb;
      background: #eef3ff;
    }

    .professionals-title-icon {
      width: 52px;
      height: 52px;
      border-radius: 12px;
      flex-shrink: 0;
    }

    .professionals-header h2 {
      margin: 0;
      color: #081235;
      font-size: 30px;
      line-height: 1.05;
      font-weight: 850;
    }

    .professionals-header p {
      margin: 9px 0 0;
      color: #52617f;
      font-size: 15px;
      line-height: 1.35;
    }

    .professional-new-button {
      height: 44px;
      padding: 0 18px;
      border-radius: 7px;
      box-shadow: 0 10px 24px rgba(37, 99, 235, 0.22);
    }

    .professional-metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }

    .professional-metric-card {
      min-height: 106px;
      padding: 24px 22px;
      border: 1px solid #e1e7f0;
      border-radius: 10px;
      background: #fff;
      display: flex;
      align-items: center;
      gap: 18px;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.03);
    }

    .professional-stat-icon {
      width: 50px;
      height: 50px;
      border-radius: 14px;
      flex-shrink: 0;
    }

    .professional-stat-icon.purple {
      color: #7c3aed;
      background: #f0e9ff;
    }

    .professional-stat-icon.green {
      color: #16a34a;
      background: #e8f8ee;
    }

    .professional-metric-value {
      color: #071033;
      font-size: 30px;
      line-height: 1;
      font-weight: 850;
      white-space: nowrap;
    }

    .professional-metric-label {
      margin-left: 8px;
      color: #263958;
      font-size: 14px;
      font-weight: 700;
      white-space: nowrap;
    }

    .professional-metric-sub {
      margin-top: 7px;
      color: #65728f;
      font-size: 13px;
      line-height: 1.25;
    }

    .professional-metric-up {
      color: #16a34a;
      font-weight: 800;
    }

    .professional-metric-up.negative {
      color: #dc2626;
    }

    .professional-metric-up.muted {
      color: #65728f;
    }

    .professionals-tools {
      display: grid;
      grid-template-columns: minmax(230px, 280px) 1fr auto;
      gap: 20px;
      align-items: center;
      margin: 0 12px 28px;
    }

    .professional-search {
      height: 44px;
      padding: 0 14px;
      border: 1px solid #dfe6f1;
      border-radius: 9px;
      background: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #536381;
    }

    .professional-search input {
      width: 100%;
      border: 0;
      outline: 0;
      color: #17213b;
      background: transparent;
      font: inherit;
    }

    .professional-view-toggle {
      justify-self: end;
      height: 44px;
      padding: 4px;
      border: 1px solid #dfe6f1;
      border-radius: 9px;
      background: #fff;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .professional-view-toggle button,
    .professional-status-filter {
      height: 34px;
      border-radius: 7px;
      color: #27395a;
      background: transparent;
      font-size: 13px;
      font-weight: 750;
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

    .professional-view-toggle button {
      padding: 0 12px;
    }

    .professional-view-toggle button.active {
      color: #2563eb;
      background: #eef3ff;
    }

    .professional-status-filter {
      padding: 0 15px;
      border: 1px solid #dfe6f1;
      background: #fff;
      height: 44px;
    }

    .professionals-manager {
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      display: block;
      box-shadow: none;
    }

    .professionals-list-panel {
      min-width: 0;
    }

    .professional-card-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(220px, 1fr));
      gap: 16px;
    }

    .professional-card {
      min-height: 388px;
      padding: 22px;
      border: 1px solid #e1e7f0;
      border-radius: 12px;
      background: #fff;
      display: grid;
      grid-template-rows: auto 1fr auto;
      gap: 22px;
      box-shadow: 0 14px 30px rgba(15, 23, 42, 0.035);
    }

    .professional-card-top {
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 0;
    }

    .professional-card-avatar {
      position: relative;
      width: 78px;
      height: 78px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #2563eb;
      background: linear-gradient(145deg, #e9efff, #dfe7ff);
      font-size: 34px;
      font-weight: 850;
      flex-shrink: 0;
    }

    .professional-card-avatar.purple {
      color: #7c3aed;
      background: linear-gradient(145deg, #f1eaff, #e4d8ff);
    }

    .professional-card-avatar.green {
      color: #16a34a;
      background: linear-gradient(145deg, #e9faef, #d8f4e2);
    }

    .professional-card-avatar img {
      width: 100%;
      height: 100%;
      border-radius: inherit;
      object-fit: cover;
    }

    .professional-online-dot {
      position: absolute;
      right: 2px;
      bottom: 11px;
      width: 18px;
      height: 18px;
      border: 3px solid #fff;
      border-radius: 50%;
      background: #22c55e;
    }

    .professional-card-name {
      min-width: 0;
      color: #081235;
      font-size: 20px;
      line-height: 1.15;
      font-weight: 850;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .professional-card-status {
      width: fit-content;
      margin-top: 10px;
      padding: 4px 10px;
      border-radius: 999px;
      color: #16a34a;
      background: #dcfce7;
      font-size: 12px;
      font-weight: 800;
    }

    .professional-card-status.inactive {
      color: #b45309;
      background: #fff7ed;
    }

    .professional-card-body {
      display: grid;
      gap: 20px;
      align-content: start;
    }

    .professional-info-row {
      display: grid;
      grid-template-columns: 18px 1fr;
      gap: 14px;
      color: #4b5a78;
    }

    .professional-info-row .ti {
      width: 17px;
      height: 17px;
      color: #46577a;
      margin-top: 2px;
    }

    .professional-info-title {
      color: #33425f;
      font-size: 14px;
      font-weight: 750;
    }

    .professional-info-copy {
      margin-top: 8px;
      color: #52617f;
      font-size: 13px;
      line-height: 1.35;
    }

    .professional-hours-pills {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .professional-hours-pill {
      padding: 4px 8px;
      border-radius: 6px;
      color: #2563eb;
      background: #dbeafe;
      font-size: 11px;
      font-weight: 800;
    }

    .professional-card-actions {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr) 38px;
      gap: 8px;
    }

    .professional-card-actions button {
      height: 38px;
      border: 1px solid #dfe6f1;
      border-radius: 7px;
      color: #14213d;
      background: #fff;
      font-size: 12px;
      font-weight: 800;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
    }

    .professional-card-actions .danger {
      color: #b42318;
      background: #fff;
    }

    .professional-add-card {
      min-height: 240px;
      border: 1px dashed #cbd5e1;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.72);
      display: grid;
      place-items: center;
      text-align: center;
      color: #4b5a78;
    }

    .add-professional-icon {
      width: 52px;
      height: 52px;
      margin: 0 auto 16px;
      border-radius: 50%;
      color: #081235;
      background: #e9edf5;
      font-size: 26px;
    }

    .professional-add-card strong {
      display: block;
      color: #405176;
      font-size: 16px;
      line-height: 1.2;
    }

    .professional-add-card p {
      max-width: 220px;
      margin: 10px auto 0;
      color: #52617f;
      font-size: 13px;
      line-height: 1.45;
    }

    .professionals-form-panel {
      position: relative;
      min-width: 0;
      padding: 72px 32px 34px;
      border: 0;
      border-left: 1px solid #e8edf6;
      border-radius: 0;
      background: #fff;
      box-shadow: -14px 0 34px rgba(15, 23, 42, 0.04);
    }

    .professionals-form-panel[hidden] {
      display: none;
    }

    .professional-panel-close {
      position: absolute;
      top: 26px;
      right: 28px;
      color: #1f2d4a;
      background: transparent;
      font-size: 28px;
      line-height: 1;
    }

    .professionals-form-panel h3 {
      margin: 0;
      color: #081235;
      font-size: 24px;
      line-height: 1.15;
      font-weight: 850;
    }

    .professionals-form-panel p {
      margin: 14px 0 0;
      color: #52617f;
      font-size: 14px;
      line-height: 1.4;
    }

    .professional-form-photo {
      width: 100px;
      height: 100px;
      margin: 28px auto 34px;
      border: 1px solid #dfe6f1;
      border-radius: 50%;
      background: linear-gradient(145deg, #f8fbff, #eef3ff);
      cursor: pointer;
      overflow: hidden;
      position: relative;
    }

    .professional-form-photo input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }

    .professional-form-photo img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: none;
    }

    .professional-form-photo.has-image img {
      display: block;
    }

    .professional-form-photo.has-image .ti {
      display: none;
    }

    .professional-form {
      display: grid;
      gap: 28px;
    }

    .professional-form-group {
      display: grid;
      gap: 12px;
    }

    .professional-form-group label,
    .professional-schedule-title {
      color: #405176;
      font-size: 13px;
      font-weight: 800;
    }

    .professional-form .field,
    .professional-form select {
      height: 44px;
      border-radius: 7px;
      border-color: #dfe6f1;
      color: #263958;
      background: #fff;
    }

    .professional-services-list {
      max-height: 154px;
      padding: 8px;
      border: 1px solid #dfe6f1;
      border-radius: 7px;
      display: grid;
      gap: 6px;
      overflow: auto;
      background: #fff;
    }

    .professional-service-option {
      min-height: 34px;
      padding: 7px 8px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #263958;
      font-size: 13px;
      font-weight: 700;
    }

    .professional-service-option:hover {
      background: #eef3ff;
    }

    .professional-form-help {
      margin: -4px 0 0;
      color: #52617f;
      font-size: 12px;
    }

    .professional-form .schedule-row {
      grid-template-columns: minmax(132px, 1fr) 86px 16px 86px;
      gap: 8px;
      align-items: center;
    }

    .professional-form .schedule-row label {
      font-size: 13px;
      font-weight: 800;
      color: #17213b;
    }

    .professional-form .schedule-row input[type="time"] {
      padding: 0 10px;
    }

    .schedule-separator {
      text-align: center;
      color: #7c8aa5;
    }

    .professional-form .config-actions {
      display: grid;
      grid-template-columns: 1fr 1.25fr;
      gap: 14px;
      margin-top: 18px;
    }

    .professional-form .config-actions button {
      height: 46px;
      border-radius: 7px;
    }

    .professionals-view.list-mode .professional-card-grid {
      grid-template-columns: 1fr;
    }

    .professionals-view.list-mode .professional-card {
      min-height: auto;
      grid-template-columns: minmax(260px, 0.9fr) minmax(280px, 1fr) minmax(220px, auto);
      grid-template-rows: none;
      align-items: center;
    }

    .professionals-view.list-mode .professional-card-body {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    @media (max-width: 1280px) {
      .professionals-view.form-open .professionals-shell {
        grid-template-columns: minmax(520px, 1fr) 380px;
      }

      .professional-card-grid,
      .professional-metrics {
        grid-template-columns: repeat(2, minmax(220px, 1fr));
      }
    }

    @media (max-width: 980px) {
      .professionals-shell {
        grid-template-columns: 1fr;
        overflow: auto;
      }

      .professionals-main {
        overflow: visible;
      }

      .professionals-form-panel {
        border-left: 0;
        border-top: 1px solid #e8edf6;
      }

      .professional-card-grid,
      .professional-metrics,
      .professionals-tools {
        grid-template-columns: 1fr;
      }

      .professional-view-toggle {
        justify-self: stretch;
      }
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
      min-height: auto;
      padding: 0;
      border: 0;
      background: transparent;
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
      flex-wrap: nowrap;
    }

    .reports-actions select {
      width: 160px;
      min-width: 160px;
      background: #fff;
    }

    .reports-actions .reports-refresh-button {
      height: 36px;
      padding: 0 14px;
      border: 1px solid #d7dbe3;
      border-radius: 8px;
      background: #fff;
      color: var(--text);
      font-size: 14px;
      font-weight: 750;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .ti {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .ti.ti-brand {
      fill: currentColor;
      stroke: none;
    }

    .reports-refresh-button .ti {
      width: 16px;
      height: 16px;
    }

    .reports-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .report-metric-section {
      display: grid;
      gap: 12px;
    }

    .section-head {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .section-head .ti {
      width: 17px;
      height: 17px;
      color: var(--muted);
    }

    .report-metric-section h3,
    .section-head h3 {
      margin: 0;
      font-size: 16px;
      line-height: 1.2;
    }

    .report-kpi {
      min-height: 126px;
      padding: 14px;
      border: 1px solid #dfe2e8;
      border-radius: 9px;
      background: #fff;
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

    .report-kpi > div:last-child {
      display: grid;
      gap: 5px;
    }

    .kpi-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .kpi-icon {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #2563eb;
      background: #eff6ff;
    }

    .kpi-icon .ti {
      width: 16px;
      height: 16px;
    }

    .kpi-icon.good {
      color: #166534;
      background: #e8f3dc;
    }

    .kpi-icon.warn {
      color: #991b1b;
      background: #feeceb;
    }

    .kpi-icon.neutral {
      color: #8a5b12;
      background: #fbefd9;
    }

    .kpi-trend {
      color: #166534;
      font-size: 12px;
      font-weight: 850;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }

    .kpi-trend .ti {
      width: 13px;
      height: 13px;
    }

    .kpi-trend.muted {
      color: var(--muted);
      font-weight: 750;
    }

    .reports-panels {
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) minmax(220px, 1fr);
      gap: 12px;
      align-items: stretch;
    }

    .reports-triple {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      align-items: stretch;
    }

    .reports-panel,
    .reports-table-panel {
      padding: 16px;
      border-radius: 10px;
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

    .report-card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .future-agenda-head h3,
    .report-card-head h3 {
      margin: 0;
      font-size: 20px;
      line-height: 1.2;
    }

    .future-agenda-head p,
    .report-card-head p {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
    }

    .future-agenda-head select,
    .report-card-head select {
      width: min(130px, 100%);
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

    .future-total.compact {
      margin-top: 12px;
      margin-bottom: 12px;
      padding: 10px 12px;
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
      font-size: 24px;
      line-height: 1;
    }

    .future-professionals {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
      min-width: 0;
    }

    .future-professional {
      min-width: 0;
      padding: 9px 0;
      border: 0;
      border-bottom: 1px solid #f0f1f5;
      border-radius: 0;
      background: transparent;
      display: grid;
      gap: 6px;
    }

    .future-professional:last-child {
      border-bottom: 0;
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

    .report-share {
      min-width: 92px;
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: flex-end;
    }

    .report-share-track {
      width: 74px;
      height: 5px;
      border-radius: 999px;
      background: #f0f1f5;
      overflow: hidden;
    }

    .report-share-fill {
      height: 100%;
      border-radius: inherit;
      background: #2563eb;
    }

    .professional-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid #f0f1f5;
    }

    .professional-row:last-child {
      border-bottom: 0;
    }

    .professional-avatar {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #2563eb;
      background: #eff6ff;
      font-size: 12px;
      font-weight: 850;
      flex-shrink: 0;
    }

    .professional-name {
      min-width: 0;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }

    .professional-stat {
      text-align: right;
      font-size: 12px;
      color: var(--muted);
    }

    .professional-stat strong {
      display: block;
      color: var(--text);
      font-size: 13px;
    }

    .risk-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid #f0f1f5;
    }

    .risk-row:last-child {
      border-bottom: 0;
    }

    .risk-main {
      min-width: 0;
      flex: 1;
    }

    .risk-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      color: var(--text);
    }

    .risk-meta {
      margin-top: 2px;
      color: var(--muted);
      font-size: 11px;
    }

    .risk-badge {
      padding: 2px 8px;
      border-radius: 999px;
      color: #b45309;
      background: #fffbeb;
      font-size: 11px;
      white-space: nowrap;
    }

    .inactive-badge {
      color: #1d4ed8;
      background: #eff6ff;
    }

    .reactivation-action {
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid #e4e6eb;
      border-radius: 9px;
      color: var(--muted);
      background: #f9f9fb;
      font-size: 12px;
      font-weight: 650;
    }

    .revenue-box {
      margin-top: 14px;
      padding: 16px;
      border: 1px solid #e4e6eb;
      border-radius: 9px;
      background: #f9f9fb;
      display: grid;
      gap: 10px;
    }

    .revenue-box strong {
      display: block;
      color: var(--text);
      font-size: 28px;
      line-height: 1;
    }

    .revenue-box span,
    .revenue-box p {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .revenue-box .secondary {
      width: fit-content;
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

      .reports-triple {
        grid-template-columns: 1fr;
      }

      .future-agenda-summary {
        grid-template-columns: 1fr;
      }
    }

    .agenda-sidebar,
    .agenda-board {
      min-height: 0;
      border: 1px solid #dfe6f1;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 16px 32px rgba(15, 23, 42, 0.035);
    }

    .agenda-sidebar {
      padding: 18px 12px 16px;
      overflow: auto;
    }

    .agenda-sidebar h2,
    .agenda-board h2 {
      margin: 0;
      font-size: 16px;
      line-height: 1.2;
      font-weight: 700;
    }

    .agenda-filters {
      display: grid;
      gap: 16px;
    }

    .agenda-filter {
      display: grid;
      gap: 7px;
    }

    .agenda-filter label {
      color: #405176;
      font-size: 12px;
      font-weight: 600;
    }

    .agenda-filter select,
    #agenda-step {
      height: 38px;
      border-color: #dfe6f1;
      border-radius: 8px;
      color: #101936;
      font-size: 13px;
      font-weight: 600;
      background: #fff;
    }

    .month-card {
      margin-top: 18px;
      padding: 14px 0 0;
      border-top: 1px solid #eef2f7;
    }

    .month-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 12px;
    }

    .month-header strong {
      color: #101936;
      font-size: 13px;
      font-weight: 700;
      text-transform: capitalize;
    }

    .month-header .icon-button,
    .agenda-week-button {
      width: 34px;
      height: 34px;
      border-color: #dfe6f1;
      border-radius: 8px;
      color: #101936;
      background: #fff;
    }

    .month-grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 6px;
    }

    .month-weekday,
    .month-day {
      height: 28px;
      display: grid;
      place-items: center;
      border-radius: 8px;
      font-size: 11px;
    }

    .month-weekday {
      color: #405176;
      font-weight: 600;
    }

    .month-day {
      color: #101936;
      background: transparent;
      font-weight: 500;
    }

    .month-day.outside {
      color: #a4afaa;
    }

    .month-day.has-items {
      color: #2563eb;
    }

    .month-day.selected {
      color: #fff;
      background: #2563eb;
      font-weight: 700;
    }

    .agenda-legend {
      margin-top: 18px;
      padding: 16px 10px 10px;
      border: 1px solid #eef2f7;
      border-radius: 10px;
      display: grid;
      gap: 12px;
      background: #fff;
    }

    .agenda-legend strong {
      color: #101936;
      font-size: 13px;
      font-weight: 700;
    }

    .agenda-legend-item {
      display: flex;
      align-items: center;
      gap: 9px;
      color: #405176;
      font-size: 13px;
      font-weight: 500;
    }

    .agenda-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--agenda-color, #2563eb);
      flex-shrink: 0;
    }

    .agenda-board {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
    }

    .agenda-toolbar {
      min-height: 118px;
      padding: 18px 18px 12px;
      border-bottom: 1px solid #e8edf6;
      display: grid;
      grid-template-columns: auto 1fr auto;
      grid-template-rows: auto auto;
      align-items: center;
      gap: 14px;
    }

    .agenda-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: flex-end;
    }

    .agenda-range {
      text-align: center;
      color: #101936;
      font-size: 18px;
      font-weight: 700;
    }

    .agenda-today-button {
      min-width: 52px;
      height: 34px;
      padding: 0 14px;
      border: 1px solid #dfe6f1;
      border-radius: 8px;
      color: #101936;
      background: #fff;
      font-size: 13px;
      font-weight: 600;
    }

    .agenda-professional-tabs {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 10px;
      overflow-x: auto;
      padding-bottom: 2px;
    }

    .agenda-pro-tab {
      height: 36px;
      padding: 0 14px;
      border: 1px solid #dfe6f1;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      gap: 9px;
      color: #101936;
      background: #fff;
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
    }

    .agenda-pro-tab.active {
      color: #2563eb;
      border-color: #bfdbfe;
      box-shadow: inset 0 -2px 0 #2563eb;
    }

    #agenda-refresh,
    #agenda-new-appointment {
      display: none;
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
      background: #fff;
    }

    .agenda-corner,
    .agenda-day-head,
    .agenda-time,
    .agenda-cell {
      border-right: 1px solid #e8edf6;
      border-bottom: 1px solid #e8edf6;
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
      color: #101936;
      font-weight: 600;
      text-decoration: none;
      font-size: 12px;
    }

    .agenda-day-head.today {
      color: #2563eb;
    }

    .agenda-time {
      position: sticky;
      left: 0;
      z-index: 2;
      height: var(--agenda-row-height, 28px);
      padding-right: 5px;
      display: flex;
      align-items: flex-start;
      justify-content: flex-end;
      background: #fff;
      color: #52617f;
      font-size: 12px;
    }

    .agenda-cell {
      position: relative;
      height: var(--agenda-row-height, 28px);
      background: #fff;
    }

    .agenda-cell.today {
      background: #fff8e2;
    }

    .agenda-cell.closed {
      background:
        repeating-linear-gradient(135deg, rgba(148, 163, 184, 0.12) 0 2px, transparent 2px 7px),
        #f8fafc;
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
      color: #101936;
      background: color-mix(in srgb, var(--agenda-event-color, #2563eb) 16%, #ffffff);
      border-left: 4px solid var(--agenda-event-color, #2563eb);
      box-shadow: none;
      overflow: hidden;
      font-size: 11px;
      line-height: 1.25;
      cursor: grab;
      user-select: none;
    }

    .agenda-event:active {
      cursor: grabbing;
    }

    .agenda-event.dragging {
      opacity: .45;
      cursor: grabbing;
    }

    .agenda-cell.drag-target:not(.closed) {
      background: #eaf2ff;
      box-shadow: inset 0 0 0 2px #2563eb;
    }

    .agenda-cell.drag-invalid {
      background: #fff1f2;
      box-shadow: inset 0 0 0 2px #ef4444;
    }

    .agenda-event.is-overlap {
      padding-inline: 5px;
      border-left-width: 4px;
    }

    .agenda-event.no-show {
      background: #f1f5f9;
      border-left-color: #94a3b8;
    }

    .agenda-event strong {
      display: block;
      font-size: 11px;
      line-height: 1.2;
      font-weight: 700;
    }

    .agenda-event span {
      display: block;
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .agenda-now-line {
      position: absolute;
      left: 54px;
      right: 0;
      z-index: 5;
      height: 1px;
      background: #ef4444;
      pointer-events: none;
    }

    .agenda-now-line::before {
      content: attr(data-time);
      position: absolute;
      left: -47px;
      top: -8px;
      color: #ef4444;
      background: #fff;
      font-size: 12px;
      font-weight: 700;
    }

    .agenda-now-line::after {
      content: "";
      position: absolute;
      left: -3px;
      top: -3px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #ef4444;
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

    .customer-dialog {
      width: min(480px, 100%);
    }

    .customer-dialog-form {
      padding: 20px;
      display: grid;
      gap: 17px;
    }

    .customer-dialog-copy {
      margin: 0;
      color: #64748b;
      font-size: 13px;
      line-height: 1.5;
    }

    .customer-dialog-field {
      display: grid;
      gap: 8px;
    }

    .customer-dialog-field[hidden] {
      display: none;
    }

    .customer-dialog-field label {
      color: #263958;
      font-size: 12px;
      font-weight: 650;
    }

    .customer-dialog-field input,
    .customer-dialog-field textarea {
      width: 100%;
      border: 1px solid #dce4f0;
      border-radius: 8px;
      color: #17213c;
      background: #fff;
      font-size: 13px;
      outline: 0;
    }

    .customer-dialog-field input {
      height: 44px;
      padding: 0 12px;
    }

    .customer-dialog-field textarea {
      min-height: 118px;
      padding: 11px 12px;
      line-height: 1.5;
      resize: vertical;
    }

    .customer-dialog-field input:focus,
    .customer-dialog-field textarea:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, .1);
    }

    .customer-dialog-feedback {
      min-height: 18px;
      margin: -5px 0 0;
      color: #dc2626;
      font-size: 11px;
    }

    .customer-dialog-form .dialog-actions {
      padding-top: 2px;
    }

    .customer-dialog-form .dialog-actions button {
      min-width: 104px;
    }

    .customer-delete-dialog {
      width: min(460px, 100%);
    }

    .customer-delete-body {
      padding: 20px;
      display: grid;
      gap: 16px;
    }

    .customer-delete-hero {
      display: grid;
      grid-template-columns: 44px 1fr;
      gap: 12px;
      align-items: start;
    }

    .customer-delete-icon {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      display: grid;
      place-items: center;
      color: #dc2626;
      background: #fee2e2;
    }

    .customer-delete-icon .ti {
      width: 22px;
      height: 22px;
      stroke-width: 2.25;
    }

    .customer-delete-hero strong {
      display: block;
      color: #101936;
      font-size: 16px;
      line-height: 1.3;
    }

    .customer-delete-hero p {
      margin: 5px 0 0;
      color: #64748b;
      font-size: 13px;
      line-height: 1.5;
    }

    .customer-delete-warning {
      padding: 12px 13px;
      border: 1px solid #fecaca;
      border-radius: 10px;
      color: #7f1d1d;
      background: #fff7f7;
      font-size: 13px;
      line-height: 1.45;
    }

    .customer-delete-warning strong {
      display: block;
      margin-bottom: 6px;
      color: #991b1b;
    }

    .customer-delete-warning ul {
      margin: 0;
      padding-left: 18px;
    }

    .customer-delete-warning small {
      display: block;
      margin-top: 8px;
      color: #64748b;
    }

    .campaign-activation-summary {
      display: grid;
      gap: 12px;
      padding: 0;
      border: 0;
      color: #17213c;
      background: transparent;
    }

    .campaign-activation-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .campaign-activation-card {
      padding: 12px;
      border: 1px solid #e0e7f2;
      border-radius: 13px;
      background: #fff;
    }

    .campaign-activation-card span {
      display: block;
      margin-bottom: 5px;
      color: #64748b;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .03em;
    }

    .campaign-activation-card strong {
      margin: 0;
      color: #111b34;
      font-size: 16px;
    }

    .campaign-activation-cost {
      border-color: #bfdbfe;
      background: linear-gradient(135deg, #eff6ff, #fff);
    }

    .campaign-activation-cost strong {
      color: #0d63f3;
      font-size: 22px;
    }

    .campaign-activation-card small {
      display: block;
      margin-top: 5px;
      color: #64748b;
      font-size: 11px;
      line-height: 1.35;
    }

    .campaign-activation-preview {
      padding: 14px;
      border: 1px solid #e6dccb;
      border-radius: 14px;
      background: #efe9df;
    }

    .campaign-activation-preview strong {
      margin-bottom: 10px;
      color: #17213c;
    }

    .campaign-activation-bubble {
      padding: 12px 14px;
      border-radius: 11px 11px 4px 11px;
      background: #dcf8c6;
      color: #17301d;
      font-size: 13px;
      line-height: 1.45;
      white-space: pre-wrap;
      box-shadow: 0 1px 4px rgba(15,23,42,.08);
    }

    .campaign-activation-note {
      padding: 11px 13px;
      border: 1px solid #fde68a;
      border-radius: 12px;
      background: #fffbeb;
      color: #92400e;
      font-size: 12px;
      line-height: 1.45;
    }

    #campaign-activation-dialog {
      align-items: flex-start;
      padding-top: 28px;
      overflow: auto;
    }

    #campaign-activation-dialog .dialog {
      width: min(640px, calc(100vw - 36px));
      max-height: calc(100vh - 56px);
      overflow: auto;
    }

    #campaign-activation-dialog .dialog-actions {
      position: sticky;
      bottom: 0;
      margin: 0 -20px -20px;
      padding: 14px 20px;
      border-top: 1px solid #eef2f7;
      background: rgba(255,255,255,.96);
      backdrop-filter: blur(8px);
    }

    .customer-delete-feedback {
      min-height: 18px;
      margin: -6px 0 0;
      color: #dc2626;
      font-size: 12px;
    }

    .customer-delete-dialog .dialog-actions button {
      min-width: 122px;
    }

    .customer-marketing-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    .customer-marketing-actions button {
      min-height: 38px;
      white-space: nowrap;
    }

    .marketing-confirm-dialog .customer-delete-icon {
      background: #e8f1ff;
      color: #0866ed;
    }

    .marketing-confirm-dialog .customer-delete-warning {
      border-color: #cfe0fb;
      background: #f4f8ff;
      color: #334765;
    }

    .customer-delete-confirm {
      color: #fff;
      background: #dc2626;
    }

    .customer-delete-confirm:hover {
      background: #b91c1c;
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
      .template-dialog { width: calc(100vw - 20px); }
      .template-builder-grid,
      .template-meta-grid,
      .template-type-grid,
      .template-variable-row { grid-template-columns: 1fr; }
      .template-preview-panel { position: static; }

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

  <main class="app" id="app-shell" data-section="conversations">
    <div class="crm-toast" id="crm-toast" role="status" aria-live="polite"></div>
    <nav class="workspace-nav" aria-label="Secciones CRM">
      <div class="crm-brand">
        <div class="brand-mark">S</div>
        <div>
          <strong>CRM Salon AI</strong>
          <span>Atencion y reservas</span>
        </div>
      </div>
      <button class="active" type="button" data-nav-section="conversations"><span>💬</span><strong>Conversaciones</strong></button>
      <button type="button" data-nav-section="agenda"><span>📅</span><strong>Agenda</strong></button>
      <button type="button" data-nav-section="customers"><span>👥</span><strong>Clientes</strong></button>
      <button type="button" data-nav-section="professionals"><span>PR</span><strong>Profesionales</strong></button>
      <button type="button" data-nav-section="services"><span>✂</span><strong>Servicios</strong></button>
      <button type="button" data-nav-section="campaigns" data-marketing-nav="templates"><span>📣</span><strong>Marketing</strong></button>
      <div class="nav-subitems" aria-label="Marketing">
        <button type="button" data-nav-section="campaigns" data-marketing-nav="templates">Plantillas</button>
        <button type="button" data-nav-section="campaigns" data-marketing-nav="campaigns">Campañas</button>
      </div>
      <button type="button" data-nav-section="reports"><span>📊</span><strong>Reportes</strong></button>
      <button type="button" data-nav-section="settings"><span>⚙</span><strong>Ajustes</strong></button>
      <div class="nav-user">
        <div class="mini-avatar">C</div>
        <div class="nav-user-status"><span class="nav-online-dot"></span>Online</div>
      </div>
    </nav>
    <header class="conversation-page-header">
      <div class="conversation-heading">
        <span class="conversation-heading-icon" data-icon="message"></span>
        <div>
          <h1>Conversaciones</h1>
          <p>Gestion&aacute; tus chats y respond&eacute; m&aacute;s r&aacute;pido</p>
        </div>
      </div>
      <div class="conversation-global-search">
        <span data-icon="search"></span>
        <input id="search" type="search" placeholder="Buscar conversaci&oacute;n..." autocomplete="off">
        <button class="icon-button" id="search-button" type="button" title="Buscar" data-icon="search"></button>
      </div>
      <button class="icon-button conversation-refresh" id="refresh" type="button" title="Actualizar" data-icon="refresh"></button>
    </header>

    <aside class="sidebar conversation-sidebar">
      <div class="conversation-tabs" role="tablist" aria-label="Filtros de conversaciones">
        <button class="active" id="conversation-tab-all" type="button" data-conversation-filter="all">
          Todos <span id="conversation-count">0</span>
        </button>
        <button id="conversation-tab-unread" type="button" data-conversation-filter="unread">
          No le&iacute;dos <span id="conversation-unread-count">0</span>
        </button>
        <button id="conversation-tab-handoff" type="button" data-conversation-filter="handoff">
          Derivados <span id="handoff-count">0</span>
        </button>
        <button id="conversation-tab-archived" type="button" data-conversation-filter="archived">
          Archivados <span id="conversation-archived-count">0</span>
        </button>
      </div>
      <div class="conversation-list" id="conversation-list">
        <div class="empty">Cargando conversaciones...</div>
      </div>
      <button class="conversation-more" id="conversation-more" type="button">Ver m&aacute;s conversaciones <span data-icon="chevron"></span></button>
    </aside>

    <section class="chat">
      <header class="chat-header">
        <div class="chat-title">
          <button class="icon-button mobile-only" id="mobile-back" type="button" title="Volver a chats">&lt;</button>
          <div class="avatar" id="chat-avatar">--</div>
          <div>
            <div class="panel-title chat-contact-name"><span id="chat-phone">Selecciona una conversacion</span><span class="whatsapp-chip">WhatsApp</span></div>
            <div class="hint" id="chat-status">Historial y respuesta manual</div>
          </div>
        </div>
        <div class="chat-actions">
          <span class="chip" id="step-chip">Inicio</span>
          <details class="chat-more-menu">
            <summary class="icon-button" title="Opciones" data-icon="more"></summary>
            <div class="chat-more-popover">
              <button class="secondary" id="resolve-handoff" type="button" disabled hidden>Marcar como resuelto</button>
              <button class="secondary" id="conversation-ai-toggle" type="button" disabled>Atender manualmente</button>
              <button class="secondary" id="archive-conversation" type="button" disabled>Archivar chat</button>
            </div>
          </details>
        </div>
      </header>
      <div class="messages" id="messages">
        <div class="empty">Elegi un chat para ver los mensajes.</div>
      </div>
      <form class="composer" id="reply-form">
        <div class="composer-window-notice" id="composer-window-notice" hidden>
          <span><span data-icon="clock"></span><span id="composer-window-text">La ventana de WhatsApp vencio.</span></span>
          <a id="composer-window-whatsapp" href="#" target="_blank" rel="noopener">Abrir WhatsApp</a>
        </div>
        <textarea id="reply-text" placeholder="Escribir mensaje..." disabled></textarea>
        <div class="composer-tools">
          <button class="composer-icon" type="button" title="Emoji" data-icon="smile"></button>
          <button class="composer-icon" type="button" title="Adjuntar archivo" data-icon="paperclip"></button>
          <button class="primary" id="send-button" type="submit" disabled><span data-icon="send"></span>Enviar</button>
        </div>
      </form>
    </section>

    <aside class="details">
      <div class="topbar">
        <div class="panel-title">Informaci&oacute;n del cliente</div>
        <button class="details-edit" id="customer-edit" type="button">Editar</button>
      </div>

      <div class="details-section customer-summary">
        <div class="customer-summary-main">
          <div class="customer-avatar" id="detail-avatar">--</div>
          <div class="customer-summary-copy">
            <strong id="detail-name">Seleccion&aacute; un cliente</strong>
            <span class="customer-type">Cliente</span>
            <a id="detail-phone" href="#">--</a>
          </div>
          <a class="customer-whatsapp" id="detail-whatsapp" href="#" target="_blank" rel="noopener" title="Abrir en WhatsApp" aria-label="Abrir en WhatsApp" data-icon="whatsapp"></a>
        </div>
        <div class="customer-last-message">
          <span>&Uacute;ltimo mensaje</span>
          <strong id="detail-updated">--</strong>
        </div>
        <div class="customer-bot-status">
          <span>Estado del bot</span>
          <span class="chip" id="detail-step">--</span>
        </div>
        <div class="customer-bot-status">
          <span>Promociones</span>
          <span class="chip" id="detail-marketing-status">--</span>
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
        <button class="details-wide-action" id="view-agenda" type="button"><span data-icon="calendar"></span>Ver en agenda</button>
      </div>

      <div class="details-section customer-notes">
        <div class="row">
          <div class="panel-title">Notas del cliente</div>
          <button class="details-link" id="customer-add-note" type="button">+ Agregar nota</button>
        </div>
        <div class="customer-note-empty" id="customer-notes-list">Todav&iacute;a no hay notas para este cliente.</div>
      </div>

      <div class="details-section quick-actions">
        <div class="panel-title">Acciones r&aacute;pidas</div>
        <div class="quick-actions-grid">
          <button id="quick-schedule" type="button"><span data-icon="calendar"></span>Agendar turno</button>
          <button id="quick-change" type="button"><span data-icon="refresh"></span>Cambiar turno</button>
          <button id="quick-reminder" type="button"><span data-icon="bell"></span>Enviar recordatorio</button>
          <button id="quick-history" type="button"><span data-icon="document"></span>Ver historial</button>
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

    <section class="customers-view" id="customers-view">
      <div class="customers-shell">
        <header class="customers-header">
          <div>
            <h2>Clientes</h2>
            <p>Conoc&eacute;, cuid&aacute; y hac&eacute; volver a cada cliente</p>
          </div>
          <div class="customers-header-actions">
            <label class="customers-search">
              <span data-icon="search"></span>
              <input id="customers-search" type="search" placeholder="Buscar por nombre o tel&eacute;fono" autocomplete="off">
            </label>
            <button class="primary customer-new-button" id="customer-new-button" type="button"><span data-icon="plus"></span>Nuevo cliente</button>
          </div>
        </header>

        <section class="customer-metrics" aria-label="Resumen de clientes">
          <article class="customer-metric-card">
            <div class="customer-metric-icon" data-icon="users"></div>
            <div><strong id="customers-total">0</strong><span>Clientes</span></div>
          </article>
          <article class="customer-metric-card">
            <div class="customer-metric-icon" data-icon="chart"></div>
            <div><strong id="customers-active">0</strong><span>Activos</span></div>
          </article>
          <article class="customer-metric-card">
            <div class="customer-metric-icon" data-icon="user"></div>
            <div><strong id="customers-inactive">0</strong><span>Inactivos</span></div>
          </article>
          <article class="customer-metric-card">
            <div class="customer-metric-icon" data-icon="plus"></div>
            <div><strong id="customers-new">0</strong><span>Nuevos este mes</span></div>
          </article>
        </section>

        <section class="customers-workspace">
          <article class="customer-list-panel">
            <div class="customer-list-toolbar">
              <div class="customer-filter-tabs" id="customer-filter-tabs">
                <button class="active" type="button" data-customer-filter="all">Todos</button>
                <button type="button" data-customer-filter="active">Activos</button>
                <button type="button" data-customer-filter="inactive">Inactivos</button>
                <button type="button" data-customer-filter="new">Nuevos</button>
              </div>
              <select class="customer-inactive-select" id="customer-inactive-days" aria-label="D&iacute;as para considerar un cliente inactivo">
                <option value="30">Inactivo despu&eacute;s de: 30 d&iacute;as</option>
                <option value="45">Inactivo despu&eacute;s de: 45 d&iacute;as</option>
                <option value="60" selected>Inactivo despu&eacute;s de: 60 d&iacute;as</option>
                <option value="90">Inactivo despu&eacute;s de: 90 d&iacute;as</option>
              </select>
            </div>
            <div class="customer-table-wrap">
              <table class="customer-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>&Uacute;ltima visita</th>
                    <th>Pr&oacute;ximo turno</th>
                    <th>Frecuencia</th>
                    <th>Gasto estimado <span title="Calculado con los precios actuales">&#9432;</span></th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody id="customer-table-body">
                  <tr><td colspan="6"><div class="customer-list-empty">Cargando clientes...</div></td></tr>
                </tbody>
              </table>
            </div>
            <footer class="customer-pagination">
              <span id="customer-pagination-copy">0 clientes</span>
              <div class="customer-page-actions">
                <button id="customer-page-prev" type="button" aria-label="P&aacute;gina anterior">&lsaquo;</button>
                <strong id="customer-page-number">1</strong>
                <button id="customer-page-next" type="button" aria-label="P&aacute;gina siguiente">&rsaquo;</button>
              </div>
            </footer>
          </article>

          <aside class="customer-profile-panel" id="customer-profile-panel">
            <div class="customer-profile-empty">Eleg&iacute; un cliente para ver su resumen.</div>
          </aside>
        </section>
      </div>
    </section>

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
            <button class="icon-button" id="agenda-month-prev" type="button" title="Mes anterior" data-icon="arrow-left"></button>
            <strong id="agenda-month-title">Mes</strong>
            <button class="icon-button" id="agenda-month-next" type="button" title="Mes siguiente" data-icon="arrow-right"></button>
          </div>
          <div class="month-grid" id="agenda-month-grid"></div>
        </div>

        <div class="agenda-legend" id="agenda-legend"></div>
      </aside>

      <section class="agenda-board">
        <div class="agenda-toolbar">
          <div class="agenda-toolbar-actions">
            <button class="agenda-week-button" id="agenda-prev" type="button" title="Semana anterior" data-icon="arrow-left"></button>
            <button class="agenda-today-button" id="agenda-today" type="button">Hoy</button>
            <button class="agenda-week-button" id="agenda-next" type="button" title="Semana siguiente" data-icon="arrow-right"></button>
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
          <div class="agenda-professional-tabs" id="agenda-professional-tabs"></div>
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
          <div class="exceptional-option">
            <label>
              <input id="appointment-force" type="checkbox">
              Turno excepcional
            </label>
            <small>Permite guardar fuera del horario habitual o superpuesto. Solo afecta este turno y nunca se ofrece desde el bot.</small>
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

    <div class="dialog-backdrop" id="customer-dialog" hidden>
      <section class="dialog customer-dialog" role="dialog" aria-modal="true" aria-labelledby="customer-dialog-title">
        <header class="dialog-header">
          <h3 id="customer-dialog-title">Editar cliente</h3>
          <button class="icon-button" id="customer-dialog-close" type="button" title="Cerrar">X</button>
        </header>
        <form class="customer-dialog-form" id="customer-dialog-form">
          <p class="customer-dialog-copy" id="customer-dialog-copy"></p>
          <div class="customer-dialog-field" id="customer-name-field">
            <label for="customer-dialog-name">Nombre del cliente</label>
            <input id="customer-dialog-name" autocomplete="name" maxlength="120" placeholder="Ej: Carolina">
          </div>
          <div class="customer-dialog-field" id="customer-phone-field" hidden>
            <label for="customer-dialog-phone">Tel&eacute;fono</label>
            <input id="customer-dialog-phone" autocomplete="tel" maxlength="40" placeholder="Ej: +54 9 11 4582-3106">
          </div>
          <div class="customer-dialog-field" id="customer-note-field" hidden>
            <label for="customer-dialog-note">Nota</label>
            <textarea id="customer-dialog-note" maxlength="1000" placeholder="Escribi informacion util para futuras atenciones"></textarea>
          </div>
          <p class="customer-dialog-feedback" id="customer-dialog-feedback"></p>
          <div class="dialog-actions">
            <button class="secondary" id="customer-dialog-cancel" type="button">Cancelar</button>
            <button class="primary" id="customer-dialog-submit" type="submit">Guardar cambios</button>
          </div>
        </form>
      </section>
    </div>

    <div class="dialog-backdrop" id="customer-delete-dialog" hidden>
      <section class="dialog customer-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="customer-delete-title">
        <header class="dialog-header">
          <h3 id="customer-delete-title">Eliminar cliente</h3>
          <button class="icon-button" id="customer-delete-close" type="button" title="Cerrar">X</button>
        </header>
        <div class="customer-delete-body">
          <div class="customer-delete-hero">
            <span class="customer-delete-icon" data-icon="trash"></span>
            <div>
              <strong id="customer-delete-name">Eliminar cliente</strong>
              <p>Esta accion quita al cliente de la base de datos del salon.</p>
            </div>
          </div>
          <div class="customer-delete-warning">
            <strong>Antes de eliminarlo:</strong>
            <ul>
              <li>Se eliminaran sus turnos asociados.</li>
              <li>Se eliminaran las notas guardadas en su perfil.</li>
            </ul>
            <small>La conversacion y sus mensajes se conservan para referencia.</small>
          </div>
          <p class="customer-delete-feedback" id="customer-delete-feedback"></p>
          <div class="dialog-actions">
            <button class="secondary" id="customer-delete-cancel" type="button">Cancelar</button>
            <button class="danger customer-delete-confirm" id="customer-delete-confirm" type="button">Eliminar cliente</button>
          </div>
        </div>
      </section>
    </div>

    <div class="dialog-backdrop" id="marketing-confirm-dialog" hidden>
      <section class="dialog customer-delete-dialog marketing-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="marketing-confirm-title">
        <header class="dialog-header">
          <h3 id="marketing-confirm-title">Preferencias de promociones</h3>
          <button class="icon-button" id="marketing-confirm-close" type="button" title="Cerrar">X</button>
        </header>
        <div class="customer-delete-body">
          <div class="customer-delete-hero">
            <span class="customer-delete-icon" data-icon="mail"></span>
            <div>
              <strong id="marketing-confirm-name">Actualizar promociones</strong>
              <p id="marketing-confirm-copy"></p>
            </div>
          </div>
          <div class="customer-delete-warning" id="marketing-confirm-warning"></div>
          <p class="customer-delete-feedback" id="marketing-confirm-feedback"></p>
          <div class="dialog-actions">
            <button class="secondary" id="marketing-confirm-cancel" type="button">Cancelar</button>
            <button class="primary" id="marketing-confirm-submit" type="button">Confirmar</button>
          </div>
        </div>
      </section>
    </div>

    <section class="professionals-view" id="professionals-view">
      <div class="professionals-shell">
        <section class="professionals-main">
          <header class="professionals-header">
            <div class="professionals-title-group">
              <div class="professionals-title-icon" data-icon="users"></div>
              <div>
                <h2>Profesionales</h2>
                <p>Gestiona tu equipo y sus horarios de disponibilidad.</p>
              </div>
            </div>
            <button class="primary professional-new-button" id="professional-new-button" type="button">
              <span data-icon="plus"></span>
              Nuevo profesional
            </button>
          </header>

          <section class="professional-metrics">
            <article class="professional-metric-card">
              <div class="professional-stat-icon purple" data-icon="user"></div>
              <div>
                <div>
                  <span class="professional-metric-value" id="professional-count">0</span>
                  <span class="professional-metric-label">Profesionales activos</span>
                </div>
                <div class="professional-metric-sub" id="professional-total-copy">De 0 en total</div>
              </div>
            </article>
            <article class="professional-metric-card">
              <div class="professional-stat-icon green" data-icon="calendar"></div>
              <div>
                <div>
                  <span class="professional-metric-value" id="professional-month-count">0</span>
                  <span class="professional-metric-label">Turnos este mes</span>
                </div>
                <div class="professional-metric-sub"><span class="professional-metric-up" id="professional-month-trend">0%</span> vs mes anterior</div>
              </div>
            </article>
            <article class="professional-metric-card">
              <div class="professional-stat-icon" data-icon="users"></div>
              <div>
                <div>
                  <span class="professional-metric-value" id="professional-client-count">0</span>
                  <span class="professional-metric-label">Clientes atendidos</span>
                </div>
                <div class="professional-metric-sub"><span class="professional-metric-up" id="professional-client-trend">0%</span> vs mes anterior</div>
              </div>
            </article>
          </section>

          <div class="professionals-tools">
            <label class="professional-search">
              <input id="professional-search" type="search" placeholder="Buscar profesional...">
              <span data-icon="search"></span>
            </label>
            <div class="professional-view-toggle" aria-label="Vista">
              <button class="active" id="professional-card-view" type="button"><span data-icon="grid"></span>Tarjetas</button>
              <button id="professional-list-view" type="button"><span data-icon="list"></span>Lista</button>
            </div>
            <select class="professional-status-filter" id="professional-status-filter">
              <option value="all">Estado: Todos</option>
              <option value="active">Estado: Activos</option>
              <option value="inactive">Estado: Inactivos</option>
            </select>
          </div>

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
          <div class="professionals-list-panel">
            <div class="config-list" id="professional-list"></div>
          </div>
          </section>
        </section>

        <aside class="professionals-form-panel" id="professional-panel" hidden>
          <button class="professional-panel-close" id="professional-panel-close" type="button" aria-label="Cerrar">x</button>
          <h3 id="professional-form-title">Nuevo profesional</h3>
          <p>Completa los datos del profesional.</p>
          <label class="professional-form-photo" id="professional-photo-picker">
            <img id="professional-photo-preview" alt="">
            <span data-icon="camera"></span>
            <input id="professional-avatar" type="file" accept="image/*">
          </label>
          <form class="professional-form" id="professional-form">
            <input id="professional-id" type="hidden">
            <div class="professional-form-group">
              <label for="professional-name">Nombre del profesional</label>
              <input class="field" id="professional-name" placeholder="Ej: Carolina">
            </div>
            <div class="professional-form-group">
              <label for="professional-services">Servicios que realiza</label>
              <div class="professional-services-list" id="professional-services"></div>
              <div class="professional-form-help">Podes seleccionar multiples servicios</div>
            </div>
            <div class="professional-form-group">
              <div class="professional-schedule-title">Horarios de disponibilidad</div>
              <div class="schedule-row">
                <label><input id="professional-weekdays-enabled" type="checkbox" checked> Lunes a viernes</label>
                <input class="field" id="professional-weekdays-start" type="time" value="09:00">
                <span class="schedule-separator">-</span>
                <input class="field" id="professional-weekdays-end" type="time" value="18:00">
              </div>
              <div class="schedule-row">
                <label><input id="professional-saturday-enabled" type="checkbox"> Sabado</label>
                <input class="field" id="professional-saturday-start" type="time" value="09:00">
                <span class="schedule-separator">-</span>
                <input class="field" id="professional-saturday-end" type="time" value="14:00">
              </div>
              <div class="schedule-row">
                <label><input id="professional-sunday-enabled" type="checkbox"> Domingo</label>
                <input class="field" id="professional-sunday-start" type="time" value="09:00">
                <span class="schedule-separator">-</span>
                <input class="field" id="professional-sunday-end" type="time" value="14:00">
              </div>
            </div>
            <div class="professional-form-group">
              <label for="professional-status">Estado</label>
              <select id="professional-status">
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </div>
            <div class="config-actions">
              <button class="secondary" id="professional-cancel" type="button" hidden>Cancelar</button>
              <button class="primary" id="professional-submit" type="submit">Guardar profesional</button>
            </div>
            <p class="hint" id="professional-feedback"></p>
          </form>
        </aside>
      </div>
    </section>

    <section class="services-view" id="services-view">
      <div class="services-shell">
        <header class="services-header">
          <div class="services-title-group">
            <div class="services-title-icon" data-icon="scissors"></div>
            <div>
              <h2>Servicios</h2>
              <p>Gestion&aacute; los servicios que el bot puede ofrecer al tomar reservas.</p>
            </div>
          </div>
          <div class="service-count-card">
            <div class="service-count-icon" data-icon="copy"></div>
            <div>
              <strong id="service-count">0</strong>
              <span>Servicios activos</span>
            </div>
          </div>
        </header>

        <section class="services-manager">
          <div class="services-form-panel">
            <h3 id="service-form-title">Nuevo servicio</h3>
            <p>Complet&aacute; los datos para agregar un nuevo servicio.</p>
            <form class="service-form" id="service-form">
              <input id="service-id" type="hidden">
              <div class="service-form-group">
                <label for="service-name">Nombre del servicio</label>
                <input class="field" id="service-name" placeholder="Ej: Corte Hombre">
              </div>
              <div class="service-form-grid">
                <div class="service-form-group">
                  <label for="service-duration"><span data-icon="clock"></span>Duraci&oacute;n</label>
                  <div class="service-input-addon">
                    <input id="service-duration" type="number" min="1" step="1" placeholder="Ej: 30">
                    <span class="addon">min</span>
                  </div>
                </div>
                <div class="service-form-group">
                  <label for="service-price"><span data-icon="tag"></span>Precio</label>
                  <div class="service-input-addon prefix">
                    <span class="addon">$</span>
                    <input id="service-price" type="number" min="0" step="1" placeholder="Ej: 15000">
                  </div>
                </div>
              </div>
              <div class="service-form-group">
                <label for="service-category">Categor&iacute;a (opcional)</label>
                <select id="service-category">
                  <option value="">Seleccionar categor&iacute;a</option>
                  <option value="Corte">Corte</option>
                  <option value="Color">Color</option>
                  <option value="Barba">Barba</option>
                  <option value="Manos y pies">Manos y pies</option>
                  <option value="Tratamiento">Tratamiento</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>
              <div class="service-form-group">
                <label for="service-aliases">Alias (opcional)</label>
                <div class="service-form-help">Alias opcionales separados por coma (ej: corte, corte hombre)</div>
                <input class="field" id="service-aliases" placeholder="Ej: corte, corte hombre, haircut">
              </div>
              <div class="service-actions">
                <button class="secondary" id="service-cancel" type="button">Cancelar</button>
                <button class="primary" id="service-submit" type="submit">Guardar servicio</button>
              </div>
              <p class="hint" id="service-feedback"></p>
            </form>
          </div>

          <div class="services-list-panel">
            <div class="services-list-head">
              <div>
                <h3>Servicios cargados</h3>
                <p>Desde ac&aacute; pod&eacute;s editar o eliminar cada servicio.</p>
              </div>
              <label class="service-search" for="service-search">
                <input id="service-search" placeholder="Buscar servicio...">
                <span data-icon="search"></span>
              </label>
            </div>
            <div class="service-card-list" id="service-list"></div>
          </div>
        </section>

        <aside class="service-tip">
          <div class="service-tip-icon" data-icon="lightbulb"></div>
          <div>
            <strong>Consejo</strong>
            <p>Los servicios que crees ac&aacute; estar&aacute;n disponibles para que los clientes puedan reservar desde el bot.</p>
          </div>
        </aside>
      </div>
    </section>

    <section class="campaigns-view" id="campaigns-view">
      <div class="campaigns-shell">
        <header class="campaigns-header">
          <div class="campaigns-title">
            <h2>Campa&ntilde;as</h2>
            <p>Segment&aacute; clientes, envi&aacute; mensajes y gener&aacute; m&aacute;s reservas.</p>
          </div>
          <div class="campaigns-header-actions">
            <label class="campaigns-search">
              <span aria-hidden="true">&#128269;</span>
              <input id="campaign-search" type="search" placeholder="Buscar campa&ntilde;a" aria-label="Buscar campa&ntilde;a">
            </label>
            <button class="campaign-filter-button" id="template-sync-all" type="button" hidden>Actualizar todas</button>
            <button class="campaigns-new" id="campaign-new" type="button"><span class="campaign-new-plus">+</span>Nueva campa&ntilde;a</button>
          </div>
        </header>

        <nav class="campaigns-main-tabs" id="marketing-main-tabs" aria-label="Tipos de comunicaci&oacute;n">
          <button type="button" data-marketing-view="templates">Plantillas de Meta</button>
          <button class="active" type="button" data-marketing-view="campaigns">Campa&ntilde;as</button>
          <button type="button" data-marketing-view="reminders">Recordatorios autom&aacute;ticos</button>
        </nav>

        <div id="campaigns-content">
        <section class="campaign-metrics" aria-label="Resumen de campa&ntilde;as">
          <article class="campaign-metric">
            <div class="campaign-metric-icon green">&#10148;</div>
            <div><strong id="campaign-total">0</strong><span>Campa&ntilde;as totales</span></div>
          </article>
          <article class="campaign-metric">
            <div class="campaign-metric-icon orange">&#128172;</div>
            <div><strong id="campaign-active-count">0</strong><span>Campa&ntilde;as activas</span></div>
          </article>
          <article class="campaign-metric">
            <div class="campaign-metric-icon violet">&#128197;</div>
            <div><strong id="campaign-scheduled-count">0</strong><span>Programadas</span></div>
          </article>
          <article class="campaign-metric">
            <div class="campaign-metric-icon blue">&#9998;</div>
            <div><strong id="campaign-draft-count">0</strong><span>Borradores</span></div>
          </article>
        </section>

        <div class="campaigns-workspace">
          <section class="campaign-list-panel">
            <div class="campaign-list-toolbar">
              <div class="campaign-filter-tabs" id="campaign-filter-tabs">
                <button class="active" type="button" data-campaign-filter="ALL">Todas</button>
                <button type="button" data-campaign-filter="ACTIVE">Activas</button>
                <button type="button" data-campaign-filter="SCHEDULED">Programadas</button>
                <button type="button" data-campaign-filter="DRAFT">Borradores</button>
                <button type="button" data-campaign-filter="FINISHED">Finalizadas</button>
              </div>
              <button class="campaign-filter-button" type="button">&#9661;&nbsp; Filtros &nbsp;&#8964;</button>
            </div>

            <div class="campaign-table-wrap">
              <table class="campaign-table">
                <colgroup>
                  <col style="width:26%"><col style="width:14%"><col style="width:20%"><col style="width:15%"><col style="width:14%"><col style="width:11%">
                </colgroup>
                <thead>
                  <tr><th>Campa&ntilde;a</th><th>Tipo</th><th>Segmento</th><th>Canal</th><th>Pr&oacute;ximo env&iacute;o</th><th>Estado</th></tr>
                </thead>
                <tbody id="campaign-table-body">
                  <tr class="selected">
                    <td><div class="campaign-name-cell"><span class="campaign-row-icon">W</span><span>Recuperaci&oacute;n<br>de clientes</span></div></td>
                    <td><span class="campaign-badge automatic">Autom&aacute;tica</span></td>
                    <td>Sin reserva +90 d&iacute;as</td>
                    <td><span class="campaign-badge whatsapp">&#9679; WhatsApp</span></td>
                    <td>Hoy, 18:00</td>
                    <td><span class="campaign-badge active">Activa</span></td>
                  </tr>
                  <tr>
                    <td><div class="campaign-name-cell"><span class="campaign-row-icon email">&#9993;</span><span>Ofertas de color</span></div></td>
                    <td><span class="campaign-badge single">Puntual</span></td>
                    <td>Interesados en color</td>
                    <td><span class="campaign-badge email">&#9993; Email</span></td>
                    <td>Ma&ntilde;ana, 10:00</td>
                    <td><span class="campaign-badge scheduled">Programada</span></td>
                  </tr>
                  <tr>
                    <td><div class="campaign-name-cell"><span class="campaign-row-icon calendar">&#128197;</span><span>Recordatorio turno</span></div></td>
                    <td><span class="campaign-badge automatic">Autom&aacute;tica</span></td>
                    <td>Turno confirmado</td>
                    <td><span class="campaign-badge whatsapp">&#9679; WhatsApp</span></td>
                    <td>—</td>
                    <td><span class="campaign-badge active">Activa</span></td>
                  </tr>
                  <tr>
                    <td><div class="campaign-name-cell"><span class="campaign-row-icon calendar">&#127874;</span><span>Cumplea&ntilde;os</span></div></td>
                    <td><span class="campaign-badge automatic">Autom&aacute;tica</span></td>
                    <td>Cumplea&ntilde;os del mes</td>
                    <td><span class="campaign-badge both">&#9679; Ambos</span></td>
                    <td>20 Jun, 09:00</td>
                    <td><span class="campaign-badge active">Activa</span></td>
                  </tr>
                  <tr>
                    <td><div class="campaign-name-cell"><span class="campaign-row-icon tag">&#9670;</span><span>Promo balayage</span></div></td>
                    <td><span class="campaign-badge single">Puntual</span></td>
                    <td>Interesadas en balayage</td>
                    <td><span class="campaign-badge both">&#9679; Ambos</span></td>
                    <td>21 Jun, 11:00</td>
                    <td><span class="campaign-badge scheduled">Programada</span></td>
                  </tr>
                  <tr>
                    <td><div class="campaign-name-cell"><span class="campaign-row-icon">W</span><span>Reactivaci&oacute;n 60 d&iacute;as</span></div></td>
                    <td><span class="campaign-badge automatic">Autom&aacute;tica</span></td>
                    <td>Sin visita 60 d&iacute;as</td>
                    <td><span class="campaign-badge whatsapp">&#9679; WhatsApp</span></td>
                    <td>—</td>
                    <td><span class="campaign-badge paused">Pausada</span></td>
                  </tr>
                  <tr>
                    <td><div class="campaign-name-cell"><span class="campaign-row-icon email">&#9993;</span><span>Novedades del sal&oacute;n</span></div></td>
                    <td><span class="campaign-badge single">Puntual</span></td>
                    <td>Todos los clientes</td>
                    <td><span class="campaign-badge email">&#9993; Email</span></td>
                    <td>—</td>
                    <td><span class="campaign-badge draft">Borrador</span></td>
                  </tr>
                  <tr>
                    <td><div class="campaign-name-cell"><span class="campaign-row-icon">W</span><span>Evaluaci&oacute;n de servicio</span></div></td>
                    <td><span class="campaign-badge automatic">Autom&aacute;tica</span></td>
                    <td>Post servicio</td>
                    <td><span class="campaign-badge whatsapp">&#9679; WhatsApp</span></td>
                    <td>—</td>
                    <td><span class="campaign-badge draft">Borrador</span></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <footer class="campaign-list-footer">
              <span id="campaign-pagination-copy">Mostrando 1 a 8 de 8 campa&ntilde;as</span>
              <div class="campaign-pagination"><button id="campaign-page-prev" type="button">&#8249;</button><button class="active" id="campaign-page-number" type="button">1</button><button id="campaign-page-next" type="button">&#8250;</button></div>
              <span>10 por p&aacute;gina &nbsp;&#8964;</span>
            </footer>
          </section>

          <aside class="campaign-detail-panel" id="campaign-detail-panel">
            <header class="campaign-detail-header">
              <div class="campaign-detail-heading">
                <div class="campaign-detail-icon">W</div>
                <div>
                  <h3>Recuperaci&oacute;n de clientes</h3>
                  <div class="campaign-detail-badges">
                    <span class="campaign-badge automatic">Autom&aacute;tica</span>
                    <span class="campaign-badge whatsapp">&#9679; WhatsApp</span>
                    <span class="campaign-badge active">Activa</span>
                  </div>
                </div>
              </div>
              <div class="campaign-detail-actions">
                <button class="campaign-outline-button" type="button">Pausar</button>
                <button class="campaign-duplicate-button" type="button">Duplicar campa&ntilde;a</button>
                <button class="campaign-more-button" type="button">&#8942;</button>
              </div>
            </header>

            <section class="campaign-detail-stats">
              <div class="campaign-detail-stat"><strong>42</strong><span>enviados</span></div>
              <div class="campaign-detail-stat"><strong>11</strong><span>respuestas</span></div>
              <div class="campaign-detail-stat"><strong>5</strong><span>turnos</span></div>
            </section>

            <nav class="campaign-detail-tabs" aria-label="Detalle de campa&ntilde;a">
              <button class="active" type="button">Resumen</button>
              <button type="button">Destinatarios</button>
              <button type="button">Historial</button>
              <button type="button">Configuraci&oacute;n</button>
            </nav>

            <p class="campaign-message-label">Mensaje enviado</p>
            <div class="campaign-message-preview">
              <div class="campaign-message-icon">W</div>
              <div class="campaign-message-bubble">
                Hola, Camila &#128075; Hace un tiempo que no te vemos. Esta semana tenemos un beneficio especial para tu pr&oacute;ximo turno. &iquest;Quer&eacute;s que te muestre los horarios disponibles?
                <time>10:00 &nbsp;&#10003;&#10003;</time>
              </div>
            </div>

            <div class="campaign-detail-lower">
              <section class="campaign-result-card">
                <h4>Resultados</h4>
                <div class="campaign-result-list">
                  <div class="campaign-result-item"><span>&#10148;&nbsp; Entregados</span><strong>40</strong></div>
                  <div class="campaign-result-item"><span>&#9673;&nbsp; Le&iacute;dos</span><strong>18</strong></div>
                  <div class="campaign-result-item"><span>&#128172;&nbsp; Respuestas</span><strong>11</strong></div>
                  <div class="campaign-result-item"><span>&#128197;&nbsp; Turnos agendados</span><strong>5</strong></div>
                  <div class="campaign-result-item"><span>Conversi&oacute;n</span><strong>11,9%</strong></div>
                </div>
              </section>
              <section class="campaign-budget-card">
                <h4>Costos y presupuesto</h4>
                <div class="campaign-budget-list">
                  <div class="campaign-budget-item"><span>Gastado este mes</span><strong>$6.480</strong></div>
                  <div class="campaign-budget-item"><span>Proyecci&oacute;n mensual</span><strong>$18.900</strong></div>
                  <div class="campaign-budget-item"><span>L&iacute;mite mensual</span><strong>$25.000</strong></div>
                </div>
                <div class="campaign-budget-track"><span></span></div>
                <button class="campaign-budget-link" type="button">Editar presupuesto</button>
              </section>
            </div>

            <div class="campaign-rule-note">&#9432;&nbsp; Se activa al cumplir 90 d&iacute;as sin reservas &nbsp;&middot;&nbsp; M&aacute;ximo 1 env&iacute;o cada 60 d&iacute;as</div>
          </aside>
        </div>
        </div>

        <div class="template-manager" id="template-manager" hidden>
          <section class="campaign-metrics" aria-label="Resumen de plantillas">
            <article class="campaign-metric"><div class="campaign-metric-icon green">&#10003;</div><div><strong id="template-approved-count">0</strong><span>Aprobadas</span><small>Listas para usar</small></div></article>
            <article class="campaign-metric"><div class="campaign-metric-icon orange">&#9719;</div><div><strong id="template-pending-count">0</strong><span>Pendientes</span><small>En revisi&oacute;n por Meta</small></div></article>
            <article class="campaign-metric"><div class="campaign-metric-icon violet">&#9998;</div><div><strong id="template-draft-count">0</strong><span>Borradores</span><small>Sin enviar a revisi&oacute;n</small></div></article>
            <article class="campaign-metric"><div class="campaign-metric-icon red">&#10005;</div><div><strong id="template-rejected-count">0</strong><span>Rechazadas</span><small>Necesitan ajustes</small></div></article>
          </section>
          <div class="campaigns-workspace template-workspace">
            <section class="campaign-list-panel">
              <div class="campaign-list-toolbar">
                <div class="campaign-filter-tabs" id="template-filter-tabs">
                  <button class="active" type="button" data-template-filter="ALL">Todas</button>
                  <button type="button" data-template-filter="APPROVED">Aprobadas</button>
                  <button type="button" data-template-filter="PENDING">Pendientes</button>
                  <button type="button" data-template-filter="DRAFT">Borradores</button>
                  <button type="button" data-template-filter="REJECTED">Rechazadas</button>
                </div>
              </div>
              <div class="campaign-table-wrap">
                <table class="campaign-table template-table">
                  <thead><tr><th>Nombre interno</th><th>Nombre en Meta</th><th>Categor&iacute;a</th><th>Idioma</th><th>Estado</th><th>Actualizaci&oacute;n</th></tr></thead>
                  <tbody id="template-table-body"><tr class="campaign-empty-row"><td colspan="6">Todav&iacute;a no hay plantillas.</td></tr></tbody>
                </table>
              </div>
              <footer class="campaign-list-footer"><span id="template-list-copy">0 plantillas</span></footer>
            </section>
            <aside class="campaign-detail-panel template-detail-panel" id="template-detail-panel">
              <div class="campaign-detail-empty"><div><strong>Seleccion&aacute; una plantilla</strong><br>Ac&aacute; vas a ver su estado y contenido.</div></div>
            </aside>
          </div>
        </div>

        <div class="template-manager reminder-manager" id="reminder-manager" hidden>
          <section class="campaign-metrics" aria-label="Resumen de recordatorios">
            <article class="campaign-metric"><div class="campaign-metric-icon green">&#128276;</div><div><strong id="reminder-status-label">Pausado</strong><span>Estado</span><small>Sin env&iacute;os reales todav&iacute;a</small></div></article>
            <article class="campaign-metric"><div class="campaign-metric-icon violet">&#128197;</div><div><strong id="reminder-template-label">Sin plantilla</strong><span>Plantilla</span><small>Debe estar aprobada por Meta</small></div></article>
            <article class="campaign-metric"><div class="campaign-metric-icon orange">&#9200;</div><div><strong id="reminder-time-label">24 hs</strong><span>Anticipaci&oacute;n</span><small>Antes del turno</small></div></article>
          </section>
          <div class="campaigns-workspace template-workspace">
            <section class="campaign-list-panel">
              <div class="campaign-list-toolbar"><div><strong>Recordatorios configurados</strong><p class="hint">Pod&eacute;s tener varios recordatorios por turno. WhatsApp exige plantilla aprobada.</p></div></div>
              <div class="campaign-recipient-list" id="reminder-list"></div>
              <div class="template-builder-card">
                <div class="campaign-form-field full">
                  <label for="reminder-name">Nombre interno</label>
                  <input id="reminder-name" placeholder="Ej: Recordatorio 24 hs antes">
                </div>
                <div class="campaign-form-field full">
                  <label for="reminder-channel">Canal</label>
                  <select id="reminder-channel">
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="EMAIL">Email - pr&oacute;ximamente</option>
                  </select>
                </div>
                <div class="campaign-form-field full">
                  <label for="reminder-template">Plantilla aprobada de Recordatorio</label>
                  <select id="reminder-template"><option value="">Seleccionar plantilla aprobada</option></select>
                  <p class="campaign-form-help">Solo aparecen plantillas aprobadas con tipo Recordatorio.</p>
                </div>
                <div class="campaign-form-field full">
                  <label for="reminder-before">Enviar recordatorio</label>
                  <select id="reminder-before">
                    <option value="60">1 hora antes</option>
                    <option value="120">2 horas antes</option>
                    <option value="1440" selected>24 horas antes</option>
                    <option value="2880">48 horas antes</option>
                  </select>
                </div>
                <label class="automation-control">
                  <div class="automation-copy">
                    <strong>Recordatorios autom&aacute;ticos</strong>
                    <span>Activa la configuraci&oacute;n y proces&aacute; los turnos pendientes cuando quieras enviar.</span>
                    <small id="reminder-enabled-copy">Pausado</small>
                  </div>
                  <input id="reminder-enabled" type="checkbox">
                  <span class="automation-switch" aria-hidden="true"></span>
                </label>
                <p class="campaign-form-feedback" id="reminder-feedback" role="status" aria-live="polite"></p>
                <div class="dialog-actions"><button class="secondary" id="reminder-delete" type="button">Eliminar</button><button class="secondary" id="reminder-process" type="button">Procesar pendientes</button><button class="primary" id="reminder-save" type="button">Guardar recordatorio</button></div>
              </div>
            </section>
            <aside class="campaign-detail-panel template-detail-panel" id="reminder-detail-panel">
              <div class="campaign-detail-empty"><div><strong>Recordatorio autom&aacute;tico</strong><br>Eleg&iacute; una plantilla aprobada para ver la vista previa.</div></div>
            </aside>
          </div>
        </div>
      </div>
    </section>

    <section class="settings-view" id="settings-view">
      <div class="settings-shell">
        <header class="settings-header">
          <div class="settings-header-icon" data-icon="settings"></div>
          <div>
            <h2>Ajustes</h2>
            <p>Datos generales, horarios y automatizaci&oacute;n del local.</p>
          </div>
        </header>

        <section class="settings-panel">
          <h3>Datos del local</h3>
          <p>Estos datos definen la disponibilidad general del negocio.</p>
          <form class="settings-form" id="business-settings-form">
            <div class="business-logo-field">
              <label class="business-logo-picker" id="business-logo-picker" title="Cambiar logo del sal&oacute;n">
                <img id="business-logo-preview" alt="Logo del sal&oacute;n">
                <span data-icon="camera"></span>
                <input id="business-logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
              </label>
              <div class="business-logo-copy">
                <strong>Imagen del sal&oacute;n</strong>
                <span>PNG, JPG, WEBP o GIF. M&aacute;ximo 2 MB.</span>
                <button class="business-logo-remove" id="business-logo-remove" type="button">Quitar imagen</button>
              </div>
            </div>
            <div class="settings-field">
              <label for="business-name">Nombre del local</label>
              <input class="field" id="business-name" placeholder="Ej: CRM Salon AI" required>
            </div>

            <div class="business-hours-grid">
              <div class="business-hours-title">Horarios de atenci&oacute;n</div>
              <div class="business-hours-row">
                <label><input id="business-weekdays-enabled" type="checkbox"> Lunes a viernes</label>
                <input class="field" id="business-weekdays-start" type="time" value="09:00">
                <span>-</span>
                <input class="field" id="business-weekdays-end" type="time" value="19:00">
              </div>
              <div class="business-hours-row">
                <label><input id="business-saturday-enabled" type="checkbox"> S&aacute;bado</label>
                <input class="field" id="business-saturday-start" type="time" value="09:00">
                <span>-</span>
                <input class="field" id="business-saturday-end" type="time" value="14:00">
              </div>
              <div class="business-hours-row">
                <label><input id="business-sunday-enabled" type="checkbox"> Domingo</label>
                <input class="field" id="business-sunday-start" type="time" value="09:00">
                <span>-</span>
                <input class="field" id="business-sunday-end" type="time" value="14:00">
              </div>
            </div>

            <div class="settings-actions">
              <button class="primary" id="business-settings-submit" type="submit">Guardar ajustes</button>
            </div>
            <p class="settings-feedback" id="business-settings-feedback" role="status" aria-live="polite"></p>
          </form>
        </section>

        <section class="settings-panel">
          <h3>Automatizaci&oacute;n</h3>
          <p>Control&aacute; c&oacute;mo responde el asistente en todos los chats del local.</p>
          <div class="settings-automation-list">
            <label class="automation-control">
              <div class="automation-copy">
                <strong>Bot autom&aacute;tico</strong>
                <span>Cuando est&aacute; pausado, ning&uacute;n chat recibe respuestas autom&aacute;ticas.</span>
                <small id="global-bot-status">Activo</small>
              </div>
              <input id="global-bot-toggle" type="checkbox" checked>
              <span class="automation-switch" aria-hidden="true"></span>
            </label>
            <label class="automation-control">
              <div class="automation-copy">
                <strong>Agente IA</strong>
                <span>Mejora la interpretaci&oacute;n y el tono. Si lo apag&aacute;s, el bot sigue funcionando con el flujo b&aacute;sico.</span>
                <small id="global-ai-status">Activo</small>
              </div>
              <input id="global-ai-toggle" type="checkbox" checked>
              <span class="automation-switch" aria-hidden="true"></span>
            </label>
          </div>
        </section>

        <section class="settings-panel">
          <h3>WhatsApp del comercio</h3>
          <p>Conect&aacute; la cuenta Meta del cliente y control&aacute; qu&eacute; env&iacute;os reales quedan habilitados.</p>
          <div class="whatsapp-settings-grid">
            <div class="whatsapp-status-card">
              <div>
                <strong id="whatsapp-settings-title">WhatsApp no conectado</strong>
                <span id="whatsapp-settings-copy">Las campa&ntilde;as y recordatorios reales quedan bloqueados hasta completar la conexi&oacute;n.</span>
              </div>
              <div class="whatsapp-status-badge" id="whatsapp-settings-badge">Bloqueado</div>
            </div>
            <div class="settings-actions">
              <button class="primary" id="whatsapp-connect-button" type="button">Conectar WhatsApp</button>
            </div>
            <div class="whatsapp-control-list">
              <label class="automation-control">
                <div class="automation-copy"><strong>Env&iacute;o real por WhatsApp</strong><span>Bloquea cualquier mensaje real si est&aacute; pausado.</span><small id="real-whatsapp-status">Bloqueado</small></div>
                <input id="real-whatsapp-toggle" type="checkbox">
                <span class="automation-switch" aria-hidden="true"></span>
              </label>
              <label class="automation-control">
                <div class="automation-copy"><strong>Campa&ntilde;as</strong><span>Solo se habilitan con cuenta del cliente y facturaci&oacute;n propia.</span><small id="campaign-sending-status">Bloqueadas</small></div>
                <input id="campaign-sending-toggle" type="checkbox">
                <span class="automation-switch" aria-hidden="true"></span>
              </label>
              <label class="automation-control">
                <div class="automation-copy"><strong>Recordatorios</strong><span>Usan plantillas Utility aprobadas del comercio.</span><small id="reminder-sending-status">Bloqueados</small></div>
                <input id="reminder-sending-toggle" type="checkbox">
                <span class="automation-switch" aria-hidden="true"></span>
              </label>
              <label class="automation-control">
                <div class="automation-copy"><strong>Facturaci&oacute;n cliente</strong><span>Si paga Salon AI, las campa&ntilde;as masivas quedan bloqueadas.</span><small id="billing-owner-status">Cliente</small></div>
                <input id="billing-owner-toggle" type="checkbox" checked>
                <span class="automation-switch" aria-hidden="true"></span>
              </label>
            </div>
            <form class="whatsapp-technical-form" id="whatsapp-technical-form">
              <h4>Conexi&oacute;n t&eacute;cnica</h4>
              <div class="whatsapp-technical-grid">
                <div class="settings-field">
                  <label for="whatsapp-waba-id">WABA ID</label>
                  <input class="field" id="whatsapp-waba-id" autocomplete="off">
                </div>
                <div class="settings-field">
                  <label for="whatsapp-phone-number-id">Phone Number ID</label>
                  <input class="field" id="whatsapp-phone-number-id" autocomplete="off">
                </div>
                <div class="settings-field">
                  <label for="whatsapp-display-phone">N&uacute;mero visible</label>
                  <input class="field" id="whatsapp-display-phone" autocomplete="off">
                </div>
                <div class="settings-field">
                  <label for="whatsapp-token-expires">Vencimiento del token</label>
                  <input class="field" id="whatsapp-token-expires" type="datetime-local">
                </div>
                <div class="settings-field full">
                  <label for="whatsapp-access-token">Token del comercio</label>
                  <input class="field" id="whatsapp-access-token" type="password" autocomplete="off" placeholder="Pegar solo si se quiere actualizar">
                </div>
              </div>
              <div class="settings-actions">
                <button class="secondary" id="whatsapp-technical-submit" type="submit">Guardar conexi&oacute;n</button>
              </div>
            </form>
            <p class="settings-feedback" id="whatsapp-settings-feedback" role="status" aria-live="polite"></p>
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
            <button class="reports-refresh-button" id="reports-refresh" type="button">
              <svg class="ti ti-refresh" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"></path><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"></path></svg>
              Actualizar
            </button>
          </div>
        </header>

        <section class="report-metric-section">
          <div class="section-head">
            <svg class="ti ti-calendar" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z"></path><path d="M16 3v4"></path><path d="M8 3v4"></path><path d="M4 11h16"></path></svg>
            <h3>Turnos</h3>
          </div>
          <div class="reports-grid">
            <article class="report-kpi">
              <div class="kpi-top">
                <span class="kpi-icon"><svg class="ti ti-calendar-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 21h-5a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v6"></path><path d="M16 3v4"></path><path d="M8 3v4"></path><path d="M4 11h11"></path><path d="M15 19l2 2l4 -4"></path></svg></span>
                <span class="kpi-trend"><svg class="ti ti-trending-up" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l6 -6l4 4l8 -8"></path><path d="M14 7h7v7"></path></svg> activos</span>
              </div>
              <div>
                <span>Agendados</span>
                <strong id="report-total-appointments">0</strong>
                <small id="report-total-copy">Sin datos del periodo.</small>
              </div>
            </article>
            <article class="report-kpi">
              <div class="kpi-top">
                <span class="kpi-icon good"><svg class="ti ti-circle-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"></path><path d="M9 12l2 2l4 -4"></path></svg></span>
                <span class="kpi-trend"><svg class="ti ti-trending-up" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l6 -6l4 4l8 -8"></path><path d="M14 7h7v7"></path></svg> ok</span>
              </div>
              <div>
                <span>Realizados</span>
                <strong id="report-completed-appointments">0</strong>
                <small id="report-completed-copy">Incluye turnos pasados no cancelados.</small>
              </div>
            </article>
            <article class="report-kpi">
              <div class="kpi-top">
                <span class="kpi-icon warn"><svg class="ti ti-x" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6l-12 12"></path><path d="M6 6l12 12"></path></svg></span>
                <span class="kpi-trend muted">periodo</span>
              </div>
              <div>
                <span>Cancelados</span>
                <strong id="report-cancelled-appointments">0</strong>
                <small id="report-cancelled-copy">0% del periodo.</small>
              </div>
            </article>
            <article class="report-kpi">
              <div class="kpi-top">
                <span class="kpi-icon neutral"><svg class="ti ti-user-x" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"></path><path d="M6 21v-2a4 4 0 0 1 4 -4h3"></path><path d="M22 22l-5 -5"></path><path d="M17 22l5 -5"></path></svg></span>
                <span class="kpi-trend muted">marcados</span>
              </div>
              <div>
                <span>Ausentes</span>
                <strong id="report-no-show-appointments">0</strong>
                <small id="report-no-show-copy">No asistieron al turno.</small>
              </div>
            </article>
          </div>
        </section>

        <section class="report-metric-section">
          <div class="section-head">
            <svg class="ti ti-users" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7a4 4 0 1 0 0.01 0"></path><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path><path d="M21 21v-2a4 4 0 0 0 -3 -3.85"></path></svg>
            <h3>Clientes</h3>
          </div>
          <div class="reports-grid">
            <article class="report-kpi">
              <div class="kpi-top">
                <span class="kpi-icon"><svg class="ti ti-user" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"></path><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"></path></svg></span>
                <span class="kpi-trend"><svg class="ti ti-trending-up" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l6 -6l4 4l8 -8"></path><path d="M14 7h7v7"></path></svg> clientes</span>
              </div>
              <div>
                <span>Atendidos</span>
                <strong id="report-active-customers">0</strong>
                <small id="report-customers-copy">Clientes con al menos un turno.</small>
              </div>
            </article>
            <article class="report-kpi">
              <div class="kpi-top">
                <span class="kpi-icon good"><svg class="ti ti-user-plus" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"></path><path d="M6 21v-2a4 4 0 0 1 4 -4h3"></path><path d="M19 16v6"></path><path d="M16 19h6"></path></svg></span>
                <span class="kpi-trend muted">mix</span>
              </div>
              <div>
                <span>Nuevos / recurrentes</span>
                <strong id="report-customer-mix">0 / 0</strong>
                <small id="report-customer-mix-copy">Nuevos / recurrentes.</small>
              </div>
            </article>
            <article class="report-kpi">
              <div class="kpi-top">
                <span class="kpi-icon"><svg class="ti ti-clock" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"></path><path d="M12 7v5l3 3"></path></svg></span>
                <span class="kpi-trend muted">intervalos</span>
              </div>
              <div>
                <span>Frecuencia de visita</span>
                <strong id="report-visit-gap">--</strong>
                <small id="report-visit-gap-copy">Promedio de clientes que volvieron.</small>
              </div>
            </article>
            <article class="report-kpi">
              <div class="kpi-top">
                <span class="kpi-icon good"><svg class="ti ti-message-circle" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20l1.3 -3.9a8 8 0 1 1 3.6 3.6l-4.9 1.3"></path></svg></span>
                <span class="kpi-trend"><svg class="ti ti-trending-up" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l6 -6l4 4l8 -8"></path><path d="M14 7h7v7"></path></svg> bueno</span>
              </div>
              <div>
                <span>Chats a turnos</span>
                <strong id="report-chat-conversion">0%</strong>
                <small id="report-chat-conversion-copy">0 de 0 conversaciones.</small>
              </div>
            </article>
          </div>
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
              <p>Facturacion estimada segun servicios con precio cargado.</p>
            </div>
            <div id="report-revenue-note"></div>
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

        <section class="reports-triple">
          <article class="reports-table-panel">
            <div class="future-agenda-head">
              <div>
                <h3>Agenda futura</h3>
                <p id="report-future-copy">Proximos 30 dias.</p>
              </div>
              <select id="reports-future-days">
                <option value="7">7 dias</option>
                <option value="15">15 dias</option>
                <option value="30" selected>30 dias</option>
                <option value="60">60 dias</option>
              </select>
            </div>
            <div class="future-total compact">
              <span>Turnos futuros totales</span>
              <strong id="report-future-total">0</strong>
            </div>
            <div class="future-professionals" id="report-future-professionals"></div>
          </article>

          <article class="reports-table-panel">
            <div>
              <h3>Chats sin turno</h3>
              <p>Conversaciones que todavia no agendaron.</p>
            </div>
            <div class="report-empty-note" id="report-unconverted-chats">Pendiente de conectar al historial de chats.</div>
          </article>

          <article class="reports-table-panel">
            <div class="report-card-head">
              <div>
                <h3>Clientes inactivos</h3>
                <p id="report-inactive-copy">Sin turno en los ultimos 60 dias.</p>
              </div>
              <select id="reports-inactive-days">
                <option value="30">30 dias</option>
                <option value="45">45 dias</option>
                <option value="60" selected>60 dias</option>
                <option value="90">90 dias</option>
              </select>
            </div>
            <div id="report-inactive-table"></div>
          </article>

          <article class="reports-table-panel">
            <div>
              <h3>Clientes en riesgo</h3>
              <p>Clientes recurrentes cuyo patron de visitas indica riesgo de perdida.</p>
            </div>
            <div id="report-risk-table"></div>
          </article>
        </section>
      </div>
    </section>
  </main>

  <div class="dialog-backdrop" id="campaign-dialog" hidden>
    <section class="dialog campaign-dialog" role="dialog" aria-modal="true" aria-labelledby="campaign-dialog-title">
      <header class="dialog-header">
        <div>
          <h3 id="campaign-dialog-title">Nueva campa&ntilde;a</h3>
          <p class="hint">Guardaremos la configuraci&oacute;n sin enviar mensajes.</p>
        </div>
        <button class="icon-button" id="campaign-dialog-close" type="button" aria-label="Cerrar">&times;</button>
      </header>
      <form class="campaign-form" id="campaign-form">
        <input id="campaign-id" type="hidden">
        <div class="campaign-form-grid">
          <div class="campaign-form-field full">
            <label for="campaign-name">Nombre de la campa&ntilde;a</label>
            <input id="campaign-name" maxlength="100" placeholder="Ej: Recuperaci&oacute;n de clientes" required>
          </div>
          <div class="campaign-form-field">
            <label for="campaign-type">Tipo</label>
            <select id="campaign-type">
              <option value="ONE_TIME">Puntual</option>
              <option value="AUTOMATED">Autom&aacute;tica</option>
            </select>
          </div>
          <div class="campaign-form-field">
            <label for="campaign-channel">Canal</label>
            <select id="campaign-channel">
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
              <option value="BOTH">WhatsApp + Email</option>
            </select>
          </div>
          <div class="campaign-form-field">
            <label for="campaign-segment">Segmento</label>
            <select id="campaign-segment">
              <option value="ALL">Todos los autorizados</option>
              <option value="AT_RISK">Clientes en riesgo</option>
              <option value="INACTIVE">Inactivos por cantidad de d&iacute;as</option>
              <option value="ONE_TIME_VISITOR">Visit&oacute; una sola vez</option>
              <option value="NEW_CUSTOMER">Clientes nuevos</option>
              <option value="MANUAL">Selecci&oacute;n manual</option>
            </select>
          </div>
          <section class="campaign-manual-settings" id="campaign-manual-settings" hidden>
            <div><h4>Elegir destinatarios</h4><p>Seleccion&aacute; los clientes que quer&eacute;s incluir en esta campa&ntilde;a.</p></div>
            <div class="campaign-manual-toolbar"><input class="campaign-manual-search" id="campaign-manual-search" type="search" placeholder="Buscar por nombre o tel&eacute;fono"><span class="campaign-manual-count" id="campaign-manual-count">0 seleccionados</span></div>
            <div class="campaign-manual-list" id="campaign-manual-list"></div>
            <button class="campaign-manual-more" id="campaign-manual-more" type="button" hidden>Mostrar m&aacute;s clientes</button>
          </section>
          <div class="campaign-form-field">
            <label for="campaign-schedule-mode" id="campaign-schedule-mode-label">Cu&aacute;ndo enviar</label>
            <select id="campaign-schedule-mode">
              <option value="IMMEDIATE">Al activar</option>
              <option value="SCHEDULED">Programar fecha</option>
            </select>
          </div>
          <div class="campaign-form-field">
            <label for="campaign-scheduled-at" id="campaign-scheduled-at-label">Fecha y hora</label>
            <input id="campaign-scheduled-at" type="datetime-local">
          </div>
          <div class="campaign-form-field">
            <label for="campaign-budget">L&iacute;mite de presupuesto</label>
            <div class="money-input-shell">
              <span class="money-input-prefix">$</span>
              <input id="campaign-budget" type="text" inputmode="numeric" placeholder="Opcional">
              <span class="money-input-currency">ARS</span>
            </div>
            <p class="money-preview" id="campaign-budget-preview">Sin l&iacute;mite definido</p>
          </div>
          <div class="campaign-form-field">
            <label for="campaign-status">Estado</label>
            <select id="campaign-status">
              <option value="DRAFT">Borrador</option>
              <option value="SCHEDULED">Programada</option>
              <option value="ACTIVE">Activa</option>
              <option value="PAUSED">Pausada</option>
              <option value="FINISHED">Finalizada</option>
            </select>
          </div>
          <section class="campaign-automation-settings" id="campaign-automation-settings" hidden>
            <div class="campaign-automation-heading">
              <h4>Reglas de automatizaci&oacute;n</h4>
              <p>Defin&iacute; cu&aacute;ndo entra un cliente, cu&aacute;ntas veces contactarlo y c&oacute;mo evitar mensajes superpuestos.</p>
            </div>
            <div class="campaign-punctual-copy">
              <label class="campaign-stop-rule"><input id="campaign-automation-respect-cooldown" type="checkbox" checked> Respetar descanso desde otras promociones</label>
              <p>Si est&aacute; desactivado, esta campa&ntilde;a puede contactar aunque el cliente haya recibido otra promoci&oacute;n recientemente.</p>
            </div>
            <div class="campaign-automation-grid">
              <div class="campaign-form-field" id="campaign-segment-days-field">
                <label for="campaign-segment-days">D&iacute;as para ingresar</label>
                <input id="campaign-segment-days" type="number" min="1" max="730" list="campaign-day-options" value="45">
                <datalist id="campaign-day-options"><option value="15"><option value="30"><option value="45"><option value="90"></datalist>
              </div>
              <div class="campaign-form-field">
                <label for="campaign-priority">Prioridad ante coincidencias</label>
                <select id="campaign-priority">
                  <option value="3">Alta</option>
                  <option value="2" selected>Media</option>
                  <option value="1">Baja</option>
                </select>
              </div>
              <div class="campaign-form-field">
                <label for="campaign-max-attempts">M&aacute;ximo de contactos</label>
                <input id="campaign-max-attempts" type="number" min="1" max="10" value="2">
              </div>
              <div class="campaign-form-field">
                <label for="campaign-retry-days">D&iacute;as entre contactos de esta campa&ntilde;a</label>
                <input id="campaign-retry-days" type="number" min="1" max="365" value="30">
              </div>
              <div class="campaign-form-field">
                <label for="campaign-cooldown-days">D&iacute;as desde otra promoci&oacute;n</label>
                <input id="campaign-cooldown-days" type="number" min="0" max="365" value="30">
              </div>
            </div>
            <div class="campaign-stop-rules" hidden>
              <label class="campaign-stop-rule"><input id="campaign-stop-on-booking" type="checkbox" checked> Detener si reserva</label>
              <label class="campaign-stop-rule"><input id="campaign-stop-on-reply" type="checkbox" checked> Detener si responde</label>
              <label class="campaign-stop-rule"><input id="campaign-restart-after-visit" type="checkbox" checked> Reiniciar despu&eacute;s de una nueva visita realizada</label>
            </div>
          </section>
          <section class="campaign-punctual-settings" id="campaign-punctual-settings">
            <div class="campaign-punctual-copy">
              <label class="campaign-stop-rule"><input id="campaign-punctual-respect-cooldown" type="checkbox" checked> Respetar descanso desde otras promociones</label>
              <p>Excluye a quienes recibieron otra campa&ntilde;a recientemente.</p>
            </div>
            <div class="campaign-form-field">
              <label for="campaign-punctual-cooldown-days">D&iacute;as desde la &uacute;ltima promoci&oacute;n</label>
              <input id="campaign-punctual-cooldown-days" type="number" min="1" max="365" list="campaign-punctual-day-options" value="30">
              <datalist id="campaign-punctual-day-options"><option value="15"><option value="30"><option value="45"><option value="60"></datalist>
            </div>
          </section>
          <div class="campaign-form-field full">
            <label for="campaign-whatsapp-template">Plantilla aprobada de Meta</label>
            <select id="campaign-whatsapp-template" required><option value="">Seleccionar plantilla aprobada</option></select>
            <p class="campaign-form-help">Las plantillas se crean y administran desde la pesta&ntilde;a Plantillas de Meta. Solo aparecen aqu&iacute; cuando est&aacute;n aprobadas.</p>
            <input id="campaign-template-name" type="hidden"><select id="campaign-template-language" hidden><option value="es_AR">es_AR</option><option value="es">es</option><option value="en_US">en_US</option></select>
            <button id="campaign-template-create" type="button" hidden></button><button id="campaign-template-sync" type="button" hidden></button><div id="campaign-template-state" hidden></div><p id="campaign-template-feedback" hidden></p>
          </div>
          <div class="campaign-form-field full">
            <label for="campaign-message">Mensaje</label>
            <div class="campaign-message-tools" hidden>
              <button class="campaign-message-tool" id="campaign-emoji-toggle" type="button">&#128578; Agregar emoji</button>
              <label class="campaign-image-picker">&#128247; Agregar imagen
                <input id="campaign-image" type="file" accept="image/png,image/jpeg,image/webp">
              </label>
            </div>
            <div class="campaign-emoji-picker" id="campaign-emoji-picker" hidden>
              <input class="campaign-emoji-search" id="campaign-emoji-search" type="search" placeholder="Buscar emojis por categor&iacute;a">
              <nav class="campaign-emoji-categories" id="campaign-emoji-categories" aria-label="Categor&iacute;as de emojis">
                <button class="active" type="button" data-emoji-category="recent" title="Recientes">&#128338;</button>
                <button type="button" data-emoji-category="smileys" title="Caras y personas">&#128578;</button>
                <button type="button" data-emoji-category="animals" title="Animales y naturaleza">&#128054;</button>
                <button type="button" data-emoji-category="food" title="Comida y bebida">&#127828;</button>
                <button type="button" data-emoji-category="activities" title="Actividades">&#9917;</button>
                <button type="button" data-emoji-category="travel" title="Viajes y lugares">&#128663;</button>
                <button type="button" data-emoji-category="objects" title="Objetos">&#128161;</button>
                <button type="button" data-emoji-category="symbols" title="S&iacute;mbolos">&#10084;</button>
                <button type="button" data-emoji-category="flags" title="Banderas">&#127462;&#127479;</button>
              </nav>
              <div class="campaign-emoji-grid" id="campaign-emoji-grid"></div>
            </div>
            <div class="campaign-image-preview" id="campaign-image-preview" hidden>
              <img id="campaign-image-preview-img" alt="Vista previa de la imagen">
              <div><strong>Imagen heredada de una campaña anterior</strong><button class="campaign-image-remove" id="campaign-image-remove" type="button" hidden>Quitar imagen</button></div>
            </div>
            <textarea id="campaign-message" maxlength="1200" placeholder="Seleccion&aacute; una plantilla aprobada" readonly required></textarea>
            <p class="campaign-form-help">El contenido pertenece a la plantilla aprobada y no puede modificarse desde la campa&ntilde;a.</p>
          </div>
        </div>
        <p class="campaign-form-feedback" id="campaign-form-feedback" role="status" aria-live="polite"></p>
        <div class="dialog-actions">
          <button class="secondary" id="campaign-dialog-cancel" type="button">Cancelar</button>
          <button class="primary" id="campaign-submit" type="submit">Guardar campa&ntilde;a</button>
        </div>
      </form>
    </section>
  </div>

  <div class="dialog-backdrop" id="campaign-delete-dialog" hidden>
    <section class="dialog customer-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="campaign-delete-title">
      <header class="dialog-header">
        <h3 id="campaign-delete-title">Eliminar campa&ntilde;a</h3>
        <button class="icon-button" id="campaign-delete-close" type="button" title="Cerrar">X</button>
      </header>
      <div class="customer-delete-body">
        <div class="customer-delete-hero"><span class="customer-delete-icon" data-icon="trash"></span><div><strong id="campaign-delete-name">Eliminar campa&ntilde;a</strong><p>Esta acci&oacute;n no se puede deshacer.</p></div></div>
        <div class="customer-delete-warning"><strong>Se eliminar&aacute;n:</strong><ul><li>La configuraci&oacute;n y selecci&oacute;n manual.</li><li>El historial asociado a esta campa&ntilde;a.</li></ul></div>
        <p class="customer-delete-feedback" id="campaign-delete-feedback"></p>
        <div class="dialog-actions"><button class="secondary" id="campaign-delete-cancel" type="button">Cancelar</button><button class="danger customer-delete-confirm" id="campaign-delete-confirm" type="button">Eliminar campa&ntilde;a</button></div>
      </div>
    </section>
  </div>

  <div class="dialog-backdrop" id="campaign-activation-dialog" hidden>
    <section class="dialog customer-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="campaign-activation-title">
      <header class="dialog-header">
        <h3 id="campaign-activation-title">Activar campa&ntilde;a</h3>
        <button class="icon-button" id="campaign-activation-close" type="button" title="Cerrar">X</button>
      </header>
      <div class="customer-delete-body">
        <div class="customer-delete-hero"><span class="customer-delete-icon" data-icon="mail"></span><div><strong id="campaign-activation-name">Activar campa&ntilde;a</strong><p id="campaign-activation-copy">Revis&aacute; el resumen antes de activar.</p></div></div>
        <div class="customer-delete-warning" id="campaign-activation-summary"></div>
        <p class="customer-delete-feedback" id="campaign-activation-feedback"></p>
        <div class="dialog-actions"><button class="secondary" id="campaign-activation-cancel" type="button">Cancelar</button><button class="primary" id="campaign-activation-confirm" type="button">Confirmar activaci&oacute;n</button></div>
      </div>
    </section>
  </div>

  <div class="dialog-backdrop" id="template-delete-dialog" hidden>
    <section class="dialog customer-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="template-delete-title">
      <header class="dialog-header">
        <h3 id="template-delete-title">Eliminar plantilla</h3>
        <button class="icon-button" id="template-delete-close" type="button" title="Cerrar">X</button>
      </header>
      <div class="customer-delete-body">
        <div class="customer-delete-hero"><span class="customer-delete-icon" data-icon="trash"></span><div><strong id="template-delete-name">Eliminar plantilla</strong><p>Esta acci&oacute;n elimina la plantilla del CRM.</p></div></div>
        <div class="customer-delete-warning" id="template-delete-warning"><strong>Antes de eliminar:</strong><ul><li>Si ya fue enviada a Meta, seguir&aacute; existiendo en WhatsApp Manager.</li><li>No se puede eliminar si alguna campa&ntilde;a la est&aacute; usando.</li></ul></div>
        <p class="customer-delete-feedback" id="template-delete-feedback"></p>
        <div class="dialog-actions"><button class="secondary" id="template-delete-cancel" type="button">Cancelar</button><button class="danger customer-delete-confirm" id="template-delete-confirm" type="button">Eliminar plantilla</button></div>
      </div>
    </section>
  </div>

  <div class="dialog-backdrop" id="template-dialog" hidden>
    <section class="dialog campaign-dialog template-dialog" role="dialog" aria-modal="true" aria-labelledby="template-dialog-title">
      <header class="dialog-header"><div><h3 id="template-dialog-title">Nueva plantilla de WhatsApp</h3><p>Las campa&ntilde;as solo podr&aacute;n usar plantillas aprobadas por Meta.</p></div><button class="icon-button" id="template-dialog-close" type="button" title="Cerrar">X</button></header>
      <form class="campaign-form" id="template-form">
        <input id="template-id" type="hidden">
        <div class="campaign-form-body">
          <div class="template-builder-grid">
            <div class="template-builder-main">
              <section class="template-helper-callout">Escrib&iacute; variables con nombre, por ejemplo <strong>{{nombre_cliente}}</strong>. El CRM pedir&aacute; ejemplos y las convertir&aacute; al formato que Meta necesita al enviar la plantilla.</section>
              <section class="template-builder-card">
                <h4>Tipo de plantilla</h4>
                <p>Eleg&iacute; para qu&eacute; se va a usar. El CRM asigna la categor&iacute;a correcta para Meta.</p>
                <div class="template-type-grid">
                  <label class="template-type-card"><input id="template-category-marketing" type="radio" name="template-category" value="MARKETING" checked><span>📣</span><div><strong>Marketing</strong><small>Promociones, cumplea&ntilde;os, clientes inactivos.</small></div></label>
                  <label class="template-type-card"><input id="template-category-utility" type="radio" name="template-category" value="UTILITY"><span>⏰</span><div><strong>Recordatorio</strong><small>Turnos, confirmaciones, cancelaciones.</small></div></label>
                </div>
              </section>
              <section class="template-builder-card">
                <h4>Datos para Meta</h4>
                <p>Estos datos identifican la plantilla dentro de WhatsApp Manager.</p>
                <div class="template-meta-grid">
                  <div class="campaign-form-field"><label for="template-internal-name">Nombre interno</label><input id="template-internal-name" placeholder="Ej: Recuperaci&oacute;n de clientes" required><p class="campaign-form-help">Solo se muestra dentro del CRM.</p></div>
                  <div class="campaign-form-field"><label for="template-meta-name">Nombre en Meta</label><input id="template-meta-name" placeholder="Ej: recuperacion_clientes" required><p class="campaign-form-help">Min&uacute;sculas, n&uacute;meros y guiones bajos.</p></div>
                  <div class="campaign-form-field"><label>Categor&iacute;a</label><div class="template-category-readonly" id="template-category-label">Marketing</div></div>
                  <div class="campaign-form-field"><label for="template-language">Idioma</label><select id="template-language"><option value="es_AR">Espa&ntilde;ol Argentina (es_AR)</option><option value="es">Espa&ntilde;ol (es)</option><option value="en_US">English US (en_US)</option></select></div>
                </div>
              </section>
              <section class="template-builder-card">
                <h4>Mensaje</h4>
                <p>Us&aacute; variables entre llaves dobles cuando el dato cambie para cada cliente.</p>
                <div class="campaign-message-tools">
                  <button class="campaign-message-tool" id="template-emoji-toggle" type="button">&#128578; Agregar emoji</button>
                  <label class="campaign-image-picker">&#128247; Agregar imagen
                    <input id="template-image" type="file" accept="image/png,image/jpeg,image/webp">
                  </label>
                </div>
                <emoji-picker class="template-emoji-picker light" id="template-emoji-picker" locale="es" hidden></emoji-picker>
                <div class="campaign-image-preview" id="template-image-preview" hidden><img id="template-image-preview-img" alt="Vista previa de la imagen"><div><strong>Encabezado con imagen</strong><button class="campaign-image-remove" id="template-image-remove" type="button">Quitar imagen</button></div></div>
                <div class="campaign-form-field full"><label for="template-body">Texto de la plantilla</label><textarea id="template-body" maxlength="1024" placeholder="Hola {{nombre_cliente}} 👋 tenemos una promo para vos: {{promo}}." required></textarea></div>
              </section>
              <section class="template-builder-card">
                <h4>Variables detectadas</h4>
                <p>Meta exige ejemplos reales para revisar plantillas con variables.</p>
                <div class="template-variable-panel" id="template-variable-panel"></div>
              </section>
            </div>
            <aside class="template-preview-panel">
              <div class="template-detail-head"><div><span class="campaign-badge draft" id="template-preview-status">Borrador</span><h4>Vista previa</h4></div></div>
              <div class="template-phone-preview"><div class="template-phone-bubble"><img class="template-live-image" id="template-live-image" alt="Imagen de la plantilla" hidden><span id="template-live-preview">Escrib&iacute; el mensaje para ver la vista previa.</span></div></div>
              <div class="template-checklist" id="template-checklist"></div>
            </aside>
          </div>
        </div>
        <p class="campaign-form-feedback template-form-feedback" id="template-form-feedback" role="status" aria-live="polite"></p>
        <div class="dialog-actions"><button class="secondary" id="template-dialog-cancel" type="button">Cancelar</button><button class="secondary" id="template-save-draft" type="submit">Guardar borrador</button><button class="primary" id="template-save-submit" type="button">Guardar y enviar a Meta</button></div>
      </form>
    </section>
  </div>

  <script type="module" src="https://cdn.jsdelivr.net/npm/emoji-picker-element@1/index.js"></script>
  <script>
    const WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000

    function notifyOpenerFromMetaOAuthRedirect() {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const error = params.get('error_description') || params.get('error_message') || params.get('error')
      if (!window.opener || (!code && !error)) return false
      window.opener.postMessage({
        type: 'SALON_AI_META_OAUTH',
        code,
        error,
        redirectUri: window.location.origin + window.location.pathname
      }, window.location.origin)
      window.close()
      return true
    }

    const metaOAuthRedirectNotified = notifyOpenerFromMetaOAuthRedirect()
    if (metaOAuthRedirectNotified) {
      document.body.innerHTML = '<main class="crm-shell"><section class="settings-card"><h1>Conectando WhatsApp...</h1><p>Ya podes volver a la ventana principal.</p></section></main>'
    } else {

    const state = {
      conversations: [],
      conversationNextCursor: null,
      conversationCounts: { active: 0, archived: 0, handoff: 0 },
      loadedArchiveView: 'active',
      selected: null,
      messages: [],
      messageNextCursor: null,
      appointments: [],
      professionals: [],
      services: [],
      customers: [],
      customerOverview: [],
      customerOverviewCounts: { total: 0, active: 0, inactive: 0, new: 0 },
      customerOverviewPagination: { page: 1, take: 25, total: 0, totalPages: 1 },
      selectedCustomerId: null,
      customerFilter: 'all',
      customerInactiveDays: 60,
      customerSearch: '',
      customerNotes: [],
      agendaAppointments: [],
      reportAppointments: [],
      agendaBlocks: [],
      agendaSelectedDate: new Date(),
      agendaMonthDate: new Date(),
      agendaDraggingAppointmentId: null,
      agendaDidDrag: false,
      editingAppointmentId: null,
      aiSettings: {
        botEnabled: true,
        aiEnabled: true
      },
      pendingProfessionalSave: null,
      professionalStatusFilter: 'all',
      professionalViewMode: 'cards',
      professionalAvatarUrl: null,
      businessLogoUrl: null,
      businessId: null,
      business: null,
      businessHours: [],
      whatsappSettings: null,
      whatsappEmbeddedSignupSession: {},
      whatsappEmbeddedSignupPayloadKeys: [],
      whatsappPendingSignupResponse: null,
      whatsappSignupSaveInFlight: false,
      conversationFilter: 'all',
      conversationVisibleLimit: 12,
      readConversationIds: new Set(),
      customerDialogMode: 'edit',
      customerDialogCustomerId: null,
      customerDeleteCustomerId: null,
      pendingMarketingChange: null,
      pendingCampaignDeleteId: null,
      pendingTemplateDeleteId: null,
      pendingCampaignActivationId: null,
      whatsappPricing: { rates: [], defaultCountry: 'AR', disclaimer: '' },
      whatsappPricingLoaded: false,
      campaigns: [],
      campaignAudiences: {},
      campaignDeliveries: {},
      campaignSimulations: {},
      campaignSimulationLoading: {},
      campaignsLoaded: false,
      selectedCampaignId: null,
      campaignFilter: 'ALL',
      campaignSearch: '',
      campaignPage: 1,
      campaignTake: 8,
      campaignImageUrl: null,
      campaignEmojiCategory: 'recent',
      campaignDetailTab: 'summary',
      campaignManualSelected: new Map(),
      campaignManualItems: [],
      campaignManualPage: 1,
      campaignManualTotalPages: 1,
      campaignManualSearchTimer: null,
      campaignTemplateMeta: { name: null, id: null, status: 'NOT_CREATED', rejectionReason: null, lastSyncedAt: null },
      marketingView: 'templates',
      whatsappTemplates: [],
      templatesLoaded: false,
      reminderAutomations: [],
      selectedReminderId: null,
      reminderDraft: { name: '', channel: 'WHATSAPP', templateId: null, enabled: false, sendBeforeMinutes: 1440 },
      pendingReminderDeleteConfirm: false,
      reminderLoaded: false,
      selectedTemplateId: null,
      templateFilter: 'ALL',
      templateSearch: '',
      templateDraftExamples: {},
      templateImageUrl: null,
      pendingUiConfirmation: null,
      crmToastTimer: null,
      isRefreshing: false
    }

    const els = {
      list: document.getElementById('conversation-list'),
      crmToast: document.getElementById('crm-toast'),
      count: document.getElementById('conversation-count'),
      unreadCount: document.getElementById('conversation-unread-count'),
      archivedCount: document.getElementById('conversation-archived-count'),
      conversationTabs: document.querySelector('.conversation-tabs'),
      conversationMore: document.getElementById('conversation-more'),
      search: document.getElementById('search'),
      searchButton: document.getElementById('search-button'),
      refresh: document.getElementById('refresh'),
      handoffCount: document.getElementById('handoff-count'),
      topConversationTotal: document.getElementById('top-conversation-total'),
      topAppointmentTotal: document.getElementById('top-appointment-total'),
      topHandoffTotal: document.getElementById('top-handoff-total'),
      globalBotToggle: document.getElementById('global-bot-toggle'),
      globalAiToggle: document.getElementById('global-ai-toggle'),
      globalBotStatus: document.getElementById('global-bot-status'),
      globalAiStatus: document.getElementById('global-ai-status'),
      whatsappSettingsTitle: document.getElementById('whatsapp-settings-title'),
      whatsappSettingsCopy: document.getElementById('whatsapp-settings-copy'),
      whatsappSettingsBadge: document.getElementById('whatsapp-settings-badge'),
      whatsappConnectButton: document.getElementById('whatsapp-connect-button'),
      realWhatsappToggle: document.getElementById('real-whatsapp-toggle'),
      campaignSendingToggle: document.getElementById('campaign-sending-toggle'),
      reminderSendingToggle: document.getElementById('reminder-sending-toggle'),
      billingOwnerToggle: document.getElementById('billing-owner-toggle'),
      realWhatsappStatus: document.getElementById('real-whatsapp-status'),
      campaignSendingStatus: document.getElementById('campaign-sending-status'),
      reminderSendingStatus: document.getElementById('reminder-sending-status'),
      billingOwnerStatus: document.getElementById('billing-owner-status'),
      whatsappSettingsFeedback: document.getElementById('whatsapp-settings-feedback'),
      whatsappTechnicalForm: document.getElementById('whatsapp-technical-form'),
      whatsappWabaId: document.getElementById('whatsapp-waba-id'),
      whatsappPhoneNumberId: document.getElementById('whatsapp-phone-number-id'),
      whatsappDisplayPhone: document.getElementById('whatsapp-display-phone'),
      whatsappTokenExpires: document.getElementById('whatsapp-token-expires'),
      whatsappAccessToken: document.getElementById('whatsapp-access-token'),
      whatsappTechnicalSubmit: document.getElementById('whatsapp-technical-submit'),
      messages: document.getElementById('messages'),
      chatAvatar: document.getElementById('chat-avatar'),
      chatPhone: document.getElementById('chat-phone'),
      chatStatus: document.getElementById('chat-status'),
      stepChip: document.getElementById('step-chip'),
      resolveHandoff: document.getElementById('resolve-handoff'),
      conversationAiToggle: document.getElementById('conversation-ai-toggle'),
      archiveConversation: document.getElementById('archive-conversation'),
      replyForm: document.getElementById('reply-form'),
      replyText: document.getElementById('reply-text'),
      sendButton: document.getElementById('send-button'),
      composerWindowNotice: document.getElementById('composer-window-notice'),
      composerWindowText: document.getElementById('composer-window-text'),
      composerWindowWhatsapp: document.getElementById('composer-window-whatsapp'),
      detailAvatar: document.getElementById('detail-avatar'),
      detailName: document.getElementById('detail-name'),
      detailPhone: document.getElementById('detail-phone'),
      detailWhatsapp: document.getElementById('detail-whatsapp'),
      detailStep: document.getElementById('detail-step'),
      detailMarketingStatus: document.getElementById('detail-marketing-status'),
      detailUpdated: document.getElementById('detail-updated'),
      appointments: document.getElementById('appointments'),
      appointmentCount: document.getElementById('appointment-count'),
      viewAgenda: document.getElementById('view-agenda'),
      quickSchedule: document.getElementById('quick-schedule'),
      quickChange: document.getElementById('quick-change'),
      quickReminder: document.getElementById('quick-reminder'),
      quickHistory: document.getElementById('quick-history'),
      customerEdit: document.getElementById('customer-edit'),
      customerAddNote: document.getElementById('customer-add-note'),
      customerNotesList: document.getElementById('customer-notes-list'),
      customerDialog: document.getElementById('customer-dialog'),
      customerDialogForm: document.getElementById('customer-dialog-form'),
      customerDialogTitle: document.getElementById('customer-dialog-title'),
      customerDialogCopy: document.getElementById('customer-dialog-copy'),
      customerDialogClose: document.getElementById('customer-dialog-close'),
      customerDialogCancel: document.getElementById('customer-dialog-cancel'),
      customerDialogSubmit: document.getElementById('customer-dialog-submit'),
      customerDialogFeedback: document.getElementById('customer-dialog-feedback'),
      customerNameField: document.getElementById('customer-name-field'),
      customerPhoneField: document.getElementById('customer-phone-field'),
      customerNoteField: document.getElementById('customer-note-field'),
      customerDialogName: document.getElementById('customer-dialog-name'),
      customerDialogPhone: document.getElementById('customer-dialog-phone'),
      customerDialogNote: document.getElementById('customer-dialog-note'),
      customerDeleteDialog: document.getElementById('customer-delete-dialog'),
      customerDeleteName: document.getElementById('customer-delete-name'),
      customerDeleteClose: document.getElementById('customer-delete-close'),
      customerDeleteCancel: document.getElementById('customer-delete-cancel'),
      customerDeleteConfirm: document.getElementById('customer-delete-confirm'),
      customerDeleteFeedback: document.getElementById('customer-delete-feedback'),
      marketingConfirmDialog: document.getElementById('marketing-confirm-dialog'),
      marketingConfirmClose: document.getElementById('marketing-confirm-close'),
      marketingConfirmCancel: document.getElementById('marketing-confirm-cancel'),
      marketingConfirmSubmit: document.getElementById('marketing-confirm-submit'),
      marketingConfirmName: document.getElementById('marketing-confirm-name'),
      marketingConfirmCopy: document.getElementById('marketing-confirm-copy'),
      marketingConfirmWarning: document.getElementById('marketing-confirm-warning'),
      marketingConfirmFeedback: document.getElementById('marketing-confirm-feedback'),
      customersView: document.getElementById('customers-view'),
      customersSearch: document.getElementById('customers-search'),
      customerNewButton: document.getElementById('customer-new-button'),
      customerFilterTabs: document.getElementById('customer-filter-tabs'),
      customerInactiveDays: document.getElementById('customer-inactive-days'),
      customerTableBody: document.getElementById('customer-table-body'),
      customerProfilePanel: document.getElementById('customer-profile-panel'),
      customersTotal: document.getElementById('customers-total'),
      customersActive: document.getElementById('customers-active'),
      customersInactive: document.getElementById('customers-inactive'),
      customersNew: document.getElementById('customers-new'),
      customerPaginationCopy: document.getElementById('customer-pagination-copy'),
      customerPageNumber: document.getElementById('customer-page-number'),
      customerPagePrev: document.getElementById('customer-page-prev'),
      customerPageNext: document.getElementById('customer-page-next'),
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
      professionalsView: document.getElementById('professionals-view'),
      professionalImpactPanel: document.getElementById('professional-impact-panel'),
      professionalImpactTitle: document.getElementById('professional-impact-title'),
      professionalImpactCopy: document.getElementById('professional-impact-copy'),
      professionalImpactList: document.getElementById('professional-impact-list'),
      professionalImpactReprogram: document.getElementById('professional-impact-reprogram'),
      professionalImpactCancel: document.getElementById('professional-impact-cancel'),
      professionalImpactKeep: document.getElementById('professional-impact-keep'),
      professionalMonthCount: document.getElementById('professional-month-count'),
      professionalClientCount: document.getElementById('professional-client-count'),
      professionalMonthTrend: document.getElementById('professional-month-trend'),
      professionalClientTrend: document.getElementById('professional-client-trend'),
      professionalTotalCopy: document.getElementById('professional-total-copy'),
      professionalSearch: document.getElementById('professional-search'),
      professionalNewButton: document.getElementById('professional-new-button'),
      professionalPanel: document.getElementById('professional-panel'),
      professionalPanelClose: document.getElementById('professional-panel-close'),
      professionalCardView: document.getElementById('professional-card-view'),
      professionalListView: document.getElementById('professional-list-view'),
      professionalStatusFilter: document.getElementById('professional-status-filter'),
      professionalServices: document.getElementById('professional-services'),
      professionalStatus: document.getElementById('professional-status'),
      professionalAvatar: document.getElementById('professional-avatar'),
      professionalPhotoPicker: document.getElementById('professional-photo-picker'),
      professionalPhotoPreview: document.getElementById('professional-photo-preview'),
      serviceForm: document.getElementById('service-form'),
      serviceFormTitle: document.getElementById('service-form-title'),
      serviceId: document.getElementById('service-id'),
      serviceName: document.getElementById('service-name'),
      serviceDuration: document.getElementById('service-duration'),
      servicePrice: document.getElementById('service-price'),
      serviceCategory: document.getElementById('service-category'),
      serviceAliases: document.getElementById('service-aliases'),
      serviceCancel: document.getElementById('service-cancel'),
      serviceFeedback: document.getElementById('service-feedback'),
      serviceSearch: document.getElementById('service-search'),
      serviceList: document.getElementById('service-list'),
      serviceCount: document.getElementById('service-count'),
      campaignSearch: document.getElementById('campaign-search'),
      campaignNew: document.getElementById('campaign-new'),
      marketingMainTabs: document.getElementById('marketing-main-tabs'),
      campaignsContent: document.getElementById('campaigns-content'),
      templateManager: document.getElementById('template-manager'),
      reminderManager: document.getElementById('reminder-manager'),
      templateFilterTabs: document.getElementById('template-filter-tabs'),
      templateTableBody: document.getElementById('template-table-body'),
      templateDetailPanel: document.getElementById('template-detail-panel'),
      templateListCopy: document.getElementById('template-list-copy'),
      templateSyncAll: document.getElementById('template-sync-all'),
      templateApprovedCount: document.getElementById('template-approved-count'),
      templatePendingCount: document.getElementById('template-pending-count'),
      templateDraftCount: document.getElementById('template-draft-count'),
      templateRejectedCount: document.getElementById('template-rejected-count'),
      reminderList: document.getElementById('reminder-list'),
      reminderName: document.getElementById('reminder-name'),
      reminderChannel: document.getElementById('reminder-channel'),
      reminderTemplate: document.getElementById('reminder-template'),
      reminderBefore: document.getElementById('reminder-before'),
      reminderEnabled: document.getElementById('reminder-enabled'),
      reminderDelete: document.getElementById('reminder-delete'),
      reminderProcess: document.getElementById('reminder-process'),
      reminderSave: document.getElementById('reminder-save'),
      reminderFeedback: document.getElementById('reminder-feedback'),
      reminderStatusLabel: document.getElementById('reminder-status-label'),
      reminderTemplateLabel: document.getElementById('reminder-template-label'),
      reminderTimeLabel: document.getElementById('reminder-time-label'),
      reminderEnabledCopy: document.getElementById('reminder-enabled-copy'),
      reminderDetailPanel: document.getElementById('reminder-detail-panel'),
      campaignFilterTabs: document.getElementById('campaign-filter-tabs'),
      campaignTableBody: document.getElementById('campaign-table-body'),
      campaignDetailPanel: document.getElementById('campaign-detail-panel'),
      campaignTotal: document.getElementById('campaign-total'),
      campaignActiveCount: document.getElementById('campaign-active-count'),
      campaignScheduledCount: document.getElementById('campaign-scheduled-count'),
      campaignDraftCount: document.getElementById('campaign-draft-count'),
      campaignPaginationCopy: document.getElementById('campaign-pagination-copy'),
      campaignPageNumber: document.getElementById('campaign-page-number'),
      campaignPagePrev: document.getElementById('campaign-page-prev'),
      campaignPageNext: document.getElementById('campaign-page-next'),
      campaignDialog: document.getElementById('campaign-dialog'),
      campaignDialogTitle: document.getElementById('campaign-dialog-title'),
      campaignDialogClose: document.getElementById('campaign-dialog-close'),
      campaignDialogCancel: document.getElementById('campaign-dialog-cancel'),
      campaignForm: document.getElementById('campaign-form'),
      campaignId: document.getElementById('campaign-id'),
      campaignName: document.getElementById('campaign-name'),
      campaignType: document.getElementById('campaign-type'),
      campaignChannel: document.getElementById('campaign-channel'),
      campaignSegment: document.getElementById('campaign-segment'),
      campaignManualSettings: document.getElementById('campaign-manual-settings'),
      campaignManualList: document.getElementById('campaign-manual-list'),
      campaignManualSearch: document.getElementById('campaign-manual-search'),
      campaignManualCount: document.getElementById('campaign-manual-count'),
      campaignManualMore: document.getElementById('campaign-manual-more'),
      campaignAutomationSettings: document.getElementById('campaign-automation-settings'),
      campaignAutomationRespectCooldown: document.getElementById('campaign-automation-respect-cooldown'),
      campaignPunctualSettings: document.getElementById('campaign-punctual-settings'),
      campaignPunctualRespectCooldown: document.getElementById('campaign-punctual-respect-cooldown'),
      campaignPunctualCooldownDays: document.getElementById('campaign-punctual-cooldown-days'),
      campaignSegmentDaysField: document.getElementById('campaign-segment-days-field'),
      campaignSegmentDays: document.getElementById('campaign-segment-days'),
      campaignPriority: document.getElementById('campaign-priority'),
      campaignMaxAttempts: document.getElementById('campaign-max-attempts'),
      campaignRetryDays: document.getElementById('campaign-retry-days'),
      campaignCooldownDays: document.getElementById('campaign-cooldown-days'),
      campaignStopOnBooking: document.getElementById('campaign-stop-on-booking'),
      campaignStopOnReply: document.getElementById('campaign-stop-on-reply'),
      campaignRestartAfterVisit: document.getElementById('campaign-restart-after-visit'),
      campaignScheduleMode: document.getElementById('campaign-schedule-mode'),
      campaignScheduleModeLabel: document.getElementById('campaign-schedule-mode-label'),
      campaignScheduledAtLabel: document.getElementById('campaign-scheduled-at-label'),
      campaignScheduledAt: document.getElementById('campaign-scheduled-at'),
      campaignBudget: document.getElementById('campaign-budget'),
      campaignBudgetPreview: document.getElementById('campaign-budget-preview'),
      campaignStatus: document.getElementById('campaign-status'),
      campaignTemplateName: document.getElementById('campaign-template-name'),
      campaignTemplateLanguage: document.getElementById('campaign-template-language'),
      campaignTemplateCreate: document.getElementById('campaign-template-create'),
      campaignTemplateSync: document.getElementById('campaign-template-sync'),
      campaignTemplateState: document.getElementById('campaign-template-state'),
      campaignTemplateFeedback: document.getElementById('campaign-template-feedback'),
      campaignWhatsappTemplate: document.getElementById('campaign-whatsapp-template'),
      campaignMessage: document.getElementById('campaign-message'),
      campaignEmojiToggle: document.getElementById('campaign-emoji-toggle'),
      campaignEmojiPicker: document.getElementById('campaign-emoji-picker'),
      campaignEmojiSearch: document.getElementById('campaign-emoji-search'),
      campaignEmojiCategories: document.getElementById('campaign-emoji-categories'),
      campaignEmojiGrid: document.getElementById('campaign-emoji-grid'),
      campaignImage: document.getElementById('campaign-image'),
      campaignImagePreview: document.getElementById('campaign-image-preview'),
      campaignImagePreviewImg: document.getElementById('campaign-image-preview-img'),
      campaignImageRemove: document.getElementById('campaign-image-remove'),
      campaignFormFeedback: document.getElementById('campaign-form-feedback'),
      campaignSubmit: document.getElementById('campaign-submit'),
      campaignDeleteDialog: document.getElementById('campaign-delete-dialog'),
      campaignDeleteClose: document.getElementById('campaign-delete-close'),
      campaignDeleteCancel: document.getElementById('campaign-delete-cancel'),
      campaignDeleteConfirm: document.getElementById('campaign-delete-confirm'),
      campaignDeleteName: document.getElementById('campaign-delete-name'),
      campaignDeleteFeedback: document.getElementById('campaign-delete-feedback'),
      campaignActivationDialog: document.getElementById('campaign-activation-dialog'),
      campaignActivationClose: document.getElementById('campaign-activation-close'),
      campaignActivationCancel: document.getElementById('campaign-activation-cancel'),
      campaignActivationConfirm: document.getElementById('campaign-activation-confirm'),
      campaignActivationName: document.getElementById('campaign-activation-name'),
      campaignActivationCopy: document.getElementById('campaign-activation-copy'),
      campaignActivationSummary: document.getElementById('campaign-activation-summary'),
      campaignActivationFeedback: document.getElementById('campaign-activation-feedback'),
      templateDialog: document.getElementById('template-dialog'),
      templateDialogTitle: document.getElementById('template-dialog-title'),
      templateDialogClose: document.getElementById('template-dialog-close'),
      templateDialogCancel: document.getElementById('template-dialog-cancel'),
      templateForm: document.getElementById('template-form'),
      templateId: document.getElementById('template-id'),
      templateInternalName: document.getElementById('template-internal-name'),
      templateMetaName: document.getElementById('template-meta-name'),
      templateCategoryMarketing: document.getElementById('template-category-marketing'),
      templateCategoryUtility: document.getElementById('template-category-utility'),
      templateCategoryLabel: document.getElementById('template-category-label'),
      templateLanguage: document.getElementById('template-language'),
      templateBody: document.getElementById('template-body'),
      templateEmojiToggle: document.getElementById('template-emoji-toggle'),
      templateEmojiPicker: document.getElementById('template-emoji-picker'),
      templateImage: document.getElementById('template-image'),
      templateImagePreview: document.getElementById('template-image-preview'),
      templateImagePreviewImg: document.getElementById('template-image-preview-img'),
      templateImageRemove: document.getElementById('template-image-remove'),
      templateVariablePanel: document.getElementById('template-variable-panel'),
      templateLivePreview: document.getElementById('template-live-preview'),
      templateLiveImage: document.getElementById('template-live-image'),
      templateChecklist: document.getElementById('template-checklist'),
      templatePreviewStatus: document.getElementById('template-preview-status'),
      templateFormFeedback: document.getElementById('template-form-feedback'),
      templateSaveSubmit: document.getElementById('template-save-submit'),
      templateDeleteDialog: document.getElementById('template-delete-dialog'),
      templateDeleteClose: document.getElementById('template-delete-close'),
      templateDeleteCancel: document.getElementById('template-delete-cancel'),
      templateDeleteConfirm: document.getElementById('template-delete-confirm'),
      templateDeleteName: document.getElementById('template-delete-name'),
      templateDeleteFeedback: document.getElementById('template-delete-feedback'),
      reportsRange: document.getElementById('reports-range'),
      reportsFutureDays: document.getElementById('reports-future-days'),
      reportsInactiveDays: document.getElementById('reports-inactive-days'),
      reportsRefresh: document.getElementById('reports-refresh'),
      reportsSubtitle: document.getElementById('reports-subtitle'),
      reportTotalAppointments: document.getElementById('report-total-appointments'),
      reportTotalCopy: document.getElementById('report-total-copy'),
      reportCompletedAppointments: document.getElementById('report-completed-appointments'),
      reportCompletedCopy: document.getElementById('report-completed-copy'),
      reportCancelledAppointments: document.getElementById('report-cancelled-appointments'),
      reportCancelledCopy: document.getElementById('report-cancelled-copy'),
      reportNoShowAppointments: document.getElementById('report-no-show-appointments'),
      reportNoShowCopy: document.getElementById('report-no-show-copy'),
      reportActiveCustomers: document.getElementById('report-active-customers'),
      reportCustomersCopy: document.getElementById('report-customers-copy'),
      reportChatConversion: document.getElementById('report-chat-conversion'),
      reportChatConversionCopy: document.getElementById('report-chat-conversion-copy'),
      reportCustomerMix: document.getElementById('report-customer-mix'),
      reportCustomerMixCopy: document.getElementById('report-customer-mix-copy'),
      reportVisitGap: document.getElementById('report-visit-gap'),
      reportVisitGapCopy: document.getElementById('report-visit-gap-copy'),
      reportFutureTotal: document.getElementById('report-future-total'),
      reportFutureCopy: document.getElementById('report-future-copy'),
      reportFutureProfessionals: document.getElementById('report-future-professionals'),
      reportInactiveCopy: document.getElementById('report-inactive-copy'),
      reportInactiveTable: document.getElementById('report-inactive-table'),
      reportRevenueNote: document.getElementById('report-revenue-note'),
      reportStatusBars: document.getElementById('report-status-bars'),
      reportServicesTable: document.getElementById('report-services-table'),
      reportProfessionalsTable: document.getElementById('report-professionals-table'),
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
      agendaLegend: document.getElementById('agenda-legend'),
      agendaProfessionalTabs: document.getElementById('agenda-professional-tabs'),
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
      appointmentForce: document.getElementById('appointment-force'),
      appointmentFeedback: document.getElementById('appointment-feedback'),
      businessSettingsForm: document.getElementById('business-settings-form'),
      businessLogo: document.getElementById('business-logo'),
      businessLogoPicker: document.getElementById('business-logo-picker'),
      businessLogoPreview: document.getElementById('business-logo-preview'),
      businessLogoRemove: document.getElementById('business-logo-remove'),
      businessName: document.getElementById('business-name'),
      businessWeekdaysEnabled: document.getElementById('business-weekdays-enabled'),
      businessWeekdaysStart: document.getElementById('business-weekdays-start'),
      businessWeekdaysEnd: document.getElementById('business-weekdays-end'),
      businessSaturdayEnabled: document.getElementById('business-saturday-enabled'),
      businessSaturdayStart: document.getElementById('business-saturday-start'),
      businessSaturdayEnd: document.getElementById('business-saturday-end'),
      businessSundayEnabled: document.getElementById('business-sunday-enabled'),
      businessSundayStart: document.getElementById('business-sunday-start'),
      businessSundayEnd: document.getElementById('business-sunday-end'),
      businessSettingsSubmit: document.getElementById('business-settings-submit'),
      businessSettingsFeedback: document.getElementById('business-settings-feedback')
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

    function isAttendedAppointment(appointment) {
      return isActiveAppointment(appointment) &&
        (appointment.status === 'COMPLETED' || new Date(appointment.startAt) < new Date())
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

    const iconPaths = {
      'arrow-left': '<path d="M19 12H5"></path><path d="m12 19-7-7 7-7"></path>',
      'arrow-right': '<path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>',
      calendar: '<rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h18"></path>',
      camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3"></circle>',
      chart: '<path d="M3 3v18h18"></path><path d="M7 16V9"></path><path d="M12 16V5"></path><path d="M17 16v-3"></path>',
      chevron: '<path d="m6 9 6 6 6-6"></path>',
      clock: '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path>',
      copy: '<rect width="14" height="14" x="8" y="8" rx="2"></rect><rect width="14" height="14" x="2" y="2" rx="2"></rect>',
      edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>',
      grid: '<rect width="7" height="7" x="3" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="14" rx="1"></rect><rect width="7" height="7" x="3" y="14" rx="1"></rect>',
      lightbulb: '<path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M8.5 14.5a6 6 0 1 1 7 0c-.7.55-1.1 1.36-1.1 2.25V17H9.6v-.25c0-.89-.4-1.7-1.1-2.25z"></path>',
      list: '<path d="M8 6h13"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M3 6h.01"></path><path d="M3 12h.01"></path><path d="M3 18h.01"></path>',
      mail: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path>',
      megaphone: '<path d="m3 11 18-5v12L3 14v-3z"></path><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"></path>',
      message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>',
      more: '<circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle>',
      bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>',
      document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h8"></path>',
      whatsapp: '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479s1.065 2.875 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.693.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.981.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 0 1 6.988 2.894 9.825 9.825 0 0 1 2.9 6.988c-.003 5.45-4.437 9.884-9.882 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.3-1.654a11.882 11.882 0 0 0 5.688 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"></path>',
      paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>',
      plus: '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
      professional: '<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"></path><circle cx="10" cy="7" r="4"></circle><path d="M20 8v6"></path><path d="M23 11h-6"></path>',
      scissors: '<circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M20 4 8.12 15.88"></path><path d="M14.47 14.48 20 20"></path><path d="M8.12 8.12 12 12"></path>',
      search: '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path>',
      refresh: '<path d="M20 11a8.1 8.1 0 1 0 .5 4"></path><path d="M20 4v7h-7"></path>',
      send: '<path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path>',
      smile: '<circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><path d="M9 9h.01"></path><path d="M15 9h.01"></path>',
      settings: '<path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5z"></path><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.6.76 1 1.4 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"></path>',
      tag: '<path d="M20.59 13.41 11 3.83A2.8 2.8 0 0 0 9 3H4a1 1 0 0 0-1 1v5c0 .75.3 1.47.83 2l9.58 9.59a2 2 0 0 0 2.83 0l4.35-4.35a2 2 0 0 0 0-2.83z"></path><circle cx="7.5" cy="7.5" r=".5"></circle>',
      trash: '<path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path>',
      user: '<path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="7" r="4"></circle>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>'
    }

    function icon(name) {
      const paths = iconPaths[name] || ''
      const className = name === 'whatsapp' ? 'ti ti-brand' : 'ti'
      return '<svg class="' + className + '" viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>'
    }

    function hydrateIcons(root = document) {
      for (const node of root.querySelectorAll('[data-icon]')) {
        node.innerHTML = icon(node.dataset.icon)
      }
    }

    function hydrateWorkspaceNav() {
      const nav = document.querySelector('.workspace-nav')
      if (!nav) return

      const items = [
        { section: 'conversations', label: 'Conversaciones', icon: 'message', active: true },
        { section: 'agenda', label: 'Agenda', icon: 'calendar' },
        { section: 'customers', label: 'Clientes', icon: 'users' },
        { section: 'professionals', label: 'Profesionales', icon: 'professional' },
        { section: 'services', label: 'Servicios', icon: 'scissors' },
        { section: 'campaigns', label: 'Marketing', icon: 'megaphone', marketingView: 'templates' },
        { section: 'reports', label: 'Reportes', icon: 'chart' },
        { section: 'settings', label: 'Ajustes', icon: 'settings' }
      ]

      nav.innerHTML =
        '<div class="crm-brand">' +
          '<div class="brand-mark">S</div>' +
          '<div>' +
            '<strong>CRM Salon AI</strong>' +
            '<span>Atenci&oacute;n y reservas</span>' +
          '</div>' +
        '</div>' +
        items.map((item) => {
          const button = '<button class="' + (item.active ? 'active' : '') + '" type="button" data-nav-section="' + item.section + '"' + (item.marketingView ? ' data-marketing-nav="' + item.marketingView + '"' : '') + '>' +
            '<span data-icon="' + item.icon + '"></span>' +
            '<strong>' + item.label + '</strong>' +
            (item.label === 'Conversaciones' ? '<em class="nav-badge" id="nav-handoff-badge" hidden>0</em>' : '') +
          '</button>'
          if (item.section !== 'campaigns') return button
          return button +
            '<div class="nav-subitems" aria-label="Marketing">' +
              '<button type="button" data-nav-section="campaigns" data-marketing-nav="templates">Plantillas</button>' +
              '<button type="button" data-nav-section="campaigns" data-marketing-nav="campaigns">Campa&ntilde;as</button>' +
            '</div>'
        }).join('') +
        '<div class="nav-user">' +
          '<div class="mini-avatar">JS</div>' +
          '<div class="nav-user-info">' +
            '<strong>Juan Sal&oacute;n</strong>' +
            '<span>Administrador</span>' +
          '</div>' +
          '<div class="nav-user-status">' +
            '<span class="nav-online-dot"></span>Online' +
          '</div>' +
        '</div>'

      hydrateIcons(nav)
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

    function showCrmToast(message, type = 'info') {
      if (!els.crmToast) return
      window.clearTimeout(state.crmToastTimer)
      els.crmToast.textContent = message
      els.crmToast.className = 'crm-toast visible ' + type
      state.crmToastTimer = window.setTimeout(() => {
        els.crmToast.className = 'crm-toast'
      }, 5200)
    }

    function requestCrmConfirmation(key, message) {
      const now = Date.now()
      if (state.pendingUiConfirmation?.key === key && state.pendingUiConfirmation.expiresAt > now) {
        state.pendingUiConfirmation = null
        return true
      }
      state.pendingUiConfirmation = { key, expiresAt: now + 7000 }
      showCrmToast(message + ' Volve a tocar la accion para confirmar.', 'error')
      return false
    }

    async function loadBasics() {
      const businesses = await getJson('/businesses')
      state.business = businesses[0] || null
      state.businessId = state.business?.id || null
      state.businessHours = state.businessId
        ? await getJson('/business-hours?businessId=' + encodeURIComponent(state.businessId))
        : []
      state.whatsappSettings = state.businessId
        ? await getJson('/businesses/' + state.businessId + '/whatsapp-settings')
        : null
      state.aiSettings = await getJson('/crm/ai-settings' + (state.businessId ? '?businessId=' + encodeURIComponent(state.businessId) : ''))
      state.professionals = await getJson('/professionals')
      state.services = await getJson('/services')
      state.customers = await getJson('/customers')
      renderBusinessSettings()
      renderWhatsappSettings()
      applyProfessionalBusinessHourLimits()
      renderAiControls()
      renderProfessionals()
      renderServices()
      renderAgendaFilters()
      renderAppointmentFormOptions()
      renderAgenda()
    }

    async function loadCustomerOverview(options = {}) {
      const params = new URLSearchParams()
      params.set('page', String(options.page || state.customerOverviewPagination.page || 1))
      params.set('take', String(state.customerOverviewPagination.take || 25))
      params.set('status', state.customerFilter)
      params.set('inactiveDays', String(state.customerInactiveDays))
      if (state.businessId) params.set('businessId', state.businessId)
      if (state.customerSearch) params.set('q', state.customerSearch)
      els.customerTableBody.innerHTML = '<tr><td colspan="6"><div class="customer-list-empty">Cargando clientes...</div></td></tr>'

      try {
        const result = await getJson('/customers/overview?' + params.toString())
        state.customerOverview = result.items || []
        state.customerOverviewCounts = result.counts || state.customerOverviewCounts
        state.customerOverviewPagination = result.pagination || state.customerOverviewPagination
        if (!state.customerOverview.some((customer) => customer.id === state.selectedCustomerId)) {
          state.selectedCustomerId = state.customerOverview[0]?.id || null
        }
        renderCustomerOverview()
      } catch (error) {
        els.customerTableBody.innerHTML = '<tr><td colspan="6"><div class="customer-list-empty">' + escapeHtml(error.message) + '</div></td></tr>'
      }
    }

    function renderCustomerOverview() {
      const counts = state.customerOverviewCounts
      const pagination = state.customerOverviewPagination
      els.customersTotal.textContent = String(counts.total || 0)
      els.customersActive.textContent = String(counts.active || 0)
      els.customersInactive.textContent = String(counts.inactive || 0)
      els.customersNew.textContent = String(counts.new || 0)

      for (const button of els.customerFilterTabs.querySelectorAll('[data-customer-filter]')) {
        button.classList.toggle('active', button.dataset.customerFilter === state.customerFilter)
      }

      if (!state.customerOverview.length) {
        els.customerTableBody.innerHTML = '<tr><td colspan="6"><div class="customer-list-empty">No hay clientes que coincidan con este filtro.</div></td></tr>'
      } else {
        els.customerTableBody.innerHTML = state.customerOverview.map((customer) => {
          const nextAppointment = customer.nextAppointment
          const isSelected = customer.id === state.selectedCustomerId
          const avatarTone = customerAvatarTone(customer)
          return '<tr class="' + (isSelected ? 'active' : '') + '" data-customer-id="' + customer.id + '">' +
            '<td><div class="customer-cell">' +
              '<div class="customer-list-avatar tone-' + avatarTone + '">' + escapeHtml(contactInitials(customer.name, customer.phone)) + '</div>' +
              '<div class="customer-cell-copy"><strong>' + escapeHtml(customer.name) + '</strong><span>' + escapeHtml(formatCustomerPhone(customer.phone)) + '</span></div>' +
            '</div></td>' +
            '<td>' + escapeHtml(customer.lastVisit ? formatCustomerDate(customer.lastVisit) : '--') + '</td>' +
            '<td>' + escapeHtml(nextAppointment ? formatCustomerDateTime(nextAppointment.startAt) : '--') + '</td>' +
            '<td>' + escapeHtml(customer.averageFrequencyDays ? 'Cada ' + customer.averageFrequencyDays + ' dias' : '--') + '</td>' +
            '<td title="Calculado con los precios actuales">' + escapeHtml(formatEstimatedSpend(customer)) + '</td>' +
            '<td><span class="customer-status ' + (customer.status === 'inactive' ? 'inactive' : '') + '">' + (customer.status === 'inactive' ? 'Inactivo' : 'Activo') + '</span></td>' +
          '</tr>'
        }).join('')
      }

      const start = pagination.total ? (pagination.page - 1) * pagination.take + 1 : 0
      const end = Math.min(pagination.page * pagination.take, pagination.total)
      els.customerPaginationCopy.textContent = start + '–' + end + ' de ' + pagination.total + ' clientes'
      els.customerPageNumber.textContent = pagination.page + ' / ' + pagination.totalPages
      els.customerPagePrev.disabled = pagination.page <= 1
      els.customerPageNext.disabled = pagination.page >= pagination.totalPages

      for (const row of els.customerTableBody.querySelectorAll('[data-customer-id]')) {
        row.addEventListener('click', () => {
          state.selectedCustomerId = row.dataset.customerId
          renderCustomerOverview()
        })
      }
      renderCustomerProfile()
    }

    function renderCustomerProfile() {
      const customer = selectedOverviewCustomer()
      if (!customer) {
        els.customerProfilePanel.innerHTML = '<div class="customer-profile-empty">Elegi un cliente para ver su resumen.</div>'
        return
      }

      const next = customer.nextAppointment
      const avatarTone = customerAvatarTone(customer)
      const lastVisitDays = customer.lastVisit
        ? Math.max(0, Math.round((Date.now() - new Date(customer.lastVisit).getTime()) / 86400000))
        : null
      const openConversation = customer.openConversation
        ? '<button class="customer-open-conversation" type="button" data-open-customer-conversation>' +
            '<strong>Conversacion abierta &middot; Aun no reservo</strong><span>Ver conversacion</span>' +
          '</button>'
        : ''
      const history = customer.recentAppointments.length
        ? customer.recentAppointments.map((appointment) => {
            return '<div class="customer-history-row">' +
              '<span class="customer-history-icon">' + icon('calendar') + '</span>' +
              '<span>' + escapeHtml(formatCustomerDateTime(appointment.startAt)) + '</span>' +
              '<strong>' + escapeHtml(appointment.service?.name || 'Servicio') + '</strong>' +
              '<span>' + escapeHtml(appointment.professional?.name || 'Profesional') + '</span>' +
              '<span class="customer-history-price" title="Precio actual">' + escapeHtml(formatAppointmentCurrentPrice(appointment)) + '</span>' +
            '</div>'
          }).join('')
        : '<div class="customer-list-empty">Todavia no tiene visitas registradas.</div>'
      const notes = customer.notes.length
        ? customer.notes.map((note) => {
            return '<div class="customer-profile-note"><span>' + escapeHtml(note.body) + '</span><time>' + escapeHtml(formatCustomerDate(note.createdAt)) + '</time></div>'
          }).join('')
        : '<div class="customer-profile-note"><span>Todavia no hay notas.</span></div>'
      const marketingEnabled = customer.marketingStatus === 'ACTIVE'
      const marketingStatusCopy = marketingEnabled
        ? 'Autorizado para recibir campa&ntilde;as.'
        : customer.marketingStatus === 'OPTED_OUT'
          ? 'El cliente solicit&oacute; la baja de promociones.'
          : customer.marketingStatus === 'DECLINED'
            ? 'Se consult&oacute; y el cliente rechaz&oacute; recibir promociones.'
          : 'Todav&iacute;a no autoriz&oacute; el env&iacute;o de promociones.'
      const marketingActions = marketingEnabled
        ? '<button class="secondary" type="button" data-marketing-status="OPTED_OUT">Revocar autorizaci&oacute;n</button>'
        : '<div class="customer-marketing-actions">' +
            '<button class="primary" type="button" data-marketing-status="ACTIVE">Autorizar promociones</button>' +
            (customer.marketingStatus === 'NOT_AUTHORIZED'
              ? '<button class="secondary" type="button" data-marketing-status="DECLINED">Registrar rechazo</button>'
              : '') +
          '</div>'
      const marketingCard = '<section class="customer-profile-section"><div class="row">' +
        '<div><h4 class="customer-section-title">' + icon('mail') + 'Promociones</h4>' +
          '<p class="hint">' + marketingStatusCopy + '</p></div>' +
        marketingActions +
      '</div></section>'

      els.customerProfilePanel.innerHTML = '<div class="customer-profile-content">' +
        '<header class="customer-profile-head">' +
          '<div class="customer-profile-avatar tone-' + avatarTone + '">' + escapeHtml(contactInitials(customer.name, customer.phone)) + '</div>' +
          '<div><h3>' + escapeHtml(customer.name) + '</h3><a href="tel:' + escapeHtml(customer.phone) + '">' + escapeHtml(formatCustomerPhone(customer.phone)) + '</a></div>' +
          '<div class="customer-profile-actions">' +
            '<div class="customer-profile-contact-row">' +
              '<a class="customer-contact-action whatsapp" href="https://wa.me/' + encodeURIComponent(normalizePhone(customer.phone)) + '" target="_blank" rel="noopener" title="Abrir WhatsApp" aria-label="Abrir WhatsApp">' + icon('whatsapp') + '</a>' +
              '<button class="customer-contact-action conversation" type="button" data-open-customer-conversation title="' + (customer.conversation ? 'Abrir conversacion en el CRM' : 'Este cliente no tiene una conversacion') + '" aria-label="Abrir conversacion en el CRM" ' + (customer.conversation ? '' : 'disabled') + '>' + icon('mail') + '</button>' +
            '</div>' +
            '<button class="primary" type="button" data-schedule-customer>' + icon('calendar') + 'Agendar turno</button>' +
            '<details class="customer-profile-menu">' +
              '<summary title="Mas opciones" aria-label="Mas opciones">' + icon('more') + '</summary>' +
              '<div class="customer-profile-menu-popover"><button type="button" data-delete-customer>' + icon('trash') + 'Eliminar cliente</button></div>' +
            '</details>' +
          '</div>' +
        '</header>' +
        '<div class="customer-profile-stats">' +
          '<div class="customer-profile-stat"><strong>' + customer.visitCount + '</strong><span>visitas</span></div>' +
          '<div class="customer-profile-stat"><strong>' + escapeHtml(formatEstimatedSpend(customer)) + '</strong><span title="Calculado con precios actuales">gasto estimado &#9432;</span></div>' +
          '<div class="customer-profile-stat"><strong>' + (lastVisitDays === null ? '--' : lastVisitDays + ' dias') + '</strong><span>desde ultima visita</span></div>' +
        '</div>' +
        (next
          ? '<div class="customer-next-card"><span class="customer-next-icon">' + icon('calendar') + '</span><div><span>Proximo turno</span><strong>' + escapeHtml(formatCustomerDateTime(next.startAt)) + '</strong><small>' + escapeHtml(next.service.name) + ' &middot; ' + escapeHtml(next.professional.name) + '</small></div></div>'
          : '<div class="customer-next-card"><span class="customer-next-icon">' + icon('calendar') + '</span><div><span>Proximo turno</span><strong>Sin turno agendado</strong></div></div>') +
        '<div class="customer-frequent-grid">' +
          '<div class="customer-frequent-item"><span>' + icon('professional') + 'Profesional frecuente</span><strong>' + escapeHtml(customer.frequentProfessional || '--') + '</strong><small>Inferido de las ultimas 8 visitas</small></div>' +
          '<div class="customer-frequent-item"><span>' + icon('scissors') + 'Servicio frecuente</span><strong>' + escapeHtml(customer.frequentService || '--') + '</strong><small>Inferido de las ultimas 8 visitas</small></div>' +
        '</div>' +
        marketingCard +
        '<section class="customer-profile-section"><h4 class="customer-section-title">' + icon('calendar') + 'Actividad</h4>' + openConversation + '<div class="customer-history">' + history + '</div></section>' +
        '<section class="customer-profile-section"><div class="row"><h4 class="customer-section-title">' + icon('document') + 'Notas</h4><button class="details-link" type="button" data-add-customer-note>+ Agregar nota</button></div><div class="customer-profile-notes">' + notes + '</div></section>' +
      '</div>'

      els.customerProfilePanel.querySelector('[data-schedule-customer]')?.addEventListener('click', () => openOverviewCustomerAppointment(customer))
      els.customerProfilePanel.querySelector('[data-add-customer-note]')?.addEventListener('click', () => openCustomerDialog('note', customer))
      for (const button of els.customerProfilePanel.querySelectorAll('[data-marketing-status]')) {
        button.addEventListener('click', () => openMarketingConfirmDialog(customer, button.dataset.marketingStatus))
      }
      for (const button of els.customerProfilePanel.querySelectorAll('[data-open-customer-conversation]')) {
        button.addEventListener('click', () => openOverviewCustomerConversation(customer))
      }
      els.customerProfilePanel.querySelector('[data-delete-customer]')?.addEventListener('click', () => deleteOverviewCustomer(customer))
    }

    function selectedOverviewCustomer() {
      return state.customerOverview.find((customer) => customer.id === state.selectedCustomerId) || null
    }

    function customerAvatarTone(customer) {
      const value = String(customer.id || customer.phone || customer.name || '')
      let hash = 0
      for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
      }
      return Math.abs(hash) % 8
    }

    function formatEstimatedSpend(customer) {
      return customer.visitCount > 0 ? formatCurrency(customer.estimatedSpend) : '--'
    }

    function formatAppointmentCurrentPrice(appointment) {
      const price = appointment.service?.price
      return price === null || price === undefined ? '--' : formatCurrency(price)
    }

    function formatCustomerDate(value) {
      return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
    }

    function formatCustomerPhone(value) {
      const original = String(value || '').trim()
      const digits = normalizePhone(original)
      let national = ''

      if (digits.length === 13 && digits.startsWith('549')) {
        national = digits.slice(3)
      } else if (digits.length === 12 && digits.startsWith('54')) {
        national = digits.slice(2)
        if (national.startsWith('9')) national = national.slice(1)
      } else if (digits.length === 10) {
        national = digits
      }

      if (national.length === 10 && national.startsWith('11')) {
        return '+54 9 11 ' + national.slice(2, 6) + '-' + national.slice(6)
      }

      if (digits.length === 13 && digits.startsWith('549')) {
        return '+54 9 ' + digits.slice(3, 5) + ' ' + digits.slice(5, 9) + '-' + digits.slice(9)
      }

      return original
    }

    function formatCustomerDateTime(value) {
      const date = new Date(value)
      const datePart = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short' })
        .format(date)
        .replace('.', '')
      const timePart = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
      return datePart + ' · ' + timePart
    }

    function openOverviewCustomerAppointment(customer) {
      openAppointmentDialog()
      els.appointmentCustomer.value = customer.id
      syncAppointmentCustomerFields()
    }

    async function openOverviewCustomerConversation(customer) {
      if (!customer.conversation) return
      if (!state.conversations.some((conversation) => conversation.id === customer.conversation.id)) {
        state.conversations.unshift(customer.conversation)
      }
      setSection('conversations')
      await selectConversation(customer.conversation.id)
    }

    function deleteOverviewCustomer(customer) {
      openCustomerDeleteDialog(customer)
    }

    function openCustomerDeleteDialog(customer) {
      state.customerDeleteCustomerId = customer.id
      els.customerDeleteName.textContent = 'Eliminar a ' + customer.name
      els.customerDeleteFeedback.textContent = ''
      els.customerDeleteConfirm.disabled = false
      els.customerDeleteConfirm.textContent = 'Eliminar cliente'
      els.customerDeleteDialog.hidden = false
      requestAnimationFrame(() => els.customerDeleteCancel.focus())
    }

    function closeCustomerDeleteDialog() {
      els.customerDeleteDialog.hidden = true
      state.customerDeleteCustomerId = null
      els.customerDeleteFeedback.textContent = ''
      els.customerDeleteConfirm.disabled = false
      els.customerDeleteConfirm.textContent = 'Eliminar cliente'
    }

    function openMarketingConfirmDialog(customer, targetStatus) {
      state.pendingMarketingChange = { customerId: customer.id, targetStatus }
      els.marketingConfirmName.textContent = customer.name
      els.marketingConfirmCopy.textContent = targetStatus === 'ACTIVE'
        ? 'Quedará autorizado para recibir campañas promocionales del comercio.'
        : targetStatus === 'DECLINED'
          ? 'Se registrará que el cliente rechazó recibir promociones.'
          : 'Dejará de recibir todas las campañas promocionales del comercio.'
      els.marketingConfirmWarning.innerHTML = targetStatus === 'ACTIVE'
        ? '<strong>Al confirmar:</strong><ul><li>Se registrar&aacute; una autorizaci&oacute;n manual.</li><li>Podr&aacute; aparecer en los segmentos compatibles.</li></ul>'
        : targetStatus === 'DECLINED'
          ? '<strong>Al confirmar:</strong><ul><li>Quedar&aacute; excluido de todas las campa&ntilde;as.</li><li>Se guardar&aacute; el rechazo como decisi&oacute;n presencial.</li></ul><small>Los recordatorios de turnos no se modifican.</small>'
          : '<strong>Al confirmar:</strong><ul><li>Se revocar&aacute; la autorizaci&oacute;n anterior.</li><li>Quedar&aacute; excluido de campa&ntilde;as autom&aacute;ticas y puntuales.</li></ul><small>Los recordatorios de turnos no se modifican.</small>'
      els.marketingConfirmSubmit.textContent = targetStatus === 'ACTIVE'
        ? 'Autorizar promociones'
        : targetStatus === 'DECLINED' ? 'Registrar rechazo' : 'Revocar autorizaci&oacute;n'
      els.marketingConfirmSubmit.className = targetStatus === 'ACTIVE' ? 'primary' : 'danger customer-delete-confirm'
      els.marketingConfirmFeedback.textContent = ''
      els.marketingConfirmDialog.hidden = false
      requestAnimationFrame(() => els.marketingConfirmCancel.focus())
    }

    function closeMarketingConfirmDialog() {
      els.marketingConfirmDialog.hidden = true
      state.pendingMarketingChange = null
      els.marketingConfirmFeedback.textContent = ''
      els.marketingConfirmSubmit.disabled = false
    }

    async function saveMarketingPreference() {
      const pending = state.pendingMarketingChange
      if (!pending) return closeMarketingConfirmDialog()
      try {
        els.marketingConfirmSubmit.disabled = true
        els.marketingConfirmFeedback.textContent = ''
        await getJson('/customers/' + pending.customerId + '/marketing-preference', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessId: state.businessId,
            status: pending.targetStatus,
            source: 'MANUAL'
          })
        })
        closeMarketingConfirmDialog()
        await loadCustomerOverview()
        if (state.campaignsLoaded) await loadCampaigns()
      } catch (error) {
        els.marketingConfirmFeedback.textContent = error.message
        els.marketingConfirmSubmit.disabled = false
      }
    }

    async function confirmCustomerDelete() {
      const customer = state.customerOverview.find((item) => item.id === state.customerDeleteCustomerId)
      if (!customer) {
        closeCustomerDeleteDialog()
        return
      }

      try {
        els.customerDeleteConfirm.disabled = true
        els.customerDeleteConfirm.textContent = 'Eliminando...'
        els.customerDeleteFeedback.textContent = ''
        await getJson('/customers/' + customer.id, { method: 'DELETE' })
        state.customers = state.customers.filter((item) => item.id !== customer.id)
        state.selectedCustomerId = null
        closeCustomerDeleteDialog()
        renderAppointmentFormOptions()
        await loadCustomerOverview()
      } catch (error) {
        els.customerDeleteFeedback.textContent = error.message
        els.customerDeleteConfirm.disabled = false
        els.customerDeleteConfirm.textContent = 'Eliminar cliente'
      }
    }

    async function loadConversations(options = {}) {
      if (state.isRefreshing) return
      state.isRefreshing = true
      const archiveView = state.conversationFilter === 'archived' ? 'archived' : 'active'
      const params = new URLSearchParams()
      params.set('take', '30')
      params.set('paginated', 'true')
      params.set('archive', archiveView)
      if (state.businessId) params.set('businessId', state.businessId)
      if (options.append && state.conversationNextCursor) params.set('cursor', state.conversationNextCursor)
      const query = params.toString() ? '?' + params.toString() : ''

      try {
        const page = await getJson('/crm/conversations' + query)
        state.loadedArchiveView = archiveView
        state.conversationNextCursor = page.nextCursor || null
        state.conversationCounts = page.counts || state.conversationCounts
        if (options.append) {
          const known = new Set(state.conversations.map((conversation) => conversation.id))
          state.conversations = state.conversations.concat(page.items.filter((conversation) => !known.has(conversation.id)))
        } else {
          state.conversations = page.items
        }
        state.conversations.sort((left, right) => latestConversationActivityAt(right) - latestConversationActivityAt(left))
        if (els.topConversationTotal) els.topConversationTotal.textContent = String(state.conversationCounts.active)
        renderConversations()
        renderAiControls()

        if (!options.append && !state.selected && state.conversations[0]) {
          await selectConversation(state.conversations[0].id)
        } else if (!options.append && state.selected) {
          const fresh = state.conversations.find((item) => item.id === state.selected.id)
          if (fresh) {
            state.selected = fresh
            await refreshSelectedConversation({ preserveReadingPosition: options.silent === true })
          } else {
            state.selected = null
            if (state.conversations[0]) await selectConversation(state.conversations[0].id)
          }
          renderConversations()
        }

        els.count.textContent = String(state.conversationCounts.active)
      } catch (error) {
        if (!options.silent) {
          els.list.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>'
        }
      } finally {
        state.isRefreshing = false
      }
    }

    function renderConversations() {
      const unreadCount = state.conversations.filter(isConversationUnread).length
      const conversations = filteredConversations()
      els.count.textContent = String(state.conversationCounts.active)
      els.unreadCount.textContent = String(unreadCount)
      els.handoffCount.textContent = String(state.conversationCounts.handoff)
      els.archivedCount.textContent = String(state.conversationCounts.archived)
      els.conversationMore.hidden = !state.conversationNextCursor

      for (const tab of els.conversationTabs.querySelectorAll('[data-conversation-filter]')) {
        tab.classList.toggle('active', tab.dataset.conversationFilter === state.conversationFilter)
      }

      if (conversations.length === 0) {
        const emptyCopy = state.conversationFilter === 'handoff'
          ? 'No hay conversaciones derivadas pendientes.'
          : state.conversationFilter === 'unread'
            ? 'No hay conversaciones sin leer.'
            : state.conversationFilter === 'archived'
              ? 'No hay conversaciones archivadas.'
            : 'No hay conversaciones que coincidan con la busqueda.'
        els.list.innerHTML = '<div class="empty">' + emptyCopy + '</div>'
        return
      }

      els.list.innerHTML = conversations.map((conversation) => {
        const last = conversation.messages?.[0]
        const active = state.selected?.id === conversation.id ? ' active' : ''
        const name = conversationDisplayName(conversation)
        const unread = isConversationUnread(conversation)
        return '<button class="conversation' + active + '" data-id="' + conversation.id + '">' +
          '<div class="conversation-avatar-wrap">' +
            '<div class="avatar">' + escapeHtml(contactInitials(name, conversation.phone)) + '</div>' +
            '<span class="conversation-online-dot"></span>' +
          '</div>' +
          '<div class="conversation-main">' +
            '<div class="row">' +
              '<div class="conversation-name">' + escapeHtml(name) + '</div>' +
              '<span class="conversation-time">' + escapeHtml(formatConversationTime(latestConversationActivityValue(conversation))) + '</span>' +
            '</div>' +
            '<p class="preview">' + escapeHtml(last?.body || conversation.lastMessage || 'Sin mensajes') + '</p>' +
            '<div class="conversation-status-line">' +
              '<span class="' + conversationStepChipClass(conversation.currentStep, conversation.aiEnabled) + '">' + escapeHtml(conversationStepLabel(conversation.currentStep, conversation.aiEnabled)) + '</span>' +
              (unread ? '<span class="conversation-unread-dot">1</span>' : '') +
            '</div>' +
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
      state.readConversationIds.add(id)
      state.selected = conversation
      await refreshSelectedConversation()
      if (isMobile()) {
        setMobileView('chat')
      }
    }

    async function refreshSelectedConversation(options = {}) {
      if (!state.selected) return
      const messageScroll = options.preserveReadingPosition
        ? {
            mode: els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 72 ? 'bottom' : 'preserve',
            top: els.messages.scrollTop
          }
        : { mode: 'bottom', top: 0 }
      await loadConversationMessages({ mergeExisting: options.preserveReadingPosition === true })
      await Promise.all([loadAppointments(), loadCustomerNotes()])
      renderSelected({ messageScroll })
      renderConversations()
    }

    async function loadConversationMessages(options = {}) {
      if (!state.selected) return
      const params = new URLSearchParams({ paginated: 'true', take: '100' })
      if (options.older && state.messageNextCursor) params.set('cursor', state.messageNextCursor)
      const page = await getJson('/crm/conversations/' + state.selected.id + '/messages?' + params.toString())
      if (options.mergeExisting) {
        const messagesById = new Map(state.messages.map((message) => [message.id, message]))
        for (const message of page.items) messagesById.set(message.id, message)
        state.messages = Array.from(messagesById.values())
          .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
      } else {
        state.messageNextCursor = page.nextCursor || null
        state.messages = options.older ? page.items.concat(state.messages) : page.items
      }
      if (options.older) renderMessages({ preserveScroll: true })
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

    async function loadCustomerNotes() {
      state.customerNotes = []
      if (!state.selected) return
      const customer = customerForPhone(state.selected.phone)
      if (!customer) {
        renderCustomerNotes()
        return
      }
      state.customerNotes = await getJson('/customers/' + customer.id + '/notes')
      renderCustomerNotes()
    }

    function renderCustomerNotes() {
      if (!state.customerNotes.length) {
        els.customerNotesList.className = 'customer-note-empty'
        els.customerNotesList.textContent = 'Todavia no hay notas para este cliente.'
        return
      }

      els.customerNotesList.className = 'customer-note-list'
      els.customerNotesList.innerHTML = state.customerNotes.map((note) => {
        return '<article class="customer-note-item">' +
          '<p>' + escapeHtml(note.body) + '</p>' +
          '<span>' + escapeHtml(formatDateTime(note.createdAt)) + '</span>' +
        '</article>'
      }).join('')
    }

    function openCustomerDialog(mode, explicitCustomer = null) {
      const customer = explicitCustomer || (state.selected ? customerForPhone(state.selected.phone) : null)
      if (mode !== 'create' && !customer) {
        showCrmToast('Primero crea el cliente desde un turno para poder guardar informacion.', 'error')
        return
      }

      state.customerDialogMode = mode
      state.customerDialogCustomerId = customer?.id || null
      const isNote = mode === 'note'
      const isCreate = mode === 'create'
      els.customerDialogTitle.textContent = isNote ? 'Agregar nota' : isCreate ? 'Nuevo cliente' : 'Editar cliente'
      els.customerDialogCopy.textContent = isNote
        ? 'Guarda informacion util para la proxima atencion de ' + customer.name + '.'
        : isCreate ? 'Carga los datos basicos para agregarlo al salon.' : 'Actualiza los datos visibles de este cliente.'
      els.customerNameField.hidden = isNote
      els.customerPhoneField.hidden = !isCreate
      els.customerNoteField.hidden = !isNote
      els.customerDialogName.value = customer?.name || ''
      els.customerDialogPhone.value = ''
      els.customerDialogNote.value = ''
      els.customerDialogFeedback.textContent = ''
      els.customerDialogSubmit.textContent = isNote ? 'Guardar nota' : isCreate ? 'Crear cliente' : 'Guardar cambios'
      els.customerDialogSubmit.disabled = false
      els.customerDialog.hidden = false
      requestAnimationFrame(() => {
        if (isNote) els.customerDialogNote.focus()
        else els.customerDialogName.focus()
      })
    }

    function closeCustomerDialog() {
      els.customerDialog.hidden = true
      els.customerDialogFeedback.textContent = ''
      els.customerDialogSubmit.disabled = false
    }

    async function saveCustomerDialog(event) {
      event.preventDefault()
      const isNote = state.customerDialogMode === 'note'
      const isCreate = state.customerDialogMode === 'create'
      const customer = state.customers.find((item) => item.id === state.customerDialogCustomerId) || selectedOverviewCustomer()
      if (!isCreate && !customer) return
      const value = (isNote ? els.customerDialogNote.value : els.customerDialogName.value).trim()
      if (!value) {
        els.customerDialogFeedback.textContent = isNote ? 'Escribi una nota antes de guardar.' : 'El nombre no puede quedar vacio.'
        return
      }

      const phone = els.customerDialogPhone.value.trim()
      if (isCreate && !phone) {
        els.customerDialogFeedback.textContent = 'El telefono es requerido.'
        return
      }

      if (!isNote && !isCreate && value === customer.name) {
        closeCustomerDialog()
        return
      }

      els.customerDialogSubmit.disabled = true
      els.customerDialogFeedback.textContent = ''
      try {
        if (isCreate) {
          const created = await getJson('/customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: value, phone })
          })
          state.customers = await getJson('/customers')
          state.selectedCustomerId = created.id
          await loadCustomerOverview({ page: 1 })
          renderAppointmentFormOptions()
        } else if (isNote) {
          await getJson('/customers/' + customer.id + '/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: value })
          })
          if (els.appShell.dataset.section === 'customers') await loadCustomerOverview()
          else await loadCustomerNotes()
        } else {
          const updated = await getJson('/customers/' + customer.id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: value })
          })
          state.customers = state.customers.map((item) => item.id === updated.id ? updated : item)
          if (els.appShell.dataset.section === 'customers') await loadCustomerOverview()
          else {
            renderSelected()
            renderConversations()
          }
        }
        closeCustomerDialog()
      } catch (error) {
        els.customerDialogFeedback.textContent = error.message
        els.customerDialogSubmit.disabled = false
      }
    }

    function renderSelected(options = {}) {
      const selected = state.selected
      if (!selected) return

      const name = conversationDisplayName(selected)
      const customer = customerForPhone(selected.phone)
      const avatar = contactInitials(name, selected.phone)
      els.chatAvatar.textContent = avatar
      els.chatPhone.textContent = name
      els.chatStatus.textContent = selected.phone
      els.stepChip.textContent = conversationStepLabel(selected.currentStep, selected.aiEnabled)
      els.stepChip.className = conversationStepChipClass(selected.currentStep, selected.aiEnabled)
      const canResolveHandoff = selected.currentStep === 'HUMAN_HANDOFF' || selected.aiEnabled === false
      els.resolveHandoff.hidden = !canResolveHandoff
      els.resolveHandoff.disabled = !canResolveHandoff
      els.conversationAiToggle.hidden = canResolveHandoff
      els.conversationAiToggle.disabled = canResolveHandoff
      els.conversationAiToggle.textContent = 'Atender manualmente'
      els.conversationAiToggle.className = 'secondary'
      els.detailAvatar.textContent = avatar
      els.detailName.textContent = name
      els.detailPhone.textContent = selected.phone
      els.detailPhone.href = 'tel:' + selected.phone
      els.detailWhatsapp.href = 'https://wa.me/' + normalizePhone(selected.phone)
      els.detailStep.textContent = conversationStepLabel(selected.currentStep, selected.aiEnabled)
      els.detailStep.className = conversationStepChipClass(selected.currentStep, selected.aiEnabled)
      els.detailMarketingStatus.textContent = customer ? 'Consultando...' : 'Sin cliente'
      els.detailMarketingStatus.className = 'chip'
      els.detailUpdated.textContent = formatDateTime(latestConversationActivityValue(selected))
      els.customerEdit.disabled = !customer
      els.archiveConversation.disabled = canResolveHandoff && !selected.archivedAt
      els.archiveConversation.textContent = selected.archivedAt ? 'Restaurar chat' : 'Archivar chat'
      if (customer) loadConversationMarketingStatus(customer, selected.id)

      renderMessages(options.messageScroll || {})
      updateComposerAvailability()
      renderAppointments()
    }

    async function loadConversationMarketingStatus(customer, conversationId) {
      if (!state.businessId) return
      try {
        const preference = await getJson('/customers/' + customer.id + '/marketing-preference?businessId=' + encodeURIComponent(state.businessId))
        if (state.selected?.id !== conversationId) return
        const authorized = preference.status === 'ACTIVE'
        els.detailMarketingStatus.textContent = authorized
          ? 'Promociones autorizadas'
          : preference.status === 'OPTED_OUT'
            ? 'Baja de promociones'
            : preference.status === 'DECLINED' ? 'Promociones rechazadas' : 'Sin autorización'
        els.detailMarketingStatus.className = 'chip ' + (authorized ? 'success' : 'warn')
      } catch {
        if (state.selected?.id !== conversationId) return
        els.detailMarketingStatus.textContent = 'No disponible'
        els.detailMarketingStatus.className = 'chip warn'
      }
    }

    function whatsappReplyWindowState(conversation = state.selected) {
      if (!conversation) {
        return { canReply: false, expiresAt: null }
      }

      let expiresAt = conversation.whatsappReplyWindowExpiresAt
        ? new Date(conversation.whatsappReplyWindowExpiresAt)
        : null

      if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
        const latestInbound = [...state.messages].reverse().find((message) => message.direction === 'INBOUND')
        expiresAt = latestInbound
          ? new Date(new Date(latestInbound.createdAt).getTime() + WHATSAPP_REPLY_WINDOW_MS)
          : null
      }

      return {
        canReply: Boolean(expiresAt && expiresAt.getTime() > Date.now()),
        expiresAt
      }
    }

    function formatReplyWindowRemaining(expiresAt) {
      const remainingMs = Math.max(0, expiresAt.getTime() - Date.now())
      const totalMinutes = Math.ceil(remainingMs / 60000)
      if (totalMinutes >= 60) {
        const hours = Math.floor(totalMinutes / 60)
        const minutes = totalMinutes % 60
        return hours + ' h' + (minutes ? ' ' + minutes + ' min' : '')
      }
      return totalMinutes + ' min'
    }

    function updateComposerAvailability() {
      const windowState = whatsappReplyWindowState()
      const isLocked = !windowState.canReply
      els.replyForm.classList.toggle('is-locked', isLocked)
      els.replyText.disabled = isLocked
      els.sendButton.disabled = isLocked
      els.composerWindowNotice.hidden = !isLocked
      els.composerWindowWhatsapp.href = state.selected
        ? 'https://wa.me/' + normalizePhone(state.selected.phone)
        : '#'

      for (const button of els.replyForm.querySelectorAll('.composer-icon')) {
        button.disabled = isLocked
      }

      if (isLocked) {
        els.replyText.value = ''
        els.replyText.placeholder = 'Respuesta deshabilitada: pasaron mas de 24 hs.'
        els.composerWindowText.textContent = 'Pasaron mas de 24 hs desde el ultimo mensaje del cliente. Espera que vuelva a escribir para responder desde el CRM.'
      } else {
        els.replyText.placeholder = 'Escribir mensaje...'
        els.composerWindowText.textContent = windowState.expiresAt
          ? 'Podes responder durante ' + formatReplyWindowRemaining(windowState.expiresAt) + '.'
          : ''
      }
    }

    function renderMessages(options = {}) {
      if (!state.messages.length) {
        els.messages.innerHTML = '<div class="empty">Esta conversacion no tiene mensajes guardados.</div>'
        return
      }

      const previousHeight = els.messages.scrollHeight
      const previousTop = els.messages.scrollTop
      let lastDay = ''
      const messageHtml = state.messages.map((message) => {
        const direction = message.direction === 'OUTBOUND' ? 'outbound' : 'inbound'
        const failed = direction === 'outbound' && message.status === 'failed'
        const deliveryStatus = failed
          ? '<span class="message-status-failed" title="' + escapeHtml(messageFailureText(message)) + '">No enviado</span>'
          : direction === 'outbound'
            ? '<span class="message-checks">&#10003;&#10003;</span>'
            : ''
        const createdAt = new Date(message.createdAt)
        const dayKey = createdAt.toDateString()
        const dayDivider = dayKey === lastDay ? '' : '<div class="message-day">' + escapeHtml(formatMessageDay(createdAt)) + '</div>'
        lastDay = dayKey
        return dayDivider + '<article class="message ' + direction + (failed ? ' failed' : '') + '">' +
          escapeHtml(message.body) +
          '<div class="message-time">' + escapeHtml(formatMessageTime(createdAt)) + deliveryStatus + '</div>' +
        '</article>'
      }).join('')
      els.messages.innerHTML = (state.messageNextCursor ? '<button class="message-load-older" id="message-load-older" type="button">Cargar mensajes anteriores</button>' : '') + messageHtml
      const olderButton = document.getElementById('message-load-older')
      olderButton?.addEventListener('click', () => loadConversationMessages({ older: true }))
      if (options.preserveScroll) {
        els.messages.scrollTop = previousTop + (els.messages.scrollHeight - previousHeight)
      } else if (options.mode === 'preserve') {
        els.messages.scrollTop = options.top
      } else {
        els.messages.scrollTop = els.messages.scrollHeight
      }
    }

    function messageFailureText(message) {
      return message.providerErrorMessage || message.providerErrorCode || 'WhatsApp rechazo el envio.'
    }

    function renderAppointments() {
      els.appointmentCount.textContent = String(state.appointments.length)
      if (els.topAppointmentTotal) els.topAppointmentTotal.textContent = String(state.appointments.length)
      if (!state.selected) {
        els.appointments.innerHTML = '<div class="empty">Sin cliente seleccionado.</div>'
        return
      }

      if (state.appointments.length === 0) {
        els.appointments.innerHTML = '<div class="empty">No hay turnos activos.</div>'
        return
      }

      els.appointments.innerHTML = state.appointments.map((appointment) => {
        const startAt = new Date(appointment.startAt)
        const day = new Intl.DateTimeFormat('es-AR', { day: '2-digit' }).format(startAt)
        const month = new Intl.DateTimeFormat('es-AR', { month: 'short' }).format(startAt).replace('.', '').toUpperCase()
        const time = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(startAt) + ' hs'
        return '<div class="item appointment-card">' +
          '<div class="appointment-date-tile"><strong>' + escapeHtml(day) + '</strong><span>' + escapeHtml(month) + '</span></div>' +
          '<div class="appointment-card-copy">' +
            '<div class="item-title">' + escapeHtml(appointment.service?.name || 'Servicio') + '</div>' +
            '<p>Profesional: ' + escapeHtml(appointment.professional?.name || 'Profesional') + '</p>' +
            '<p>' + escapeHtml(time) + '</p>' +
            '<span class="chip step-completed">Confirmado</span>' +
          '</div>' +
        '</div>'
      }).join('')
    }

    function renderProfessionals() {
      const options = ['<option value="">Todo el salon</option>']
      for (const professional of activeProfessionals()) {
        options.push('<option value="' + professional.id + '">' + escapeHtml(professional.name) + '</option>')
      }
      els.blockProfessional.innerHTML = options.join('')
      const activeCount = activeProfessionals().length
      const professionalMetrics = getProfessionalMetrics()
      els.professionalCount.textContent = String(activeCount)
      if (els.professionalMonthCount) els.professionalMonthCount.textContent = formatCompactNumber(professionalMetrics.currentAppointments)
      if (els.professionalClientCount) els.professionalClientCount.textContent = formatCompactNumber(professionalMetrics.currentClients)
      if (els.professionalMonthTrend) renderMetricTrend(els.professionalMonthTrend, professionalMetrics.appointmentTrend)
      if (els.professionalClientTrend) renderMetricTrend(els.professionalClientTrend, professionalMetrics.clientTrend)
      if (els.professionalTotalCopy) els.professionalTotalCopy.textContent = 'De ' + state.professionals.length + ' en total'
      renderProfessionalServiceOptions(getSelectedProfessionalServiceIds())

      const searchValue = els.professionalSearch?.value?.trim().toLowerCase() || ''
      const professionals = state.professionals.filter((professional) => {
        const matchesSearch = !searchValue || professional.name.toLowerCase().includes(searchValue)
        const matchesStatus =
          state.professionalStatusFilter === 'all' ||
          (state.professionalStatusFilter === 'active' && professional.isActive !== false) ||
          (state.professionalStatusFilter === 'inactive' && professional.isActive === false)

        return matchesSearch && matchesStatus
      })

      els.professionalList.innerHTML = state.professionals.length
        ? '<div class="professional-card-grid">' + professionals.map((professional, index) => {
            const statusText = professional.isActive === false ? 'Inactivo' : 'Activo'
            const statusClass = professional.isActive === false ? 'professional-card-status inactive' : 'professional-card-status'
            const appointmentCount = professional._count?.appointments || 0
            const avatarClass = ['professional-card-avatar', index % 3 === 1 ? 'purple' : '', index % 3 === 2 ? 'green' : ''].filter(Boolean).join(' ')
            const services = summarizeProfessionalServices(professional)
            const avatarContent = professional.avatarUrl
              ? '<img src="' + escapeHtml(professional.avatarUrl) + '" alt="">'
              : escapeHtml(professional.name.slice(0, 1).toUpperCase())
            return '<article class="professional-card">' +
              '<div class="professional-card-top">' +
                '<div class="' + avatarClass + '">' +
                  avatarContent +
                  '<span class="professional-online-dot"></span>' +
                '</div>' +
                '<div>' +
                  '<div class="professional-card-name">' + escapeHtml(professional.name) + '</div>' +
                  '<div class="' + statusClass + '">' + statusText + '</div>' +
                '</div>' +
              '</div>' +
              '<div class="professional-card-body">' +
                '<div class="professional-info-row">' +
                  icon('scissors') +
                  '<div>' +
                    '<div class="professional-info-title">Servicios</div>' +
                    '<div class="professional-info-copy">' + escapeHtml(services) + '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="professional-info-row">' +
                  icon('clock') +
                  '<div>' +
                    '<div class="professional-info-title">Horarios</div>' +
                    '<div class="professional-hours-pills">' + summarizeWorkingHourPills(professional.workingHours || []) + '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="professional-info-row">' +
                  icon('clock') +
                  '<div>' +
                    '<div class="professional-info-title">Turnos historicos</div>' +
                    '<div class="professional-info-copy">' + appointmentCount + ' turnos</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="professional-card-actions">' +
                '<button type="button" data-edit-professional="' + professional.id + '">' + icon('edit') + 'Editar</button>' +
                (professional.isActive === false
                  ? '<button type="button" data-activate-professional="' + professional.id + '">' + icon('user') + 'Activar</button>'
                  : '<button type="button" data-edit-hours-professional="' + professional.id + '">' + icon('calendar') + 'Horarios</button>') +
                '<button class="danger" type="button" data-delete-professional="' + professional.id + '" title="Eliminar">' + icon('more') + '</button>' +
              '</div>' +
            '</article>'
          }).join('') +
          '<button class="professional-add-card" type="button" data-new-professional>' +
            '<div>' +
              '<div class="add-professional-icon">+</div>' +
              '<strong>Agregar profesional</strong>' +
              '<p>Suma a tu equipo y asigna horarios y servicios.</p>' +
            '</div>' +
          '</button>' +
          '</div>'
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

      for (const button of els.professionalList.querySelectorAll('[data-edit-hours-professional]')) {
        button.addEventListener('click', () => editProfessional(button.dataset.editHoursProfessional, { focusHours: true }))
      }

      for (const button of els.professionalList.querySelectorAll('[data-activate-professional]')) {
        button.addEventListener('click', () => setProfessionalStatus(button.dataset.activateProfessional, true))
      }

      for (const button of els.professionalList.querySelectorAll('[data-new-professional]')) {
        button.addEventListener('click', openNewProfessionalForm)
      }
    }

    function renderServices() {
      els.serviceCount.textContent = String(state.services.length)
      const query = (els.serviceSearch?.value || '').trim().toLowerCase()
      const services = state.services.filter((service) => {
        const aliases = (service.aliases || []).map((alias) => alias.name).join(' ')
        const haystack = [service.name, service.category, aliases].filter(Boolean).join(' ').toLowerCase()
        return !query || haystack.includes(query)
      })

      els.serviceList.innerHTML = services.length
        ? services.map((service) => {
            const priceLabel = hasServicePrice(service) ? formatCurrency(service.price) : 'Sin precio'
            return '<article class="service-card">' +
              '<div class="service-item-icon">' + icon('scissors') + '</div>' +
              '<div>' +
                '<div class="service-card-title">' + escapeHtml(service.name) + '</div>' +
                '<div class="service-card-meta">' +
                  '<span>' + icon('clock') + escapeHtml(service.duration + ' min') + '</span>' +
                  '<span>' + icon('tag') + escapeHtml(priceLabel) + '</span>' +
                '</div>' +
              '</div>' +
              '<div class="service-card-actions">' +
                '<button class="service-icon-button" type="button" title="Editar" aria-label="Editar ' + escapeHtml(service.name) + '" data-edit-service="' + service.id + '">' + icon('edit') + '</button>' +
                '<button class="service-icon-button danger" type="button" title="Eliminar" aria-label="Eliminar ' + escapeHtml(service.name) + '" data-delete-service="' + service.id + '">' + icon('trash') + '</button>' +
              '</div>' +
            '</article>'
          }).join('')
        : '<div class="empty">' + (query ? 'No hay servicios que coincidan con la busqueda.' : 'No hay servicios cargados.') + '</div>'

      for (const button of els.serviceList.querySelectorAll('[data-edit-service]')) {
        button.addEventListener('click', () => editService(button.dataset.editService))
      }

      for (const button of els.serviceList.querySelectorAll('[data-delete-service]')) {
        button.addEventListener('click', () => deleteService(button.dataset.deleteService))
      }
    }

    function renderAiControls() {
      const pending = state.conversationCounts.handoff || state.conversations.filter(isPendingHandoff).length
      els.handoffCount.textContent = String(pending)
      renderNavHandoffBadge(pending)
      if (els.topHandoffTotal) els.topHandoffTotal.textContent = String(pending)
      els.globalBotToggle.checked = state.aiSettings.botEnabled !== false
      els.globalAiToggle.checked = state.aiSettings.aiEnabled !== false
      els.globalBotStatus.textContent = state.aiSettings.botEnabled === false ? 'Pausado' : 'Activo'
      els.globalBotStatus.className = state.aiSettings.botEnabled === false ? 'paused' : ''
      els.globalAiStatus.textContent = state.aiSettings.aiEnabled === false ? 'Flujo basico' : 'Activo'
      els.globalAiStatus.className = state.aiSettings.aiEnabled === false ? 'basic' : ''
    }

    function renderNavHandoffBadge(count) {
      const badge = document.getElementById('nav-handoff-badge')
      if (!badge) return

      badge.hidden = count === 0
      badge.textContent = count > 99 ? '99+' : String(count)
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
      const futureDays = Number(els.reportsFutureDays.value || 30)
      const inactiveDays = Number(els.reportsInactiveDays.value || 60)
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
      const riskCustomers = calculateRiskCustomers({
        now: periodEnd,
        allAppointments: state.reportAppointments
      })
      const inactiveCustomers = calculateInactiveCustomers({
        days: inactiveDays,
        now: periodEnd,
        allAppointments: state.reportAppointments
      })
      const revenue = calculateRevenue(nonCancelled)

      els.reportsSubtitle.textContent = formatReportRange(periodStart, periodEnd)
      els.reportTotalAppointments.textContent = String(appointments.length)
      els.reportTotalCopy.textContent = nonCancelled.length + ' activos en el periodo.'
      els.reportCompletedAppointments.textContent = String(completed.length)
      els.reportCompletedCopy.textContent = completed.length + ' realizados del periodo.'
      els.reportCancelledAppointments.textContent = String(cancelled.length)
      els.reportCancelledCopy.textContent = cancellationRate + '% del periodo.'
      els.reportNoShowAppointments.textContent = String(noShow.length)
      els.reportNoShowCopy.textContent = noShow.length + ' marcados como ausentes.'
      els.reportActiveCustomers.textContent = String(activeCustomerIds.size)
      els.reportCustomersCopy.textContent = countNewCustomers(periodStart, periodEnd) + ' clientes nuevos cargados.'
      els.reportChatConversion.textContent = chatConversion.rate + '%'
      els.reportChatConversionCopy.textContent = chatConversion.converted + ' de ' + chatConversion.total + ' conversaciones.'
      els.reportCustomerMix.textContent = customerMix.newCustomers + ' / ' + customerMix.returningCustomers
      els.reportCustomerMixCopy.textContent = customerMix.newRate + '% nuevos, ' + customerMix.returningRate + '% recurrentes.'
      els.reportVisitGap.textContent = visitGap.averageDays === null ? '--' : visitGap.averageDays + ' dias'
      els.reportVisitGapCopy.textContent = visitGap.sampleSize + ' intervalos entre visitas.'
      els.reportFutureTotal.textContent = String(futureAgenda.total)
      els.reportFutureCopy.textContent = 'Proximos ' + futureDays + ' dias.'
      els.reportInactiveCopy.textContent = 'Sin turno en los ultimos ' + inactiveDays + ' dias.'

      renderReportStatusBars({
        confirmados: appointments.length,
        realizados: completed.length,
        cancelados: cancelled.length,
        ausentes: noShow.length
      })
      renderRevenue(revenue)
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

    function calculateRevenue(appointments) {
      const missingServices = new Map()
      let total = 0
      let pricedAppointments = 0
      let missingAppointments = 0

      for (const appointment of appointments) {
        const price = getAppointmentServicePrice(appointment)
        if (price === null) {
          missingAppointments += 1
          if (appointment.serviceId) {
            const service = getServiceForAppointment(appointment)
            missingServices.set(appointment.serviceId, {
              id: appointment.serviceId,
              name: service?.name || appointment.service?.name || 'Servicio'
            })
          }
          continue
        }

        total += price
        pricedAppointments += 1
      }

      return {
        total,
        pricedAppointments,
        missingAppointments,
        missingServices: Array.from(missingServices.values())
      }
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

    function calculateInactiveCustomers(input) {
      const futureCustomerIds = new Set(input.allAppointments
        .filter((appointment) => {
          return appointment.customerId &&
            isActiveAppointment(appointment) &&
            new Date(appointment.startAt) >= input.now
        })
        .map((appointment) => appointment.customerId))

      return buildCustomerVisitSummaries(input.allAppointments)
        .filter((customer) => customer.daysSinceLastVisit >= input.days)
        .filter((customer) => !futureCustomerIds.has(customer.customerId))
        .sort((left, right) => right.daysSinceLastVisit - left.daysSinceLastVisit)
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

    function renderRevenue(revenue) {
      const missingNames = revenue.missingServices.map((service) => service.name).slice(0, 3).join(', ')
      const missingCopy = revenue.missingAppointments > 0
        ? revenue.missingAppointments + ' turnos sin precio' + (missingNames ? ': ' + missingNames : '') + '.'
        : 'Todos los turnos del periodo tienen precio.'

      els.reportRevenueNote.innerHTML = '<div class="revenue-box">' +
        '<div>' +
          '<span>Facturado estimado</span>' +
          '<strong>' + escapeHtml(formatCurrency(revenue.total)) + '</strong>' +
        '</div>' +
        '<p>' + escapeHtml(revenue.pricedAppointments + ' turnos valorados. ' + missingCopy) + '</p>' +
        (revenue.missingServices.length > 0
          ? '<button class="secondary" type="button" data-add-service-prices>Agregar precios</button>'
          : '') +
      '</div>'

      const button = els.reportRevenueNote.querySelector('[data-add-service-prices]')
      if (button) {
        button.addEventListener('click', () => {
          setSection('services')
          els.serviceFeedback.textContent = 'Edita los servicios sin precio para completar la facturacion.'
          if (revenue.missingServices.length === 1) {
            editService(revenue.missingServices[0].id)
          }
        })
      }
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
          const share = Math.round((row.count / Math.max(1, total)) * 100)
          return '<tr>' +
            '<td>' + escapeHtml(row.label) + '</td>' +
            '<td>' + row.count + '</td>' +
            '<td><div class="report-share">' +
              '<div class="report-share-track"><div class="report-share-fill" style="width: ' + share + '%"></div></div>' +
              '<span>' + share + '%</span>' +
            '</div></td>' +
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

      els.reportProfessionalsTable.innerHTML = rows.map((row) => {
        return '<div class="professional-row">' +
          '<div class="professional-avatar">' + escapeHtml(row.name.slice(0, 1).toUpperCase()) + '</div>' +
          '<div class="professional-name">' + escapeHtml(row.name) + '</div>' +
          '<div class="professional-stat">' +
            '<strong>' + row.attended + '</strong>' +
            '<span>' + row.noShow + ' ausencias</span>' +
          '</div>' +
        '</div>'
      }).join('')
    }

    function renderRiskCustomers(customers) {
      const rows = customers.slice(0, 8)
      if (rows.length === 0) {
        els.reportRiskTable.innerHTML = '<div class="report-empty-note">Todavia no hay clientes con patron de riesgo.</div>'
        return
      }

      els.reportRiskTable.innerHTML = rows.map((customer) => {
        return '<div class="risk-row">' +
          '<div class="risk-main">' +
            '<div class="risk-name">' + escapeHtml(customer.name) + '</div>' +
            '<div class="risk-meta">Esperado cada ' + customer.expectedReturnDays + ' dias</div>' +
          '</div>' +
          '<span class="risk-badge">' + customer.overdueDays + ' dias</span>' +
        '</div>'
      }).join('') +
      '<div class="reactivation-action">Campana de reactivacion</div>'
    }

    function renderInactiveCustomers(customers) {
      const rows = customers.slice(0, 8)
      if (rows.length === 0) {
        els.reportInactiveTable.innerHTML = '<div class="report-empty-note">No hay clientes inactivos con este filtro.</div>'
        return
      }

      els.reportInactiveTable.innerHTML = rows.map((customer) => {
        return '<div class="risk-row">' +
          '<div class="risk-main">' +
            '<div class="risk-name">' + escapeHtml(customer.name) + '</div>' +
            '<div class="risk-meta">Ultima visita: ' + formatShortDate(customer.lastVisit) + '</div>' +
          '</div>' +
          '<span class="risk-badge inactive-badge">' + customer.daysSinceLastVisit + ' dias</span>' +
        '</div>'
      }).join('')
    }

    function getServiceForAppointment(appointment) {
      return state.services.find((service) => service.id === appointment.serviceId) || appointment.service || null
    }

    function getAppointmentServicePrice(appointment) {
      const service = getServiceForAppointment(appointment)
      return hasServicePrice(service) ? Number(service.price) : null
    }

    function hasServicePrice(service) {
      if (!service) return false
      const price = Number(service.price)
      return service.price !== null && service.price !== undefined && Number.isFinite(price) && price >= 0
    }

    function formatCurrency(value) {
      return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        maximumFractionDigits: 0
      }).format(Number(value) || 0)
    }

    function normalizeMoneyInput(value) {
      const digits = String(value || '').replace(/\D/g, '')
      return digits ? String(Number(digits)) : ''
    }

    function formatMoneyInput(value) {
      const normalized = normalizeMoneyInput(value)
      if (!normalized) return ''
      return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Number(normalized))
    }

    function updateCampaignBudgetPreview() {
      const normalized = normalizeMoneyInput(els.campaignBudget.value)
      els.campaignBudget.value = formatMoneyInput(normalized)
      els.campaignBudgetPreview.innerHTML = normalized
        ? 'Se guardar&aacute; como <strong>' + escapeHtml(new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Number(normalized))) + ' ARS</strong>'
        : 'Sin l&iacute;mite definido'
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
      if (!whatsappReplyWindowState().canReply) {
        updateComposerAvailability()
        return
      }
      const text = els.replyText.value.trim()
      if (!text) return

      els.sendButton.disabled = true
      try {
        const result = await getJson('/crm/conversations/' + state.selected.id + '/manual-replies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            sendWhatsApp: true
          })
        })
        els.replyText.value = ''
        await selectConversation(state.selected.id)
        await loadConversations()
        if (result.delivery && result.delivery.sent === false) {
          showCrmToast('WhatsApp no pudo enviar el mensaje: ' + (result.delivery.errorMessage || result.delivery.reason || 'revisa la configuracion o la ventana de 24 hs.'), 'error')
        }
      } catch (error) {
        if (error.body?.reason === 'whatsapp_reply_window_expired') {
          state.selected.canReplyOnWhatsApp = false
          state.selected.whatsappReplyWindowExpiresAt = error.body.replyWindowExpiresAt
          updateComposerAvailability()
        } else {
          showCrmToast(error.message, 'error')
        }
      } finally {
        updateComposerAvailability()
      }
    }

    async function toggleGlobalAi() {
      const nextValue = els.globalAiToggle.checked
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
        renderAiControls()
        showBusinessSettingsFeedback(error.message, 'error')
      }
    }

    async function toggleGlobalBot() {
      const nextValue = els.globalBotToggle.checked
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
        showBusinessSettingsFeedback(nextValue ? 'Bot automatico activo.' : 'Bot automatico pausado para todo el salon.', 'success')
      } catch (error) {
        renderAiControls()
        showBusinessSettingsFeedback(error.message, 'error')
      }
    }

    async function toggleConversationAi() {
      if (!state.selected) return
      els.conversationAiToggle.disabled = true
      try {
        const updated = await getJson('/crm/conversations/' + state.selected.id + '/ai', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aiEnabled: false
          })
        })
        state.selected = updated
        await loadConversations()
        renderSelected()
      } catch (error) {
        showCrmToast(error.message, 'error')
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
        showCrmToast(error.message, 'error')
      } finally {
        els.resolveHandoff.disabled = false
      }
    }

    async function toggleArchiveConversation() {
      if (!state.selected) return
      const archived = !state.selected.archivedAt
      els.archiveConversation.disabled = true
      try {
        await getJson('/crm/conversations/' + state.selected.id + '/archive', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived })
        })
        state.selected = null
        state.conversationNextCursor = null
        await loadConversations()
      } catch (error) {
        showCrmToast(error.message, 'error')
      } finally {
        els.archiveConversation.disabled = false
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
      const serviceIds = getSelectedProfessionalServiceIds()
      const workingHours = buildProfessionalWorkingHours()
      if (!name) {
        els.professionalFeedback.textContent = 'Escribi un nombre.'
        return
      }

      if (state.services.length > 0 && serviceIds.length === 0) {
        els.professionalFeedback.textContent = 'Selecciona al menos un servicio.'
        return
      }

      const businessHoursError = validateProfessionalHoursAgainstBusiness(workingHours)
      if (businessHoursError) {
        els.professionalFeedback.textContent = businessHoursError
        return
      }

      try {
        await getJson(id ? '/professionals/' + id : '/professionals', {
          method: id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            businessId: state.businessId,
            avatarUrl: state.professionalAvatarUrl,
            isActive: els.professionalStatus.value === 'active',
            serviceIds,
            workingHours,
            ...(options.conflictStrategy ? { conflictStrategy: options.conflictStrategy } : {})
          })
        })
        els.professionalFeedback.textContent = id ? 'Profesional actualizado.' : 'Profesional creado.'
        hideProfessionalImpact()
        state.professionals = await getJson('/professionals')
        renderProfessionals()
        renderAgendaFilters()
        renderAppointmentFormOptions()
        renderAgenda()
        resetProfessionalForm(false)
        closeProfessionalPanel()
      } catch (error) {
        if (error.body?.code === 'WORKING_HOURS_CONFLICT') {
          state.pendingProfessionalSave = {
            id,
            name,
            serviceIds,
            workingHours
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

    function editProfessional(id, options = {}) {
      const professional = state.professionals.find((item) => item.id === id)
      if (!professional) return
      els.professionalId.value = professional.id
      els.professionalName.value = professional.name
      els.professionalStatus.value = professional.isActive === false ? 'inactive' : 'active'
      setProfessionalAvatar(professional.avatarUrl || null)
      setProfessionalWorkingHours(professional.workingHours || [])
      renderProfessionalServiceOptions((professional.services || []).map((service) => service.id))
      els.professionalCancel.hidden = false
      els.professionalFormTitle.textContent = 'Editar profesional'
      els.professionalSubmit.textContent = 'Guardar cambios'
      els.professionalFeedback.textContent = 'Editando profesional.'
      hideProfessionalImpact()
      openProfessionalPanel()
      setSection('professionals')
      if (options.focusHours) {
        els.professionalWeekdaysStart.focus()
      } else {
        els.professionalName.focus()
      }
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

      if (!requestCrmConfirmation('delete-professional:' + id, 'Eliminar profesional ' + professional.name + '?')) return

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
      els.professionalStatus.value = 'active'
      setProfessionalAvatar(null)
      els.professionalCancel.hidden = false
      els.professionalFormTitle.textContent = 'Nuevo profesional'
      els.professionalSubmit.textContent = 'Guardar profesional'
      state.pendingProfessionalSave = null
      hideProfessionalImpact()
      renderProfessionalServiceOptions([])
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

    function openNewProfessionalForm() {
      resetProfessionalForm()
      openProfessionalPanel()
      els.professionalName.focus()
    }

    function openProfessionalPanel() {
      els.professionalPanel.hidden = false
      els.professionalsView.classList.add('form-open')
    }

    function closeProfessionalPanel() {
      els.professionalPanel.hidden = true
      els.professionalsView.classList.remove('form-open')
      hideProfessionalImpact()
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

    function businessHoursForDay(dayOfWeek) {
      return state.businessHours.filter((hour) => hour.dayOfWeek === dayOfWeek)
    }

    function isInsideConfiguredBusinessHours(hour) {
      return businessHoursForDay(hour.dayOfWeek).some((businessHour) => {
        return hour.startTime >= businessHour.startTime &&
          hour.endTime <= businessHour.endTime
      })
    }

    function validateProfessionalHoursAgainstBusiness(hours) {
      const invalidHour = hours.find((hour) => !isInsideConfiguredBusinessHours(hour))
      if (!invalidHour) return ''

      const ranges = businessHoursForDay(invalidHour.dayOfWeek)
      const localRange = ranges.length
        ? ranges.map((hour) => hour.startTime + ' a ' + hour.endTime).join(', ')
        : 'cerrado'

      return 'El horario de ' + dayName(invalidHour.dayOfWeek) + ' debe estar dentro del horario del local (' + localRange + ').'
    }

    function applyProfessionalBusinessHourLimits() {
      const weekdayHours = [1, 2, 3, 4, 5].flatMap(businessHoursForDay)
      applyTimeRangeLimits({
        enabled: els.professionalWeekdaysEnabled,
        start: els.professionalWeekdaysStart,
        end: els.professionalWeekdaysEnd,
        hours: weekdayHours,
        requireEveryDay: [1, 2, 3, 4, 5].every((day) => businessHoursForDay(day).length > 0)
      })
      applyTimeRangeLimits({
        enabled: els.professionalSaturdayEnabled,
        start: els.professionalSaturdayStart,
        end: els.professionalSaturdayEnd,
        hours: businessHoursForDay(6),
        requireEveryDay: businessHoursForDay(6).length > 0
      })
      applyTimeRangeLimits({
        enabled: els.professionalSundayEnabled,
        start: els.professionalSundayStart,
        end: els.professionalSundayEnd,
        hours: businessHoursForDay(0),
        requireEveryDay: businessHoursForDay(0).length > 0
      })
    }

    function applyTimeRangeLimits(input) {
      const starts = input.hours.map((hour) => hour.startTime)
      const ends = input.hours.map((hour) => hour.endTime)
      const sortedStarts = starts.sort()
      const minStart = sortedStarts.length ? sortedStarts[sortedStarts.length - 1] : ''
      const maxEnd = ends.length ? ends.sort()[0] : ''

      input.enabled.disabled = !input.requireEveryDay
      if (!input.requireEveryDay) {
        input.enabled.checked = false
      }

      input.start.min = minStart
      input.start.max = maxEnd
      input.end.min = minStart
      input.end.max = maxEnd
    }

    function renderBusinessSettings() {
      els.businessName.value = state.business?.name || ''
      setBusinessLogo(state.business?.logoUrl || null)
      updateBusinessBrand()
      const byDay = new Map(state.businessHours.map((hour) => [hour.dayOfWeek, hour]))
      const weekdays = [1, 2, 3, 4, 5].map((day) => byDay.get(day)).filter(Boolean)
      const weekday = weekdays[0]
      const saturday = byDay.get(6)
      const sunday = byDay.get(0)

      els.businessWeekdaysEnabled.checked = weekdays.length === 5
      els.businessWeekdaysStart.value = weekday?.startTime || '09:00'
      els.businessWeekdaysEnd.value = weekday?.endTime || '19:00'
      els.businessSaturdayEnabled.checked = Boolean(saturday)
      els.businessSaturdayStart.value = saturday?.startTime || '09:00'
      els.businessSaturdayEnd.value = saturday?.endTime || '14:00'
      els.businessSundayEnabled.checked = Boolean(sunday)
      els.businessSundayStart.value = sunday?.startTime || '09:00'
      els.businessSundayEnd.value = sunday?.endTime || '14:00'
    }

    function renderWhatsappSettings() {
      const settings = state.whatsappSettings
      const connection = settings?.connection || {}
      const features = settings?.settings || {}
      const connected = connection.status === 'CONNECTED'
      const campaignReady = Boolean(settings?.gates?.canSendCampaigns)
      const reminderReady = Boolean(settings?.gates?.canSendReminders)
      const title = connected
        ? 'WhatsApp conectado' + (connection.displayPhoneNumber ? ' · ' + connection.displayPhoneNumber : '')
        : whatsappConnectionLabel(connection.status)
      const firstReason = settings?.reasons?.campaigns?.[0] || settings?.reasons?.base?.[0] || 'Las campanas reales quedan bloqueadas hasta completar la conexion.'

      els.whatsappSettingsTitle.textContent = title
      els.whatsappSettingsCopy.textContent = connected
        ? (campaignReady ? 'Cuenta lista para campanas y recordatorios reales.' : firstReason)
        : firstReason
      els.whatsappSettingsBadge.textContent = campaignReady ? 'Listo' : 'Bloqueado'
      els.whatsappSettingsBadge.classList.toggle('connected', campaignReady)
      els.realWhatsappToggle.checked = Boolean(features.realWhatsappEnabled)
      els.campaignSendingToggle.checked = campaignReady
      els.reminderSendingToggle.checked = reminderReady
      els.billingOwnerToggle.checked = features.billingOwner !== 'SALON_AI'
      els.realWhatsappStatus.textContent = features.realWhatsappEnabled ? 'Activo' : 'Bloqueado'
      els.campaignSendingStatus.textContent = campaignReady ? 'Activas' : 'Bloqueadas'
      els.reminderSendingStatus.textContent = reminderReady ? 'Activos' : 'Bloqueados'
      els.billingOwnerStatus.textContent = features.billingOwner === 'SALON_AI' ? 'Salon AI' : 'Cliente'
      els.campaignSendingToggle.disabled = connection.mode === 'INTERNAL_TEST' || features.billingOwner === 'SALON_AI'
      els.whatsappWabaId.value = connection.wabaId || ''
      els.whatsappPhoneNumberId.value = connection.phoneNumberId || ''
      els.whatsappDisplayPhone.value = connection.displayPhoneNumber || ''
      els.whatsappTokenExpires.value = connection.tokenExpiresAt ? toDatetimeLocalValue(connection.tokenExpiresAt) : ''
      els.whatsappAccessToken.value = ''
    }

    function whatsappConnectionLabel(status) {
      if (status === 'CONNECTED') return 'WhatsApp conectado'
      if (status === 'CONNECTING') return 'Conectando WhatsApp'
      if (status === 'NEEDS_PAYMENT') return 'Falta medio de pago'
      if (status === 'NEEDS_REVIEW') return 'Falta revision de Meta'
      if (status === 'ERROR') return 'Conexion con error'
      return 'WhatsApp no conectado'
    }

    function showWhatsappSettingsFeedback(message, type) {
      els.whatsappSettingsFeedback.textContent = message
      els.whatsappSettingsFeedback.className = 'settings-feedback visible ' + type
    }

    function clearWhatsappSettingsFeedback() {
      els.whatsappSettingsFeedback.textContent = ''
      els.whatsappSettingsFeedback.className = 'settings-feedback'
    }

    function toDatetimeLocalValue(value) {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      return offsetDate.toISOString().slice(0, 16)
    }

    async function saveWhatsappSettingsPatch(patch, successMessage) {
      if (!state.businessId) return
      clearWhatsappSettingsFeedback()
      try {
        state.whatsappSettings = await getJson('/businesses/' + state.businessId + '/whatsapp-settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch)
        })
        renderWhatsappSettings()
        showWhatsappSettingsFeedback(successMessage, 'success')
      } catch (error) {
        renderWhatsappSettings()
        showWhatsappSettingsFeedback(error.message, 'error')
      }
    }

    async function saveWhatsappTechnicalSettings(event) {
      event.preventDefault()
      if (!state.businessId) return
      const payload = {
        wabaId: els.whatsappWabaId.value.trim(),
        phoneNumberId: els.whatsappPhoneNumberId.value.trim(),
        displayPhoneNumber: els.whatsappDisplayPhone.value.trim(),
        tokenExpiresAt: els.whatsappTokenExpires.value ? new Date(els.whatsappTokenExpires.value).toISOString() : null
      }
      const token = els.whatsappAccessToken.value.trim()
      if (token) payload.accessToken = token
      if (!payload.wabaId || !payload.phoneNumberId) {
        showWhatsappSettingsFeedback('Completá WABA ID y Phone Number ID.', 'error')
        return
      }

      els.whatsappTechnicalSubmit.disabled = true
      els.whatsappTechnicalSubmit.textContent = 'Guardando...'
      await saveWhatsappSettingsPatch(payload, 'Conexion tecnica guardada.')
      els.whatsappTechnicalSubmit.disabled = false
      els.whatsappTechnicalSubmit.textContent = 'Guardar conexion'
    }

    async function loadFacebookSdk(apiVersion) {
      if (window.FB) return window.FB
      return new Promise((resolve, reject) => {
        window.fbAsyncInit = function () {
          resolve(window.FB)
        }
        const existing = document.getElementById('facebook-jssdk')
        if (existing) {
          const startedAt = Date.now()
          const waitForSdk = window.setInterval(() => {
            if (window.FB) {
              window.clearInterval(waitForSdk)
              resolve(window.FB)
            } else if (Date.now() - startedAt > 8000) {
              window.clearInterval(waitForSdk)
              reject(new Error('Meta tardo demasiado en cargar el SDK. Volve a intentar.'))
            }
          }, 150)
          return
        }
        const script = document.createElement('script')
        script.id = 'facebook-jssdk'
        script.async = true
        script.defer = true
        script.crossOrigin = 'anonymous'
        script.src = 'https://connect.facebook.net/es_LA/sdk.js'
        script.onerror = () => reject(new Error('No pude cargar el SDK de Meta. Revisa la conexion e intenta de nuevo.'))
        document.body.appendChild(script)
      }).then((FB) => {
        if (!FB) throw new Error('Meta no devolvio el SDK de Facebook.')
        return FB
      })
    }

    function listenForWhatsappEmbeddedSignup() {
      if (state.whatsappEmbeddedSignupListenerReady) return
      window.addEventListener('message', (event) => {
        if (event.origin === window.location.origin && event.data?.type === 'SALON_AI_META_OAUTH') {
          if (event.data.error) {
            showWhatsappSettingsFeedback(event.data.error, 'error')
            return
          }
          void handleWhatsappSignupResponse({ authResponse: { code: event.data.code } }, event.data.redirectUri)
          return
        }
        const metaMessageOrigins = ['https://www.facebook.com', 'https://web.facebook.com']
        if (!metaMessageOrigins.includes(String(event.origin || ''))) return
        let data = event.data
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data)
          } catch {
            return
          }
        }
        if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return
        if (data.event && data.event !== 'FINISH') {
          state.whatsappEmbeddedSignupPayloadKeys = collectObjectKeys(data.data || data)
          return
        }
        const payload = data.data || data
        const payloadKeys = collectObjectKeys(payload)
        const phoneNumber = findFirstNestedValue(payload, [
          'phone_number_id',
          'phoneNumberId',
          'phone_number.id',
          'phoneNumber.id',
          'phone.id',
          'phoneNumberID',
          'phone_number.id'
        ])
        const displayPhone = findFirstNestedValue(payload, [
          'display_phone_number',
          'displayPhoneNumber',
          'phone_number.display_phone_number',
          'phoneNumber.displayPhoneNumber',
          'phone.display_phone_number'
        ])
        const wabaId = findFirstNestedValue(payload, [
          'waba_id',
          'wabaId',
          'whatsapp_business_account_id',
          'whatsappBusinessAccountId',
          'whatsapp_business_account.id',
          'whatsappBusinessAccount.id',
          'waba.id'
        ])
        state.whatsappEmbeddedSignupSession = {
          wabaId: wabaId || state.whatsappEmbeddedSignupSession?.wabaId,
          phoneNumberId: phoneNumber || state.whatsappEmbeddedSignupSession?.phoneNumberId,
          displayPhoneNumber: displayPhone || state.whatsappEmbeddedSignupSession?.displayPhoneNumber
        }
        state.whatsappEmbeddedSignupPayloadKeys = payloadKeys
        if (state.whatsappPendingSignupResponse && !state.whatsappSignupSaveInFlight && state.whatsappEmbeddedSignupSession.wabaId && state.whatsappEmbeddedSignupSession.phoneNumberId) {
          const pending = state.whatsappPendingSignupResponse
          state.whatsappPendingSignupResponse = null
          void handleWhatsappSignupResponse(pending.response, pending.redirectUri)
        }
      })
      state.whatsappEmbeddedSignupListenerReady = true
    }

    function collectObjectKeys(value, prefix = '', result = []) {
      if (!value || typeof value !== 'object') return result
      for (const key of Object.keys(value)) {
        const path = prefix ? prefix + '.' + key : key
        result.push(path)
        if (value[key] && typeof value[key] === 'object' && result.length < 40) {
          collectObjectKeys(value[key], path, result)
        }
      }
      return result.slice(0, 40)
    }

    function findFirstNestedValue(source, paths) {
      for (const path of paths) {
        const value = path.split('.').reduce((current, key) => current && current[key], source)
        if (typeof value === 'string' && value.trim()) return value.trim()
      }
      return ''
    }

    async function handleWhatsappSignupResponse(response, redirectUri) {
      try {
        state.whatsappSignupSaveInFlight = true
        const code = response?.authResponse?.code
        const accessToken = response?.authResponse?.accessToken
        const expiresIn = Number(response?.authResponse?.expiresIn)
        if (!code && !accessToken) {
          showWhatsappSettingsFeedback('Meta no devolvio autorizacion. Volve a intentar la conexion.', 'error')
          return
        }
        await waitForWhatsappEmbeddedSignupSession()
        const hasEmbeddedSignupAssets = Boolean(state.whatsappEmbeddedSignupSession?.wabaId && state.whatsappEmbeddedSignupSession?.phoneNumberId)
        if (!hasEmbeddedSignupAssets && !state.whatsappPendingSignupResponse) {
          state.whatsappPendingSignupResponse = { response, redirectUri }
        }
        state.whatsappSettings = await getJson('/businesses/' + state.businessId + '/whatsapp/embedded-signup-callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            accessToken,
            tokenExpiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
            redirectUri,
            embeddedSignupReceived: state.whatsappEmbeddedSignupPayloadKeys.length > 0,
            embeddedSignupPayloadKeys: state.whatsappEmbeddedSignupPayloadKeys,
            ...state.whatsappEmbeddedSignupSession
          })
        })
        renderWhatsappSettings()
        const lastError = state.whatsappSettings?.connection?.lastError
        const isConnected = state.whatsappSettings?.connection?.status === 'CONNECTED' && state.whatsappSettings?.connection?.wabaId && state.whatsappSettings?.connection?.phoneNumberId
        showWhatsappSettingsFeedback(lastError || (isConnected ? 'WhatsApp conectado para este comercio.' : 'Falta completar WABA ID y Phone Number ID para terminar la conexion.'), lastError || !isConnected ? 'error' : 'success')
      } catch (error) {
        showWhatsappSettingsFeedback(error.message, 'error')
      } finally {
        state.whatsappSignupSaveInFlight = false
      }
    }

    async function waitForWhatsappEmbeddedSignupSession() {
      if (state.whatsappEmbeddedSignupSession?.wabaId && state.whatsappEmbeddedSignupSession?.phoneNumberId) return
      const startedAt = Date.now()
      while (Date.now() - startedAt < 10000) {
        await new Promise((resolve) => window.setTimeout(resolve, 150))
        if (state.whatsappEmbeddedSignupSession?.wabaId && state.whatsappEmbeddedSignupSession?.phoneNumberId) return
      }
    }

    async function openWhatsappSignupPlaceholder() {
      if (!state.businessId) return
      clearWhatsappSettingsFeedback()
      state.whatsappEmbeddedSignupSession = {}
      state.whatsappEmbeddedSignupPayloadKeys = []
      state.whatsappPendingSignupResponse = null
      els.whatsappConnectButton.disabled = true
      els.whatsappConnectButton.textContent = 'Abriendo Meta...'
      try {
        const config = await getJson('/businesses/' + state.businessId + '/whatsapp-embedded-signup-config')
        const FB = await loadFacebookSdk(config.apiVersion)
        listenForWhatsappEmbeddedSignup()
        FB.init({
          appId: config.appId,
          autoLogAppEvents: true,
          xfbml: false,
          version: config.apiVersion
        })
        FB.login(function (response) {
          void handleWhatsappSignupResponse(response, config.redirectUri)
        }, {
          config_id: config.configId,
          response_type: 'code',
          override_default_response_type: true,
          scope: 'whatsapp_business_management,whatsapp_business_messaging',
          extras: config.extras || {}
        })
      } catch (error) {
        showWhatsappSettingsFeedback(error.message, 'error')
      } finally {
        els.whatsappConnectButton.disabled = false
        els.whatsappConnectButton.textContent = 'Conectar WhatsApp'
      }
    }

    function businessInitials(name) {
      const words = String(name || 'S').trim().split(/\s+/).filter(Boolean)
      return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'S'
    }

    function updateBusinessBrand() {
      const name = state.business?.name || 'CRM Salon AI'
      const logoUrl = state.business?.logoUrl || null
      const brandName = document.querySelector('.workspace-nav .crm-brand strong')
      const brandMark = document.querySelector('.workspace-nav .brand-mark')
      const adminName = document.querySelector('.workspace-nav .nav-user-info strong')
      const adminAvatar = document.querySelector('.workspace-nav .mini-avatar')

      if (brandName) brandName.textContent = name
      if (adminName) adminName.textContent = name
      if (brandMark) {
        brandMark.innerHTML = logoUrl
          ? '<img src="' + escapeHtml(logoUrl) + '" alt="">'
          : escapeHtml(businessInitials(name))
      }
      if (adminAvatar) {
        adminAvatar.innerHTML = logoUrl
          ? '<img src="' + escapeHtml(logoUrl) + '" alt="">'
          : escapeHtml(businessInitials(name))
      }
    }

    function setBusinessLogo(logoUrl) {
      state.businessLogoUrl = logoUrl
      els.businessLogoPreview.src = logoUrl || ''
      els.businessLogoPicker.classList.toggle('has-image', Boolean(logoUrl))
      els.businessLogoRemove.hidden = !logoUrl
      if (!logoUrl) {
        els.businessLogo.value = ''
      }
    }

    function readBusinessLogo(event) {
      const file = event.target.files?.[0]
      if (!file) return

      const supportedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
      if (!supportedTypes.includes(file.type)) {
        showBusinessSettingsFeedback('Elegí una imagen PNG, JPG, WEBP o GIF.', 'error')
        setBusinessLogo(state.business?.logoUrl || null)
        return
      }

      if (file.size > 2 * 1024 * 1024) {
        showBusinessSettingsFeedback('La imagen no puede superar los 2 MB.', 'error')
        setBusinessLogo(state.business?.logoUrl || null)
        return
      }

      clearBusinessSettingsFeedback()
      const reader = new FileReader()
      reader.addEventListener('load', () => {
        setBusinessLogo(String(reader.result || ''))
      })
      reader.readAsDataURL(file)
    }

    function showBusinessSettingsFeedback(message, type) {
      els.businessSettingsFeedback.textContent = message
      els.businessSettingsFeedback.className = 'settings-feedback visible ' + type
    }

    function clearBusinessSettingsFeedback() {
      els.businessSettingsFeedback.textContent = ''
      els.businessSettingsFeedback.className = 'settings-feedback'
    }

    function showCampaignTemplateFeedback(message, type) {
      els.campaignTemplateFeedback.textContent = message
      els.campaignTemplateFeedback.className = 'campaign-form-feedback ' + (type || '')
    }

    const campaignTemplateStatusLabels = {
      NOT_CREATED: 'Sin crear',
      PENDING: 'Pendiente',
      IN_APPEAL: 'En revision',
      APPROVED: 'Aprobada',
      REJECTED: 'Rechazada',
      PAUSED: 'Pausada',
      DISABLED: 'Deshabilitada'
    }

    function campaignTemplateStatusClass(status) {
      if (status === 'APPROVED') return 'approved'
      if (status === 'REJECTED' || status === 'DISABLED') return 'rejected'
      if (status === 'PENDING' || status === 'IN_APPEAL') return 'pending'
      return 'neutral'
    }

    function renderCampaignTemplateState() {
      const meta = state.campaignTemplateMeta
      const status = meta.status || 'NOT_CREATED'
      const label = campaignTemplateStatusLabels[status] || status
      const reason = meta.rejectionReason
        ? '<small>Motivo: ' + escapeHtml(meta.rejectionReason) + '</small>'
        : meta.lastSyncedAt
          ? '<small>Actualizado ' + escapeHtml(formatDateTime(meta.lastSyncedAt)) + '</small>'
          : ''
      els.campaignTemplateState.innerHTML = '<span class="campaign-template-status ' + campaignTemplateStatusClass(status) + '">' + escapeHtml(label) + '</span>' + reason
      els.campaignTemplateSync.hidden = !els.campaignId.value || !els.campaignTemplateName.value.trim()
    }

    async function syncCampaignTemplateInMeta() {
      const campaignId = els.campaignId.value
      if (!campaignId) return
      els.campaignTemplateSync.disabled = true
      showCampaignTemplateFeedback('Consultando estado en Meta...', '')
      try {
        const campaign = await getJson('/campaigns/' + campaignId + '/template/sync', { method: 'POST' })
        state.campaignTemplateMeta = {
          name: campaign.templateName || null,
          id: campaign.templateId || null,
          status: campaign.templateStatus || 'NOT_CREATED',
          rejectionReason: campaign.templateRejectionReason || null,
          lastSyncedAt: campaign.templateLastSyncedAt || null
        }
        const index = state.campaigns.findIndex((item) => item.id === campaign.id)
        if (index >= 0) state.campaigns[index] = campaign
        renderCampaignTemplateState()
        showCampaignTemplateFeedback('Estado actualizado desde Meta.', 'success')
      } catch (error) {
        showCampaignTemplateFeedback(error.message, 'error')
      } finally {
        els.campaignTemplateSync.disabled = false
      }
    }

    async function createCampaignTemplateInMeta() {
      const name = els.campaignTemplateName.value.trim()
      const bodyText = els.campaignMessage.value.trim()
      if (!name || !/^[a-z0-9_]{1,512}$/.test(name)) {
        showCampaignTemplateFeedback('Indica un nombre valido: minusculas, numeros y guiones bajos.', 'error')
        return
      }
      if (!bodyText) {
        showCampaignTemplateFeedback('Escribi primero el mensaje de la campana.', 'error')
        return
      }
      if (bodyText.length > 1024) {
        showCampaignTemplateFeedback('Meta permite hasta 1024 caracteres en el cuerpo de esta plantilla.', 'error')
        return
      }

      els.campaignTemplateCreate.disabled = true
      els.campaignTemplateCreate.textContent = 'Enviando a Meta...'
      showCampaignTemplateFeedback('Enviando plantilla a revision de Meta...', '')
      try {
        const result = await getJson('/whatsapp/message-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            languageCode: els.campaignTemplateLanguage.value,
            category: 'MARKETING',
            bodyText
          })
        })
        showCampaignTemplateFeedback(
          'Plantilla enviada a Meta. Estado: ' + (result.status || 'PENDING') + '. Cuando figure aprobada, la campana podra usarla.',
          'success'
        )
        state.campaignTemplateMeta = {
          name,
          id: result.id || null,
          status: result.status || 'PENDING',
          rejectionReason: null,
          lastSyncedAt: new Date().toISOString()
        }
        renderCampaignTemplateState()
      } catch (error) {
        showCampaignTemplateFeedback(error.message, 'error')
      } finally {
        els.campaignTemplateCreate.disabled = false
        els.campaignTemplateCreate.textContent = 'Enviar plantilla a revision'
      }
    }

    function businessHoursKey(hours) {
      return hours
        .map((hour) => hour.dayOfWeek + ':' + hour.startTime + '-' + hour.endTime)
        .sort()
        .join('|')
    }

    async function saveBusinessSettings(event) {
      event.preventDefault()
      clearBusinessSettingsFeedback()
      const name = els.businessName.value.trim()
      if (!state.businessId || !name) {
        showBusinessSettingsFeedback('Completa el nombre del local.', 'error')
        return
      }

      const schedules = [
        {
          label: 'lunes a viernes',
          enabled: els.businessWeekdaysEnabled.checked,
          startTime: els.businessWeekdaysStart.value,
          endTime: els.businessWeekdaysEnd.value
        },
        {
          label: 'sabado',
          enabled: els.businessSaturdayEnabled.checked,
          startTime: els.businessSaturdayStart.value,
          endTime: els.businessSaturdayEnd.value
        },
        {
          label: 'domingo',
          enabled: els.businessSundayEnabled.checked,
          startTime: els.businessSundayStart.value,
          endTime: els.businessSundayEnd.value
        }
      ]
      const invalid = schedules.find((schedule) => schedule.enabled && (!schedule.startTime || !schedule.endTime || schedule.startTime >= schedule.endTime))
      if (invalid) {
        showBusinessSettingsFeedback('Revisa el horario de ' + invalid.label + '.', 'error')
        return
      }

      const requestedHours = []
      if (els.businessWeekdaysEnabled.checked) {
        for (const dayOfWeek of [1, 2, 3, 4, 5]) {
          requestedHours.push({
            dayOfWeek,
            startTime: els.businessWeekdaysStart.value,
            endTime: els.businessWeekdaysEnd.value
          })
        }
      }
      if (els.businessSaturdayEnabled.checked) {
        requestedHours.push({
          dayOfWeek: 6,
          startTime: els.businessSaturdayStart.value,
          endTime: els.businessSaturdayEnd.value
        })
      }
      if (els.businessSundayEnabled.checked) {
        requestedHours.push({
          dayOfWeek: 0,
          startTime: els.businessSundayStart.value,
          endTime: els.businessSundayEnd.value
        })
      }

      const hoursChanged = businessHoursKey(requestedHours) !== businessHoursKey(state.businessHours)
      const nameChanged = name !== state.business?.name
      const logoChanged = state.businessLogoUrl !== (state.business?.logoUrl || null)
      els.businessSettingsSubmit.disabled = true
      els.businessSettingsSubmit.textContent = 'Guardando...'

      try {
        if (hoursChanged) {
          state.businessHours = await getJson('/business-hours/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              businessId: state.businessId,
              weekdays: {
                days: els.businessWeekdaysEnabled.checked ? [1, 2, 3, 4, 5] : [],
                startTime: els.businessWeekdaysStart.value || '09:00',
                endTime: els.businessWeekdaysEnd.value || '19:00'
              },
              saturday: {
                days: els.businessSaturdayEnabled.checked ? [6] : [],
                startTime: els.businessSaturdayStart.value || '09:00',
                endTime: els.businessSaturdayEnd.value || '14:00'
              },
              sunday: {
                days: els.businessSundayEnabled.checked ? [0] : [],
                startTime: els.businessSundayStart.value || '09:00',
                endTime: els.businessSundayEnd.value || '14:00'
              }
            })
          })
        }
        if (nameChanged || logoChanged) {
          state.business = await getJson('/businesses/' + state.businessId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...(nameChanged ? { name } : {}),
              ...(logoChanged ? { logoUrl: state.businessLogoUrl } : {})
            })
          })
        }
        renderBusinessSettings()
        applyProfessionalBusinessHourLimits()
        renderAgenda()
        showBusinessSettingsFeedback(
          nameChanged || logoChanged || hoursChanged ? 'Ajustes guardados correctamente.' : 'No hay cambios para guardar.',
          'success'
        )
      } catch (error) {
        showBusinessSettingsFeedback(error.message, 'error')
      } finally {
        els.businessSettingsSubmit.disabled = false
        els.businessSettingsSubmit.textContent = 'Guardar ajustes'
      }
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

    function agendaProfessionalColor(professionalId, index = 0) {
      const palette = ['#2563eb', '#8b5cf6', '#10b981', '#f97316', '#ef4444', '#14b8a6']
      const professionals = activeProfessionals()
      const resolvedIndex = index >= 0 ? index : professionals.findIndex((professional) => professional.id === professionalId)
      return palette[Math.max(0, resolvedIndex) % palette.length]
    }

    function formatCompactNumber(value) {
      if (value >= 1000) {
        return new Intl.NumberFormat('es-AR', {
          notation: 'compact',
          maximumFractionDigits: 1
        }).format(value)
      }

      return String(value)
    }

    function getProfessionalMetrics() {
      const now = new Date()
      const currentMonth = monthRange(now)
      const previousMonth = monthRange(new Date(now.getFullYear(), now.getMonth() - 1, 1))
      const currentAppointments = appointmentsInRange(currentMonth.start, currentMonth.end)
      const previousAppointments = appointmentsInRange(previousMonth.start, previousMonth.end)
      const currentAttendedAppointments = attendedAppointmentsInRange(currentMonth.start, currentMonth.end)
      const previousAttendedAppointments = attendedAppointmentsInRange(previousMonth.start, previousMonth.end)

      return {
        currentAppointments: currentAppointments.length,
        currentClients: uniqueAppointmentCustomers(currentAttendedAppointments),
        appointmentTrend: percentageChange(currentAppointments.length, previousAppointments.length),
        clientTrend: percentageChange(
          uniqueAppointmentCustomers(currentAttendedAppointments),
          uniqueAppointmentCustomers(previousAttendedAppointments)
        )
      }
    }

    function appointmentsInRange(start, end) {
      return (state.agendaAppointments || [])
        .filter(isActiveAppointment)
        .filter((appointment) => {
          const startAt = new Date(appointment.startAt)
          return startAt >= start && startAt < end
        })
    }

    function attendedAppointmentsInRange(start, end) {
      return (state.agendaAppointments || [])
        .filter(isAttendedAppointment)
        .filter((appointment) => {
          const startAt = new Date(appointment.startAt)
          return startAt >= start && startAt < end
        })
    }

    function uniqueAppointmentCustomers(appointments) {
      return new Set(appointments.map((appointment) => appointment.customerId).filter(Boolean)).size
    }

    function monthRange(date) {
      const start = new Date(date.getFullYear(), date.getMonth(), 1)
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 1)

      return { start, end }
    }

    function percentageChange(current, previous) {
      if (previous === 0) {
        return current === 0 ? 0 : 100
      }

      return Math.round(((current - previous) / previous) * 100)
    }

    function renderMetricTrend(element, value) {
      const sign = value > 0 ? '+' : ''
      element.textContent = sign + value + '%'
      element.classList.toggle('negative', value < 0)
      element.classList.toggle('muted', value === 0)
    }

    function summarizeProfessionalServices(professional) {
      const services = professional.services || []
      if (services.length) {
        return services.map((service) => service.name).join(', ')
      }

      if (!state.services.length) {
        return 'Corte, Color, Peinados'
      }

      return 'Sin servicios asignados'
    }

    function getSelectedProfessionalServiceIds() {
      if (!els.professionalServices) return []

      return Array.from(els.professionalServices.querySelectorAll('input[type="checkbox"]:checked'))
        .map((input) => input.value)
        .filter(Boolean)
    }

    function setSelectedProfessionalServiceIds(serviceIds = []) {
      if (!els.professionalServices) return
      const selected = new Set(serviceIds)

      for (const input of els.professionalServices.querySelectorAll('input[type="checkbox"]')) {
        input.checked = selected.has(input.value)
      }
    }

    function renderProfessionalServiceOptions(selectedIds = []) {
      if (!els.professionalServices) return

      const selected = new Set(selectedIds)
      els.professionalServices.innerHTML = state.services.length
        ? state.services.map((service) => {
            return '<label class="professional-service-option">' +
              '<input type="checkbox" value="' + service.id + '"' + (selected.has(service.id) ? ' checked' : '') + '>' +
              '<span>' + escapeHtml(service.name) + '</span>' +
            '</label>'
          }).join('')
        : '<div class="professional-form-help">No hay servicios cargados</div>'
    }

    function setProfessionalAvatar(avatarUrl) {
      state.professionalAvatarUrl = avatarUrl
      els.professionalPhotoPreview.src = avatarUrl || ''
      els.professionalPhotoPicker.classList.toggle('has-image', Boolean(avatarUrl))
      if (!avatarUrl) {
        els.professionalAvatar.value = ''
      }
    }

    function readProfessionalAvatar(event) {
      const file = event.target.files?.[0]
      if (!file) {
        return
      }

      if (!file.type.startsWith('image/')) {
        els.professionalFeedback.textContent = 'Elegí una imagen valida.'
        setProfessionalAvatar(null)
        return
      }

      const reader = new FileReader()
      reader.addEventListener('load', () => {
        setProfessionalAvatar(String(reader.result || ''))
      })
      reader.readAsDataURL(file)
    }

    function summarizeWorkingHourPills(hours) {
      if (!hours.length) {
        return '<span class="professional-hours-pill">Sin horarios</span>'
      }

      return summarizeWorkingHours(hours)
        .split(' Â· ')
        .slice(0, 2)
        .map((value) => '<span class="professional-hours-pill">' + escapeHtml(value.replace(' a ', ' - ')) + '</span>')
        .join('')
    }

    function renderAgendaFilters() {
      const selectedProfessional = els.agendaProfessional.value || ''
      const selectedService = els.agendaService.value || ''
      els.agendaProfessional.innerHTML = ['<option value="">Todos los profesionales</option>']
        .concat(activeProfessionals().map((professional) => {
          return '<option value="' + professional.id + '">' + escapeHtml(professional.name) + '</option>'
        }))
        .join('')
      els.agendaProfessional.value = activeProfessionals().some((professional) => professional.id === selectedProfessional) ? selectedProfessional : ''

      els.agendaService.innerHTML = ['<option value="">Todos los servicios</option>']
        .concat(state.services.map((service) => {
          return '<option value="' + service.id + '">' + escapeHtml(service.name) + '</option>'
        }))
        .join('')
      els.agendaService.value = state.services.some((service) => service.id === selectedService) ? selectedService : ''
      renderAgendaProfessionalControls()
    }

    function renderAgendaProfessionalControls() {
      const professionals = activeProfessionals()
      const selected = els.agendaProfessional.value || ''
      const tabs = [
        '<button class="agenda-pro-tab' + (!selected ? ' active' : '') + '" type="button" data-agenda-pro-tab="">' +
          'Todos' +
        '</button>'
      ].concat(professionals.map((professional, index) => {
        const color = agendaProfessionalColor(professional.id, index)
        return '<button class="agenda-pro-tab' + (selected === professional.id ? ' active' : '') + '" type="button" data-agenda-pro-tab="' + professional.id + '">' +
          '<span class="agenda-dot" style="--agenda-color:' + color + '"></span>' +
          escapeHtml(professional.name) +
        '</button>'
      }))

      els.agendaProfessionalTabs.innerHTML = tabs.join('')
      for (const button of els.agendaProfessionalTabs.querySelectorAll('[data-agenda-pro-tab]')) {
        button.addEventListener('click', async () => {
          els.agendaProfessional.value = button.dataset.agendaProTab || ''
          renderAgendaProfessionalControls()
          await loadAgenda()
        })
      }

      els.agendaLegend.innerHTML = '<strong>Profesionales</strong>' + professionals.map((professional, index) => {
        const color = agendaProfessionalColor(professional.id, index)
        return '<div class="agenda-legend-item">' +
          '<span class="agenda-dot" style="--agenda-color:' + color + '"></span>' +
          '<span>' + escapeHtml(professional.name) + '</span>' +
        '</div>'
      }).join('') +
        '<div class="agenda-legend-item"><span class="agenda-dot" style="--agenda-color:#cbd5e1"></span><span>No disponible</span></div>'
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
      renderProfessionals()
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
      const displayRange = getAgendaDisplayRange()
      const startMinute = displayRange.start
      const endMinute = displayRange.end
      const pixelsPerMinute = 28 / 15
      const rowHeight = step * pixelsPerMinute
      const rows = []

      els.agendaRange.textContent = formatAgendaRange(days[0], days[6])
      els.agendaToday.textContent = isDateInRange(new Date(), days[0], addDays(days[6], 1)) ? 'Hoy' : 'Ir a hoy'

      rows.push('<div class="agenda-grid" style="--agenda-row-height:' + rowHeight + 'px">')
      rows.push('<div class="agenda-corner"></div>')

      for (const day of days) {
        const todayClass = dateKey(day) === dateKey(new Date()) ? ' today' : ''
        rows.push('<button class="agenda-day-head' + todayClass + '" type="button" data-agenda-date="' + dateKey(day) + '">' + formatAgendaDayHeader(day) + '</button>')
      }

      for (let minute = startMinute; minute < endMinute; minute += step) {
        rows.push('<div class="agenda-time">' + formatMinuteLabel(minute) + '</div>')
        for (const day of days) {
          const closed = isClosedAgendaSlot(day, minute)
          const today = dateKey(day) === dateKey(new Date())
          rows.push('<div class="agenda-cell' + (today ? ' today' : '') + (closed ? ' closed' : '') + '" data-cell-date="' + dateKey(day) + '" data-cell-minute="' + minute + '"></div>')
        }
      }

      const now = new Date()
      const nowMinute = now.getHours() * 60 + now.getMinutes()
      if (isDateInRange(now, days[0], addDays(days[6], 1)) && nowMinute >= startMinute && nowMinute < endMinute) {
        const top = 38 + (nowMinute - startMinute) * pixelsPerMinute
        rows.push('<div class="agenda-now-line" data-time="' + escapeHtml(formatTimeOnly(now)) + '" style="top:' + top + 'px"></div>')
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
        pixelsPerMinute,
        startMinute
      })
      enableAgendaDragAndDrop()
    }

    function getAgendaDisplayRange() {
      const starts = state.businessHours.map((hour) => timeToMinutes(hour.startTime))
      const ends = state.businessHours.map((hour) => timeToMinutes(hour.endTime))
      const start = starts.length ? Math.min(...starts) : 9 * 60
      const end = ends.length ? Math.max(...ends) : 19 * 60

      return {
        start: Math.floor(start / 60) * 60,
        end: Math.ceil(end / 60) * 60
      }
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
        const height = Math.max(24, duration * input.pixelsPerMinute - 4)
        const top = Math.max(2, (minute - roundedMinute) * input.pixelsPerMinute + 2)
        const customer = appointment.customer?.name || 'Cliente'
        const professional = appointment.professional?.name || 'Profesional'
        const service = appointment.service?.name || 'Servicio'
        const professionalIndex = activeProfessionals().findIndex((item) => item.id === appointment.professionalId)
        const eventColor = agendaProfessionalColor(appointment.professionalId, professionalIndex)
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
        event.style.setProperty('--agenda-event-color', eventColor)
        event.title = customer + ' - ' + service + ' con ' + professional + (noShow ? ' - Ausente' : '')
        event.innerHTML = '<strong>' + escapeHtml(formatTimeOnly(start) + ' - ' + formatTimeOnly(addMinutes(start, duration))) + '</strong>' +
          '<span>' + escapeHtml(service) + '</span>' +
          '<span>' + escapeHtml(customer + (noShow ? ' - Ausente' : '')) + '</span>'
        event.dataset.appointmentId = appointment.id
        event.draggable = true
        event.addEventListener('click', (clickEvent) => {
          clickEvent.stopPropagation()
          if (state.agendaDidDrag) {
            state.agendaDidDrag = false
            return
          }
          openAppointmentDialog({ appointment })
        })
        cell.appendChild(event)
      }
    }

    function enableAgendaDragAndDrop() {
      for (const event of els.agendaGridWrap.querySelectorAll('.agenda-event[data-appointment-id]')) {
        event.addEventListener('dragstart', (dragEvent) => {
          state.agendaDraggingAppointmentId = event.dataset.appointmentId
          state.agendaDidDrag = true
          event.classList.add('dragging')
          dragEvent.dataTransfer.effectAllowed = 'move'
          dragEvent.dataTransfer.setData('text/plain', event.dataset.appointmentId)
        })
        event.addEventListener('dragend', () => {
          event.classList.remove('dragging')
          state.agendaDraggingAppointmentId = null
          clearAgendaDragTargets()
          setTimeout(() => {
            state.agendaDidDrag = false
          }, 200)
        })
      }

      for (const cell of els.agendaGridWrap.querySelectorAll('[data-cell-date][data-cell-minute]')) {
        cell.addEventListener('dragover', (dragEvent) => {
          if (!state.agendaDraggingAppointmentId) return
          dragEvent.preventDefault()
          dragEvent.dataTransfer.dropEffect = 'move'
          cell.classList.toggle('drag-invalid', cell.classList.contains('closed'))
          cell.classList.toggle('drag-target', !cell.classList.contains('closed'))
        })
        cell.addEventListener('dragleave', () => {
          cell.classList.remove('drag-target', 'drag-invalid')
        })
        cell.addEventListener('drop', async (dropEvent) => {
          dropEvent.preventDefault()
          const appointmentId = state.agendaDraggingAppointmentId || dropEvent.dataTransfer.getData('text/plain')
          clearAgendaDragTargets()
          if (!appointmentId || cell.classList.contains('closed')) {
            if (cell.classList.contains('closed')) showCrmToast('Ese horario esta fuera del horario de atencion.', 'error')
            return
          }
          await moveAgendaAppointment(
            appointmentId,
            cell.dataset.cellDate,
            Number(cell.dataset.cellMinute)
          )
        })
      }
    }

    function clearAgendaDragTargets() {
      for (const cell of els.agendaGridWrap.querySelectorAll('.drag-target, .drag-invalid')) {
        cell.classList.remove('drag-target', 'drag-invalid')
      }
    }

    async function moveAgendaAppointment(appointmentId, targetDateKey, targetMinute) {
      const appointment = state.agendaAppointments.find((item) => item.id === appointmentId)
      if (!appointment) return

      const target = parseDateKey(targetDateKey)
      target.setHours(Math.floor(targetMinute / 60), targetMinute % 60, 0, 0)
      if (new Date(appointment.startAt).getTime() === target.getTime()) return

      const event = els.agendaGridWrap.querySelector('[data-appointment-id="' + appointmentId + '"]')
      event?.classList.add('dragging')
      try {
        await getJson('/appointments/' + appointmentId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: appointment.customerId,
            professionalId: appointment.professionalId,
            serviceId: appointment.serviceId,
            startAt: target.toISOString()
          })
        })
        state.agendaSelectedDate = target
        state.agendaMonthDate = new Date(target)
        await loadAgenda()
      } catch (error) {
        event?.classList.remove('dragging')
        showCrmToast(error.message, 'error')
        renderAgenda()
      } finally {
        state.agendaDraggingAppointmentId = null
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
      els.appointmentForce.checked = false
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
      const force = els.appointmentForce.checked
      let customerId = els.appointmentCustomer.value

      if (!startAt || !professionalId || !serviceId) {
        els.appointmentFeedback.textContent = 'Completa fecha, profesional y servicio.'
        return
      }

      if (force && !requestCrmConfirmation('appointment-force:' + (state.editingAppointmentId || startAt), 'Guardar este turno como excepcion? Puede quedar fuera de horario o superpuesto con otro turno.')) {
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
            startAt: new Date(startAt).toISOString(),
            force
          })
        })

        closeAppointmentDialog()
        await loadAgenda()
        if (state.selected) {
          await loadAppointments()
          renderAppointments()
        }
      } catch (error) {
        const suggestion = error.message.includes('horario') || error.message.includes('disponible') || error.message.includes('bloqueado')
          ? ' Podes marcar Turno excepcional si decidiste forzarlo manualmente.'
          : ''
        els.appointmentFeedback.textContent = error.message + suggestion
      }
    }

    async function deleteManualAppointment() {
      const appointmentId = state.editingAppointmentId
      if (!appointmentId) return
      if (!requestCrmConfirmation('delete-appointment:' + appointmentId, 'Eliminar este turno de la agenda?')) return

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
      if (!requestCrmConfirmation('appointment-status:' + appointmentId + ':' + nextStatus, isNoShow ? 'Quitar el estado ausente de este turno?' : 'Marcar este turno como ausente?')) return

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

    const campaignTypeLabels = { ONE_TIME: 'Puntual', AUTOMATED: 'Autom&aacute;tica' }
    const campaignChannelLabels = { WHATSAPP: 'WhatsApp', EMAIL: 'Email', BOTH: 'Ambos' }
    const campaignStatusLabels = { DRAFT: 'Borrador', SCHEDULED: 'Programada', ACTIVE: 'Activa', PAUSED: 'Pausada', FINISHED: 'Finalizada' }
    const campaignSegmentLabels = {
      ALL: 'Todos los autorizados',
      AT_RISK: 'Clientes en riesgo',
      INACTIVE: 'Inactivos',
      ONE_TIME_VISITOR: 'Visit&oacute; una sola vez',
      NEW_CUSTOMER: 'Clientes nuevos',
      INACTIVE_90: 'Sin reservas por 90 d&iacute;as',
      BIRTHDAY: 'Cumplea&ntilde;os del mes',
      FREQUENT: 'Clientes frecuentes',
      NO_FUTURE_APPOINTMENT: 'Sin pr&oacute;ximo turno',
      MANUAL: 'Selecci&oacute;n manual'
    }
    const campaignPriorityLabels = { 1: 'Baja', 2: 'Media', 3: 'Alta' }
    const campaignEmojiCatalog = {
      smileys: {
        label: 'caras personas gestos gente',
        emojis: '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫣 🤭 🫢 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👻 💀 ☠️ 👽 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾 👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦿 🦵 🦶 👂 👃 🧠 🫀 🫁 🦷 👀 👁️ 👅 👄 🧑 👨 👩 👧 👦 👶 👵 👴 💇 💆'.split(' ')
      },
      animals: {
        label: 'animales naturaleza plantas flores clima',
        emojis: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐽 🐸 🐵 🙈 🙉 🙊 🐒 🐔 🐧 🐦 🐤 🐣 🐥 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪱 🐛 🦋 🐌 🐞 🐜 🪰 🪲 🪳 🦟 🦗 🕷️ 🦂 🐢 🐍 🦎 🐙 🦑 🦐 🦞 🦀 🐠 🐟 🐡 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🦧 🐘 🦛 🦏 🐪 🐫 🦒 🦘 🦬 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐈 🪶 🐓 🦃 🦚 🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦫 🦦 🦥 🐁 🐀 🐿️ 🦔 🐾 🌵 🎄 🌲 🌳 🌴 🪵 🌱 🌿 ☘️ 🍀 🎍 🪴 🎋 🍃 🍂 🍁 🍄 🐚 🪨 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌞 🌝 🌚 🌙 ⭐ 🌟 ✨ ⚡ 🔥 🌈 ☀️ 🌤️ ⛅ 🌧️ ⛈️ ❄️ ☃️ 💧 🌊'.split(' ')
      },
      food: {
        label: 'comida bebida frutas restaurante café dulce',
        emojis: '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🫘 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🫓 🥪 🥙 🧆 🌮 🌯 🫔 🥗 🥘 🫕 🥫 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 ☕ 🫖 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾 🧊 🥄 🍴 🍽️'.split(' ')
      },
      activities: {
        label: 'actividades deporte fiesta música juego premio',
        emojis: '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🪃 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 ⛷️ 🏂 🪂 🏋️ 🤼 🤸 ⛹️ 🤺 🤾 🏌️ 🏇 🧘 🏄 🏊 🤽 🚣 🧗 🚵 🚴 🏆 🥇 🥈 🥉 🏅 🎖️ 🏵️ 🎗️ 🎫 🎟️ 🎪 🤹 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🪗 🎸 🎻 🎲 ♟️ 🎯 🎳 🎮 🎰 🧩 🎉 🎊 🎈 🎁 🎀 🪅 🪩'.split(' ')
      },
      travel: {
        label: 'viajes lugares transporte vacaciones ciudad',
        emojis: '🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🦯 🦽 🦼 🛴 🚲 🛵 🏍️ 🛺 🚨 🚔 🚍 🚘 🚖 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ 🛟 ⛽ 🚧 🚦 🚥 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏕️ ⛺ 🛖 🏠 🏡 🏢 🏥 🏦 🏨 🏪 🏫 🏬 🏭 🏗️ 💒 🏛️ ⛪ 🕌 🕍 🛕 🕋 ⛩️ 🛤️ 🛣️ 🗾 🎑 🏞️ 🌅 🌄 🌠 🎇 🎆 🌇 🌆 🏙️ 🌃 🌌 🌉 🌁'.split(' ')
      },
      objects: {
        label: 'objetos belleza trabajo tecnología ropa herramientas',
        emojis: '⌚ 📱 📲 💻 ⌨️ 🖥️ 🖨️ 🖱️ 🖲️ 🕹️ 🗜️ 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽️ 🎞️ 📞 ☎️ 📟 📠 📺 📻 🎙️ 🎚️ ⏱️ ⏰ 🕰️ ⌛ ⏳ 📡 🔋 🪫 🔌 💡 🔦 🕯️ 🧯 🛢️ 💸 💵 💴 💶 💷 🪙 💳 🧾 💎 ⚖️ 🪜 🧰 🪛 🔧 🔨 ⚒️ 🛠️ ⛏️ 🪚 🔩 ⚙️ ⛓️ 🧲 🔫 💣 🧨 🪓 🔪 🗡️ ⚔️ 🛡️ 🚬 ⚰️ 🪦 ⚱️ 🔮 📿 🧿 💈 ⚗️ 🔭 🔬 🩹 🩺 💊 💉 🩸 🧬 🦠 🧫 🧪 🌡️ 🧹 🪠 🧺 🧻 🚽 🚿 🛁 🧼 🪥 🪒 🧽 🪣 🧴 🛎️ 🔑 🗝️ 🚪 🪑 🛋️ 🛏️ 🧸 🖼️ 🛍️ 🛒 🎁 👓 🕶️ 🥽 🥼 🦺 👔 👕 👖 🧣 🧤 🧥 🧦 👗 👘 🩱 🩲 🩳 👙 👚 👛 👜 👝 🎒 👞 👟 🥾 🥿 👠 👡 🩰 👢 👑 👒 🎩 🎓 🧢 💄 💍'.split(' ')
      },
      symbols: {
        label: 'símbolos corazones números señales formas',
        emojis: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉️ ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆔 ⚛️ ☢️ ☣️ 📴 📳 🈶 🈚 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕ 🛑 ⛔ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿ 🅿️ 🛗 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 ⚧️ 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 ▶️ ⏸️ ⏯️ ⏹️ ⏺️ ⏭️ ⏮️ ⏩ ⏪ 🔀 🔁 🔂 ➕ ➖ ➗ ✖️ 🟰 ♾️ ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 ⬛ ⬜'.split(' ')
      },
      flags: {
        label: 'banderas países argentina mundo',
        emojis: '🏁 🚩 🎌 🏴 🏳️ 🏳️‍🌈 🏳️‍⚧️ 🇦🇷 🇺🇾 🇧🇷 🇨🇱 🇵🇾 🇧🇴 🇵🇪 🇨🇴 🇻🇪 🇪🇨 🇲🇽 🇺🇸 🇨🇦 🇪🇸 🇮🇹 🇫🇷 🇩🇪 🇬🇧 🇵🇹 🇳🇱 🇧🇪 🇨🇭 🇦🇹 🇬🇷 🇮🇪 🇩🇰 🇸🇪 🇳🇴 🇫🇮 🇵🇱 🇨🇿 🇭🇺 🇷🇴 🇺🇦 🇷🇺 🇹🇷 🇮🇱 🇸🇦 🇦🇪 🇪🇬 🇲🇦 🇿🇦 🇳🇬 🇰🇪 🇮🇳 🇨🇳 🇯🇵 🇰🇷 🇹🇭 🇻🇳 🇮🇩 🇵🇭 🇦🇺 🇳🇿'.split(' ')
      }
    }
    const defaultCampaignEmojis = '😊 ✨ 🎉 🎁 ❤️ 🙌 👋 🔥 📅 ⏰ 💇 💅 👍 🥰 😍 🎂 🌟 💖 ✅'.split(' ')

    function setMarketingView(view) {
      state.marketingView = view
      els.campaignsContent.hidden = view !== 'campaigns'
      els.templateManager.hidden = view !== 'templates'
      els.reminderManager.hidden = view !== 'reminders'
      for (const button of els.marketingMainTabs.querySelectorAll('[data-marketing-view]')) button.classList.toggle('active', button.dataset.marketingView === view)
      for (const button of document.querySelectorAll('.workspace-nav .nav-subitems [data-marketing-nav]')) button.classList.toggle('active', els.appShell.dataset.section === 'campaigns' && button.dataset.marketingNav === view)
      document.querySelector('.campaigns-title h2').textContent = view === 'templates' ? 'Plantillas de WhatsApp' : 'Campañas'
      document.querySelector('.campaigns-title p').textContent = view === 'templates' ? 'Creá y administrá plantillas de Marketing y Recordatorios para revisión de Meta.' : 'Segmentá clientes, enviá mensajes y generá más reservas.'
      els.campaignSearch.placeholder = view === 'templates' ? 'Buscar plantilla' : 'Buscar campaña'
      els.campaignSearch.value = view === 'templates' ? state.templateSearch : state.campaignSearch
      els.campaignNew.innerHTML = '<span class="campaign-new-plus">+</span>' + (view === 'templates' ? 'Nueva plantilla' : view === 'reminders' ? 'Nuevo recordatorio' : 'Nueva campaña')
      els.templateSyncAll.hidden = view !== 'templates'
      if (view === 'templates' && !state.templatesLoaded) loadWhatsappTemplates()
      if (view === 'reminders') {
        document.querySelector('.campaigns-title h2').textContent = 'Recordatorios automáticos'
        document.querySelector('.campaigns-title p').textContent = 'Configurá recordatorios de turnos con plantillas aprobadas por Meta.'
        els.campaignSearch.placeholder = 'Buscar recordatorio'
        els.campaignNew.hidden = false
        loadReminderSettings()
      } else {
        els.campaignNew.hidden = false
      }
    }

    async function loadWhatsappTemplates() {
      if (!state.businessId) return
      try {
        state.whatsappTemplates = await getJson('/whatsapp-templates?businessId=' + encodeURIComponent(state.businessId))
        state.templatesLoaded = true
        if (!state.selectedTemplateId || !state.whatsappTemplates.some((item) => item.id === state.selectedTemplateId)) state.selectedTemplateId = state.whatsappTemplates[0]?.id || null
        renderWhatsappTemplates()
        renderReminderSettings()
      } catch (error) {
        els.templateTableBody.innerHTML = '<tr class="campaign-empty-row"><td colspan="6">' + escapeHtml(error.message) + '</td></tr>'
      }
    }

    async function syncAllWhatsappTemplates() {
      const syncable = state.whatsappTemplates.filter((item) => item.status !== 'DRAFT')
      if (!syncable.length) return
      els.templateSyncAll.disabled = true
      els.templateSyncAll.textContent = 'Actualizando...'
      try {
        for (const template of syncable) {
          await getJson('/whatsapp-templates/' + template.id + '/sync', { method: 'POST' })
        }
        await loadWhatsappTemplates()
      } catch (error) {
        els.templateDetailPanel.insertAdjacentHTML('afterbegin', '<div class="template-rejection">' + escapeHtml(error.message) + '</div>')
      } finally {
        els.templateSyncAll.disabled = false
        els.templateSyncAll.textContent = 'Actualizar todas'
      }
    }

    async function loadReminderSettings() {
      if (!state.businessId) return
      if (!state.templatesLoaded) await loadWhatsappTemplates()
      try {
        state.reminderAutomations = await getJson('/reminder-automations?businessId=' + encodeURIComponent(state.businessId))
        state.reminderLoaded = true
        if (state.selectedReminderId && !state.reminderAutomations.some((item) => item.id === state.selectedReminderId)) state.selectedReminderId = null
        renderReminderSettings()
      } catch (error) {
        els.reminderFeedback.textContent = error.message
        els.reminderFeedback.className = 'campaign-form-feedback error'
      }
    }

    function reminderTimeLabel(minutes) {
      if (Number(minutes) === 60) return '1 hora'
      if (Number(minutes) === 120) return '2 horas'
      if (Number(minutes) === 2880) return '48 hs'
      return '24 hs'
    }

    function approvedReminderTemplates() {
      return state.whatsappTemplates.filter((item) => item.status === 'APPROVED' && item.category === 'UTILITY')
    }

    function reminderChannelLabel(channel) {
      return channel === 'EMAIL' ? 'Email' : 'WhatsApp'
    }

    function currentReminderDraft() {
      return state.selectedReminderId
        ? (state.reminderAutomations.find((item) => item.id === state.selectedReminderId) || state.reminderDraft)
        : state.reminderDraft
    }

    function resetReminderDraft() {
      state.selectedReminderId = null
      state.pendingReminderDeleteConfirm = false
      state.reminderDraft = { name: '', channel: 'WHATSAPP', templateId: null, enabled: false, sendBeforeMinutes: 1440 }
      els.reminderFeedback.textContent = ''
      els.reminderFeedback.className = 'campaign-form-feedback'
      renderReminderSettings()
      els.reminderName?.focus()
    }

    function renderReminderSettings() {
      if (!els.reminderTemplate) return
      const templates = approvedReminderTemplates()
      const settings = currentReminderDraft()
      const query = state.campaignSearch.trim().toLowerCase()
      const filteredReminders = state.reminderAutomations.filter((item) => {
        const template = state.whatsappTemplates.find((templateItem) => templateItem.id === item.templateId)
        return !query || [item.name, template?.internalName, reminderChannelLabel(item.channel)].some((value) => String(value || '').toLowerCase().includes(query))
      })
      els.reminderList.innerHTML = filteredReminders.length
        ? filteredReminders.map((item) => {
            const template = state.whatsappTemplates.find((templateItem) => templateItem.id === item.templateId)
            return '<button class="reminder-list-button' + (item.id === state.selectedReminderId ? ' selected' : '') + '" type="button" data-reminder-id="' + escapeHtml(item.id) + '"><div class="campaign-recipient-row"><div class="campaign-recipient-avatar">' + (item.channel === 'EMAIL' ? '&#9993;' : '&#128276;') + '</div><div class="campaign-recipient-copy"><strong>' + escapeHtml(item.name) + '</strong><span>' + escapeHtml(template?.internalName || 'Sin plantilla') + ' · ' + escapeHtml(reminderTimeLabel(item.sendBeforeMinutes)) + ' antes</span></div><span class="reminder-channel-chip">' + escapeHtml(reminderChannelLabel(item.channel)) + '</span></div></button>'
          }).join('')
        : '<div class="template-variable-empty">Todavía no hay recordatorios. Creá uno para turnos por WhatsApp; Email queda preparado para más adelante.</div>'
      els.reminderTemplate.innerHTML = '<option value="">Seleccionar plantilla aprobada</option>' + templates.map((item) => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.internalName) + ' (' + escapeHtml(item.language) + ')</option>').join('')
      els.reminderName.value = settings.name || ''
      els.reminderChannel.value = settings.channel || 'WHATSAPP'
      els.reminderTemplate.value = settings.templateId || ''
      els.reminderBefore.value = String(settings.sendBeforeMinutes || 1440)
      els.reminderEnabled.checked = Boolean(settings.enabled)
      const activeCount = state.reminderAutomations.filter((item) => item.enabled).length
      els.reminderStatusLabel.textContent = activeCount ? activeCount + ' activos' : 'Pausado'
      els.reminderEnabledCopy.textContent = settings.enabled ? 'Activo' : 'Pausado'
      els.reminderTimeLabel.textContent = reminderTimeLabel(settings.sendBeforeMinutes || 1440)
      const template = templates.find((item) => item.id === settings.templateId)
      els.reminderTemplateLabel.textContent = state.reminderAutomations.length ? state.reminderAutomations.length + ' configurados' : 'Sin recordatorios'
      els.reminderDelete.hidden = !state.selectedReminderId
      els.reminderDelete.textContent = state.pendingReminderDeleteConfirm ? 'Confirmar eliminar' : 'Eliminar'
      els.reminderTemplate.disabled = settings.channel === 'EMAIL'
      els.reminderEnabled.disabled = settings.channel === 'EMAIL'
      els.reminderProcess.disabled = !state.reminderAutomations.some((item) => item.enabled && item.channel === 'WHATSAPP')
      els.reminderSave.textContent = state.selectedReminderId ? 'Guardar cambios' : 'Crear recordatorio'
      els.reminderDetailPanel.innerHTML = settings.channel === 'EMAIL'
        ? '<div class="campaign-detail-empty"><div><strong>Email preparado para más adelante</strong><br>Este canal queda modelado, pero todavía no se activa ni envía mensajes.</div></div>'
        : template
        ? '<div class="template-detail-head"><div>' + templateStatusBadge(template.status) + '<h3>' + escapeHtml(template.internalName) + '</h3><p class="template-meta-line">Nombre en Meta: ' + escapeHtml(template.metaName) + '</p></div></div><div class="template-preview">' + (template.imageUrl ? '<img class="template-detail-preview-image" src="' + escapeHtml(template.imageUrl) + '" alt="Imagen de la plantilla">' : '') + '<div class="template-preview-message">' + escapeHtml(template.body) + '</div></div><div class="template-review-note"><strong>Preparado para recordatorios.</strong><span>El envío real se conectará en el siguiente paso.</span></div>'
        : '<div class="campaign-detail-empty"><div><strong>Recordatorio automático</strong><br>Elegí una plantilla aprobada de Recordatorio para ver la vista previa.</div></div>'
    }

    function updateReminderDraftFromForm() {
      const next = {
        ...currentReminderDraft(),
        businessId: state.businessId,
        name: els.reminderName.value.trim(),
        channel: els.reminderChannel.value,
        templateId: els.reminderChannel.value === 'EMAIL' ? null : (els.reminderTemplate.value || null),
        enabled: els.reminderChannel.value === 'EMAIL' ? false : els.reminderEnabled.checked,
        sendBeforeMinutes: Number(els.reminderBefore.value || 1440)
      }
      if (state.selectedReminderId) {
        state.reminderAutomations = state.reminderAutomations.map((item) => item.id === state.selectedReminderId ? { ...item, ...next } : item)
      } else {
        state.reminderDraft = next
      }
      state.pendingReminderDeleteConfirm = false
      els.reminderFeedback.textContent = ''
      els.reminderFeedback.className = 'campaign-form-feedback'
      renderReminderSettings()
    }

    async function saveReminderSettings() {
      els.reminderFeedback.textContent = ''
      els.reminderSave.disabled = true
      try {
        const payload = {
          businessId: state.businessId,
          name: els.reminderName.value.trim(),
          channel: els.reminderChannel.value,
          templateId: els.reminderChannel.value === 'EMAIL' ? null : (els.reminderTemplate.value || null),
          enabled: els.reminderChannel.value === 'EMAIL' ? false : els.reminderEnabled.checked,
          sendBeforeMinutes: els.reminderBefore.value
        }
        const saved = await getJson(state.selectedReminderId ? '/reminder-automations/' + state.selectedReminderId : '/reminder-automations', {
          method: state.selectedReminderId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        state.selectedReminderId = saved.id
        state.reminderDraft = { name: '', channel: 'WHATSAPP', templateId: null, enabled: false, sendBeforeMinutes: 1440 }
        await loadReminderSettings()
        els.reminderFeedback.textContent = 'Recordatorio guardado.'
        els.reminderFeedback.className = 'campaign-form-feedback success'
      } catch (error) {
        els.reminderFeedback.textContent = error.message
        els.reminderFeedback.className = 'campaign-form-feedback error'
      } finally {
        els.reminderSave.disabled = false
      }
    }

    async function processDueReminders() {
      els.reminderFeedback.textContent = ''
      els.reminderFeedback.className = 'campaign-form-feedback'
      els.reminderProcess.disabled = true
      els.reminderProcess.textContent = 'Procesando...'
      try {
        const result = await getJson('/reminder-automations/process-due', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessId: state.businessId, limit: 100 })
        })
        els.reminderFeedback.textContent = result.total
          ? 'Procesado: ' + result.sent + ' enviados · ' + result.failed + ' fallidos.'
          : 'No hay recordatorios pendientes en este momento.'
        els.reminderFeedback.className = result.failed ? 'campaign-form-feedback error' : 'campaign-form-feedback success'
        await loadReminderSettings()
      } catch (error) {
        els.reminderFeedback.textContent = error.message
        els.reminderFeedback.className = 'campaign-form-feedback error'
      } finally {
        els.reminderProcess.textContent = 'Procesar pendientes'
        els.reminderProcess.disabled = !state.reminderAutomations.some((item) => item.enabled && item.channel === 'WHATSAPP')
      }
    }

    async function deleteSelectedReminder() {
      if (!state.selectedReminderId) return
      if (!state.pendingReminderDeleteConfirm) {
        state.pendingReminderDeleteConfirm = true
        els.reminderFeedback.textContent = 'Tocá Confirmar eliminar para borrar este recordatorio.'
        els.reminderFeedback.className = 'campaign-form-feedback error'
        renderReminderSettings()
        return
      }
      els.reminderDelete.disabled = true
      try {
        await getJson('/reminder-automations/' + state.selectedReminderId, { method: 'DELETE' })
        state.selectedReminderId = null
        state.pendingReminderDeleteConfirm = false
        await loadReminderSettings()
        els.reminderFeedback.textContent = 'Recordatorio eliminado.'
        els.reminderFeedback.className = 'campaign-form-feedback success'
      } catch (error) {
        els.reminderFeedback.textContent = error.message
        els.reminderFeedback.className = 'campaign-form-feedback error'
      } finally {
        els.reminderDelete.disabled = false
      }
    }

    function templateStatusLabel(status) {
      return { DRAFT: 'Borrador', PENDING: 'Pendiente', APPROVED: 'Aprobada', REJECTED: 'Rechazada', IN_APPEAL: 'En revisión', PAUSED: 'Pausada', DISABLED: 'Deshabilitada' }[status] || status
    }

    function templateStatusBadge(status) {
      const style = status === 'APPROVED' ? 'active' : ['PENDING', 'IN_APPEAL'].includes(status) ? 'paused' : ['REJECTED', 'DISABLED'].includes(status) ? 'rejected' : 'draft'
      return '<span class="campaign-badge ' + style + '">' + escapeHtml(templateStatusLabel(status)) + '</span>'
    }

    function templateCategoryLabel(category) {
      return category === 'UTILITY' ? 'Recordatorio' : 'Marketing'
    }

    function templateCategoryBadge(category) {
      return '<span class="campaign-badge template-category-badge ' + (category === 'UTILITY' ? 'utility' : 'automatic') + '">' + escapeHtml(templateCategoryLabel(category)) + '</span>'
    }

    function parseTemplateExampleJson(exampleJson) {
      if (!exampleJson) return {}
      try {
        const parsed = JSON.parse(exampleJson)
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function extractTemplateVariables(text) {
      const variables = []
      const seen = new Set()
      for (const match of String(text || '').matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)) {
        if (!seen.has(match[1])) {
          seen.add(match[1])
          variables.push(match[1])
        }
      }
      return variables
    }

    function supportedTemplateVariables(category = selectedTemplateCategory()) {
      return category === 'UTILITY'
        ? ['nombre_cliente', 'usuario', 'fecha_turno', 'hora_turno', 'servicio', 'profesional']
        : ['nombre_cliente', 'usuario', 'fecha_ultima_visita']
    }

    function templateVariableDescription(variable, category = selectedTemplateCategory()) {
      const descriptions = category === 'UTILITY'
        ? {
            nombre_cliente: 'Automático: nombre del cliente.',
            usuario: 'Alias temporal: usa el nombre del cliente.',
            fecha_turno: 'Automático: fecha del turno.',
            hora_turno: 'Automático: hora del turno.',
            servicio: 'Automático: servicio reservado.',
            profesional: 'Automático: profesional asignado.'
          }
        : {
            nombre_cliente: 'Automático: nombre del cliente.',
            usuario: 'Alias temporal: usa el nombre del cliente.',
            fecha_ultima_visita: 'Automático: última visita registrada del cliente.'
          }
      return descriptions[variable] || 'No compatible para ' + templateCategoryLabel(category) + '. Escribí ese dato fijo en el texto o cambiá el tipo de plantilla.'
    }

    function unsupportedTemplateVariables(variables, category = selectedTemplateCategory()) {
      const allowed = new Set(supportedTemplateVariables(category))
      return variables.filter((variable) => !allowed.has(variable))
    }

    function selectedTemplateCategory() {
      return els.templateCategoryUtility.checked ? 'UTILITY' : 'MARKETING'
    }

    function setTemplateCategory(category) {
      els.templateCategoryUtility.checked = category === 'UTILITY'
      els.templateCategoryMarketing.checked = category !== 'UTILITY'
      els.templateCategoryLabel.textContent = templateCategoryLabel(category)
      renderTemplateVariables()
      updateTemplateBuilderPreview()
    }

    function templatePreviewText() {
      const body = els.templateBody.value.trim()
      if (!body) return 'Escribí el mensaje para ver la vista previa.'
      return body.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, variable) => {
        return state.templateDraftExamples[variable] || '{{' + variable + '}}'
      })
    }

    function renderTemplateVariables() {
      const variables = extractTemplateVariables(els.templateBody.value)
      const unsupported = new Set(unsupportedTemplateVariables(variables))
      const nextExamples = {}
      for (const variable of variables) nextExamples[variable] = state.templateDraftExamples[variable] || ''
      state.templateDraftExamples = nextExamples
      els.templateVariablePanel.innerHTML = variables.length
        ? variables.map((variable, index) => {
            const isUnsupported = unsupported.has(variable)
            return '<label class="template-variable-row' + (isUnsupported ? ' unsupported' : '') + '"><span><span class="template-variable-chip" data-index="' + (index + 1) + '">{{' + escapeHtml(variable) + '}}</span><p class="template-variable-help">' + escapeHtml(templateVariableDescription(variable)) + '</p></span><input data-template-example="' + escapeHtml(variable) + '" placeholder="Ejemplo para Meta" value="' + escapeHtml(state.templateDraftExamples[variable] || '') + '"' + (isUnsupported ? ' disabled' : '') + '></label>'
          }).join('')
        : '<div class="template-variable-empty">No hay variables todavía. Si escribís algo como <strong>{{nombre_cliente}}</strong>, aparecerá acá para cargar el ejemplo.</div>'
      if (!variables.length) els.templateVariablePanel.innerHTML = '<div class="template-variable-empty">Variables compatibles para ' + escapeHtml(templateCategoryLabel(selectedTemplateCategory())) + ': <strong>' + supportedTemplateVariables().map((variable) => '{{' + variable + '}}').join('</strong>, <strong>') + '</strong>.</div>'
    }

    function setTemplateImage(imageUrl) {
      state.templateImageUrl = imageUrl || null
      els.templateImagePreviewImg.src = imageUrl || ''
      els.templateImagePreview.hidden = !imageUrl
      els.templateLiveImage.src = imageUrl || ''
      els.templateLiveImage.hidden = !imageUrl
      if (!imageUrl) els.templateImage.value = ''
      updateTemplateBuilderPreview()
    }

    function readTemplateImage(event) {
      const file = event.target.files?.[0]
      if (!file) return
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
        els.templateFormFeedback.textContent = 'Elegí una imagen PNG, JPG o WEBP de hasta 2 MB.'
        els.templateFormFeedback.className = 'campaign-form-feedback template-form-feedback error'
        els.templateImage.value = ''
        return
      }
      const reader = new FileReader()
      reader.addEventListener('load', () => setTemplateImage(String(reader.result || '')))
      reader.readAsDataURL(file)
    }

    function renderTemplateEmojiPicker() {
      els.templateEmojiPicker.innerHTML = defaultCampaignEmojis.map((emoji) => '<button type="button" data-template-emoji="' + escapeHtml(emoji) + '">' + escapeHtml(emoji) + '</button>').join('')
    }

    function insertTemplateEmoji(emoji) {
      const input = els.templateBody
      const start = input.selectionStart ?? input.value.length
      const end = input.selectionEnd ?? start
      input.value = input.value.slice(0, start) + emoji + input.value.slice(end)
      const nextPosition = start + emoji.length
      input.focus()
      input.setSelectionRange(nextPosition, nextPosition)
      renderTemplateVariables()
      updateTemplateBuilderPreview()
    }

    function updateTemplateBuilderPreview() {
      if (!els.templateLivePreview) return
      els.templateCategoryLabel.textContent = templateCategoryLabel(selectedTemplateCategory())
      const variables = extractTemplateVariables(els.templateBody.value)
      const missingExamples = variables.filter((variable) => !state.templateDraftExamples[variable]?.trim())
      const unsupported = unsupportedTemplateVariables(variables)
      els.templateLivePreview.textContent = templatePreviewText()
      els.templateLiveImage.src = state.templateImageUrl || ''
      els.templateLiveImage.hidden = !state.templateImageUrl
      els.templateChecklist.innerHTML =
        '<div><span>✓</span>Nombre en Meta ' + (els.templateMetaName.value.trim() ? 'cargado' : 'pendiente') + '</div>' +
        '<div class="' + (missingExamples.length ? 'warn' : '') + '"><span>' + (missingExamples.length ? '!' : '✓') + '</span>' + variables.length + ' variables detectadas' + (missingExamples.length ? ', faltan ejemplos' : ' con ejemplo') + '</div>' +
        '<div><span>✓</span>Categoría: ' + escapeHtml(templateCategoryLabel(selectedTemplateCategory())) + '</div>' +
        (state.templateImageUrl ? '<div><span>✓</span>Encabezado con imagen</div>' : '')
      if (unsupported.length) els.templateChecklist.insertAdjacentHTML('beforeend', '<div class="warn"><span>!</span>Variables no compatibles: ' + unsupported.map((variable) => '{{' + escapeHtml(variable) + '}}').join(', ') + '</div>')
    }

    function renderWhatsappTemplates() {
      const all = state.whatsappTemplates
      els.templateApprovedCount.textContent = all.filter((item) => item.status === 'APPROVED').length
      els.templatePendingCount.textContent = all.filter((item) => ['PENDING', 'IN_APPEAL'].includes(item.status)).length
      els.templateDraftCount.textContent = all.filter((item) => item.status === 'DRAFT').length
      els.templateRejectedCount.textContent = all.filter((item) => item.status === 'REJECTED').length
      const search = state.templateSearch.toLocaleLowerCase('es')
      const visible = all.filter((item) => (state.templateFilter === 'ALL' || item.status === state.templateFilter) && (!search || [item.internalName, item.metaName, item.body].some((value) => String(value || '').toLocaleLowerCase('es').includes(search))))
      els.templateTableBody.innerHTML = visible.length ? visible.map((item) => {
        const selected = item.id === state.selectedTemplateId ? ' class="selected"' : ''
        return '<tr' + selected + ' data-template-id="' + escapeHtml(item.id) + '"><td><strong>' + escapeHtml(item.internalName) + '</strong></td><td>' + escapeHtml(item.metaName) + '</td><td>' + templateCategoryBadge(item.category) + '</td><td>' + escapeHtml(item.language) + '</td><td>' + templateStatusBadge(item.status) + '</td><td>' + escapeHtml(formatDateTime(item.updatedAt)) + '</td></tr>'
      }).join('') : '<tr class="campaign-empty-row"><td colspan="6">No hay plantillas para este filtro.</td></tr>'
      els.templateListCopy.textContent = visible.length + (visible.length === 1 ? ' plantilla' : ' plantillas')
      renderWhatsappTemplateDetail()
      renderCampaignTemplateOptions()
    }

    function renderWhatsappTemplateDetail() {
      const item = state.whatsappTemplates.find((template) => template.id === state.selectedTemplateId)
      if (!item) {
        els.templateDetailPanel.innerHTML = '<div class="campaign-detail-empty"><div><strong>Seleccioná una plantilla</strong><br>Acá vas a ver su estado y contenido.</div></div>'
        return
      }
      const editable = ['DRAFT', 'REJECTED'].includes(item.status)
      const examples = parseTemplateExampleJson(item.exampleJson)
      const variables = extractTemplateVariables(item.body)
      const previewBody = item.body.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, variable) => examples[variable] || '{{' + variable + '}}')
      els.templateDetailPanel.innerHTML = '<div class="template-detail-head"><div>' + templateStatusBadge(item.status) + '<h3>' + escapeHtml(item.internalName) + '</h3><p class="template-meta-line">Nombre en Meta: ' + escapeHtml(item.metaName) + '</p></div></div>' +
        '<div class="template-preview">' + (item.imageUrl ? '<img class="template-detail-preview-image" src="' + escapeHtml(item.imageUrl) + '" alt="Imagen de la plantilla">' : '') + '<div class="template-preview-message">' + escapeHtml(previewBody) + '</div></div>' +
        (['PENDING', 'IN_APPEAL'].includes(item.status) ? '<div class="template-review-note"><strong>Aún en revisión por Meta.</strong><span>Podés volver a actualizar el estado dentro de unos minutos.</span></div>' : '') +
        (item.rejectionReason && String(item.rejectionReason).toUpperCase() !== 'NONE' ? '<div class="template-rejection"><strong>Motivo del rechazo:</strong><br>' + escapeHtml(item.rejectionReason) + '</div>' : '') +
        '<div class="template-detail-meta"><div><span>Categoría</span><strong>' + escapeHtml(templateCategoryLabel(item.category)) + '</strong></div><div><span>Idioma</span><strong>' + escapeHtml(item.language) + '</strong></div><div><span>Variables</span><strong>' + variables.length + '</strong></div><div><span>Campañas que la usan</span><strong>' + (item._count?.campaigns || 0) + '</strong></div><div><span>ID en Meta</span><strong>' + escapeHtml(item.metaId || 'Todavía no asignado') + '</strong></div></div>' +
        (item.status === 'APPROVED'
          ? '<div class="template-test-card"><strong>Prueba controlada</strong><p>Envía una sola prueba usando los ejemplos cargados en esta plantilla. No activa campañas.</p><div class="template-test-row"><input data-template-test-phone inputmode="tel" placeholder="5491112345678"><button class="campaign-outline-button" type="button" data-template-action="test-send">Enviar a mi número</button></div><label class="template-test-confirm"><input type="checkbox" data-template-test-confirm>Confirmo que este número es mío y autorizo este único envío.</label><p class="template-test-feedback" data-template-test-feedback></p></div>'
          : '') +
        '<div class="template-detail-actions">' + (editable ? '<button class="campaign-outline-button" type="button" data-template-action="edit">Editar borrador</button><button class="campaigns-new" type="button" data-template-action="submit">Enviar a revisión</button>' : '') + (item.status !== 'DRAFT' ? '<button class="campaign-outline-button" type="button" data-template-action="sync">Actualizar estado</button><button class="campaign-outline-button" type="button" data-template-action="diagnose">Diagnosticar en Meta</button>' : '') + '</div>'
      els.templateDetailPanel.querySelector('.template-detail-actions')?.insertAdjacentHTML('beforeend', '<button class="campaign-outline-button danger" type="button" data-template-action="delete">Eliminar plantilla</button>')
    }

    function renderTemplateMetaDiagnosis(diagnosis) {
      const local = diagnosis.local || {}
      const rows = (diagnosis.meta || []).map((item) => {
        const isRecommended = diagnosis.recommended?.id && diagnosis.recommended.id === item.id
        return '<tr><td>' + escapeHtml(item.name || '-') + '</td><td>' + escapeHtml(item.language || '-') + '</td><td>' + escapeHtml(item.status || '-') + '</td><td>' + escapeHtml(item.id || '-') + '</td><td>' + (isRecommended ? '<span class="campaign-badge active">Usar</span>' : '') + '</td></tr>'
      }).join('')
      return '<div class="template-test-card" data-template-diagnosis><strong>Diagnóstico de Meta</strong>' +
        '<p>Compara lo guardado en el CRM con las versiones que devuelve la API de Meta para este nombre.</p>' +
        '<div class="template-detail-meta"><div><span>CRM nombre</span><strong>' + escapeHtml(local.metaName || '-') + '</strong></div><div><span>CRM idioma</span><strong>' + escapeHtml(local.language || '-') + '</strong></div><div><span>CRM ID Meta</span><strong>' + escapeHtml(local.metaId || 'Sin ID') + '</strong></div><div><span>CRM estado</span><strong>' + escapeHtml(local.status || '-') + '</strong></div></div>' +
        (diagnosis.recommended ? '<div class="template-review-note"><strong>Recomendado por API:</strong><span>' + escapeHtml(diagnosis.recommended.name || '-') + ' · ' + escapeHtml(diagnosis.recommended.language || '-') + ' · ' + escapeHtml(diagnosis.recommended.status || '-') + '<br>' + escapeHtml(diagnosis.recommended.reason || '') + '</span></div>' : '<div class="template-rejection">Meta no devolvió ninguna plantilla con ese nombre.</div>') +
        '<div class="campaign-table-wrap"><table class="campaign-table template-table"><thead><tr><th>Nombre</th><th>Idioma</th><th>Estado</th><th>ID</th><th></th></tr></thead><tbody>' + (rows || '<tr class="campaign-empty-row"><td colspan="5">Sin resultados en Meta.</td></tr>') + '</tbody></table></div>' +
        '</div>'
    }

    function renderCampaignTemplateOptions(selectedId) {
      const currentId = selectedId || els.campaignWhatsappTemplate.value
      const approved = state.whatsappTemplates.filter((item) => item.status === 'APPROVED' && item.category !== 'UTILITY')
      els.campaignWhatsappTemplate.innerHTML = '<option value="">Seleccionar plantilla aprobada</option>' + approved.map((item) => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.internalName) + ' (' + escapeHtml(item.language) + ')</option>').join('')
      if (currentId) els.campaignWhatsappTemplate.value = currentId
    }

    function syncCampaignTemplateSelection() {
      const template = state.whatsappTemplates.find((item) => item.id === els.campaignWhatsappTemplate.value)
      els.campaignMessage.readOnly = true
      els.campaignMessage.value = template?.body || ''
    }

    function openTemplateDialog(template = null) {
      els.templateId.value = template?.id || ''
      els.templateInternalName.value = template?.internalName || ''
      els.templateMetaName.value = template?.metaName || ''
      state.templateDraftExamples = parseTemplateExampleJson(template?.exampleJson)
      setTemplateImage(template?.imageUrl || null)
      setTemplateCategory(template?.category || 'MARKETING')
      els.templateLanguage.value = template?.language || 'es_AR'
      els.templateBody.value = template?.body || ''
      els.templateDialogTitle.textContent = template ? 'Editar plantilla' : 'Nueva plantilla de WhatsApp'
      els.templateFormFeedback.textContent = ''
      els.templateFormFeedback.className = 'campaign-form-feedback template-form-feedback'
      renderTemplateVariables()
      updateTemplateBuilderPreview()
      els.templateDialog.hidden = false
      els.templateInternalName.focus()
    }

    function closeTemplateDialog() {
      els.templateDialog.hidden = true
      els.templateForm.reset()
      els.templateId.value = ''
      els.templateFormFeedback.textContent = ''
      els.templateFormFeedback.className = 'campaign-form-feedback template-form-feedback'
      state.templateDraftExamples = {}
      setTemplateImage(null)
      els.templateEmojiPicker.hidden = true
      setTemplateCategory('MARKETING')
    }

    async function saveTemplate(sendToMeta) {
      const variables = extractTemplateVariables(els.templateBody.value)
      const missingExamples = variables.filter((variable) => !state.templateDraftExamples[variable]?.trim())
      const unsupported = unsupportedTemplateVariables(variables)
      const payload = { businessId: state.businessId, internalName: els.templateInternalName.value.trim(), metaName: els.templateMetaName.value.trim(), category: selectedTemplateCategory(), language: els.templateLanguage.value, body: els.templateBody.value.trim(), examples: state.templateDraftExamples, imageUrl: state.templateImageUrl }
      if (!payload.internalName || !payload.metaName || !payload.body) {
        els.templateFormFeedback.textContent = 'Completá los nombres y el mensaje.'
        els.templateFormFeedback.className = 'campaign-form-feedback template-form-feedback error'
        return
      }
      if (unsupported.length) {
        els.templateFormFeedback.textContent = 'Variables no compatibles para ' + templateCategoryLabel(selectedTemplateCategory()) + ': ' + unsupported.map((variable) => '{{' + variable + '}}').join(', ') + '.'
        els.templateFormFeedback.className = 'campaign-form-feedback template-form-feedback error'
        return
      }
      if (missingExamples.length) {
        els.templateFormFeedback.textContent = 'Completá los ejemplos de Meta para: ' + missingExamples.join(', ') + '.'
        els.templateFormFeedback.className = 'campaign-form-feedback template-form-feedback error'
        return
      }
      const id = els.templateId.value
      try {
        const saved = await getJson(id ? '/whatsapp-templates/' + id : '/whatsapp-templates', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (sendToMeta) await getJson('/whatsapp-templates/' + saved.id + '/submit', { method: 'POST' })
        state.selectedTemplateId = saved.id
        closeTemplateDialog()
        await loadWhatsappTemplates()
      } catch (error) {
        els.templateFormFeedback.textContent = error.message
        els.templateFormFeedback.className = 'campaign-form-feedback template-form-feedback error'
      }
    }

    async function loadCampaigns() {
      if (!state.businessId) {
        state.campaigns = []
        state.campaignsLoaded = true
        renderCampaigns()
        if (state.selectedCampaignId) loadCampaignAudience(state.selectedCampaignId)
        return
      }

      try {
        if (!state.whatsappPricingLoaded) loadWhatsappPricing()
        state.campaigns = await getJson('/campaigns?businessId=' + encodeURIComponent(state.businessId))
        state.campaignsLoaded = true
        if (!state.selectedCampaignId || !state.campaigns.some((campaign) => campaign.id === state.selectedCampaignId)) {
          state.selectedCampaignId = state.campaigns[0]?.id || null
        }
        renderCampaigns()
      } catch (error) {
        state.campaignsLoaded = false
        els.campaignTableBody.innerHTML = '<tr class="campaign-empty-row"><td colspan="6">' + escapeHtml(error.message) + '</td></tr>'
        els.campaignDetailPanel.innerHTML = '<div class="campaign-detail-empty">No pudimos cargar las campa&ntilde;as.</div>'
      }
    }

    async function loadWhatsappPricing() {
      try {
        state.whatsappPricing = await getJson('/whatsapp-pricing')
        state.whatsappPricingLoaded = true
      } catch {
        state.whatsappPricingLoaded = false
      }
    }

    function filteredCampaigns() {
      const search = state.campaignSearch.toLocaleLowerCase('es')
      return state.campaigns.filter((campaign) => {
        if (state.campaignFilter !== 'ALL' && campaign.status !== state.campaignFilter) return false
        if (!search) return true
        return [campaign.name, campaign.segmentLabel, campaign.message, campaign.templateName]
          .some((value) => String(value || '').toLocaleLowerCase('es').includes(search))
      })
    }

    async function loadCampaignAudience(campaignId) {
      state.campaignAudiences[campaignId] = { loading: true }
      if (state.selectedCampaignId === campaignId) renderCampaignDetail()
      try {
        const results = await Promise.all([
          getJson('/campaigns/' + campaignId + '/audience-preview'),
          getJson('/campaigns/' + campaignId + '/deliveries'),
          getJson('/campaigns/' + campaignId + '/simulations/latest')
        ])
        state.campaignAudiences[campaignId] = results[0]
        state.campaignDeliveries[campaignId] = results[1]
        state.campaignSimulations[campaignId] = results[2]?.run || null
      } catch (error) {
        state.campaignAudiences[campaignId] = { error: error.message }
      }
      if (state.selectedCampaignId === campaignId) renderCampaignDetail()
    }

    function campaignBadgeClass(kind, value) {
      if (kind === 'type') return value === 'AUTOMATED' ? 'automatic' : 'single'
      if (kind === 'channel') return value === 'WHATSAPP' ? 'whatsapp' : value === 'EMAIL' ? 'email' : 'both'
      return { ACTIVE: 'active', SCHEDULED: 'scheduled', PAUSED: 'paused', DRAFT: 'draft', FINISHED: 'draft' }[value] || 'draft'
    }

    function campaignChannelSymbol(channel) {
      return channel === 'EMAIL' ? '&#9993;' : channel === 'BOTH' ? '&#9679;' : 'W'
    }

    function campaignNextSend(campaign) {
      if (!campaign.scheduledAt) return campaign.status === 'ACTIVE' && campaign.type === 'AUTOMATED' ? 'Seg&uacute;n condici&oacute;n' : 'Al activar'
      return escapeHtml(new Intl.DateTimeFormat('es-AR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(campaign.scheduledAt)))
    }

    function campaignSegmentNeedsDays(segment) {
      return ['INACTIVE', 'ONE_TIME_VISITOR', 'NEW_CUSTOMER'].includes(segment)
    }

    function syncCampaignAutomationFields(applySuggestedPriority = false) {
      const automated = els.campaignType.value === 'AUTOMATED'
      const segment = els.campaignSegment.value
      els.campaignAutomationSettings.hidden = !automated
      els.campaignPunctualSettings.hidden = automated
      els.campaignSegmentDaysField.hidden = !campaignSegmentNeedsDays(segment)
      els.campaignSegmentDays.required = automated && campaignSegmentNeedsDays(segment)
      els.campaignManualSettings.hidden = segment !== 'MANUAL'
      els.campaignPunctualCooldownDays.disabled = automated || !els.campaignPunctualRespectCooldown.checked
      els.campaignCooldownDays.disabled = !automated || !els.campaignAutomationRespectCooldown.checked
      els.campaignScheduleModeLabel.textContent = automated ? 'Cuándo comenzar' : 'Cuándo enviar'
      els.campaignScheduleMode.options[0].textContent = automated ? 'Al activar' : 'Enviar al activar'
      const scheduled = els.campaignScheduleMode.value === 'SCHEDULED'
      els.campaignScheduledAt.parentElement.hidden = !scheduled
      els.campaignScheduledAt.required = scheduled
      els.campaignScheduledAt.disabled = !scheduled
      els.campaignScheduledAtLabel.textContent = automated ? 'Comenzar desde' : 'Fecha y hora de envío'

      if (applySuggestedPriority) {
        const suggested = { ONE_TIME_VISITOR: 3, AT_RISK: 2, NEW_CUSTOMER: 2, INACTIVE: 1 }
        els.campaignPriority.value = String(suggested[segment] || 2)
      }
    }

    function renderCampaignManualCustomers() {
      els.campaignManualList.innerHTML = state.campaignManualItems.length
        ? state.campaignManualItems.map((customer) => {
            return '<label class="campaign-manual-option">' +
              '<input type="checkbox" value="' + escapeHtml(customer.id) + '" ' + (state.campaignManualSelected.has(customer.id) ? 'checked' : '') + '>' +
              '<span><strong>' + escapeHtml(customer.name) + '</strong><small>' + escapeHtml(formatCustomerPhone(customer.phone)) + '</small></span>' +
            '</label>'
          }).join('')
        : '<div class="customer-list-empty">No encontramos clientes.</div>'
      els.campaignManualCount.textContent = state.campaignManualSelected.size + (state.campaignManualSelected.size === 1 ? ' seleccionado' : ' seleccionados')
      els.campaignManualMore.hidden = state.campaignManualPage >= state.campaignManualTotalPages
    }

    async function loadCampaignManualCustomers(reset = true) {
      if (!state.businessId) return
      if (reset) {
        state.campaignManualPage = 1
        state.campaignManualItems = []
        els.campaignManualList.innerHTML = '<div class="customer-list-empty">Buscando clientes...</div>'
      }
      const params = new URLSearchParams({
        businessId: state.businessId,
        q: els.campaignManualSearch.value.trim(),
        page: String(state.campaignManualPage),
        take: '24'
      })
      try {
        const result = await getJson('/campaign-customer-options?' + params.toString())
        const known = new Set(state.campaignManualItems.map((customer) => customer.id))
        state.campaignManualItems = state.campaignManualItems.concat((result.items || []).filter((customer) => !known.has(customer.id)))
        state.campaignManualTotalPages = result.pagination?.totalPages || 1
        renderCampaignManualCustomers()
      } catch (error) {
        els.campaignManualList.innerHTML = '<div class="customer-list-empty">' + escapeHtml(error.message) + '</div>'
      }
    }

    function campaignConfiguredSegmentLabel(campaign) {
      const base = campaignSegmentLabels[campaign.segment] || escapeHtml(campaign.segmentLabel || campaign.segment)
      return campaign.segmentDays && campaignSegmentNeedsDays(campaign.segment)
        ? base + ' · ' + campaign.segmentDays + ' d&iacute;as'
        : base
    }

    function renderCampaigns() {
      const all = state.campaigns
      els.campaignTotal.textContent = String(all.length)
      els.campaignActiveCount.textContent = String(all.filter((campaign) => campaign.status === 'ACTIVE').length)
      els.campaignScheduledCount.textContent = String(all.filter((campaign) => campaign.status === 'SCHEDULED').length)
      els.campaignDraftCount.textContent = String(all.filter((campaign) => campaign.status === 'DRAFT').length)

      const filtered = filteredCampaigns()
      const totalPages = Math.max(1, Math.ceil(filtered.length / state.campaignTake))
      state.campaignPage = Math.min(Math.max(1, state.campaignPage), totalPages)
      const start = (state.campaignPage - 1) * state.campaignTake
      const visible = filtered.slice(start, start + state.campaignTake)

      els.campaignTableBody.innerHTML = visible.length
        ? visible.map((campaign) => {
            const selected = campaign.id === state.selectedCampaignId ? ' class="selected"' : ''
            const iconClass = campaign.channel === 'EMAIL' ? ' email' : campaign.type === 'ONE_TIME' ? ' tag' : ''
            return '<tr' + selected + ' data-campaign-id="' + escapeHtml(campaign.id) + '">' +
              '<td><div class="campaign-name-cell"><span class="campaign-row-icon' + iconClass + '">' + campaignChannelSymbol(campaign.channel) + '</span><span>' + escapeHtml(campaign.name) + '</span></div></td>' +
              '<td><span class="campaign-badge ' + campaignBadgeClass('type', campaign.type) + '">' + (campaignTypeLabels[campaign.type] || campaign.type) + '</span></td>' +
              '<td>' + campaignConfiguredSegmentLabel(campaign) + '</td>' +
              '<td><span class="campaign-badge ' + campaignBadgeClass('channel', campaign.channel) + '">' + (campaignChannelLabels[campaign.channel] || campaign.channel) + '</span></td>' +
              '<td>' + campaignNextSend(campaign) + '</td>' +
              '<td><span class="campaign-badge ' + campaignBadgeClass('status', campaign.status) + '">' + (campaignStatusLabels[campaign.status] || campaign.status) + '</span></td>' +
            '</tr>'
          }).join('')
        : '<tr class="campaign-empty-row"><td colspan="6">' +
            (state.campaigns.length ? 'No hay campa&ntilde;as que coincidan con el filtro.' : 'Todav&iacute;a no hay campa&ntilde;as.<br>Cre&aacute; la primera desde Nueva campa&ntilde;a.') +
          '</td></tr>'

      const shownFrom = filtered.length ? start + 1 : 0
      const shownTo = Math.min(start + visible.length, filtered.length)
      els.campaignPaginationCopy.textContent = 'Mostrando ' + shownFrom + ' a ' + shownTo + ' de ' + filtered.length + ' campañas'
      els.campaignPageNumber.textContent = String(state.campaignPage)
      els.campaignPagePrev.disabled = state.campaignPage <= 1
      els.campaignPageNext.disabled = state.campaignPage >= totalPages
      renderCampaignDetail()
    }

    function renderCampaignDetail() {
      const campaign = state.campaigns.find((item) => item.id === state.selectedCampaignId)
      if (!campaign) {
        els.campaignDetailPanel.innerHTML = '<div class="campaign-detail-empty"><div><strong>Seleccion&aacute; una campa&ntilde;a</strong><br>Ac&aacute; vas a ver su configuraci&oacute;n y podr&aacute;s editarla.</div></div>'
        return
      }

      const toggleLabel = campaign.status === 'ACTIVE' ? 'Pausar' : 'Activar'
      const audience = state.campaignAudiences[campaign.id]
      const deliveries = state.campaignDeliveries[campaign.id] || []
      const simulation = state.campaignSimulations[campaign.id]
      const simulationLoading = Boolean(state.campaignSimulationLoading[campaign.id])
      const deliveredCount = deliveries.filter((delivery) => delivery.deliveredAt || ['DELIVERED', 'READ', 'RESPONDED', 'BOOKED'].includes(delivery.status)).length
      const readCount = deliveries.filter((delivery) => delivery.readAt || ['READ', 'RESPONDED', 'BOOKED'].includes(delivery.status)).length
      const responseCount = deliveries.filter((delivery) => delivery.respondedAt || delivery.status === 'RESPONDED').length
      const bookingCount = deliveries.filter((delivery) => delivery.bookedAt || delivery.status === 'BOOKED').length
      const conversionRate = deliveries.length ? Math.round((bookingCount / deliveries.length) * 100) : 0
      const audienceTotal = audience?.loading ? '...' : audience?.error ? '--' : String(audience?.total ?? 0)
      const exclusionLabels = {
        missingPhone: 'tel&eacute;fono inv&aacute;lido',
        withFutureAppointment: 'con pr&oacute;ximo turno',
        marketingNotAuthorized: 'sin autorizaci&oacute;n de marketing',
        higherPriorityCampaign: 'otra campa&ntilde;a prioritaria',
        promotionCooldown: 'descanso desde otra promoci&oacute;n',
        retryWindow: 'espera entre intentos',
        attemptLimit: 'l&iacute;mite de intentos',
        replied: 'ya respondieron',
        booked: 'ya reservaron'
      }
      const audienceExclusions = audience?.excluded
        ? Object.entries(audience.excluded).filter((entry) => Number(entry[1]) > 0)
        : []
      const audienceExcludedTotal = audienceExclusions.reduce((total, entry) => total + Number(entry[1]), 0)
      const audienceExclusionCopy = audienceExclusions.map((entry) => entry[1] + ' por ' + (exclusionLabels[entry[0]] || entry[0])).join(' &middot; ')
      const simulationExclusions = simulation?.exclusionSummary
        ? Object.entries(simulation.exclusionSummary).filter((entry) => Number(entry[1]) > 0)
        : []
      const simulationExclusionCopy = simulationExclusions.length
        ? simulationExclusions.map((entry) => entry[1] + ' por ' + (exclusionLabels[entry[0]] || entry[0])).join(' &middot; ')
        : 'Sin exclusiones en esta simulaci&oacute;n.'
      const simulationCard = simulation
        ? '<section class="campaign-budget-card"><h4>&Uacute;ltima simulaci&oacute;n</h4><div class="campaign-budget-list">' +
            '<div class="campaign-budget-item"><span>Candidatos del segmento</span><strong>' + simulation.candidateCount + '</strong></div>' +
            '<div class="campaign-budget-item"><span>Listos para la cola</span><strong>' + simulation.eligibleCount + '</strong></div>' +
            '<div class="campaign-budget-item"><span>Excluidos</span><strong>' + simulation.excludedCount + '</strong></div>' +
            '<div class="campaign-budget-item"><span>Generada</span><strong>' + escapeHtml(formatDateTime(simulation.createdAt)) + '</strong></div>' +
          '</div><div class="campaign-rule-note">' + simulationExclusionCopy + '</div></section>'
        : '<section class="campaign-budget-card"><h4>Simulador local</h4><p class="hint">Todav&iacute;a no se ejecut&oacute; una simulaci&oacute;n. No se enviar&aacute; ning&uacute;n mensaje.</p></section>'
      const budget = campaign.budgetLimit === null || campaign.budgetLimit === undefined
        ? 'Sin l&iacute;mite definido'
        : formatCurrency(campaign.budgetLimit)
      const rule = campaign.type === 'AUTOMATED'
        ? 'Se evaluar&aacute; autom&aacute;ticamente. Prioridad ' + (campaignPriorityLabels[campaign.priority] || 'Media').toLowerCase() +
          ', hasta ' + (campaign.maxAttempts || 2) + ' contactos cada ' + (campaign.retryIntervalDays || 30) +
          ' d&iacute;as' + ((campaign.respectCooldown ?? true) ? ' y ' + (campaign.cooldownDays ?? 30) + ' d&iacute;as desde otra promoci&oacute;n.' : ', sin descanso desde otras promociones.')
        : (campaign.respectCooldown ?? true)
          ? 'Campa&ntilde;a puntual. Excluir&aacute; clientes que recibieron promociones durante los &uacute;ltimos ' + (campaign.cooldownDays ?? 30) + ' d&iacute;as.'
          : 'Campa&ntilde;a puntual sin descanso entre promociones. Las bajas de marketing se aplicar&aacute;n obligatoriamente al conectar los env&iacute;os.'
      const mediaPreview = campaign.imageUrl
        ? '<img class="campaign-message-media" src="' + escapeHtml(campaign.imageUrl) + '" alt="Imagen de la campa&ntilde;a">'
        : ''
      const templateCopy = campaign.templateName
        ? '<div class="campaign-rule-note">Plantilla Meta: <strong>' + escapeHtml(campaign.templateName) + '</strong> &middot; Idioma ' + escapeHtml(campaign.templateLanguage || 'es_AR') +
          ' &middot; Estado: <strong>' + escapeHtml(campaignTemplateStatusLabels[campaign.templateStatus || 'NOT_CREATED'] || campaign.templateStatus || 'Sin crear') + '</strong>' +
          (campaign.templateRejectionReason ? '<br>Motivo del rechazo: ' + escapeHtml(campaign.templateRejectionReason) : '') + '</div>'
        : '<div class="campaign-rule-note">Sin plantilla Meta asociada todav&iacute;a. Para env&iacute;os fuera de la ventana de 24 hs se usar&aacute;n plantillas aprobadas.</div>'
      const recipientRows = audience?.loading
        ? '<div class="customer-list-empty">Calculando destinatarios...</div>'
        : audience?.error
          ? '<div class="customer-list-empty">No pudimos cargar los destinatarios.</div>'
          : audience?.included?.length
            ? audience.included.map((customer) => {
                return '<div class="campaign-recipient-row">' +
                  '<div class="campaign-recipient-avatar">' + escapeHtml(contactInitials(customer.name, customer.phone)) + '</div>' +
                  '<div class="campaign-recipient-copy"><strong>' + escapeHtml(customer.name) + '</strong><span>' + escapeHtml(formatCustomerPhone(customer.phone)) + '</span></div>' +
                  '<span class="campaign-recipient-status">Incluido</span>' +
                '</div>'
              }).join('')
            : '<div class="customer-list-empty">No hay clientes disponibles para esta campa&ntilde;a.</div>'
      const simulatedQueueRows = simulation?.jobs?.length
        ? simulation.jobs.map((job, index) => {
            return '<div class="campaign-recipient-row">' +
              '<div class="campaign-recipient-avatar">' + (index + 1) + '</div>' +
              '<div class="campaign-recipient-copy"><strong>' + escapeHtml(job.customer?.name || 'Cliente') + '</strong><span>' + escapeHtml(formatCustomerPhone(job.customer?.phone || '')) + ' &middot; Intento ' + job.attemptNumber + '</span></div>' +
              '<span class="campaign-recipient-status">Lista</span>' +
            '</div>'
          }).join('')
        : '<div class="customer-list-empty">Ejecut&aacute; la simulaci&oacute;n para generar la cola.</div>'
      const recipientView = '<div class="campaign-recipient-view" data-campaign-panel="recipients"' + (state.campaignDetailTab === 'recipients' ? '' : ' hidden') + '>' +
        '<div class="campaign-recipient-head"><div><h4>Destinatarios estimados</h4><p>Se recalculan seg&uacute;n reservas, descansos y preferencias de marketing.</p></div><strong>' + audienceTotal + '</strong></div>' +
        '<div class="campaign-recipient-list">' + recipientRows + '</div>' +
        (audienceExclusionCopy ? '<div class="campaign-rule-note">Excluidos:&nbsp; ' + audienceExclusionCopy + '.</div>' : '') +
        '<div class="campaign-recipient-head"><div><h4>Orden de la cola simulada</h4><p>' + (simulation?.eligibleCount > 100 ? 'Se muestran los primeros 100 de ' + simulation.eligibleCount + ' destinatarios.' : 'Vista previa sin env&iacute;os reales.') + '</p></div><strong>' + (simulation?.eligibleCount ?? 0) + '</strong></div>' +
        '<div class="campaign-recipient-list">' + simulatedQueueRows + '</div>' +
      '</div>'
      const deliveryStatusLabels = { SENT: 'Enviado', DELIVERED: 'Entregado', READ: 'Le&iacute;do', RESPONDED: 'Respondi&oacute;', BOOKED: 'Reserv&oacute;', FAILED: 'Fallido', CANCELLED: 'Cancelado' }
      const historyRows = deliveries.length
        ? deliveries.map((delivery) => {
            return '<div class="campaign-recipient-row">' +
              '<div class="campaign-recipient-avatar">' + escapeHtml(contactInitials(delivery.customer?.name, delivery.customer?.phone)) + '</div>' +
              '<div class="campaign-recipient-copy"><strong>' + escapeHtml(delivery.customer?.name || 'Cliente') + '</strong><span>' + escapeHtml(formatDateTime(delivery.sentAt)) + ' &middot; Intento ' + delivery.attemptNumber + '</span></div>' +
              '<span class="campaign-recipient-status">' + (deliveryStatusLabels[delivery.status] || escapeHtml(delivery.status)) + '</span>' +
            '</div>'
          }).join('')
        : '<div class="customer-list-empty">Todav&iacute;a no hay env&iacute;os registrados.</div>'
      const historyView = '<div class="campaign-recipient-view" data-campaign-panel="history"' + (state.campaignDetailTab === 'history' ? '' : ' hidden') + '>' +
        '<div class="campaign-recipient-head"><div><h4>Historial de la campa&ntilde;a</h4><p>Env&iacute;os y resultados registrados por cliente.</p></div><strong>' + deliveries.length + '</strong></div>' +
        '<div class="campaign-recipient-list">' + historyRows + '</div></div>'
      const configurationView = '<div class="campaign-recipient-view" data-campaign-panel="configuration"' + (state.campaignDetailTab === 'configuration' ? '' : ' hidden') + '>' +
        '<div class="campaign-recipient-head"><div><h4>Configuraci&oacute;n</h4><p>Reglas utilizadas para decidir qui&eacute;n puede recibir la campa&ntilde;a.</p></div></div>' +
        '<div class="campaign-detail-lower"><section class="campaign-budget-card"><div class="campaign-budget-list">' +
          '<div class="campaign-budget-item"><span>Tipo</span><strong>' + campaignTypeLabels[campaign.type] + '</strong></div>' +
          '<div class="campaign-budget-item"><span>Segmento</span><strong>' + campaignConfiguredSegmentLabel(campaign) + '</strong></div>' +
          '<div class="campaign-budget-item"><span>Canal</span><strong>' + campaignChannelLabels[campaign.channel] + '</strong></div>' +
          '<div class="campaign-budget-item"><span>Estado</span><strong>' + campaignStatusLabels[campaign.status] + '</strong></div>' +
          '<div class="campaign-budget-item"><span>Plantilla Meta</span><strong>' + escapeHtml(campaign.templateName || 'Sin asociar') + '</strong></div>' +
          '<div class="campaign-budget-item"><span>Idioma plantilla</span><strong>' + escapeHtml(campaign.templateLanguage || 'es_AR') + '</strong></div>' +
          '<div class="campaign-budget-item"><span>Estado plantilla</span><strong>' + escapeHtml(campaignTemplateStatusLabels[campaign.templateStatus || 'NOT_CREATED'] || campaign.templateStatus || 'Sin crear') + '</strong></div>' +
        '</div></section><section class="campaign-budget-card"><div class="campaign-budget-list">' +
          (campaign.type === 'AUTOMATED'
            ? '<div class="campaign-budget-item"><span>Prioridad</span><strong>' + (campaignPriorityLabels[campaign.priority] || 'Media') + '</strong></div>' +
              '<div class="campaign-budget-item"><span>M&aacute;ximo de contactos</span><strong>' + (campaign.maxAttempts || 2) + '</strong></div>' +
              '<div class="campaign-budget-item"><span>Entre contactos</span><strong>' + (campaign.retryIntervalDays || 30) + ' d&iacute;as</strong></div>'
            : '<div class="campaign-budget-item"><span>Respeta descanso</span><strong>' + ((campaign.respectCooldown ?? true) ? 'S&iacute;' : 'No') + '</strong></div>') +
          '<div class="campaign-budget-item"><span>Desde otra promoci&oacute;n</span><strong>' + ((campaign.respectCooldown ?? true) ? (campaign.cooldownDays ?? 30) + ' d&iacute;as' : 'Desactivado') + '</strong></div>' +
          '<div class="campaign-budget-item"><span>Presupuesto</span><strong>' + budget + '</strong></div>' +
        '</div></section></div><div class="campaign-rule-note">&#9432;&nbsp; ' + rule + '</div></div>'

      els.campaignDetailPanel.innerHTML =
        '<header class="campaign-detail-header">' +
          '<div class="campaign-detail-heading">' +
            '<div class="campaign-detail-icon">' + campaignChannelSymbol(campaign.channel) + '</div>' +
            '<div><h3>' + escapeHtml(campaign.name) + '</h3><div class="campaign-detail-badges">' +
              '<span class="campaign-badge ' + campaignBadgeClass('type', campaign.type) + '">' + campaignTypeLabels[campaign.type] + '</span>' +
              '<span class="campaign-badge ' + campaignBadgeClass('channel', campaign.channel) + '">' + campaignChannelLabels[campaign.channel] + '</span>' +
              '<span class="campaign-badge ' + campaignBadgeClass('status', campaign.status) + '">' + campaignStatusLabels[campaign.status] + '</span>' +
            '</div></div>' +
          '</div>' +
          '<div class="campaign-detail-actions">' +
            '<button class="campaign-outline-button" type="button" data-campaign-action="simulate"' + (simulationLoading ? ' disabled' : '') + '>' + (simulationLoading ? 'Simulando...' : 'Simular') + '</button>' +
            (campaign.type === 'AUTOMATED' && campaign.status === 'ACTIVE' ? '<button class="campaign-outline-button" type="button" data-campaign-action="process-automated">Procesar ahora</button>' : '') +
            (campaign.templateName ? '<button class="campaign-outline-button" type="button" data-campaign-action="template-sync">Actualizar plantilla</button>' : '') +
            '<button class="campaign-outline-button" type="button" data-campaign-action="edit">Editar</button>' +
            (campaign.status !== 'FINISHED' ? '<button class="campaign-outline-button" type="button" data-campaign-action="toggle">' + toggleLabel + '</button>' : '') +
            '<button class="campaign-duplicate-button" type="button" data-campaign-action="duplicate">Duplicar</button>' +
            '<button class="campaign-more-button" type="button" data-campaign-action="delete" title="Eliminar campa&ntilde;a" aria-label="Eliminar campa&ntilde;a">&times;</button>' +
          '</div>' +
        '</header>' +
        '<section class="campaign-detail-stats">' +
          '<div class="campaign-detail-stat"><strong>' + audienceTotal + '</strong><span>destinatarios estimados</span></div>' +
          '<div class="campaign-detail-stat"><strong>' + responseCount + '</strong><span>respuestas</span></div>' +
          '<div class="campaign-detail-stat"><strong>' + bookingCount + '</strong><span>turnos</span></div>' +
        '</section>' +
        '<nav class="campaign-detail-tabs" aria-label="Detalle de campa&ntilde;a">' +
          '<button class="' + (state.campaignDetailTab === 'summary' ? 'active' : '') + '" type="button" data-campaign-tab="summary">Resumen</button>' +
          '<button class="' + (state.campaignDetailTab === 'recipients' ? 'active' : '') + '" type="button" data-campaign-tab="recipients">Destinatarios</button>' +
          '<button class="' + (state.campaignDetailTab === 'history' ? 'active' : '') + '" type="button" data-campaign-tab="history">Historial</button>' +
          '<button class="' + (state.campaignDetailTab === 'configuration' ? 'active' : '') + '" type="button" data-campaign-tab="configuration">Configuraci&oacute;n</button>' +
        '</nav>' +
        '<div data-campaign-panel="summary"' + (state.campaignDetailTab === 'summary' ? '' : ' hidden') + '>' +
        '<p class="campaign-message-label">Vista previa del mensaje</p>' +
        templateCopy +
        '<div class="campaign-message-preview"><div class="campaign-message-icon">' + campaignChannelSymbol(campaign.channel) + '</div><div class="campaign-message-bubble">' + mediaPreview + escapeHtml(campaign.message) + '<time>Sin enviar</time></div></div>' +
        '<div class="campaign-detail-lower">' +
          '<section class="campaign-result-card"><h4>Resultados</h4><div class="campaign-result-list">' +
            '<div class="campaign-result-item"><span>Destinatarios estimados</span><strong>' + audienceTotal + '</strong></div>' +
            '<div class="campaign-result-item"><span>Excluidos por reglas</span><strong>' + audienceExcludedTotal + '</strong></div>' +
            '<div class="campaign-result-item"><span>Enviados</span><strong>' + deliveries.length + '</strong></div>' +
            '<div class="campaign-result-item"><span>Entregados</span><strong>' + deliveredCount + '</strong></div>' +
            '<div class="campaign-result-item"><span>Le&iacute;dos</span><strong>' + readCount + '</strong></div>' +
            '<div class="campaign-result-item"><span>Respuestas</span><strong>' + responseCount + '</strong></div>' +
            '<div class="campaign-result-item"><span>Turnos agendados</span><strong>' + bookingCount + '</strong></div>' +
            '<div class="campaign-result-item"><span>Conversi&oacute;n</span><strong>' + conversionRate + '%</strong></div>' +
          '</div></section>' +
          '<section class="campaign-budget-card"><h4>Configuraci&oacute;n</h4><div class="campaign-budget-list">' +
            '<div class="campaign-budget-item"><span>Segmento</span><strong>' + campaignConfiguredSegmentLabel(campaign) + '</strong></div>' +
            (campaign.type === 'AUTOMATED' ?
              '<div class="campaign-budget-item"><span>Prioridad</span><strong>' + (campaignPriorityLabels[campaign.priority] || 'Media') + '</strong></div>' +
              '<div class="campaign-budget-item"><span>M&aacute;ximo de contactos</span><strong>' + (campaign.maxAttempts || 2) + '</strong></div>' : '') +
            '<div class="campaign-budget-item"><span>Presupuesto</span><strong>' + budget + '</strong></div>' +
            '<div class="campaign-budget-item"><span>Pr&oacute;ximo env&iacute;o</span><strong>' + campaignNextSend(campaign) + '</strong></div>' +
          '</div></section>' +
        '</div>' +
        '<div class="campaign-detail-lower">' + simulationCard +
          '<section class="campaign-budget-card"><h4>Cola simulada</h4><div class="campaign-budget-list">' +
            '<div class="campaign-budget-item"><span>Estado</span><strong>' + (simulation ? 'Lista' : 'Sin generar') + '</strong></div>' +
            '<div class="campaign-budget-item"><span>Mensajes reales</span><strong>0</strong></div>' +
            '<div class="campaign-budget-item"><span>Reintentos por error</span><strong>' + (simulation?.jobs?.[0]?.maxRetries ?? 3) + '</strong></div>' +
          '</div></section></div>' +
        '<div class="campaign-rule-note">&#9432;&nbsp; ' + rule + '</div>' +
        (audienceExclusionCopy ? '<div class="campaign-rule-note">Exclusiones actuales:&nbsp; ' + audienceExclusionCopy + '.</div>' : '') +
        '</div>' + recipientView + historyView + configurationView
    }

    function setCampaignImage(imageUrl) {
      state.campaignImageUrl = imageUrl || null
      els.campaignImagePreviewImg.src = imageUrl || ''
      els.campaignImagePreview.hidden = !imageUrl
      if (!imageUrl) els.campaignImage.value = ''
    }

    function readCampaignImage(event) {
      const file = event.target.files?.[0]
      if (!file) return
      const allowedTypes = ['image/png', 'image/jpeg', 'image/webp']
      if (!allowedTypes.includes(file.type)) {
        els.campaignFormFeedback.textContent = 'Eleg&iacute; una imagen PNG, JPG o WEBP.'
        els.campaignImage.value = ''
        return
      }
      if (file.size > 2 * 1024 * 1024) {
        els.campaignFormFeedback.textContent = 'La imagen no puede superar los 2 MB.'
        els.campaignImage.value = ''
        return
      }

      els.campaignFormFeedback.textContent = ''
      const reader = new FileReader()
      reader.addEventListener('load', () => setCampaignImage(String(reader.result || '')))
      reader.readAsDataURL(file)
    }

    function insertCampaignEmoji(emoji) {
      const input = els.campaignMessage
      const start = input.selectionStart ?? input.value.length
      const end = input.selectionEnd ?? start
      input.value = input.value.slice(0, start) + emoji + input.value.slice(end)
      const nextPosition = start + emoji.length
      input.focus()
      input.setSelectionRange(nextPosition, nextPosition)
      const recent = campaignRecentEmojis().filter((item) => item !== emoji)
      recent.unshift(emoji)
      try {
        localStorage.setItem('salon-ai-campaign-emojis', JSON.stringify(recent.slice(0, 40)))
      } catch {}
      if (state.campaignEmojiCategory === 'recent') renderCampaignEmojiPicker()
    }

    function campaignRecentEmojis() {
      try {
        const saved = JSON.parse(localStorage.getItem('salon-ai-campaign-emojis') || '[]')
        return Array.isArray(saved) && saved.length ? saved.slice(0, 40) : defaultCampaignEmojis
      } catch {
        return defaultCampaignEmojis
      }
    }

    function renderCampaignEmojiPicker() {
      const query = els.campaignEmojiSearch.value.trim().toLocaleLowerCase('es')
      let emojis = []
      if (query) {
        for (const category of Object.values(campaignEmojiCatalog)) {
          if (category.label.includes(query)) emojis.push(...category.emojis)
        }
        if (!emojis.length) {
          emojis = Object.values(campaignEmojiCatalog).flatMap((category) => category.emojis).filter((emoji) => emoji.includes(query))
        }
      } else if (state.campaignEmojiCategory === 'recent') {
        emojis = campaignRecentEmojis()
      } else {
        emojis = campaignEmojiCatalog[state.campaignEmojiCategory]?.emojis || []
      }

      els.campaignEmojiGrid.innerHTML = emojis.length
        ? [...new Set(emojis)].map((emoji) => '<button type="button" data-campaign-emoji="' + emoji + '" title="Agregar ' + emoji + '">' + emoji + '</button>').join('')
        : '<div class="campaign-emoji-empty">No encontramos emojis en esa categor&iacute;a.</div>'

      for (const button of els.campaignEmojiCategories.querySelectorAll('[data-emoji-category]')) {
        button.classList.toggle('active', !query && button.dataset.emojiCategory === state.campaignEmojiCategory)
      }
    }

    function openCampaignDialog(campaign = null) {
      els.campaignId.value = campaign?.id || ''
      els.campaignName.value = campaign?.name || ''
      els.campaignType.value = campaign?.type || 'ONE_TIME'
      els.campaignChannel.value = campaign?.channel || 'WHATSAPP'
      if (campaign?.segment && !Array.from(els.campaignSegment.options).some((option) => option.value === campaign.segment)) {
        els.campaignSegment.add(new Option(campaign.segmentLabel || campaign.segment, campaign.segment))
      }
      els.campaignSegment.value = campaign?.segment || 'ALL'
      state.campaignManualSelected = new Map((campaign?.manualRecipients || []).map((recipient) => {
        const customer = recipient.customer || state.customers.find((item) => item.id === recipient.customerId) || { id: recipient.customerId, name: 'Cliente', phone: '' }
        return [recipient.customerId, customer]
      }))
      state.campaignManualItems = []
      state.campaignManualPage = 1
      state.campaignManualTotalPages = 1
      els.campaignManualSearch.value = ''
      renderCampaignManualCustomers()
      els.campaignSegmentDays.value = campaign?.segmentDays ?? 45
      els.campaignPriority.value = String(campaign?.priority ?? 2)
      els.campaignMaxAttempts.value = campaign?.maxAttempts ?? 2
      els.campaignRetryDays.value = campaign?.retryIntervalDays ?? 30
      els.campaignCooldownDays.value = campaign?.cooldownDays ?? 30
      els.campaignAutomationRespectCooldown.checked = campaign?.respectCooldown ?? true
      els.campaignPunctualRespectCooldown.checked = campaign?.respectCooldown ?? true
      els.campaignPunctualCooldownDays.value = campaign?.cooldownDays ?? 30
      els.campaignStopOnBooking.checked = campaign?.stopOnBooking ?? true
      els.campaignStopOnReply.checked = campaign?.stopOnReply ?? true
      els.campaignRestartAfterVisit.checked = campaign?.restartAfterVisit ?? true
      els.campaignScheduleMode.value = campaign?.scheduleMode || (campaign?.scheduledAt ? 'SCHEDULED' : 'IMMEDIATE')
      els.campaignScheduledAt.value = campaign?.scheduledAt ? toDatetimeLocalValue(new Date(campaign.scheduledAt)) : ''
      els.campaignBudget.value = campaign?.budgetLimit ? formatMoneyInput(campaign.budgetLimit) : ''
      updateCampaignBudgetPreview()
      els.campaignStatus.value = campaign?.status || 'DRAFT'
      els.campaignTemplateName.value = campaign?.templateName || ''
      els.campaignTemplateLanguage.value = campaign?.templateLanguage || 'es_AR'
      renderCampaignTemplateOptions(campaign?.whatsappTemplateId || '')
      state.campaignTemplateMeta = {
        name: campaign?.templateName || null,
        id: campaign?.templateId || null,
        status: campaign?.templateStatus || 'NOT_CREATED',
        rejectionReason: campaign?.templateRejectionReason || null,
        lastSyncedAt: campaign?.templateLastSyncedAt || null
      }
      els.campaignMessage.value = campaign?.message || ''
      syncCampaignTemplateSelection()
      setCampaignImage(campaign?.imageUrl || null)
      els.campaignEmojiPicker.hidden = true
      els.campaignEmojiSearch.value = ''
      renderCampaignEmojiPicker()
      syncCampaignAutomationFields(false)
      els.campaignDialogTitle.textContent = campaign ? 'Editar campaña' : 'Nueva campaña'
      els.campaignSubmit.textContent = campaign ? 'Guardar cambios' : 'Guardar campaña'
      els.campaignFormFeedback.textContent = ''
      showCampaignTemplateFeedback('', '')
      els.campaignDialog.hidden = false
      if (els.campaignSegment.value === 'MANUAL') loadCampaignManualCustomers(true)
      els.campaignName.focus()
    }

    function closeCampaignDialog() {
      els.campaignDialog.hidden = true
      els.campaignForm.reset()
      els.campaignId.value = ''
      setCampaignImage(null)
      els.campaignEmojiPicker.hidden = true
      state.campaignManualSelected = new Map()
      state.campaignManualItems = []
      els.campaignFormFeedback.textContent = ''
    }

    async function saveCampaign(event) {
      event.preventDefault()
      if (!state.businessId) {
        els.campaignFormFeedback.textContent = 'No encontr&eacute; un comercio configurado.'
        return
      }

      const id = els.campaignId.value
      const selectedSegment = els.campaignSegment.options[els.campaignSegment.selectedIndex]
      const segmentDays = campaignSegmentNeedsDays(els.campaignSegment.value)
        ? els.campaignSegmentDays.value
        : null
      const segmentBaseLabel = selectedSegment?.textContent || campaignSegmentLabels[els.campaignSegment.value]
      const selectedWhatsappTemplate = state.whatsappTemplates.find((item) => item.id === els.campaignWhatsappTemplate.value)
      const payload = {
        businessId: state.businessId,
        name: els.campaignName.value.trim(),
        type: els.campaignType.value,
        channel: els.campaignChannel.value,
        segment: els.campaignSegment.value,
        segmentLabel: segmentBaseLabel,
        manualCustomerIds: Array.from(state.campaignManualSelected.keys()),
        segmentDays,
        priority: els.campaignPriority.value,
        maxAttempts: els.campaignMaxAttempts.value,
        retryIntervalDays: els.campaignRetryDays.value,
        cooldownDays: els.campaignType.value === 'AUTOMATED'
          ? els.campaignCooldownDays.value
          : els.campaignPunctualCooldownDays.value,
        respectCooldown: els.campaignType.value === 'AUTOMATED'
          ? els.campaignAutomationRespectCooldown.checked
          : els.campaignPunctualRespectCooldown.checked,
        stopOnBooking: true,
        stopOnReply: true,
        restartAfterVisit: true,
        scheduleMode: els.campaignScheduleMode.value,
        scheduledAt: els.campaignScheduleMode.value === 'SCHEDULED' ? (els.campaignScheduledAt.value || null) : null,
        budgetLimit: normalizeMoneyInput(els.campaignBudget.value) || null,
        status: els.campaignStatus.value,
        whatsappTemplateId: selectedWhatsappTemplate?.id || null,
        templateName: selectedWhatsappTemplate?.metaName || null,
        templateLanguage: selectedWhatsappTemplate?.language || 'es_AR',
        templateId: selectedWhatsappTemplate?.metaId || null,
        templateStatus: selectedWhatsappTemplate?.status || 'NOT_CREATED',
        templateRejectionReason: selectedWhatsappTemplate?.rejectionReason || null,
        templateLastSyncedAt: selectedWhatsappTemplate?.lastSyncedAt || null,
        message: els.campaignMessage.value.trim(),
        imageUrl: selectedWhatsappTemplate?.imageUrl || null
      }

      if (!payload.name || !payload.message) {
        els.campaignFormFeedback.textContent = 'Completá el nombre y seleccioná una plantilla aprobada.'
        return
      }
      if (!payload.whatsappTemplateId) {
        els.campaignFormFeedback.textContent = 'Seleccioná una plantilla aprobada para crear la campaña.'
        return
      }
      if (payload.templateName && !/^[a-z0-9_]{1,512}$/.test(payload.templateName)) {
        els.campaignFormFeedback.textContent = 'La plantilla debe coincidir con Meta: minusculas, numeros y guiones bajos.'
        return
      }
      if (payload.segment === 'MANUAL' && !payload.manualCustomerIds.length) {
        els.campaignFormFeedback.textContent = 'Seleccion&aacute; al menos un destinatario.'
        return
      }
      if (payload.scheduleMode === 'SCHEDULED' && !payload.scheduledAt) {
        els.campaignFormFeedback.textContent = 'Seleccion&aacute; la fecha y hora.'
        return
      }

      els.campaignSubmit.disabled = true
      try {
        const saved = await getJson(id ? '/campaigns/' + id : '/campaigns', {
          method: id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        state.selectedCampaignId = saved.id
        closeCampaignDialog()
        await loadCampaigns()
      } catch (error) {
        els.campaignFormFeedback.textContent = error.message
      } finally {
        els.campaignSubmit.disabled = false
      }
    }

    async function updateCampaignStatus(campaign) {
      if (campaign.status !== 'ACTIVE') {
        openCampaignActivationDialog(campaign)
        return
      }
      const status = 'PAUSED'
      await getJson('/campaigns/' + campaign.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...campaign, status })
      })
      await loadCampaigns()
    }

    function campaignPricingCategory(campaign) {
      return campaign.templateCategory === 'UTILITY' ? 'UTILITY' : 'MARKETING'
    }

    function campaignEstimatedCost(campaign, quantity) {
      const country = state.whatsappPricing?.defaultCountry || 'AR'
      const category = campaignPricingCategory(campaign)
      const rate = (state.whatsappPricing?.rates || []).find((item) => item.country === country && item.category === category)
      if (!rate) return null
      return {
        ...rate,
        quantity,
        total: Number(rate.estimatedUnitPrice || 0) * Number(quantity || 0)
      }
    }

    function formatEstimatedCurrency(value, currency) {
      return new Intl.NumberFormat('es-AR', { style: 'currency', currency: currency || 'ARS', maximumFractionDigits: 2 }).format(Number(value || 0))
    }

    function campaignEstimatedCostHtml(campaign, quantity) {
      const estimate = campaignEstimatedCost(campaign, quantity)
      if (!estimate) return '<div class="campaign-activation-card campaign-activation-cost"><span>Costo estimado</span><strong>No disponible</strong></div>'
      return '<div class="campaign-activation-card campaign-activation-cost"><span>Costo estimado</span><strong>' + escapeHtml(formatEstimatedCurrency(estimate.total, estimate.currency)) + '</strong><small>' + quantity + ' × ' + escapeHtml(formatEstimatedCurrency(estimate.estimatedUnitPrice, estimate.currency)) + ' · ' + escapeHtml(estimate.countryLabel) + ' · ' + escapeHtml(estimate.category) + '</small></div>'
    }

    function campaignActivationSummaryHtml(campaign) {
      const audience = state.campaignAudiences[campaign.id]
      const variables = extractTemplateVariables(campaign.message || '')
      const excludedEntries = audience?.excluded
        ? Object.entries(audience.excluded).filter((entry) => Number(entry[1]) > 0)
        : []
      const exclusionLabels = {
        missingPhone: 'teléfono inválido',
        withFutureAppointment: 'con próximo turno',
        marketingNotAuthorized: 'sin autorización de marketing',
        higherPriorityCampaign: 'otra campaña prioritaria',
        promotionCooldown: 'descanso desde otra promoción',
        retryWindow: 'espera entre intentos',
        attemptLimit: 'límite de contactos',
        replied: 'ya respondieron',
        booked: 'ya reservaron'
      }
      const excludedCopy = excludedEntries.length
        ? excludedEntries.map((entry) => entry[1] + ' ' + (exclusionLabels[entry[0]] || entry[0])).join(' · ')
        : 'Sin exclusiones detectadas.'
      const included = audience?.included || []
      const includedPreview = included.slice(0, 3).map((customer) => escapeHtml(customer.name || customer.phone || 'Cliente')).join(', ')
      const messagePreview = campaignActivationMessagePreview(campaign, included[0])
      const realSendNote = campaign.type === 'ONE_TIME'
        ? 'Al confirmar se enviará WhatsApp real una sola vez y la campaña quedará Finalizada.'
        : 'Las automáticas quedan habilitadas para reglas; los envíos reales masivos siguen bloqueados.'
      if (audience?.loading) return '<strong>Calculando destinatarios...</strong><p>Estamos preparando el resumen de seguridad.</p>'
      if (audience?.error) return '<strong>No se pudo calcular destinatarios.</strong><p>' + escapeHtml(audience.error) + '</p>'
      return '<div class="campaign-activation-summary">' +
        '<div class="campaign-activation-grid">' +
          '<div class="campaign-activation-card"><span>Tipo</span><strong>' + escapeHtml(campaignTypeLabels[campaign.type] || campaign.type) + '</strong></div>' +
          '<div class="campaign-activation-card"><span>Plantilla</span><strong>' + escapeHtml(campaign.templateName || 'Sin plantilla') + '</strong><small>' + escapeHtml(campaignTemplateStatusLabels[campaign.templateStatus || 'NOT_CREATED'] || campaign.templateStatus || 'Sin estado') + '</small></div>' +
          '<div class="campaign-activation-card"><span>Destinatarios</span><strong>' + (audience?.total ?? 0) + '</strong><small>' + escapeHtml(includedPreview ? includedPreview + (included.length > 3 ? '...' : '') : 'Sin destinatarios incluidos') + '</small></div>' +
          campaignEstimatedCostHtml(campaign, audience?.total ?? 0) +
        '</div>' +
        '<div class="campaign-activation-card"><span>Exclusiones</span><strong>' + escapeHtml(excludedCopy) + '</strong></div>' +
        '<div class="campaign-activation-card"><span>Variables</span><strong>' + (variables.length ? variables.map((variable) => '{{' + escapeHtml(variable) + '}}').join(', ') : 'sin variables') + '</strong></div>' +
        (messagePreview ? '<div class="campaign-activation-preview"><strong>Vista previa</strong><div class="campaign-activation-bubble">' + escapeHtml(messagePreview) + '</div></div>' : '') +
        '<div class="campaign-activation-note">' + escapeHtml(realSendNote) + '</div>' +
        '</div>'
    }

    function campaignActivationMessagePreview(campaign, customer) {
      if (!customer || !campaign.message) return ''
      return campaign.message.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, variable) => {
        if (variable === 'nombre_cliente') return customer.name || ''
        if (variable === 'usuario') return customer.name || ''
        if (variable === 'fecha_ultima_visita') return customer.lastVisitAt ? formatShortDate(customer.lastVisitAt) : '{{' + variable + '}}'
        return '{{' + variable + '}}'
      })
    }

    function renderCampaignActivationDialog() {
      const campaign = state.campaigns.find((item) => item.id === state.pendingCampaignActivationId)
      if (!campaign) return closeCampaignActivationDialog()
      const audience = state.campaignAudiences[campaign.id]
      els.campaignActivationName.textContent = campaign.name
      els.campaignActivationCopy.textContent = campaign.type === 'ONE_TIME'
        ? 'Revisá destinatarios, plantilla y costo antes de enviar esta campaña puntual.'
        : 'Revisá reglas, segmento y plantilla antes de activar la campaña automática.'
      els.campaignActivationConfirm.textContent = campaign.type === 'ONE_TIME'
        ? (campaign.scheduleMode === 'SCHEDULED' ? 'Programar campaña' : 'Enviar y finalizar')
        : 'Confirmar activación'
      els.campaignActivationSummary.innerHTML = campaignActivationSummaryHtml(campaign)
      els.campaignActivationConfirm.disabled = Boolean(audience?.loading || audience?.error)
      els.campaignActivationFeedback.textContent = ''
    }

    function openCampaignActivationDialog(campaign) {
      state.pendingCampaignActivationId = campaign.id
      els.campaignActivationFeedback.textContent = ''
      els.campaignActivationConfirm.disabled = false
      els.campaignActivationConfirm.textContent = campaign.type === 'ONE_TIME'
        ? (campaign.scheduleMode === 'SCHEDULED' ? 'Programar campaña' : 'Enviar y finalizar')
        : 'Confirmar activación'
      if (!state.whatsappPricingLoaded) loadWhatsappPricing().then(() => {
        if (!els.campaignActivationDialog.hidden && state.pendingCampaignActivationId === campaign.id) renderCampaignActivationDialog()
      })
      const shouldLoadAudience = !state.campaignAudiences[campaign.id] || state.campaignAudiences[campaign.id]?.error
      if (shouldLoadAudience) state.campaignAudiences[campaign.id] = { loading: true }
      els.campaignActivationDialog.hidden = false
      renderCampaignActivationDialog()
      requestAnimationFrame(() => els.campaignActivationCancel.focus())
      if (shouldLoadAudience) {
        loadCampaignAudience(campaign.id).then(() => {
          if (!els.campaignActivationDialog.hidden && state.pendingCampaignActivationId === campaign.id) renderCampaignActivationDialog()
        }).catch(() => {
          if (!els.campaignActivationDialog.hidden && state.pendingCampaignActivationId === campaign.id) renderCampaignActivationDialog()
        })
      }
    }

    function closeCampaignActivationDialog() {
      els.campaignActivationDialog.hidden = true
      state.pendingCampaignActivationId = null
      els.campaignActivationFeedback.textContent = ''
      els.campaignActivationConfirm.disabled = false
      els.campaignActivationConfirm.textContent = 'Confirmar activación'
    }

    async function confirmCampaignActivation() {
      const campaign = state.campaigns.find((item) => item.id === state.pendingCampaignActivationId)
      if (!campaign) return closeCampaignActivationDialog()
      try {
        els.campaignActivationConfirm.disabled = true
        els.campaignActivationConfirm.textContent = campaign.type === 'ONE_TIME'
          ? (campaign.scheduleMode === 'SCHEDULED' ? 'Programando...' : 'Enviando...')
          : 'Activando...'
        if (campaign.type === 'ONE_TIME' && campaign.scheduleMode === 'SCHEDULED') {
          await getJson('/campaigns/' + campaign.id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...campaign, status: 'SCHEDULED' })
          })
        } else if (campaign.type === 'ONE_TIME') {
          const result = await getJson('/campaigns/' + campaign.id + '/execute-one-time', { method: 'POST' })
          els.campaignActivationFeedback.textContent = 'Enviados: ' + result.sent + ' · Fallidos: ' + result.failed + '. Campaña finalizada.'
        } else {
          await getJson('/campaigns/' + campaign.id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...campaign, status: 'ACTIVE' })
          })
          if (campaign.scheduleMode !== 'SCHEDULED') {
            const result = await getJson('/campaigns/' + campaign.id + '/process-automated', { method: 'POST' })
            els.campaignActivationFeedback.textContent = 'Enviados: ' + result.sent + ' · Fallidos: ' + result.failed + '. Campaña automática activa.'
          }
        }
        closeCampaignActivationDialog()
        await loadCampaigns()
      } catch (error) {
        els.campaignActivationFeedback.textContent = error.message
        els.campaignActivationConfirm.disabled = false
        els.campaignActivationConfirm.textContent = campaign.type === 'ONE_TIME'
          ? (campaign.scheduleMode === 'SCHEDULED' ? 'Programar campaña' : 'Enviar y finalizar')
          : 'Confirmar activación'
      }
    }

    async function duplicateCampaign(campaign) {
      const duplicate = await getJson('/campaigns/' + campaign.id + '/duplicate', { method: 'POST' })
      state.selectedCampaignId = duplicate.id
      state.campaignFilter = 'ALL'
      state.campaignPage = 1
      await loadCampaigns()
    }

    function deleteCampaign(campaign) {
      state.pendingCampaignDeleteId = campaign.id
      els.campaignDeleteName.textContent = campaign.name
      els.campaignDeleteFeedback.textContent = ''
      els.campaignDeleteDialog.hidden = false
      requestAnimationFrame(() => els.campaignDeleteCancel.focus())
    }

    function closeCampaignDeleteDialog() {
      els.campaignDeleteDialog.hidden = true
      state.pendingCampaignDeleteId = null
      els.campaignDeleteFeedback.textContent = ''
      els.campaignDeleteConfirm.disabled = false
      els.campaignDeleteConfirm.textContent = 'Eliminar campaña'
    }

    async function confirmCampaignDelete() {
      const campaign = state.campaigns.find((item) => item.id === state.pendingCampaignDeleteId)
      if (!campaign) return closeCampaignDeleteDialog()
      try {
        els.campaignDeleteConfirm.disabled = true
        els.campaignDeleteConfirm.textContent = 'Eliminando...'
        await getJson('/campaigns/' + campaign.id, { method: 'DELETE' })
        closeCampaignDeleteDialog()
        state.selectedCampaignId = null
        state.campaignDetailTab = 'summary'
        await loadCampaigns()
      } catch (error) {
        els.campaignDeleteFeedback.textContent = error.message
        els.campaignDeleteConfirm.disabled = false
        els.campaignDeleteConfirm.textContent = 'Eliminar campaña'
      }
    }

    function deleteTemplate(template) {
      state.pendingTemplateDeleteId = template.id
      els.templateDeleteName.textContent = template.internalName
      els.templateDeleteFeedback.textContent = ''
      els.templateDeleteConfirm.disabled = false
      els.templateDeleteConfirm.textContent = 'Eliminar plantilla'
      els.templateDeleteDialog.hidden = false
      requestAnimationFrame(() => els.templateDeleteCancel.focus())
    }

    function closeTemplateDeleteDialog() {
      els.templateDeleteDialog.hidden = true
      state.pendingTemplateDeleteId = null
      els.templateDeleteFeedback.textContent = ''
      els.templateDeleteConfirm.disabled = false
      els.templateDeleteConfirm.textContent = 'Eliminar plantilla'
    }

    async function confirmTemplateDelete() {
      const template = state.whatsappTemplates.find((item) => item.id === state.pendingTemplateDeleteId)
      if (!template) return closeTemplateDeleteDialog()
      try {
        els.templateDeleteConfirm.disabled = true
        els.templateDeleteConfirm.textContent = 'Eliminando...'
        await getJson('/whatsapp-templates/' + template.id, { method: 'DELETE' })
        closeTemplateDeleteDialog()
        state.selectedTemplateId = null
        await loadWhatsappTemplates()
      } catch (error) {
        els.templateDeleteFeedback.textContent = error.message
        els.templateDeleteConfirm.disabled = false
        els.templateDeleteConfirm.textContent = 'Eliminar plantilla'
      }
    }

    async function simulateCampaign(campaign) {
      state.campaignSimulationLoading[campaign.id] = true
      renderCampaignDetail()
      try {
        const run = await getJson('/campaigns/' + campaign.id + '/simulate', { method: 'POST' })
        state.campaignSimulations[campaign.id] = run
        await loadCampaignAudience(campaign.id)
      } finally {
        state.campaignSimulationLoading[campaign.id] = false
        if (state.selectedCampaignId === campaign.id) renderCampaignDetail()
      }
    }

    async function syncCampaignTemplate(campaign) {
      const updated = await getJson('/campaigns/' + campaign.id + '/template/sync', { method: 'POST' })
      const index = state.campaigns.findIndex((item) => item.id === updated.id)
      if (index >= 0) state.campaigns[index] = updated
      renderCampaigns()
    }

    async function handleCampaignDetailAction(event) {
      const tab = event.target.closest('[data-campaign-tab]')
      if (tab) {
        state.campaignDetailTab = tab.dataset.campaignTab
        renderCampaignDetail()
        return
      }
      const button = event.target.closest('[data-campaign-action]')
      if (!button) return
      const campaign = state.campaigns.find((item) => item.id === state.selectedCampaignId)
      if (!campaign) return

      try {
        if (button.dataset.campaignAction === 'simulate') await simulateCampaign(campaign)
        if (button.dataset.campaignAction === 'process-automated') {
          button.disabled = true
          button.textContent = 'Procesando...'
          const result = await getJson('/campaigns/' + campaign.id + '/process-automated', { method: 'POST' })
          await loadCampaignDeliveries(campaign.id)
          await loadCampaignSimulation(campaign.id)
          await loadCampaigns()
          els.campaignDetailPanel.querySelector('.campaign-detail-header')?.insertAdjacentHTML('afterend', '<div class="campaign-rule-note" data-campaign-inline-error>Procesado: ' + result.sent + ' enviados · ' + result.failed + ' fallidos.</div>')
          return
        }
        if (button.dataset.campaignAction === 'template-sync') await syncCampaignTemplate(campaign)
        if (button.dataset.campaignAction === 'edit') openCampaignDialog(campaign)
        if (button.dataset.campaignAction === 'toggle') await updateCampaignStatus(campaign)
        if (button.dataset.campaignAction === 'duplicate') await duplicateCampaign(campaign)
        if (button.dataset.campaignAction === 'delete') deleteCampaign(campaign)
      } catch (error) {
        const existing = els.campaignDetailPanel.querySelector('[data-campaign-inline-error]')
        if (existing) existing.remove()
        els.campaignDetailPanel.querySelector('.campaign-detail-header')?.insertAdjacentHTML('afterend', '<div class="campaign-rule-note" data-campaign-inline-error>' + escapeHtml(error.message) + '</div>')
      }
    }

    function setSection(section) {
      els.appShell.dataset.section = section
      const buttons = document.querySelectorAll('.workspace-nav button[data-nav-section]')
      buttons.forEach((button) => {
        const isSection = button.dataset.navSection === section
        const isMarketingSubitem = section === 'campaigns' && button.closest('.nav-subitems') && button.dataset.marketingNav !== state.marketingView
        button.classList.toggle('active', isSection && !isMarketingSubitem)
      })

      if (section === 'agenda') {
        loadAgenda().catch((error) => {
          els.agendaGridWrap.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>'
        })
      }

      if (section === 'customers') {
        loadCustomerOverview().catch(() => {})
      }

      if (section === 'reports') {
        loadReports().catch((error) => {
          els.reportStatusBars.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>'
        })
      }

      if (section === 'campaigns' && !state.campaignsLoaded) {
        loadCampaigns()
      }
      if (section === 'campaigns') setMarketingView(state.marketingView)
      if (section === 'campaigns' && !state.templatesLoaded) loadWhatsappTemplates()
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

    function isDateInRange(date, start, end) {
      const value = startOfDay(date).getTime()
      return value >= startOfDay(start).getTime() && value < startOfDay(end).getTime()
    }

    function dateKey(date) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return year + '-' + month + '-' + day
    }

    function toDatetimeLocalValue(value) {
      const date = value instanceof Date ? value : new Date(value)
      if (Number.isNaN(date.getTime())) return ''
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
      return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0')
    }

    function formatTimeOnly(date) {
      return new Intl.DateTimeFormat('es-AR', {
        hour: '2-digit',
        minute: '2-digit'
      }).format(date)
    }

    function formatAgendaRange(start, end) {
      const monthFormatter = new Intl.DateTimeFormat('es-AR', { month: 'long' })
      const startMonth = monthFormatter.format(start)
      const endMonth = monthFormatter.format(end)
      if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
        return start.getDate() + ' al ' + end.getDate() + ' de ' + endMonth + ' de ' + end.getFullYear()
      }

      if (start.getFullYear() === end.getFullYear()) {
        return start.getDate() + ' de ' + startMonth + ' al ' + end.getDate() + ' de ' + endMonth + ' de ' + end.getFullYear()
      }

      return start.getDate() + ' de ' + startMonth + ' de ' + start.getFullYear() + ' al ' + end.getDate() + ' de ' + endMonth + ' de ' + end.getFullYear()
    }

    function formatAgendaDayHeader(date) {
      const weekday = ['Dom', 'Lun', 'Mar', 'Mi&eacute;', 'Jue', 'Vie', 'S&aacute;b'][date.getDay()]
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
      const priceValue = els.servicePrice.value.trim()
      const price = priceValue ? Number(priceValue) : null
      const category = els.serviceCategory.value.trim()
      const aliases = els.serviceAliases.value
        .split(',')
        .map((alias) => alias.trim())
        .filter(Boolean)

      if (!name || !Number.isFinite(duration) || duration <= 0) {
        els.serviceFeedback.textContent = 'Completa nombre y duracion.'
        return
      }

      if (price !== null && (!Number.isFinite(price) || price < 0)) {
        els.serviceFeedback.textContent = 'El precio debe ser mayor o igual a 0.'
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
            price,
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
      els.servicePrice.value = hasServicePrice(service) ? service.price : ''
      els.serviceCategory.value = service.category || ''
      els.serviceAliases.value = (service.aliases || []).map((alias) => alias.name).join(', ')
      els.serviceCancel.hidden = false
      els.serviceFeedback.textContent = 'Editando servicio.'
      els.serviceFormTitle.textContent = 'Editar servicio'
      document.getElementById('service-submit').textContent = 'Guardar cambios'
      setSection('services')
    }

    async function deleteService(id) {
      const service = state.services.find((item) => item.id === id)
      if (!service || !requestCrmConfirmation('delete-service:' + id, 'Eliminar servicio ' + service.name + '?')) return

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
      els.servicePrice.value = ''
      els.serviceCategory.value = ''
      els.serviceAliases.value = ''
      els.serviceCancel.hidden = false
      els.serviceFeedback.textContent = ''
      els.serviceFormTitle.textContent = 'Nuevo servicio'
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

    function customerForPhone(phone) {
      const normalized = normalizePhone(phone)
      return state.customers.find((customer) => normalizePhone(customer.phone) === normalized) || null
    }

    function conversationDisplayName(conversation) {
      return customerForPhone(conversation.phone)?.name || conversation.phone || 'Cliente'
    }

    function contactInitials(name, phone) {
      const words = String(name || '').trim().split(/\s+/).filter(Boolean)
      if (words.length && name !== phone) {
        return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase()
      }
      return initials(phone)
    }

    function isPendingHandoff(conversation) {
      return conversation.currentStep === 'HUMAN_HANDOFF' && !conversation.humanHandoffResolvedAt
    }

    function isConversationUnread(conversation) {
      return conversation.messages?.[0]?.direction === 'INBOUND' && !state.readConversationIds.has(conversation.id)
    }

    function filteredConversations() {
      const query = els.search.value.trim().toLowerCase()
      return state.conversations.filter((conversation) => {
        if (state.conversationFilter === 'unread' && !isConversationUnread(conversation)) return false
        if (state.conversationFilter === 'handoff' && !isPendingHandoff(conversation)) return false
        if (!query) return true

        const name = conversationDisplayName(conversation).toLowerCase()
        const phone = String(conversation.phone || '').toLowerCase()
        const message = String(conversation.messages?.[0]?.body || '').toLowerCase()
        return name.includes(query) || phone.includes(query) || message.includes(query)
      })
    }

    function formatConversationTime(value) {
      const date = new Date(value)
      const today = new Date()
      if (date.toDateString() === today.toDateString()) {
        return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(date)
      }
      return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit' }).format(date)
    }

    function formatMessageTime(date) {
      return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(date)
    }

    function formatMessageDay(date) {
      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(today.getDate() - 1)
      if (date.toDateString() === today.toDateString()) return 'Hoy'
      if (date.toDateString() === yesterday.toDateString()) return 'Ayer'
      return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long' }).format(date)
    }

    function conversationStepLabel(step, aiEnabled) {
      if (aiEnabled === false && step !== 'HUMAN_HANDOFF') return 'Atencion manual'
      const labels = {
        START: 'Inicio',
        ASK_SERVICE: 'Eligiendo servicio',
        ASK_PROFESSIONAL: 'Eligiendo profesional',
        ASK_DATE: 'Preguntando fecha',
        ASK_TIME: 'Preguntando horario',
        ASK_CUSTOMER_NAME: 'Solicitando nombre',
        CONFIRM: 'Confirmando turno',
        COMPLETED: 'Completado',
        CANCEL_SELECT_APPOINTMENT: 'Cancelando turno',
        EDIT_SELECT_APPOINTMENT: 'Cambiando turno',
        HUMAN_HANDOFF: 'Requiere atencion'
      }
      return labels[step] || 'En conversacion'
    }

    function conversationStepChipClass(step, aiEnabled) {
      if (aiEnabled === false || step === 'HUMAN_HANDOFF') return 'chip step-handoff'
      if (step === 'COMPLETED') return 'chip step-completed'
      if (step === 'CONFIRM') return 'chip step-confirm'
      if (step === 'CANCEL_SELECT_APPOINTMENT' || step === 'EDIT_SELECT_APPOINTMENT') return 'chip step-change'
      if (step === 'START') return 'chip step-start'
      return 'chip step-progress'
    }

    function isMobile() {
      return window.matchMedia('(max-width: 760px)').matches
    }

    function setProfessionalViewMode(mode) {
      state.professionalViewMode = mode
      els.professionalsView.classList.toggle('list-mode', mode === 'list')
      els.professionalCardView.classList.toggle('active', mode === 'cards')
      els.professionalListView.classList.toggle('active', mode === 'list')
    }

    function updateProfessionalStatusFilter() {
      state.professionalStatusFilter = els.professionalStatusFilter.value || 'all'
      renderProfessionals()
    }

    function setMobileView(view) {
      document.body.dataset.mobileView = view
      els.mobileInbox.classList.toggle('active', view === 'inbox')
      els.mobileChat.classList.toggle('active', view === 'chat')
      els.mobileDetails.classList.toggle('active', view === 'details')
    }

    hydrateWorkspaceNav()
    document.querySelectorAll('.workspace-nav button[data-nav-section]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.marketingNav) setMarketingView(button.dataset.marketingNav)
        setSection(button.dataset.navSection)
      })
    })

    els.replyForm.addEventListener('submit', sendReply)
    els.replyText.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
      event.preventDefault()
      if (!els.replyText.value.trim() || els.sendButton.disabled) return
      els.replyForm.requestSubmit()
    })
    els.blockForm.addEventListener('submit', createBlock)
    els.professionalForm.addEventListener('submit', saveProfessional)
    els.professionalCancel.addEventListener('click', closeProfessionalPanel)
    els.professionalPanelClose?.addEventListener('click', closeProfessionalPanel)
    els.professionalNewButton?.addEventListener('click', openNewProfessionalForm)
    els.professionalSearch?.addEventListener('input', renderProfessionals)
    els.professionalCardView?.addEventListener('click', () => setProfessionalViewMode('cards'))
    els.professionalListView?.addEventListener('click', () => setProfessionalViewMode('list'))
    els.professionalStatusFilter?.addEventListener('change', updateProfessionalStatusFilter)
    els.professionalAvatar?.addEventListener('change', readProfessionalAvatar)
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
    els.serviceSearch?.addEventListener('input', renderServices)
    els.campaignNew.addEventListener('click', () => state.marketingView === 'templates' ? openTemplateDialog() : state.marketingView === 'reminders' ? resetReminderDraft() : openCampaignDialog())
    els.marketingMainTabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-marketing-view]')
      if (button) setMarketingView(button.dataset.marketingView)
    })
    els.templateTableBody.addEventListener('click', (event) => {
      const row = event.target.closest('[data-template-id]')
      if (!row) return
      state.selectedTemplateId = row.dataset.templateId
      renderWhatsappTemplates()
    })
    els.templateFilterTabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-template-filter]')
      if (!button) return
      state.templateFilter = button.dataset.templateFilter
      for (const item of els.templateFilterTabs.querySelectorAll('[data-template-filter]')) item.classList.toggle('active', item === button)
      renderWhatsappTemplates()
    })
    els.templateSyncAll.addEventListener('click', syncAllWhatsappTemplates)
    els.reminderList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-reminder-id]')
      if (!button) return
      state.selectedReminderId = button.dataset.reminderId
      state.pendingReminderDeleteConfirm = false
      els.reminderFeedback.textContent = ''
      els.reminderFeedback.className = 'campaign-form-feedback'
      renderReminderSettings()
    })
    els.reminderName.addEventListener('input', updateReminderDraftFromForm)
    els.reminderChannel.addEventListener('change', updateReminderDraftFromForm)
    els.reminderTemplate.addEventListener('change', updateReminderDraftFromForm)
    els.reminderBefore.addEventListener('change', updateReminderDraftFromForm)
    els.reminderEnabled.addEventListener('change', updateReminderDraftFromForm)
    els.reminderSave.addEventListener('click', saveReminderSettings)
    els.reminderDelete.addEventListener('click', deleteSelectedReminder)
    els.reminderProcess.addEventListener('click', processDueReminders)
    els.templateDetailPanel.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-template-action]')
      if (!button) return
      const template = state.whatsappTemplates.find((item) => item.id === state.selectedTemplateId)
      if (!template) return
      if (button.dataset.templateAction === 'delete') {
        deleteTemplate(template)
        return
      }
      try {
        if (button.dataset.templateAction === 'edit') openTemplateDialog(template)
        if (button.dataset.templateAction === 'submit') await getJson('/whatsapp-templates/' + template.id + '/submit', { method: 'POST' })
        if (button.dataset.templateAction === 'sync') await getJson('/whatsapp-templates/' + template.id + '/sync', { method: 'POST' })
        if (button.dataset.templateAction === 'diagnose') {
          button.disabled = true
          button.textContent = 'Diagnosticando...'
          try {
            const diagnosis = await getJson('/whatsapp-templates/' + template.id + '/meta-diagnosis')
            els.templateDetailPanel.querySelector('[data-template-diagnosis]')?.remove()
            els.templateDetailPanel.querySelector('.template-detail-actions')?.insertAdjacentHTML('beforebegin', renderTemplateMetaDiagnosis(diagnosis))
          } finally {
            button.disabled = false
            button.textContent = 'Diagnosticar en Meta'
          }
          return
        }
        if (button.dataset.templateAction === 'test-send') {
          const phone = els.templateDetailPanel.querySelector('[data-template-test-phone]')
          const confirmed = els.templateDetailPanel.querySelector('[data-template-test-confirm]')
          const feedback = els.templateDetailPanel.querySelector('[data-template-test-feedback]')
          feedback.textContent = 'Enviando una prueba...'
          feedback.className = 'template-test-feedback'
          button.disabled = true
          try {
            await getJson('/whatsapp-templates/' + template.id + '/test-send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.value, confirmed: confirmed.checked }) })
            feedback.textContent = 'Prueba enviada. Revisá WhatsApp en ese número.'
            feedback.className = 'template-test-feedback success'
          } catch (error) {
            feedback.textContent = error.message
            feedback.className = 'template-test-feedback error'
          } finally {
            button.disabled = false
          }
          return
        }
        if (button.dataset.templateAction !== 'edit') await loadWhatsappTemplates()
      } catch (error) {
        els.templateDetailPanel.insertAdjacentHTML('afterbegin', '<div class="template-rejection">' + escapeHtml(error.message) + '</div>')
      }
    })
    els.templateForm.addEventListener('submit', (event) => { event.preventDefault(); saveTemplate(false) })
    els.templateSaveSubmit.addEventListener('click', () => saveTemplate(true))
    els.templateBody.addEventListener('input', () => { renderTemplateVariables(); updateTemplateBuilderPreview() })
    els.templateEmojiToggle.addEventListener('click', () => {
      els.templateEmojiPicker.hidden = !els.templateEmojiPicker.hidden
    })
    els.templateEmojiPicker.addEventListener('emoji-click', (event) => {
      if (event.detail?.unicode) insertTemplateEmoji(event.detail.unicode)
    })
    els.templateImage.addEventListener('change', readTemplateImage)
    els.templateImageRemove.addEventListener('click', () => setTemplateImage(null))
    els.templateMetaName.addEventListener('input', updateTemplateBuilderPreview)
    els.templateCategoryMarketing.addEventListener('change', () => setTemplateCategory('MARKETING'))
    els.templateCategoryUtility.addEventListener('change', () => setTemplateCategory('UTILITY'))
    els.templateVariablePanel.addEventListener('input', (event) => {
      const input = event.target.closest('[data-template-example]')
      if (!input) return
      state.templateDraftExamples[input.dataset.templateExample] = input.value
      updateTemplateBuilderPreview()
    })
    els.templateDialogClose.addEventListener('click', closeTemplateDialog)
    els.templateDialogCancel.addEventListener('click', closeTemplateDialog)
    els.templateDialog.addEventListener('click', (event) => { if (event.target === els.templateDialog) closeTemplateDialog() })
    els.campaignForm.addEventListener('submit', saveCampaign)
    els.campaignTemplateCreate.addEventListener('click', createCampaignTemplateInMeta)
    els.campaignTemplateSync.addEventListener('click', syncCampaignTemplateInMeta)
    els.campaignTemplateName.addEventListener('input', () => {
      const name = els.campaignTemplateName.value.trim()
      if (state.campaignTemplateMeta.name && state.campaignTemplateMeta.name !== name) {
        state.campaignTemplateMeta = { name, id: null, status: 'NOT_CREATED', rejectionReason: null, lastSyncedAt: null }
      }
      renderCampaignTemplateState()
      showCampaignTemplateFeedback('', '')
    })
    els.campaignWhatsappTemplate.addEventListener('change', () => {
      syncCampaignTemplateSelection()
    })
    els.campaignType.addEventListener('change', () => syncCampaignAutomationFields(false))
    els.campaignSegment.addEventListener('change', () => {
      syncCampaignAutomationFields(true)
      if (els.campaignSegment.value === 'MANUAL') loadCampaignManualCustomers(true)
    })
    els.campaignScheduleMode.addEventListener('change', () => syncCampaignAutomationFields(false))
    els.campaignBudget.addEventListener('input', updateCampaignBudgetPreview)
    els.campaignBudget.addEventListener('blur', updateCampaignBudgetPreview)
    els.campaignManualList.addEventListener('change', (event) => {
      const checkbox = event.target.closest('input[type="checkbox"]')
      if (!checkbox) return
      const customer = state.campaignManualItems.find((item) => item.id === checkbox.value)
      if (checkbox.checked && customer) state.campaignManualSelected.set(customer.id, customer)
      if (!checkbox.checked) state.campaignManualSelected.delete(checkbox.value)
      els.campaignManualCount.textContent = state.campaignManualSelected.size + (state.campaignManualSelected.size === 1 ? ' seleccionado' : ' seleccionados')
    })
    els.campaignManualSearch.addEventListener('input', () => {
      clearTimeout(state.campaignManualSearchTimer)
      state.campaignManualSearchTimer = setTimeout(() => loadCampaignManualCustomers(true), 250)
    })
    els.campaignManualMore.addEventListener('click', () => {
      if (state.campaignManualPage >= state.campaignManualTotalPages) return
      state.campaignManualPage += 1
      loadCampaignManualCustomers(false)
    })
    els.campaignPunctualRespectCooldown.addEventListener('change', () => syncCampaignAutomationFields(false))
    els.campaignAutomationRespectCooldown.addEventListener('change', () => syncCampaignAutomationFields(false))
    els.campaignDialogClose.addEventListener('click', closeCampaignDialog)
    els.campaignDialogCancel.addEventListener('click', closeCampaignDialog)
    els.campaignEmojiToggle.addEventListener('click', () => {
      els.campaignEmojiPicker.hidden = !els.campaignEmojiPicker.hidden
      if (!els.campaignEmojiPicker.hidden) renderCampaignEmojiPicker()
    })
    els.campaignEmojiSearch.addEventListener('input', renderCampaignEmojiPicker)
    els.campaignEmojiCategories.addEventListener('click', (event) => {
      const button = event.target.closest('[data-emoji-category]')
      if (!button) return
      state.campaignEmojiCategory = button.dataset.emojiCategory
      els.campaignEmojiSearch.value = ''
      renderCampaignEmojiPicker()
    })
    els.campaignEmojiPicker.addEventListener('click', (event) => {
      const button = event.target.closest('[data-campaign-emoji]')
      if (!button) return
      insertCampaignEmoji(button.dataset.campaignEmoji)
    })
    els.campaignImage.addEventListener('change', readCampaignImage)
    els.campaignImageRemove.addEventListener('click', () => setCampaignImage(null))
    els.campaignDialog.addEventListener('click', (event) => {
      if (event.target === els.campaignDialog) closeCampaignDialog()
    })
    els.campaignDeleteClose.addEventListener('click', closeCampaignDeleteDialog)
    els.campaignDeleteCancel.addEventListener('click', closeCampaignDeleteDialog)
    els.campaignDeleteConfirm.addEventListener('click', confirmCampaignDelete)
    els.campaignDeleteDialog.addEventListener('click', (event) => {
      if (event.target === els.campaignDeleteDialog) closeCampaignDeleteDialog()
    })
    els.campaignActivationClose.addEventListener('click', closeCampaignActivationDialog)
    els.campaignActivationCancel.addEventListener('click', closeCampaignActivationDialog)
    els.campaignActivationConfirm.addEventListener('click', confirmCampaignActivation)
    els.campaignActivationDialog.addEventListener('click', (event) => {
      if (event.target === els.campaignActivationDialog) closeCampaignActivationDialog()
    })
    els.templateDeleteClose.addEventListener('click', closeTemplateDeleteDialog)
    els.templateDeleteCancel.addEventListener('click', closeTemplateDeleteDialog)
    els.templateDeleteConfirm.addEventListener('click', confirmTemplateDelete)
    els.templateDeleteDialog.addEventListener('click', (event) => {
      if (event.target === els.templateDeleteDialog) closeTemplateDeleteDialog()
    })
    els.campaignSearch.addEventListener('input', () => {
      if (state.marketingView === 'templates') {
        state.templateSearch = els.campaignSearch.value.trim()
        renderWhatsappTemplates()
      } else if (state.marketingView === 'reminders') {
        state.campaignSearch = els.campaignSearch.value.trim()
        renderReminderSettings()
      } else {
        state.campaignSearch = els.campaignSearch.value.trim()
        state.campaignPage = 1
        renderCampaigns()
      }
    })
    els.campaignFilterTabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-campaign-filter]')
      if (!button) return
      state.campaignFilter = button.dataset.campaignFilter
      state.campaignPage = 1
      for (const filterButton of els.campaignFilterTabs.querySelectorAll('[data-campaign-filter]')) {
        filterButton.classList.toggle('active', filterButton === button)
      }
      renderCampaigns()
    })
    els.campaignTableBody.addEventListener('click', (event) => {
      const row = event.target.closest('[data-campaign-id]')
      if (!row) return
      state.selectedCampaignId = row.dataset.campaignId
      renderCampaigns()
      loadCampaignAudience(state.selectedCampaignId)
    })
    els.campaignDetailPanel.addEventListener('click', handleCampaignDetailAction)
    els.campaignPagePrev.addEventListener('click', () => {
      state.campaignPage = Math.max(1, state.campaignPage - 1)
      renderCampaigns()
    })
    els.campaignPageNext.addEventListener('click', () => {
      state.campaignPage += 1
      renderCampaigns()
    })
    els.businessSettingsForm.addEventListener('submit', saveBusinessSettings)
    els.businessLogo.addEventListener('change', readBusinessLogo)
    els.businessLogoRemove.addEventListener('click', () => {
      clearBusinessSettingsFeedback()
      setBusinessLogo(null)
    })
    els.whatsappTechnicalForm.addEventListener('submit', saveWhatsappTechnicalSettings)
    els.whatsappConnectButton.addEventListener('click', openWhatsappSignupPlaceholder)
    els.realWhatsappToggle.addEventListener('change', () => {
      saveWhatsappSettingsPatch({
        realWhatsappEnabled: els.realWhatsappToggle.checked,
        campaignSendingLocked: !els.realWhatsappToggle.checked,
        reminderSendingLocked: !els.realWhatsappToggle.checked
      }, els.realWhatsappToggle.checked ? 'Envio real habilitado.' : 'Envio real bloqueado.')
    })
    els.campaignSendingToggle.addEventListener('change', () => {
      saveWhatsappSettingsPatch({
        campaignsEnabled: els.campaignSendingToggle.checked,
        campaignSendingLocked: !els.campaignSendingToggle.checked
      }, els.campaignSendingToggle.checked ? 'Campanas habilitadas.' : 'Campanas bloqueadas.')
    })
    els.reminderSendingToggle.addEventListener('change', () => {
      saveWhatsappSettingsPatch({
        remindersEnabled: els.reminderSendingToggle.checked,
        reminderSendingLocked: !els.reminderSendingToggle.checked
      }, els.reminderSendingToggle.checked ? 'Recordatorios habilitados.' : 'Recordatorios bloqueados.')
    })
    els.billingOwnerToggle.addEventListener('change', () => {
      saveWhatsappSettingsPatch({
        billingOwner: els.billingOwnerToggle.checked ? 'CLIENT' : 'SALON_AI',
        campaignSendingLocked: !els.billingOwnerToggle.checked
      }, els.billingOwnerToggle.checked ? 'Facturacion a cargo del cliente.' : 'Campanas masivas bloqueadas para facturacion Salon AI.')
    })
    els.globalBotToggle.addEventListener('change', toggleGlobalBot)
    els.globalAiToggle.addEventListener('change', toggleGlobalAi)
    els.conversationAiToggle.addEventListener('click', toggleConversationAi)
    els.resolveHandoff.addEventListener('click', resolveHandoff)
    els.refresh.addEventListener('click', loadConversations)
    els.searchButton.addEventListener('click', renderConversations)
    els.search.addEventListener('input', renderConversations)
    els.search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') renderConversations()
    })
    els.conversationTabs.addEventListener('click', async (event) => {
      const tab = event.target.closest('[data-conversation-filter]')
      if (!tab) return
      state.conversationFilter = tab.dataset.conversationFilter
      const archiveView = state.conversationFilter === 'archived' ? 'archived' : 'active'
      if (archiveView !== state.loadedArchiveView) {
        state.selected = null
        state.conversationNextCursor = null
        await loadConversations()
      } else {
        renderConversations()
      }
    })
    els.conversationMore.addEventListener('click', () => loadConversations({ append: true }))
    els.archiveConversation.addEventListener('click', toggleArchiveConversation)
    els.viewAgenda.addEventListener('click', () => setSection('agenda'))
    els.quickSchedule.addEventListener('click', () => {
      const customer = state.selected ? customerForPhone(state.selected.phone) : null
      openAppointmentDialog()
      if (customer) {
        els.appointmentCustomer.value = customer.id
        syncAppointmentCustomerFields()
      } else if (state.selected) {
        els.appointmentCustomerPhone.value = state.selected.phone
      }
    })
    els.quickChange.addEventListener('click', () => {
      if (state.appointments[0]) {
        openAppointmentDialog({ appointment: state.appointments[0] })
      } else {
        els.quickSchedule.click()
      }
    })
    els.quickReminder.addEventListener('click', () => {
      if (!state.selected) return
      const appointment = state.appointments[0]
      els.replyText.value = appointment
        ? 'Hola ' + conversationDisplayName(state.selected) + ', te recordamos tu turno de ' + (appointment.service?.name || 'servicio') + ' para ' + formatAppointment(appointment.startAt) + '.'
        : 'Hola ' + conversationDisplayName(state.selected) + ', te escribimos desde ' + (state.business?.name || 'el salon') + '.'
      els.replyText.focus()
    })
    els.quickHistory.addEventListener('click', () => setSection('agenda'))
    els.customerEdit.addEventListener('click', () => openCustomerDialog('edit'))
    els.customerAddNote.addEventListener('click', () => openCustomerDialog('note'))
    els.customerDialogForm.addEventListener('submit', saveCustomerDialog)
    els.customerDialogClose.addEventListener('click', closeCustomerDialog)
    els.customerDialogCancel.addEventListener('click', closeCustomerDialog)
    els.customerDialog.addEventListener('click', (event) => {
      if (event.target === els.customerDialog) closeCustomerDialog()
    })
    els.customerDeleteClose.addEventListener('click', closeCustomerDeleteDialog)
    els.customerDeleteCancel.addEventListener('click', closeCustomerDeleteDialog)
    els.customerDeleteConfirm.addEventListener('click', confirmCustomerDelete)
    els.customerDeleteDialog.addEventListener('click', (event) => {
      if (event.target === els.customerDeleteDialog) closeCustomerDeleteDialog()
    })
    els.marketingConfirmClose.addEventListener('click', closeMarketingConfirmDialog)
    els.marketingConfirmCancel.addEventListener('click', closeMarketingConfirmDialog)
    els.marketingConfirmSubmit.addEventListener('click', saveMarketingPreference)
    els.marketingConfirmDialog.addEventListener('click', (event) => {
      if (event.target === els.marketingConfirmDialog) closeMarketingConfirmDialog()
    })
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !els.customerDialog.hidden) closeCustomerDialog()
      if (event.key === 'Escape' && !els.customerDeleteDialog.hidden) closeCustomerDeleteDialog()
      if (event.key === 'Escape' && !els.marketingConfirmDialog.hidden) closeMarketingConfirmDialog()
      if (event.key === 'Escape' && !els.campaignDialog.hidden) closeCampaignDialog()
      if (event.key === 'Escape' && !els.campaignDeleteDialog.hidden) closeCampaignDeleteDialog()
      if (event.key === 'Escape' && !els.campaignActivationDialog.hidden) closeCampaignActivationDialog()
      if (event.key === 'Escape' && !els.templateDeleteDialog.hidden) closeTemplateDeleteDialog()
    })
    els.mobileInbox.addEventListener('click', () => setMobileView('inbox'))
    els.mobileChat.addEventListener('click', () => setMobileView('chat'))
    els.mobileDetails.addEventListener('click', () => setMobileView('details'))
    els.mobileBack.addEventListener('click', () => setMobileView('inbox'))
    els.customerNewButton.addEventListener('click', () => openCustomerDialog('create'))
    els.customerFilterTabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-customer-filter]')
      if (!button) return
      state.customerFilter = button.dataset.customerFilter
      loadCustomerOverview({ page: 1 })
    })
    els.customerInactiveDays.addEventListener('change', () => {
      state.customerInactiveDays = Number(els.customerInactiveDays.value || 60)
      loadCustomerOverview({ page: 1 })
    })
    els.customersSearch.addEventListener('input', () => {
      state.customerSearch = els.customersSearch.value.trim()
      clearTimeout(state.customerSearchTimer)
      state.customerSearchTimer = setTimeout(() => loadCustomerOverview({ page: 1 }), 250)
    })
    els.customerPagePrev.addEventListener('click', () => {
      loadCustomerOverview({ page: Math.max(1, state.customerOverviewPagination.page - 1) })
    })
    els.customerPageNext.addEventListener('click', () => {
      loadCustomerOverview({ page: Math.min(state.customerOverviewPagination.totalPages, state.customerOverviewPagination.page + 1) })
    })
    els.reportsRange.addEventListener('change', renderReports)
    els.reportsFutureDays.addEventListener('change', renderReports)
    els.reportsInactiveDays.addEventListener('change', renderReports)
    els.reportsRefresh.addEventListener('click', loadReports)
    els.agendaProfessional.addEventListener('change', async () => {
      renderAgendaProfessionalControls()
      await loadAgenda()
    })
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

    hydrateIcons()

    loadBasics()
      .then(loadConversations)
      .catch((error) => {
        els.list.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>'
      })

    setInterval(() => {
      loadConversations({ silent: true })
    }, 5000)
    }
  </script>
</body>
</html>`
