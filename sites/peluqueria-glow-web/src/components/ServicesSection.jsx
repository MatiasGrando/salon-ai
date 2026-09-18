import { openBooking } from '../data/glowBooking';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Clock, 
  ArrowRight, 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown, 
  ChevronUp, 
  Sparkles,
  Check,
  MessageCircle
} from 'lucide-react';
import { BRANCHES } from '../data/glowData';
import { CatalogBranchSelector, CatalogStatus, CatalogImage } from './BranchCatalog';

// ─── 2 BANNERS ESTRELLA EDITORIALES (ILUMINACIÓN Y CORTE HOMBRE) ───
const FEATURED_BANNERS = [
  {
    id: 'banner-iluminacion',
    serviceId: 'balayage-signature',
    name: 'Balayage & Iluminación Glow',
    badge: 'SERVICIO ESTRELLA',
    tagline: 'Luminosidad multidimensional, tonos a medida y brillo sedoso natural.',
    duration: '3h 30m',
    priceRange: 'Desde $55.000',
    image: '/banner-iluminacion.jpg',
    category: 'Color & Balayage',
    objectPosition: 'center 40%',
  },
  {
    id: 'banner-corte-hombre',
    serviceId: 'corte-masculino-fade',
    name: 'Corte Masculino & Fade Barber',
    badge: 'BARBER STUDIO',
    tagline: 'Degradé pulido a navaja, visagismo y acabado con productos premium.',
    duration: '40 min',
    priceRange: 'Desde $14.000',
    image: '/banner-corte-hombre.jpg',
    category: 'Barbería Masculina',
    objectPosition: 'center 35%',
  }
];

