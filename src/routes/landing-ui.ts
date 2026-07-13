import type { FastifyInstance, FastifyRequest } from 'fastify'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { siFacebook, siInstagram, siWhatsapp, type SimpleIcon } from 'simple-icons'
import { BusinessService, normalizeBusinessSlug } from '../services/business-service.js'

const businessService = new BusinessService()
const baseDomain = (process.env.PUBLIC_BASE_DOMAIN || 'weex.com.ar').toLowerCase()
const landingAssetNames = new Set(['barber-hero-interior.png', 'barber-hero-service.png'])
const landingAssetsDir = join(process.cwd(), 'src', 'assets', 'landing')

export async function landingUiRoutes(app: FastifyInstance) {
  app.get('/landing-assets/:asset', async (request, reply) => {
    const params = request.params as { asset: string }
    const asset = params.asset
    if (!landingAssetNames.has(asset)) return reply.status(404).send({ message: 'Asset no encontrado' })

    const buffer = await readFile(join(landingAssetsDir, asset))
    return reply.type('image/png').send(buffer)
  })

  app.get('/', async (request, reply) => {
    const slug = resolveSlugFromHost(request)
    if (!slug) return reply.type('text/html').send(renderWeexPlaceholder())

    const business = await businessService.findPublicBySlug(slug)
    if (!business || !business.landingEnabled) return reply.status(404).type('text/html').send(renderNotFound())

    return reply.type('text/html').send(renderLanding(business))
  })

  app.get('/reservar', async (request, reply) => {
    const slug = resolveSlugFromHost(request)
    if (!slug) return reply.status(404).type('text/html').send(renderNotFound())

    const business = await businessService.findPublicBySlug(slug)
    if (!business || !business.landingEnabled) return reply.status(404).type('text/html').send(renderNotFound())

    return reply.type('text/html').send(renderBookingPlaceholder(business, '/'))
  })

  app.get('/cuenta', async (request, reply) => {
    const slug = resolveSlugFromHost(request)
    if (!slug) return reply.status(404).type('text/html').send(renderNotFound())

    const business = await businessService.findPublicBySlug(slug)
    if (!business || !business.landingEnabled) return reply.status(404).type('text/html').send(renderNotFound())

    return reply.type('text/html').send(renderCustomerAccount(business, '/'))
  })

  app.get('/:slug', async (request, reply) => {
    const params = request.params as { slug: string }
    const slug = normalizeBusinessSlug(params.slug)
    const business = await businessService.findPublicBySlug(slug)
    if (!business || !business.landingEnabled) return reply.status(404).type('text/html').send(renderNotFound())

    return reply.type('text/html').send(renderLanding(business, `/${slug}`))
  })

  app.get('/:slug/reservar', async (request, reply) => {
    const params = request.params as { slug: string }
    const slug = normalizeBusinessSlug(params.slug)
    const business = await businessService.findPublicBySlug(slug)
    if (!business || !business.landingEnabled) return reply.status(404).type('text/html').send(renderNotFound())

    return reply.type('text/html').send(renderBookingPlaceholder(business, `/${slug}`))
  })

  app.get('/:slug/cuenta', async (request, reply) => {
    const params = request.params as { slug: string }
    const slug = normalizeBusinessSlug(params.slug)
    const business = await businessService.findPublicBySlug(slug)
    if (!business || !business.landingEnabled) return reply.status(404).type('text/html').send(renderNotFound())

    return reply.type('text/html').send(renderCustomerAccount(business, `/${slug}`))
  })
}

function resolveSlugFromHost(request: FastifyRequest) {
  const rawHost = request.headers['x-forwarded-host'] || request.headers.host
  const host = Array.isArray(rawHost) ? rawHost[0] : rawHost
  const hostname = host?.split(':')[0]?.toLowerCase()
  if (!hostname || hostname === baseDomain || hostname === `www.${baseDomain}`) return null
  if (hostname === 'localhost' || hostname === '127.0.0.1') return null
  if (!hostname.endsWith(`.${baseDomain}`)) return null

  const subdomain = hostname.slice(0, -baseDomain.length - 1).split('.')[0] || ''
  return normalizeBusinessSlug(subdomain)
}

type PublicBusiness = Awaited<ReturnType<BusinessService['findPublicBySlug']>>
type LandingBusiness = NonNullable<PublicBusiness>

