import React, { useState } from 'react';
import { siteConfig } from '../data/siteConfig';
import { Search, MapPin, Clock, Menu, X, Car } from 'lucide-react';

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-[#0a0c10]/95 backdrop-blur-md border-b border-zinc-800/80">
      {/* Top info bar */}
      <div className="hidden lg:block bg-[#060709] border-b border-zinc-800/60 text-xs text-zinc-400 py-2 px-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-6">
            <span className="flex items-center gap-1.5 text-zinc-300">
              <MapPin className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <span>{siteConfig.fullAddress}</span>
            </span>
            <span className="flex items-center gap-1.5 text-zinc-300">
              <Clock className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <span>{siteConfig.hours.summary}</span>
            </span>
          </div>
          <div className="flex items-center space-x-3">
            <span className="text-zinc-400">Atención rápida y turnos:</span>
            <a
              href={siteConfig.getWhatsAppLink("Hola Lubricentro Albarellos, me comunico desde la web")}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 hover:text-emerald-300 font-semibold transition hover:bg-emerald-900/40"
            >
              {/* WhatsApp Official SVG Icon */}
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
              </svg>
              <span>WhatsApp</span>
            </a>
          </div>
        </div>
      </div>

      {/* Main Navbar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          
          {/* Logo */}
          <a href="#" className="flex items-center gap-2.5 group select-none">
            {/* Minimal oil drop accent */}
            <svg viewBox="0 0 40 56" className="w-7 h-9 shrink-0 drop-shadow-md" fill="none">
              <path d="M20 4 C20 4, 2 28, 2 38 C2 48 10 54 20 54 C30 54 38 48 38 38 C38 28 20 4 20 4Z" fill="#dc2626"/>
              <path d="M13 22 C13 22, 7 34, 7 40 C7 46 11 51 17 53 C14 51 11 47 11 41 C11 35 16 24 13 22Z" fill="#fca5a5" opacity="0.5"/>
            </svg>
            <div className="leading-none">
              <div className="font-heading text-[0.78rem] font-semibold tracking-[0.18em] text-zinc-400 uppercase">
                LUBRICENTRO
              </div>
              <div className="font-heading text-[1.45rem] font-black tracking-wider text-white leading-none -mt-0.5 group-hover:text-red-400 transition-colors">
                ALBARELLOS
              </div>
              <div className="flex items-center gap-2 mt-[3px]">
                <div className="h-[2px] w-8 bg-red-600 rounded-full"/>
                <span className="text-[9px] tracking-[0.22em] text-zinc-500 uppercase font-medium">MÁS QUE UN CAMBIO</span>
              </div>
            </div>
          </a>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center space-x-1 lg:space-x-5 text-sm font-medium">
            <a href="#consulta-patente" className="px-3 py-2 text-zinc-300 hover:text-white transition hover:bg-zinc-800/40 rounded-lg">
              Consultar Patente
            </a>
            <a href="#servicios" className="px-3 py-2 text-zinc-300 hover:text-white transition hover:bg-zinc-800/40 rounded-lg">
              Servicios
            </a>
            <a href="#marcas" className="px-3 py-2 text-zinc-300 hover:text-white transition hover:bg-zinc-800/40 rounded-lg">
              Marcas
            </a>
            <a href="#nosotros" className="px-3 py-2 text-zinc-300 hover:text-white transition hover:bg-zinc-800/40 rounded-lg">
              Por Qué Elegirnos
            </a>
            <a href="#ubicacion" className="px-3 py-2 text-zinc-300 hover:text-white transition hover:bg-zinc-800/40 rounded-lg">
              Ubicación
            </a>
          </nav>

          {/* Improved "Ver mi Vehículo / Consultar Patente" Button */}
          <div className="hidden sm:flex items-center">
            <a
              href="#consulta-patente"
              className="relative group inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 hover:from-zinc-800 hover:to-zinc-700 text-white font-bold text-xs sm:text-sm border-2 border-red-600/70 hover:border-red-500 shadow-lg shadow-red-950/50 hover:shadow-red-600/30 transition-all duration-300 transform hover:-translate-y-0.5"
            >
              {/* Subtle animated red glow dot */}
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>

              <Search className="w-4 h-4 text-red-500 group-hover:text-red-400 transition" />
              <span className="tracking-wide">CONSULTAR MI PATENTE</span>
            </a>
          </div>

          {/* Mobile hamburger */}
          <div className="flex md:hidden">
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 focus:outline-none"
              aria-label="Abrir menú"
            >
              {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="md:hidden bg-[#0a0c10] border-b border-zinc-800 px-4 pt-3 pb-6 space-y-3">
          <a
            href="#consulta-patente"
            onClick={() => setMobileOpen(false)}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white font-bold bg-gradient-to-r from-red-600 to-red-700 border border-red-500 shadow-md"
          >
            <Search className="w-4 h-4" />
            <span>Consultar por Patente</span>
          </a>
          <a
            href="#servicios"
            onClick={() => setMobileOpen(false)}
            className="block px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-900"
          >
            Servicios Especializados
          </a>
          <a
            href="#marcas"
            onClick={() => setMobileOpen(false)}
            className="block px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-900"
          >
            Marcas Oficiales
          </a>
          <a
            href="#nosotros"
            onClick={() => setMobileOpen(false)}
            className="block px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-900"
          >
            ¿Por qué Albarellos?
          </a>
          <a
            href="#ubicacion"
            onClick={() => setMobileOpen(false)}
            className="block px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-900"
          >
            Ubicación y Horarios
          </a>

          <div className="pt-2">
            <a
              href={siteConfig.getWhatsAppLink("Hola Albarellos! Quisiera hacer una consulta.")}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
              </svg>
              <span>WhatsApp</span>
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
