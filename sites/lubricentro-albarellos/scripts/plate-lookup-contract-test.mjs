import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
assert.match(component, /Próximo Servicio Registrado/);
assert.match(component, /useState\(''\)/);
assert.match(component, /Ver 10 servicios anteriores/);
assert.ok(component.includes('new URLSearchParams(window.location.search)'));
assert.ok(component.includes("params.get('patente')"));
assert.ok(component.includes('fetchVehicleByPlate(plate)'));
assert.doesNotMatch(component, /Patentes de prueba|ownerInitials|srv\.technician/);

console.log('Lubricentro public plate lookup contract: OK');