function renderLanding(business: LandingBusiness, basePath = '') {
  const description = business.landingDescription || `Reserva tu turno en ${business.name} de forma simple y rapida.`
  const services = business.services.slice(0, 6)
  const professionals = business.professionals.slice(0, 4)
  const visibleServices = services.slice(0, 3)
  const carouselServices = [...visibleServices, ...visibleServices]
  const visibleProfessionals = professionals.slice(0, 3)
  const carouselProfessionals = [...visibleProfessionals, ...visibleProfessionals]
  const serviceCarouselItems = Math.max(visibleServices.length, 1)
  const professionalCarouselItems = Math.max(visibleProfessionals.length, 1)
  const bookingUrl = `${basePath}/reservar`
  const accountUrl = `${basePath}/cuenta`
  const whatsappUrl = business.publicWhatsapp ? `https://wa.me/${business.publicWhatsapp.replace(/\D/g, '')}` : null

  return htmlPage({
    title: `${business.name} | Reservas online`,
    body: `
      <header class="navbar">
        <div class="wrap">
          <a class="brand" href="${escapeAttribute(basePath || '/')}">
            <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
              <circle cx="6" cy="6" r="2.6"></circle><circle cx="6" cy="18" r="2.6"></circle>
              <line x1="8.1" y1="7.6" x2="20" y2="18"></line>
              <line x1="8.1" y1="16.4" x2="20" y2="6"></line>
            </svg>
            <span class="brand-text">
              <span class="name">${escapeHtml(business.name)}</span>
              <span class="tag">Oficio de navaja y tijera</span>
            </span>
          </a>
          <nav class="nav-links" aria-label="Principal">
            <a class="active" href="#">Inicio</a>
            <a href="#servicios">Servicios</a>
            <a href="#profesionales">Profesionales</a>
            <a href="#galeria">Galeria</a>
            <a href="#comentarios">Comentarios</a>
            <a href="#horarios">Horarios</a>
            <a href="#contacto">Contacto</a>
          </nav>
          <div class="nav-actions">
            <a class="btn-account" href="${escapeAttribute(accountUrl)}" aria-label="Mi perfil">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <circle cx="12" cy="8" r="3.2"></circle><path d="M5 20a7 7 0 0 1 14 0"></path>
              </svg>
              <span>Perfil</span>
            </a>
            <a class="btn-gold-outline" href="${escapeAttribute(bookingUrl)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <rect x="3" y="5" width="18" height="16" rx="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line>
                <line x1="8" y1="3" x2="8" y2="7"></line><line x1="16" y1="3" x2="16" y2="7"></line>
              </svg>
              Reservar turno
            </a>
          </div>
        </div>
      </header>

      <main class="landing">
        <section class="hero">
          <div class="hero-content">
            <div class="eyebrow">
              <span class="rule"></span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                <path d="M3 12h13l-3-3m3 3l-3 3"></path><circle cx="20" cy="12" r="1.6"></circle>
              </svg>
              Desde 2018
              <span class="rule"></span>
            </div>
            <h1 class="hero-title">${formatHeroTitle(business.name)}</h1>
            <div class="hero-subtitle">
              <span class="rule"></span>
              <span>Oficio de navaja y tijera</span>
              <span class="rule"></span>
            </div>
            <div class="hero-rating">
              <span class="stars">&#9733;&#9733;&#9733;&#9733;&#9733;</span>
              <strong>4.9 / 5</strong>
              <span class="review-count">(reservas online)</span>
            </div>
            <div class="hero-location">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path d="M12 21s7-6.6 7-11.5A7 7 0 0 0 5 9.5C5 14.4 12 21 12 21Z"></path><circle cx="12" cy="9.5" r="2.4"></circle>
              </svg>
              Turnos simples por web y WhatsApp
            </div>
            <div class="hero-features">
              <div class="feature">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                  <path d="M4 20v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2"></path><circle cx="12" cy="7" r="3.4"></circle>
                </svg>
                <span>Barberia<br>de autor</span>
              </div>
              <div class="feature">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                  <circle cx="12" cy="12" r="8.5"></circle><path d="M12 3v3M12 18v3M3 12h3M18 12h3"></path>
                </svg>
                <span>Profesionales<br>especializados</span>
              </div>
              <div class="feature">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                  <circle cx="12" cy="12" r="8.5"></circle><path d="M12 7v5l3.2 2"></path>
                </svg>
                <span>Atencion<br>personalizada</span>
              </div>
            </div>
            <a class="btn-cta" href="${escapeAttribute(bookingUrl)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <rect x="3" y="5" width="18" height="16" rx="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line>
                <line x1="8" y1="3" x2="8" y2="7"></line><line x1="16" y1="3" x2="16" y2="7"></line>
              </svg>
              Reservar turno
            </a>
            <div class="hero-note">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3Z"></path>
              </svg>
              Reserva segura. Confirmacion inmediata.
            </div>
          </div>
          <div class="hero-media ${business.coverImageUrl ? 'has-image' : ''}">
            ${business.coverImageUrl ? `<img src="${escapeAttribute(business.coverImageUrl)}" alt="Portada de ${escapeAttribute(business.name)}">` : renderHeroImagePreview()}
            <div class="hero-media-label">${escapeHtml(business.name)}</div>
          </div>
        </section>

        <section class="section-panel" id="servicios">
          <div class="wrap">
            <div class="three-col">
              <div id="servicios" class="servicios">
                <div class="col-header"><span class="rule"></span><h2>Servicios</h2></div>
                <div class="carousel-row" style="--carousel-items: ${serviceCarouselItems};">
                  <div class="carousel-track">
                    ${visibleServices.length ? carouselServices.map((service, index) => `
                      <div class="service-card">
                        <div class="card-photo photo-service-${index % 3}">
                          <img src="${escapeAttribute(landingImageFor(index, 'service'))}" alt="${escapeAttribute(service.name)}">
                        </div>
                        <div class="service-name">${escapeHtml(service.name)}</div>
                        <div class="service-meta">${escapeHtml(formatServiceMeta(service.duration, service.category))}</div>
                        <div class="service-price">${formatPrice(service.price)}</div>
                      </div>
                    `).join('') : `<p class="muted">Este comercio todavia no cargo servicios visibles.</p>`}
                  </div>
                </div>
              </div>

              <div class="col-divider"></div>

              <div id="profesionales" class="profesionales">
                <div class="col-header"><span class="rule"></span><h2>Profesionales</h2></div>
                <div class="carousel-row" style="--carousel-items: ${professionalCarouselItems};">
                  <div class="carousel-track">
                    ${visibleProfessionals.length ? carouselProfessionals.map((professional, index) => `
                      <div class="pro-card">
                        <div class="card-photo photo-pro-${index % 3}">
                          <img src="${escapeAttribute(professional.avatarUrl || landingImageFor(index, 'professional'))}" alt="${escapeAttribute(professional.name)}">
                        </div>
                        <div class="pro-name">${escapeHtml(professional.name)}</div>
                        <div class="pro-role">Especialista en reservas y atencion personalizada</div>
                        <div class="pro-rating"><span class="star">★</span> 4.9 <span class="count">(87)</span></div>
                      </div>
                    `).join('') : `<p class="muted">El equipo se va a mostrar cuando haya profesionales activos.</p>`}
                  </div>
                </div>
              </div>

              <div class="col-divider"></div>

              <div id="comentarios" class="resenas">
                <div class="col-header"><span class="rule"></span><h2>Comentarios</h2></div>
                <div class="carousel-row" style="--carousel-items: 3;">
                  <div class="carousel-track">
                    <div class="review-card">
                      <div class="review-badge">M</div>
                      <div class="review-stars">★★★★★</div>
                      <div class="review-author">Martín R.</div>
                      <div class="review-text">Reserve por la web en dos minutos. Llegue y ya tenian mi turno listo.</div>
                    </div>
                    <div class="review-card">
                      <div class="review-badge">D</div>
                      <div class="review-stars">★★★★★</div>
                      <div class="review-author">Diego L.</div>
                      <div class="review-text">Muy buena atencion. El corte quedo prolijo y el horario se respeto perfecto.</div>
                    </div>
                    <div class="review-card">
                      <div class="review-badge">N</div>
                      <div class="review-stars">★★★★★</div>
                      <div class="review-author">Nico P.</div>
                      <div class="review-text">Me gusto poder elegir profesional y horario sin tener que escribir por WhatsApp.</div>
                    </div>
                    <div class="review-card">
                      <div class="review-badge">M</div>
                      <div class="review-stars">★★★★★</div>
                      <div class="review-author">Martín R.</div>
                      <div class="review-text">Reserve por la web en dos minutos. Llegue y ya tenian mi turno listo.</div>
                    </div>
                    <div class="review-card">
                      <div class="review-badge">D</div>
                      <div class="review-stars">★★★★★</div>
                      <div class="review-author">Diego L.</div>
                      <div class="review-text">Muy buena atencion. El corte quedo prolijo y el horario se respeto perfecto.</div>
                    </div>
                    <div class="review-card">
                      <div class="review-badge">N</div>
                      <div class="review-stars">★★★★★</div>
                      <div class="review-author">Nico P.</div>
                      <div class="review-text">Me gusto poder elegir profesional y horario sin tener que escribir por WhatsApp.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="galeria" class="galeria">
          <div class="wrap">
            <div class="col-header"><span class="rule"></span><h2>Galeria</h2><span class="rule"></span></div>
            <div class="gallery-row">
              <div class="gallery-track">
                <figure class="gallery-item gallery-shot-1"><img src="/landing-assets/barber-hero-interior.png" alt="Interior del local"></figure>
                <figure class="gallery-item gallery-shot-2"><img src="/landing-assets/barber-hero-service.png" alt="Corte en progreso"></figure>
                <figure class="gallery-item gallery-shot-3"><img src="/landing-assets/barber-hero-interior.png" alt="Sillas de barberia"></figure>
                <figure class="gallery-item gallery-shot-4"><img src="/landing-assets/barber-hero-service.png" alt="Detalle de servicio"></figure>
                <figure class="gallery-item gallery-shot-5"><img src="/landing-assets/barber-hero-interior.png" alt="Ambiente de barberia"></figure>
                <figure class="gallery-item gallery-shot-6"><img src="/landing-assets/barber-hero-service.png" alt="Terminacion de corte"></figure>
              </div>
              <button class="arrow-btn" aria-label="Siguiente" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"></path></svg>
              </button>
            </div>
          </div>
        </section>

        <footer class="site-footer" id="contacto">
          <div class="wrap">
            <div class="footer-grid">
              <section class="footer-brand" aria-label="Marca">
                <svg class="footer-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <circle cx="6" cy="6" r="2.6"></circle><circle cx="6" cy="18" r="2.6"></circle>
                  <line x1="8.1" y1="7.6" x2="20" y2="18"></line>
                  <line x1="8.1" y1="16.4" x2="20" y2="6"></line>
                </svg>
                <h2>${escapeHtml(business.name)}</h2>
                <p>Oficio de navaja y tijera</p>
              </section>

              <section class="footer-column">
                <h3>Contacto</h3>
                <ul>
                  <li>
                    <span class="footer-icon">⌖</span>
                    <span>Av. Colapinta 1234,<br>Palermo, CABA</span>
                  </li>
                  <li>
                    <span class="footer-icon">☏</span>
                    <span>WhatsApp +54 11 5028-0000</span>
                  </li>
                  <li>
                    <span class="footer-icon">✉</span>
                    <span>hola@barbercolapinta.com</span>
                  </li>
                </ul>
              </section>

              <section class="footer-column">
                <h3>Horarios</h3>
                <ul>
                  <li><span class="footer-icon">◷</span><span>Lun a vie 10:00 a 20:00</span></li>
                  <li><span class="footer-icon">▣</span><span>Sábados 10:00 a 18:00</span></li>
                  <li><span class="footer-icon">⊘</span><span>Domingos cerrado</span></li>
                </ul>
              </section>

              <section class="footer-column footer-social">
                <h3>Redes & reservas</h3>
                <div class="social-links">
                  <a href="#" aria-label="Instagram">
                    ${renderBrandIcon(siInstagram)}
                    <span>Instagram</span>
                  </a>
                  <a href="#" aria-label="Facebook">
                    ${renderBrandIcon(siFacebook)}
                    <span>Facebook</span>
                  </a>
                  <a href="${escapeAttribute(whatsappUrl || '#')}" ${whatsappUrl ? 'target="_blank" rel="noreferrer"' : ''} aria-label="WhatsApp">
                    ${renderBrandIcon(siWhatsapp)}
                    <span>WhatsApp</span>
                  </a>
                </div>
                <a class="footer-booking" href="${escapeAttribute(bookingUrl)}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <rect x="3" y="5" width="18" height="16" rx="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line>
                    <line x1="8" y1="3" x2="8" y2="7"></line><line x1="16" y1="3" x2="16" y2="7"></line>
                  </svg>
                  Reservar turno
                </a>
              </section>
            </div>

            <div class="footer-bottom">
              <span>© 2026 ${escapeHtml(business.name)}</span>
              <span>Powered by Weex</span>
            </div>
          </div>
        </footer>
      </main>
    `
  })
}

