import React from 'react';
import { Shield, Clock, Search, ThumbsUp } from 'lucide-react';

const reasons = [
  {
    icon: Search,
    title: "Historial Digital por Patente",
    description: "Olvidate del papelito que se borra en el parabrisas. Cada servicio queda registrado en nuestro sistema para que consultes cuándo te toca volver desde tu celular."
  },
  {
    icon: Shield,
    title: "Transparencia Absoluta",
    description: "Abrimos los envases de aceite y repuestos delante tuyo. Siempre te devolvemos los filtros y piezas sustituidas para tu total tranquilidad."
  },
  {
    icon: Clock,
    title: "Sin Pérdidas de Tiempo",
    description: "Procesos optimizados en bahías de trabajo equipadas. La mayoría de los mantenimientos regulares se realizan en menos de 45 minutos."
  },
  {
    icon: ThumbsUp,
    title: "Pasión por los Fierros",
    description: "No somos solo un lubricentro; somos mecánicos dedicados que cuidamos tu vehículo con la misma atención y dedicación que si fuera el nuestro."
  }
];

export default function WhyUs() {
  return (
    <section id="nosotros" className="py-20 bg-[#090b0f] border-b border-zinc-800 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-white tracking-wide">
            ¿POR QUÉ ELEGIR <span className="text-red-500">LUBRICENTRO ALBARELLOS</span>?
          </h2>
          <p className="text-zinc-400 text-base sm:text-lg mt-3">
            Combinamos la calidez y honestidad del taller de barrio con la tecnología y precisión de un centro de servicio de primera línea.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {reasons.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={idx}
                className="bg-[#11141c] border border-zinc-800 p-6 rounded-2xl flex flex-col items-start hover:border-red-600/50 transition duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-red-600/20 text-red-500 border border-red-500/40 flex items-center justify-center mb-5">
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="font-heading text-xl font-bold text-white mb-2">
                  {item.title}
                </h3>
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  {item.description}
                </p>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
