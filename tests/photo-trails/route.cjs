const assert=require('node:assert/strict');const t=require('../../photo-trails/route.js');
assert(t.validGPS(0,0));assert(!t.validGPS(NaN,2));assert(!t.validGPS(1,181));assert(!t.validGPS(null,1));
const stops=Array.from({length:13},(_,i)=>({lat:40+i*.01,lon:-73,index:i,time:13-i,name:'Photo <&'+i}));
assert.equal(t.sortStops(stops,'time')[0].index,12);assert.equal(t.sortStops(stops,'input')[0].index,0);assert.equal(t.sortStops(stops,'reverse')[0].index,0);
const links=t.maps(stops);assert.equal(links.length,3);let seen=[];for(const link of links){const p=new URL(link).searchParams;assert.equal(p.get('travelmode'),'walking');assert.equal(p.get('waypoints').split('|').length,3);seen.push(p.get('origin'),...p.get('waypoints').split('|'),p.get('destination'));}for(const p of stops)assert(seen.includes(`${p.lat},${p.lon}`));assert.equal(new URL(links[0]).searchParams.get('destination'),new URL(links[1]).searchParams.get('origin'));
assert.equal(t.maps([stops[0]]).length,1);assert.equal(t.maps([]).length,0);assert.equal(t.distance([stops[0]]),0);assert(Math.abs(t.distance([{lat:0,lon:0},{lat:0,lon:1}])-111.195)<.01);assert(t.gpx(stops).includes('Photo &lt;&amp;'));
console.log('PASS: coordinate validation, chronological/import/reverse order, 13-stop Maps segmentation, no omitted stops, distance, GPX escaping');
