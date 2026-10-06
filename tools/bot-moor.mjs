// Plays Chapter One ("moor") start to end through the debug hooks, the way a player would: walks, switches,
// climbs, swims, lifts and throws, uses pins and handles. Prints each beat's outcome and saves a screenshot at each.
// Usage: node tools/bot-moor.mjs [url] [outDir]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://localhost:4173/?level=moor&fresh';
const outDir = process.argv[3] || 'caps/bot';
fs.mkdirSync(outDir, { recursive: true });
const args = ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
if (process.platform !== 'win32') args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const browser = await chromium.launch({ executablePath: process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/opt/pw-browsers/chromium'), headless: true, args });
const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto(url);
for (let i = 0; i < 600; i++) { if (await page.evaluate(() => window.__ready || window.__error)) break; await new Promise((r) => setTimeout(r, 300)); }
const err = await page.evaluate(() => window.__error || null);
if (err) { console.log('load error', err); process.exit(1); }

// The bot's hands, in the page.
await page.evaluate(() => {
  const V = () => window.__v3;
  window.__bot = {
    S: () => V().state(),
    d: () => window.__moor,
    // Run steps of the sim (no render).
    run(n) { V().step(n); },
    // Walk the active character toward (x, z) until within tol.
    walk(x, z, secs = 20, tol = 0.25, slow = false) {
      const g = V().game, a = g.active;
      for (let i = 0; i < secs * 60; i++) {
        const p = a.char.body.pos, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
        if (d < tol) { V().simMove(0, 0, 0); V().step(12); return 'ok'; }
        const y = g.camera.yaw, fx = -Math.sin(y), fz = -Math.cos(y), ux = dx / d, uz = dz / d;
        const s = Math.min(slow ? 0.45 : 1, d / 0.7 + 0.15);
        V().simMove((ux * -fz + uz * fx) * s, (ux * fx + uz * fz) * s, 0.1);
        V().step(1);
      }
      V().simMove(0, 0, 0);
      return 'timeout at ' + a.char.body.pos.toArray().map((v) => v.toFixed(2)).join(',');
    },
    // Push the stick in a world direction for a while (into a wall to climb; up while climbing is 'up').
    push(wx, wz, secs) {
      const g = V().game;
      for (let i = 0; i < secs * 60; i++) {
        const y = g.camera.yaw, fx = -Math.sin(y), fz = -Math.cos(y);
        V().simMove(wx * -fz + wz * fx, wx * fx + wz * fz, 0.1); V().step(1);
      }
      V().simMove(0, 0, 0);
    },
    stick(mx, my, secs) { V().simMove(mx, my, secs); V().step(Math.round(secs * 60)); V().simMove(0, 0, 0); },
    face(yaw) { const a = V().game.active; a.char.body.yaw = yaw; a.char.body.prevYaw = yaw; },
    as(k) { const g = V().game; if ((k === 'kitten') !== (g.active === g.kitten)) V().swap(); V().step(2); },
    prompt() { const p = V().game.prompt(); return p ? p.text : null; },
    tl() { let n = 0; while (V().timeline.playing && n < 6000) { V().step(1); n++; } return n; },
    pos(k) { const g = V().game; return (k === 'kitten' ? g.kitten : g.knight).char.body.pos.toArray().map((v) => +v.toFixed(2)); },
  };
});
const E = (js) => page.evaluate(js);
const shot = async (name) => { await E('__v3.render()'); await page.screenshot({ path: path.join(outDir, name + '.png') }); };
const check = (name, ok, extra = '') => console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));

// ---- Intro.
await E('__v3.begin(); __bot.tl(); __bot.run(30)');
check('intro ends in play', await E('__moor.stage') === 'play', await E('JSON.stringify(__bot.S())'));

