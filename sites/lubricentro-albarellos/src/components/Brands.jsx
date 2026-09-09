import React from 'react';
import { Award, ShieldCheck } from 'lucide-react';

const brands = [
  { name: "Liqui Moly", badge: "Oficial", desc: "Aceites y aditivos alemanes de máxima especificación" },
  { name: "ELF", badge: "Destacado", desc: "Lubricantes sintéticos homologados" },
  { name: "Motul", badge: "Premium", desc: "Tecnología 100% sintética Ester Core" },
  { name: "Mann Filter", badge: "Equipo Original", desc: "Filtración alemana para todas las marcas" },
  { name: "Bosch", badge: "Equipo Original", desc: "Frenos, escobillas y baterías líderes" },
  { name: "Moura", badge: "Garantía Oficial", desc: "Baterías selladas y EFB Start-Stop" },
  { name: "Castrol", badge: "Calidad", desc: "Gama Edge y Magnatec con titanio líquido" },
  { name: "Mobil 1", badge: "Oficial", desc: "Lubricantes para motores de alta exigencia" }
];

export default function Brands() {
  return (
    <section id="marcas" className="py-16 bg-[#0b0d12] border-b border-zinc-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        <div className="text-center max-w-2xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-800/70 border border-zinc-700 text-zinc-300 text-xs font-semibold uppercase tracking-wider mb-3">
            <ShieldCheck className="w-3.5 h-3.5 text-red-500" />
            <span>Garantía de Calidad</span>
          </div>
          <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl font-bold text-white tracking-wide">
            INSUMOS 100% ORIGINALES Y <span className="text-red-500">HOMOLOGADOS</span>
          </h2>
          <p className="text-zinc-400 text-sm sm:text-base mt-2">
            No arriesgamos la mecánica de tu auto. Solo utilizamos marcas certificadas por los principales fabricantes automotrices mundiales.
          </p>
        </div>

        {/* Brands Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {brands.map((brand, idx) => (
            <div
              key={idx}
              className="bg-[#11141c] hover:bg-[#151924] border border-zinc-800/90 hover:border-red-600/40 rounded-xl p-4 sm:p-5 transition flex flex-col justify-between group"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="font-heading text-lg sm:text-xl font-bold text-white group-hover:text-red-400 transition tracking-wider">
                  {brand.name}
                </span>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                  {brand.badge}
                </span>
              </div>
              <p className="text-xs text-zinc-400 leading-snug">
                {brand.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Trust banner */}
        <div className="mt-10 p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-600/20 text-red-400 flex items-center justify-center shrink-0">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Bidones sellados a la vista del cliente</p>
              <p className="text-xs text-zinc-400">Podés ver el producto que se le coloca a tu vehículo en todo momento.</p>
            </div>
          </div>
          <div className="text-xs text-red-400 font-semibold uppercase tracking-wider">
            Compromiso Albarellos
          </div>
        </div>

      </div>
    </section>
  );
}
