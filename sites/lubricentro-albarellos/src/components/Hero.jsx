import React from 'react';
import { siteConfig } from '../data/siteConfig';
import { Calendar, ChevronRight } from 'lucide-react';
import { WhatsAppIcon } from './SocialIcons';

export default function Hero() {
  return (
    <section className="relative w-full aspect-auto md:aspect-[16/9] min-h-[640px] md:min-h-0 flex items-center overflow-hidden border-b border-zinc-800 bg-[#090b0f]">

      {/* 16:9 Uncropped Native Image */}
      <picture className="absolute inset-0 w-full h-full pointer-events-none select-none">
        <source media="(max-width: 768px)" srcSet="/images/hero-mobile.jpg" />
        <img
          src="/images/hero-desktop.jpg"
          alt="Lubricentro Albarellos - Taller Mecánico Especializado"
          className="w-full h-full object-cover object-center"
        />
      </picture>

      {/* Atmospheric left gradient for text contrast */}
      <div className="absolute inset-0 bg-gradient-to-t md:bg-gradient-to-r from-[#090b0f] via-[#090b0f]/85 md:via-[#090b0f]/50 to-transparent md:w-[50%] z-0 pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#090b0f] via-[#090b0f]/70 to-transparent z-0 pointer-events-none" />

      {/* Main Content Container: Fluid padding based on viewport */}
      <div className="relative z-10 w-full h-full flex flex-col px-[clamp(1rem,3.5vw,4.5rem)] py-[clamp(1.5rem,3vw,3.5rem)]">

        {/* Spacer: pushes title down toward vertical center */}
        <div className="flex-[0.35]" />

        {/* UPPER LEFT: Fluid Responsive Headline and Subtitle */}
        <div className="w-full md:w-[50%] lg:w-[47%] xl:w-[45%]">

          <h1 className="font-heading text-[clamp(2.3rem,4.2vw,5.5rem)] font-extrabold tracking-tight leading-[0.91] mb-[clamp(0.75rem,1.2vw,1.5rem)]">
            <span className="text-white block drop-shadow-xl">
              CUIDAMOS TU MOTOR
            </span>
            <span className="text-zinc-200 block drop-shadow-xl">
              PARA QUE VOS
            </span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-red-600 to-rose-400 block drop-shadow-xl">
              SIGAS AVANZANDO
            </span>
          </h1>

          <div className="text-zinc-200 text-[clamp(0.95rem,1.3vw,1.45rem)] space-y-1 font-medium drop-shadow-md max-w-xl leading-snug">
            <p className="font-bold text-white">Aceites, filtros, baterías, frenos y más.</p>
            <p className="text-zinc-300 font-normal">El servicio y la confianza de siempre.</p>
          </div>

        </div>

        {/* BOTTOM ROW: Large Responsive Cards on the Left / Action Buttons on the Right */}
        <div className="w-full flex flex-col md:flex-row items-stretch md:items-end justify-between gap-[clamp(1rem,2vw,2.5rem)] pt-6 mt-auto">

          {/* BOTTOM LEFT: 4 Large Service Cards that fill the available space */}
          <div className="grid grid-cols-4 gap-[clamp(0.5rem,1vw,1rem)] w-full md:w-[50%] lg:w-[47%] xl:w-[45%]">

            {/* 1. Cambio de Aceite */}
            <div className="flex flex-col items-center justify-center text-center p-[clamp(0.6rem,1.1vw,1.35rem)] rounded-2xl bg-zinc-950/90 border border-zinc-800/90 backdrop-blur-md hover:border-red-500/60 hover:bg-zinc-900/90 transition-all duration-300 shadow-2xl group min-h-[clamp(90px,10vw,150px)]">
              <div className="w-[clamp(2.2rem,2.8vw,3.6rem)] h-[clamp(2.2rem,2.8vw,3.6rem)] rounded-xl bg-red-600/15 group-hover:bg-red-600/25 flex items-center justify-center text-red-500 mb-[clamp(0.35rem,0.7vw,0.85rem)] group-hover:scale-110 transition shrink-0">
                <svg viewBox="0 0 24 24" className="w-[clamp(1.5rem,2vw,2.5rem)] h-[clamp(1.5rem,2vw,2.5rem)] stroke-current fill-none stroke-[1.85]" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 14v4M12 5l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
                  <path d="M14 9l7-4v4l-4 3" />
                  <circle cx="9" cy="12" r="2" />
                  <path d="M21 17a2 2 0 1 1-4 0c0-1.5 2-3 2-3s2 1.5 2 3z" fill="currentColor" />
                </svg>
              </div>
              <span className="text-[clamp(0.68rem,0.85vw,1rem)] font-bold text-zinc-100 leading-tight uppercase font-heading tracking-wide">
                CAMBIO<br />DE ACEITE
              </span>
            </div>

            {/* 2. Filtros Originales */}
            <div className="flex flex-col items-center justify-center text-center p-[clamp(0.6rem,1.1vw,1.35rem)] rounded-2xl bg-zinc-950/90 border border-zinc-800/90 backdrop-blur-md hover:border-red-500/60 hover:bg-zinc-900/90 transition-all duration-300 shadow-2xl group min-h-[clamp(90px,10vw,150px)]">
              <div className="w-[clamp(2.2rem,2.8vw,3.6rem)] h-[clamp(2.2rem,2.8vw,3.6rem)] rounded-xl bg-red-600/15 group-hover:bg-red-600/25 flex items-center justify-center text-red-500 mb-[clamp(0.35rem,0.7vw,0.85rem)] group-hover:scale-110 transition shrink-0">
                <svg viewBox="0 0 24 24" className="w-[clamp(1.5rem,2vw,2.5rem)] h-[clamp(1.5rem,2vw,2.5rem)] stroke-current fill-none stroke-[1.85]" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="6" rx="7" ry="3" />
                  <path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
                  <path d="M8 8v10M12 9v11M16 8v10" />
                </svg>
              </div>
              <span className="text-[clamp(0.68rem,0.85vw,1rem)] font-bold text-zinc-100 leading-tight uppercase font-heading tracking-wide">
                FILTROS<br />ORIGINALES
              </span>
            </div>

            {/* 3. Baterías con Garantía */}
            <div className="flex flex-col items-center justify-center text-center p-[clamp(0.6rem,1.1vw,1.35rem)] rounded-2xl bg-zinc-950/90 border border-zinc-800/90 backdrop-blur-md hover:border-red-500/60 hover:bg-zinc-900/90 transition-all duration-300 shadow-2xl group min-h-[clamp(90px,10vw,150px)]">
              <div className="w-[clamp(2.2rem,2.8vw,3.6rem)] h-[clamp(2.2rem,2.8vw,3.6rem)] rounded-xl bg-red-600/15 group-hover:bg-red-600/25 flex items-center justify-center text-red-500 mb-[clamp(0.35rem,0.7vw,0.85rem)] group-hover:scale-110 transition shrink-0">
                <svg viewBox="0 0 24 24" className="w-[clamp(1.5rem,2vw,2.5rem)] h-[clamp(1.5rem,2vw,2.5rem)] stroke-current fill-none stroke-[1.85]" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="14" rx="2" />
                  <path d="M6 3v3M18 3v3" />
                  <line x1="6" y1="11" x2="10" y2="11" />
                  <line x1="8" y1="9" x2="8" y2="13" />
                  <line x1="14" y1="11" x2="18" y2="11" />
                </svg>
              </div>
              <span className="text-[clamp(0.68rem,0.85vw,1rem)] font-bold text-zinc-100 leading-tight uppercase font-heading tracking-wide">
                BATERÍAS<br />CON GARANTÍA
              </span>
            </div>

            {/* 4. Frenos y Pastillas */}
            <div className="flex flex-col items-center justify-center text-center p-[clamp(0.6rem,1.1vw,1.35rem)] rounded-2xl bg-zinc-950/90 border border-zinc-800/90 backdrop-blur-md hover:border-red-500/60 hover:bg-zinc-900/90 transition-all duration-300 shadow-2xl group min-h-[clamp(90px,10vw,150px)]">
              <div className="w-[clamp(2.2rem,2.8vw,3.6rem)] h-[clamp(2.2rem,2.8vw,3.6rem)] rounded-xl bg-red-600/15 group-hover:bg-red-600/25 flex items-center justify-center text-red-500 mb-[clamp(0.35rem,0.7vw,0.85rem)] group-hover:scale-110 transition shrink-0">
                <svg viewBox="0 0 24 24" className="w-[clamp(1.5rem,2vw,2.5rem)] h-[clamp(1.5rem,2vw,2.5rem)] stroke-current fill-none stroke-[1.85]" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="12" cy="12" r="1" fill="currentColor" />
                  <path d="M12 3a9 9 0 0 1 9 9h-4a5 5 0 0 0-5-5V3z" fill="currentColor" fillOpacity="0.3" />
                </svg>
              </div>
              <span className="text-[clamp(0.68rem,0.85vw,1rem)] font-bold text-zinc-100 leading-tight uppercase font-heading tracking-wide">
                FRENOS<br />Y PASTILLAS
              </span>
            </div>

          </div>

          {/* BOTTOM RIGHT: Action Buttons that scale with viewport */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-[clamp(0.6rem,1vw,1.25rem)] shrink-0">
            <a
              href={siteConfig.getWhatsAppLink("¡Hola Albarellos! Quiero pedir un turno para mi auto.")}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2.5 px-[clamp(1.25rem,1.8vw,2.5rem)] py-[clamp(0.75rem,1.1vw,1.35rem)] rounded-xl bg-gradient-to-r from-red-600 via-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold text-[clamp(0.85rem,1.05vw,1.15rem)] shadow-2xl shadow-red-950/90 hover:shadow-red-600/50 transition transform hover:-translate-y-0.5 border border-red-500/40 text-center"
            >
              <Calendar className="w-[clamp(1rem,1.2vw,1.4rem)] h-[clamp(1rem,1.2vw,1.4rem)] text-white" />
              <span>PEDÍ TU TURNO</span>
              <ChevronRight className="w-4 h-4 ml-0.5" />
            </a>

            <a
              href={siteConfig.getWhatsAppLink("Hola Lubricentro Albarellos, quiero hacer una consulta.")}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2.5 px-[clamp(1rem,1.6vw,2.2rem)] py-[clamp(0.75rem,1.1vw,1.35rem)] rounded-xl bg-zinc-950/90 hover:bg-zinc-900 text-white font-semibold text-[clamp(0.85rem,1.05vw,1.15rem)] border border-zinc-700/80 hover:border-zinc-500 transition backdrop-blur-md text-center shadow-xl"
            >
              <WhatsAppIcon className="w-[clamp(1rem,1.2vw,1.4rem)] h-[clamp(1rem,1.2vw,1.4rem)] fill-emerald-400" />
              <span>CONSULTÁ POR WHATSAPP</span>
            </a>
          </div>

        </div>

      </div>

    </section>
  );
}
