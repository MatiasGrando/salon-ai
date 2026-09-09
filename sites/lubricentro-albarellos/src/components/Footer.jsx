import React from 'react';
import { siteConfig } from '../data/siteConfig';
import { Phone, MapPin, ChevronRight } from 'lucide-react';
import { InstagramIcon, FacebookIcon, WhatsAppIcon } from './SocialIcons';

export default function Footer() {
  return (
    <footer className="bg-[#07090c] border-t border-zinc-900 text-zinc-400 text-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">

          {/* Brand info */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center p-2 shadow-lg shadow-red-950/60 border border-red-400/40">
                <svg viewBox="0 0 100 100" className="w-full h-full filter drop-shadow">
                  <path d="M50 14 C50 14, 25 50, 25 67 C25 80 36 90 50 90 C64 90 75 80 75 67 C75 50 50 14 50 14 Z" fill="#ffffff" />
                </svg>
              </div>
              <span className="font-heading text-lg font-bold text-white tracking-wider">
                LUBRICENTRO <span className="text-red-500">ALBARELLOS</span>
              </span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Cuidamos tu motor para que vos sigas avanzando. Aceites sintéticos homologados, filtros originales, baterías y revisión integral de frenos.
            </p>
            <p className="text-xs font-semibold text-zinc-300">
              "Más que un cambio • Pasión por tu motor"
            </p>

            {/* Social icons */}
            <div className="flex items-center gap-3 pt-2">
              <a
                href={siteConfig.socials.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-pink-600/30 text-zinc-300 hover:text-pink-400 border border-zinc-700 flex items-center justify-center transition"
                aria-label="Instagram"
              >
                <InstagramIcon className="w-4 h-4" />
              </a>
              <a
                href={siteConfig.socials.facebook}
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-blue-600/30 text-zinc-300 hover:text-blue-400 border border-zinc-700 flex items-center justify-center transition"
                aria-label="Facebook"
              >
                <FacebookIcon className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Enlaces rápidos */}
          <div>
            <h4 className="font-heading text-base font-bold text-white mb-4 tracking-wider uppercase">
              Navegación
            </h4>
            <ul className="space-y-2 text-xs">
              <li>
                <a href="#consulta-patente" className="hover:text-red-400 transition flex items-center gap-1.5">
                  <ChevronRight className="w-3.5 h-3.5 text-red-500" />
                  Consultar Servicios por Patente
                </a>
              </li>
              <li>
                <a href="#servicios" className="hover:text-red-400 transition flex items-center gap-1.5">
                  <ChevronRight className="w-3.5 h-3.5 text-red-500" />
                  Cambio de Aceite y Filtros
                </a>
              </li>
              <li>
                <a href="#servicios" className="hover:text-red-400 transition flex items-center gap-1.5">
                  <ChevronRight className="w-3.5 h-3.5 text-red-500" />
                  Pastillas y Líquido de Frenos
                </a>
              </li>
              <li>
                <a href="#servicios" className="hover:text-red-400 transition flex items-center gap-1.5">
                  <ChevronRight className="w-3.5 h-3.5 text-red-500" />
                  Baterías con Garantía Oficial
                </a>
              </li>
              <li>
                <a href="#marcas" className="hover:text-red-400 transition flex items-center gap-1.5">
                  <ChevronRight className="w-3.5 h-3.5 text-red-500" />
                  Marcas Homologadas (Liqui Moly, ELF)
                </a>
              </li>
            </ul>
          </div>

          {/* Horarios actualizados */}
          <div>
            <h4 className="font-heading text-base font-bold text-white mb-4 tracking-wider uppercase">
              Horarios de Taller
            </h4>
            <div className="space-y-2 text-xs text-zinc-300">
              <p><strong className="text-white">Lunes a Viernes:</strong><br />08:00 a 18:00 hs</p>
              <p><strong className="text-white">Sábados:</strong><br />08:00 a 14:00 hs</p>
              <p className="text-zinc-500"><strong className="text-zinc-400">Domingos:</strong> Cerrado</p>
            </div>
          </div>

          {/* Contacto directo */}
          <div>
            <h4 className="font-heading text-base font-bold text-white mb-4 tracking-wider uppercase">
              Atención y Turnos
            </h4>
            <div className="space-y-3 text-xs">
              <p className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-red-500 shrink-0" />
                <span>{siteConfig.fullAddress}</span>
              </p>
              <p className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-red-500 shrink-0" />
                <a href={`tel:${siteConfig.phoneRaw}`} className="hover:text-white">{siteConfig.phone}</a>
              </p>
              <div className="pt-2">
                <a
                  href={siteConfig.getWhatsAppLink()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 text-xs font-semibold transition"
                >
                  <WhatsAppIcon className="w-4 h-4" />
                  <span>WhatsApp</span>
                </a>
              </div>
            </div>
          </div>

        </div>

        <div className="pt-8 border-t border-zinc-900/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
          <p>© {new Date().getFullYear()} Lubricentro Albarellos. Todos los derechos reservados.</p>
          <p>Pasión por tu motor • Villa Urquiza, CABA</p>
        </div>
      </div>
    </footer>
  );
}
