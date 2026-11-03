/**
 * LA COCHERA - BARBERÍA EN VILLA URQUIZA
 * Main Interactive Application Script
 */

document.addEventListener('DOMContentLoaded', () => {
  initHeroReveal();
  initNavbarScroll();
  initMobileMenu();
  initScrollReveal();
  initStatsCounter();
  initReviewsMarquee();
  initServicesLookbook();
  initExperienceScrollHighlight();
  initHeroParallax();
  initServiceModal();
});

/* ==========================================================================
   0. Hero Text Reveal Animation (mdx.so / award-winning studio signature)
   ========================================================================== */
function initHeroReveal() {
  const heroSection = document.getElementById('hero');
  const heroContent = document.querySelector('.hero-content');
  const heroHeadline = document.querySelector('.hero-headline');

  if (!heroHeadline) return;

  const triggerReveal = () => {
    heroSection?.classList.add('revealed');
    heroContent?.classList.add('revealed');
    heroHeadline?.classList.add('revealed');
  };

  // Trigger reveal smoothly upon initial frame
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    requestAnimationFrame(() => setTimeout(triggerReveal, 100));
  } else {
    window.addEventListener('load', () => {
      requestAnimationFrame(() => setTimeout(triggerReveal, 100));
    });
  }
}

/* ==========================================================================
   1. Dynamic Navbar on Scroll
   ========================================================================== */
function initNavbarScroll() {
  const headerWrapper = document.getElementById('headerWrapper');
  if (!headerWrapper) return;

  const handleScroll = () => {
    if (window.scrollY > 40) {
      headerWrapper.classList.add('scrolled');
    } else {
      headerWrapper.classList.remove('scrolled');
    }
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();
}

/* ==========================================================================
   2. Mobile Menu Toggle
   ========================================================================== */
function initMobileMenu() {
  const toggleBtn = document.getElementById('mobileToggle');
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileLinks = document.querySelectorAll('.mobile-link');

  if (!toggleBtn || !mobileMenu) return;

  const setOpen = open => {
    mobileMenu.classList.toggle('active', open);
    mobileMenu.inert = !open;
    toggleBtn.setAttribute('aria-expanded', String(open));
    toggleBtn.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  };
  toggleBtn.addEventListener('click', () => setOpen(!mobileMenu.classList.contains('active')));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobileMenu.classList.contains('active')) {
      setOpen(false);
      toggleBtn.focus();
    }
  });

  mobileLinks.forEach(link => {
    link.addEventListener('click', () => {
      setOpen(false);
    });
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!mobileMenu.contains(e.target) && !toggleBtn.contains(e.target)) {
      setOpen(false);
    }
  });
}

/* ==========================================================================
   3. Scroll Reveal Observer
   ========================================================================== */
function initScrollReveal() {
  const reveals = document.querySelectorAll('.reveal');
  if (!reveals.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
      }
    });
  }, {
    threshold: 0.15,
    rootMargin: '0px 0px -40px 0px'
  });

  reveals.forEach(el => observer.observe(el));
}

/* ==========================================================================
   4. Stats Animated Counter
   ========================================================================== */
function initStatsCounter() {
  const statNumbers = document.querySelectorAll('.stat-number');
  if (!statNumbers.length) return;

  let hasAnimated = false;

  const animateNumber = (element) => {
    const target = parseFloat(element.getAttribute('data-target'));
    const decimals = parseInt(element.getAttribute('data-decimals') || '0', 10);
    const duration = 1800; // ms
    const startTime = performance.now();

    const updateCounter = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing: easeOutExpo
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const currentVal = target * easeProgress;

      element.textContent = decimals > 0 ? currentVal.toFixed(decimals) : Math.floor(currentVal);

      if (progress < 1) {
        requestAnimationFrame(updateCounter);
      } else {
        element.textContent = decimals > 0 ? target.toFixed(decimals) : target;
      }
    };

    requestAnimationFrame(updateCounter);
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !hasAnimated) {
        hasAnimated = true;
        statNumbers.forEach(num => animateNumber(num));
      }
    });
  }, {
    threshold: 0.3
  });

  const statsSection = document.querySelector('.stats-section');
  if (statsSection) {
    observer.observe(statsSection);
  }
}

