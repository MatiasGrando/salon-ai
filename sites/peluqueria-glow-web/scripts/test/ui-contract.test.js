import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = name => readFileSync(new URL(`../../src/${name}`,import.meta.url),'utf8');
test('both sections share branch state and are remounted to clear profiles and expanded cards',()=>{
 const app=read('App.jsx');
 for (const component of ['ServicesSection','ProfessionalsSection']) {
  const props=app.match(new RegExp(`<${component}([\\s\\S]*?)/>`))[1];
  assert.match(props,/key=\{selectedBranch\}/);
  assert.match(props,/catalog=\{catalog\}/);
  assert.match(props,/setSelectedBranch=\{setSelectedBranch\}/);
 }
 for (const component of ['ServicesSection','ProfessionalsSection']) {
  const source=read(`components/${component}.jsx`);
  assert.match(source,/<CatalogBranchSelector selectedBranch=\{selectedBranch\} setSelectedBranch=\{setSelectedBranch\}/);
  assert.match(source,/<CatalogStatus/);
  assert.doesNotMatch(source,/filterBranch|SERVICE_TAGLINES/);
 }
});
test('shared editorial banner data stays intact and booking uses gateway',()=>{
 const source=read('components/ServicesSection.jsx');
 assert.match(source,/serviceId: 'balayage-signature'/);
 assert.match(source,/serviceId: 'corte-masculino-fade'/);
 assert.match(source,/handleBookService\(banner1\)/);
 assert.match(source,/openBooking\(selectedBranch\)/);
 assert.match(source,/const SERVICES = catalog.services/);
});
