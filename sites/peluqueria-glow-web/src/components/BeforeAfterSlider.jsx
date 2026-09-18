import { openBooking } from '../data/glowBooking';
import { lookSwipeDirection } from '../data/glowLooks';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  MoveHorizontal, 
  ChevronLeft, 
  ChevronRight, 
  ArrowRight, 
  Play, 
  Pause 
} from 'lucide-react';
import { BRANCHES } from '../data/glowData';

/* ─── Dataset de Trabajos ─────────────────────────────────────────── */
const ALL_LOOKS = [
  {
    id: 1,
    title: 'Corte Masculino',
    category: 'Cortes',
    type: 'image',
    hasBeforeAfter: false,
    afterImg: '/look-corte-masculino.jpg',
    thumb: '/look-corte-masculino.jpg',
    isVideo: false,
  },
  {
    id: 2,
    title: 'Balayage Natural',
    category: 'Iluminación',
    type: 'image',
    hasBeforeAfter: true,
    beforeImg: '/balayage-before-916.jpg',
    afterImg: '/balayage-after-916.jpg',
    thumb: '/look-balayage-ref.jpg',
    isVideo: true, // preparado para video con ícono de play
  },
  {
    id: 3,
    title: 'Alisado Espejo',
    category: 'Alisados',
    type: 'image',
    hasBeforeAfter: true,
    beforeImg: '/alisado-before.png',
    afterImg: '/alisado-after.png',
    thumb: '/alisado-after.png',
    isVideo: false,
  },
  {
    id: 4,
    title: 'Cobrizo Vibrante',
    category: 'Color',
    type: 'image',
    hasBeforeAfter: false,
    afterImg: '/look-cobrizo.jpg',
    thumb: '/look-cobrizo.jpg',
    isVideo: false,
  },
  {
    id: 5,
    title: 'Rubio Premium',
    category: 'Iluminación',
    type: 'image',
    hasBeforeAfter: false,
    afterImg: '/look-rubio-premium.jpg',
    thumb: '/look-rubio-premium.jpg',
    isVideo: true, // preparado para video con ícono de play
  },
  {
    id: 6,
    title: 'Morena Iluminada',
    category: 'Color',
    type: 'image',
    hasBeforeAfter: false,
    afterImg: '/look-morena-iluminada.jpg',
    thumb: '/look-morena-iluminada.jpg',
    isVideo: false,
  },
];

const FILTERS = ['Todos', 'Iluminación', 'Alisados', 'Color', 'Cortes'];

/* Función matemática para distancia circular continua sin saltos */
function getCircularDiff(target, active, total) {
  if (total <= 1) return 0;
  let diff = (target - active) % total;
  if (diff > total / 2) diff -= total;
  if (diff < -total / 2) diff += total;
  return diff;
}

