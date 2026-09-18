import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptCatalog, createCatalogLoader, visibleCatalog } from '../../src/data/glowCatalog.js';

const payload = (branch, name = branch) => ({ branch: { id: branch, name }, services: [{id:'s', name, description:null,imageUrl:null,price:null,duration:45,category:null}], professionals:[{id:'p',name,description:null,avatarUrl:null}] });
test('adapts real nullable data without invented descriptions/photos or price', () => {
 const result = adaptCatalog(payload('urquiza'),'urquiza');
 assert.equal(result.services[0].image,null);
 assert.equal(result.services[0].description,'');
 assert.equal(result.services[0].priceRange,'Consultar precio');
 assert.equal(result.services[0].duration,'45 min');
 assert.equal(result.professionals[0].image,null);
 assert.equal(result.professionals[0].fullBio,'');
 assert.throws(()=>adaptCatalog(payload('canitas'),'urquiza'));
});
test('prices preserve fixed, starting-at and zero; display duration wins',()=>{
 const data=payload('urquiza');
 data.services=[{id:'s',name:'Corte',price:0,priceMode:'FIXED',duration:40,displayDuration:60}, {id:'t',name:'Color',price:12000,priceMode:'STARTING_AT',duration:90}];
 const adapted=adaptCatalog(data,'urquiza');
 assert.equal(adapted.services[0].priceRange,'$\u00a00');
 assert.equal(adapted.services[0].duration,'60 min');
 assert.match(adapted.services[1].priceRange,/^Desde /);
});
test('switch clears content immediately and ignores old success or failure',async()=>{
 const requests=[]; const states=[];
 const loader=createCatalogLoader({fetchImpl:(url)=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),onChange:state=>states.push(state)});
 const first=loader.load('urquiza'); const second=loader.load('canitas');
 assert.deepEqual(states.at(-1).services,[]); assert.equal(states.at(-1).branchId,'canitas');
 requests[1].resolve({ok:true,json:async()=>payload('canitas')}); await second;
 requests[0].resolve({ok:true,json:async()=>payload('urquiza')}); await first;
 assert.equal(states.at(-1).services[0].name,'canitas');
 const third=loader.load('urquiza'); const fourth=loader.load('canitas');
 requests[2].reject(new Error('late error')); await third;
 assert.equal(states.at(-1).status,'loading');
 requests[3].resolve({ok:true,json:async()=>payload('canitas')}); await fourth;
 assert.equal(visibleCatalog(states.at(-1),'urquiza').services.length,0);
 loader.dispose();
});
test('handles errors, empty catalogs, retry and disposal without stale data',async()=>{
 let response={ok:false}; let state; const loader=createCatalogLoader({fetchImpl:async()=>response,onChange:value=>state=value});
 await loader.load('urquiza'); assert.equal(state.status,'error'); assert.deepEqual(state.services,[]);
 response={ok:true,json:async()=>({...payload('urquiza'),services:[],professionals:[]})};
 await loader.load('urquiza'); assert.equal(state.status,'ready'); assert.deepEqual(state.services,[]);
 loader.dispose(); await loader.load('canitas'); assert.equal(state.branchId,'urquiza');
});