// ---- 1. The Field Wall.
console.log(await E(`__bot.as('knight'); __bot.walk(0, -26.9)`));
console.log('prompt:', await E('__bot.prompt()'));
await E('__v3.act(); __bot.run(30)');
check('gate stays shut for him', !(await E('__moor.state.gate')));
await E(`__bot.as('kitten')`);
console.log(await E(`__bot.walk(4, -27.35)`));
await E(`__bot.push(0, -1, 0.6)`);
check('she takes hold of the ivy', await E('__bot.S().kitten.climb'), await E('JSON.stringify(__bot.S().kitten)'));
await E(`__bot.stick(0, 1, 3.0); __bot.run(60)`);
check("she is over the wall", await E(`__bot.pos("kitten")[2] < -28.4 || __bot.pos("kitten")[1] > 1.5`), JSON.stringify(await E('__bot.pos("kitten")')));
await E(`__bot.push(0, -1, 0.8); __bot.run(40)`);
console.log(await E(`__bot.walk(0.95, -29.2)`));
await E(`__bot.face(0)`);
console.log('prompt:', await E('__bot.prompt()'));
await E('__v3.act(); __bot.run(150)');
check('gate open', await E('__moor.state.gate && __moor.gate.p > 0.9'));
await shot('b1-gate');
await E(`__bot.as('knight')`);
console.log(await E(`__bot.walk(0, -33)`));
check('knight through the gate', await E('__bot.pos("knight")[2] < -31'), JSON.stringify(await E('__bot.pos("knight")')));

// ---- 2. The Ditch.
console.log(await E(`__bot.walk(-2.9, -58.6)`));
await E(`__bot.face(Math.atan2(0.5, -0.8))`);
console.log('prompt:', await E('__bot.prompt()'));
await E('__v3.act(); __bot.run(400)');
check('trunk across the ditch', await E('__moor.trunk.p === 1'));
await shot('b2-trunk');
console.log(await E(`__bot.walk(2.7, -58.6)`), await E(`__bot.walk(2.7, -66.5, 15, 0.3, true)`));
check('knight over the ditch', await E('__bot.pos("knight")[2] < -65 && __bot.pos("knight")[1] > -0.5'), JSON.stringify(await E('__bot.pos("knight")')));
await E(`__bot.as('kitten')`);
console.log(await E(`__bot.walk(2.7, -58.6)`));
await E(`__v3.jump(); __bot.run(6)`);
console.log(await E(`__bot.walk(2.7, -67.0, 15, 0.3)`));
check('kitten over the ditch', await E('__bot.pos("kitten")[2] < -65 && __bot.pos("kitten")[1] > -0.5'), JSON.stringify(await E('__bot.pos("kitten")')));

// ---- 3. The Sheepfold.
await E(`__bot.as('knight')`);
console.log(await E(`__bot.walk(0, -100.1)`));
await E(`__bot.face(Math.PI)`);
await E('__v3.act(); __bot.run(30)');
check('fold gate barred', !(await E('__moor.state.fold')));
await E(`__bot.as('kitten')`);
console.log(await E(`__bot.walk(0.1, -99.4)`), await E(`__bot.walk(0.05, -100.55, 5, 0.12)`));
await E(`__bot.as('knight'); __bot.face(Math.PI)`);
console.log('prompt:', await E('__bot.prompt()'));
await E('__v3.act(); __bot.run(40)');
check('lifted', await E('__bot.S().holding'));
await E('__v3.act(); __bot.run(150)');
check('thrown into the fold', await E('__bot.pos("kitten")[2] < -101.4 && __bot.pos("kitten")[1] < 0.6'), JSON.stringify(await E('__bot.S().kitten')));
await shot('b3-thrown');
console.log(await E(`__bot.walk(0.95, -102.5)`), await E(`__bot.walk(0.95, -102.05, 4, 0.1, true)`));
await E(`__bot.face(0)`);
console.log('prompt:', await E('__bot.prompt()'));
await E('__v3.act(); __bot.run(60)');
check('bar pulled', await E('__moor.state.bar'));
console.log(await E(`__bot.walk(2.21, -102.3)`), await E(`__bot.walk(2.21, -101.85, 4, 0.1, true)`));
await E(`__bot.face(0)`);
await E('__v3.act(); __bot.run(60)');
check('creep stone out', await E('__moor.state.stone'));
console.log(await E(`__bot.walk(2.21, -99.6, 6, 0.2, true)`));
check('through the creep hole', await E('__bot.pos("kitten")[2] > -100.3'), JSON.stringify(await E('__bot.pos("kitten")')));
await E(`__bot.as('knight'); __bot.face(Math.PI)`);
await E('__v3.act(); __bot.run(120)');
check('fold gate shouldered open', await E('__moor.state.fold && __moor.foldGate.p > 0.9'));
await shot('b3-open');
console.log(await E(`__bot.walk(0, -104)`), await E(`__bot.walk(0, -111)`));
check('knight through the fold', await E('__bot.pos("knight")[2] < -110'), JSON.stringify(await E('__bot.pos("knight")')));
await E(`__bot.as('kitten')`);
console.log(await E(`__bot.walk(2.21, -102.5, 6, 0.2, true)`), await E(`__bot.walk(0, -104)`), await E(`__bot.walk(0, -112)`));

