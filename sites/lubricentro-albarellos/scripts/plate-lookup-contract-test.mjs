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
assert.match(component, /useState\(''\)/);
assert.match(component, /Ver 10 servicios anteriores/);
assert.doesNotMatch(component, /Patentes de prueba|ownerInitials|srv\.technician/);

console.log('Lubricentro public plate lookup contract: OK');
