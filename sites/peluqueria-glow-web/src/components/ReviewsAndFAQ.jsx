import React, { useState, useRef } from 'react';
import { Star, ChevronDown, ChevronUp, MessageCircle, Heart } from 'lucide-react';
import { TESTIMONIALS, FAQS, BRANCHES } from '../data/glowData';

// Duplicar tarjetas para el loop infinito sin salto
const LOOP_CARDS = [...TESTIMONIALS, ...TESTIMONIALS];

function TestimonialCard({ t }) {
  return (
    <div
      className="w-[85vw] sm:w-[380px] lg:w-[420px] shrink-0 rounded-[26px] p-6 sm:p-7 bg-[#12131b] border border-white/10 hover:border-[#cba258]/60 transition-colors duration-300 flex flex-col justify-between shadow-xl"
      aria-label={`Reseña de ${t.name}`}
    >
      <div className="space-y-4">
        {/* Cabecera: Avatar, Nombre, Badge Google */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#cba258] to-[#967434] text-black font-serif font-bold text-sm flex items-center justify-center shadow-md shrink-0">
              {t.name.charAt(0)}
            </div>
            <div>
              <h4 className="font-serif font-bold text-white text-base leading-tight">
                {t.name}
              </h4>
              <p className="text-[11px] text-[#938f9e] mt-0.5">{t.badge}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#191a24] border border-white/10 text-[10px] text-[#dedad4] font-medium shrink-0">
            <span className="text-[#cba258] font-bold">G</span> Maps
          </div>
        </div>

        {/* Estrellas + fecha */}
        <div className="flex items-center justify-between text-xs pt-0.5">
          <div className="flex items-center gap-0.5 text-amber-400">
            {[...Array(t.rating)].map((_, i) => (
              <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            ))}
          </div>
          <span className="text-[11px] text-[#787484] font-mono">{t.date}</span>
        </div>

        {/* Texto de la reseña */}
        <p className="text-xs sm:text-[13px] text-[#dedad2] leading-relaxed italic">
          "{t.text}"
        </p>
      </div>

      {/* Pie: Servicio + Likes */}
      <div className="pt-4 mt-5 border-t border-white/5 flex items-center justify-between text-xs">
        <div>
          <span className="text-[10px] uppercase tracking-wider text-[#cba258] font-semibold block">
            {t.service}
          </span>
          <span className="text-[11px] text-[#7a7686]">Sede {t.branch}</span>
        </div>
        {t.likes > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-[#181924] border border-white/5 text-[11px] text-[#f2667a]">
            <Heart className="w-3 h-3 fill-[#f2667a]" />
            <span>{t.likes}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReviewsAndFAQ({ selectedBranch }) {
  const [openFaq, setOpenFaq] = useState(0);
  const branch = BRANCHES[selectedBranch] || BRANCHES['urquiza'];

  return (
    <section id="opiniones" className="py-20 sm:py-28 bg-[#090a0e] text-[#f2f0eb] relative overflow-hidden border-t border-white/5 select-none">
      
      {/* Halo dorado de fondo */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[900px] h-[400px] bg-[#cba258]/6 blur-[140px] rounded-full" />
      </div>

      <div className="relative z-10 w-full">

        {/* ─── ENCABEZADO ─── */}
        <div className="w-[calc(100%-32px)] sm:w-[calc(100%-64px)] max-w-4xl mx-auto text-center mb-10 sm:mb-12 space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#161722] border border-[#cba258]/35 text-[#cba258] text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.3em]">
            CLIENTAS FELICES · GOOGLE REVIEWS
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-serif font-bold text-white tracking-tight">
            Lo que dicen de la experiencia Glow
          </h2>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 pt-1">
            <div className="flex items-center gap-1 text-amber-400">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-4 h-4 fill-amber-400" />
              ))}
            </div>
            <span className="text-sm font-semibold text-white">4.9 / 5</span>
            <span className="text-[#686474] text-xs">·</span>
            <span className="text-xs sm:text-sm text-[#a8a4b4]">Más de 500 reseñas reales de 5 estrellas</span>
          </div>
        </div>

        {/* ─── CARRUSEL INFINITO CSS (SIN SALTOS) ─── */}
        {/*
          Técnica: duplicamos las tarjetas (LOOP_CARDS = TESTIMONIALS x2).
          El track se anima con translateX de 0% → -50% en CSS puro.
          Cuando llega al -50% vuelve instantáneamente al 0%, pero como
          las primeras 11 cards == las últimas 11 cards, el ojo no lo detecta.
          Al hacer hover sobre una card la animación se pausa automáticamente.
        */}
        <div className="w-full overflow-hidden pb-6">
          <div
            className="flex gap-5 sm:gap-6 w-max animate-scroll-left"
            style={{ paddingLeft: '24px', paddingRight: '24px' }}
          >
            {LOOP_CARDS.map((t, idx) => (
              <TestimonialCard key={`${t.id}-${idx}`} t={t} />
            ))}
          </div>
        </div>

        {/* Indicador sutil de cantidad */}
        <div className="w-full px-6 sm:px-10 lg:px-16 mt-2 mb-10">
          <span className="text-xs text-[#4d4958] font-medium tracking-wider uppercase">
            {TESTIMONIALS.length} reseñas reales · deslizá para leer más
          </span>
        </div>

        {/* ─── PREGUNTAS FRECUENTES ─── */}
        <div className="w-[calc(100%-32px)] sm:w-[calc(100%-64px)] max-w-5xl lg:max-w-6xl mx-auto pt-16 sm:pt-20 mt-4 border-t border-white/10">
          
          <div className="text-center mb-10 sm:mb-12 space-y-2">
            <span className="text-xs uppercase tracking-[0.25em] text-[#cba258] font-semibold">
              Dudas Frecuentes
            </span>
            <h3 className="text-3xl sm:text-4xl font-serif font-bold text-white">
              Preguntas & Respuestas
            </h3>
            <p className="text-[#9692a2] text-xs sm:text-sm max-w-lg mx-auto">
              Todo lo que necesitás saber antes de tu visita a nuestras sedes.
            </p>
          </div>

          <div className="space-y-4">
            {FAQS.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div
                  key={idx}
                  className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
                    isOpen
                      ? 'bg-[#14151f] border-[#cba258]/60 shadow-[0_8px_30px_rgba(203,162,88,0.15)]'
                      : 'bg-[#101118] border-white/10 hover:border-[#cba258]/40'
                  }`}
                >
                  <button
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full px-6 sm:px-8 py-5 sm:py-6 text-left flex items-center justify-between text-base sm:text-lg font-serif font-bold text-white hover:text-[#cba258] transition-colors cursor-pointer"
                  >
                    <span>{faq.q}</span>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ml-4 transition-colors ${
                      isOpen ? 'bg-[#cba258] text-black' : 'bg-[#191a24] text-[#a5a1b2]'
                    }`}>
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-6 sm:px-8 pb-6 text-sm sm:text-[15px] text-[#b8b4c4] leading-relaxed border-t border-white/5 pt-4">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="text-center mt-12 sm:mt-14">
            <p className="text-xs sm:text-sm text-[#8c8898] mb-3.5">¿Tenés otra consulta específica?</p>
            <button
              onClick={() => {
                const text = encodeURIComponent(`Hola Glow! Tengo una consulta sobre los servicios en la sucursal de ${branch.name}.`);
                window.open(`https://wa.me/${branch.whatsapp}?text=${text}`, '_blank');
              }}
              className="inline-flex items-center gap-2.5 px-6 py-3 rounded-full bg-[#181924] text-white border border-[#cba258]/40 text-xs sm:text-sm font-semibold hover:border-[#cba258] hover:bg-[#cba258] hover:text-black transition-all shadow-md cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" />
              <span>Chatear por WhatsApp con {branch.name}</span>
            </button>
          </div>

        </div>
      </div>
    </section>
  );
}