/* ─── Media Before / After 9:16 ───────────────────────────────────── */
function BeforeAfterMedia({ item, onStartInteraction, onEndInteraction }) {
  const [sliderPos, setSliderPos] = useState(50);
  const containerRef = useRef(null);
  const isDragging = useRef(false);

  const updatePosition = (clientX) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setSliderPos(pct);
  };

  const handlePointerDown = (e) => {
    e.stopPropagation(); // Evita mover el carrusel
    isDragging.current = true;
    onStartInteraction?.();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
    updatePosition(e.clientX);
  };

  const handlePointerMove = (e) => {
    if (isDragging.current) {
      e.stopPropagation();
      updatePosition(e.clientX);
    }
  };

  const handlePointerUp = (e) => {
    if (isDragging.current) {
      e.stopPropagation();
      isDragging.current = false;
      onEndInteraction?.();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }
  };

  return (
    <div
      ref={containerRef}
      className="glow-looks__comparison relative w-full h-full select-none cursor-ew-resize overflow-hidden touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* DESPUÉS (Base completa) */}
      <img
        src={item.afterImg}
        alt="Después"
        className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
        draggable="false"
      />
      <div className="absolute top-3.5 right-3.5 z-20 px-2.5 py-1 rounded-full bg-black/75 backdrop-blur-md border border-emerald-500/50 text-emerald-400 text-[10px] font-bold uppercase tracking-wider pointer-events-none shadow-md">
        DESPUÉS
      </div>

      {/* ANTES (Recortado via clipPath) */}
      <div
        className="absolute inset-0 pointer-events-none select-none"
        style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
      >
        <img
          src={item.beforeImg}
          alt="Antes"
          className="w-full h-full object-cover select-none"
          draggable="false"
        />
        <div className="absolute top-3.5 left-3.5 z-20 px-2.5 py-1 rounded-full bg-black/75 backdrop-blur-md border border-white/20 text-white/90 text-[10px] font-bold uppercase tracking-wider shadow-md">
          ANTES
        </div>
      </div>

      {/* Barra divisora vertical */}
      <div
        className="absolute top-0 bottom-0 w-[2px] bg-[#cba258] shadow-[0_0_16px_rgba(203,162,88,0.95)] pointer-events-none z-10"
        style={{ left: `${sliderPos}%` }}
      >
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 rounded-full gold-gradient-bg flex items-center justify-center shadow-2xl border-2 border-white pointer-events-auto cursor-ew-resize">
          <MoveHorizontal className="w-4 h-4 text-black" />
        </div>
      </div>
    </div>
  );
}

