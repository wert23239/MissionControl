import {SB_URL,SB_KEY} from './config.js';
const PREFIX='zelda-oot-remake-v1-';
const headers={apikey:SB_KEY,Authorization:`Bearer ${SB_KEY}`,'Content-Type':'application/json'};
const titles={skulls:'Gold Skulltulas',pieces:'Heart Pieces',containers:'Boss Heart Containers'};
const data=await fetch('./data.json').then(r=>{if(!r.ok)throw Error('Counts unavailable');return r.json()});
const counts={},pending=new Map(); let tab='skulls',loaded=false,busy=false,revision=0;
const $=id=>document.getElementById(id);
const key=(kind,id)=>PREFIX+kind+'-'+id;
const clamp=(v,max)=>Math.max(0,Math.min(max,Math.trunc(Number(v)||0)));
const found=(kind,row)=>counts[key(kind,row.id)]||0;
const sum=kind=>data[kind].reduce((n,row)=>n+found(kind,row),0);
const total=kind=>data[kind].reduce((n,row)=>n+row.total,0);
function status(text,error=false){$('sync').textContent=text;$('sync').classList.toggle('error',error);$('retry').hidden=!error}
function cache(){try{localStorage.setItem(PREFIX+'cache',JSON.stringify(counts));localStorage.setItem(PREFIX+'pending',JSON.stringify([...pending]))}catch{}}
function render(){
 $('summary').innerHTML=Object.keys(data).map(kind=>`<div class="stat" data-summary="${kind}"><h2>${titles[kind]}</h2><strong>${total(kind)-sum(kind)}</strong> <span>left / ${total(kind)}</span><progress value="${sum(kind)}" max="${total(kind)}" aria-label="${titles[kind]} collected"></progress><span>${sum(kind)} collected</span></div>`).join('');
 const hearts=3+sum('containers')+Math.floor(sum('pieces')/4);
 $('health').innerHTML=`<b>♥ ${hearts} / 20 hearts</b> · 3 starting + ${sum('containers')} boss + ${Math.floor(sum('pieces')/4)} from pieces · ${sum('pieces')%4}/4 toward your next heart`;
 $('section-title').textContent=titles[tab];
 const rows=data[tab].filter(row=>row.area.toLowerCase().includes($('search').value.toLowerCase())&&(!$('hide').checked||found(tab,row)<row.total));
 $('area-count').textContent=`${rows.length} areas`;
 $('areas').innerHTML=rows.map(row=>{const n=found(tab,row),remaining=row.total-n;return `<article class="area ${remaining===0?'complete':''}" data-area="${row.id}"><h3>${row.area}</h3><div class="remaining">${remaining} <small>${remaining===0?'left · complete!':'left'}</small></div><div class="counter"><label for="${row.id}">Found</label><input id="${row.id}" data-count="${row.id}" type="number" inputmode="numeric" min="0" max="${row.total}" value="${n}" ${loaded?'':'disabled'} aria-label="${row.area} found"><span>/ ${row.total}</span></div><div class="actions"><button data-change="-1" data-id="${row.id}" aria-label="Undo one in ${row.area}" ${!loaded||n===0?'disabled':''}>−</button><button class="add" data-change="1" data-id="${row.id}" ${!loaded||remaining===0?'disabled':''}>${remaining===0?'All found ✓':'Found one + '}</button></div></article>`}).join('')||'<p>No matching areas.</p>';
}
function update(id,value){if(!loaded)return;const row=data[tab].find(r=>r.id===id);if(!row)return;const k=key(tab,id);revision++;counts[k]=clamp(value,row.total);pending.set(k,counts[k]);cache();render();status('Saving…');void flush()}
async function flush(){if(busy||!loaded)return;busy=true;try{
 while(pending.size){const [k,value]=pending.entries().next().value;
 const r=await fetch(`${SB_URL}/rest/v1/book_state?on_conflict=key`,{method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({key:k,state:{found:value},updated_at:new Date().toISOString()})});
 if(!r.ok)throw Error('Save failed');if(pending.get(k)===value)pending.delete(k);cache();
 }status('Saved · synced across devices');
 }catch{status('Not synced — your changes are kept on this device. Retry when connected.',true)}finally{busy=false}}
async function load(){
 const startRevision=revision;
 try{const r=await fetch(`${SB_URL}/rest/v1/book_state?key=like.${PREFIX}*&select=key,state`,{headers,cache:'no-store'});if(!r.ok)throw Error('Load failed');const rows=await r.json();if(startRevision!==revision)return;
 for(const kind of Object.keys(data))for(const row of data[kind]){const k=key(kind,row.id);if(!pending.has(k))counts[k]=clamp(rows.find(r=>r.key===k)?.state?.found,row.total)}
 loaded=true;cache();render();status('Saved progress loaded · synced across devices');if(pending.size)await flush();
 }catch{status('Could not load saved progress. Retry to enable counters safely.',true)}}
try{Object.assign(counts,JSON.parse(localStorage.getItem(PREFIX+'cache')||'{}'));for(const [k,v] of JSON.parse(localStorage.getItem(PREFIX+'pending')||'[]')){if(k.startsWith(PREFIX)){pending.set(k,v);counts[k]=v}}}catch{}
for(const kind of Object.keys(data))for(const row of data[kind])counts[key(kind,row.id)]=clamp(counts[key(kind,row.id)],row.total);
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{tab=button.dataset.tab;document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button))});render()});
$('areas').onclick=e=>{const b=e.target.closest('[data-change]');if(b){const row=data[tab].find(r=>r.id===b.dataset.id);update(row.id,found(tab,row)+Number(b.dataset.change))}};
$('areas').onchange=e=>{if(e.target.dataset.count)update(e.target.dataset.count,e.target.value)};
$('search').oninput=render;$('hide').onchange=render;
$('retry').onclick=()=>{if(loaded)void flush();else void load()};
window.addEventListener('online',()=>{if(loaded)void flush();else void load()});
window.addEventListener('focus',()=>{if(!busy&&!pending.size)void load()});
window.addEventListener('beforeunload',e=>{if(pending.size){e.preventDefault();e.returnValue=''}});
render();await load();
