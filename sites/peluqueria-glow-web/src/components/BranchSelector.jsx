import React from 'react';
import { MapPin, Phone, MessageCircle, Clock, ExternalLink, Scissors, Award, Navigation } from 'lucide-react';
import { BRANCHES } from '../data/glowData';

export default function BranchSelector({ selectedBranch, setSelectedBranch }) {
  return (
    <section id="sucursales" className="py-16 sm:py-24 bg-[#0e0e10] relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-12 space-y-3">
          <span className="text-xs uppercase tracking-[0.25em] text-[#cba258] font-semibold">
            Nuestras Sedes en CABA
          </span>
          <h2 className="text-3xl sm:text-4xl font-serif font-bold text-white">
            Elegí la sucursal más cercana a vos
          </h2>
          <p className="text-[#9e9aa8] text-sm sm:text-base">
            Ambos salones cuentan con los mismos estándares de calidad, productos internacionales y el cálido asesoramiento Glow.
          </p>
        </div>

        {/* Dual Branch Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
          {Object.values(BRANCHES).map((branch) => {
            const isSelected = selectedBranch === branch.id;

            const handleWhatsAppBranch = () => {
              const text = encodeURIComponent(`Hola Glow! Quisiera consultar turno para la sucursal de ${branch.name}.`);
              window.open(`https://wa.me/${branch.whatsapp}?text=${text}`, '_blank');
            };

            return (
              <div
                key={branch.id}
                onClick={() => setSelectedBranch(branch.id)}
                className={`cursor-pointer rounded-3xl p-6 sm:p-8 transition-all duration-300 relative border ${
                  isSelected
                    ? 'bg-[#181820] border-[#cba258] gold-glow scale-[1.01]'
                    : 'bg-[#141418] border-[#262630] hover:border-[#383848] opacity-90'
                }`}
              >
                {/* Active Indicator Badge */}
                {isSelected && (
                  <div className="absolute top-5 right-5 px-3 py-1 rounded-full gold-gradient-bg text-black text-[11px] font-bold uppercase tracking-wider">
                    Sucursal Activa
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-[#cba258] font-semibold">
                      {branch.tagline}
                    </div>
                    <h3 className="text-2xl sm:text-3xl font-serif font-bold text-white mt-1">
                      {branch.name}
                    </h3>
                  </div>

                  {/* Details */}
                  <div className="space-y-2.5 text-sm text-[#b2aebc] pt-2">
                    <div className="flex items-start gap-3">
                      <MapPin className="w-4 h-4 text-[#cba258] shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-white block">{branch.address}</strong>
                        <span className="text-xs text-[#8c8896]">{branch.neighborhood}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Clock className="w-4 h-4 text-[#cba258] shrink-0" />
                      <span>{branch.hours}</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <Phone className="w-4 h-4 text-[#cba258] shrink-0" />
                      <a 
                        href={`tel:${branch.phoneClean}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-white underline decoration-dotted"
                      >
                        {branch.phone}
                      </a>
                    </div>
                  </div>

                  {/* Highlights pills */}
                  <div className="flex flex-wrap gap-2 pt-2">
                    {branch.features.map((feat, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded-lg bg-[#202029] border border-[#2e2e3a] text-[11px] text-[#d0ccdb]"
                      >
                        {feat}
                      </span>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="grid grid-cols-2 gap-3 pt-4 border-t border-[#242430]">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleWhatsAppBranch();
                      }}
                      className="py-3 px-3 rounded-xl gold-gradient-bg text-black font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
                    >
                      <MessageCircle className="w-4 h-4" />
                      <span>WhatsApp</span>
                    </button>

                    <a
                      href={branch.mapUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="py-3 px-3 rounded-xl bg-[#22222c] hover:bg-[#2b2b38] text-white border border-[#343444] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Navigation className="w-3.5 h-3.5 text-[#cba258]" />
                      <span>Cómo Llegar</span>
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