/* ─── Componente Principal ─────────────────────────────────────────── */
export default function BeforeAfterSlider({ selectedBranch }) {
  const [activeCategory, setActiveCategory] = useState('Todos');
  const [currentIndex, setCurrentIndex] = useState(2); // Alisado Espejo al inicio
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef(null);
  const isInteractingWithSlider = useRef(false);
  const touchStart = useRef(null);
  const branch = BRANCHES[selectedBranch] || BRANCHES['urquiza'];

  // Filtrado de items
  const filteredLooks = activeCategory === 'Todos'
    ? ALL_LOOKS
    : ALL_LOOKS.filter((item) => item.category === activeCategory);

  const total = filteredLooks.length;
  const safeIndex = total > 0 ? ((currentIndex % total) + total) % total : 0;
  const activeItem = filteredLooks[safeIndex];

  // IntersectionObserver para animación sutil al hacer scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect(); // Se dispara una sola vez
        }
      },
      { threshold: 0.2 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Cambio de categoría con reseteo seguro
  const handleCategoryChange = (cat) => {
    setActiveCategory(cat);
    setCurrentIndex(0);
    setProgress(0);
  };

  // Navegación circular infinita
  const goTo = useCallback((idx) => {
    if (total === 0) return;
    const next = ((idx % total) + total) % total;
    setCurrentIndex(next);
    setProgress(0);
  }, [total]);

  // Autoplay loop de 6 segundos
  useEffect(() => {
    if (!isPlaying || total <= 1) return;

    const intervalTime = 60; // ms
    const totalDuration = 6000; // 6s
    const step = (intervalTime / totalDuration) * 100;

    const timer = setInterval(() => {
      if (isInteractingWithSlider.current) return;

      setProgress((prev) => {
        if (prev >= 100) {
          goTo(safeIndex + 1);
          return 0;
        }
        return prev + step;
      });
    }, intervalTime);

    return () => clearInterval(timer);
  }, [isPlaying, safeIndex, total, goTo]);

  // Reserva WhatsApp
  const handleBookLook = () => openBooking(selectedBranch);

  // Touch swipe en mobile
  const handleTouchStart = (e) => {
    // The comparison owns its drag, not the parent carousel swipe.
    if (e.target.closest('.glow-looks__comparison')) {
      touchStart.current = null;
      return;
    }
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const handleTouchEnd = (e) => {
    const direction = lookSwipeDirection(touchStart.current, {
      x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY,
    });
    if (direction) goTo(safeIndex + direction);
    touchStart.current = null;
  };

  return (
    <section 
      ref={sectionRef}
      id="transformaciones" 
      className="glow-looks pt-6 pb-16 sm:pt-10 sm:pb-24 bg-[#09090b] relative overflow-x-clip select-none"
      style={{ scrollMarginTop: 'calc(var(--navbar-height, 80px) + 24px)' }}
    >
      {/* Anchor alias para compatibilidad con #antes-despues */}
      <div id="antes-despues" className="absolute -top-24 pointer-events-none" />
      {/* ─── FONDO DE ESTUDIO PREMIUM: LUZ, GRADIENTES Y PROFUNDIDAD ─── */}

      {/* 1. Base carbón + gradientes radiales multicapa cálidos */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background: [
            'radial-gradient(ellipse 70% 55% at 50% 42%, rgba(191,145,73,0.13), transparent 55%)',
            'radial-gradient(ellipse 45% 50% at 12% 55%, rgba(120,74,55,0.10), transparent 52%)',
            'radial-gradient(ellipse 45% 50% at 88% 48%, rgba(183,134,70,0.09), transparent 52%)',
            'radial-gradient(ellipse 60% 40% at 50% 90%, rgba(85,25,45,0.07), transparent 55%)',
            'radial-gradient(ellipse 30% 30% at 22% 22%, rgba(160,110,60,0.06), transparent 50%)',
            'radial-gradient(ellipse 30% 30% at 78% 20%, rgba(160,110,60,0.05), transparent 50%)',
            '#09090b',
          ].join(', '),
        }}
      />

      {/* 2. Halos de luz cálidos desenfocados — 5 capas de profundidad */}
      {/* Halo central dorado — irradia desde detrás de la tarjeta principal */}
      <div
        className="pointer-events-none absolute z-0"
        style={{
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '820px', height: '520px',
          borderRadius: '50%',
          background: 'rgba(203,162,88,0.065)',
          filter: 'blur(120px)',
        }}
      />
      {/* Halo izquierdo — terracota/marrón */}
      <div
        className="pointer-events-none absolute z-0"
        style={{
          top: '40%', left: '18%',
          transform: 'translateY(-50%)',
          width: '420px', height: '480px',
          borderRadius: '50%',
          background: 'rgba(140,83,56,0.09)',
          filter: 'blur(100px)',
        }}
      />
      {/* Halo derecho — champagne/dorado */}
      <div
        className="pointer-events-none absolute z-0"
        style={{
          top: '40%', right: '18%',
          transform: 'translateY(-50%)',
          width: '420px', height: '480px',
          borderRadius: '50%',
          background: 'rgba(191,145,73,0.08)',
          filter: 'blur(100px)',
        }}
      />
      {/* Halo inferior bordó oscuro — conecta con tonos de foto */}
      <div
        className="pointer-events-none absolute z-0"
        style={{
          bottom: '4%', left: '50%',
          transform: 'translateX(-50%)',
          width: '600px', height: '260px',
          borderRadius: '50%',
          background: 'rgba(85,20,40,0.07)',
          filter: 'blur(90px)',
        }}
      />
      {/* Halo superior — luz de estudio desde arriba */}
      <div
        className="pointer-events-none absolute z-0"
        style={{
          top: '-4%', left: '50%',
          transform: 'translateX(-50%)',
          width: '480px', height: '230px',
          borderRadius: '50%',
          background: 'rgba(160,120,60,0.05)',
          filter: 'blur(80px)',
        }}
      />

      {/* 3. Destellos dorados puntuales — micro-puntos de luz */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute w-1.5 h-1.5 rounded-full bg-[#cba258]/25 blur-[3px]" style={{top:'18%',left:'8%'}} />
        <div className="absolute w-1 h-1 rounded-full bg-[#d4a85c]/20 blur-[2px]" style={{top:'72%',left:'6%'}} />
        <div className="absolute w-1.5 h-1.5 rounded-full bg-[#cba258]/20 blur-[3px]" style={{top:'14%',right:'9%'}} />
        <div className="absolute w-2 h-2 rounded-full bg-[#bf9149]/15 blur-[4px]" style={{top:'65%',right:'7%'}} />
        <div className="absolute w-1 h-1 rounded-full bg-[#cba258]/30 blur-[2px]" style={{top:'42%',left:'3%'}} />
        <div className="absolute w-1 h-1 rounded-full bg-[#cba258]/25 blur-[2px]" style={{top:'55%',right:'4%'}} />
      </div>

      {/* 4. Curvas doradas orgánicas en los extremos — muy sutiles */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <svg
          className="absolute -left-16 top-0 h-full"
          style={{width:'360px', opacity:0.13}}
          viewBox="0 0 360 900" fill="none" preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="gcL1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#cba258" stopOpacity="0"/>
              <stop offset="30%" stopColor="#cba258" stopOpacity="0.9"/>
              <stop offset="70%" stopColor="#d4a85c" stopOpacity="0.7"/>
              <stop offset="100%" stopColor="#cba258" stopOpacity="0"/>
            </linearGradient>
            <linearGradient id="gcL2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#bf9149" stopOpacity="0"/>
              <stop offset="40%" stopColor="#bf9149" stopOpacity="0.6"/>
              <stop offset="100%" stopColor="#bf9149" stopOpacity="0"/>
            </linearGradient>
          </defs>
          <path d="M-30 60 C 80 200,160 400,60 780" stroke="url(#gcL1)" strokeWidth="1.2"/>
          <path d="M30 0 C 180 180,240 420,120 900" stroke="url(#gcL2)" strokeWidth="0.8"/>
          <path d="M-70 200 C 60 350,100 500,20 850" stroke="url(#gcL1)" strokeWidth="0.5" strokeDasharray="6 8"/>
        </svg>
        <svg
          className="absolute -right-16 top-0 h-full"
          style={{width:'360px', opacity:0.12}}
          viewBox="0 0 360 900" fill="none" preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="gcR1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#cba258" stopOpacity="0"/>
              <stop offset="30%" stopColor="#cba258" stopOpacity="0.9"/>
              <stop offset="70%" stopColor="#d4a85c" stopOpacity="0.7"/>
              <stop offset="100%" stopColor="#cba258" stopOpacity="0"/>
            </linearGradient>
            <linearGradient id="gcR2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#bf9149" stopOpacity="0"/>
              <stop offset="40%" stopColor="#bf9149" stopOpacity="0.6"/>
              <stop offset="100%" stopColor="#bf9149" stopOpacity="0"/>
            </linearGradient>
          </defs>
          <path d="M390 60 C 280 200,200 400,300 780" stroke="url(#gcR1)" strokeWidth="1.2"/>
          <path d="M330 0 C 180 180,120 420,240 900" stroke="url(#gcR2)" strokeWidth="0.8"/>
          <path d="M430 200 C 300 350,260 500,340 850" stroke="url(#gcR1)" strokeWidth="0.5" strokeDasharray="6 8"/>
        </svg>
      </div>

      {/* 5. Vignette perimetral fuerte — oscurece bordes, centra el foco */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 z-0" style={{background:'linear-gradient(to bottom, #09090b, transparent)'}} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 z-0" style={{background:'linear-gradient(to top, #09090b, transparent)'}} />
      <div className="pointer-events-none absolute inset-y-0 left-0 z-0" style={{width:'clamp(60px,10vw,160px)', background:'linear-gradient(to right, #09090b, transparent)'}} />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-0" style={{width:'clamp(60px,10vw,160px)', background:'linear-gradient(to left, #09090b, transparent)'}} />

      {/* ─── CONTENIDO DE LA SECCIÓN ─── */}
      <div className="w-full max-w-[1440px] mx-auto px-4 sm:px-6 relative z-10">
        
        {/* ─── ENTRADA ESCALONADA 1: Encabezado ─── */}
        <div 
          className="glow-looks__heading relative flex flex-col items-center text-center mb-6 sm:mb-10 transition-all duration-[1400ms] ease-out"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(60px)',
            transitionDelay: '0ms',
          }}
        >
          {/* Lado izquierdo texto editorial sutil (desktop) */}
          <div className="hidden lg:block absolute left-4 top-2 text-left text-[10px] tracking-[0.25em] text-[#787484] uppercase leading-relaxed">
            <p>Pelo real.</p>
            <p>Personas reales.</p>
            <p className="text-[#cba258] font-bold">Resultados Glow.</p>
          </div>

          {/* Título central */}
          <h2 className="glow-looks__title text-3xl sm:text-5xl lg:text-6xl font-serif font-bold text-white tracking-tight">
            Tu pelo. Su mejor versión.
          </h2>

          {/* Lado derecho frase cursiva inspiracional (desktop) */}
          <div className="hidden lg:block absolute right-4 top-1 text-right">
            <p className="font-serif italic text-lg sm:text-xl text-[#cba258]">
              Más que un cambio.
            </p>
            <p className="font-serif italic text-base text-[#dedad4]">
              Es vos.
            </p>
          </div>

          {/* ─── ENTRADA ESCALONADA 2: Filtros de Categorías ─── */}
          <div 
            className="glow-looks__filters flex items-center gap-2 justify-center flex-wrap mt-5 transition-all duration-[1400ms] ease-out"
            style={{
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? 'translateY(0)' : 'translateY(50px)',
              transitionDelay: '300ms',
            }}
          >
            {FILTERS.map((cat) => (
              <button
                key={cat}
                onClick={() => handleCategoryChange(cat)}
                aria-pressed={activeCategory === cat}
                className={`px-4 sm:px-5 py-1.5 rounded-full text-xs font-semibold tracking-wide border transition-all duration-200 cursor-pointer ${
                  activeCategory === cat
                    ? 'gold-gradient-bg text-black border-transparent shadow-lg font-bold'
                    : 'bg-[#14141c]/80 text-[#a5a1b0] border-[#292938] hover:border-[#cba258]/60 hover:text-white'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* ─── ENTRADA ESCALONADA 3: Escenario Carrusel 3D Infinito (Sin Huecos) ─── */}
        <div 
          className="glow-looks__stage relative w-full h-[680px] sm:h-[800px] md:h-[890px] lg:h-[950px] flex items-center justify-center overflow-x-clip transition-all duration-[1400ms] ease-out"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(55px)',
            transitionDelay: '550ms',
            overflowX: 'clip',
            overflowY: 'visible',
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={() => { touchStart.current = null; }}
        >
          {/* Flecha Lateral Izquierda */}
          <button
            onClick={() => goTo(safeIndex - 1)}
            className="glow-looks__arrow absolute left-2 sm:left-6 lg:left-10 z-40 w-11 h-11 sm:w-13 sm:h-13 rounded-full bg-black/80 border border-[#cba258]/70 flex items-center justify-center text-[#cba258] hover:scale-110 shadow-2xl transition-transform cursor-pointer"
            aria-label="Anterior"
          >
            <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>

          {/* Flecha Lateral Derecha */}
          <button
            onClick={() => goTo(safeIndex + 1)}
            className="glow-looks__arrow absolute right-2 sm:right-6 lg:right-10 z-40 w-11 h-11 sm:w-13 sm:h-13 rounded-full bg-black/80 border border-[#cba258]/70 flex items-center justify-center text-[#cba258] hover:scale-110 shadow-2xl transition-transform cursor-pointer"
            aria-label="Siguiente"
          >
            <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>

          {/* Renderizado continuo con Loop Infinito real */}
          {filteredLooks.map((item, idx) => {
            const diff = getCircularDiff(idx, safeIndex, total);
            // Si hay más de 5 elementos, ocultar los que queden detrás
            const isOutOfView = Math.abs(diff) > 2;

            const isCenter = diff === 0;
            const isPrev = diff === -1;
            const isNext = diff === 1;
            const isFarPrev = diff === -2;
            const isFarNext = diff === 2;

            // Parámetros de transformación y perspectiva 3D
            let translateX = 0;
            let rotateY = 0;
            let scale = 1;
            let opacity = 1;
            let zIndex = 30;

            if (isCenter) {
              translateX = 0;
              rotateY = 0;
              scale = 1;
              opacity = 1;
              zIndex = 30;
            } else if (isPrev) {
              translateX = -360;
              rotateY = 7;
              scale = 0.88;
              opacity = 0.85;
              zIndex = 20;
            } else if (isNext) {
              translateX = 360;
              rotateY = -7;
              scale = 0.88;
              opacity = 0.85;
              zIndex = 20;
            } else if (isFarPrev) {
              translateX = -620;
              rotateY = 12;
              scale = 0.72;
              opacity = 0.45;
              zIndex = 10;
            } else if (isFarNext) {
              translateX = 620;
              rotateY = -12;
              scale = 0.72;
              opacity = 0.45;
              zIndex = 10;
            } else {
              translateX = diff > 0 ? 800 : -800;
              scale = 0.5;
              opacity = 0;
              zIndex = 0;
            }

            return (
              <div
                key={item.id}
                data-active={isCenter}
                onClick={() => !isCenter && goTo(idx)}
                className={`glow-looks__card absolute top-1/2 left-1/2 flex flex-col items-center transition-all duration-500 ease-out ${
                  isCenter ? 'cursor-default' : 'cursor-pointer hover:opacity-100'
                } ${isOutOfView ? 'pointer-events-none' : ''}`}
                style={{
                  transform: `translate(-50%, -50%) translate3d(${translateX}px, 0, 0) perspective(1200px) rotateY(${rotateY}deg) scale(${scale})`,
                  zIndex,
                  opacity,
                }}
              >
                {/* ── FRAME DEL MEDIA EXCLUSIVO 9:16 (400-440px en Desktop) ── */}
                <div 
                  className={`glow-looks__frame relative w-[280px] sm:w-[350px] md:w-[400px] lg:w-[430px] aspect-[9/16] rounded-2xl sm:rounded-3xl overflow-hidden bg-black transition-all duration-500 ${
                    isCenter 
                      ? 'border-2 border-[#cba258]/80 shadow-[0_0_60px_rgba(203,162,88,0.35)] ring-1 ring-[#cba258]/50' 
                      : 'border border-[#2a2a38] shadow-2xl'
                  }`}
                >
                  {isCenter && item.hasBeforeAfter ? (
                    <BeforeAfterMedia
                      item={item}
                      onStartInteraction={() => { isInteractingWithSlider.current = true; }}
                      onEndInteraction={() => { isInteractingWithSlider.current = false; setProgress(0); }}
                    />
                  ) : (
                    <div className="relative w-full h-full">
                      <img
                        src={item.afterImg}
                        alt={item.title}
                        className="w-full h-full object-cover select-none pointer-events-none"
                        draggable="false"
                      />
                      {/* Icono sutil divisor en laterales si tiene antes/después */}
                      {item.hasBeforeAfter && (
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 border border-[#cba258]/70 flex items-center justify-center">
                          <MoveHorizontal className="w-3.5 h-3.5 text-[#cba258]" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
                    </div>
                  )}
                </div>

                {/* ── CONTENIDO FUERA DEL FRAME 9:16 (LIMPIO) ── */}
                {isCenter ? (
                  <div className="glow-looks__caption mt-4 sm:mt-5 text-center flex flex-col items-center">
                    <h3 className="text-2xl sm:text-3xl font-serif font-bold text-white tracking-wide">
                      {item.title}
                    </h3>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleBookLook(item); }}
                      className="mt-3 px-8 sm:px-10 py-3 sm:py-3.5 rounded-full gold-gradient-bg text-black font-bold text-xs sm:text-sm uppercase tracking-wider flex items-center gap-2 hover:opacity-95 hover:scale-105 active:scale-95 transition-all shadow-2xl cursor-pointer"
                    >
                      <span>Quiero este look</span>
                      <ArrowRight className="w-4 h-4 text-black" />
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 sm:mt-4 text-center">
                    <h4 className="text-base sm:text-lg font-serif font-semibold text-[#d0ccd8] hover:text-[#cba258] transition-colors">
                      {item.title}
                    </h4>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ─── ENTRADA ESCALONADA 4: Barra de Autoplay & Contador ─── */}
        <div 
          className="glow-looks__playback flex items-center justify-center gap-4 sm:gap-6 mt-1 mb-8 transition-all duration-[1400ms] ease-out"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(40px)',
            transitionDelay: '800ms',
          }}
        >
          {/* Botón Play / Pause */}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="glow-looks__pause w-8 h-8 rounded-full bg-[#161620] border border-[#2b2b3c] flex items-center justify-center text-white/80 hover:text-[#cba258] transition-colors cursor-pointer"
            aria-label={isPlaying ? "Pausar carrusel" : "Reanudar carrusel"}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5 text-[#cba258]" />}
          </button>

          {/* Barra fina de progreso */}
          <div className="w-32 sm:w-48 h-1 bg-[#1e1e2b] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#cba258] transition-all duration-75"
              style={{ width: `${isPlaying ? progress : 0}%` }}
            />
          </div>

          {/* Contador 02 / 06 */}
          <span className="text-xs font-mono font-semibold text-white/70 tracking-wider">
            {String(safeIndex + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </span>

          {/* Switch Toggle Autoplay */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#8c889a] hidden sm:inline">Autoplay</span>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`glow-looks__autoplay w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                isPlaying ? 'bg-[#cba258]' : 'bg-[#252536]'
              }`}
              aria-label="Toggle Autoplay"
              aria-pressed={isPlaying}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-black transition-transform ${
                  isPlaying ? 'left-4.5' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        </div>

        {/* ─── ENTRADA ESCALONADA 5: Tira de Miniaturas Inferiores (9:16) ─── */}
        <div 
          className="glow-looks__thumbnails flex items-center justify-center gap-3 sm:gap-4 overflow-x-auto pb-4 scrollbar-hide px-2 transition-all duration-[1400ms] ease-out"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(35px)',
            transitionDelay: '1100ms',
          }}
        >
          {filteredLooks.map((item, idx) => {
            const isSelected = idx === safeIndex;
            return (
              <button
                key={item.id}
                onClick={() => goTo(idx)}
                aria-label={`Ver ${item.title}`}
                aria-pressed={isSelected}
                className={`relative flex-shrink-0 w-16 sm:w-20 md:w-22 aspect-[9/16] rounded-xl overflow-hidden border-2 transition-all duration-300 cursor-pointer ${
                  isSelected
                    ? 'border-[#cba258] shadow-[0_0_16px_rgba(203,162,88,0.5)] ring-2 ring-[#cba258]/50 scale-105'
                    : 'border-[#222230] opacity-60 hover:opacity-100 hover:border-[#cba258]/40'
                }`}
              >
                <img
                  src={item.thumb}
                  alt={item.title}
                  className="w-full h-full object-cover select-none pointer-events-none"
                />
                
                {/* Indicador de Video */}
                {item.isVideo && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <div className="w-5 h-5 rounded-full bg-black/70 border border-white/40 flex items-center justify-center">
                      <Play className="w-2.5 h-2.5 ml-0.5 text-white" />
                    </div>
                  </div>
                )}

                {/* Indicador dorado activo */}
                {isSelected && (
                  <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#cba258] shadow-[0_0_6px_#cba258]" />
                )}
              </button>
            );
          })}
        </div>

      </div>
    </section>
  );
}
