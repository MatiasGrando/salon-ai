import React, { useEffect, useState } from 'react';
import { BRANCHES } from '../data/glowData';
import { createCatalogLoader, visibleCatalog } from '../data/glowCatalog';

export function useBranchCatalog(branchId) {
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const loader = createCatalogLoader({onChange:setState, baseUrl:import.meta.env.VITE_GLOW_API_BASE_URL || ''});
    loader.load(branchId);
    return () => loader.dispose();
  }, [branchId, attempt]);
  return {...visibleCatalog(state,branchId), retry:() => setAttempt(value => value + 1)};
}

export function CatalogBranchSelector({selectedBranch, setSelectedBranch, label}) {
  return <div className="text-center my-6" role="group" aria-label={label}>
    <p className="text-sm text-[#cba258] mb-3">Estás viendo: <strong>{BRANCHES[selectedBranch].name}</strong></p>
    <div className="flex flex-wrap justify-center gap-2">{Object.values(BRANCHES).map(branch =>
      <button key={branch.id} type="button" aria-pressed={selectedBranch === branch.id} onClick={() => setSelectedBranch(branch.id)} className={`px-5 py-3 rounded-full text-sm font-semibold border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#cba258] ${selectedBranch === branch.id ? 'gold-gradient-bg text-black border-transparent' : 'bg-[#14151e] text-white border-[#393545]'}`}>{branch.name}</button>
    )}</div>
  </div>;
}

export function CatalogStatus({catalog, count, noun}) {
  if (catalog.status === 'ready' && count > 0) return null;
  return <div role={catalog.status === 'error' ? 'alert' : 'status'} className="rounded-2xl border border-[#cba258]/30 bg-[#14151e] p-6 text-center text-[#dedad4] my-6">
    {catalog.status === 'loading' ? `Cargando ${noun} de esta sede…` : catalog.status === 'error' ? <>No pudimos cargar el catálogo de esta sede. <button type="button" onClick={catalog.retry} className="text-[#cba258] underline p-2">Reintentar</button></> : `Esta sede todavía no tiene ${noun} publicados.`}
  </div>;
}

export function CatalogImage({src, alt, className, ...props}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div role="img" aria-label={`${alt}: imagen no disponible`} className={`flex items-center justify-center bg-gradient-to-br from-[#24212a] to-[#0c0d12] text-[#cba258] ${className}`}><span className="text-center p-3 font-serif tracking-widest">GLOW<span className="block font-sans text-[10px] tracking-normal text-[#a5a1b0] mt-2">Imagen no disponible</span></span></div>;
  return <img {...props} src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}
