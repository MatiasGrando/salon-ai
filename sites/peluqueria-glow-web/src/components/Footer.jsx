import React from 'react';
import { Sparkles, Phone, MapPin, Clock } from 'lucide-react';
import { BRANCHES } from '../data/glowData';

const InstagramIcon = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5"/>
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>
  </svg>
);

export default function Footer() {
  return (
    <footer className="w-full bg-[#07080a] border-t border-white/10 text-[#8e8a99] pt-16 pb-24 sm:pb-12 text-xs select-none">
      {/* Contenedor Full-Width con padding lateral generoso */}
      <div className="w-full px-6 sm:px-10 lg:px-16 xl:px-24">
        
        {/* Grilla principal de 4 columnas expandida en todo el ancho */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-14 xl:gap-16 mb-14">
          
          {/* Columna 1: Identidad Glow */}
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full gold-gradient-bg flex items-center justify-center text-black font-bold shadow-md">
                <Sparkles className="w-4 h-4 text-black" />
              </div>
              <div className="flex flex-col">
                <span className="font-serif text-2xl font-bold tracking-widest text-white uppercase leading-none">
                  GLOW
                </span>
                <span className="text-[9px] tracking-[0.25em] text-[#cba258] uppercase font-semibold mt-0.5">
                  Peluquería & Barber
                </span>
              </div>
            </div>
            
            <p className="text-[#8c8898] text-xs sm:text-[13px] leading-relaxed max-w-sm">
              Espacio boutique de autor especializado en rubios de diseño, balayage europeo, alisados orgánicos y barbería de precisión.
            </p>

            <a
              href="https://www.instagram.com/peluqueriaglow/?hl=es"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-[#cba258] font-semibold hover:underline text-xs"
            >
              <InstagramIcon className="w-4 h-4" />
              <span>@peluqueriaglow</span>
            </a>
          </div>

          {/* Columna 2: Sede Villa Urquiza */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-white font-serif text-sm font-bold uppercase tracking-wider">
              <MapPin className="w-3.5 h-3.5 text-[#cba258]" />
              <span>Sede Villa Urquiza</span>
            </div>
            <p className="text-[#aba6b6] text-xs sm:text-[13px] font-medium">{BRANCHES.urquiza.address}</p>
            <p className="text-[#7d798a]">{BRANCHES.urquiza.neighborhood}</p>
            <p className="text-white font-medium flex items-center gap-1.5 pt-1">
              <Phone className="w-3 h-3 text-[#cba258]" />
              <span>Tel: {BRANCHES.urquiza.phone}</span>
            </p>
            <p className="text-[11px] text-[#6d6a79] flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-[#a5a1af]" />
              <span>{BRANCHES.urquiza.hours}</span>
            </p>
          </div>

          {/* Columna 3: Sede Las Cañitas */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-white font-serif text-sm font-bold uppercase tracking-wider">
              <MapPin className="w-3.5 h-3.5 text-[#cba258]" />
              <span>Sede Las Cañitas</span>
            </div>
            <p className="text-[#aba6b6] text-xs sm:text-[13px] font-medium">{BRANCHES.canitas.address}</p>
            <p className="text-[#7d798a]">{BRANCHES.canitas.neighborhood}</p>
            <p className="text-white font-medium flex items-center gap-1.5 pt-1">
              <Phone className="w-3 h-3 text-[#cba258]" />
              <span>Tel: {BRANCHES.canitas.phone}</span>
            </p>
            <p className="text-[11px] text-[#6d6a79] flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-[#a5a1af]" />
              <span>{BRANCHES.canitas.hours}</span>
            </p>
          </div>

          {/* Columna 4: Navegación Rápida */}
          <div className="space-y-2.5">
            <div className="font-serif text-sm font-bold text-white uppercase tracking-wider">
              Navegación
            </div>
            <ul className="space-y-2 text-[#a5a1af] text-xs">
              <li><a href="#transformaciones" className="hover:text-[#cba258] transition-colors">Antes & Después</a></li>
              <li><a href="#servicios" className="hover:text-[#cba258] transition-colors">Carta de Servicios</a></li>
              <li><a href="#por-que-glow" className="hover:text-[#cba258] transition-colors">La Filosofía Glow</a></li>
              <li><a href="#profesionales" className="hover:text-[#cba258] transition-colors">Nuestros Profesionales</a></li>
              <li><a href="#opiniones" className="hover:text-[#cba258] transition-colors">Opiniones & FAQ</a></li>
              <li><a href="#sucursales" className="hover:text-[#cba258] transition-colors">Sucursales Urquiza & Cañitas</a></li>
            </ul>
          </div>

        </div>

        {/* Fila Inferior: Derechos y Crédito */}
        <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left text-[11px] text-[#6f6b7a]">
          <div>
            © {new Date().getFullYear()} Peluquería Glow. Todos los derechos reservados.
          </div>
          <div className="flex items-center gap-2">
            <span>Diagnóstico capilar previo · Técnicas de autor · Productos certificados</span>
          </div>
        </div>

      </div>
    </footer>
  );
}
