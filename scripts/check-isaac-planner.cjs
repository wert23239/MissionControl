const {chromium}=require('@playwright/test');
const fs=require('fs');const http=require('http');const path=require('path');const assert=require('assert');
(async()=>{
const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{const f=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);if(!fs.existsSync(f)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(f));}).listen(0);
const browser=await chromium.launch({headless:true});try{
const context=await browser.newContext();const rows=new Map();let failSave=false;const errors=[];
await context.route('**/*.supabase.co/**',async route=>{
const req=route.request();const url=new URL(req.url());if(!url.pathname.endsWith('/book_state'))return route.fulfill({json:[]});
if(req.method()==='POST'){if(failSave)return route.fulfill({status:503,json:{error:'offline'}});const body=req.postDataJSON();rows.set(body.key,body);return route.fulfill({status:201,json:[]});}
return route.fulfill({json:[...rows.values()].filter(r=>r.key.startsWith('isaac-'))});
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await page.goto(`http://localhost:${server.address().port}`);await page.locator('.nav-item[data-id="isaac"]').click();await page.getByText('Connected · edits autosave to Supabase').waitFor();
assert.equal(await page.locator('.isaac-character').count(),34);assert.equal(await page.locator('.isaac-build-evidence').count(),34);assert.equal(await page.locator('[data-character="isaac"] [data-field="mode"]').inputValue(),'optional');assert(await page.locator('.isaac-base').first().innerText().then(x=>x.includes('D6')));
await page.locator('[data-character="isaac"] [data-field="items"]').fill("Mom's Knife (114), Soy Milk (330)");
await page.waitForFunction(()=>document.querySelectorAll('#isaacItemNames option').length>0);
await page.locator('[data-character="isaac"] [data-field="items"]').fill('Champion Belt (208)');
assert.equal(await page.locator('#isaac-passives-isaac .isaac-item-tag').count(),3);
assert.equal(await page.locator('[data-character="isaac"] [data-field="items"]').inputValue(),'');
await page.getByRole('button',{name:'Remove Champion Belt (208)',exact:true}).click();
assert.equal(await page.locator('#isaac-passives-isaac .isaac-item-tag').count(),2);
await page.locator('[data-character="isaac"] [data-field="custom"]').fill('<script>not executable</script> custom idea');
await page.locator('[data-character="isaac"] button').last().click();await page.locator('#isaac-status-isaac').filter({hasText:'Saved to Supabase'}).waitFor();
assert.equal(rows.get('isaac-loadout-isaac').state.keepNormalStartingItems,true);
await page.reload();await page.getByText('Connected · edits autosave to Supabase').waitFor();assert.equal(await page.locator('#isaac-passives-isaac .isaac-item-tag').count(),2);assert((await page.locator('#isaac-passives-isaac').innerText()).includes("Mom's Knife (114)"));
assert.equal(await page.locator('[data-character="isaac"] [data-field="custom"]').inputValue(),'<script>not executable</script> custom idea');
await page.locator('[data-character="isaac"] input[type="file"]').setInputFiles({name:'custom-icon.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=','base64')});
await page.locator('#isaac-icon-isaac img').waitFor();await page.waitForFunction(()=>document.querySelector('#isaac-icon-isaac img').naturalWidth>0);
await page.waitForFunction(()=>document.querySelector('#isaac-status-isaac').textContent.includes('Saved to Supabase'));
assert(rows.get('isaac-loadout-isaac').state.icon.startsWith('data:image/png;base64,'));
rows.set('isaac-build-isaac',{key:'isaac-build-isaac',state:{implemented:true,inGameTested:true,designUpdatedAt:rows.get('isaac-loadout-isaac').state.updatedAt,notes:'D6 + Knife + Soy verified',version:'test-build',image:`http://localhost:${server.address().port}/assets/isaac/isaac-knife-soy-tested.jpg`,imageLabel:'In-game screenshot'}});
await page.reload();await page.getByText('Connected · edits autosave to Supabase').waitFor();await page.waitForFunction(()=>document.querySelector('#isaac-icon-isaac img').naturalWidth>0);
assert((await page.locator('[data-character="isaac"] summary').innerText()).includes('Tested in-game'));assert.equal(await page.locator('[data-character="isaac"] .isaac-build-evidence').evaluate(el=>el.firstElementChild.tagName),'A');
assert.equal(await page.locator('[data-character="isaac"] [data-field="custom"]').inputValue(),'<script>not executable</script> custom idea');
await page.locator('[data-character="isaac"] [data-field="icon"]').fill('javascript:alert(1)');assert.equal(await page.locator('#isaac-icon-isaac img').count(),0);
await page.locator('[data-character="isaac"]').getByRole('button',{name:'Clear icon'}).click();assert.equal(await page.locator('#isaac-icon-isaac img').count(),0);
await page.locator('#isaacFilter').selectOption('tainted');assert.equal(await page.locator('.isaac-character:visible').count(),17);await page.locator('#isaacSearch').fill('lost');assert.equal(await page.locator('.isaac-character:visible').count(),1);
await page.locator('#isaacFilter').selectOption('all');await page.locator('#isaacSearch').fill('');
failSave=true;await page.locator('[data-character="isaac"] [data-field="trinkets"]').fill('Curved Horn');await page.locator('[data-character="isaac"] button').last().click();await page.locator('#isaac-status-isaac').filter({hasText:'Not saved'}).waitFor();await page.getByRole('button',{name:'Reload saved designs'}).click();await page.getByText('Reload paused: save pending edits first.').waitFor();assert.equal(await page.locator('[data-character="isaac"] [data-field="trinkets"]').inputValue(),'Curved Horn');failSave=false;await page.locator('[data-character="isaac"] button').last().click();await page.locator('#isaac-status-isaac').filter({hasText:'Saved to Supabase'}).waitFor();
await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
await page.screenshot({path:path.join(root,'../tmp/isaac-planner-mobile.png'),fullPage:false});await page.reload();await page.getByText('Connected · edits autosave to Supabase').waitFor();assert((await page.locator('[data-character="isaac"] summary').innerText()).includes('Design changed'));assert.equal(errors.length,0,errors.join('\n'));
console.log('PASS: 34 characters, 17 tainted, protected D6 baseline, persistence/reload, safe text, search, failed-save recovery, mobile width, icon upload/persistence/clear, unsafe URL rejection, tag selection/removal/persistence, custom default, per-character tracking, screenshot-first, no runtime errors');
}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
