import { openBooking } from '../data/glowBooking';
import React, { useState, useEffect } from 'react';
import { Sparkles, MapPin, Phone, MessageCircle, Menu, X, Clock, Calendar } from 'lucide-react';
import { BRANCHES } from '../data/glowData';

export default function Header({ selectedBranch, setSelectedBranch }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 25);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const branch = BRANCHES[selectedBranch];

  const handleWhatsAppDirect = () => {
    const text = encodeURIComponent(`¡Hola Peluquería Glow! Quisiera consultar por turnos para la sucursal de ${branch.name}.`);
    window.open(`https://wa.me/${branch.whatsapp}?text=${text}`, '_blank');
  };

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      scrolled 
        ? 'bg-[#0e0e10]/95 backdrop-blur-md shadow-lg shadow-black/60 border-b border-[#24242d]' 
        : 'bg-gradient-to-b from-black/85 via-black/40 to-transparent border-b border-white/5'
    }`}>
      {/* Top micro banner - subtle and compact */}
      <div className={`transition-all duration-300 overflow-hidden text-[11px] text-[#a09ca8] px-4 ${
        scrolled ? 'max-h-0 py-0 opacity-0' : 'max-h-10 py-1.5 border-b border-white/5 opacity-100'
      }`}>
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-1 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Turnos abiertos para esta semana en <strong>Urquiza & Cañitas</strong></span>
          </div>
          <div className="flex items-center gap-4 text-[10px] sm:text-[11px]">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-[#cba258]" /> Mar a Sáb 11:00 a 20:00 hs
            </span>
            <a 
              href="https://instagram.com/peluqueriaglow" 
              target="_blank" 
              rel="noreferrer"
              className="text-[#cba258] hover:underline font-medium"
            >
              @peluqueriaglow
            </a>
          </div>
        </div>
      </div>

      {/* Main navigation */}
      <header>
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 sm:h-20 flex items-center justify-between">
          {/* Brand Logo */}
          <a href="#" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full gold-gradient-bg flex items-center justify-center text-black font-bold shadow-md group-hover:scale-105 transition-transform">
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-black" />
            </div>
            <div className="flex flex-col">
              <span className="font-serif text-xl sm:text-2xl font-bold tracking-widest text-[#f8f6f0] leading-none uppercase">
                GLOW
              </span>
              <span className="text-[8px] sm:text-[9px] tracking-[0.3em] text-[#cba258] uppercase font-semibold">
                Peluquería & Barber
              </span>
            </div>
          </a>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#c5c2cc]">
            <a href="#transformaciones" className="hover:text-[#cba258] transition-colors">Antes & Después</a>
            <a href="#servicios" className="hover:text-[#cba258] transition-colors">Servicios</a>
            <a href="#por-que-glow" className="hover:text-[#cba258] transition-colors">Por Qué Glow</a>
            <a href="#profesionales" className="hover:text-[#cba258] transition-colors">Profesionales</a>
            <a href="#opiniones" className="hover:text-[#cba258] transition-colors">Opiniones</a>
            <a href="#sucursales" className="hover:text-[#cba258] transition-colors">Sucursales</a>
          </nav>

          {/* Branch Switcher & Booking Action */}
          <div className="hidden sm:flex items-center gap-3">
            {/* Quick branch pill selector */}
            <div className="flex bg-black/60 backdrop-blur-sm p-1 rounded-full border border-[#2d2d38] text-xs font-medium">
              <button
                onClick={() => setSelectedBranch('urquiza')}
                className={`px-3 py-1 rounded-full transition-all cursor-pointer ${
                  selectedBranch === 'urquiza'
                    ? 'gold-gradient-bg text-black font-semibold shadow-sm'
                    : 'text-[#9c97a6] hover:text-white'
                }`}
              >
                Urquiza
              </button>
              <button
                onClick={() => setSelectedBranch('canitas')}
                className={`px-3 py-1 rounded-full transition-all cursor-pointer ${
                  selectedBranch === 'canitas'
                    ? 'gold-gradient-bg text-black font-semibold shadow-sm'
                    : 'text-[#9c97a6] hover:text-white'
                }`}
              >
                Cañitas
              </button>
            </div>

            {/* Direct WhatsApp CTA button */}
            <button
              onClick={() => openBooking(selectedBranch)}
              className="flex items-center gap-2 px-4 py-2 rounded-full gold-gradient-bg text-black font-semibold text-xs tracking-wide uppercase hover:opacity-90 transition-all hover:scale-[1.02] shadow-md cursor-pointer"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Pedir Turno</span>
            </button>
          </div>

          {/* Mobile hamburger toggle */}
          <div className="flex sm:hidden items-center gap-2">
            <button
              onClick={handleWhatsAppDirect}
              className="flex items-center justify-center p-2 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
              aria-label="WhatsApp Turno"
            >
              <MessageCircle className="w-5 h-5" />
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-[#e2dfd7] hover:text-[#cba258] transition-colors"
              aria-label="Menú"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Drawer */}
        {mobileMenuOpen && (
          <div className="sm:hidden bg-[#121217] border-b border-[#2a2a35] px-5 py-5 space-y-4 shadow-2xl">
            <div className="bg-[#181820] p-1.5 rounded-xl border border-[#2b2b38]">
              <div className="text-[11px] text-[#9a95a5] px-2 py-1 uppercase font-semibold tracking-wider">
                Elegir Sucursal Activa:
              </div>
              <div className="grid grid-cols-2 gap-1.5 mt-1">
                <button
                  onClick={() => setSelectedBranch('urquiza')}
                  className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                    selectedBranch === 'urquiza'
                      ? 'gold-gradient-bg text-black shadow-md'
                      : 'bg-[#20202a] text-[#c0bcc8]'
                  }`}
                >
                  Villa Urquiza
                </button>
                <button
                  onClick={() => setSelectedBranch('canitas')}
                  className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                    selectedBranch === 'canitas'
                      ? 'gold-gradient-bg text-black shadow-md'
                      : 'bg-[#20202a] text-[#c0bcc8]'
                  }`}
                >
                  Las Cañitas
                </button>
              </div>
            </div>

            <div className="flex flex-col space-y-3 pt-2 text-sm font-medium text-[#dedbd4]">
              <a 
                href="#transformaciones" 
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 border-b border-[#202028] hover:text-[#cba258]"
              >
                Transformaciones (Antes & Después)
              </a>
              <a 
                href="#servicios" 
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 border-b border-[#202028] hover:text-[#cba258]"
              >
                Servicios & Precios
              </a>
              <a 
                href="#por-que-glow" 
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 border-b border-[#202028] hover:text-[#cba258]"
              >
                Por Qué Glow
              </a>
              <a 
                href="#profesionales" 
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 border-b border-[#202028] hover:text-[#cba258]"
              >
                Profesionales
              </a>
              <a 
                href="#opiniones" 
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 border-b border-[#202028] hover:text-[#cba258]"
              >
                Opiniones de Clientes
              </a>
              <a 
                href="#sucursales" 
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 hover:text-[#cba258]"
              >
                Nuestras Sedes (Urquiza & Cañitas)
              </a>
            </div>

            <button
              onClick={() => {
                setMobileMenuOpen(false);
                openBooking(selectedBranch);
              }}
              className="w-full py-3 rounded-xl gold-gradient-bg text-black font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg"
            >
              <MessageCircle className="w-5 h-5 text-black" />
              <span>Pedir turno ({branch.name})</span>
            </button>
          </div>
        )}
      </header>
    </div>
  );
}
