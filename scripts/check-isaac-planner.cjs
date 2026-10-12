const {chromium}=require('@playwright/test');
const fs=require('fs');const http=require('http');const path=require('path');const assert=require('assert');
(async()=>{
const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{const f=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);if(!fs.existsSync(f)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(f));}).listen(0);
const browser=await chromium.launch({headless:true});try{
const context=await browser.newContext();const rows=new Map();let failSave=false;const errors=[];
await context.route('**/*.supabase.co/**',async route=>{
const req=route.request();const url=new URL(req.url());if(!url.pathname.endsWith('/book_state'))return route.fulfill({json:[]});
if(req.method()==='POST'){if(failSave)return route.fulfill({status:503,json:{error:'offline'}});const body=req.postDataJSON();rows.set(body.key,body);return route.fulfill({status:201,json:[]});}
return route.fulfill({json:[...rows.values()].filter(r=>r.key.startsWith('isaac-loadout-'))});
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await page.goto(`http://localhost:${server.address().port}`);await page.locator('.nav-item[data-id="isaac"]').click();await page.getByText('Connected · edits autosave to Supabase').waitFor();
assert.equal(await page.locator('.isaac-character').count(),34);assert(await page.locator('.isaac-base').first().innerText().then(x=>x.includes('D6')));
await page.locator('[data-character="isaac"] [data-field="items"]').fill("Mom's Knife (114), Soy Milk (330)");
await page.locator('[data-character="isaac"] [data-field="custom"]').fill('<script>not executable</script> custom idea');
await page.locator('[data-character="isaac"] button').last().click();await page.locator('#isaac-status-isaac').filter({hasText:'Saved to Supabase'}).waitFor();
assert.equal(rows.get('isaac-loadout-isaac').state.keepNormalStartingItems,true);
await page.reload();await page.getByText('Connected · edits autosave to Supabase').waitFor();assert.equal(await page.locator('[data-character="isaac"] [data-field="items"]').inputValue(),"Mom's Knife (114), Soy Milk (330)");
assert.equal(await page.locator('[data-character="isaac"] [data-field="custom"]').inputValue(),'<script>not executable</script> custom idea');
await page.locator('#isaacFilter').selectOption('tainted');assert.equal(await page.locator('.isaac-character:visible').count(),17);await page.locator('#isaacSearch').fill('lost');assert.equal(await page.locator('.isaac-character:visible').count(),1);
await page.locator('#isaacFilter').selectOption('all');await page.locator('#isaacSearch').fill('');
failSave=true;await page.locator('[data-character="isaac"] [data-field="trinkets"]').fill('Curved Horn');await page.locator('[data-character="isaac"] button').last().click();await page.locator('#isaac-status-isaac').filter({hasText:'Not saved'}).waitFor();await page.getByRole('button',{name:'Reload saved designs'}).click();await page.getByText('Reload paused: save pending edits first.').waitFor();assert.equal(await page.locator('[data-character="isaac"] [data-field="trinkets"]').inputValue(),'Curved Horn');failSave=false;await page.locator('[data-character="isaac"] button').last().click();await page.locator('#isaac-status-isaac').filter({hasText:'Saved to Supabase'}).waitFor();
await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
await page.screenshot({path:path.join(root,'../tmp/isaac-planner-mobile.png'),fullPage:false});assert.equal(errors.length,0,errors.join('\n'));
console.log('PASS: 34 characters, 17 tainted, protected D6 baseline, persistence/reload, safe text, search, failed-save recovery, mobile width, no runtime errors');
}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
