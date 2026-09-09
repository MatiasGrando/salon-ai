import React from 'react';
import { Droplet, Filter, BatteryCharging, Disc, Wrench, CheckCircle2, ArrowRight } from 'lucide-react';
import { siteConfig } from '../data/siteConfig';

const servicesList = [
  {
    icon: Droplet,
    title: "Aceites y Lubricantes",
    subtitle: "Sintéticos, Semisintéticos y Minerales",
    description: "Utilizamos las mejores marcas del mercado con homologaciones oficiales para nafta y diesel. Vaciado por gravedad y colocación exacta por ficha técnica.",
    highlights: ["Liqui Moly, ELF, Motul, Castrol", "Normas Euro 5 y Euro 6 (DPF)", "Control de nivel y reseteo de testigo"]
  },
  {
    icon: Filter,
    title: "Filtros de Alta Calidad",
    subtitle: "Aceite, Aire, Combustible y Habitáculo",
    description: "Protegemos la vida útil de tu motor y la calidad del aire que respirás en el habitáculo. Filtros con retención de micropartículas garantizada.",
    highlights: ["Filtros Mann Filter y Bosch", "Filtros de gasoil trampa de agua", "Filtros de polen con carbón activado"]
  },
  {
    icon: BatteryCharging,
    title: "Baterías y Electricidad",
    subtitle: "Diagnóstico computarizado y reemplazo",
    description: "Medición electrónica de estado de carga, alternador y consumo de arranque. Instalación sin desconfigurar la computadora de tu auto.",
    highlights: ["Baterías Moura, Bosch y Varta", "Baterías especiales EFB / AGM Start-Stop", "Garantía oficial por escrito de hasta 18 meses"]
  },
  {
    icon: Disc,
    title: "Frenos y Seguridad",
    subtitle: "Pastillas, discos y líquido de freno",
    description: "Inspección milimétrica de pastillas y discos. Purgado computarizado de líquido de freno para asegurar una respuesta inmediata al pedal.",
    highlights: ["Pastillas cerámicas sin chillidos", "Rectificación de discos", "Líquidos DOT 4 y DOT 5.1 de alto rendimiento"]
  },
  {
    icon: Wrench,
    title: "Servicio General",
    subtitle: "Chequeo integral de 25 puntos",
    description: "Un control exhaustivo de todos los fluidos vitales: refrigerante, hidráulico, caja y diferencial, junto con inspección visual del tren delantero.",
    highlights: ["Medición de refractómetro de refrigerante", "Chequeo visual de fuelles y extremos", "Informe de estado al retirar"]
  }
];

export default function Services() {
  return (
    <section id="servicios" className="py-20 bg-[#090b0f] relative border-b border-zinc-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Section Title */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-red-950/70 border border-red-700/50 text-red-400 text-xs font-semibold uppercase tracking-wider mb-3">
            <Wrench className="w-3.5 h-3.5" />
            <span>Nuestros Servicios Especializados</span>
          </div>
          <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-white tracking-wide">
            CUIDADO INTEGRAL PARA <span className="text-red-500">TU MOTOR</span>
          </h2>
          <p className="text-zinc-400 text-base sm:text-lg mt-3">
            Trabajamos con procesos estandarizados, equipamiento moderno y las marcas líderes que exige el fabricante de tu auto.
          </p>
        </div>

        {/* Services Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {servicesList.map((srv, idx) => {
            const Icon = srv.icon;
            return (
              <div
                key={idx}
                className="group relative bg-[#11141c] hover:bg-[#141822] rounded-2xl p-6 sm:p-7 border border-zinc-800 hover:border-red-600/50 transition-all duration-300 shadow-xl flex flex-col justify-between"
              >
                {/* Red top border glow on hover */}
                <div className="absolute inset-x-0 top-0 h-1 bg-transparent group-hover:bg-gradient-to-r group-hover:from-red-600 group-hover:to-red-500 rounded-t-2xl transition" />

                <div>
                  <div className="w-14 h-14 rounded-xl bg-zinc-900 border border-zinc-700/80 group-hover:border-red-500/60 flex items-center justify-center text-red-500 mb-5 group-hover:scale-105 transition shadow-inner">
                    <Icon className="w-7 h-7" />
                  </div>

                  <span className="text-xs text-red-400 font-bold uppercase tracking-wider">
                    {srv.subtitle}
                  </span>
                  <h3 className="font-heading text-2xl font-bold text-white mt-1 mb-3 group-hover:text-red-400 transition">
                    {srv.title}
                  </h3>

                  <p className="text-sm text-zinc-300 leading-relaxed mb-6 font-normal">
                    {srv.description}
                  </p>

                  <ul className="space-y-2 mb-6 border-t border-zinc-800/80 pt-4">
                    {srv.highlights.map((h, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                        <CheckCircle2 className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <a
                  href={siteConfig.getWhatsAppLink(`Hola Lubricentro Albarellos, me interesa consultar por el servicio de ${srv.title}.`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-auto inline-flex items-center gap-2 text-xs font-bold text-red-400 hover:text-red-300 uppercase tracking-wider group-hover:translate-x-1 transition"
                >
                  <span>Consultar por este servicio</span>
                  <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            );
          })}

          {/* Card Destacada de Turnos Rápidos */}
          <div className="bg-gradient-to-br from-red-950/80 via-red-900/40 to-[#11141c] rounded-2xl p-6 sm:p-7 border border-red-600/40 shadow-xl flex flex-col justify-between">
            <div>
              <div className="inline-block px-3 py-1 rounded-full bg-red-600 text-white font-heading text-xs font-bold uppercase tracking-wider mb-4">
                Atención Inmediata
              </div>
              <h3 className="font-heading text-2xl sm:text-3xl font-bold text-white mb-3">
                ¿NECESITÁS UN CAMBIO DE ACEITE EN EL DÍA?
              </h3>
              <p className="text-sm text-zinc-200 leading-relaxed mb-6">
                Podés venir sin turno previo o escribirnos por WhatsApp para asegurar tu lugar. Tiempo promedio de service de aceite y filtros: <strong className="text-white">40 minutos</strong>.
              </p>
            </div>

            <a
              href={siteConfig.getWhatsAppLink("Hola Albarellos! Necesito un turno urgente para hoy o mañana.")}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3.5 px-4 rounded-xl bg-white hover:bg-zinc-100 text-zinc-950 font-bold text-sm text-center shadow-lg transition"
            >
              Consultar Disponibilidad Ahora
            </a>
          </div>

        </div>

      </div>
    </section>
  );
}
