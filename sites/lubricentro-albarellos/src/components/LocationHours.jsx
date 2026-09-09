import React from 'react';
import { MapPin, Clock, Phone, MessageCircle, Navigation, ExternalLink } from 'lucide-react';
import { siteConfig } from '../data/siteConfig';
import { InstagramIcon, FacebookIcon } from './SocialIcons';

export default function LocationHours() {
  return (
    <section id="ubicacion" className="py-20 bg-[#0c0f16] border-b border-zinc-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Info Column */}
          <div className="lg:col-span-6 space-y-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-950/60 border border-red-700/40 text-red-400 text-xs font-semibold uppercase tracking-wider mb-3">
                <MapPin className="w-3.5 h-3.5" />
                <span>Vení a Conocernos</span>
              </div>
              <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-white tracking-wide">
                UBICACIÓN Y <span className="text-red-500">HORARIOS</span>
              </h2>
              <p className="text-zinc-400 text-sm sm:text-base mt-2">
                Estamos ubicados en una zona de fácil acceso para que puedas dejar tu auto o esperarlo cómodamente.
              </p>
            </div>

            <div className="space-y-4">
              {/* Dirección */}
              <div className="flex items-start gap-4 p-4 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <div className="w-10 h-10 rounded-lg bg-red-600/20 text-red-400 flex items-center justify-center shrink-0 mt-0.5">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-heading text-lg font-bold text-white">Dirección</h4>
                  <p className="text-sm text-zinc-300 font-medium">{siteConfig.address}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">{siteConfig.locationName}</p>
                </div>
              </div>

              {/* Horarios */}
              <div className="flex items-start gap-4 p-4 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <div className="w-10 h-10 rounded-lg bg-red-600/20 text-red-400 flex items-center justify-center shrink-0 mt-0.5">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-heading text-lg font-bold text-white">Horarios de Atención</h4>
                  <div className="text-xs sm:text-sm text-zinc-300 space-y-0.5 mt-1">
                    <p><strong className="text-white">Lunes a Viernes:</strong> 8:00 a 18:00 hs</p>
                    <p><strong className="text-white">Sábados:</strong> 8:00 a 14:00 hs</p>
                    <p className="text-zinc-400"><strong className="text-zinc-400">Domingos:</strong> Cerrado</p>
                  </div>
                </div>
              </div>

              {/* Teléfono & WhatsApp */}
              <div className="flex items-start gap-4 p-4 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <div className="w-10 h-10 rounded-lg bg-emerald-600/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                  <Phone className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-heading text-lg font-bold text-white">Contacto Directo</h4>
                  <p className="text-sm text-zinc-300">
                    Tel: <a href={`tel:${siteConfig.phoneRaw}`} className="hover:text-white font-semibold">{siteConfig.phone}</a>
                  </p>
                  <a
                    href={siteConfig.getWhatsAppLink("Hola Albarellos! Me gustaría consultar disponibilidad.")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 font-semibold mt-1 transition"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Escribir por WhatsApp
                  </a>
                </div>
              </div>
            </div>

            {/* CTA Navegación y Redes */}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <a
                href={siteConfig.googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-sm border border-zinc-700 transition"
              >
                <Navigation className="w-4 h-4 text-red-500" />
                <span>Abrir en Google Maps</span>
                <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
              </a>

              <a
                href={siteConfig.socials.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-pink-400 font-semibold text-xs border border-zinc-800 transition"
              >
                <InstagramIcon className="w-4 h-4" />
                <span>@lubricentroalbarellos</span>
              </a>

              <a
                href={siteConfig.socials.facebook}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-blue-400 font-semibold text-xs border border-zinc-800 transition"
              >
                <FacebookIcon className="w-4 h-4" />
                <span>Facebook</span>
              </a>
            </div>
          </div>

          {/* Map Column */}
          <div className="lg:col-span-6">
            <div className="relative rounded-2xl overflow-hidden border-2 border-zinc-800 shadow-2xl bg-zinc-900 h-[380px] sm:h-[420px] flex items-center justify-center group">
              <iframe
                title="Mapa Lubricentro Albarellos"
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3285.4950346049073!2d-58.50347292350849!3d-34.56634865552395!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x95bcb6e87f1ea567%3A0xc4f54e10ba35f488!2sAv.%20Albarellos%2C%20Buenos%20Aires!5e0!3m2!1ses!2sar!4v1700000000000!5m2!1ses!2sar"
                className="w-full h-full border-0 opacity-90 group-hover:opacity-100 transition duration-500"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />

              <div className="absolute bottom-4 left-4 right-4 sm:right-auto bg-[#0d1017]/95 border border-red-700/50 p-4 rounded-xl shadow-xl backdrop-blur-md flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-600 flex items-center justify-center text-white shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-heading text-sm font-bold text-white">LUBRICENTRO ALBARELLOS</p>
                  <p className="text-xs text-zinc-400">{siteConfig.address}, {siteConfig.locationName}</p>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
