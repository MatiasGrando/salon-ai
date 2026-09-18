import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bookingEntry, branchFromSearch, safeBookingDestination} from '../../src/data/glowBooking.js';
import {createCatalogLoader, visibleCatalog} from '../../src/data/glowCatalog.js';
test('entry carries only explicit allowed branch, never old service or redirect',()=>{
 assert.equal(bookingEntry('canitas'),'/reservar?sede=canitas');
 assert.equal(bookingEntry('unknown'),'/reservar');
 assert.equal(branchFromSearch('?sede=canitas&serviceId=old'),'canitas');
 assert.equal(branchFromSearch('?sede=__proto__'),null);
 assert.equal(branchFromSearch(''),null);
});
test('destination rejects unready mismatched branches and arbitrary redirects',()=>{
 const state={branchId:'urquiza',status:'ready',address:'Monroe 5252',bookingUrl:'https://weex.com.ar/glowurquiza/reservar?template=salon-white'};
 assert.equal(safeBookingDestination(state,'urquiza'),state.bookingUrl);
 assert.equal(safeBookingDestination(state,'canitas'),null);
 for(const patch of [{status:'loading'},{status:'error'},{address:''},{bookingUrl:'https://evil.test'},{bookingUrl:'https://weex.com.ar/glowcanitas/reservar?template=salon-white'}]) assert.equal(safeBookingDestination({...state,...patch},'urquiza'),null);
});
test('gateway is first step and reservation CTAs share entry while consultations remain',()=>{
 const read=file=>readFileSync(new URL(`../../src/${file}`,import.meta.url),'utf8');
 assert.match(read('App.jsx'),/BookingGateway/);
 const gateway=read('components/BookingGateway.jsx');
 assert.match(gateway,/Elegí tu sede/); assert.match(gateway,/safeBookingDestination/); assert.match(gateway,/aria-pressed/); assert.match(gateway,/catalog.retry/);
 for(const file of ['Header','Hero','ServicesSection','ProfessionalsSection','BeforeAfterSlider','MobileBottomNav','FinalCTA']) assert.match(read(`components/${file}.jsx`),/openBooking/);
 for(const file of ['Header','BranchSelector','ReviewsAndFAQ']) assert.match(read(`components/${file}.jsx`),/https:\/\/wa.me\//);
});
test('gateway discards stale destination and address on switch, error, retry and dispose',async()=>{
 const requests=[]; let state;
 const loader=createCatalogLoader({fetchImpl:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),onChange:value=>state=value});
 const payload=branch=>({branch:{id:branch,name:branch,address:`Address ${branch}`,bookingUrl:`https://weex.com.ar/glow${branch}/reservar?template=salon-white`},services:[],professionals:[]});
 const first=loader.load('urquiza'); const second=loader.load('canitas');
 assert.equal(safeBookingDestination(state,'canitas'),null);
 requests[1].resolve({ok:true,json:async()=>payload('canitas')}); await second;
 assert.ok(safeBookingDestination(state,'canitas'));
 requests[0].resolve({ok:true,json:async()=>payload('urquiza')}); await first;
 assert.equal(state.branchId,'canitas');
 assert.equal(safeBookingDestination(visibleCatalog(state,'urquiza'),'urquiza'),null);
 const third=loader.load('urquiza'); requests[2].reject(new Error('Unavailable')); await third;
 assert.equal(state.address,undefined); assert.equal(safeBookingDestination(state,'urquiza'),null);
 const fourth=loader.load('urquiza'); requests[3].resolve({ok:true,json:async()=>payload('urquiza')}); await fourth;
 assert.ok(safeBookingDestination(state,'urquiza'));
 loader.dispose(); await loader.load('canitas'); assert.equal(state.branchId,'urquiza');
});