/* ==========================================================================
   4B. Infinite Reviews Marquee
   ========================================================================== */
function initReviewsMarquee() {
  const track = document.getElementById('reviewsTrack');
  if (!track) return;

  const source = document.getElementById('googleReviews');
  if (!source) return;
  const { reviews } = JSON.parse(source.textContent);
  if (!Array.isArray(reviews) || !reviews.length) return;

  const initialsFromName = (name) => name.split(' ').slice(0, 2).map(part => part[0]).join('').toUpperCase();

  const htmlText = value => [...value].map(char => /[&<>"']/.test(char) || char.codePointAt(0) > 127 ? '&#' + char.codePointAt(0) + ';' : char).join('');
  const createCard = (review) => {
    const article = document.createElement('article');
    article.className = 'review-card';
    article.innerHTML = `
      <div>
        <div class="review-header">
          <div class="reviewer-info">
            <div class="reviewer-avatar">${htmlText(initialsFromName(review.author))}</div>
            <div>
              <h4 class="reviewer-name">${htmlText(review.author)}</h4>
              <span class="reviewer-meta">${htmlText(review.dateLabel)}</span>
            </div>
          </div>
          <span class="review-stars" aria-label="${review.rating} de 5 estrellas">${Array.from({length:5},(_,i)=>i<review.rating?'&#9733;':'&#9734;').join('')}</span>
        </div>
        <p class="review-quote">&ldquo;${htmlText(review.excerpt)}&rdquo;</p>
      </div>
      <div class="review-footer">
        <span class="review-google-icon">G</span>
        <a href="${htmlText(review.source)}" target="_blank" rel="noopener noreferrer">Ver opini&oacute;n en Google &#8599;</a>
      </div>
    `;
    return article;
  };

  const groupA = document.createElement('div');
  groupA.className = 'reviews-marquee-group';
  reviews.forEach(review => groupA.appendChild(createCard(review)));

  const groupB = groupA.cloneNode(true);
  groupB.setAttribute('aria-hidden', 'true');
  groupB.setAttribute('inert', '');

  track.replaceChildren(groupA, groupB);

  const updateMarquee = () => {
    const gap = parseFloat(getComputedStyle(track).getPropertyValue('--reviews-gap')) || 24;
    const distance = groupA.getBoundingClientRect().width + gap;
    track.style.setProperty('--loop-distance', `${distance}px`);
    const seconds = Math.max(62, reviews.length * 4.2);
    track.style.setProperty('--reviews-duration', `${seconds}s`);
  };

  updateMarquee();
  window.addEventListener('resize', updateMarquee, { passive: true });
}

/* ==========================================================================
   5. Interactive Lookbook for Services (Minimalist GSAP transitions)
   ========================================================================== */
function initServicesLookbook() {
  const section = document.getElementById('servicios');
  if (!section) return;

  // The image for Corte + Barba is replaceable by swapping corte-barba.png.
  // Last two service names no longer claim a haircut is included.
  const services = [
    { name: 'Corte', tagline: 'LIMPIO, MODERNO Y NATURAL', description: 'Un corte a tu medida, con un acabado que va con vos.', duration:'30 min', price:'$ 25.000', images:['assets/servicios/corte-principal-v13.webp','assets/servicios/corte-secundario-v13.webp'] },
    { name: 'Corte + Barba', tagline: 'EL LOOK COMPLETO', description: 'Corte y perfilado de barba en una misma sesión.', duration:'30 min', price:'$ 30.000', images:['assets/servicios/corte-barba-v13.webp'] },
    { name: 'Barba', tagline: 'LOS DETALLES HACEN LA DIFERENCIA', description: 'Perfilado preciso y terminación cuidada.', duration:'30 min', price:'$ 18.000', images:['assets/servicios/barba-v13.webp'] },
    { name: 'Color Global', tagline: 'UN COLOR, OTRA ACTITUD', description: 'Color uniforme y personalidad en cada tono.', duration:'180 min', price:'$ 90.000', images:['assets/servicios/color-global-v13.webp','assets/servicios/color-global-secundario-v13.webp'] },
    { name: 'Reflejos', tagline: 'CONTRASTE Y TEXTURA', description: 'Iluminación y matices para darle otra dimensión a tu pelo.', duration:'180 min', price:'$ 85.000', images:['assets/servicios/reflejos-v13.webp'] },
  ];
  const counter = document.getElementById('lbCounter');
  const title = document.getElementById('lbTitle');
  const tagline = document.getElementById('lbTagline');
  const desc = document.getElementById('lbDesc');
  const duration = document.getElementById('lbDuration');
  const price = document.getElementById('lbPrice');
  const cta = document.getElementById('lbCta');
  const layer = document.getElementById('lbModelLayer');
  const curtain = document.getElementById('lbSceneCurtain');
  const sweep = document.getElementById('lbSceneSweep');
  const tabs = Array.from(document.querySelectorAll('.lb-tab'));
  const prev = document.getElementById('lbPrevBtn');
  const next = document.getElementById('lbNextBtn');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const textParts = [title, tagline, desc, document.getElementById('lbMeta'), cta];
  let current = 0;
  let animating = false;
  let requested = null;

  let hasRendered = false;

  function render(idx) {
    const s = services[idx];
    counter.textContent = `${String(idx+1).padStart(2,'0')} / 05`;
    title.replaceChildren(document.createTextNode(s.name));
    const dot = document.createElement('span'); dot.className='gold-dot'; dot.textContent='.'; title.appendChild(dot);
    tagline.textContent = s.tagline;
    desc.textContent = s.description;
    duration.textContent = s.duration;
    price.textContent = s.price;
    cta.href = 'https://lacochera.weex.com.ar/reservar';
    layer.className = `lookbook-model-layer ${s.images.length===2?'dual-composition':'single-composition'}`;
    layer.replaceChildren(...s.images.map((src,i)=>{
      const image=document.createElement('img');
      image.src=src; image.alt=`${s.name} · vista ${i+1}`;
      image.className=`lb-model-img ${s.images.length===2?(i===0?'lb-model-primary':'lb-model-secondary'):'lb-model-single'}`;
      image.decoding='async';image.loading=hasRendered?'eager':'lazy';image.draggable=false;return image;
    }));
    hasRendered = true;
    tabs.forEach((tab,i)=>{
      const active=i===idx;tab.classList.toggle('active',active);tab.setAttribute('aria-pressed', String(active));
    });
    const activeTab=tabs[idx];
    const row=activeTab?.parentElement;
    if(row && row.scrollWidth>row.clientWidth){
      row.scrollTo({left:activeTab.offsetLeft-row.clientWidth/2+activeTab.clientWidth/2,behavior:reduced.matches?'instant':'smooth'});
    }
  }

  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function select(idx, instant=false) {
    idx=Math.max(0,Math.min(4,idx));
    if(idx===current && !animating)return;
    if(animating) {requested=idx;return;}
    if(instant || reduced.matches) {current=idx;render(idx);return;}
    animating=true;
    section.classList.add('lb-transitioning');
    const direction=idx>current?1:-1;
    // A recognizable editorial eyelid/wipe: darkening + a gold seam crosses the portrait.
    // In the middle all content is hidden; image source is then swapped.
    const vanish=[...textParts.map(el=>el.animate([
      {opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-22px)'}
    ],{duration:280,fill:'forwards',easing:'cubic-bezier(.4,0,.8,.5)'})),
      layer.animate([
        {opacity:1,transform:'translateX(0px) rotateY(0deg) scale(1)',filter:'blur(0px)'},
        {opacity:0,transform:`translateX(${-direction*55}px) rotateY(${-direction*8}deg) scale(.96)`,filter:'blur(9px)'}
      ],{duration:370,fill:'forwards',easing:'cubic-bezier(.5,0,.8,.6)'})
    ];
    const sweepAcross=sweep.animate([
      {opacity:0,transform:'translateX(-45vw)'},{opacity:1,transform:'translateX(4vw)'},
      {opacity:1,transform:'translateX(37vw)'},{opacity:0,transform:'translateX(54vw)'}
    ],{duration:960,fill:'forwards',easing:'cubic-bezier(.23,1,.32,1)'});
    curtain.animate([
      {opacity:0},{opacity:.18,offset:.48},{opacity:.18,offset:.64},{opacity:0}
    ],{duration:950,fill:'forwards',easing:'ease-in-out'});
    await wait(350);
    vanish.forEach(a=>a.cancel());
    current=idx;
    render(idx);
    // Entrance occurs from the opposite side, holding the focus before it resolves.
    const entrance=[layer.animate([
      {opacity:0,transform:`translateX(${direction*80}px) rotateY(${direction*7}deg) scale(1.055)`,filter:'blur(13px)'},
      {opacity:1,transform:'translateX(0px) rotateY(0deg) scale(1)',filter:'blur(0px)'}
    ],{duration:620,fill:'forwards',easing:'cubic-bezier(.15,.75,.22,1)'}),
      ...textParts.map((el,i)=>el.animate([
        {opacity:0,transform:'translateY(24px)'},{opacity:1,transform:'translateY(0px)'}
      ],{duration:480,delay:i*42,fill:'forwards',easing:'cubic-bezier(.15,.75,.22,1)'}))];
    await Promise.allSettled(entrance.map(a=>a.finished));
    entrance.forEach(a=>a.cancel());
    sweepAcross.cancel();curtain.getAnimations().forEach(a=>a.cancel());
    section.classList.remove('lb-transitioning');
    animating=false;
    if(requested!==null) {
      const wanted=requested; requested=null;
      if(wanted!==current)select(wanted);
    }
  }

  // Selection changes only through explicit horizontal controls, never page scrolling.
  function goTo(idx){ select((idx + services.length) % services.length); }
  tabs.forEach((tab,i)=>tab.addEventListener('click',()=>goTo(i)));
  prev?.addEventListener('click',()=>goTo(current-1));
  next?.addEventListener('click',()=>goTo(current+1));
  section.addEventListener('keydown',e=>{
    if(['ArrowLeft','ArrowRight'].includes(e.key) && !e.target.closest('a')){
      e.preventDefault();goTo(current+(e.key==='ArrowRight'?1:-1));
    }
  });
  let touchStart=null;
  layer.parentElement?.addEventListener('touchstart',e=>{
    const touch = e.touches[0];
    touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
  },{passive:true});
  layer.parentElement?.addEventListener('touchend',e=>{
    const touch = e.changedTouches[0];
    if (!touchStart || !touch) { touchStart = null; return; }
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    touchStart = null;
    // Leave diagonal and vertical gestures to the browser's native page scrolling.
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) goTo(current + (dx < 0 ? 1 : -1));
  },{passive:true});
  layer.parentElement?.addEventListener('touchcancel',()=>{ touchStart=null; },{passive:true});
  if('IntersectionObserver' in window){
    new IntersectionObserver(entries=>{document.body.classList.toggle('lb-inview',entries[0].isIntersecting);},{threshold:0}).observe(section);
  }
  render(0);

}

/* ==========================================================================
   6. Scroll Highlighting in La Experiencia Section
   ========================================================================== */
function initExperienceScrollHighlight() {
  const sentences = document.querySelectorAll('.manifesto-sentence');
  if (!sentences.length) return;

  const handleScroll = () => {
    const windowHeight = window.innerHeight;

    sentences.forEach((sentence) => {
      const rect = sentence.getBoundingClientRect();
      const triggerTop = windowHeight * 0.75;
      const triggerBottom = windowHeight * 0.25;

      if (rect.top <= triggerTop && rect.bottom >= triggerBottom) {
        sentence.classList.add('lit');
      } else if (rect.top > triggerTop) {
        sentence.classList.remove('lit');
      }
    });
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();
}

/* ==========================================================================
   7. Parallax Hero Effect
   ========================================================================== */
function initHeroParallax() {
  const heroBg = document.getElementById('heroBgOverlay');
  if (!heroBg) return;

  let ticking = false;

  const onScroll = () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        const scrolled = window.scrollY;
        if (scrolled < 900) {
          heroBg.style.transform = `scale(1.01) translateY(${scrolled * 0.12}px)`;
        }
        ticking = false;
      });
      ticking = true;
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
}

