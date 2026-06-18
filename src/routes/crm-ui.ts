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

    .app[data-section="conversations"] .composer textarea {
      min-height: 38px;
      max-height: 100px;
      padding: 7px 3px;
      resize: none;
      font-size: 12px;
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
      gap: 7px;
    }

    .customer-profile-actions .customer-contact-action {
      width: 42px;
      height: 42px;
      border: 1px solid #dce5ee;
      border-radius: 7px;
      display: grid;
      place-items: center;
      background: #fff;
      text-decoration: none;
    }

    .customer-profile-actions .customer-contact-action.whatsapp {
      color: #0d9f5f;
    }

    .customer-profile-actions .customer-contact-action.conversation {
      color: #2563eb;
    }

    .customer-profile-actions .customer-contact-action:disabled {
      color: #9aa5b5;
      background: #f5f6f8;
      cursor: not-allowed;
    }

    .customer-profile-actions .customer-contact-action .ti {
      width: 21px;
      height: 21px;
      stroke-width: 2.1;
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
    }

    .settings-shell {
      width: min(820px, 100%);
      margin: 0 auto;
      padding: 34px 28px;
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

  <main class="app" id="app-shell" data-section="conversations">
    <nav class="workspace-nav" aria-label="Secciones CRM">
      <div class="crm-brand">
        <div class="brand-mark">S</div>
        <div>
          <strong>CRM Salon AI</strong>
          <span>Atencion y reservas</span>
        </div>
      </div>
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

  <script>
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
      conversationFilter: 'all',
      conversationVisibleLimit: 12,
      readConversationIds: new Set(),
      customerDialogMode: 'edit',
      customerDialogCustomerId: null,
      isRefreshing: false
    }

    const els = {
      list: document.getElementById('conversation-list'),
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
      detailAvatar: document.getElementById('detail-avatar'),
      detailName: document.getElementById('detail-name'),
      detailPhone: document.getElementById('detail-phone'),
      detailWhatsapp: document.getElementById('detail-whatsapp'),
      detailStep: document.getElementById('detail-step'),
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
        { label: 'Conversaciones', icon: 'message', active: true },
        { label: 'Agenda', icon: 'calendar' },
        { label: 'Clientes', icon: 'users' },
        { label: 'Profesionales', icon: 'professional' },
        { label: 'Servicios', icon: 'scissors' },
        { label: 'Campa&ntilde;as', icon: 'megaphone' },
        { label: 'Reportes', icon: 'chart' },
        { label: 'Ajustes', icon: 'settings' }
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
          return '<button class="' + (item.active ? 'active' : '') + '" type="button">' +
            '<span data-icon="' + item.icon + '"></span>' +
            '<strong>' + item.label + '</strong>' +
            (item.label === 'Conversaciones' ? '<em class="nav-badge" id="nav-handoff-badge" hidden>0</em>' : '') +
          '</button>'
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

    async function loadBasics() {
      const businesses = await getJson('/businesses')
      state.business = businesses[0] || null
      state.businessId = state.business?.id || null
      state.businessHours = state.businessId
        ? await getJson('/business-hours?businessId=' + encodeURIComponent(state.businessId))
        : []
      state.aiSettings = await getJson('/crm/ai-settings' + (state.businessId ? '?businessId=' + encodeURIComponent(state.businessId) : ''))
      state.professionals = await getJson('/professionals')
      state.services = await getJson('/services')
      state.customers = await getJson('/customers')
      renderBusinessSettings()
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

      els.customerProfilePanel.innerHTML = '<div class="customer-profile-content">' +
        '<header class="customer-profile-head">' +
          '<div class="customer-profile-avatar tone-' + avatarTone + '">' + escapeHtml(contactInitials(customer.name, customer.phone)) + '</div>' +
          '<div><h3>' + escapeHtml(customer.name) + '</h3><a href="tel:' + escapeHtml(customer.phone) + '">' + escapeHtml(formatCustomerPhone(customer.phone)) + '</a></div>' +
          '<div class="customer-profile-actions">' +
            '<a class="customer-whatsapp-action" href="https://wa.me/' + encodeURIComponent(normalizePhone(customer.phone)) + '" target="_blank" rel="noopener" title="Abrir WhatsApp">' + icon('whatsapp') + '</a>' +
            '<button class="primary" type="button" data-schedule-customer>' + icon('calendar') + 'Agendar turno</button>' +
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
        '<section class="customer-profile-section"><h4 class="customer-section-title">' + icon('calendar') + 'Actividad</h4>' + openConversation + '<div class="customer-history">' + history + '</div></section>' +
        '<section class="customer-profile-section"><div class="row"><h4 class="customer-section-title">' + icon('document') + 'Notas</h4><button class="details-link" type="button" data-add-customer-note>+ Agregar nota</button></div><div class="customer-profile-notes">' + notes + '</div></section>' +
      '</div>'

      els.customerProfilePanel.querySelector('[data-schedule-customer]')?.addEventListener('click', () => openOverviewCustomerAppointment(customer))
      els.customerProfilePanel.querySelector('[data-add-customer-note]')?.addEventListener('click', () => openCustomerDialog('note', customer))
      els.customerProfilePanel.querySelector('[data-open-customer-conversation]')?.addEventListener('click', () => openOverviewCustomerConversation(customer))
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
      if (!customer.openConversation) return
      if (!state.conversations.some((conversation) => conversation.id === customer.openConversation.id)) {
        state.conversations.unshift(customer.openConversation)
      }
      setSection('conversations')
      await selectConversation(customer.openConversation.id)
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
        alert('Primero crea el cliente desde un turno para poder guardar informacion.')
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
      els.detailUpdated.textContent = formatDateTime(latestConversationActivityValue(selected))
      els.customerEdit.disabled = !customer
      els.archiveConversation.disabled = canResolveHandoff && !selected.archivedAt
      els.archiveConversation.textContent = selected.archivedAt ? 'Restaurar chat' : 'Archivar chat'
      els.replyText.disabled = false
      els.sendButton.disabled = false

      renderMessages(options.messageScroll || {})
      renderAppointments()
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
          alert('WhatsApp no pudo enviar el mensaje: ' + (result.delivery.errorMessage || result.delivery.reason || 'revisa la configuracion o la ventana de 24 hs.'))
        }
      } catch (error) {
        alert(error.message)
      } finally {
        els.sendButton.disabled = false
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
        alert(error.message)
      }
    }

    async function toggleGlobalBot() {
      const nextValue = els.globalBotToggle.checked
      if (!nextValue && !confirm('Pausar el bot automatico en todo el salon? Ningun chat recibira respuestas automaticas hasta que lo actives nuevamente.')) {
        renderAiControls()
        return
      }

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
        renderAiControls()
        alert(error.message)
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
        alert(error.message)
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
            if (cell.classList.contains('closed')) alert('Ese horario esta fuera del horario de atencion.')
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
        alert(error.message)
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

      if (force && !confirm('Guardar este turno como excepcion? Puede quedar fuera de horario o superpuesto con otro turno.')) {
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

      if (section === 'customers') {
        loadCustomerOverview().catch(() => {})
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
    els.businessSettingsForm.addEventListener('submit', saveBusinessSettings)
    els.businessLogo.addEventListener('change', readBusinessLogo)
    els.businessLogoRemove.addEventListener('click', () => {
      clearBusinessSettingsFeedback()
      setBusinessLogo(null)
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
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !els.customerDialog.hidden) closeCustomerDialog()
    })
    els.mobileInbox.addEventListener('click', () => setMobileView('inbox'))
    els.mobileChat.addEventListener('click', () => setMobileView('chat'))
    els.mobileDetails.addEventListener('click', () => setMobileView('details'))
    els.mobileBack.addEventListener('click', () => setMobileView('inbox'))
    document.querySelectorAll('.workspace-nav button')[0]?.addEventListener('click', () => setSection('conversations'))
    document.querySelectorAll('.workspace-nav button')[1]?.addEventListener('click', () => setSection('agenda'))
    document.querySelectorAll('.workspace-nav button')[2]?.addEventListener('click', () => setSection('customers'))
    document.querySelectorAll('.workspace-nav button')[3]?.addEventListener('click', () => setSection('professionals'))
    document.querySelectorAll('.workspace-nav button')[4]?.addEventListener('click', () => setSection('services'))
    document.querySelectorAll('.workspace-nav button')[6]?.addEventListener('click', () => setSection('reports'))
    document.querySelectorAll('.workspace-nav button')[7]?.addEventListener('click', () => setSection('settings'))
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
  </script>
</body>
</html>`