// ---- 4. The Mill Stream.
await E(`__bot.as('knight')`);
console.log(await E(`__bot.walk(-10, -134.5)`), await E(`__bot.walk(-10, -140, 6, 0.3)`));
check('knight held at the drop-off', await E('__bot.pos("knight")[2] > -138.7'), JSON.stringify(await E('__bot.S().knight')));
await shot('b4-deep');
console.log(await E(`__bot.walk(-10, -134.5)`));
await E(`__bot.as('kitten')`);
console.log(await E(`__bot.walk(-1.5, -135)`), await E(`__bot.walk(-1.5, -142.2, 20, 0.3)`));
check('she swam the channel', await E('__bot.pos("kitten")[2] < -141.5'), JSON.stringify(await E('__bot.S().kitten')));
await E(`__bot.push(0, -1, 0.6)`);
check('she grabbed the mill timbers', await E('__bot.S().kitten.climb'), JSON.stringify(await E('__bot.S().kitten')));
await E(`__bot.stick(0, 1, 4.5); __bot.run(60)`);
check('she is on the gallery', await E('__bot.pos("kitten")[1] > 2.8'), JSON.stringify(await E('__bot.pos("kitten")')));
console.log(await E(`__bot.walk(-1.8, -142.95, 4, 0.12, true)`));
await E(`__bot.face(Math.PI)`);
console.log('prompt:', await E('__bot.prompt()'));
await E('__v3.act(); __bot.tl(); __bot.run(60)');
check('bridge leaf down', await E('__moor.state.mill && __moor.leaf.p === 1'));
await shot('b4-bridge');
await E(`__bot.as('knight')`);
console.log(await E(`__bot.walk(-6, -133)`), await E(`__bot.walk(-6, -147, 15, 0.3, true)`));
check('knight over the stream', await E('__bot.pos("knight")[2] < -146'), JSON.stringify(await E('__bot.S().knight')));
await E(`__bot.as('kitten')`);
await E(`__bot.push(0, 1, 0.6); __bot.run(120)`);
console.log(await E(`__bot.walk(-4, -146, 20, 0.4)`));

