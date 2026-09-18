import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptCatalog } from '../../src/data/glowCatalog.js';
test('preserves textual customer duration ranges from backend',()=>{
 const result=adaptCatalog({branch:{id:'urquiza',name:'Villa Urquiza'},services:[{id:'s',name:'Color',duration:90,displayDuration:'80 a 100 min'}],professionals:[]},'urquiza');
 assert.equal(result.services[0].duration,'80 a 100 min');
});