/* ==========================================================================
   8. Service Details Interactive Modal
   ========================================================================== */
const serviceData = {
  barba: {
    title: 'Barba',
    category: 'Corte · Servicio',
    duration: '30 minutos',
    price: '$ 18.000',
    team: 'Equipo La Cochera',
    description: 'Perfilado milimétrico, toalla caliente y tratamiento hidratante para barba.',
    includes: [
      'Toalla caliente aromatizada con aceites esenciales para abrir poros y relajar la piel.',
      'Afeitado a navaja tradicional con filo descartable de un solo uso.',
      'Definición de líneas en pómulos, mandíbula y cuello según la fisonomía de tu rostro.',
      'Bálsamo hidratante y aceite nutritivo para acabado suave y brillo natural.'
    ],
    waMessage: 'Hola La Cochera! Quiero reservar un turno para Barba ($ 18.000)'
  },
  corte: {
    title: 'Corte',
    category: 'Corte · Servicio',
    duration: '30 minutos',
    price: '$ 25.000',
    team: 'Equipo La Cochera',
    description: 'Asesoramiento de imagen, corte personalizado a tijera o máquina, lavado y styling final.',
    includes: [
      'Diagnóstico capilar y asesoramiento según tipo de rostro, remolinos y estilo de vida.',
      'Corte de precisión a máquina, tijera tradicional o combinación de ambas técnicas.',
      'Lavado refrescante con shampoo profesional y masaje capilar estimulante.',
      'Styling final y fijación con pomada mate o polvo de textura de calidad premium.'
    ],
    waMessage: 'Hola La Cochera! Quiero reservar un turno para Corte ($ 25.000)'
  },
  'corte-y-barba': {
    title: 'Corte y Barba',
    category: 'Corte · Servicio',
    duration: '30 minutos',
    price: '$ 30.000',
    team: 'Equipo La Cochera',
    description: 'El combo completo para renovar tu look en una sola sesión de 30 minutos.',
    includes: [
      'Corte completo de cabello personalizado a tu gusto.',
      'Afeitado y diseño de barba con toalla caliente y navaja.',
      'Lavado capilar y tratamiento de hidratación facial/barba.',
      'Peinado y fijación con productos de autor para que salgas impecable.'
    ],
    waMessage: 'Hola La Cochera! Quiero reservar el combo Corte y Barba ($ 30.000)'
  },
  global: {
    title: 'Color Global',
    category: 'Color · Servicio',
    duration: '180 minutos (3 horas)',
    price: '$ 90.000',
    team: 'Equipo La Cochera',
    description: 'Colorimetría completa y decoloración cuidada, con matización del tono.',
    includes: [
      'Diagnóstico previo de resistencia capilar y elección de tono (platinado, blanco, gris o fantasía).',
      'Decoloración técnica en etapas con plex protector para mantener la salud de la fibra.',
      'Baño de luz y neutralización matizadora para lograr el tono exacto sin reflejos indeseados.',
      'Tratamiento de nutrición profunda sellador de cutícula.',
      'Styling y cuidado final del color.'
    ],
    waMessage: 'Hola La Cochera! Quiero consultar y reservar para Global Colorimetría ($ 90.000)'
  },
  reflejos: {
    title: 'Reflejos / Mechas',
    category: 'Color · Servicio',
    duration: '180 minutos (3 horas)',
    price: '$ 85.000',
    team: 'Equipo La Cochera',
    description: 'Iluminación y mechas personalizadas para dar textura y volumen.',
    includes: [
      'Diseño personalizado de mechas o reflejos para crear contraste y dimensión en el pelo.',
      'Decoloración controlada respetando la textura natural.',
      'Matización con tonalizador para acabado ceniza, beige o miel según tu preferencia.',
      'Peinado y acabado para resaltar el color.'
    ],
    waMessage: 'Hola La Cochera! Quiero reservar para Reflejos / Mechas ($ 85.000)'
  }
};