export default function ServicesSection({ selectedBranch, setSelectedBranch, catalog }) {
  const [activeTab, setActiveTab] = useState('all');
  const [primaryIndex, setPrimaryIndex] = useState(0);
  const [isAutoplay, setIsAutoplay] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [expandedCardId, setExpandedCardId] = useState(null);

  const sectionRef = useRef(null);
  const touchStartX = useRef(null);
  const autoplayTimer = useRef(null);

  const branch = BRANCHES[selectedBranch] || BRANCHES['urquiza'];

  // Scroll reveal observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.10 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }
    return () => observer.disconnect();
  }, []);

  const SERVICES = catalog.services;
  const CATEGORIES = [{id:'all', name:'Todos'}, ...[...new Set(SERVICES.map(s => s.category).filter(Boolean))].map(category => ({id:category, name:category}))];

  // Filter services for mini cards
  const categoryServices = activeTab === 'all'
    ? SERVICES
    : SERVICES.filter(s => s.category === activeTab);

  const initialCardsCount = 6;
  const displayedMiniCards = showAll 
    ? categoryServices 
    : categoryServices.slice(0, initialCardsCount);

  const hasMoreCards = categoryServices.length > initialCardsCount;

  // Handle category change
  const handleTabChange = (catId) => {
    setActiveTab(catId);
    setShowAll(false);
    setExpandedCardId(null);
  };

  // Toggle banners
  const toggleBanners = useCallback(() => {
    setPrimaryIndex(prev => (prev === 0 ? 1 : 0));
  }, []);

  // Autoplay 6s
  useEffect(() => {
    if (!isAutoplay) return;

    autoplayTimer.current = setInterval(() => {
      toggleBanners();
    }, 6000);

    return () => {
      if (autoplayTimer.current) clearInterval(autoplayTimer.current);
    };
  }, [isAutoplay, toggleBanners, primaryIndex]);

  const restartAutoplay = () => {
    if (autoplayTimer.current) clearInterval(autoplayTimer.current);
    setIsAutoplay(true);
  };

  // Glow booking entrance
  const handleBookService = () => openBooking(selectedBranch);

  // Toggle card expansion
  const toggleCardExpansion = (serviceId, e) => {
    e.stopPropagation();
    setExpandedCardId(prev => prev === serviceId ? null : serviceId);
  };

  // Touch Swipe for mobile banners
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(deltaX) > 40) {
      toggleBanners();
      restartAutoplay();
    }
    touchStartX.current = null;
  };

  // Determine Primary (60%) and Secondary (40%) banners
  const banner1 = FEATURED_BANNERS[primaryIndex];
  const banner2 = FEATURED_BANNERS[primaryIndex === 0 ? 1 : 0];

  // Helper para renderizar precio: "Desde" regular (400) y monto en bold (700)
  const renderPrice = (priceRange) => {
    if (!priceRange) return null;
    if (priceRange.startsWith('Desde ')) {
      const amount = priceRange.replace('Desde ', '');
      return (
        <span className="text-[13px] sm:text-[14px] leading-none">
          <span className="font-normal text-[#908c9c]">Desde </span>
          <span className="font-bold text-[#f2f0eb] tracking-tight">{amount}</span>
        </span>
      );
    }
    return <span className="font-bold text-[14px] sm:text-[15px] text-[#f2f0eb]">{priceRange}</span>;
  };

  return (
    <section 
      ref={sectionRef}
      id="servicios" 
      className="pt-16 sm:pt-24 pb-20 sm:pb-28 bg-[#08090b] relative overflow-x-clip select-none"
      style={{ scrollMarginTop: 'calc(var(--navbar-height, 80px) + 24px)' }}
    >
      {/* ─── 1. FONDO DE ESTUDIO PREMIUM ENRIQUECIDO ─── */}
      <div 
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background: [
            'radial-gradient(ellipse at 28% 30%, rgba(194, 145, 72, 0.12), transparent 40%)',
            'radial-gradient(ellipse at 82% 55%, rgba(133, 81, 48, 0.10), transparent 38%)',
            'radial-gradient(ellipse at 50% 10%, rgba(203, 162, 88, 0.08), transparent 42%)',
            'radial-gradient(ellipse at 50% 100%, rgba(184, 133, 66, 0.06), transparent 45%)',
            '#08090b'
          ].join(', ')
        }}
      />

      {/* 2. Halos desenfocados — Iluminación cálida ambiental */}
      <div 
        className="pointer-events-none absolute top-1/4 left-1/3 -translate-x-1/2 -translate-y-1/2 w-[700px] sm:w-[920px] h-[480px] rounded-full bg-[#cba258]/8 blur-[120px] z-0" 
      />
      <div 
        className="pointer-events-none absolute top-12 left-1/2 -translate-x-1/2 w-[500px] h-[260px] rounded-full bg-[#cba258]/6 blur-[90px] z-0" 
      />
      <div 
        className="pointer-events-none absolute top-1/2 left-0 -translate-x-1/3 w-[460px] h-[460px] rounded-full bg-[#8c5338]/11 blur-[110px] z-0" 
      />
      <div 
        className="pointer-events-none absolute top-2/3 right-0 translate-x-1/3 w-[460px] h-[460px] rounded-full bg-[#bf9149]/10 blur-[110px] z-0" 
      />

      {/* 3. Curvas decorativas doradas muy sutiles en los extremos */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-12">
        <svg className="absolute -left-10 top-12 w-[320px] h-[650px]" viewBox="0 0 320 650" fill="none">
          <path d="M-40 40 C 130 180, 190 360, 50 580" stroke="#cba258" strokeWidth="1.2" />
          <path d="M0 120 C 160 260, 210 440, 90 620" stroke="#cba258" strokeWidth="0.6" strokeDasharray="5 7" />
        </svg>
        <svg className="absolute -right-10 top-1/3 w-[320px] h-[650px]" viewBox="0 0 320 650" fill="none">
          <path d="M360 40 C 190 180, 130 360, 270 580" stroke="#cba258" strokeWidth="1.2" />
          <path d="M320 120 C 160 260, 110 440, 230 620" stroke="#cba258" strokeWidth="0.6" strokeDasharray="5 7" />
        </svg>
      </div>

      {/* 4. Vignette perimetral suave */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#08090b] to-transparent z-0" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#08090b] to-transparent z-0" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 sm:w-28 bg-gradient-to-r from-[#08090b] to-transparent z-0" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 sm:w-28 bg-gradient-to-l from-[#08090b] to-transparent z-0" />

      {/* ─── CONTENEDOR PRINCIPAL AMPLIADO (1360px para aprovechar los costados) ─── */}
      <div className="w-[calc(100%-32px)] sm:w-[calc(100%-56px)] max-w-[1360px] mx-auto relative z-10">
        
        {/* ─── ENTRADA ESCALONADA 1: Encabezado ─── */}
        <div 
          className="text-center max-w-2xl mx-auto mb-7 sm:mb-9 space-y-2.5 transition-all duration-700 ease-out"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
            transitionDelay: '0ms',
          }}
        >
          <div className="flex items-center justify-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#cba258]" />
            <span className="text-xs uppercase tracking-[0.25em] text-[#cba258] font-bold">
              CARTA EXCLUSIVA
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#cba258]" />
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-serif font-bold text-white tracking-tight">
            Servicios & Tratamientos Glow
          </h2>
          <p className="text-[#a09ca8] text-xs sm:text-sm max-w-lg mx-auto leading-relaxed">
            Diagnóstico previo, técnicas de autor y productos de primera línea para la sede <strong className="text-[#cba258] font-semibold">{branch.name}</strong>.
          </p>
        </div>

        {/* ─── ENTRADA ESCALONADA 2: Filtros de Categorías ─── */}
        <div 
          className="flex items-center gap-2 overflow-x-auto pb-3 mb-9 sm:mb-11 no-scrollbar scroll-smooth justify-start sm:justify-center transition-all duration-700 ease-out"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
            transitionDelay: '100ms',
          }}
        >
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => handleTabChange(cat.id)}
              className={`whitespace-nowrap px-4 sm:px-5 py-2 rounded-full text-xs font-semibold tracking-wide transition-all cursor-pointer border ${
                activeTab === cat.id
                  ? 'gold-gradient-bg text-black font-bold border-transparent shadow-lg shadow-[#cba258]/20'
                  : 'bg-[#14141c]/90 text-[#9f9ba8] hover:text-white hover:border-[#cba258]/50 border-[#272736]'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* ─── ENTRADA ESCALONADA 3: Bloque Editorial de 2 Banners Destacados ─── */}
        <div 
          className="mb-14 sm:mb-18 transition-all duration-700 ease-out"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
            transitionDelay: '200ms',
          }}
        >
          <div 
            className="relative w-full"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {/* Contenedor Flex: 60% Principal + 40% Secundario */}
            <div className="flex flex-col lg:flex-row items-stretch gap-4 sm:gap-5 lg:gap-6">
              
              {/* ── BANNER 1 (Principal: 60% del ancho) ── */}
              <div 
                className="w-full lg:w-[60%] shrink-0 relative rounded-3xl overflow-hidden h-[370px] sm:h-[400px] md:h-[420px] bg-[#12131a] border border-[#303042] shadow-[0_22px_55px_rgba(0,0,0,0.85)] group transition-all duration-500"
              >
                <img 
                  src={banner1.image} 
                  alt={banner1.name}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                  style={{ objectPosition: banner1.objectPosition }}
                />

                <div 
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: 'linear-gradient(90deg, rgba(8,9,11,0.92) 0%, rgba(8,9,11,0.72) 42%, rgba(8,9,11,0.18) 72%, rgba(8,9,11,0.02) 100%)'
                  }}
                />
                <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#08090b]/85 via-[#08090b]/40 to-transparent pointer-events-none" />

                <div className="relative z-10 h-full p-6 sm:p-8 flex flex-col justify-between">
                  <div className="flex items-center justify-between gap-3">
                    <span className="px-3 py-1 rounded-full bg-black/65 backdrop-blur-md border border-[#cba258]/70 text-[#cba258] text-[10px] sm:text-xs font-bold uppercase tracking-wider shadow-md">
                      {banner1.badge}
                    </span>
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/55 backdrop-blur-md border border-white/10 text-white/90 text-[11px] font-medium">
                      <Clock className="w-3.5 h-3.5 text-[#cba258]" />
                      <span>{banner1.duration}</span>
                    </div>
                  </div>

                  <div className="mt-auto space-y-3 pt-4">
                    <div>
                      <h3 className="text-2xl sm:text-3xl lg:text-4xl font-serif font-bold text-white tracking-wide leading-tight group-hover:text-[#cba258] transition-colors">
                        {banner1.name}
                      </h3>
                      <p className="text-xs sm:text-sm text-[#dedad4]/90 line-clamp-1 mt-1.5 max-w-lg leading-relaxed">
                        {banner1.tagline}
                      </p>
                    </div>

                    <div className="pt-2 flex items-center justify-between flex-wrap gap-4 border-t border-white/10">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-[#a09ca8] block">Inversión</span>
                        <span className="text-base sm:text-lg font-bold text-[#cba258]">
                          {banner1.priceRange}
                        </span>
                      </div>

                      <button
                        onClick={() => handleBookService(banner1)}
                        className="px-6 sm:px-8 py-3 rounded-full gold-gradient-bg text-black font-bold text-xs uppercase tracking-wider flex items-center gap-2 hover:scale-105 active:scale-95 transition-all shadow-xl cursor-pointer"
                      >
                        <span>Reservar ahora</span>
                        <ArrowRight className="w-4 h-4 text-black" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── BANNER 2 (Secundario: 40% del ancho) ── */}
              <div 
                onClick={() => { toggleBanners(); restartAutoplay(); }}
                className="hidden lg:flex w-[40%] shrink-0 relative rounded-3xl overflow-hidden h-[370px] sm:h-[400px] md:h-[420px] bg-[#12131a] border border-[#303042] shadow-[0_22px_55px_rgba(0,0,0,0.85)] group cursor-pointer hover:border-[#cba258]/60 transition-all duration-500"
              >
                <img 
                  src={banner2.image} 
                  alt={banner2.name}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                  style={{ objectPosition: banner2.objectPosition }}
                />

                <div 
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: 'linear-gradient(90deg, rgba(8,9,11,0.90) 0%, rgba(8,9,11,0.68) 46%, rgba(8,9,11,0.15) 75%, rgba(8,9,11,0.02) 100%)'
                  }}
                />
                <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#08090b]/85 via-[#08090b]/40 to-transparent pointer-events-none" />

                <div className="relative z-10 h-full p-6 sm:p-7 flex flex-col justify-between w-full">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-3 py-1 rounded-full bg-black/65 backdrop-blur-md border border-[#cba258]/50 text-[#cba258] text-[10px] font-bold uppercase tracking-wider">
                      {banner2.badge}
                    </span>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-md border border-white/10 text-white/80 text-[11px]">
                      <Clock className="w-3.5 h-3.5 text-[#cba258]" />
                      <span>{banner2.duration}</span>
                    </div>
                  </div>

                  <div className="mt-auto space-y-3 pt-4">
                    <div>
                      <h4 className="text-xl sm:text-2xl font-serif font-bold text-white tracking-wide leading-tight group-hover:text-[#cba258] transition-colors line-clamp-2">
                        {banner2.name}
                      </h4>
                      <p className="text-xs text-[#dedad4]/85 line-clamp-1 mt-1">
                        {banner2.tagline}
                      </p>
                    </div>

                    <div className="pt-2 flex items-center justify-between border-t border-white/10">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-[#a09ca8] block">Inversión</span>
                        <span className="text-sm sm:text-base font-bold text-[#cba258]">
                          {banner2.priceRange}
                        </span>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBookService(banner2);
                        }}
                        className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-[#cba258] text-white hover:text-black font-semibold text-xs transition-all flex items-center gap-1.5 cursor-pointer border border-white/20 hover:border-transparent shadow-md"
                      >
                        <span>Reservar</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Flechas de navegación */}
            <button
              onClick={() => { toggleBanners(); restartAutoplay(); }}
              className="absolute -left-3 sm:-left-5 top-1/2 -translate-y-1/2 z-30 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/80 border border-[#cba258]/60 text-[#cba258] hover:scale-110 flex items-center justify-center shadow-2xl transition-all cursor-pointer backdrop-blur-sm"
              aria-label="Alternar banner"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => { toggleBanners(); restartAutoplay(); }}
              className="absolute -right-3 sm:-right-5 top-1/2 -translate-y-1/2 z-30 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/80 border border-[#cba258]/60 text-[#cba258] hover:scale-110 flex items-center justify-center shadow-2xl transition-all cursor-pointer backdrop-blur-sm"
              aria-label="Alternar banner"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Dots indicadores inferiores */}
          <div className="flex items-center justify-center gap-2.5 mt-5 sm:mt-6">
            {FEATURED_BANNERS.map((_, i) => (
              <button
                key={i}
                onClick={() => { setPrimaryIndex(i); restartAutoplay(); }}
                className={`h-2.5 rounded-full transition-all duration-300 cursor-pointer ${
                  i === primaryIndex
                    ? 'w-8 bg-[#cba258] shadow-[0_0_10px_rgba(203,162,88,0.8)]'
                    : 'w-2.5 bg-[#2c2c3d] hover:bg-[#cba258]/60'
                }`}
                aria-label={`Ir al banner ${i + 1}`}
              />
            ))}
          </div>
        </div>

        {/* ─── 55–70px DE SEPARACIÓN VISUAL ENTRE BLOQUES ─── */}
        <div className="h-14 sm:h-16" />

        <CatalogBranchSelector selectedBranch={selectedBranch} setSelectedBranch={setSelectedBranch} label="Sede de servicios" />

        {/* ─── ENTRADA ESCALONADA 4: Grilla de Cards Cuadradas 1:1 Ampliadas (1360px max width) ─── */}
        <div className="space-y-5 sm:space-y-6">
          
          {/* Encabezado reforzado para "Todos los servicios" */}
          <div className="flex items-center justify-between border-b border-[#282838] pb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-[#1e1e2c] border border-[#cba258]/40 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-[#cba258]" />
              </div>
              <h3 className="text-sm sm:text-base font-serif font-bold uppercase tracking-[0.2em] text-[#f2f0eb]">
                TODOS LOS SERVICIOS {activeTab !== 'all' && `· ${CATEGORIES.find(c => c.id === activeTab)?.name}`}
              </h3>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#8f8b9d] font-mono tracking-wider">
                {categoryServices.length} {categoryServices.length === 1 ? 'servicio' : 'servicios'}
              </span>
            </div>
          </div>

          <CatalogStatus catalog={catalog} count={categoryServices.length} noun="servicios" />

          {/* 
            GRILLA: 3 columnas en desktop, 2 en tablet, 1 en mobile.
            Ancho ampliado (1360px container) dando ~430px a cada card.
            Foto estrictamente cuadrada 1:1 (aspect-square 145px × 145px).
          */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 items-start">
            {displayedMiniCards.map((service, index) => {
              const staggerDelay = index < 3 ? '240ms' : index < 6 ? '320ms' : '0ms';
              const isExpanded = expandedCardId === service.id;

              return (
                <div
                  key={service.id}
                  onClick={(e) => toggleCardExpansion(service.id, e)}
                  className={`rounded-2xl bg-[#121319] border transition-all duration-300 flex flex-col overflow-hidden group cursor-pointer shadow-md ${
                    isExpanded 
                      ? 'border-[#cba258] shadow-[0_12px_40px_rgba(203,162,88,0.25)] ring-1 ring-[#cba258]/50' 
                      : 'border-white/10 hover:border-[#cba258]/60 hover:-translate-y-0.5 hover:shadow-[0_12px_35px_rgba(0,0,0,0.65)]'
                  }`}
                  style={{
                    opacity: isVisible ? 1 : 0,
                    transform: isVisible ? 'translateY(0)' : 'translateY(16px)',
                    transition: 'all 500ms ease-out',
                    transitionDelay: staggerDelay,
                  }}
                >
                  {/* FILA PRINCIPAL: [ Foto 1:1 Cuadrada | Contenido Espacioso ] */}
                  <div className="flex items-stretch min-h-[145px] sm:min-h-[155px]">
                    
                    {/* ── COLUMNA 1: FOTO CUADRADA 1:1 REAL (Sin bordes inset) ── */}
                    <div className="w-[135px] sm:w-[150px] aspect-square shrink-0 relative overflow-hidden bg-black border-r border-white/10 self-stretch">
                      <CatalogImage key={service.image || service.id}
                        src={service.image}
                        alt={service.name}
                        className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-108"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/20 pointer-events-none" />
                    </div>

                    {/* ── COLUMNA 2: CONTENIDO LIMPIO Y PROTAGONISTA ── */}
                    <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col justify-between">
                      {/* Título del servicio protagonista en grande y centrado */}
                      <div className="my-auto py-1 text-center">
                        <h4 className="font-serif font-bold text-[19px] sm:text-[21px] lg:text-[22px] text-white group-hover:text-[#cba258] transition-colors leading-snug text-center mx-auto">
                          {service.name}
                        </h4>
                      </div>

                      {/* Fila inferior: Precio — Duración a la izquierda, Flecha y Detalle a la derecha */}
                      <div className="flex items-center justify-between pt-2.5 border-t border-white/5">
                        <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
                          <div>
                            {renderPrice(service.priceRange)}
                          </div>
                          <span className="text-[#656170] select-none text-xs">·</span>
                          <div className="flex items-center gap-1.5 text-[12px] sm:text-[13px] font-normal text-[#a5a1b0]">
                            <Clock className="w-3.5 h-3.5 text-[#cba258]" />
                            <span>{service.duration}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-[10px] uppercase font-semibold text-[#cba258] hidden sm:inline-block tracking-wider opacity-80 group-hover:opacity-100">
                            {isExpanded ? 'Cerrar' : 'Detalles'}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleBookService(service);
                            }}
                            className="w-[32px] h-[32px] sm:w-[36px] sm:h-[36px] rounded-full bg-[#161722] border border-[#cba258]/45 hover:border-[#cba258] hover:bg-[#cba258] hover:text-black text-[#cba258] flex items-center justify-center transition-all shadow-sm shrink-0 cursor-pointer"
                            aria-label={`Reservar ${service.name}`}
                          >
                            <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform group-hover:translate-x-0.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* ── PANEL DESPLEGABLE DE DETALLES Y PRODUCTOS (AL HACER CLIC) ── */}
                  {isExpanded && (
                    <div 
                      className="p-4 sm:p-5 bg-[#0e0f14] border-t border-[#cba258]/30 space-y-4 animate-fadeIn"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Descripción completa */}
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-[#cba258] font-bold block mb-1">
                          Sobre este servicio
                        </span>
                        <p className="text-xs sm:text-sm text-[#dedad4] leading-relaxed">
                          {service.description || 'Este servicio todavía no tiene una descripción publicada.'}
                        </p>
                      </div>

                      {/* Qué incluye / Método y productos */}
                      {service.includes && service.includes.length > 0 && (
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-[#cba258] font-bold block mb-2">
                            Método & Productos de excelencia
                          </span>
                          <div className="grid grid-cols-1 gap-1.5">
                            {service.includes.map((inc, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs text-[#b8b4c2]">
                                <Check className="w-3.5 h-3.5 text-[#cba258] shrink-0 mt-0.5" />
                                <span>{inc}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Botón CTA de Reserva online */}
                      <div className="pt-2 flex items-center justify-between gap-3">
                        <button
                          onClick={() => handleBookService(service)}
                          className="flex-1 py-2.5 px-4 rounded-full gold-gradient-bg text-black font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-md cursor-pointer"
                        >
                          <MessageCircle className="w-4 h-4 text-black" />
                          <span>Pedir turno online</span>
                        </button>
                        <button
                          onClick={(e) => toggleCardExpansion(service.id, e)}
                          className="p-2.5 rounded-full bg-[#181824] hover:bg-[#202030] text-[#a09ca8] hover:text-white transition-colors cursor-pointer border border-white/10"
                          aria-label="Cerrar detalles"
                        >
                          <ChevronUp className="w-4 h-4 text-[#cba258]" />
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              );
            })}
          </div>

          {/* ─── ENTRADA ESCALONADA 5: Botón VER MÁS / VER MENOS Dorado Relleno ─── */}
          {hasMoreCards && (
            <div className="flex justify-center pt-6">
              <button
                onClick={() => setShowAll(!showAll)}
                className="w-[170px] h-[44px] rounded-full gold-gradient-bg text-black font-semibold text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg hover:scale-105 active:scale-95 cursor-pointer hover:shadow-[0_0_20px_rgba(203,162,88,0.4)]"
              >
                <span>{showAll ? 'VER MENOS' : 'VER MÁS'}</span>
                {showAll ? (
                  <ChevronUp className="w-4 h-4 text-black" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-black" />
                )}
              </button>
            </div>
          )}

        </div>

      </div>
    </section>
  );
}