function renderBrandIcon(icon: SimpleIcon) {
  return `<svg class="social-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${escapeAttribute(icon.path)}"></path></svg>`
}

function renderBookingPlaceholder(business: LandingBusiness, backPath: string) {
  const slug = business.slug || ''
  const initialsText = initials(business.name) || 'WX'
  return htmlPage({
    title: `Reservar en ${business.name}`,
    body: `
      <main class="fresha-booking" data-booking-slug="${escapeAttribute(slug)}">
        <section class="fresha-modal">
          <header class="fresha-header">
            <button class="fresha-icon-btn" id="booking-back" type="button" aria-label="Volver">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 19l-7-7 7-7"></path></svg>
            </button>
            <nav class="fresha-breadcrumb" id="booking-breadcrumb" aria-label="Pasos de reserva"></nav>
            <a class="fresha-icon-btn" href="${escapeAttribute(backPath)}" aria-label="Cerrar reserva">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
            </a>
          </header>

          <div class="fresha-body">
            <section class="fresha-main">
              <h1 class="fresha-heading" id="booking-heading">Seleccionar servicio</h1>
              <div id="booking-content"></div>
              <div class="fresha-feedback" id="booking-feedback" role="status" aria-live="polite"></div>
            </section>

            <aside class="fresha-summary">
              <div class="summary-business">
                <div class="summary-logo">${escapeHtml(initialsText)}</div>
                <div>
                  <div class="summary-name">${escapeHtml(business.name)}</div>
                  <div class="summary-rating">
                    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 1.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L1.3 7.8l6.1-.7z"></path></svg>
                    4.9 <span>(reservas online)</span>
                  </div>
                  <div class="summary-address">Turnos web disponibles</div>
                </div>
              </div>

              <hr class="summary-divider">

              <div id="booking-summary-lines">
                <div class="summary-empty">Eleg&iacute; un servicio para ver el resumen de tu turno.</div>
              </div>

              <hr class="summary-divider" id="booking-total-divider" hidden>
              <div class="summary-total" id="booking-total-row" hidden>
                <span>Total</span>
                <strong id="booking-total">-</strong>
              </div>

              <button class="fresha-continue" id="booking-continue" type="button" disabled>
                <span id="booking-continue-label">Continuar</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
              </button>
            </aside>
          </div>
        </section>
      </main>
      <script>
        (() => {
          const slug = ${JSON.stringify(slug)}
          const backPath = ${JSON.stringify(backPath)}
          const steps = ['Servicios', 'Profesional', 'Hora', 'Confirmar']
          const state = {
            step: 1,
            catalog: null,
            service: null,
            professionalId: null,
            date: null,
            dateLabel: null,
            slot: null,
            confirmed: false
          }
          const els = {
            back: document.getElementById('booking-back'),
            breadcrumb: document.getElementById('booking-breadcrumb'),
            heading: document.getElementById('booking-heading'),
            content: document.getElementById('booking-content'),
            feedback: document.getElementById('booking-feedback'),
            summaryLines: document.getElementById('booking-summary-lines'),
            totalDivider: document.getElementById('booking-total-divider'),
            totalRow: document.getElementById('booking-total-row'),
            total: document.getElementById('booking-total'),
            continue: document.getElementById('booking-continue'),
            continueLabel: document.getElementById('booking-continue-label')
          }

          const dayNames = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']
          const monthNames = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
          const dates = Array.from({ length: 14 }, (_, index) => {
            const date = new Date()
            date.setHours(0, 0, 0, 0)
            date.setDate(date.getDate() + index)
            return date
          })

          async function loadCatalog() {
            setFeedback('Cargando opciones...', 'info')
            try {
              state.catalog = await getJson('/public/booking/' + encodeURIComponent(slug) + '/catalog')
              setFeedback('', '')
              render()
            } catch (error) {
              setFeedback(error.message, 'error')
              render()
            }
          }

          function renderBreadcrumb() {
            els.breadcrumb.innerHTML = steps.map((label, index) => {
              const step = index + 1
              const className = step === state.step ? 'active' : step < state.step ? 'done' : ''
              const separator = index < steps.length - 1 ? '<span class="crumb-sep">›</span>' : ''
              return '<button class="crumb ' + className + '" type="button" data-step="' + step + '"' + (step > state.step ? ' disabled' : '') + '>' + escapeHtml(label) + '</button>' + separator
            }).join('')
          }

          function renderServiceStep() {
            els.heading.textContent = 'Seleccionar servicio'
            const services = state.catalog?.services || []
            if (!services.length) {
              els.content.innerHTML = '<p class="fresha-muted">Todavia no hay servicios cargados para reservar.</p>'
              updateContinue(false)
              return
            }
            els.content.innerHTML = '<div class="fresha-options">' + services.map((service) => {
              return '<button class="fresha-option ' + (state.service?.id === service.id ? 'selected' : '') + '" type="button" data-service-id="' + escapeHtml(service.id) + '">' +
                '<span class="option-left"><span class="radio"></span><span><strong>' + escapeHtml(service.name) + '</strong><small>' + escapeHtml(service.category || (service.duration + ' min')) + '</small></span></span>' +
                '<span class="option-right"><span>' + escapeHtml(service.duration + ' min') + '</span><strong>' + escapeHtml(service.price ? formatPrice(service.price) : 'Consultar') + '</strong></span>' +
              '</button>'
            }).join('') + '</div>'
            updateContinue(Boolean(state.service))
          }

          function renderProfessionalStep() {
            els.heading.textContent = 'Seleccionar profesional'
            const professionals = availableProfessionals()
            if (!state.service) {
              els.content.innerHTML = '<p class="fresha-muted">Primero elegi un servicio.</p>'
              updateContinue(false)
              return
            }
            if (!professionals.length) {
              els.content.innerHTML = '<p class="fresha-muted">No hay profesionales cargados para este servicio.</p>'
              updateContinue(false)
              return
            }
            els.content.innerHTML = '<div class="fresha-options">' + professionals.map((professional) => {
              return '<button class="fresha-option ' + (state.professionalId === professional.id ? 'selected' : '') + '" type="button" data-professional-id="' + escapeHtml(professional.id) + '">' +
                '<span class="option-left"><span class="avatar">' + escapeHtml(initials(professional.name)) + '</span><span><strong>' + escapeHtml(professional.name) + '</strong><small>Agenda disponible</small></span></span>' +
                '<span class="radio"></span>' +
              '</button>'
            }).join('') + '</div>'
            updateContinue(Boolean(state.professionalId))
          }

          function availableProfessionals() {
            if (!state.catalog) return []
            if (!state.service) return state.catalog.professionals || []
            const allowed = new Set(state.service.professionalIds || [])
            return (state.catalog.professionals || []).filter((professional) => allowed.has(professional.id))
          }

          async function renderTimeStep() {
            els.heading.textContent = 'Seleccionar fecha y hora'
            if (!state.date) {
              setDate(dates[0])
            }
            const dateChips = dates.map((date) => {
              const iso = dateIso(date)
              return '<button class="date-chip ' + (state.date === iso ? 'selected' : '') + '" type="button" data-date="' + iso + '">' +
                '<span>' + dayNames[date.getDay()] + '</span><strong>' + date.getDate() + '</strong><small>' + monthNames[date.getMonth()] + '</small>' +
              '</button>'
            }).join('')
            els.content.innerHTML =
              '<div class="filter-row"><span class="fresha-pill">' + escapeHtml(professionalName(state.professionalId) || 'Selecciona profesional') + '</span></div>' +
              '<div class="section-label">Selecciona una fecha</div>' +
              '<div class="date-track">' + dateChips + '</div>' +
              '<div class="section-label">Escoge una hora</div>' +
              '<div class="slots" id="booking-slots"><p class="fresha-muted">Buscando horarios...</p></div>'
            updateContinue(false)
            await loadSlots()
          }

          async function loadSlots() {
            if (!state.service) {
              return
            }
            if (!state.professionalId) {
              return
            }
            state.slot = null
            const slotsEl = document.getElementById('booking-slots')
            if (slotsEl) slotsEl.innerHTML = '<p class="fresha-muted">Buscando horarios...</p>'
            try {
              const result = await getJson('/public/booking/' + encodeURIComponent(slug) + '/availability?serviceId=' + encodeURIComponent(state.service.id) + '&professionalId=' + encodeURIComponent(state.professionalId) + '&date=' + encodeURIComponent(state.date))
              if (!result.slots.length) {
                if (slotsEl) slotsEl.innerHTML = '<p class="fresha-muted">' + escapeHtml(result.message || 'No hay horarios disponibles para esa fecha.') + '</p>'
                updateConfirmState()
                return
              }
              if (slotsEl) slotsEl.innerHTML = result.slots.map((slot) => {
                return '<button class="slot ' + (state.slot?.time === slot.time ? 'selected' : '') + '" type="button" onclick="window.__selectBookingSlot(this)" data-time="' + escapeHtml(slot.time) + '" data-professional-id="' + escapeHtml(slot.professionalId) + '" data-professional-name="' + escapeHtml(slot.professionalName) + '">' +
                  escapeHtml(slot.time) +
                '</button>'
              }).join('')
              if (slotsEl) {
                slotsEl.querySelectorAll('[data-time]').forEach((slotButton) => {
                  slotButton.addEventListener('click', () => selectSlot(slotButton))
                })
              }
            } catch (error) {
              if (slotsEl) slotsEl.innerHTML = ''
              setFeedback(error.message, 'error')
            } finally {
              updateConfirmState()
            }
          }

          function renderConfirmStep() {
            els.heading.textContent = state.confirmed ? 'Turno confirmado' : 'Confirmar turno'
            if (state.confirmed) {
              els.content.innerHTML =
                '<div class="booking-success">' +
                  '<div class="success-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M20 6L9 17l-5-5"></path></svg></div>' +
                  '<h2>Turno confirmado</h2>' +
                  '<p>Tu reserva quedo registrada para ' + escapeHtml(state.dateLabel || '') + ' a las ' + escapeHtml(state.slot?.time || '') + '.</p>' +
                  '<a class="success-link" href="' + escapeHtml(backPath) + '">Volver a la landing</a>' +
                '</div>'
              updateContinue(false)
              els.continue.hidden = true
              return
            }
            els.continue.hidden = false
            els.content.innerHTML =
              '<p class="confirm-note">Revisa el resumen antes de confirmar. En el siguiente paso vamos a sumar login para asociar este turno a un cliente real.</p>'
            updateContinue(Boolean(state.service && state.professionalId && state.slot), 'Confirmar turno')
          }

          function renderSummary() {
            const lines = []
            if (state.service) {
              lines.push(
                '<div class="summary-card-line primary-line">' +
                  '<div><strong>' + escapeHtml(state.service.name) + '</strong><span>' + escapeHtml(state.service.duration + ' min') + '</span></div>' +
                  '<b>' + escapeHtml(state.service.price ? formatPrice(state.service.price) : 'Consultar') + '</b>' +
                '</div>'
              )
            }
            if (state.professionalId) {
              lines.push(
                '<div class="summary-card-line">' +
                  '<span>Profesional</span>' +
                  '<strong>' + escapeHtml(professionalName(state.professionalId)) + '</strong>' +
                '</div>'
              )
            }
            if (state.date) {
              lines.push(
                '<div class="summary-card-line">' +
                  '<span>Fecha</span>' +
                  '<strong>' + escapeHtml(state.dateLabel || '') + '</strong>' +
                '</div>'
              )
            }
            if (state.slot) {
              lines.push(
                '<div class="summary-card-line">' +
                  '<span>Horario</span>' +
                  '<strong>' + escapeHtml(state.slot.time) + '</strong>' +
                '</div>'
              )
            }
            els.summaryLines.innerHTML = lines.length ? lines.join('') : '<div class="summary-empty">Elegi un servicio para ver el resumen de tu turno.</div>'
            els.totalDivider.hidden = !state.service
            els.totalRow.hidden = !state.service
            els.total.textContent = state.service?.price ? formatPrice(state.service.price) : '-'
          }

          function setFeedback(message, type) {
            els.feedback.textContent = message
            els.feedback.className = 'fresha-feedback' + (message ? ' visible ' + type : '')
          }

          function selectSlot(slotButton) {
            state.slot = {
              time: slotButton.dataset.time,
              professionalId: slotButton.dataset.professionalId,
              professionalName: slotButton.dataset.professionalName
            }
            document.querySelectorAll('[data-time]').forEach((item) => {
              item.classList.toggle('selected', item === slotButton)
            })
            renderSummary()
            updateContinue(true)
          }
          window.__selectBookingSlot = selectSlot

          function professionalName(id) {
            return (state.catalog?.professionals || []).find((professional) => professional.id === id)?.name || ''
          }

          function updateContinue(enabled, label = 'Continuar') {
            els.continue.disabled = !enabled
            els.continue.classList.toggle('enabled', Boolean(enabled))
            els.continueLabel.textContent = label
          }

          function updateConfirmState() {
            if (state.step === 3) updateContinue(Boolean(state.date && state.slot))
          }

          function goToStep(step) {
            if (step > state.step) return
            state.step = step
            state.confirmed = false
            els.continue.hidden = false
            render()
          }

          function formatPrice(value) {
            return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value)
          }

          function setDate(date) {
            state.date = dateIso(date)
            state.dateLabel = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
          }

          async function getJson(url, options) {
            const response = await fetch(url, options)
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.message || 'No pude completar la operacion')
            return body
          }

          function escapeHtml(value) {
            return String(value || '')
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;')
          }

          function dateIso(date) {
            const yyyy = date.getFullYear()
            const mm = String(date.getMonth() + 1).padStart(2, '0')
            const dd = String(date.getDate()).padStart(2, '0')
            return yyyy + '-' + mm + '-' + dd
          }

          function initials(value) {
            return String(value || '')
              .split(/\\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((word) => word[0]?.toUpperCase() || '')
              .join('')
          }

          function render() {
            renderBreadcrumb()
            setFeedback('', '')
            els.back.disabled = state.step === 1
            if (!state.catalog) {
              els.heading.textContent = 'Cargando reserva'
              els.content.innerHTML = '<p class="fresha-muted">Estamos cargando la agenda.</p>'
              updateContinue(false)
              renderSummary()
              return
            }
            if (state.step === 1) renderServiceStep()
            if (state.step === 2) renderProfessionalStep()
            if (state.step === 3) void renderTimeStep()
            if (state.step === 4) renderConfirmStep()
            renderSummary()
          }

          els.content.addEventListener('click', (event) => {
            const serviceButton = event.target.closest('[data-service-id]')
            if (serviceButton) {
              state.service = (state.catalog.services || []).find((service) => service.id === serviceButton.dataset.serviceId) || null
              state.professionalId = null
              state.slot = null
              render()
              return
            }
            const slotButton = event.target.closest('.slot[data-time]')
            if (slotButton) {
              selectSlot(slotButton)
              return
            }
            const professionalButton = event.target.closest('.fresha-option[data-professional-id]')
            if (professionalButton) {
              state.professionalId = professionalButton.dataset.professionalId
              state.slot = null
              render()
              return
            }
            const dateButton = event.target.closest('[data-date]')
            if (dateButton) {
              const date = new Date(dateButton.dataset.date + 'T00:00:00')
              setDate(date)
              state.slot = null
              render()
              return
            }
          })

          els.breadcrumb.addEventListener('click', (event) => {
            const button = event.target.closest('[data-step]')
            if (!button || button.disabled) return
            goToStep(Number(button.dataset.step))
          })

          els.back.addEventListener('click', () => {
            if (state.step > 1) goToStep(state.step - 1)
          })

          els.continue.addEventListener('click', () => {
            if (els.continue.disabled) return
            if (state.step === 4) {
              state.confirmed = true
              render()
              return
            }
            state.step += 1
            render()
          })

          render()
          void loadCatalog()
        })()
      </script>
    `
  })
}