// ---- 5. The Windy Ridge: up to the first shelter together, then the gaps.
await E(`__bot.as('knight')`);
console.log(await E(`__bot.walk(-1, -165)`), await E(`__bot.walk(-1.0, -177.6)`));
await E(`__bot.as('kitten')`);
console.log(await E(`__bot.walk(-1, -165, 30)`), await E(`__bot.walk(-1.2, -178.5, 20)`));
check('kitten sheltered behind the first rock', await E('__v3.WIND.sheltered(__v3.game.kitten.char.body.pos)'));
// Wait for a lull's start, then hop rock to rock.
const lull = `(() => { let n = 0; while (__moor.gusts.phase !== 'gust' && n < 600) { __v3.step(1); n++; } while (__moor.gusts.phase === 'gust' && n < 900) { __v3.step(1); n++; } return n; })()`;
for (const z of [-181.5, -184.5, -187.5, -190.5]) { await E(lull); console.log(await E(`__bot.walk(-1.2, ${z}, 5, 0.25)`)); }
check('kitten across 5a', await E('__bot.pos("kitten")[2] < -190 && __bot.pos("kitten")[1] > 4'), JSON.stringify(await E('__bot.pos("kitten")')));
// Out into the long gap with no help: she should be blown off and put back behind the last rock.
await E(lull);
await E(`__bot.walk(-1.0, -198, 2.4, 0.2); __bot.run(200)`);
check('blown off in the open, back at shelter', await E('__bot.pos("kitten")[2] > -192 && __bot.pos("kitten")[1] > 4'), JSON.stringify(await E('__bot.pos("kitten")')));
// Him in the gap (windward edge, midway), her through his lee.
await E(`__bot.as('knight')`);
console.log(await E(`__bot.walk(-1.3, -197.3, 30)`));
await E(`__bot.as('kitten')`);
await E(lull);
console.log(await E(`__bot.walk(-0.75, -197.6, 5, 0.2)`));
check('kitten in his lee', await E('__v3.WIND.sheltered(__v3.game.kitten.char.body.pos)'), JSON.stringify(await E('__bot.pos("kitten")')));
await E(lull);
console.log(await E(`__bot.walk(-1.2, -204.0, 5, 0.25)`));
check('kitten across 5b', await E('__bot.pos("kitten")[2] < -203 && __bot.pos("kitten")[1] > 4'), JSON.stringify(await E('__bot.pos("kitten")')));
// The cart into gap 1, him into gap 2.
await E(`__bot.as('knight')`);
console.log(await E(`__bot.walk(0.4, -203.5)`), await E(`__bot.walk(-1.0, -204.75, 5, 0.12, true)`));
await E(`__bot.face(Math.PI)`);
console.log('prompt:', await E('__bot.prompt()'));
await E('__v3.act(); __bot.run(420)');
check('cart in the gap', await E('__moor.cart.p === 1'));
console.log(await E(`__bot.walk(0.6, -213)`), await E(`__bot.walk(-1.3, -226.2, 30)`));
await E(`__bot.as('kitten')`);
for (const z of [-211.0, -219.6, -226.4, -233.9, -237.0]) { await E(lull); console.log(await E(`__bot.walk(-0.75, ${z}, 5, 0.25)`)); }
check('kitten across the ridge', await E('__bot.pos("kitten")[2] < -236 && __bot.pos("kitten")[1] > 4'), JSON.stringify(await E('__bot.pos("kitten")')));
await shot('b5-ridge');

// ---- 6. The Tor Gap.
await E(`__bot.as('knight')`);
console.log(await E(`__bot.walk(0.3, -236)`), await E(`__bot.walk(2.1, -246)`));
await E(`__bot.as('kitten')`);
console.log(await E(`__bot.walk(1.6, -244.9)`), await E(`__bot.walk(2.75, -245.1)`), await E(`__bot.walk(2.6, -246, 4, 0.1, true)`));
await E(`__bot.as('knight'); __bot.face(Math.PI / 2)`);
console.log('prompt:', await E('__bot.prompt()'));
// A throw in a lull: short, into the gap, and back.
await E(`(() => { let n = 0; while (__moor.gusts.phase !== 'lull' && n < 600) { __v3.step(1); n++; } })()`);
await E('__v3.act(); __bot.run(30)');
check('lifted on the tor', await E('__bot.S().holding'));
await E(`__bot.face(Math.PI / 2); __v3.act(); __bot.run(180)`);
check('a lull throw falls short and comes back', await E('__bot.pos("kitten")[0] < 3.2 && __bot.pos("kitten")[1] > 5'), JSON.stringify(await E('__bot.pos("kitten")')));
console.log(await E(`__bot.walk(2.75, -245.1)`), await E(`__bot.walk(2.6, -246, 4, 0.1, true)`));
await E(`__bot.as('knight'); __bot.face(Math.PI / 2)`);
await E('__v3.act(); __bot.run(30)');
await E(`(() => { let n = 0; while (__moor.gusts.phase !== 'gust' && n < 600) { __v3.step(1); n++; } })()`);
await E(`__bot.face(Math.PI / 2); __v3.act(); __bot.run(200)`);
check('a gust throw carries her across', await E('__bot.pos("kitten")[0] > 7 && __bot.pos("kitten")[1] > 5'), JSON.stringify(await E('__bot.pos("kitten")')));
await shot('b6-across');
console.log(await E(`__bot.walk(8.6, -243.6)`), await E(`__bot.walk(7.9, -242.85, 6, 0.12, true)`));
await E(`__bot.face(Math.PI)`);
console.log('prompt:', await E('__bot.prompt()'));
await E('__v3.act(); __bot.run(150)');
check('tor bridge down', await E('__moor.state.tor && __moor.torBridge.p === 1'));
await E(`__bot.as('knight')`);
console.log(await E(`__bot.walk(1.8, -242.4)`), await E(`__bot.walk(9, -242.4, 10, 0.3, true)`));
check('knight across the tor', await E('__bot.pos("knight")[0] > 7.5 && __bot.pos("knight")[1] > 5'), JSON.stringify(await E('__bot.pos("knight")')));
await shot('b6-bridge');

