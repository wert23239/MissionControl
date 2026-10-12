// Design notebook only: does not install or execute game/mod changes.
const ISAAC_CHARACTERS = [
 ['isaac','Isaac','D6 (unlocked)'],['magdalene','Magdalene','Yum Heart; unlocked starting pill'],
 ['cain','Cain','Lucky Foot; Paper Clip when unlocked'],['judas','Judas','Book of Belial'],
 ['blue-baby','???','The Poop; soul-heart health'],['eve','Eve','Whore of Babylon, Dead Bird; Razor Blade when unlocked'],
 ['samson','Samson','Bloody Lust; Child’s Heart when unlocked'],['azazel','Azazel','Flight, short-range Brimstone, The Fool card'],
 ['lazarus','Lazarus','Starting pill and revival mechanic'],['eden','Eden','Random normal starting items and stats'],
 ['lost','The Lost','Flight, spectral tears; Eternal D6 and unlocked Holy Mantle'],['lilith','Lilith','Incubus, Cambion Conception, Box of Friends; blindfold'],
 ['keeper','Keeper','Coin-heart health; unlocked Wooden Nickel, Store Key and starting coin'],['apollyon','Apollyon','Void'],
 ['forgotten','The Forgotten','Bone-club attacks, bone-heart body and The Soul'],['bethany','Bethany','Book of Virtues; soul charges'],
 ['jacob-esau','Jacob & Esau','Both characters’ normal stats, health and inventory; specify who receives extras'],
 ['tainted-isaac','Tainted Isaac','Eight-item limit and item-choice mechanic'],['tainted-magdalene','Tainted Magdalene','Pocket Yum Heart; draining health and contact attacks'],
 ['tainted-cain','Tainted Cain','Pocket Bag of Crafting; pickup/crafting mechanic'],['tainted-judas','Tainted Judas','Pocket Dark Arts'],
 ['tainted-blue-baby','Tainted ???','Pocket Hold; poop resources and abilities'],['tainted-eve','Tainted Eve','Pocket Sumptorium; clot mechanic'],
 ['tainted-samson','Tainted Samson','Berserk rage mechanic'],['tainted-azazel','Tainted Azazel','Long-range thin Brimstone and sneeze; no innate flight'],
 ['tainted-lazarus','Tainted Lazarus','Pocket Flip; alternating forms'],['tainted-eden','Tainted Eden','Random starting kit; damage-triggered rerolls'],
 ['tainted-lost','Tainted Lost','Flight, spectral tears, Holy Card; no Holy Mantle'],['tainted-lilith','Tainted Lilith','Gello and fetal-whip attacks'],
 ['tainted-keeper','Tainted Keeper','Two coin hearts, quadruple shot and purchase/coin-drop mechanics'],['tainted-apollyon','Tainted Apollyon','Pocket Abyss; locust mechanic'],
 ['tainted-forgotten','Tainted Forgotten','Thrown skeleton and flying Soul'],['tainted-bethany','Tainted Bethany','Pocket Lemegeton; blood-charge and wisp mechanics'],
 ['tainted-jacob','Tainted Jacob','Pocket Anima Sola; Dark Esau mechanic']
];
const ISAAC_FIELDS = ['mode','items','active','trinkets','consumables','health','custom','customItemName','icon'];
let isaacDesigns={}, isaacReady=false, isaacLoading=false;
const isaacTimers={}, isaacQueues={}, isaacVersions={};
const isaacDirty=new Set();
const isaacKey=id=>'isaac-loadout-'+id;
function isaacStatus(id,text){const el=document.getElementById('isaac-status-'+id);if(el)el.textContent=text;}
function renderIsaacPlanner(){
 const grid=document.getElementById('isaacCharacters'); if(!grid)return;
 grid.innerHTML=ISAAC_CHARACTERS.map(([id,name,base])=>{
  const d=isaacDesigns[id]||{};
  const input=(field,label,placeholder,list='')=>`<label>${label}<input class="book-inline-input" data-field="${field}" value="${escapeHtml(field==='icon'&&String(d.icon||'').startsWith('data:')?'':d[field]||'')}" placeholder="${escapeHtml(placeholder)}" ${list?`list="${list}"`:''} oninput="editIsaacDesign('${id}',this.dataset.field,this.value)"></label>`;
  return `<details class="card isaac-character" data-character="${id}" data-name="${escapeHtml(name.toLowerCase())}" ${id==='isaac'?'open':''}><summary>${escapeHtml(name)}</summary><div class="isaac-base"><strong>🔒 Keep normal starting kit</strong><br>${escapeHtml(base)}<br><small>Baseline summary, not an exhaustive item list; use this save’s normal unlocked kit.</small></div><fieldset ${isaacReady?'':'disabled'}><label>Extra-loadout option<select class="book-inline-input" data-field="mode" onchange="editIsaacDesign('${id}','mode',this.value)"><option value="normal" ${d.mode!=='optional'?'selected':''}>Normal kit only (default)</option><option value="optional" ${d.mode==='optional'?'selected':''}>Optional custom loadout</option></select></label>${input('items','Extra passive items (names or IDs)','e.g. Mom’s Knife (114), Soy Milk (330)','isaacItemNames')}${input('active','Extra active / pocket item','Describe item and slot; keep the normal active','isaacItemNames')}${input('trinkets','Extra trinkets (names or IDs)','e.g. Curved Horn (35)','isaacTrinketNames')}${input('consumables','Cards, pills & pickups','e.g. one Holy Card, 3 bombs, 5 coins')}${input('health','Health / stat additions','Describe additions; normal starting health stays')}${input('customItemName','Custom item name','e.g. Unlucky Foot')}<div class="isaac-icon-area"><div id="isaac-icon-${id}" class="isaac-icon-preview">${isaacIconMarkup(d.icon)}</div><div><label>Custom item icon<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload icon for ${escapeHtml(name)}" onchange="uploadIsaacIcon('${id}',this)"></label><small>PNG recommended for transparency. Uploaded icons are saved with your design.</small><button type="button" onclick="removeIsaacIcon('${id}')">Clear icon</button></div></div>${input('icon','Or paste an image URL','https://…')}<label>Custom item / mechanic description<textarea class="book-inline-input" data-field="custom" placeholder="Describe what this character should do, item effects, triggers, restrictions, or a custom item we need to build." oninput="editIsaacDesign('${id}','custom',this.value)">${escapeHtml(d.custom||'')}</textarea></label>${id==='isaac'?'<button type="button" onclick="suggestIsaacKnife()">Use Knife + Soy Milk as optional extras</button> ':''}<button type="button" onclick="saveIsaacDesign('${id}')">Save this character</button></fieldset><p class="isaac-save-status" id="isaac-status-${id}" role="status">${isaacReady?(d.updatedAt?'Loaded saved design':'No extra loadout designed yet'):'Waiting for saved designs…'}</p></details>`;
 }).join('');filterIsaacCharacters();
}
function safeIsaacIcon(value){
 const s=String(value||'').trim();return /^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(s)?s:'';
}
function isaacIconMarkup(value){const src=safeIsaacIcon(value);return src?`<img src="${escapeHtml(src)}" alt="Custom item icon" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>Image unavailable</span>`:'<span>Icon<br>placeholder</span>';}
function updateIsaacIconPreview(id,value){const el=document.getElementById('isaac-icon-'+id);if(el)el.innerHTML=isaacIconMarkup(value);}
function removeIsaacIcon(id){editIsaacDesign(id,'icon','');const input=document.querySelector(`[data-character="${id}"] [data-field="icon"]`);if(input)input.value='';}
async function uploadIsaacIcon(id,input){
 const file=input.files?.[0];if(!file)return;
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024){isaacStatus(id,'Choose a PNG, JPEG or WebP image under 5 MB.');input.value='';return;}
 const objectUrl=URL.createObjectURL(file);
 try{
  const img=new Image();img.src=objectUrl;await img.decode();
  const scale=Math.min(1,128/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const icon=canvas.toDataURL('image/png');editIsaacDesign(id,'icon',icon);const field=document.querySelector(`[data-character="${id}"] [data-field="icon"]`);if(field)field.value='';
 }catch(e){isaacStatus(id,'Could not read this image. Try another PNG.');}
 finally{URL.revokeObjectURL(objectUrl);input.value='';}
}

