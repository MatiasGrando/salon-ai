import { openBooking } from '../data/glowBooking';
import React from 'react';
import { Sparkles, Calendar, MessageCircle, MapPin, Scissors } from 'lucide-react';
import { BRANCHES } from '../data/glowData';

export default function MobileBottomNav({ selectedBranch, setSelectedBranch }) {
  const branch = BRANCHES[selectedBranch];

  const handleWhatsApp = () => openBooking(selectedBranch);

  const toggleBranch = () => {
    setSelectedBranch(selectedBranch === 'urquiza' ? 'canitas' : 'urquiza');
  };

  return (
    <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#121217]/95 backdrop-blur-lg border-t border-[#262632] px-3 py-2 shadow-2xl">
      <div className="flex items-center justify-between gap-2 max-w-md mx-auto">
        
        {/* Toggle branch button */}
        <button
          onClick={toggleBranch}
          className="flex-1 flex flex-col items-center justify-center py-1 rounded-xl bg-[#1b1b24] text-[10px] text-[#c0bcc8] border border-[#2d2d3c]"
        >
          <MapPin className="w-4 h-4 text-[#cba258] mb-0.5" />
          <span className="font-semibold text-white truncate max-w-[85px]">
            {selectedBranch === 'urquiza' ? 'Urquiza' : 'Cañitas'}
          </span>
        </button>

        {/* Services shortcut */}
        <a
          href="#servicios"
          className="flex-1 flex flex-col items-center justify-center py-1 rounded-xl bg-[#1b1b24] text-[10px] text-[#c0bcc8] border border-[#2d2d3c]"
        >
          <Scissors className="w-4 h-4 text-[#cba258] mb-0.5" />
          <span>Servicios</span>
        </a>

        {/* Lookbook shortcut */}
        <a
          href="#lookbook"
          className="flex-1 flex flex-col items-center justify-center py-1 rounded-xl bg-[#1b1b24] text-[10px] text-[#c0bcc8] border border-[#2d2d3c]"
        >
          <Sparkles className="w-4 h-4 text-[#cba258] mb-0.5" />
          <span>Lookbook</span>
        </a>

        {/* WhatsApp direct booking prominent CTA */}
        <button
          onClick={handleWhatsApp}
          className="flex-[1.5] py-2 px-3 rounded-xl gold-gradient-bg text-black font-bold text-xs uppercase tracking-wide flex items-center justify-center gap-1.5 shadow-lg shadow-[#cba258]/20 active:scale-95 transition-transform"
        >
          <MessageCircle className="w-4 h-4 text-black shrink-0" />
          <span className="truncate">Turno</span>
        </button>

      </div>
    </div>
  );
}