function renderWeexPlaceholder() {
  return htmlPage({
    title: 'Weex',
    body: `
      <main class="booking-shell">
        <section class="booking-card">
          <span class="eyebrow">Weex</span>
          <h1>La pagina principal queda reservada para la web institucional.</h1>
          <p>Mientras tanto, las landings publicas funcionan por slug local o por subdominio cuando el dominio este activo.</p>
          <a class="button primary" href="/crm">Entrar al CRM</a>
        </section>
      </main>
    `
  })
}

function renderNotFound() {
  return htmlPage({
    title: 'Landing no encontrada',
    body: `
      <main class="booking-shell">
        <section class="booking-card">
          <span class="eyebrow">Weex</span>
          <h1>No encontramos esta landing.</h1>
          <p>Revisa el subdominio o pedile al comercio su enlace de reservas.</p>
        </section>
      </main>
    `
  })
}

function htmlPage(input: { title: string; body: string }) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800;900&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: light;
      --dark-1: #141009;
      --dark-2: #1B150D;
      --dark-line: rgba(201,161,59,.22);
      --gold: #C9A13B;
      --gold-light: #E3C877;
      --gold-soft: rgba(201,161,59,.55);
      --burgundy: #6D1F1F;
      --burgundy-dark: #541616;
      --cream: #F3ECDC;
      --cream-card: #FDF9F1;
      --cream-line: #E4D9BF;
      --ink: #2A2117;
      --ink-soft: #8A7F6D;
      --white: #F7F3EA;
      --font-display: "Playfair Display", Georgia, serif;
      --font-sans: "Montserrat", Arial, sans-serif;
      --radius-md: 10px;
      --radius-full: 999px;
      --shadow-card: 0 10px 24px rgba(30,20,10,.08);
      --container: 1440px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      min-height: 100vh;
      color: var(--ink);
      background: var(--cream);
      font-family: var(--font-sans);
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }
    img { max-width: 100%; display: block; }
    a { color: inherit; text-decoration: none; }
    button, input { font: inherit; }
    p { color: var(--ink-soft); line-height: 1.6; }
    .wrap { max-width: var(--container); margin: 0 auto; padding: 0 48px; }

    .navbar { position: sticky; top: 0; z-index: 20; background: var(--dark-1); border-bottom: 1px solid var(--dark-line); }
    .navbar .wrap { height: 70px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
    .brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .brand-icon { width: 34px; height: 34px; color: var(--gold); flex: 0 0 auto; }
    .brand-text { display: grid; gap: 3px; min-width: 0; }
    .brand-text .name { color: var(--white); font-family: var(--font-display); font-size: 19px; font-weight: 700; letter-spacing: 1px; line-height: 1.1; text-transform: uppercase; white-space: nowrap; }
    .brand-text .tag { color: var(--gold); font-size: 10px; font-weight: 700; letter-spacing: 2.5px; line-height: 1; text-transform: uppercase; white-space: nowrap; }
    .nav-links { display: flex; align-items: center; gap: 34px; color: #CFC6B4; font-size: 12.5px; font-weight: 600; letter-spacing: 1.3px; text-transform: uppercase; }
    .nav-links a { padding-bottom: 6px; border-bottom: 2px solid transparent; transition: color .2s ease, border-color .2s ease; }
    .nav-links a:hover { color: var(--gold-light); }
    .nav-links a.active { color: var(--gold); border-bottom-color: var(--gold); }
    .btn-gold-outline, .btn-cta, .btn-light, .button { display: inline-flex; align-items: center; justify-content: center; gap: 9px; border-radius: var(--radius-full); font-weight: 700; cursor: pointer; }
    .btn-gold-outline { min-height: 44px; padding: 0 22px; color: var(--white); background: var(--burgundy); border: 1px solid var(--gold); font-size: 12.5px; letter-spacing: .6px; text-transform: uppercase; }
    .btn-gold-outline svg { width: 15px; height: 15px; }
    .btn-gold-outline:hover, .btn-cta:hover, .button.primary:hover { background: var(--burgundy-dark); }

    .landing { width: 100%; max-width: 100%; padding: 0 0 56px; overflow-x: hidden; }
    .hero { height: 430px; display: grid; grid-template-columns: minmax(320px, 33%) 1fr; align-items: stretch; color: var(--white); background: var(--dark-1); overflow: hidden; }
    .hero-content { height: 430px; max-width: 460px; padding: 34px 40px 34px 48px; display: flex; flex-direction: column; justify-content: center; }
    .hero .eyebrow { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; color: var(--gold); font-size: 12px; font-weight: 700; letter-spacing: 3px; line-height: 1.2; text-transform: uppercase; }
    .hero .eyebrow .rule, .hero-subtitle .rule { height: 1px; background: var(--gold-soft); }
    .hero .eyebrow .rule { width: 34px; }
    .hero .eyebrow svg { width: 16px; height: 16px; flex: 0 0 auto; }
    .hero-title { max-width: 460px; margin-bottom: 12px; color: var(--white); font-family: var(--font-display); font-size: 50px; font-weight: 800; line-height: .98; letter-spacing: .5px; text-transform: uppercase; }
    .hero-subtitle { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; color: var(--gold); font-size: 13.5px; font-weight: 700; letter-spacing: 3px; line-height: 1.2; text-transform: uppercase; }
    .hero-subtitle .rule { flex: 0 0 26px; }
    .hero-rating { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; color: var(--white); font-size: 14.5px; }
    .stars { color: var(--gold); font-size: 14px; letter-spacing: 1px; }
    .hero-rating strong { color: var(--gold-light); font-size: 15px; }
    .review-count, .hero-location { color: #BDB29C; }
    .hero-location { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; font-size: 13.5px; }
    .hero-location svg { width: 14px; height: 14px; color: var(--gold); flex: 0 0 auto; }
    .hero-features { display: flex; gap: 20px; margin-bottom: 20px; }
    .feature { display: flex; align-items: center; gap: 10px; }
    .feature svg { width: 22px; height: 22px; color: var(--gold); flex: 0 0 auto; }
    .feature span { color: #CFC6B4; font-size: 12px; font-weight: 500; line-height: 1.3; }
    .btn-cta { width: fit-content; min-height: 44px; padding: 0 26px; color: var(--white); background: linear-gradient(180deg, var(--burgundy), var(--burgundy-dark)); border: 1px solid var(--gold); box-shadow: 0 8px 20px rgba(0,0,0,.35); font-size: 15px; letter-spacing: .4px; }
    .btn-cta svg { width: 18px; height: 18px; }
    .hero-note { display: flex; align-items: center; gap: 8px; margin-top: 10px; color: #8F8570; font-size: 11.5px; }
    .hero-note svg { width: 13px; height: 13px; color: var(--gold); }
    .hero-media { position: relative; height: 430px; min-height: 0; overflow: hidden; background: linear-gradient(120deg, rgba(20,16,9,.55), rgba(20,16,9,.15) 40%, rgba(20,16,9,.6)), repeating-linear-gradient(45deg, #2A2013 0 2px, #241B10 2px 4px); }
    .hero-media::before { content: ""; position: absolute; inset: 0; z-index: 1; background: radial-gradient(ellipse at 30% 20%, rgba(201,161,59,.18), transparent 55%); pointer-events: none; }
    .hero-media img, .hero-image-preview img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center center; filter: grayscale(.18) sepia(.18) brightness(.74) contrast(1.08); }
    .hero-image-preview { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; background: var(--dark-1); }
    .hero-image-preview::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(20,16,9,.28), transparent 45%), linear-gradient(0deg, rgba(20,16,9,.32), transparent 48%); pointer-events: none; }
    .hero-media-label { position: absolute; right: 28px; bottom: 24px; z-index: 2; color: rgba(247,243,234,.5); font-family: var(--font-display); font-size: 13px; letter-spacing: 2px; text-transform: uppercase; }

    .section-panel { background: var(--cream); padding: 56px 0 40px; }
    .three-col { width: 100%; min-width: 0; display: grid; grid-template-columns: .88fr 1px 1fr 1px 1.35fr; gap: 0 34px; }
    .servicios,
    .profesionales,
    .resenas {
      min-width: 0;
      overflow: hidden;
    }
    .col-divider { width: 1px; background: var(--cream-line); }
    .col-header { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 26px; }
    .col-header .rule { width: 38px; height: 1px; background: var(--gold-soft); }
    .col-header h2 { color: var(--ink); font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: 2px; text-align: center; text-transform: uppercase; }
    .carousel-row { --card-width: 118px; --carousel-gap: 16px; --carousel-items: 3; position: relative; overflow: hidden; width: 100%; max-width: 100%; }
    .profesionales .carousel-row { --card-width: 122px; }
    .resenas .carousel-row { --card-width: 178px; }
    .carousel-row::before,
    .carousel-row::after {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      z-index: 2;
      width: 18px;
      pointer-events: none;
    }
    .carousel-row::before { left: 0; background: linear-gradient(90deg, var(--cream), transparent); }
    .carousel-row::after { right: 0; background: linear-gradient(270deg, var(--cream), transparent); }
    .carousel-track { width: max-content; display: flex; gap: var(--carousel-gap); animation: carousel-scroll 24s linear infinite; will-change: transform; }
    .profesionales .carousel-track { animation-duration: 28s; }
    .resenas .carousel-track { animation-duration: 32s; }
    .carousel-row:hover .carousel-track { animation-play-state: paused; }
    .arrow-btn { flex: 0 0 auto; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; color: var(--ink); background: var(--cream-card); border: 1px solid var(--cream-line); border-radius: 50%; box-shadow: var(--shadow-card); }
    .arrow-btn svg { width: 15px; height: 15px; }
    .card-photo { aspect-ratio: 1 / 1; margin-bottom: 14px; border-radius: var(--radius-md); background: linear-gradient(160deg, #2C2216, #1A1409 70%); position: relative; overflow: hidden; }
    .card-photo img { width: 100%; height: 100%; object-fit: cover; filter: sepia(.2) brightness(.78) contrast(1.08); transform: scale(1.08); }
    .card-photo::after { content: ""; position: absolute; inset: 0; background: linear-gradient(0deg, rgba(20,16,9,.28), transparent 48%), radial-gradient(circle at 70% 20%, rgba(201,161,59,.25), transparent 60%); pointer-events: none; }
    .service-card .card-photo, .pro-card .card-photo { aspect-ratio: 4 / 5; }
    .photo-service-0 img { object-position: 58% 48%; }
    .photo-service-1 img { object-position: 28% 44%; }
    .photo-service-2 img { object-position: 72% 52%; }
    .photo-pro-0 img { object-position: 52% 34%; }
    .photo-pro-1 img { object-position: 42% 38%; }
    .photo-pro-2 img { object-position: 66% 36%; }
    .service-card { flex: 0 0 var(--card-width); }
    .pro-card { flex: 0 0 var(--card-width); }
    .service-name { margin-bottom: 4px; color: var(--ink); font-size: 15px; font-weight: 700; }
    .service-meta { margin-bottom: 6px; color: var(--ink-soft); font-size: 12px; }
    .service-price { color: var(--burgundy); font-size: 14.5px; font-weight: 700; }
    .pro-name { margin-bottom: 5px; color: var(--ink); font-size: 14px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
    .pro-role { min-height: 32px; margin-bottom: 8px; color: var(--ink-soft); font-size: 12px; line-height: 1.4; }
    .pro-rating { display: flex; align-items: center; gap: 6px; color: var(--ink); font-size: 12.5px; font-weight: 700; }
    .pro-rating .star { color: var(--gold); }
    .pro-rating span.count { color: var(--ink-soft); font-weight: 500; }
    .review-card { flex: 0 0 var(--card-width); min-height: 224px; padding: 22px; background: var(--cream-card); border: 1px solid var(--cream-line); border-radius: 14px; box-shadow: var(--shadow-card); }
    .review-badge { width: 26px; height: 26px; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; color: var(--gold); background: var(--dark-1); border-radius: 50%; font-family: var(--font-display); font-size: 13px; font-weight: 700; }
    .review-stars { margin-bottom: 10px; color: var(--gold); font-size: 13px; letter-spacing: 1px; }
    .review-author { margin-bottom: 6px; font-size: 13.5px; font-weight: 700; }
    .review-text { color: var(--ink-soft); font-size: 12.5px; line-height: 1.5; }
    @keyframes carousel-scroll {
      from { transform: translateX(0); }
      to { transform: translateX(calc(-1 * var(--carousel-items) * (var(--card-width) + var(--carousel-gap)))); }
    }

    @media (prefers-reduced-motion: reduce) {
      .carousel-track { animation: none; }
    }
    .galeria { margin-top: 36px; padding: 20px 0 60px; border-top: 1px solid var(--cream-line); }
    .galeria .col-header { margin-bottom: 22px; }
    .galeria .col-header h2 { font-size: 24px; }
    .gallery-row { position: relative; display: flex; align-items: center; gap: 14px; }
    .gallery-track { display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; flex: 1; }
    .gallery-item { aspect-ratio: 1 / 1; position: relative; overflow: hidden; border-radius: var(--radius-md); background: linear-gradient(150deg, #241B10, #150F08 75%); }
    .gallery-item img { width: 100%; height: 100%; object-fit: cover; filter: sepia(.22) brightness(.78) contrast(1.08); transform: scale(1.08); }
    .gallery-item::after { content: ""; position: absolute; inset: 0; background: radial-gradient(circle at 30% 70%, rgba(201,161,59,.2), transparent 60%); pointer-events: none; }
    .gallery-shot-1 img { object-position: 34% 50%; }
    .gallery-shot-2 img { object-position: 62% 44%; }
    .gallery-shot-3 img { object-position: 72% 52%; }
    .gallery-shot-4 img { object-position: 28% 45%; }
    .gallery-shot-5 img { object-position: 48% 36%; }
    .gallery-shot-6 img { object-position: 78% 48%; }
    .site-footer {
      color: var(--white);
      background:
        radial-gradient(circle at 18% 0%, rgba(201,161,59,.12), transparent 36%),
        linear-gradient(180deg, #17120C 0%, #100D09 100%);
      border-top: 1px solid rgba(201,161,59,.28);
      padding: 56px 0 28px;
    }
    .footer-grid {
      display: grid;
      grid-template-columns: 1.12fr 1fr .92fr 1.16fr;
      gap: 54px;
      align-items: start;
    }
    .footer-brand { min-width: 0; }
    .footer-mark {
      width: 36px;
      height: 36px;
      margin-bottom: 18px;
      color: var(--gold);
    }
    .footer-brand h2 {
      color: var(--white);
      font-family: var(--font-display);
      font-size: 30px;
      font-weight: 800;
      line-height: 1.02;
      letter-spacing: .8px;
      text-transform: uppercase;
    }
    .footer-brand p {
      margin-top: 10px;
      color: var(--gold);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 2.5px;
      line-height: 1.35;
      text-transform: uppercase;
    }
    .footer-brand::after {
      content: "";
      display: block;
      width: 74px;
      height: 1px;
      margin-top: 22px;
      background: var(--gold-soft);
    }
    .footer-column h3 {
      padding-bottom: 14px;
      color: var(--gold);
      border-bottom: 1px solid rgba(201,161,59,.42);
      font-family: var(--font-display);
      font-size: 17px;
      font-weight: 800;
      letter-spacing: 1.4px;
      text-transform: uppercase;
    }
    .footer-column ul {
      list-style: none;
      margin-top: 22px;
      display: grid;
      gap: 16px;
    }
    .footer-column li {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      color: #E2D7C2;
      font-size: 14px;
      line-height: 1.55;
    }
    .footer-icon {
      width: 22px;
      flex: 0 0 22px;
      color: var(--gold);
      font-size: 17px;
      line-height: 1.2;
      text-align: center;
    }
    .social-links {
      margin-top: 22px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .social-links a {
      min-height: 74px;
      display: grid;
      place-items: center;
      gap: 8px;
      padding: 10px;
      color: #F7F3EA;
      background: rgba(255,255,255,.035);
      border: 1px solid rgba(201,161,59,.35);
      border-radius: 6px;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .7px;
      text-align: center;
      text-transform: uppercase;
      transition: border-color .2s ease, color .2s ease, background .2s ease;
    }
    .social-icon {
      width: 22px;
      height: 22px;
      color: var(--gold);
    }
    .social-links span {
      line-height: 1;
    }
    .social-links a:hover {
      color: var(--gold-light);
      background: rgba(201,161,59,.08);
      border-color: rgba(201,161,59,.7);
    }
    .footer-booking {
      min-height: 62px;
      margin-top: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--white);
      background: linear-gradient(180deg, var(--burgundy), var(--burgundy-dark));
      border: 1px solid var(--gold);
      border-radius: 6px;
      box-shadow: 0 16px 28px rgba(0,0,0,.28);
      font-size: 13px;
      font-weight: 900;
      letter-spacing: 1.8px;
      text-transform: uppercase;
    }
    .footer-booking:hover { background: var(--burgundy-dark); }
    .footer-booking svg { width: 19px; height: 19px; }
    .footer-bottom {
      margin-top: 54px;
      padding-top: 22px;
      display: flex;
      justify-content: space-between;
      gap: 16px;
      color: rgba(227,200,119,.68);
      border-top: 1px solid rgba(201,161,59,.28);
      font-size: 12px;
      letter-spacing: .7px;
    }
    .btn-light { min-height: 44px; padding: 0 22px; color: var(--white); border: 1px solid rgba(201,161,59,.5); background: rgba(255,255,255,.04); }
    .muted { color: var(--ink-soft); }

    .booking-shell { min-height: 100vh; width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 36px 0; display: grid; align-content: center; gap: 18px; }
    .back-link { color: var(--ink-soft); font-weight: 800; }
    .booking-card { padding: 36px; background: var(--cream-card); border: 1px solid var(--cream-line); border-radius: var(--radius-md); box-shadow: var(--shadow-card); }
    .eyebrow { color: var(--burgundy); font-size: 12px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
    .booking-card h1 { margin: 12px 0; color: var(--ink); font-family: var(--font-display); font-size: 58px; line-height: .98; }
    .button { min-height: 48px; padding: 0 20px; border: 1px solid var(--cream-line); background: #FFF; color: var(--ink); }
    .button.primary { color: var(--white); background: var(--burgundy); border-color: var(--burgundy); }
    .button.secondary { color: var(--ink); background: #FFF; }
    .button.full { width: 100%; }
    .button:disabled { opacity: .58; cursor: not-allowed; }

    .fresha-booking {
      min-height: 100vh;
      padding: 32px 16px 80px;
      background: #F1EFF4;
      color: #1B1B1F;
      font-family: "Montserrat", system-ui, sans-serif;
    }
    .fresha-modal {
      max-width: 1040px;
      margin: 0 auto;
      overflow: hidden;
      background: #FFFFFF;
      border-radius: 20px;
      box-shadow: 0 2px 4px rgba(20,16,40,.04), 0 20px 48px rgba(20,16,40,.08);
    }
    .fresha-header {
      min-height: 82px;
      padding: 22px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      border-bottom: 1px solid #EFEEF3;
    }
    .fresha-icon-btn {
      width: 38px;
      height: 38px;
      flex: 0 0 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #1B1B1F;
      background: #FFFFFF;
      border: 1px solid #E7E5EC;
      border-radius: 50%;
      cursor: pointer;
    }
    .fresha-icon-btn:hover { background: #EFEEF3; }
    .fresha-icon-btn:disabled { opacity: .35; cursor: not-allowed; }
    .fresha-icon-btn svg { width: 16px; height: 16px; }
    .fresha-breadcrumb {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      flex-wrap: wrap;
      color: #9C9CA6;
      font-size: 14px;
    }
    .crumb {
      padding: 0;
      color: inherit;
      background: transparent;
      border: 0;
      font: inherit;
    }
    .crumb.active { color: #1B1B1F; font-weight: 700; }
    .crumb.done { color: #6B6B76; cursor: pointer; }
    .crumb.done:hover { text-decoration: underline; }
    .crumb:disabled { cursor: default; }
    .crumb-sep { color: #E7E5EC; }
    .fresha-body {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
      align-items: start;
    }
    .fresha-main {
      min-height: 530px;
      padding: 36px 40px 48px;
      border-right: 1px solid #EFEEF3;
    }
    .fresha-heading {
      margin: 0 0 28px;
      color: #1B1B1F;
      font-family: "Montserrat", system-ui, sans-serif;
      font-size: 30px;
      font-weight: 800;
      line-height: 1.1;
    }
    .fresha-options {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .fresha-option {
      width: 100%;
      min-height: 74px;
      padding: 16px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      color: #1B1B1F;
      background: #FFFFFF;
      border: 1px solid #E7E5EC;
      border-radius: 12px;
      text-align: left;
      cursor: pointer;
      transition: border-color .15s ease, background .15s ease;
    }
    .fresha-option:hover { border-color: #9C9CA6; }
    .fresha-option.selected {
      background: #F4F1FE;
      border-color: #5B34EA;
    }
    .option-left {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .option-left strong {
      display: block;
      color: #1B1B1F;
      font-size: 15px;
      font-weight: 800;
    }
    .option-left small,
    .option-right span {
      display: block;
      margin-top: 3px;
      color: #6B6B76;
      font-size: 13px;
    }
    .option-right {
      flex: 0 0 auto;
      display: grid;
      justify-items: end;
      gap: 3px;
      color: #1B1B1F;
      font-size: 14px;
    }
    .option-right strong {
      font-size: 15px;
      font-weight: 800;
    }
    .radio {
      width: 20px;
      height: 20px;
      flex: 0 0 20px;
      position: relative;
      border: 1.5px solid #E7E5EC;
      border-radius: 50%;
    }
    .fresha-option.selected .radio { border-color: #5B34EA; }
    .fresha-option.selected .radio::after {
      content: "";
      position: absolute;
      inset: 4px;
      background: #5B34EA;
      border-radius: 50%;
    }
    .avatar {
      width: 42px;
      height: 42px;
      flex: 0 0 42px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #6B6B76;
      background: #EFEEF3;
      border-radius: 50%;
      font-size: 13px;
      font-weight: 800;
    }
    .filter-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 26px;
    }
    .fresha-pill {
      display: inline-flex;
      align-items: center;
      min-height: 40px;
      padding: 0 16px;
      color: #1B1B1F;
      background: #FFFFFF;
      border: 1px solid #E7E5EC;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 700;
    }
    .section-label {
      margin: 0 0 14px;
      color: #1B1B1F;
      font-size: 16px;
      font-weight: 800;
    }
    .date-track {
      display: flex;
      gap: 10px;
      margin-bottom: 32px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .date-track::-webkit-scrollbar { display: none; }
    .date-chip {
      width: 64px;
      flex: 0 0 64px;
      padding: 12px 0 14px;
      color: #1B1B1F;
      background: #FFFFFF;
      border: 1px solid #E7E5EC;
      border-radius: 12px;
      text-align: center;
      cursor: pointer;
    }
    .date-chip span,
    .date-chip small {
      display: block;
      color: #6B6B76;
      font-size: 11px;
      text-transform: lowercase;
    }
    .date-chip strong {
      display: block;
      margin: 5px 0 3px;
      font-size: 19px;
      line-height: 1;
    }
    .date-chip.selected {
      color: #FFFFFF;
      background: #5B34EA;
      border-color: #5B34EA;
    }
    .date-chip.selected span,
    .date-chip.selected small { color: #FFFFFF; }
    .slots {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .slot {
      min-height: 54px;
      padding: 0 18px;
      color: #1B1B1F;
      background: #FFFFFF;
      border: 1px solid #E7E5EC;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 800;
      text-align: left;
      cursor: pointer;
    }
    .slot:hover { border-color: #9C9CA6; }
    .slot.selected {
      color: #5B34EA;
      background: #F4F1FE;
      border-color: #5B34EA;
    }
    .fresha-summary {
      padding: 32px 28px;
      background: #FFFFFF;
    }
    .summary-business {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
    }
    .summary-logo {
      width: 48px;
      height: 48px;
      flex: 0 0 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      background: #1B1B1F;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 900;
    }
    .summary-name {
      margin-bottom: 3px;
      color: #1B1B1F;
      font-size: 15px;
      font-weight: 900;
    }
    .summary-rating {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-bottom: 3px;
      color: #1B1B1F;
      font-size: 13px;
      font-weight: 800;
    }
    .summary-rating svg {
      width: 13px;
      height: 13px;
    }
    .summary-rating span,
    .summary-address {
      color: #6B6B76;
      font-weight: 500;
    }
    .summary-address {
      font-size: 12.5px;
      line-height: 1.4;
    }
    .summary-divider {
      border: 0;
      border-top: 1px solid #EFEEF3;
      margin: 20px 0;
    }
    .summary-empty {
      color: #9C9CA6;
      font-size: 13.5px;
      font-style: italic;
      line-height: 1.5;
    }
    .summary-card-line {
      padding: 14px 0;
      display: flex;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 1px solid #EFEEF3;
    }
    .summary-card-line:last-child { border-bottom: 0; }
    .summary-card-line span {
      display: block;
      color: #6B6B76;
      font-size: 12.5px;
      line-height: 1.35;
    }
    .summary-card-line strong,
    .summary-card-line b {
      color: #1B1B1F;
      font-size: 14.5px;
      font-weight: 900;
      text-align: right;
    }
    .primary-line {
      padding: 16px;
      margin-bottom: 8px;
      background: #F8F7FA;
      border: 1px solid #EFEEF3;
      border-radius: 14px;
    }
    .primary-line strong,
    .primary-line b {
      text-align: left;
      font-size: 15px;
    }
    .summary-total {
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #1B1B1F;
      font-size: 15px;
      font-weight: 900;
    }
    .fresha-continue {
      width: 100%;
      min-height: 52px;
      padding: 0 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: #9C9CA6;
      background: #F3F2F6;
      border: 0;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 900;
      cursor: not-allowed;
    }
    .fresha-continue.enabled {
      color: #FFFFFF;
      background: #1B1B1F;
      cursor: pointer;
    }
    .fresha-continue.enabled:hover { background: #4726BD; }
    .fresha-continue svg {
      width: 15px;
      height: 15px;
    }
    .fresha-feedback {
      display: none;
      margin-top: 18px;
      padding: 13px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.45;
    }
    .fresha-feedback.visible { display: block; }
    .fresha-feedback.info {
      color: #1D4ED8;
      background: #EFF6FF;
      border: 1px solid #BFDBFE;
    }
    .fresha-feedback.error {
      color: #B42318;
      background: #FFF1F2;
      border: 1px solid #FECACA;
    }
    .fresha-muted {
      color: #6B6B76;
      font-size: 14px;
      line-height: 1.55;
    }
    .confirm-note {
      max-width: 440px;
      color: #6B6B76;
      font-size: 14px;
      line-height: 1.55;
    }
    .booking-success {
      padding: 58px 20px;
      text-align: center;
    }
    .success-check {
      width: 58px;
      height: 58px;
      margin: 0 auto 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #2E9E4F;
      background: #EAF7EE;
      border-radius: 50%;
    }
    .success-check svg {
      width: 27px;
      height: 27px;
    }
    .booking-success h2 {
      margin: 0 0 8px;
      color: #1B1B1F;
      font-family: "Montserrat", system-ui, sans-serif;
      font-size: 22px;
      font-weight: 900;
    }
    .booking-success p {
      max-width: 420px;
      margin: 0 auto;
      color: #6B6B76;
      font-size: 14px;
      line-height: 1.55;
    }
    .success-link {
      min-height: 46px;
      margin-top: 22px;
      padding: 0 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      background: #1B1B1F;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 900;
    }

    @media (max-width: 820px) {
      .fresha-booking { padding: 18px 12px 48px; }
      .fresha-body { grid-template-columns: 1fr; }
      .fresha-main {
        min-height: 0;
        padding: 28px 22px 36px;
        border-right: 0;
        border-bottom: 1px solid #EFEEF3;
      }
      .fresha-summary { padding: 24px 22px; }
      .fresha-breadcrumb { display: none; }
      .fresha-heading { font-size: 25px; }
      .option-right { min-width: 92px; }
    }

    @media (max-width: 560px) {
      .fresha-header { padding: 16px; }
      .fresha-option {
        align-items: flex-start;
        flex-direction: column;
      }
      .option-right {
        width: 100%;
        justify-items: start;
      }
      .date-chip {
        width: 58px;
        flex-basis: 58px;
      }
    }

    @media (max-width: 1100px) {
      .nav-links { display: none; }
      .hero { height: auto; grid-template-columns: 1fr; }
      .hero-media { height: 360px; min-height: 360px; }
      .three-col { grid-template-columns: 1fr; gap: 44px 0; }
      .col-divider { display: none; }
      .gallery-track { grid-template-columns: repeat(3, 1fr); }
      .footer-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 42px 36px; }
    }

    @media (max-width: 900px) {
      .wrap { padding: 0 20px; }
      .hero-content { height: auto; max-width: none; padding: 48px 20px; }
    }

    @media (max-width: 560px) {
      .navbar .wrap { height: 64px; gap: 12px; }
      .brand-icon { display: none; }
      .brand-text .name { font-size: 16px; }
      .brand-text .tag { font-size: 9px; letter-spacing: 1.8px; }
      .btn-gold-outline { min-height: 38px; padding: 0 12px; font-size: 12px; }
      .hero-title { font-size: 42px; }
      .hero-features { flex-direction: column; gap: 0; }
      .feature { padding: 10px 0; border-bottom: 1px solid rgba(201,161,59,.22); }
      .feature:last-child { border-bottom: 0; }
      .servicios .carousel-row { --card-width: 132px; }
      .profesionales .carousel-row { --card-width: 136px; }
      .resenas .carousel-row { --card-width: 190px; }
      .gallery-track { grid-template-columns: repeat(2, 1fr); }
      .site-footer { padding: 44px 0 24px; }
      .footer-grid { grid-template-columns: 1fr; gap: 34px; }
      .social-links { grid-template-columns: 1fr; }
      .footer-bottom { flex-direction: column; }
      .booking-card { padding: 24px 18px; }
      .booking-card h1 { font-size: 38px; }
    }
  </style>
</head>
<body>
${input.body}
</body>
</html>`
}

function renderHeroImagePreview() {
  return `
    <div class="hero-image-preview">
      <img src="/landing-assets/barber-hero-service.png" alt="Barbero atendiendo a un cliente">
    </div>
  `
}

function landingImageFor(index: number, type: 'service' | 'professional') {
  const serviceImages = ['/landing-assets/barber-hero-service.png', '/landing-assets/barber-hero-interior.png', '/landing-assets/barber-hero-service.png']
  const professionalImages = ['/landing-assets/barber-hero-service.png', '/landing-assets/barber-hero-interior.png', '/landing-assets/barber-hero-service.png']
  const images = type === 'service' ? serviceImages : professionalImages
  return images[index % images.length] || images[0] || '/landing-assets/barber-hero-service.png'
}

function formatHeroTitle(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length <= 1) return escapeHtml(name)

  const midpoint = Math.ceil(words.length / 2)
  const firstLine = words.slice(0, midpoint).join(' ')
  const secondLine = words.slice(midpoint).join(' ')
  return `${escapeHtml(firstLine)}<br>${escapeHtml(secondLine)}`
}

function formatServiceMeta(duration: number, category?: string | null) {
  return [category, `${duration} min`].filter(Boolean).join(' - ')
}

function formatPrice(price?: number | null) {
  if (!price) return 'Consultar'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(price)
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() || '')
    .join('')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function escapeAttribute(value: string) {
  return escapeHtml(value)
}