function initServiceModal() {
  const modal = document.getElementById('serviceModal');
  const modalContent = document.getElementById('modalContent');
  const closeBtn = document.getElementById('modalCloseBtn');
  const detailButtons = document.querySelectorAll('.btn-details');

  if (!modal || !modalContent || !closeBtn) return;

  const openModal = (serviceId) => {
    const data = serviceData[serviceId];
    if (!data) return;

    const htmlText = value => [...value].map(char => /[&<>"']/.test(char) || char.charCodeAt(0) > 127 ? '&#' + char.charCodeAt(0) + ';' : char).join('');
    modalContent.innerHTML = `
      <div style="margin-bottom: 16px;">
        <span style="font-family: var(--font-display); font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--accent-dark); letter-spacing: 0.1em;">${htmlText(data.category)}</span>
        <h3 id="modalTitle" style="font-family: var(--font-display); font-size: 1.8rem; font-weight: 800; color: var(--text-main); margin-top: 4px;">${htmlText(data.title)}</h3>
      </div>

      <div style="display: flex; gap: 16px; margin-bottom: 20px; font-size: 0.85rem; color: var(--text-secondary); background: var(--bg-surface-alt); padding: 12px 16px; border-radius: var(--radius-sm);">
        <div><strong>Duraci&oacute;n:</strong> ${htmlText(data.duration)}</div>
        <div>•</div>
        <div><strong>Equipo:</strong> ${htmlText(data.team)}</div>
      </div>

      <p style="font-size: 0.95rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: 20px;">
        ${htmlText(data.description)}
      </p>

      <div style="margin-bottom: 24px;">
        <h4 style="font-family: var(--font-display); font-size: 0.9rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; color: var(--text-main);">&iquest;Qu&eacute; incluye el servicio?</h4>
        <ul style="list-style: none; display: flex; flex-direction: column; gap: 10px; padding-left: 0;">
          ${data.includes.map(item => `
            <li style="display: flex; align-items: flex-start; gap: 10px; font-size: 0.9rem; color: var(--text-secondary); line-height: 1.5;">
              <span style="color: var(--accent); font-weight: 800; font-size: 1rem; line-height: 1;">✓</span>
              <span>${htmlText(item)}</span>
            </li>
          `).join('')}
        </ul>
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 20px; border-top: 1px solid var(--border-light); margin-top: 20px;">
        <div>
          <span style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; display: block;">Precio final</span>
          <span style="font-family: var(--font-display); font-size: 1.7rem; font-weight: 800; color: var(--text-main);">${htmlText(data.price)}</span>
        </div>
        <a href="https://wa.me/5491168255414?text=${encodeURIComponent(data.waMessage)}" target="_blank" rel="noopener noreferrer" class="btn btn-accent btn-sm">
          Reservar por WhatsApp
        </a>
      </div>
    `;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  const closeModal = () => {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  };

  detailButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const serviceId = btn.getAttribute('data-service-id');
      openModal(serviceId);
    });
  });

  closeBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeModal();
    }
  });
}
