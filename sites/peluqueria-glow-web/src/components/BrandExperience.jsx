import React from 'react';

export default function BrandExperience() {
  const editorialPoints = [
    {
      num: "01",
      title: "Diagnóstico antes de empezar",
      description: "Analizamos tu cabello, antecedentes y objetivo para definir el tratamiento adecuado y respetuoso con la fibra."
    },
    {
      num: "02",
      title: "Técnicas personalizadas",
      description: "Color, iluminación, cortes y tratamientos adaptados a tu base natural, textura y estilo de vida."
    },
    {
      num: "03",
      title: "Productos profesionales",
      description: "Líneas internacionales seleccionadas para priorizar resultado visible, brillo espejo y máxima salud capilar."
    },
    {
      num: "04",
      title: "Experiencia Glow",
      description: "Atención personalizada, asesoramiento cercano y un espacio pensado para disfrutar cada minuto del proceso."
    }
  ];

  return (
    <section 
      id="por-que-glow" 
      className="py-16 sm:py-24 lg:py-28 bg-[#faf8f4] text-[#1c1b22] relative overflow-hidden selection:bg-[#cba258] selection:text-black border-t border-[#ebdcca]/50"
    >
      {/* ─── BLOQUE VISUAL DE FONDO DESDE EL BORDE IZQUIERDO HASTA LA MODELO ─── */}
      <div 
        className="absolute top-0 bottom-0 left-0 w-full lg:w-[44%] xl:w-[42%] bg-gradient-to-r from-[#ebdcca] via-[#f1e5d7] to-[#faf8f4] pointer-events-none z-0"
      >
        {/* Halo de luz cálida difusa */}
        <div className="absolute top-1/4 left-1/4 w-80 h-80 bg-white/50 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 left-12 w-64 h-64 bg-[#cba258]/15 rounded-full blur-2xl pointer-events-none" />
        
        {/* Trazo decorativo curvo orgánico */}
        <svg className="absolute -top-10 left-0 w-96 h-96 opacity-25 stroke-[#c4ab80] pointer-events-none" viewBox="0 0 400 400" fill="none">
          <circle cx="150" cy="150" r="180" strokeWidth="1" strokeDasharray="4 4" />
          <path d="M50 350 C180 300, 250 150, 380 50" strokeWidth="1.2" />
        </svg>

        {/* Transición suave hacia el contenido derecho */}
        <div className="absolute inset-y-0 right-0 w-28 bg-gradient-to-r from-transparent to-[#faf8f4] pointer-events-none" />
      </div>

      {/* Sutil halo dorado superior derecho */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-[#ebdcca]/30 rounded-full blur-[100px] pointer-events-none z-0" />

      <div className="w-[calc(100%-32px)] sm:w-[calc(100%-64px)] max-w-[1360px] mx-auto relative z-10">
        
        {/* ─── COMPOSICIÓN EDITORIAL: WRAPPER IZQUIERDO (MODELO INTEGRADA) + WRAPPER DERECHO ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center">
          
          {/* ─── WRAPPER IZQUIERDO: MODELO RECORTADA INTEGRADA AL BLOQUE VISUAL ─── */}
          <div className="lg:col-span-5 relative flex flex-col items-center justify-end min-h-[480px] sm:min-h-[580px] lg:min-h-[660px]">
            
            {/* Halo suave detrás de la silueta */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] h-[340px] rounded-full bg-[#dfceb7]/50 blur-3xl pointer-events-none" />

            {/* Silueta de la modelo PNG transparente sin contenedor rígido de card */}
            <div className="relative w-full flex items-end justify-center">
              <picture>
                <source srcSet="/modelo-recortada.webp" type="image/webp" />
                <img 
                  src="/modelo-recortada.png" 
                  alt="La Filosofía Glow - Modelo de autor" 
                  className="w-auto max-h-[500px] sm:max-h-[600px] lg:max-h-[660px] object-contain drop-shadow-[0_25px_45px_rgba(150,110,60,0.24)] transform hover:scale-[1.02] transition-transform duration-700 ease-out"
                  loading="lazy"
                />
              </picture>

              {/* Cita editorial flotante y sutil integrada abajo */}
              <div className="absolute bottom-2 left-2 sm:left-4 bg-[#faf5ed]/92 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-[#ebdcca] shadow-sm max-w-[270px]">
                <p className="font-serif italic text-[#2c2933] text-xs sm:text-[13px] leading-snug">
                  “Cuidado real. Resultados que se sienten.”
                </p>
                <p className="text-[10px] tracking-widest text-[#a87c2e] uppercase font-bold mt-0.5">
                  — Glow Peluquería & Barber
                </p>
              </div>
            </div>

          </div>

          {/* ─── WRAPPER DERECHO: CONTENIDO EDITORIAL FLUIDO Y ELEGANTE ─── */}
          <div className="lg:col-span-7 space-y-8 lg:pl-6 py-4 sm:py-8">
            
            {/* Encabezado del Manifiesto */}
            <div className="space-y-3.5">
              <div className="inline-flex items-center gap-2 text-[#a87c2e] text-xs font-bold uppercase tracking-[0.3em]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#a87c2e]" />
                <span>POR QUÉ GLOW</span>
                <span className="text-[#a87c2e]/40">·</span>
                <span>LA FILOSOFÍA GLOW</span>
              </div>

              <h2 className="text-3xl sm:text-4xl lg:text-[45px] font-serif font-bold text-[#19181f] leading-[1.16] tracking-tight">
                No se trata solo de cambiar tu pelo. <br />
                <span className="font-serif italic font-normal text-[#b38332] inline-block mt-1">
                  Se trata de hacerlo bien.
                </span>
              </h2>

              <p className="text-[#2e2c36] text-base sm:text-lg font-medium leading-relaxed pt-1">
                Más que una peluquería, un espacio donde conectar con tu mejor versión.
              </p>

              <p className="text-[#5d5968] text-sm sm:text-[15px] leading-relaxed max-w-xl">
                Cada servicio parte de entender tu cabello, tu estilo y el resultado que buscás. Trabajamos con diagnóstico previo, técnicas personalizadas y productos profesionales para cuidar el pelo durante todo el proceso.
              </p>
            </div>

            {/* ─── LISTA EDITORIAL 01–04 (SIN CAJAS, CON AIRE Y FLUIDEZ) ─── */}
            <div className="pt-2 space-y-5">
              {editorialPoints.map((item, idx) => (
                <div 
                  key={item.num}
                  className={`flex items-start gap-4 sm:gap-6 pb-5 ${
                    idx !== editorialPoints.length - 1 ? 'border-b border-[#e5d9c7]/80' : ''
                  } group transition-all duration-300`}
                >
                  <span className="font-serif italic font-semibold text-lg sm:text-xl text-[#b58638] shrink-0 pt-0.5 w-6 select-none group-hover:translate-x-0.5 transition-transform">
                    {item.num}
                  </span>

                  <div className="space-y-1">
                    <h3 className="font-serif font-bold text-base sm:text-lg text-[#1c1b22] group-hover:text-[#b58638] transition-colors leading-snug">
                      {item.title}
                    </h3>
                    <p className="text-xs sm:text-[14px] text-[#635f6e] leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Cierre con firma de autor */}
            <div className="pt-6 border-t border-[#e2d5c1] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="font-serif italic text-lg sm:text-xl text-[#9c7128]">
                “Más que un cambio, un cuidado real.”
              </span>
              <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] font-semibold text-[#80796d]">
                <div className="w-8 h-[1px] bg-[#d1c2ab]" />
                <span>TU CABELLO, EN BUENAS MANOS</span>
              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
}
