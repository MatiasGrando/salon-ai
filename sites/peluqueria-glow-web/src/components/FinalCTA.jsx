import { openBooking } from '../data/glowBooking';
import React from 'react';
import { Calendar, Star, Clock } from 'lucide-react';
import { BRANCHES } from '../data/glowData';

export default function FinalCTA({ selectedBranch }) {
  const handleBooking = branchKey => openBooking(branchKey);

  return (
    <section id="reserva-final" className="py-20 sm:py-28 bg-[#0a0a0d] relative overflow-hidden border-t border-[#20202a]">
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-[#cba258]/10 blur-[120px]" />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 relative z-10 text-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#181822] border border-[#cba258]/30 mb-6 shadow-xl">
          <div className="flex text-amber-400">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className="w-3.5 h-3.5 fill-amber-400" />
            ))}
          </div>
          <span className="text-xs text-[#dcd7e8] font-medium">
            4.9 / 5 · Más de 500 clientas felices
          </span>
        </div>

        <h2 className="text-3xl sm:text-5xl font-serif font-bold text-white leading-tight mb-4">
          Viví la Experiencia Glow
        </h2>
        
        <p className="text-base sm:text-lg text-[#9e9aa8] max-w-xl mx-auto mb-10 leading-relaxed">
          Tu cabello en manos expertas. Reservá tu turno de forma rápida y personalizada online.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto mb-10 text-left">
          <div className="p-5 rounded-2xl bg-[#14141c] border border-[#262634] hover:border-[#cba258]/60 transition-all space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-[#cba258] font-bold">
                Sede Central
              </span>
              <span className="text-[10px] text-[#787484] flex items-center gap-1">
                <Clock className="w-3 h-3 text-[#cba258]" /> Mar a Sáb 11-20hs
              </span>
            </div>
            <div>
              <h3 className="text-xl font-serif font-bold text-white">Villa Urquiza</h3>
              <p className="text-xs text-[#8c889a]">Av. Olazábal 5036, CABA</p>
            </div>
            <button
              onClick={() => handleBooking('urquiza')}
              className="w-full py-3 rounded-xl gold-gradient-bg text-black font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:opacity-90 transition-opacity cursor-pointer shadow-lg"
            >
              <Calendar className="w-4 h-4" />
              Agendar en Urquiza
            </button>
          </div>

          <div className="p-5 rounded-2xl bg-[#14141c] border border-[#262634] hover:border-[#cba258]/60 transition-all space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-[#cba258] font-bold">
                Sede Boutique
              </span>
              <span className="text-[10px] text-[#787484] flex items-center gap-1">
                <Clock className="w-3 h-3 text-[#cba258]" /> Mar a Sáb 11-20hs
              </span>
            </div>
            <div>
              <h3 className="text-xl font-serif font-bold text-white">Las Cañitas</h3>
              <p className="text-xs text-[#8c889a]">Teodoro García 1828, Palermo</p>
            </div>
            <button
              onClick={() => handleBooking('canitas')}
              className="w-full py-3 rounded-xl gold-gradient-bg text-black font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:opacity-90 transition-opacity cursor-pointer shadow-lg"
            >
              <Calendar className="w-4 h-4" />
              Agendar en Cañitas
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-[#787484]">
          <span>✓ Diagnóstico capilar previo sin cargo</span>
          <span>✓ Productos oficiales Olaplex & L'Oréal</span>
          <span>✓ Café de especialidad de cortesía</span>
        </div>
      </div>
    </section>
  );
}
