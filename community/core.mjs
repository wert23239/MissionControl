export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const emailKey = v => String(v||'').trim().toLowerCase();
export const phoneKey = v => { const p=String(v||'').replace(/\D/g,''); return p.length>=7 ? p : ''; };
const norm = v => String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function csv(text) {
 text=text.replace(/^\uFEFF/,''); const delimiter=(text.split(/\r?\n/)[0].match(/\t/g)||[]).length>(text.split(/\r?\n/)[0].match(/,/g)||[]).length?'\t':',';
 const rows=[];let row=[],value='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else if(!value||quoted)quoted=!quoted;else value+=c;}else if(c===delimiter&&!quoted){row.push(value);value='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(v=>v.trim()))rows.push(row);row=[];value='';}else value+=c;}
 if(quoted)throw Error('Unclosed quote in CSV. Export it again or close the quoted field.');
 row.push(value);if(row.some(v=>v.trim()))rows.push(row);
 if(rows.length<2)throw Error('CSV needs a header row and at least one member.');
 const keys=rows.shift();return rows.map((r,i)=>{if(r.length>keys.length)throw Error(`CSV row ${i+2} has too many columns.`);return Object.fromEntries(keys.map((k,j)=>[k.trim(),r[j]||'']));});
}
export function unwrap(x){
 if(Array.isArray(x))return x;
 if(!x||typeof x!=='object')return [];
 for(const k of ['entries','guests','members','contacts','registrations','results','items','data'])if(x[k]){const a=unwrap(x[k]);if(a.length)return a;}
 if(x.structuredContent){const a=unwrap(x.structuredContent);if(a.length)return a;}
 if(x.content){for(const c of x.content){if(c.type==='text'){try{const a=unwrap(JSON.parse(c.text));if(a.length)return a;}catch{}}}}
 if(x.name||x.email||x.user_email||x.guest||x.user)return [x];return [];
}
export function normalize(raw,level='Unassessed'){
 const flat={...raw,...(raw.guest||{}),...(raw.user||{}),...(raw.guest?.user||{})};const f=Object.fromEntries(Object.entries(flat).map(([k,v])=>[norm(k),v]));
 const get=(...keys)=>{for(const k of keys){const v=f[norm(k)];if(v!==undefined&&v!==null&&v!=='')return typeof v==='object'?JSON.stringify(v):String(v).trim();}return '';};
 const email=emailKey(get('email','email address','user_email','guest_email','Email Address'));
 const name=get('name','full name','user_name','guest_name')||[get('first name','first_name'),get('last name','last_name')].filter(Boolean).join(' ')||email.split('@')[0];
 const rawTypes=f.types??f.writingtypes??f.writingtype??f.genre??f.genres??f.typeofwriting??'';
 const types=(Array.isArray(rawTypes)?rawTypes:String(rawTypes).split(/[,;|]/)).map(x=>String(x).trim()).filter(Boolean);
 const experience=get('experience','writing experience','experience writing level','writing level','level');
 return {name,email,phone:get('phone','phone number','user_phone_number','mobile','telephone'),level,types,experience,notes:'',samples:[],sources:[]};
}
export function parseInput(text,kind,level){
 text=text.trim();if(!text)throw Error('Choose a file or paste data first.');
 if(text[0]==='['||text[0]==='{')return unwrap(JSON.parse(text)).map(r=>({member:normalize(r,level),raw:r}));
 const header=text.split(/\r?\n/)[0];
 if(/[\t,]/.test(header)&&header.split(/[,\t]/).map(norm).some(h=>['name','email','emailaddress','firstname','fullname','username','useremail','guestname','guestemail','phone'].includes(h)))return csv(text).map(r=>({member:normalize(r,level),raw:r}));
 if(kind==='Email'){
  const from=text.match(/^From:\s*(?:"?([^<\n]+?)"?\s*)?<([^>]+)>/im)||text.match(/^From:\s*([^\s<>]+@[^\s<>]+)/im);
  if(from){const r=from.length===3?{name:from[1].trim().replace(/^"|"$/g,''),email:from[2]}:{email:from[1]};return [{member:normalize(r,level),raw:{...r,message:text}}];}
 }
 throw Error('Use a CSV with Name / Email / Phone columns, Luma JSON, or an email with a From: header. For a message or blog excerpt, select a member to attach it to.');
}
export function matchMember(m,members){
 const email=emailKey(m.email),phone=phoneKey(m.phone);const matches=members.filter(x=>(email&&emailKey(x.email)===email)||(phone&&phoneKey(x.phone)===phone));
 if(matches.length>1)return {conflict:true};return {existing:matches[0]||null};
}
export function merge(existing,incoming,source){
 if(!existing)return {...incoming,sources:[source]};
 return {...existing,name:existing.name||incoming.name,email:existing.email||incoming.email,phone:existing.phone||incoming.phone,experience:existing.experience||incoming.experience,types:existing.types?.length?existing.types:incoming.types,sources:[...(existing.sources||[]),...((existing.sources||[]).some(s=>s.id===source.id)?[]:[source])]};
}
export async function sourceId(kind,label,raw){const bytes=new TextEncoder().encode(JSON.stringify([kind,label,raw]));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function safeUrl(v){try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