function filterIsaacCharacters(){
 const q=(document.getElementById('isaacSearch')?.value||'').toLowerCase();const filter=document.getElementById('isaacFilter')?.value||'all';
 document.querySelectorAll('.isaac-character').forEach(el=>{const t=el.dataset.character.startsWith('tainted-');el.hidden=!el.dataset.name.includes(q)||(filter==='normal'&&t)||(filter==='tainted'&&!t);});
}
async function loadIsaacPlanner(){
 if(isaacLoading)return;
 // Avoid replacing unsaved edits when the user presses reload.
 if(isaacReady){await Promise.all(Object.values(isaacTimers).map(t=>{clearTimeout(t);return Promise.resolve();}));const results=await Promise.all([...isaacDirty].map(id=>saveIsaacDesign(id)));if(results.some(ok=>!ok)){document.getElementById('isaacLoadStatus').textContent='Reload paused: save pending edits first.';return;}}
 isaacLoading=true;isaacReady=false;renderIsaacPlanner();
 const status=document.getElementById('isaacLoadStatus');status.textContent='Loading saved designs…';
 try{
  const r=await fetch(`${SB_URL}/rest/v1/book_state?key=like.isaac-loadout-*&select=key,state&limit=100`,{headers:sbHeaders});if(!r.ok)throw new Error('Load failed');
  const rows=await r.json();isaacDesigns={};
  for(const row of rows){const id=row.key.slice('isaac-loadout-'.length);if(ISAAC_CHARACTERS.some(c=>c[0]===id)&&row.state&&typeof row.state==='object')isaacDesigns[id]=row.state;}
  isaacReady=true;status.textContent='Connected · edits autosave to Supabase';renderIsaacPlanner();
 }catch(e){status.textContent='Cannot load saved designs. Try Reload when connected.';}
 finally{isaacLoading=false;}
}
function editIsaacDesign(id,field,value){
 if(!isaacReady||!ISAAC_FIELDS.includes(field))return;
 isaacDesigns[id]={...isaacDesigns[id],[field]:value,keepNormalStartingItems:true};isaacVersions[id]=(isaacVersions[id]||0)+1;
 if(field==='icon')updateIsaacIconPreview(id,value);
 isaacDirty.add(id);isaacStatus(id,'Unsaved changes…');clearTimeout(isaacTimers[id]);isaacTimers[id]=setTimeout(()=>saveIsaacDesign(id),650);
}
function saveIsaacDesign(id){
 if(!isaacReady)return Promise.resolve(false);
 clearTimeout(isaacTimers[id]);const version=isaacVersions[id]||0;
 const payload={...isaacDesigns[id],character:id,mode:isaacDesigns[id]?.mode||'normal',keepNormalStartingItems:true,updatedAt:new Date().toISOString()};
 // Separate rows and serialized requests keep edits to different characters independent.
 const task=async()=>{
  isaacStatus(id,'Saving…');
  try{const r=await fetch(`${SB_URL}/rest/v1/book_state?on_conflict=key`,{method:'POST',headers:{...sbHeaders,Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({key:isaacKey(id),state:payload,updated_at:payload.updatedAt})});if(!r.ok)throw new Error('Save failed');
   if(version===(isaacVersions[id]||0)){isaacDesigns[id]=payload;isaacDirty.delete(id);isaacStatus(id,'Saved to Supabase ✓');document.getElementById('isaacLoadStatus').textContent='Connected · edits autosave to Supabase';}return true;
  }catch(e){isaacStatus(id,'Not saved — connection failed. Press Save to retry.');return false;}
 };
 isaacQueues[id]=(isaacQueues[id]||Promise.resolve()).then(task,task);return isaacQueues[id];
}
function suggestIsaacKnife(){
 editIsaacDesign('isaac','mode','optional');editIsaacDesign('isaac','items',"Mom's Knife (114), Soy Milk (330)");
 const card=document.querySelector('[data-character="isaac"]');card.querySelector('[data-field="mode"]').value='optional';card.querySelector('[data-field="items"]').value="Mom's Knife (114), Soy Milk (330)";
}
async function loadIsaacCatalog(){
 try{const r=await fetch('isaac-catalog.json');if(!r.ok)return;const c=await r.json();for(const [key,target] of [['items','isaacItemNames'],['trinkets','isaacTrinketNames']]){document.getElementById(target).innerHTML=c[key].map(x=>`<option value="${escapeHtml(x.name+' ('+x.id+')')}"></option>`).join('');}}catch(e){/* Free-text custom items remain available. */}
}
const isaacPreviousSwitch=switchPanel;
switchPanel=function(id){isaacPreviousSwitch(id);if(id==='isaac'&&!isaacReady&&!isaacLoading)loadIsaacPlanner();};
renderIsaacPlanner();loadIsaacCatalog();
if(document.getElementById('panel-isaac')?.classList.contains('active'))loadIsaacPlanner();

if(location.hash==='#isaac')switchPanel('isaac');
window.addEventListener('hashchange',()=>{if(location.hash==='#isaac')switchPanel('isaac');});
