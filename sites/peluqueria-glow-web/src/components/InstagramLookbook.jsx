import React, { useState } from 'react';
import { Heart, Eye, X, ExternalLink } from 'lucide-react';

const InstagramIcon = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5"/>
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>
  </svg>
);
import { LOOKBOOK_ITEMS, BRANCHES } from '../data/glowData';

export default function InstagramLookbook({ selectedBranch }) {
  const [activeModalItem, setActiveModalItem] = useState(null);
  const branch = BRANCHES[selectedBranch];

  return (
    <section id="lookbook" className="py-16 sm:py-24 bg-[#0e0e10] relative">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-10 space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[#cba258] font-semibold">
            <InstagramIcon className="w-4 h-4" />
            <span>@peluqueriaglow en Instagram</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-serif font-bold text-white">
            Nuestro Lookbook de Tendencias
          </h2>
          <p className="text-[#9e9aa8] text-sm sm:text-base">
            Inspirate con los últimos trabajos realizados por nuestros coloristas en Villa Urquiza y Cañitas.
          </p>
        </div>

        {/* Gallery Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-5">
          {LOOKBOOK_ITEMS.map((item) => (
            <div
              key={item.id}
              onClick={() => setActiveModalItem(item)}
              className="group relative aspect-square rounded-2xl overflow-hidden bg-[#181820] border border-[#262632] cursor-pointer shadow-md"
            >
              <img
                src={item.img}
                alt={item.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                loading="lazy"
              />

              {/* Hover Overlay */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-3 sm:p-4 text-white">
                <div className="flex justify-between items-center text-xs">
                  <span className="px-2 py-0.5 rounded-full bg-black/50 text-[#cba258] border border-white/10 text-[10px]">
                    Sede {item.branch}
                  </span>
                  <span className="flex items-center gap-1 text-[11px]">
                    <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
                    {item.likes}
                  </span>
                </div>

                <div>
                  <div className="text-xs sm:text-sm font-serif font-bold line-clamp-1">{item.title}</div>
                  <div className="text-[10px] text-[#b0acbb] uppercase">{item.category}</div>
                </div>
              </div>

              {/* Mobile quick badge */}
              <div className="sm:hidden absolute bottom-2 left-2 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-sm text-[10px] text-white">
                {item.category}
              </div>
            </div>
          ))}
        </div>

        {/* Call to follow on Instagram */}
        <div className="mt-10 text-center">
          <a
            href="https://www.instagram.com/peluqueriaglow/?hl=es"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-pink-600 via-purple-600 to-amber-600 text-white font-bold text-xs uppercase tracking-wider hover:opacity-90 transition-opacity shadow-lg"
          >
            <InstagramIcon className="w-4 h-4" />
            <span>Ver más looks en @peluqueriaglow</span>
            <ExternalLink className="w-3.5 h-3.5 ml-1" />
          </a>
        </div>

        {/* Lightbox Modal */}
        {activeModalItem && (
          <div 
            onClick={() => setActiveModalItem(null)}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          >
            <div 
              onClick={(e) => e.stopPropagation()}
              className="bg-[#141418] border border-[#2e2e3a] rounded-3xl max-w-md w-full overflow-hidden shadow-2xl relative"
            >
              <button
                onClick={() => setActiveModalItem(null)}
                className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              <img
                src={activeModalItem.img}
                alt={activeModalItem.title}
                className="w-full h-72 object-cover"
              />

              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between text-xs text-[#cba258]">
                  <span className="uppercase font-semibold tracking-wider">{activeModalItem.category}</span>
                  <span>Sede {activeModalItem.branch}</span>
                </div>
                <h3 className="text-xl font-serif font-bold text-white">
                  {activeModalItem.title}
                </h3>
                <p className="text-xs text-[#9d99a8]">
                  ¿Te gustaría lucir un estilo como este? Podés pedirlo como referencia al momento de solicitar tu turno.
                </p>

                <button
                  onClick={() => {
                    const text = encodeURIComponent(
                      `¡Hola Glow! Me encantó el look "${activeModalItem.title}" del lookbook y quisiera saber disponibilidad en la sucursal de ${branch.name}.`
                    );
                    window.open(`https://wa.me/${branch.whatsapp}?text=${text}`, '_blank');
                  }}
                  className="w-full py-3 rounded-xl gold-gradient-bg text-black font-bold text-xs uppercase tracking-wider"
                >
                  Consultar por este look en {branch.name}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </section>
  );
}
