const BRANCH_IDS = ['urquiza', 'canitas'];
const text = value => typeof value === 'string' ? value.trim() : '';
const empty = branchId => ({branchId, status:'loading', services:[], professionals:[]});

export function adaptCatalog(data, branchId) {
  if (!BRANCH_IDS.includes(branchId) || data?.branch?.id !== branchId || !Array.isArray(data.services) || !Array.isArray(data.professionals)) throw new Error('Invalid catalog');
  return {
    branchId, status:'ready', address:text(data.branch.address), bookingUrl:text(data.branch.bookingUrl),
    services: data.services.map(service => ({
      id: service.id, name: service.name, description:text(service.description),
      image:text(service.imageUrl) || null, category:text(service.category),
      duration: text(service.displayDuration) || (Number.isFinite(service.displayDuration ?? service.duration) ? `${service.displayDuration ?? service.duration} min` : 'Duración a consultar'),
      priceRange: service.price == null || !Number.isFinite(service.price) ? 'Consultar precio' : `${service.priceMode === 'STARTING_AT' ? 'Desde ' : ''}${new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(service.price)}`,
    })),
    professionals: data.professionals.map(pro => ({
      id:pro.id, name:pro.name, image:text(pro.avatarUrl) || null,
      shortDescription:text(pro.description), fullBio:text(pro.description),
      branchId, branchName:data.branch.name, role:'Profesional', taglineRole:'PROFESIONAL',
    })),
  };
}

// A render-time guard is also needed: effects run after the new branch is rendered.
export const visibleCatalog = (state, branchId) => state?.branchId === branchId ? state : empty(branchId);

export function createCatalogLoader({fetchImpl = fetch, onChange, baseUrl = ''}) {
  let generation = 0;
  let controller;
  let disposed = false;
  return {
    async load(branchId) {
      if (disposed) return;
      const current = ++generation;
      controller?.abort();
      controller = new AbortController();
      onChange(empty(branchId));
      try {
        if (!BRANCH_IDS.includes(branchId)) throw new Error('Invalid branch');
        const response = await fetchImpl(`${baseUrl.replace(/\/$/,'')}/public/glow/branches/${branchId}/catalog`, {signal:controller.signal});
        if (!response.ok) throw new Error('Catalog unavailable');
        const result = adaptCatalog(await response.json(), branchId);
        if (!disposed && current === generation) onChange(result);
      } catch {
        if (!disposed && current === generation) onChange({...empty(branchId),status:'error'});
      }
    },
    dispose() { disposed = true; ++generation; controller?.abort(); },
  };
}
