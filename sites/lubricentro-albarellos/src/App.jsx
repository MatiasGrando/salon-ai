import React from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import PlateLookup from './components/PlateLookup';
import Services from './components/Services';
import Brands from './components/Brands';
import WhyUs from './components/WhyUs';
import LocationHours from './components/LocationHours';
import Footer from './components/Footer';
import FloatingWhatsApp from './components/FloatingWhatsApp';

export default function App() {
  return (
    <div className="min-h-screen bg-[#0b0d11] text-zinc-100 flex flex-col font-sans selection:bg-red-600 selection:text-white">
      {/* Barra de navegación */}
      <Navbar />

      <main className="flex-grow">
        {/* Portada Hero con fotos dinámicas 16:9 y 9:16 */}
        <Hero />

        {/* Módulo de Consulta por Patente: Historial y Próximo Service */}
        <PlateLookup />

        {/* Servicios del taller (Aceites, Filtros, Baterías, Frenos, Chequeo 25 Puntos) */}
        <Services />

        {/* Marcas Homologadas (Liqui Moly, ELF, Bosch, etc.) */}
        <Brands />

        {/* Razones para elegir Lubricentro Albarellos */}
        <WhyUs />

        {/* Ubicación, horarios y mapa */}
        <LocationHours />
      </main>

      {/* Pie de página */}
      <Footer />

      {/* Botón flotante de WhatsApp */}
      <FloatingWhatsApp />
    </div>
  );
}
