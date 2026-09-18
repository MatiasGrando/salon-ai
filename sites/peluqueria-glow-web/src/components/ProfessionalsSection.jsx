import { openBooking } from '../data/glowBooking';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, MessageCircle, Sparkles, Maximize2, MapPin } from 'lucide-react';
import { BRANCHES } from '../data/glowData';
import { CatalogBranchSelector, CatalogStatus, CatalogImage } from './BranchCatalog';

export default function ProfessionalsSection({ selectedBranch, setSelectedBranch, catalog }) {
  const [selectedPro, setSelectedPro] = useState(null);
  const [modalImageFailed, setModalImageFailed] = useState(false);

  // Cerrar modal con tecla Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setSelectedPro(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Bloquear scroll al abrir modal
  useEffect(() => {
    if (selectedPro) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [selectedPro]);

  const filtered = catalog.professionals;
  const showModalImage = Boolean(selectedPro?.image && !modalImageFailed);

  const handleBookWithPro = (pro, e) => { e?.stopPropagation(); openBooking(selectedBranch); };

  return (
    <section 
      id="profesionales" 
      className="py-18 sm:py-26 lg:py-32 bg-[#090a0e] text-[#f2f0eb] relative overflow-hidden selection:bg-[#cba258] selection:text-black border-t border-white/5"
    >
      {/* ─── FONDOS Y ARCOS DORADOS ELEGANTES (COMO EN LA REFERENCIA) ─── */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[850px] h-[350px] bg-[#cba258]/8 blur-[130px] rounded-full" />
        
        {/* Arcos dorados sutiles en los laterales */}
        <svg className="absolute -top-12 left-0 w-80 h-80 opacity-20 stroke-[#cba258] pointer-events-none" viewBox="0 0 300 300" fill="none">
          <path d="M-50 250 A200 200 0 0 1 250 -50" strokeWidth="1.5" />
          <path d="M-20 280 A230 230 0 0 1 280 -20" strokeWidth="0.8" strokeDasharray="6 6" />
        </svg>

        <svg className="absolute -bottom-16 right-0 w-96 h-96 opacity-20 stroke-[#cba258] pointer-events-none" viewBox="0 0 350 350" fill="none">
          <path d="M350 100 A250 250 0 0 1 100 350" strokeWidth="1.5" />
          <path d="M380 70 A280 280 0 0 1 70 380" strokeWidth="0.8" strokeDasharray="6 6" />
        </svg>
      </div>

      <div className="w-[calc(100%-32px)] sm:w-[calc(100%-64px)] max-w-[1320px] mx-auto relative z-10">
        
        {/* ─── ENCABEZADO DE SECCIÓN ─── */}
        <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-12 space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#181922] border border-[#cba258]/35 text-[#cba258] text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.3em]">
            <Sparkles className="w-3 h-3 text-[#cba258]" />
            <span>STAFF DE EXCELENCIA · EQUIPO</span>
          </div>

          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-serif font-bold text-white tracking-tight">
            Nuestros Profesionales
          </h2>

          <p className="text-[#a5a1b0] text-sm sm:text-base leading-relaxed">
            Elegí con quién querés atenderte al reservar tu turno. Un equipo de coloristas, visagistas y estilistas formados para cuidar y realzar tu cabello con la máxima dedicación.
          </p>
        </div>

        <CatalogBranchSelector selectedBranch={selectedBranch} setSelectedBranch={setSelectedBranch} label="Sede de profesionales" />
        <CatalogStatus catalog={catalog} count={filtered.length} noun="profesionales" />

        {/* ─── GRILLA DE PROFESIONALES (FORMATO IMAGEN 2: FOTOS GRANDES CON DESCRIPCIÓN) ─── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-10">
          {filtered.map((pro) => (
            <div
              key={pro.id}
              onClick={() => { setModalImageFailed(false); setSelectedPro(pro); }}
              className="glow-professionals__card group flex flex-row sm:flex-col cursor-pointer transition-all duration-300 rounded-2xl border border-white/10 bg-[#121319] overflow-hidden sm:rounded-none sm:border-0 sm:bg-transparent sm:overflow-visible"
            >
              {/* Tarjeta de Foto Grande con Relación de Aspecto Generosa */}
              <div className="glow-professionals__portrait relative w-[clamp(112px,36vw,140px)] min-h-[168px] shrink-0 sm:w-full sm:min-h-0 sm:aspect-[4/5] sm:rounded-[28px] overflow-hidden bg-[#151620] border-r sm:border border-white/10 group-hover:border-[#cba258]/70 shadow-lg group-hover:shadow-[0_16px_45px_rgba(203,162,88,0.2)] transition-all duration-500">
                <CatalogImage key={pro.image || pro.id}
                  src={pro.image}
                  alt={pro.name}
                  className="w-full h-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-106"
                  loading="lazy"
                />

                {/* Sutil viñeta para contraste */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-40 group-hover:opacity-60 transition-opacity duration-300" />

                {/* Badge de Sede en esquina superior */}
                <div className="hidden sm:block absolute top-3.5 right-3.5 bg-black/70 backdrop-blur-md border border-white/10 text-[#dedad4] text-[10px] px-2.5 py-1 rounded-full font-medium">
                  {pro.branchName}
                </div>

                {/* Indicador flotante para agrandar en hover */}
                <div className="hidden sm:flex absolute bottom-4 right-4 w-9 h-9 rounded-full bg-black/75 backdrop-blur-md border border-[#cba258]/50 text-[#cba258] items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0 shadow-md">
                  <Maximize2 className="w-4 h-4" />
                </div>
              </div>

              {/* Textos inferiores alineados como en la referencia */}
              <div className="glow-professionals__summary min-w-0 flex-1 flex flex-col justify-center py-3 px-3 text-left space-y-1.5 sm:block sm:pt-4 sm:pb-0 sm:text-center sm:px-2">
                <h3 className="font-serif font-bold text-[18px] sm:text-[25px] text-white group-hover:text-[#cba258] transition-colors leading-tight">
                  {pro.name}
                </h3>

                <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] sm:tracking-[0.25em] font-semibold text-[#cba258]">
                  {pro.taglineRole}
                </p>

                <p className="text-[11px] sm:text-[13px] text-[#9b97a6] group-hover:text-[#dedad4] transition-colors line-clamp-2 max-w-sm sm:mx-auto leading-relaxed pt-0.5">
                  {pro.shortDescription || 'Perfil del equipo de esta sede.'}
                </p>
                
                <span className="inline-block text-[10px] text-[#7d7988] font-medium pt-1 group-hover:text-[#cba258]/80 transition-colors">
                  Ver perfil completo →
                </span>
              </div>
            </div>
          ))}
        </div>

      </div>

      {/* ─── MODAL AMPLIADO (casi pantalla completa en mobile, 900px en desktop) ─── */}
      {selectedPro && createPortal(
        <div
          role="dialog" aria-modal="true" aria-labelledby="glow-professional-name"
          className="fixed inset-0 z-[100] flex items-center justify-center sm:p-6 bg-black/90 backdrop-blur-md animate-fadeIn"
          onClick={() => setSelectedPro(null)}
        >
          {/* En móvil, el perfil ocupa la pantalla y queda por encima de la navegación fija. */}
          <div
            className={`relative w-full ${showModalImage ? 'h-[100dvh]' : 'h-auto max-h-[calc(100dvh-32px)] mx-4 rounded-[24px]'} sm:h-auto sm:max-h-[95dvh] sm:mx-0 sm:max-w-3xl bg-[#0f1018] border border-[#cba258]/40 sm:rounded-[28px] overflow-hidden shadow-[0_30px_80px_rgba(0,0,0,0.95)] flex flex-col sm:flex-row`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Botón cerrar */}
            <button
              onClick={() => setSelectedPro(null)}
              className="absolute top-[calc(16px+env(safe-area-inset-top,0px))] right-4 z-20 w-11 h-11 rounded-full bg-black/70 border border-white/20 text-white/80 hover:text-white hover:border-[#cba258] flex items-center justify-center transition-all cursor-pointer"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>

            {/* No reservar un bloque de foto si el perfil no tiene imagen o falla la carga. */}
            {showModalImage && <div className="w-full sm:w-[42%] h-[34dvh] min-h-[200px] max-h-[300px] sm:h-auto sm:min-h-0 sm:max-h-none relative shrink-0 bg-black">
              <img
                src={selectedPro.image}
                alt={selectedPro.name}
                className="w-full h-full object-cover object-center"
                onError={() => setModalImageFailed(true)}
              />
              {/* Degradé que funde hacia el panel de texto */}
              <div className="absolute inset-0 bg-gradient-to-t sm:bg-gradient-to-r from-[#0f1018]/90 via-[#0f1018]/20 to-transparent" />
              {/* Nombre superpuesto en mobile (visible solo en mobile sobre la foto) */}
              <div className="absolute bottom-4 left-5 sm:hidden">
                <p className="text-[11px] uppercase tracking-[0.25em] text-[#cba258] font-bold">
                  {selectedPro.role}
                </p>
                <h3 id="glow-professional-name" className="text-3xl font-serif font-bold text-white leading-tight mt-0.5">
                  {selectedPro.name}
                </h3>
                <div className="flex items-center gap-1.5 text-[12px] text-[#a09ca8] mt-1">
                  <MapPin className="w-3.5 h-3.5 text-[#cba258]" />
                  <span>{selectedPro.branchName}</span>
                </div>
              </div>
            </div>}

            {/* CONTENIDO — scrolleable en mobile */}
            <div className={`min-h-0 flex-1 overflow-y-auto px-6 sm:px-9 ${showModalImage ? 'pt-6' : 'pt-[calc(80px+env(safe-area-inset-top,0px))]'} pb-[calc(24px+env(safe-area-inset-bottom,0px))] sm:py-8 flex flex-col gap-6`}>
              
              {/* Sin foto, el nombre pasa al encabezado del contenido. */}
              <div className={`${showModalImage ? 'hidden sm:block' : 'block'} space-y-1.5`}>
                <p className="text-[11px] uppercase tracking-[0.3em] text-[#cba258] font-bold">
                  {selectedPro.role}
                </p>
                <h3 id={showModalImage ? undefined : 'glow-professional-name'} className="text-3xl sm:text-4xl font-serif font-bold text-white leading-tight">
                  {selectedPro.name}
                </h3>
                <div className="flex items-center gap-1.5 text-sm text-[#a09ca8] pt-0.5">
                  <MapPin className="w-4 h-4 text-[#cba258]" />
                  <span>Sede: <strong className="text-white">{selectedPro.branchName}</strong></span>
                </div>
              </div>

              {/* Separador */}
              <div className="border-t border-white/10" />

              {/* Biografía — tamaño de texto legible */}
              <div className="space-y-2">
                <span className="text-[10px] uppercase font-bold tracking-[0.25em] text-[#7d7988] block">
                  Sobre este profesional
                </span>
                <p className="text-sm sm:text-base text-[#dedad4] leading-relaxed">
                  {selectedPro.fullBio || 'Este profesional todavía no tiene una descripción publicada.'}
                </p>
              </div>

              {/* CTA */}
              <div className="mt-auto pt-2">
                <button
                  onClick={(e) => handleBookWithPro(selectedPro, e)}
                  className="w-full py-4 px-5 rounded-xl gold-gradient-bg text-black font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 hover:opacity-95 transition-all shadow-[0_8px_25px_rgba(203,162,88,0.35)] cursor-pointer"
                >
                  <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span>Solicitar Turno con {selectedPro.name}</span>
                </button>
              </div>

            </div>
          </div>
        </div>, document.body
      )}

    </section>
  );
}
