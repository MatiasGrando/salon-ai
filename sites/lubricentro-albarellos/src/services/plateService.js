const API_BASE_URL = (import.meta.env.VITE_WEEX_API_URL || 'https://weex.com.ar').replace(/\/$/, '');
const WORKSHOP_CUSTOMER_CODE = import.meta.env.VITE_WORKSHOP_CUSTOMER_CODE || 'WX-8Y4HHG';

export function normalizePlate(input) {
  if (!input) return '';
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
}

export function formatPlateDisplay(cleanPlate) {
  if (!cleanPlate) return '';
  const plate = cleanPlate.toUpperCase();
  if (/^[A-Z]{2}[0-9]{3}[A-Z]{2}$/.test(plate)) {
    return `${plate.slice(0, 2)} ${plate.slice(2, 5)} ${plate.slice(5, 7)}`;
  }
  if (/^[A-Z]{3}[0-9]{3}$/.test(plate)) {
    return `${plate.slice(0, 3)} ${plate.slice(3, 6)}`;
  }
  return plate;
}

function isCompleteArgentinePlate(plate) {
  return /^(?:[A-Z]{3}[0-9]{3}|[A-Z]{2}[0-9]{3}[A-Z]{2})$/.test(plate);
}

function formatDate(date) {
  if (!date) return 'Sin registro';
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function formatDateShort(date) {
  if (!date) return 'Sin registro';
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function mapHistoryItem(job) {
  return {
    id: job.id,
    date: formatDate(job.date),
    km: `${Number(job.mileage || 0).toLocaleString('es-AR')} km`,
    serviceType: job.serviceType,
    summary: job.summary,
    items: job.items.map((item) => ({
      name: item.name,
      qty: item.quantity === 1 ? '1 unidad' : `${item.quantity} unidades`
    }))
  };
}

function mapVehicle(payload) {
  const recommendation = payload.recommendation;
  const priority = recommendation?.status === 'danger' ? 'urgente' : recommendation?.status === 'warning' ? 'alta' : 'normal';
  return {
    plate: formatPlateDisplay(payload.plate),
    brand: payload.brand,
    model: payload.model,
    year: payload.year,
    engine: payload.engine,
    usage: payload.usage,
    lastServiceDate: formatDateShort(payload.lastService?.date),
    lastServiceKm: payload.lastService?.mileage ?? null,
    currentMileage: payload.currentMileage,
    recommendedNextKm: recommendation?.nextMileage ?? null,
    recommendedNextDate: formatDateShort(recommendation?.nextDate),
    status: recommendation?.status ?? 'unknown',
    statusLabel: recommendation?.label ?? 'Sin servicios registrados',
    statusMessage: recommendation?.message ?? 'Todavía no hay trabajos asociados a esta patente. Comunicate con el taller si necesitás registrar el primer servicio.',
    upcomingTasks: recommendation ? [{
      id: 'next-maintenance',
      item: `Próximo mantenimiento sugerido cada ${recommendation.intervalKilometers.toLocaleString('es-AR')} km o ${recommendation.intervalMonths} meses`,
      priority
    }] : [],
    history: payload.history.items.map(mapHistoryItem),
    historyHasMore: payload.history.hasMore,
    historyNextOffset: payload.history.nextOffset
  };
}

async function requestVehicle(plate, offset = 0) {
  const url = `${API_BASE_URL}/public/workshops/${encodeURIComponent(WORKSHOP_CUSTOMER_CODE)}/vehicles/${encodeURIComponent(plate)}?limit=10&offset=${offset}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 404) return { notFound: true };
  if (!response.ok) throw new Error(payload.message || 'No pudimos consultar el historial en este momento.');
  return { data: mapVehicle(payload) };
}

export async function fetchVehicleByPlate(plateQuery) {
  const normalized = normalizePlate(plateQuery);
  if (!isCompleteArgentinePlate(normalized)) {
    return { success: false, error: 'Ingresá una patente argentina completa.' };
  }
  try {
    const response = await requestVehicle(normalized);
    if (response.notFound) {
      return {
        success: false,
        notFound: true,
        searchedPlate: normalized,
        error: `No encontramos registros para la patente "${formatPlateDisplay(normalized)}".`
      };
    }
    return { success: true, data: response.data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'No pudimos consultar el historial.' };
  }
}

export async function fetchVehicleHistoryPage(plateQuery, offset) {
  const normalized = normalizePlate(plateQuery);
  const response = await requestVehicle(normalized, offset);
  if (!response.data) throw new Error('No pudimos cargar más servicios.');
  return {
    items: response.data.history,
    hasMore: response.data.historyHasMore,
    nextOffset: response.data.historyNextOffset
  };
}
