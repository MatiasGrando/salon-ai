import React, { useState } from 'react';
import { X } from 'lucide-react';
import { siteConfig } from '../data/siteConfig';
import { WhatsAppIcon } from './SocialIcons';

export default function FloatingWhatsApp() {
  const [tooltipDismissed, setTooltipDismissed] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* Tooltip speech bubble */}
      {!tooltipDismissed && (
        <div className="relative mb-3 mr-1 bg-zinc-900 text-white text-xs py-2 px-3 rounded-xl border border-zinc-700 shadow-2xl flex items-center gap-2 animate-bounce">
          <span>¿Tenés dudas o querés pedir turno?</span>
          <button
            onClick={() => setTooltipDismissed(true)}
            className="text-zinc-400 hover:text-white p-0.5"
            aria-label="Cerrar mensaje"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* WhatsApp Action Button */}
      <a
        href={siteConfig.getWhatsAppLink("Hola Lubricentro Albarellos! Les escribo desde la web.")}
        target="_blank"
        rel="noopener noreferrer"
        className="group relative flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white shadow-xl shadow-emerald-950/60 hover:scale-110 transition-all duration-300"
        aria-label="Contactar por WhatsApp"
      >
        {/* Pulsing ring */}
        <span className="absolute -inset-1 rounded-full bg-emerald-500/40 animate-ping pointer-events-none group-hover:opacity-0" />
        <WhatsAppIcon className="w-7 h-7 fill-white relative z-10" />
      </a>
    </div>
  );
}
