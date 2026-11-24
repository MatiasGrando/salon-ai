export const crmDrawerStyles = `
    .crm-drawer-backdrop.cash-dialog-backdrop { position: fixed; inset: 0; z-index: 120; display: flex; justify-content: flex-end; align-items: stretch; padding: 0; background: rgb(15 23 42 / 20%); opacity: 0; transition: opacity 220ms ease; overscroll-behavior: contain; }
    .crm-drawer-backdrop[hidden] { display: none; }
    .crm-drawer-backdrop.is-open { opacity: 1; }
    .crm-drawer { box-sizing: border-box; display: flex; flex-direction: column; width: min(420px, 100%); height: 100vh; height: 100dvh; max-height: 100dvh; min-width: 0; background: var(--surface, #fff); color: var(--text, #0f172a); border-left: 1px solid var(--line, #dbe3ed); box-shadow: -8px 0 24px rgb(15 23 42 / 7%); transform: translateX(100%); transition: transform 220ms ease; outline: none; }
    .crm-drawer-backdrop.is-open .crm-drawer { transform: translateX(0); }
    .crm-drawer-header { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 12px; padding: 22px; border-bottom: 1px solid var(--line, #dbe3ed); }
    .crm-drawer-header h3 { margin: 0; font-size: 18px; line-height: 1.35; }
    .crm-drawer-body { flex: 1; min-height: 0; min-width: 0; padding: 22px; overflow-y: auto; overscroll-behavior: contain; }
    .crm-drawer-footer { flex: none; padding: 16px 22px max(16px, env(safe-area-inset-bottom)); border-top: 1px solid var(--line, #dbe3ed); background: var(--surface, #fff); }
    .crm-drawer-footer > button { width: 100%; min-height: 44px; }
    body:has(.crm-drawer-backdrop:not([hidden])) #confirmation-dialog { z-index: 140; }
    @media (max-width: 560px) { .crm-drawer { width: 100%; border-left: 0; } .crm-drawer-header, .crm-drawer-body { padding: 18px; } .crm-drawer-footer { padding: 14px 18px max(14px, env(safe-area-inset-bottom)); } }
    @media (prefers-reduced-motion: reduce) { .crm-drawer-backdrop, .crm-drawer { transition: none; } }
`

export const crmDrawerScript = `
    function createCrmDrawer({ backdrop, panel, closeButton, beforeClose, onClose, isTopmost = () => true }) {
      let opened = false
      let generation = 0
      let opener = null
      let savedOverflow = null
      let savedScrollbarGutter = null
      let pendingClose = null
      let closeTimer = null
      let settleAnimation = null

      const focusable = () => Array.from(panel.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
        .filter((element) => !element.disabled && !element.hidden && element.getClientRects().length && element.getAttribute('tabindex') !== '-1')
      const focusInitial = () => (focusable()[0] || panel).focus()

      function open(trigger) {
        if (trigger && !panel.contains(trigger)) opener = trigger
        else if (backdrop.hidden) opener = document.activeElement
        const version = ++generation
        pendingClose = null
        if (settleAnimation) {
          clearTimeout(closeTimer)
          const settle = settleAnimation
          settleAnimation = null
          closeTimer = null
          settle()
        }
        if (savedOverflow === null) {
          savedOverflow = document.body.style.overflow
          const root = document.documentElement
          if (window.innerWidth > root.clientWidth && !window.getComputedStyle(root).scrollbarGutter.includes('stable')) {
            savedScrollbarGutter = root.style.scrollbarGutter
            root.style.scrollbarGutter = 'stable'
          }
          document.body.style.overflow = 'hidden'
        }
        opened = true
        backdrop.hidden = false
        panel.inert = false
        if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1')
        panel.setAttribute('aria-hidden', 'false')
        backdrop.getBoundingClientRect()
        focusInitial()
        requestAnimationFrame(() => {
          if (version === generation && opened) backdrop.classList.add('is-open')
        })
      }

      function close(force = false) {
        if (!opened) return pendingClose || Promise.resolve(true)
        if (pendingClose && !force) return pendingClose
        const version = generation
        const focusedAtClose = document.activeElement
        const request = (async () => {
          if (!force && beforeClose) {
            let allowed = false
            try { allowed = await beforeClose() } catch {}
            if (allowed === false) {
              if (version === generation && opened && isTopmost()) {
                if (panel.contains(focusedAtClose) && focusedAtClose.isConnected) focusedAtClose.focus()
                else focusInitial()
              }
              return false
            }
          }
          if (version !== generation || !opened) return false
          opened = false
          const closingVersion = ++generation
          backdrop.classList.remove('is-open')
          panel.setAttribute('aria-hidden', 'true')
          panel.inert = true
          await new Promise((resolve) => {
            settleAnimation = resolve
            const delay = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 0 : 220
            closeTimer = setTimeout(() => {
              closeTimer = null
              settleAnimation = null
              resolve()
            }, delay)
          })
          if (closingVersion !== generation || opened) return false
          backdrop.hidden = true
          panel.inert = false
          document.body.style.overflow = savedOverflow
          savedOverflow = null
          if (savedScrollbarGutter !== null) {
            document.documentElement.style.scrollbarGutter = savedScrollbarGutter
            savedScrollbarGutter = null
          }
          if (opener?.isConnected) opener.focus()
          onClose?.()
          return true
        })()
        pendingClose = request
        const clearPending = () => { if (pendingClose === request) pendingClose = null }
        request.then(clearPending, clearPending)
        return request
      }

      closeButton.addEventListener('click', () => { void close() })
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop && isTopmost()) void close()
      })
      document.addEventListener('keydown', (event) => {
        if (!opened || !isTopmost()) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopImmediatePropagation()
          void close()
        }
        if (event.key !== 'Tab') return
        const controls = focusable()
        const first = controls[0] || panel
        const last = controls[controls.length - 1] || panel
        if (!panel.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        }
      }, true)
      return { open, close, isOpen: () => opened }
    }
`
