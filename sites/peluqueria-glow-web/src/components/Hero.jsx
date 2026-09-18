import { openBooking } from '../data/glowBooking';
import React, { useState, useEffect } from 'react';
import { Calendar, ChevronDown, CheckCircle, ArrowRight } from 'lucide-react';
import { BRANCHES } from '../data/glowData';

export default function Hero({ selectedBranch, setSelectedBranch }) {
  const branch = BRANCHES[selectedBranch] || BRANCHES['urquiza'];
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setScrollY(window.scrollY);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleBooking = () => openBooking(selectedBranch);

  // Parallax physics:
  // As the user scrolls down, the image drifts slowly upward (0.2x speed)
  // while the next section rises faster (1.0x) covering it progressively from below.
  const parallaxOffset = scrollY * 0.2;

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden flex flex-col justify-end select-none">
      {/* Parallax Background Image - Natural unzoomed framing */}
      <div 
        className="absolute inset-0 w-full h-full will-change-transform pointer-events-none"
        style={{
          transform: `translate3d(0, -${parallaxOffset}px, 0)`,
        }}
      >
        <img
          src="/hero-glow.jpg"
          alt="Peluquería Glow"
          className="w-full h-full object-cover object-[center_top] brightness-[0.95] contrast-[1.05]"
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/20" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-transparent sm:from-black/30" />
      </div>

      {/* Hero Bottom Action Controls */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 pb-6 sm:pb-8 lg:pb-10">
        <div className="max-w-xl space-y-3 sm:space-y-3.5">
          
          {/* Sede Selector */}
          <div className="p-1 rounded-2xl bg-black/65 backdrop-blur-md border border-white/20 inline-flex items-center gap-1 shadow-2xl">
            <span className="text-[11px] text-[#b4afbf] font-medium pl-2.5 pr-1 hidden sm:inline">
              Sede:
            </span>
            <button
              onClick={() => setSelectedBranch('urquiza')}
              className={`py-1.5 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                selectedBranch === 'urquiza'
                  ? 'gold-gradient-bg text-black shadow-md font-bold'
                  : 'text-white/80 hover:text-white hover:bg-white/10'
              }`}
            >
              <span>Villa Urquiza</span>
              {selectedBranch === 'urquiza' && <CheckCircle className="w-3.5 h-3.5 text-black" />}
            </button>

            <button
              onClick={() => setSelectedBranch('canitas')}
              className={`py-1.5 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                selectedBranch === 'canitas'
                  ? 'gold-gradient-bg text-black shadow-md font-bold'
                  : 'text-white/80 hover:text-white hover:bg-white/10'
              }`}
            >
              <span>Las Cañitas</span>
              {selectedBranch === 'canitas' && <CheckCircle className="w-3.5 h-3.5 text-black" />}
            </button>
          </div>

          {/* 2 Main Action Buttons */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3">
            <button
              onClick={handleBooking}
              className="px-6 py-3 rounded-full gold-gradient-bg text-black font-bold text-xs sm:text-sm tracking-wider uppercase flex items-center justify-center gap-2 shadow-2xl hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              <Calendar className="w-4 h-4 text-black" />
              <span>Agendá tu visita</span>
            </button>

            <a
              href="#servicios"
              className="px-5 py-3 rounded-full bg-black/60 hover:bg-black/85 backdrop-blur-md text-white border border-white/25 font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all hover:border-[#cba258]/60"
            >
              <span>Ver servicios y precios</span>
              <ArrowRight className="w-4 h-4 text-[#cba258]" />
            </a>
          </div>

        </div>

        {/* Scroll indicator prompt connects directly to next section: #transformaciones */}
        <div className="pt-3 sm:pt-4 flex justify-center">
          <a
            href="#transformaciones"
            className="flex flex-col items-center gap-0.5 text-[#b5b1bf] hover:text-[#cba258] transition-colors group cursor-pointer"
          >
            <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.25em] font-medium opacity-80 group-hover:opacity-100">
              Deslizá para descubrir
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-[#cba258] animate-bounce" />
          </a>
        </div>
      </div>

    </div>
  );
}
