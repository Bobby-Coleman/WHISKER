// Single-player following, cosmetic ambient wind, and the designated gust-assisted throw.
// node tools/qa-companions.mjs <release-url> <output-directory>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const [base='http://127.0.0.1:4178/',out='../qa-companions']=process.argv.slice(2);
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
let failures=0;
const check=(name,ok,detail)=>{results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name} ${detail?JSON.stringify(detail):''}`);if(!ok)failures++;};
const E=js=>page.evaluate(js);
try {
  await page.goto(`${base}?level=moor&fresh&nointro&q=medium`);
  await page.waitForFunction(()=>window.__ready||window.__error,{timeout:90000});
  if(await E('window.__error'))throw new Error(await E('window.__error'));
  await E('__v3.renderer.setAnimationLoop(null);__v3.begin();__v3.timeline.skip();__v3.step(60);');
  check('companion follows by default',await E('__v3.game.follower.mode==="follow"'));
  const kittenBefore=await E('__v3.kitten.body.pos.z');
  await E('__v3.simMove(0,1,2);__v3.step(120);__v3.simMove(0,0,0);__v3.step(30);');
  check('kitten follows walking knight without Q',await E(`__v3.kitten.body.pos.z<${kittenBefore}-3`),await E('__v3.state()'));
  const knightBefore=await E('__v3.knight.body.pos.z');
  await E('__v3.setActive("kitten");__v3.simMove(0,1,2);__v3.step(120);__v3.simMove(0,0,0);__v3.step(30);');
  check('knight follows after switching to kitten without Q',await E(`__v3.game.follower.mode==="follow"&&__v3.knight.body.pos.z<${knightBefore}-3`),await E('__v3.state()'));
  await E('__v3.call();__v3.step(30);');
  const parked=await E('__v3.knight.body.pos.toArray()');
  await E('__v3.simMove(0,1,1.5);__v3.step(90);__v3.simMove(0,0,0);__v3.step(30);');
  check('Q explicitly parks the companion',await E(`__v3.game.follower.mode==="wait"&&__v3.knight.body.pos.distanceTo(new __THREE.Vector3(...${JSON.stringify(parked)}))<0.03`));
  await E('__v3.call();__v3.step(180);');
  check('Q calls a parked companion back',await E(`__v3.game.follower.mode==="follow"&&__v3.knight.body.pos.distanceTo(new __THREE.Vector3(...${JSON.stringify(parked)}))>2`));
  await E('__v3.render();');await page.screenshot({path:path.join(out,'walking-together.png')});

  await E('(()=>{const p=__moor.millPlate.pos;__v3.setActive("knight");__v3.teleport("knight",p.x,null,p.z);__v3.teleport("kitten",p.x+2,null,p.z+2);__v3.game.follower.mode="wait";__v3.step(30);})()');
  check('knight presses the puzzle plate',await E('__moor.millPlate.pressed'));
  await E('__v3.setActive("kitten");__v3.simMove(0,-1,1.5);__v3.step(90);__v3.simMove(0,0,0);__v3.step(30);');
  check('switching preserves plate weight',await E('__v3.game.follower.mode==="wait"&&__moor.millPlate.pressed'),await E('__v3.state()'));
  await E('__v3.call();__v3.step(120);');
  check('explicit call can release parked plate weight',await E('__v3.game.follower.mode==="follow"&&!__moor.millPlate.pressed'));

  await E('__v3.setActive("knight");__v3.teleport("knight",-0.00000687,6,-236.793);__v3.teleport("kitten",0,6,-223.631);__v3.game.follower.mode="follow";__v3.game.follower.clear();__v3.step(120);');
  check('companion follows across the ridge terrain seam',await E('__v3.kitten.body.pos.z<-226&&__v3.kitten.body.grounded'),await E('__v3.state()'));

  await E('__v3.setActive("kitten");__v3.teleport("kitten",0,null,-195);__v3.teleport("knight",-1,null,-190);__v3.game.follower.mode="wait";__v3.step(30);');
  const still=await E('(()=>{const p=__v3.kitten.body.pos.clone();let maxGust=0;for(let i=0;i<900;i++){__v3.step(1);maxGust=Math.max(maxGust,__v3.WIND.gust);}return {drift:__v3.kitten.body.pos.distanceTo(p),maxGust,bodyWind:__v3.kitten.body.wind};})()');
  check('strong atmospheric gusts do not move an idle kitten',still.drift<0.01&&still.maxGust>0.9&&still.bodyWind===0,still);

  await E('__v3.teleport("kitten",0.4,null,-246);__v3.step(30);');
  const torStill=await E('(()=>{const p=__v3.kitten.body.pos.clone();let maxPush=0;for(let i=0;i<900;i++){__v3.step(1);maxPush=Math.max(maxPush,__v3.WIND.push);}return {drift:__v3.kitten.body.pos.distanceTo(p),maxPush,bodyWind:__v3.kitten.body.wind};})()');
  check('crossing gust cannot shove a kitten standing on the platform',torStill.drift<0.01&&torStill.maxPush>4.5&&torStill.bodyWind===0,torStill);
  const hop=await E('(()=>{const p=__v3.kitten.body.pos.clone();__moor.gusts.t=3.0;__v3.jump();let maxWind=0;for(let i=0;i<90;i++){__v3.step(1);maxWind=Math.max(maxWind,__v3.game.kitten.motor.windVel.length());}return {drift:Math.hypot(__v3.kitten.body.pos.x-p.x,__v3.kitten.body.pos.z-p.z),maxWind};})()');
  check('ordinary jumping ignores crossing wind',hop.drift<0.01&&hop.maxWind===0,hop);

  const throws=[];
  for(const time of [0,3.25]) {
    throws.push(await E(`(()=>{__v3.setActive("knight");__v3.teleport("knight",2.1,null,-246,Math.PI/2);__v3.teleport("kitten",2.7,null,-246);__v3.game.follower.mode="wait";__v3.step(30);__v3.knight.body.yaw=Math.PI/2;__v3.knight.body.prevYaw=Math.PI/2;__v3.act();__v3.step(20);__moor.gusts.t=${time};__v3.step(1);const holding=__v3.game.carry.holding,arc=new Float32Array(108),count=__v3.game.carry.predict(arc);__v3.knight.body.yaw=Math.PI/2;__v3.knight.body.prevYaw=Math.PI/2;__v3.act();__v3.step(120);return {holding,arc:Array.from(arc.slice(0,count*3)),cat:__v3.kitten.body.pos.toArray(),knight:__v3.knight.body.pos.toArray()};})()`));
  }
  check('both throw setups lift the kitten',throws.every(t=>t.holding));
  const arcDifference=Math.max(...throws[0].arc.slice(0,Math.min(throws[0].arc.length,throws[1].arc.length)).map((v,i)=>Math.abs(v-throws[1].arc[i])));
  const landingDifference=Math.max(...throws[0].cat.map((v,i)=>Math.abs(v-throws[1].cat[i])));
  check('crossing gust extends the thrown arc',arcDifference>1&&landingDifference>2,{arcDifference,landingDifference});
  check('tor throw needs its designated crossing gust',throws[0].cat[0]<3.2&&throws[0].cat[1]>5&&throws[1].cat[0]>7&&throws[1].cat[1]>5,throws.map(t=>t.cat));
  check('automatic follower waits at the unbridged tor edge',throws.every(t=>t.knight[0]<3.2&&t.knight[1]>5),throws.map(t=>t.knight));
  const landed=await E('(()=>{__v3.step(30);const p=__v3.kitten.body.pos.clone();__v3.step(120);return {drift:__v3.kitten.body.pos.distanceTo(p),thrown:__v3.game.kitten.motor.thrown,wind:__v3.game.kitten.motor.windVel.length()};})()');
  check('landing immediately releases the crossing wind',landed.drift<0.01&&!landed.thrown&&landed.wind===0,landed);

  await E('__v3.load("prologue")');
  await E('__v3.begin();__prologue.opening();__v3.step(14*60);__v3.render();');
  const prologue=await E('({canSwitch:__v3.game.canSwitch,follow:__v3.game.follower.mode,speed:__v3.knight.body.vel.length(),seated:__v3.knight.seated})');
  check('prologue retains scripted wounded walk',!prologue.canSwitch&&prologue.follow==='wait'&&prologue.speed>0.1&&prologue.seated===0,prologue);
  check('no JavaScript or shader errors',errors.length===0,errors);
} catch(e) {failures++;results.push({name:'test execution',ok:false,detail:String(e)});console.log('FAIL',e);}
finally {fs.writeFileSync(path.join(out,'companions-results.json'),JSON.stringify({testedAt:new Date().toISOString(),failures,results},null,2));await browser.close();}
process.exitCode=failures?1:0;
