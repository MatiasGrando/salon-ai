import BookingGateway from './components/BookingGateway';
import React, { useState, useEffect } from 'react';
import Lenis from 'lenis';
import Header from './components/Header';
import Hero from './components/Hero';
import BeforeAfterSlider from './components/BeforeAfterSlider';
import ServicesSection from './components/ServicesSection';
import BrandExperience from './components/BrandExperience';
import ProfessionalsSection from './components/ProfessionalsSection';
import ReviewsAndFAQ from './components/ReviewsAndFAQ';
import BranchSelector from './components/BranchSelector';
import Footer from './components/Footer';
import MobileBottomNav from './components/MobileBottomNav';
import { useBranchCatalog } from './components/BranchCatalog';
import { branchFromSearch } from './data/glowBooking';

function Landing() {
  const [selectedBranch, setSelectedBranch] = useState(() => branchFromSearch(window.location.search) || 'urquiza');
  const catalog = useBranchCatalog(selectedBranch);

  // Smooth scroll con Lenis (20% más lento para sensación de resistencia y lujo)
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.25,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      wheelMultiplier: 0.8,
      touchMultiplier: 0.8,
      smoothWheel: true,
    });

    let animationFrameId;
    function raf(time) {
      lenis.raf(time);
      animationFrameId = requestAnimationFrame(raf);
    }
    animationFrameId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(animationFrameId);
      lenis.destroy();
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0e0e10] text-[#f2f0eb] flex flex-col selection:bg-[#cba258] selection:text-black">
      {/* Header fijo superior */}
      <Header
        selectedBranch={selectedBranch}
        setSelectedBranch={setSelectedBranch}
      />

      <main className="relative w-full">
        {/* 1. HERO CON PARALLAX (Sticky a top-0) */}
        <div className="sticky top-0 w-full h-[100dvh] z-0 overflow-hidden bg-[#0e0e10]">
          <Hero
            selectedBranch={selectedBranch}
            setSelectedBranch={setSelectedBranch}
          />
        </div>

        {/* CORTINA SUPERPUESTA (Scroll-over effect):
            Sube inmediatamente al scrollear y cubre la hero desde abajo */}
        <div className="relative z-10 w-full bg-[#0e0e10] rounded-t-[2.5rem] sm:rounded-t-[3.5rem] border-t-2 border-[#cba258]/30 shadow-[0_-30px_80px_rgba(0,0,0,0.98)]">
        {/* Indicador sutil de tope */}
          <div className="pt-6 pb-2 flex justify-center">
            <div className="w-12 h-1.5 rounded-full bg-[#2e2e3d]"></div>
          </div>

          {/* 2. RESULTADOS ANTES / DESPUÉS */}
          <BeforeAfterSlider
            selectedBranch={selectedBranch}
          />

          {/* 3. SERVICIOS */}
          <ServicesSection
            key={`services-${selectedBranch}`}
            catalog={catalog}
            setSelectedBranch={setSelectedBranch}
            selectedBranch={selectedBranch}
          />

          {/* 4. POR QUÉ GLOW */}
          <BrandExperience />

          {/* 5. PROFESIONALES */}
          <ProfessionalsSection
            key={`professionals-${selectedBranch}`}
            catalog={catalog}
            setSelectedBranch={setSelectedBranch}
            selectedBranch={selectedBranch}
          />

          {/* 6. OPINIONES */}
          <ReviewsAndFAQ
            selectedBranch={selectedBranch}
          />

          {/* 7. SUCURSALES */}
          <BranchSelector
            selectedBranch={selectedBranch}
            setSelectedBranch={setSelectedBranch}
          />
        </div>
      </main>

      {/* Footer */}
      <Footer />

      {/* Barra de navegación inferior móvil */}
      <MobileBottomNav
        selectedBranch={selectedBranch}
        setSelectedBranch={setSelectedBranch}
      />
    </div>
  );
}

export default function App() {
  return window.location.pathname.replace(/\/$/, "") === "/reservar" ? <BookingGateway /> : <Landing />;
}