// ---- 7. The Castle Gate.
console.log(await E(`__bot.walk(14, -262)`), await E(`__bot.walk(16, -285.5)`));
await E(`__bot.as('kitten')`);
console.log(await E(`__bot.walk(12, -262, 30)`), await E(`__bot.walk(19.3, -285.5, 30)`));
console.log(await E(`__bot.walk(19.3, -295.7, 20, 0.2)`));
check('she swam the moat', await E('__bot.S().kitten.swim || __bot.S().kitten.climb'), JSON.stringify(await E('__bot.S().kitten')));
await E(`__bot.push(0, -1, 0.6)`);
check('she took the chain', await E('__bot.S().kitten.climb'), JSON.stringify(await E('__bot.S().kitten')));
await E(`__bot.stick(0, 1, 7.5); __bot.run(60)`);
check('she is in the winding room', await E('__bot.pos("kitten")[1] > 10'), JSON.stringify(await E('__bot.pos("kitten")')));
console.log(await E(`__bot.walk(18.2, -298.6, 6, 0.15, true)`));
await E(`__bot.face(Math.PI)`);
console.log('prompt:', await E('__bot.prompt()'));
await E('__v3.act(); __bot.run(20)');
await shot('b7-drop');
await E('__bot.tl(); __bot.run(60)');
check('drawbridge down', await E('__moor.state.draw && __moor.draw.p === 1'));
console.log(await E(`__bot.walk(16.35, -298.7, 6, 0.15, true)`));
await E('__bot.run(120)');
check('she dropped into the passage', await E('__bot.pos("kitten")[1] < 6.5'), JSON.stringify(await E('__bot.pos("kitten")')));
await E(`__bot.as('knight')`);
console.log(await E(`__bot.walk(16, -291)`), await E(`__bot.walk(16, -297.3, 10, 0.2, true)`));
await E(`__bot.face(Math.PI)`);
console.log('prompt:', await E('__bot.prompt()'));
await E('__v3.act(); __bot.run(120)');
check('portcullis up and held', await E('__moor.holding && __moor.port.p > 0.95'));
await E(`__bot.as('kitten')`);
console.log(await E(`__bot.walk(17.0, -298.7, 6, 0.12, true)`));
await E(`__bot.face(Math.PI / 2)`);
console.log('prompt:', await E('__bot.prompt()'));
await E('__v3.act(); __bot.run(30)');
check('catch thrown', await E('__moor.state.latched'));
await E(`__bot.as('knight')`);
console.log('prompt:', await E('__bot.prompt()'));
await E('__v3.act(); __bot.run(60)');
check('he let go and it holds', await E('!__moor.holding && __moor.port.p > 0.95'));
await shot('b7-held');
console.log(await E(`__bot.walk(16, -302, 10, 0.3)`));
await E(`__bot.as('kitten')`);
console.log(await E(`__bot.walk(16.5, -302, 10, 0.3)`));
await E('__bot.run(30)');
check('the end plays', await E(`__moor.stage === 'end'`));
await E('__bot.tl()');
await shot('b7-end');

console.log('camera issues:', await E('JSON.stringify((window.__camIssues || []).slice(0, 20))'));
console.log('perf:', await E('JSON.stringify(__v3.perf())'));
const errs = logs.filter((l) => !/GPU stall|Fallback|DevTools|already non-indexed/.test(l));
if (errs.length) console.log(errs.slice(0, 20).join('\n'));
await browser.close();
