/**
 * Natalia Baez Riquelme - Landing Page Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Video Playback Rate (70% speed) & smooth fade-in with zero flash
  const video = document.getElementById("heroVideo");
  if (video) {
    video.playbackRate = 0.7;
    const showVideo = () => video.classList.remove('opacity-0');
    if (video.readyState >= 2) {
      showVideo();
    } else {
      video.addEventListener('playing', showVideo, { once: true });
      video.addEventListener('loadeddata', showVideo, { once: true });
    }
  }

  // 2. Mobile Menu Toggle
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  const hamburgerIcon = document.getElementById('hamburgerIcon');
  const closeIcon = document.getElementById('closeIcon');

  if (mobileMenuBtn && mobileMenu) {
    mobileMenuBtn.addEventListener('click', () => {
      const isOpen = !mobileMenu.classList.contains('hidden');
      if (isOpen) {
        mobileMenu.classList.add('hidden');
        hamburgerIcon.classList.remove('hidden');
        closeIcon.classList.add('hidden');
      } else {
        mobileMenu.classList.remove('hidden');
        hamburgerIcon.classList.add('hidden');
        closeIcon.classList.remove('hidden');
      }
    });

    // Auto-close mobile menu upon clicking any navigation link
    document.querySelectorAll('.mobile-nav-link').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
        hamburgerIcon.classList.remove('hidden');
        closeIcon.classList.add('hidden');
      });
    });
  }

  // 3. Progressive Reveal Observer on Scroll
  const observerOptions = {
    root: null,
    threshold: 0.1,
    rootMargin: "0px 0px -30px 0px"
  };

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('.reveal-item, .reveal-image-box').forEach(el => {
    revealObserver.observe(el);
  });

  // 4. Therapies Data
  const therapiesData = [
    {
      id: 'masaje-descontracturante-cbd',
      badge: 'TERAPIA CORPORAL',
      category: 'corporal',
      title: 'Masaje Descontracturante con CBD & Aceites Botánicos',
      image: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1000&q=85',
      description: 'Terapia manual profunda combinada con oleato orgánico de CBD y eucalipto para disolver contracturas crónicas y tensión miofascial.',
      durationsText: '75 min / 90 min',
      checkpoints: [
        'Alivio inmediato del dolor cervical, lumbar y escapular',
        'Propiedades antiinflamatorias naturales del CBD orgánico',
        'Mejora de la movilidad articular y postura corporal'
      ],
      price: '45.000'
    },
    {
      id: 'shiatsu-somatico-nervioso',
      badge: 'MEDICINA ORIENTAL',
      category: 'shiatsu',
      title: 'Shiatsu Somático & Regulación Nerviosa',
      image: 'https://images.unsplash.com/photo-1519823551278-64ac92734fb1?auto=format&fit=crop&w=1000&q=85',
      description: 'Presión digital y estiramientos suaves sobre meridianos energéticos para liberar memoria somática y calmar el sistema nervioso.',
      durationsText: '60 min / 80 min',
      checkpoints: [
        'Regulación del eje estrés-ansiedad (nervio vago)',
        'Desbloqueo de estancamientos energéticos y emocionales',
        'Mayor sensación de ligereza y arraigo corporal'
      ],
      price: '42.000'
    }
  ];

  const gridContainer = document.getElementById('therapies-grid');

  function renderTherapies(category = 'todos') {
    if (!gridContainer) return;

    const filtered = category === 'todos' 
      ? therapiesData 
      : therapiesData.filter(t => t.category === category);

    gridContainer.innerHTML = filtered.map(t => {
      return `
        <div class="card-dark-theme rounded-3xl overflow-hidden flex flex-col justify-between p-5 sm:p-6 text-[#EFECE6]">
          <div>
            <div class="relative h-64 sm:h-72 w-full rounded-2xl overflow-hidden mb-5 group">
              <img src="${t.image}" alt="${t.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700">
              <div class="absolute inset-0 bg-gradient-to-t from-[#1B1E18]/90 via-transparent to-black/30"></div>
              
              <div class="absolute top-3 left-3 bg-[#1B1E18]/85 backdrop-blur-md text-[#D4C4AC] text-[10px] font-bold tracking-wider px-3.5 py-1.5 rounded-full uppercase border border-[#3D4534]">
                ${t.badge}
              </div>

              <div class="absolute bottom-3 right-3 bg-[#1B1E18]/85 backdrop-blur-md text-stone-300 text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-1.5 border border-[#3D4534]">
                <svg class="w-3.5 h-3.5 text-[#D4C4AC]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>${t.durationsText}</span>
              </div>
            </div>

            <div class="px-1">
              <h3 class="font-serif text-2xl font-normal text-[#FAF8F4] mb-2.5 leading-snug">${t.title}</h3>
              <p class="text-xs text-stone-300 mb-5 leading-relaxed font-light">${t.description}</p>

              <div class="space-y-2 mb-6">
                ${t.checkpoints.map(c => `
                  <div class="flex items-start gap-2.5 text-xs text-stone-300">
                    <svg class="w-3.5 h-3.5 text-[#D4C4AC] flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    <span class="font-light">${c}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

          <div class="pt-4 px-1 border-t border-[#3E4735] flex items-center justify-between mt-2">
            <div>
              <span class="text-[10px] text-stone-400 uppercase tracking-wider block font-medium">INVERSIÓN</span>
              <div class="flex items-baseline gap-1.5">
                <span class="font-sans font-bold text-2xl text-[#FAF8F4] tracking-tight">$${t.price}</span>
                <span class="font-sans text-xs text-[#D4C4AC] font-semibold">ARS</span>
              </div>
            </div>

            <a href="/reservar" class="btn-sand text-xs font-bold px-5 py-2.5 rounded-full flex items-center gap-1.5 shadow-sm">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
              <span>AGENDAR</span>
            </a>
          </div>
        </div>
      `;
    }).join('');
  }

  document.querySelectorAll('.filter-pill').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const cat = tab.getAttribute('data-filter');
      renderTherapies(cat);
    });
  });

  renderTherapies('todos');
});
