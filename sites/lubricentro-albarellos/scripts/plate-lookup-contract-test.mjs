import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatDate, mapVehicle } from '../src/services/plateService.js';

const service = readFileSync(new URL('../src/services/plateService.js', import.meta.url), 'utf8');
const component = readFileSync(new URL('../src/components/PlateLookup.jsx', import.meta.url), 'utf8');

assert.doesNotMatch(service, /mockVehicles|mockPlates/);
assert.match(service, /https:\/\/weex\.com\.ar/);
assert.match(service, /WX-8Y4HHG/);
assert.match(service, /\/public\/workshops\//);
assert.match(service, /limit=10&offset=/);
assert.match(service, /fetchVehicleHistoryPage/);
assert.match(service, /mapMaintenanceTask/);
assert.ok(service.includes('payload.maintenance?.items'));
assert.match(component, /Próximo control estimado/);
assert.match(component, /useState\(''\)/);
assert.match(component, /Ver 10 servicios anteriores/);
assert.ok(component.includes('new URLSearchParams(window.location.search)'));
assert.ok(component.includes("params.get('patente')"));
assert.ok(component.includes('fetchVehicleByPlate(plate)'));
assert.doesNotMatch(component, /Patentes de prueba|ownerInitials|srv\.technician/);

const previousZone = process.env.TZ;
process.env.TZ = 'America/Argentina/Buenos_Aires';
assert.equal(formatDate('2026-09-23'), '23 de septiembre de 2026');
process.env.TZ = previousZone;
const payload = {
  plate: 'AZ999AZ', brand: 'Fiat', model: 'Alfa', year: 2025, engine: '1.6', usage: 'PARTICULAR',
  currentMileage: 0, lastService: { date: '2026-09-23', mileage: 0 },
  recommendation: { status: 'ok', label: 'Mantenimiento al día', nextDate: '2027-03-23', nextMileage: 10000, intervalMonths: 6, intervalKilometers: 10000 },
  maintenance: { items: [
    { id: 'belt', serviceName: 'Correa', nextDueDate: '2026-12-23', nextDueMileage: null, status: 'UPCOMING', customerInstructions: '' }
  ], summary: { overdue: 0, upcoming: 1, upToDate: 0 } },
  history: { items: [{ id: 'job', date: '2026-09-23', mileage: 0, serviceType: 'Correa', summary: 'Correa', items: [{ name: 'Correa', quantity: 1 }] }], hasMore: false, nextOffset: null }
};
const mapped = mapVehicle(payload);
assert.equal(mapped.status, 'warning');
assert.equal(mapped.recommendedNextKm, null, 'no combinar km de una regla genérica con la fecha de otro servicio');
assert.equal(mapped.recommendedNextDate, '23/12/2026');
assert.equal(mapped.history[0].date, '23 de septiembre de 2026');
assert.equal(mapped.currentMileage, 0, '0 registrado no equivale a dato ausente');
const withoutCycles = mapVehicle({ ...payload, maintenance: { items: [], summary: { overdue: 0, upcoming: 0, upToDate: 0 } } });
assert.equal(withoutCycles.status, 'unknown');
assert.equal(withoutCycles.recommendedNextKm, null);
assert.equal(withoutCycles.upcomingTasks.length, 0);
console.log('Lubricentro public plate lookup contract: OK');
