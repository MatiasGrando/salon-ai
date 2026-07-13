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
  const accountPath = backPath === '/' ? '/cuenta' : `${backPath}/cuenta`
  return htmlPage({
    title: `Reservar en ${business.name}`,
    body: `
      <main class="fresha-booking" data-booking-slug="${escapeAttribute(slug)}">
        <div class="booking-brand-rail">
          <a class="booking-brand" href="${escapeAttribute(backPath)}">
            <span class="booking-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                <circle cx="6" cy="6" r="2.6"></circle><circle cx="6" cy="18" r="2.6"></circle>
                <line x1="8.1" y1="7.6" x2="20" y2="18"></line><line x1="8.1" y1="16.4" x2="20" y2="6"></line>
              </svg>
            </span>
            <span class="booking-brand-name">
              <strong>${escapeHtml(business.name)}</strong>
              <span>Oficio de navaja y tijera</span>
            </span>
          </a>
          <div class="booking-brand-note">Reserva online</div>
        </div>
        <section class="fresha-modal">
          <header class="fresha-header">
            <button class="fresha-icon-btn" id="booking-back" type="button" aria-label="Volver">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 19l-7-7 7-7"></path></svg>
            </button>
            <nav class="fresha-breadcrumb" id="booking-breadcrumb" aria-label="Pasos de reserva"></nav>
            <div class="booking-header-actions">
              <a class="fresha-icon-btn" href="${escapeAttribute(accountPath)}" aria-label="Mi perfil">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="8" r="3.2"></circle><path d="M5 20a7 7 0 0 1 14 0"></path></svg>
              </a>
              <a class="fresha-icon-btn" href="${escapeAttribute(backPath)}" aria-label="Cerrar reserva">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
              </a>
            </div>
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
                  <div class="summary-address">Turnos simples por web y WhatsApp</div>
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

function renderCustomerAccount(business: LandingBusiness, basePath: string) {
  const slug = business.slug || ''
  const initialsText = initials(business.name) || 'WX'
  const bookingUrl = `${basePath}/reservar`
  return htmlPage({
    title: `Mi perfil | ${business.name}`,
    body: `
      <main class="account-page" data-account-slug="${escapeAttribute(slug)}">
        <header class="account-topbar">
          <a class="account-brand" href="${escapeAttribute(basePath)}">
            <span class="account-brand-mark">${escapeHtml(initialsText)}</span>
            <span>
              <strong>${escapeHtml(business.name)}</strong>
              <small>Reservas Weex</small>
            </span>
          </a>
          <a class="account-book" href="${escapeAttribute(bookingUrl)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M3 10h18"></path></svg>
            Reservar
          </a>
        </header>

        <section class="account-shell" id="account-shell">
          <aside class="account-sidebar">
            <div class="account-user">
              <div class="account-avatar" id="account-avatar">G</div>
              <div>
                <strong id="account-name">Invitado</strong>
                <small id="account-email">Inicia sesion con Google</small>
              </div>
            </div>
            <nav class="account-tabs" aria-label="Mi cuenta">
              <button class="account-tab active" type="button" data-tab="profile">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="3.2"></circle><path d="M5 20a7 7 0 0 1 14 0"></path></svg>
                Perfil
              </button>
              <button class="account-tab" type="button" data-tab="history">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M4 10h16"></path></svg>
                Historial
              </button>
            </nav>
            <button class="account-logout" id="account-logout" type="button" hidden>Cerrar sesion</button>
          </aside>

          <section class="account-main">
            <div class="account-login" id="account-login">
              <div class="google-orb" aria-hidden="true">G</div>
              <h1>Ingresa con Google</h1>
              <p>Usamos tus datos de Google para identificarte. Solo vas a completar tu telefono para ver y asociar tus turnos.</p>
              <button class="google-button" id="google-login" type="button">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z"></path><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.8l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.8 0-5.2-1.9-6.1-4.5H2.2v2.8A11 11 0 0 0 12 23z"></path><path fill="#FBBC05" d="M5.9 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.2a11 11 0 0 0 0 9.8l3.7-2.8z"></path><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A10.8 10.8 0 0 0 12 1 11 11 0 0 0 2.2 7.1l3.7 2.8c.9-2.6 3.3-4.5 6.1-4.5z"></path></svg>
                Continuar con Google
              </button>
            </div>

            <div class="account-workspace" id="account-workspace" hidden>
              <header class="account-section-head">
                <div>
                  <span class="account-kicker">Mi cuenta</span>
                  <h1 id="account-title">Perfil</h1>
                </div>
                <span class="account-status" id="account-status">Google conectado</span>
              </header>

              <div class="account-feedback" id="account-feedback" role="status" aria-live="polite"></div>

              <section class="account-panel" id="profile-panel">
                <div class="profile-grid">
                  <div class="google-profile">
                    <div class="large-avatar" id="large-avatar">G</div>
                    <div>
                      <h2 id="profile-name">Cliente Weex</h2>
                      <p id="profile-email">cliente@gmail.com</p>
                    </div>
                  </div>
                  <form class="phone-form" id="phone-form">
                    <label for="phone-input">Telefono</label>
                    <div class="phone-row">
                      <input id="phone-input" name="phone" inputmode="tel" autocomplete="tel" placeholder="+54 9 11 2345 6789">
                      <button class="save-phone" type="submit">Guardar</button>
                    </div>
                    <small>Este es el unico dato editable. Lo usamos para encontrar tus reservas.</small>
                  </form>
                </div>
              </section>

              <section class="history-layout" id="history-panel" hidden>
                <div class="history-list">
                  <div class="history-filter">
                    <button class="history-chip active" type="button">Citas <span id="history-count">0</span></button>
                  </div>
                  <h2>Proximas <span id="upcoming-count">0</span></h2>
                  <div id="upcoming-state"></div>
                  <h2>Historial</h2>
                  <div id="history-items"></div>
                </div>
                <aside class="history-detail" id="history-detail"></aside>
              </section>
            </div>
          </section>
        </section>
      </main>

      <script>
        (() => {
          const slug = ${JSON.stringify(slug)}
          const storageKey = 'weex.customer.' + slug
          const state = {
            tab: 'profile',
            user: readUser(),
            appointments: [],
            selectedId: null
          }
          const els = {
            login: document.getElementById('account-login'),
            workspace: document.getElementById('account-workspace'),
            avatar: document.getElementById('account-avatar'),
            name: document.getElementById('account-name'),
            email: document.getElementById('account-email'),
            logout: document.getElementById('account-logout'),
            title: document.getElementById('account-title'),
            feedback: document.getElementById('account-feedback'),
            profilePanel: document.getElementById('profile-panel'),
            historyPanel: document.getElementById('history-panel'),
            profileName: document.getElementById('profile-name'),
            profileEmail: document.getElementById('profile-email'),
            largeAvatar: document.getElementById('large-avatar'),
            phoneInput: document.getElementById('phone-input'),
            phoneForm: document.getElementById('phone-form'),
            historyCount: document.getElementById('history-count'),
            upcomingCount: document.getElementById('upcoming-count'),
            upcomingState: document.getElementById('upcoming-state'),
            historyItems: document.getElementById('history-items'),
            historyDetail: document.getElementById('history-detail')
          }

          function readUser() {
            try {
              return JSON.parse(localStorage.getItem(storageKey) || 'null')
            } catch {
              return null
            }
          }

          function saveUser(user) {
            state.user = user
            localStorage.setItem(storageKey, JSON.stringify(user))
          }

          function mockGoogleUser() {
            return {
              name: 'Matias Grando',
              email: 'matias.grando@gmail.com',
              picture: '',
              phone: ''
            }
          }

          function renderShell() {
            const logged = Boolean(state.user)
            els.login.hidden = logged
            els.workspace.hidden = !logged
            els.logout.hidden = !logged
            document.querySelectorAll('.account-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === state.tab))
            if (!logged) {
              els.avatar.textContent = 'G'
              els.name.textContent = 'Invitado'
              els.email.textContent = 'Inicia sesion con Google'
              return
            }
            const user = state.user
            const avatarText = initials(user.name || user.email)
            els.avatar.textContent = avatarText
            els.name.textContent = user.name
            els.email.textContent = user.email
            els.profileName.textContent = user.name
            els.profileEmail.textContent = user.email
            els.largeAvatar.textContent = avatarText
            els.phoneInput.value = user.phone || ''
            els.title.textContent = state.tab === 'profile' ? 'Perfil' : 'Historial'
            els.profilePanel.hidden = state.tab !== 'profile'
            els.historyPanel.hidden = state.tab !== 'history'
            renderHistory()
          }

          async function loadHistory() {
            if (!state.user?.phone || normalizePhone(state.user.phone).length < 8) {
              state.appointments = []
              state.selectedId = null
              renderHistory()
              if (state.tab === 'history') setFeedback('Agrega tu telefono en Perfil para cargar tus turnos.', 'info')
              return
            }
            setFeedback('Cargando tus turnos...', 'info')
            try {
              const result = await getJson('/public/booking/' + encodeURIComponent(slug) + '/history?phone=' + encodeURIComponent(state.user.phone))
              state.appointments = result.appointments || []
              state.selectedId = state.appointments[0]?.id || null
              setFeedback('', '')
              renderHistory()
            } catch (error) {
              state.appointments = []
              state.selectedId = null
              setFeedback(error.message, 'error')
              renderHistory()
            }
          }

          function renderHistory() {
            if (!state.user) return
            const now = new Date()
            const upcoming = state.appointments.filter((appointment) => new Date(appointment.startAt) >= now)
            const past = state.appointments.filter((appointment) => new Date(appointment.startAt) < now)
            els.historyCount.textContent = String(state.appointments.length)
            els.upcomingCount.textContent = String(upcoming.length)
            els.upcomingState.innerHTML = upcoming.length
              ? '<div class="appointment-stack">' + upcoming.map(renderAppointmentCard).join('') + '</div>'
              : '<div class="empty-appointments"><div class="calendar-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M4 10h16"></path></svg></div><strong>No hay proximas citas</strong><p>Tus proximos turnos apareceran aca cuando reserves.</p><a href="${escapeAttribute(bookingUrl)}">Buscar lugares</a></div>'
            els.historyItems.innerHTML = past.length
              ? '<div class="appointment-stack">' + past.map(renderAppointmentCard).join('') + '</div>'
              : '<p class="account-empty-line">Todavia no hay turnos anteriores para este telefono.</p>'
            renderDetail()
          }

          function renderAppointmentCard(appointment) {
            const active = appointment.id === state.selectedId ? ' active' : ''
            const date = formatDateTime(appointment.startAt)
            return '<button class="appointment-card' + active + '" type="button" data-appointment-id="' + escapeHtml(appointment.id) + '">' +
              '<span class="appointment-thumb">' + escapeHtml(initials(businessInitials())) + '</span>' +
              '<span class="appointment-copy"><strong>' + escapeHtml(appointment.service.name) + '</strong><small>' + escapeHtml(date.short) + '</small><small>' + escapeHtml(formatPriceLine(appointment.service.price)) + ' · ' + escapeHtml(appointment.service.duration + ' min') + '</small><em>Volver a reservar</em></span>' +
            '</button>'
          }

          function renderDetail() {
            const appointment = state.appointments.find((item) => item.id === state.selectedId)
            if (!appointment) {
              els.historyDetail.innerHTML = '<div class="detail-empty">Selecciona un turno para ver el detalle.</div>'
              return
            }
            const date = formatDateTime(appointment.startAt)
            els.historyDetail.innerHTML =
              '<div class="detail-hero"><div class="detail-logo">' + escapeHtml(businessInitials()) + '</div><strong>${escapeHtml(business.name)}</strong></div>' +
              '<span class="status-pill">' + statusLabel(appointment.status) + '</span>' +
              '<h2>' + escapeHtml(date.long) + '</h2>' +
              '<p>' + escapeHtml(appointment.service.duration + ' minutos de duracion') + '</p>' +
              '<div class="detail-actions">' +
                '<a href="${escapeAttribute(bookingUrl)}"><span class="action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M5 12h14M13 6l6 6-6 6"></path></svg></span>Volver a reservar</a>' +
                '<a href="${escapeAttribute(basePath)}"><span class="action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 21s7-6.6 7-11.5A7 7 0 0 0 5 9.5C5 14.4 12 21 12 21Z"></path><circle cx="12" cy="9.5" r="2.4"></circle></svg></span>Ver lugar</a>' +
                '<span><span class="action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 7h16M4 12h16M4 17h10"></path></svg></span>' + escapeHtml(appointment.professional.name) + '</span>' +
              '</div>'
          }

          function setFeedback(message, type) {
            els.feedback.textContent = message
            els.feedback.className = 'account-feedback' + (message ? ' visible ' + type : '')
          }

          async function getJson(url) {
            const response = await fetch(url)
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.message || 'No pude cargar la informacion')
            return body
          }

          function formatDateTime(value) {
            const date = new Date(value)
            return {
              short: new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date),
              long: new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
            }
          }

          function formatPriceLine(value) {
            return value ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value) : 'Consultar'
          }

          function statusLabel(status) {
            const labels = { CONFIRMED: 'Confirmada', PENDING: 'Pendiente', COMPLETED: 'Completada', CANCELLED: 'Cancelada', NO_SHOW: 'Ausente' }
            return labels[status] || status
          }

          function normalizePhone(value) {
            return String(value || '').replace(/\\D/g, '')
          }

          function businessInitials() {
            return ${JSON.stringify(initialsText)}
          }

          function initials(value) {
            return String(value || '').split(/\\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() || '').join('')
          }

          function escapeHtml(value) {
            return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
          }

          document.getElementById('google-login').addEventListener('click', () => {
            saveUser(mockGoogleUser())
            setFeedback('Google conectado. Agrega tu telefono para cargar tu historial.', 'info')
            renderShell()
          })

          els.logout.addEventListener('click', () => {
            localStorage.removeItem(storageKey)
            state.user = null
            state.appointments = []
            state.selectedId = null
            setFeedback('', '')
            renderShell()
          })

          els.phoneForm.addEventListener('submit', (event) => {
            event.preventDefault()
            const phone = els.phoneInput.value.trim()
            if (normalizePhone(phone).length < 8) {
              setFeedback('Ingresa un telefono valido para ver tus turnos.', 'error')
              return
            }
            saveUser({ ...state.user, phone })
            setFeedback('Telefono guardado. Ya podemos cargar tus turnos.', 'info')
            void loadHistory()
            renderShell()
          })

          document.querySelectorAll('.account-tab').forEach((tab) => {
            tab.addEventListener('click', () => {
              state.tab = tab.dataset.tab
              setFeedback('', '')
              renderShell()
              if (state.tab === 'history') void loadHistory()
            })
          })

          els.historyPanel.addEventListener('click', (event) => {
            const card = event.target.closest('[data-appointment-id]')
            if (!card) return
            state.selectedId = card.dataset.appointmentId
            renderHistory()
          })

          renderShell()
          if (state.user?.phone) void loadHistory()
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
    .nav-actions { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
    .btn-gold-outline, .btn-cta, .btn-light, .button { display: inline-flex; align-items: center; justify-content: center; gap: 9px; border-radius: var(--radius-full); font-weight: 700; cursor: pointer; }
    .btn-gold-outline { min-height: 44px; padding: 0 22px; color: var(--white); background: var(--burgundy); border: 1px solid var(--gold); font-size: 12.5px; letter-spacing: .6px; text-transform: uppercase; }
    .btn-gold-outline svg { width: 15px; height: 15px; }
    .btn-gold-outline:hover, .btn-cta:hover, .button.primary:hover { background: var(--burgundy-dark); }
    .btn-account {
      min-height: 42px;
      padding: 0 15px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: #F7F3EA;
      border: 1px solid rgba(201,161,59,.36);
      border-radius: var(--radius-full);
      font-size: 12.5px;
      font-weight: 800;
      letter-spacing: .5px;
      text-transform: uppercase;
    }
    .btn-account:hover { color: var(--gold-light); border-color: rgba(201,161,59,.72); }
    .btn-account svg { width: 16px; height: 16px; }

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
      padding: 34px 16px 80px;
      color: var(--ink);
      background:
        radial-gradient(circle at 16% 0%, rgba(201,161,59,.18), transparent 30%),
        linear-gradient(180deg, #16110B 0 220px, var(--cream) 220px 100%);
      font-family: var(--font-sans);
    }
    .booking-brand-rail {
      width: min(1040px, 100%);
      margin: 0 auto 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      color: var(--white);
    }
    .booking-brand {
      display: flex;
      align-items: center;
      gap: 13px;
      min-width: 0;
    }
    .booking-brand-mark {
      width: 42px;
      height: 42px;
      flex: 0 0 42px;
      display: grid;
      place-items: center;
      color: var(--gold);
      border: 1px solid var(--gold);
      border-radius: 50%;
    }
    .booking-brand-mark svg { width: 22px; height: 22px; }
    .booking-brand-name { display: grid; gap: 2px; min-width: 0; }
    .booking-brand-name strong {
      overflow: hidden;
      color: var(--white);
      font-family: var(--font-display);
      font-size: 20px;
      font-weight: 900;
      letter-spacing: .04em;
      line-height: 1;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .booking-brand-name span {
      overflow: hidden;
      color: var(--gold);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .28em;
      line-height: 1;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .booking-brand-note {
      color: #D7C7A5;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .fresha-modal {
      max-width: 1040px;
      margin: 0 auto;
      overflow: hidden;
      background: var(--cream-card);
      border: 1px solid rgba(201,161,59,.35);
      border-radius: 16px;
      box-shadow: 0 24px 60px rgba(22,15,8,.22);
    }
    .fresha-header {
      min-height: 82px;
      padding: 22px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      color: var(--white);
      background:
        linear-gradient(90deg, rgba(21,17,11,.98), rgba(33,25,15,.96)),
        repeating-linear-gradient(45deg, #20170E 0 2px, #17110B 2px 4px);
      border-bottom: 1px solid rgba(201,161,59,.28);
    }
    .booking-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .fresha-icon-btn {
      width: 38px;
      height: 38px;
      flex: 0 0 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--gold);
      background: rgba(255,255,255,.035);
      border: 1px solid rgba(201,161,59,.38);
      border-radius: 50%;
      cursor: pointer;
    }
    .fresha-icon-btn:hover { background: rgba(201,161,59,.1); border-color: rgba(201,161,59,.7); }
    .fresha-icon-btn:disabled { opacity: .35; cursor: not-allowed; }
    .fresha-icon-btn svg { width: 16px; height: 16px; }
    .fresha-breadcrumb {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      flex-wrap: wrap;
      color: #9B8D74;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .crumb {
      padding: 0;
      color: inherit;
      background: transparent;
      border: 0;
      font: inherit;
    }
    .crumb.active { color: var(--gold); font-weight: 900; }
    .crumb.done { color: #E7DCC6; cursor: pointer; }
    .crumb.done:hover { color: var(--gold); }
    .crumb:disabled { cursor: default; }
    .crumb-sep { color: rgba(201,161,59,.32); }
    .fresha-body {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
      align-items: start;
    }
    .fresha-main {
      min-height: 540px;
      padding: 36px 40px 48px;
      background: linear-gradient(180deg, rgba(255,255,255,.52), rgba(255,255,255,.22)), var(--cream-card);
      border-right: 1px solid var(--cream-line);
    }
    .fresha-heading {
      margin: 0 0 28px;
      color: var(--dark-1);
      font-family: var(--font-display);
      font-size: 34px;
      font-weight: 900;
      line-height: 1.05;
      letter-spacing: .02em;
    }
    .fresha-heading::after {
      content: "";
      display: block;
      width: 72px;
      height: 1px;
      margin-top: 14px;
      background: var(--gold);
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
      color: var(--ink);
      background: #FFFAF0;
      border: 1px solid var(--cream-line);
      border-radius: 8px;
      text-align: left;
      cursor: pointer;
      transition: border-color .15s ease, background .15s ease;
    }
    .fresha-option:hover { border-color: rgba(201,161,59,.72); }
    .fresha-option.selected {
      background: #FFF3D8;
      border-color: var(--gold);
      box-shadow: inset 0 0 0 1px rgba(201,161,59,.38);
    }
    .option-left {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .option-left > span:last-child {
      min-width: 0;
      line-height: 1.35;
    }
    .option-left strong {
      display: inline-block;
      color: var(--dark-1);
      font-size: 15px;
      font-weight: 900;
    }
    .option-left small,
    .option-right span {
      display: inline-block;
      margin-top: 3px;
      margin-left: 8px;
      color: var(--ink-soft);
      font-size: 13px;
    }
    .option-right {
      flex: 0 0 auto;
      display: grid;
      justify-items: end;
      gap: 3px;
      color: var(--ink);
      font-size: 14px;
    }
    .option-right strong {
      color: var(--burgundy);
      font-size: 15px;
      font-weight: 900;
    }
    .radio {
      width: 20px;
      height: 20px;
      flex: 0 0 20px;
      position: relative;
      border: 1.5px solid #CFC0A2;
      border-radius: 50%;
    }
    .fresha-option.selected .radio { border-color: var(--burgundy); }
    .fresha-option.selected .radio::after {
      content: "";
      position: absolute;
      inset: 4px;
      background: var(--burgundy);
      border-radius: 50%;
    }
    .avatar {
      width: 42px;
      height: 42px;
      flex: 0 0 42px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--gold);
      background: var(--dark-1);
      border: 1px solid rgba(201,161,59,.48);
      border-radius: 50%;
      font-size: 13px;
      font-weight: 900;
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
      color: var(--gold);
      background: var(--dark-1);
      border: 1px solid rgba(201,161,59,.46);
      border-radius: 999px;
      font-size: 13px;
      font-weight: 900;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .section-label {
      margin: 0 0 14px;
      color: var(--dark-1);
      font-family: var(--font-display);
      font-size: 16px;
      font-weight: 900;
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
      color: var(--ink);
      background: #FFFAF0;
      border: 1px solid var(--cream-line);
      border-radius: 8px;
      text-align: center;
      cursor: pointer;
    }
    .date-chip span,
    .date-chip small {
      display: block;
      color: var(--ink-soft);
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
      color: #FFF8E9;
      background: var(--burgundy);
      border-color: var(--burgundy);
    }
    .date-chip.selected span,
    .date-chip.selected small { color: #FFF8E9; }
    .slots {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .slot {
      min-height: 54px;
      padding: 0 18px;
      color: var(--dark-1);
      background: #FFFAF0;
      border: 1px solid var(--cream-line);
      border-radius: 8px;
      font-size: 15px;
      font-weight: 900;
      text-align: left;
      cursor: pointer;
    }
    .slot:hover { border-color: rgba(201,161,59,.72); }
    .slot.selected {
      color: var(--dark-1);
      background: #EDCF7D;
      border-color: var(--gold);
    }
    .fresha-summary {
      padding: 32px 28px;
      color: var(--white);
      background:
        radial-gradient(circle at 20% 0%, rgba(201,161,59,.16), transparent 34%),
        linear-gradient(180deg, var(--dark-2), var(--dark-1));
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
      color: var(--gold);
      background: #0F0B07;
      border: 1px solid rgba(201,161,59,.56);
      border-radius: 50%;
      font-size: 14px;
      font-family: var(--font-display);
      font-weight: 900;
    }
    .summary-name {
      margin-bottom: 3px;
      color: #FFF8E9;
      font-family: var(--font-display);
      font-size: 18px;
      font-weight: 900;
      line-height: 1.05;
      text-transform: uppercase;
    }
    .summary-rating {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-bottom: 3px;
      color: var(--gold);
      font-size: 13px;
      font-weight: 800;
    }
    .summary-rating svg {
      width: 13px;
      height: 13px;
    }
    .summary-rating span,
    .summary-address {
      color: #C8B891;
      font-weight: 500;
    }
    .summary-address {
      font-size: 12.5px;
      line-height: 1.4;
    }
    .summary-divider {
      border: 0;
      border-top: 1px solid rgba(201,161,59,.24);
      margin: 20px 0;
    }
    .summary-empty {
      color: #B7A98D;
      font-size: 13.5px;
      font-style: italic;
      line-height: 1.5;
    }
    .summary-card-line {
      padding: 14px 0;
      display: flex;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 1px solid rgba(201,161,59,.2);
    }
    .summary-card-line:last-child { border-bottom: 0; }
    .summary-card-line span {
      display: block;
      color: #B7A98D;
      font-size: 12.5px;
      line-height: 1.35;
    }
    .summary-card-line strong,
    .summary-card-line b {
      color: #FFF8E9;
      font-size: 14.5px;
      font-weight: 900;
      text-align: right;
    }
    .primary-line {
      padding: 16px;
      margin-bottom: 8px;
      background: rgba(255,255,255,.045);
      border: 1px solid rgba(201,161,59,.28);
      border-radius: 10px;
    }
    .primary-line strong,
    .primary-line b {
      text-align: left;
      font-size: 15px;
    }
    .primary-line strong,
    .primary-line b { color: var(--gold); }
    .summary-total {
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #FFF8E9;
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
      color: #8F8165;
      background: rgba(255,255,255,.06);
      border: 1px solid rgba(201,161,59,.18);
      border-radius: 999px;
      font-size: 15px;
      font-weight: 900;
      letter-spacing: .08em;
      text-transform: uppercase;
      cursor: not-allowed;
    }
    .fresha-continue.enabled {
      color: #FFF8E9;
      background: linear-gradient(180deg, var(--burgundy), var(--burgundy-dark));
      border-color: var(--gold);
      cursor: pointer;
    }
    .fresha-continue.enabled:hover { background: var(--burgundy-dark); }
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
      color: var(--ink-soft);
      font-size: 14px;
      line-height: 1.55;
    }
    .confirm-note {
      max-width: 440px;
      color: var(--ink-soft);
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
      color: #FFF8E9;
      background: var(--burgundy);
      border: 1px solid var(--gold);
      border-radius: 50%;
    }
    .success-check svg {
      width: 27px;
      height: 27px;
    }
    .booking-success h2 {
      margin: 0 0 8px;
      color: var(--dark-1);
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 900;
    }
    .booking-success p {
      max-width: 420px;
      margin: 0 auto;
      color: var(--ink-soft);
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
      color: #FFF8E9;
      background: linear-gradient(180deg, var(--burgundy), var(--burgundy-dark));
      border: 1px solid var(--gold);
      border-radius: 999px;
      font-size: 13px;
      font-weight: 900;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .account-page {
      min-height: 100vh;
      background: #F7F7FA;
      color: #17171B;
      font-family: "Montserrat", system-ui, sans-serif;
    }
    .account-topbar {
      height: 74px;
      padding: 0 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      background: #FFFFFF;
      border-bottom: 1px solid #E9E8EE;
      box-shadow: 0 1px 14px rgba(20,16,40,.04);
    }
    .account-brand {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .account-brand-mark {
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      color: #FFFFFF;
      background: #17171B;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 900;
    }
    .account-brand strong,
    .account-brand small {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .account-brand strong { font-size: 15px; font-weight: 900; }
    .account-brand small { margin-top: 2px; color: #777783; font-size: 12px; font-weight: 700; }
    .account-book {
      min-height: 42px;
      padding: 0 18px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #FFFFFF;
      background: #17171B;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 900;
    }
    .account-book svg { width: 16px; height: 16px; }
    .account-shell {
      min-height: calc(100vh - 74px);
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
    }
    .account-sidebar {
      padding: 28px 18px;
      background: #FFFFFF;
      border-right: 1px solid #E9E8EE;
    }
    .account-user {
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .account-avatar,
    .large-avatar {
      display: grid;
      place-items: center;
      color: #FFFFFF;
      background: linear-gradient(135deg, #17171B, #5B34EA);
      font-weight: 900;
      overflow: hidden;
    }
    .account-avatar {
      width: 44px;
      height: 44px;
      flex: 0 0 44px;
      border-radius: 50%;
      font-size: 14px;
    }
    .account-user strong,
    .account-user small {
      display: block;
      max-width: 178px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .account-user strong { font-size: 15px; font-weight: 900; }
    .account-user small { margin-top: 4px; color: #747480; font-size: 12px; }
    .account-tabs {
      display: grid;
      gap: 8px;
    }
    .account-tab,
    .account-logout {
      min-height: 48px;
      padding: 0 14px;
      display: flex;
      align-items: center;
      gap: 12px;
      color: #17171B;
      background: transparent;
      border: 0;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 800;
      text-align: left;
      cursor: pointer;
    }
    .account-tab svg { width: 19px; height: 19px; flex: 0 0 19px; }
    .account-tab.active {
      color: #5B34EA;
      background: #F0ECFF;
    }
    .account-logout {
      width: 100%;
      margin-top: 22px;
      color: #B42318;
      border-top: 1px solid #EFEFF3;
      border-radius: 0;
    }
    .account-main {
      min-width: 0;
      padding: 46px;
    }
    .account-login {
      max-width: 480px;
      margin: 72px auto;
      padding: 42px;
      background: #FFFFFF;
      border: 1px solid #E9E8EE;
      border-radius: 18px;
      box-shadow: 0 20px 50px rgba(20,16,40,.08);
      text-align: center;
    }
    .google-orb {
      width: 58px;
      height: 58px;
      margin: 0 auto 18px;
      display: grid;
      place-items: center;
      color: #FFFFFF;
      background: #17171B;
      border-radius: 50%;
      font-size: 24px;
      font-weight: 900;
    }
    .account-login h1,
    .account-section-head h1 {
      margin: 0;
      color: #17171B;
      font-family: "Montserrat", system-ui, sans-serif;
      font-weight: 900;
      letter-spacing: 0;
    }
    .account-login h1 { font-size: 30px; }
    .account-login p {
      margin: 12px 0 24px;
      color: #6F6F7A;
      font-size: 14px;
    }
    .google-button {
      width: 100%;
      min-height: 52px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: #17171B;
      background: #FFFFFF;
      border: 1px solid #DBDAE2;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 900;
      cursor: pointer;
    }
    .google-button:hover { background: #F7F7FA; }
    .google-button svg { width: 21px; height: 21px; }
    .account-section-head {
      margin-bottom: 20px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
    }
    .account-kicker {
      display: block;
      margin-bottom: 6px;
      color: #5B34EA;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .account-section-head h1 { font-size: 32px; }
    .account-status {
      padding: 8px 12px;
      color: #188038;
      background: #EAF7EE;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 900;
      white-space: nowrap;
    }
    .account-feedback {
      display: none;
      margin-bottom: 18px;
      padding: 13px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.45;
    }
    .account-feedback.visible { display: block; }
    .account-feedback.info {
      color: #1D4ED8;
      background: #EFF6FF;
      border: 1px solid #BFDBFE;
    }
    .account-feedback.error {
      color: #B42318;
      background: #FFF1F2;
      border: 1px solid #FECACA;
    }
    .account-panel,
    .history-detail,
    .empty-appointments {
      background: #FFFFFF;
      border: 1px solid #E9E8EE;
      border-radius: 16px;
      box-shadow: 0 12px 34px rgba(20,16,40,.05);
    }
    .account-panel { padding: 28px; }
    .profile-grid {
      display: grid;
      grid-template-columns: minmax(0, .9fr) minmax(280px, 1.1fr);
      gap: 28px;
      align-items: center;
    }
    .google-profile {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .large-avatar {
      width: 74px;
      height: 74px;
      flex: 0 0 74px;
      border-radius: 20px;
      font-size: 24px;
    }
    .google-profile h2 {
      margin: 0 0 6px;
      color: #17171B;
      font-size: 21px;
      font-weight: 900;
      line-height: 1.15;
    }
    .google-profile p {
      color: #747480;
      font-size: 14px;
    }
    .phone-form label {
      display: block;
      margin-bottom: 8px;
      color: #17171B;
      font-size: 13px;
      font-weight: 900;
    }
    .phone-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
    }
    .phone-row input {
      min-width: 0;
      height: 48px;
      padding: 0 14px;
      color: #17171B;
      background: #FFFFFF;
      border: 1px solid #DBDAE2;
      border-radius: 12px;
      outline: none;
    }
    .phone-row input:focus {
      border-color: #5B34EA;
      box-shadow: 0 0 0 3px rgba(91,52,234,.12);
    }
    .save-phone {
      min-height: 48px;
      padding: 0 18px;
      color: #FFFFFF;
      background: #17171B;
      border: 0;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 900;
      cursor: pointer;
    }
    .phone-form small {
      display: block;
      margin-top: 9px;
      color: #747480;
      font-size: 12.5px;
      line-height: 1.45;
    }
    .history-layout {
      display: grid;
      grid-template-columns: minmax(310px, 420px) minmax(0, 1fr);
      gap: 28px;
      align-items: start;
    }
    .history-list h2 {
      margin: 22px 0 14px;
      color: #17171B;
      font-size: 20px;
      font-weight: 900;
    }
    .history-list h2 span,
    .history-chip span {
      display: inline-grid;
      place-items: center;
      min-width: 20px;
      height: 20px;
      margin-left: 6px;
      color: #6F6F7A;
      background: #F0F0F4;
      border-radius: 50%;
      font-size: 12px;
      font-weight: 900;
    }
    .history-filter {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
    }
    .history-chip {
      min-height: 38px;
      padding: 0 16px;
      color: #17171B;
      background: #FFFFFF;
      border: 1px solid #DBDAE2;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 900;
    }
    .history-chip.active {
      color: #FFFFFF;
      background: #17171B;
      border-color: #17171B;
    }
    .history-chip.active span {
      color: #17171B;
      background: #FFFFFF;
    }
    .appointment-stack {
      display: grid;
      gap: 12px;
    }
    .appointment-card {
      width: 100%;
      min-height: 96px;
      padding: 10px;
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr);
      gap: 12px;
      color: #17171B;
      background: #FFFFFF;
      border: 1px solid #E0DFE7;
      border-radius: 14px;
      text-align: left;
      cursor: pointer;
    }
    .appointment-card.active {
      border-color: #6C4DFF;
      box-shadow: 0 0 0 1px #6C4DFF;
    }
    .appointment-thumb {
      min-height: 76px;
      display: grid;
      place-items: center;
      color: #FFFFFF;
      background: linear-gradient(135deg, #B9B9C1, #17171B);
      border-radius: 10px;
      font-size: 19px;
      font-weight: 900;
      letter-spacing: .04em;
    }
    .appointment-copy {
      min-width: 0;
      display: grid;
      align-content: center;
      gap: 3px;
    }
    .appointment-copy strong,
    .appointment-copy small,
    .appointment-copy em {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .appointment-copy strong { font-size: 14px; font-weight: 900; }
    .appointment-copy small { color: #6F6F7A; font-size: 12px; font-style: normal; }
    .appointment-copy em { color: #5B34EA; font-size: 12.5px; font-style: normal; font-weight: 800; }
    .empty-appointments {
      min-height: 230px;
      padding: 28px 22px;
      display: grid;
      justify-items: center;
      align-content: center;
      text-align: center;
    }
    .calendar-empty {
      width: 54px;
      height: 54px;
      margin-bottom: 14px;
      display: grid;
      place-items: center;
      color: #6C4DFF;
      background: #F0ECFF;
      border-radius: 15px;
    }
    .calendar-empty svg { width: 26px; height: 26px; }
    .empty-appointments strong {
      color: #17171B;
      font-size: 18px;
      font-weight: 900;
    }
    .empty-appointments p {
      max-width: 260px;
      margin: 8px 0 18px;
      color: #747480;
      font-size: 13px;
      line-height: 1.45;
    }
    .empty-appointments a {
      min-height: 38px;
      padding: 0 16px;
      display: inline-flex;
      align-items: center;
      color: #17171B;
      border: 1px solid #DBDAE2;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 900;
    }
    .account-empty-line {
      color: #747480;
      font-size: 14px;
    }
    .history-detail {
      min-height: 580px;
      overflow: hidden;
    }
    .detail-hero {
      min-height: 220px;
      padding: 28px;
      display: flex;
      align-items: flex-end;
      gap: 16px;
      color: #FFFFFF;
      background: linear-gradient(135deg, #B7B7BE, #17171B);
    }
    .detail-logo {
      width: 82px;
      height: 82px;
      display: grid;
      place-items: center;
      background: rgba(255,255,255,.16);
      border: 1px solid rgba(255,255,255,.24);
      border-radius: 18px;
      font-size: 24px;
      font-weight: 900;
    }
    .detail-hero strong {
      min-width: 0;
      font-size: 28px;
      font-weight: 900;
      line-height: 1.05;
    }
    .status-pill {
      width: fit-content;
      margin: 24px 32px 14px;
      padding: 8px 13px;
      display: inline-flex;
      color: #FFFFFF;
      background: #6C4DFF;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 900;
    }
    .history-detail h2 {
      margin: 0 32px 8px;
      color: #17171B;
      font-size: 27px;
      font-weight: 900;
      line-height: 1.15;
    }
    .history-detail p {
      margin: 0 32px 22px;
      color: #6F6F7A;
      font-size: 14px;
    }
    .detail-actions {
      margin: 0 32px 28px;
      display: grid;
      border-top: 1px solid #EFEFF3;
    }
    .detail-actions a,
    .detail-actions span {
      min-height: 58px;
      display: flex;
      align-items: center;
      gap: 12px;
      color: #17171B;
      border-bottom: 1px solid #EFEFF3;
      font-size: 14px;
      font-weight: 800;
    }
    .action-icon {
      width: 36px;
      height: 36px;
      display: grid;
      place-items: center;
      color: #5B34EA;
      background: #F0ECFF;
      border: 0;
      border-radius: 50%;
    }
    .action-icon svg { width: 18px; height: 18px; }
    .detail-empty {
      min-height: 560px;
      display: grid;
      place-items: center;
      padding: 28px;
      color: #747480;
      text-align: center;
    }

    @media (max-width: 820px) {
      .fresha-booking { padding: 18px 12px 48px; }
      .booking-brand-rail { align-items: flex-start; flex-direction: column; }
      .booking-brand-note { display: none; }
      .fresha-body { grid-template-columns: 1fr; }
      .fresha-main {
        min-height: 0;
        padding: 28px 22px 36px;
        border-right: 0;
        border-bottom: 1px solid var(--cream-line);
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

    @media (max-width: 980px) {
      .account-shell { grid-template-columns: 1fr; }
      .account-sidebar {
        padding: 18px;
        border-right: 0;
        border-bottom: 1px solid #E9E8EE;
      }
      .account-tabs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .account-main { padding: 28px 18px; }
      .history-layout { grid-template-columns: 1fr; }
      .history-detail { min-height: 0; }
    }

    @media (max-width: 680px) {
      .account-topbar { height: auto; min-height: 68px; padding: 12px 16px; }
      .account-brand small { display: none; }
      .account-book { padding: 0 14px; }
      .account-login { margin: 26px auto; padding: 28px 20px; }
      .account-section-head { align-items: flex-start; flex-direction: column; }
      .profile-grid { grid-template-columns: 1fr; }
      .phone-row { grid-template-columns: 1fr; }
      .appointment-card { grid-template-columns: 74px minmax(0, 1fr); }
      .appointment-thumb { min-height: 72px; }
      .detail-hero { min-height: 180px; padding: 22px; }
      .detail-hero strong { font-size: 23px; }
      .status-pill,
      .history-detail h2,
      .history-detail p,
      .detail-actions { margin-left: 22px; margin-right: 22px; }
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
      .nav-actions { gap: 6px; }
      .btn-account { width: 38px; min-height: 38px; padding: 0; }
      .btn-account span { display: none; }
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
