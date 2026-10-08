// Production QA: actual renderer timings, transitions and camera poses on installed Chrome.
// Usage: node tools/qa-release.mjs <new-url> <baseline-url> <output-directory>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const [url='http://127.0.0.1:4178/',old='http://127.0.0.1:4177/',out='../qa']=process.argv.slice(2);
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const results=[]; let failures=0;
function check(name,ok,detail){console.log(`${ok?'PASS':'FAIL'} ${name} ${detail?JSON.stringify(detail):''}`);if(!ok)failures++;results.push({name,ok,detail});}
async function pageFor(base,level,q,network=false,mobile=false){
  const context=await browser.newContext({viewport:mobile?{width:844,height:390}:{width:1280,height:720},deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  if(network){const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:1250000,uploadThroughput:1250000});}
  const begin=Date.now();await page.goto(`${base}?level=${level}&q=${q}&fresh&nointro&camcheck`);await page.waitForFunction(()=>window.__ready||window.__error,{timeout:90000});
  check(`${base} ${level}/${q} boot`,!(await page.evaluate(()=>window.__error)),{ms:Date.now()-begin,errors});
  return {page,context,errors,readyMs:Date.now()-begin};
}
for(const [label,base] of [['baseline',old],['improved',url]]) {
  const {page,context,errors,readyMs}=await pageFor(base,'prologue','medium',true);
  const payload=await page.evaluate(()=>({bytes:performance.getEntriesByType('resource').reduce((n,r)=>n+r.decodedBodySize,0),files:performance.getEntriesByType('resource').filter(r=>r.decodedBodySize>0).map(r=>({file:r.name.split('/').pop(),bytes:r.decodedBodySize})),loadMs:window.__loadMs}));
  results.push({name:`${label} cold10Mbps`,readyMs,...payload});console.log(label,'cold10Mbps',readyMs,'ms',payload.bytes,'bytes');
  if(label==='improved') {
    await page.evaluate(()=>{__v3.renderer.setAnimationLoop(null);__v3.begin();});
    await page.waitForTimeout(1350);
    await page.evaluate(()=>{__prologue.opening();__v3.step(14*60);__v3.render();});
    const walk=await page.evaluate(()=>({grounded:__v3.knight.body.grounded,speed:__v3.knight.body.vel.length(),pos:__v3.knight.body.pos.toArray(),seated:__v3.knight.seated}));
    check('wounded knight really walks',walk.grounded&&walk.speed>0.1&&walk.seated===0,walk);
    await page.screenshot({path:path.join(out,'prologue-walk.png')});
    await page.evaluate(()=>{__v3.pause(true);__v3.step(120);});
    check('pause freezes cutscene clock',await page.evaluate(()=>Math.abs(__v3.timeline.t-14.0001)<0.02),await page.evaluate(()=>__v3.timeline.t));
    await page.evaluate(()=>{__v3.pause(false);__v3.step(18*60);__v3.render();});
    const seat=await page.evaluate(()=>({seated:__v3.knight.seated,pos:__v3.knight.body.pos.toArray(),matricesFinite:(()=>{let valid=true;__v3.knight.group.traverse(o=>{if(o.matrixWorld.elements.some(v=>!Number.isFinite(v)))valid=false;});return valid;})()}));
    check('seated knight stable',seat.seated===1&&seat.matricesFinite,seat);await page.screenshot({path:path.join(out,'prologue-seat.png')});
    await page.evaluate(()=>{__v3.step(16*60);__v3.teleport('kitten',0,null,1.3);__v3.step(1);__v3.render();});
    check('kitten finds knight',await page.evaluate(()=>__prologue.stage==='found'),await page.evaluate(()=>__prologue.stage));
    await page.evaluate(()=>{__v3.step(10*60);__v3.render();});await page.screenshot({path:path.join(out,'prologue-lap.png')});
    await page.evaluate(async()=>{__v3.kitten.sit=1;__v3.kitten.curl=1;__v3.knight.seated=1;__v3.knight.shelter=1;await __v3.load('moor');__v3.play();__v3.step(60);__v3.render();});
    const upright=await page.evaluate(()=>({kitten:{form:__v3.kitten.form,sit:__v3.kitten.sit,curl:__v3.kitten.curl},knight:{seated:__v3.knight.seated,gait:__v3.knight.gait,shelter:__v3.knight.shelter}}));
    check('chapter handoff clears story pose',upright.kitten.form==='biped'&&!upright.kitten.sit&&!upright.kitten.curl&&!upright.knight.seated&&!upright.knight.shelter&&upright.knight.gait==='normal',upright);
    await page.evaluate(()=>{const p=__v3.knight.renderPos;__v3.camAt(p.x-1.8,p.y+1.7,p.z+6.8,p.x,p.y+0.9,p.z,35);__v3.render();});await page.screenshot({path:path.join(out,'moor-pair.png')});
    const issues=await page.evaluate(()=>__camIssues||[]);check('prologue camera clear',issues.length===0,issues.slice(0,8));
    await page.evaluate(async()=>{await Promise.all([__v3.go('moor'),__v3.go('prologue')]);__v3.render();});
    check('overlapping chapter requests serialize safely',await page.evaluate(()=>__v3.level.id==='moor'&&__v3.game.physics===__v3.physics&&__v3.scene.children.filter(o=>o.name.startsWith('Level_')).length===1));
    check('no release JavaScript or shader errors',errors.length===0,errors);
  }
  await context.close();
}
for(const q of ['low','medium','high']) {
  const {page,context,errors}=await pageFor(url,'moor',q,false,q==='low');
  await page.evaluate(()=>{__v3.begin();__v3.camYaw(0,0.3);});
  const timing=await page.evaluate(async()=>{const samples=[];let prev=performance.now();for(let i=0;i<210;i++){await new Promise(requestAnimationFrame);const now=performance.now();if(i>30)samples.push(now-prev);prev=now;}samples.sort((a,b)=>a-b);return {medianMs:samples[Math.floor(samples.length/2)],p95Ms:samples[Math.floor(samples.length*.95)],...__v3.perf()};});
  results.push({name:`moor ${q} timing`,...timing});console.log(q,timing);
  await page.screenshot({path:path.join(out,`moor-${q}.png`)});
  if(q==='low'){check('mobile buttons visible',await page.locator('.kk-pad button[data-c="Space"]').isVisible());await page.getByRole('button',{name:'Menu',exact:true}).click();check('mobile menu opens',await page.locator('.menu').evaluate(e=>e.classList.contains('open')));check('licenses available',await page.locator('.credits').getAttribute('href')!==null);}
  check(`${q} no errors`,errors.length===0,errors);
  await context.close();
}
fs.writeFileSync(path.join(out,'qa-results.json'),JSON.stringify({testedAt:new Date().toISOString(),failures,results},null,2));await browser.close();process.exitCode=failures?1:0;
