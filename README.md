# WHISKER

A small armoured kitten and a wounded knight cross a foggy, wind-cut moor. Play one, switch to the other, and use what each can do to build a road both can cross. The playable game contains **The Hawthorn prologue** and **Chapter One: The Road to the Castle**, with seven connected puzzle sequences.

Play at https://bobby-coleman.github.io/WHISKER/. The default game is the lean WebGL 2 engine in `src/v3`; the earlier experiments remain in the source repository.

## This improvement pass

The work started from `next-pass` commit `4e51307`, which was the source of the live site, and examined the older `main` field and the supplied reference clip. The sequence was: fix character and cutscene ownership, restore atmosphere within the lean renderer, make puzzle dependencies physical and persistent, then iterate with production playthroughs and visual/performance checks.

- **Atmosphere:** muted wet turf, pale overcast reflections, soft shadows, depth and low ground fog, wind-driven mist, coherent grass/tree/banner/water/cloth movement, lower opening banks and restrained film grain. Fog leaves close puzzle controls clear and distant towers readable.
- **Characters:** explicit story-pose reset across chapters; scripted movement is posed after physics so the prologue walk animates correctly; newer cutscene marks own a character rather than old tracks rewinding it. Smaller helm and gauntlets, a two-handed idle sword, softer kitten face/eyes and short fur detail. Cloth motion is substepped at low frame rates.
- **Play:** genuine kitten/knight dependencies at the root hollow and mill; persistent weight substitution; throw prediction; automatic companion following with safe routes; both-character checkpoints; optional progressive hints; matching visible ridge slopes and fall recovery. Switching preserves plate weight and held actions; Q explicitly parks or calls the companion.
- **Startup and frame cost:** legacy renderer modules load only on explicit request in a developer build; the release omits them. The rig payload is 358,936 bytes instead of 3,566,412, retaining the exact required tracks and hierarchy. Grass roots update on cell crossings, distant blades use simpler geometry, water detail uses fewer samples, forest cells cull, and idle ropes no longer rebuild each frame. The release does not fetch fonts, textures, music files or remote assets.
- **Reliability:** pause freezes the cutscene clock; input clears across blur/pause/load; level changes clear old captions and cancel stale chapter handoffs; asynchronous shader compilation lets the loading screen paint.

## Controls

| Keyboard | Gamepad | Touch | Action |
|---|---|---|---|
| WASD / arrows | Left stick | Left thumb | Move relative to camera |
| Mouse drag / click to capture | Right stick | Right thumb | Look |
| Wheel | | | Camera distance |
| Space (hold for height) | A / Cross | Jump | Jump / climb out of water |
| E | X / Square | Act | Use, lift, throw |
| Tab | Y / Triangle | Switch | Change character; the companion follows unless holding a puzzle role |
| Q | B / Circle | Wait / Call | Park companion / call back; meow in prologue; put down when carrying |
| G | LB | Hint | Progressive puzzle hint |
| Shift | RB | Partial stick | Walk |
| Esc | | Menu | Pause, quality, chapters, checkpoint restart, volume, credits |

The kitten swims, climbs marked ivy/timber/rope, fits low passages, and rides throws. The knight cannot swim deep channels or climb delicate ivy; he moves heavy ballast, pivots machinery, throws her, and holds gates. Ordinary walking follows automatically in either direction after a switch. Leaving a companion on a weight plate or in a held action preserves that role; Q parks or calls them along a safe route. The HUD shows following, waiting, or holding.

Ambient wind moves scenery and cloth, never walking characters. Only a carried, airborne throw at the designated tor crossing receives gust assistance. Ordinary jumps ignore wind, and landing immediately clears the crossing's force.

## Puzzle progression (spoilers)

1. **Field wall:** the kitten climbs ivy and releases a loop the knight cannot reach.
2. **Root hollow:** she reaches the recessed repair wedge through a low passage; he swings the freed oak across the ditch.
3. **Sheepfold:** he throws her over, she pulls the inside bar and opens a return crawl hole, then he forces the swollen gate.
4. **Mill scales:** his weight demonstrates the plate/winch connection. He substitutes stone ballast for himself, moves to the distant winch and unloads the bridge rope. She swims, climbs the gallery and releases the pink pin. The bridge latches permanently.
5. **Rocky ridge:** a heavy cart is wedged across a narrow rock cutting. He shoves it into a stone lay-by so both can pass. Wind remains atmospheric here.
6. **Tor gap:** the gust becomes useful. A timed, aimed throw carries her to the far pin that lowers his crossing.
7. **Castle gate:** she swims/climbs to release the drawbridge; he holds the portcullis while she sets its inside catch. Both enter the bailey.

[Research and applied design principles](docs/research/coop-pass.md) connect these changes to primary developer/publisher sources for *It Takes Two* and *Wyv and Keep*. Layouts, art and music from those games are not used.

## Build and verify

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 4175
npm run check:game
npm run release
npm run preview -- --outDir release --host 127.0.0.1 --port 4178
node tools/bot-coop.mjs http://127.0.0.1:4178/?level=moor&fresh work/coop-caps
node tools/qa-companions.mjs http://127.0.0.1:4178/ work/companions-qa
node tools/qa-release.mjs http://127.0.0.1:4178/ http://127.0.0.1:4177/ work/qa
```

`release/` is the paid-distribution-compatible default game: JavaScript, the two reduced CC0 rig files, credits and required software notices. Serve it through HTTP; opening the HTML directly from disk is not supported by module/asset loading. `npm run build` produces `dist/`, including optional legacy experiments; `?v1` and `?v2` work there. The lean release deliberately includes only v3.

`tools/optimize-rig.mjs` reproducibly builds the reduced files from the preserved originals in `public/chars/`. For a host requiring JSON glTF, generate matching `*-lite.gltf.json` files before setting `VITE_CHARS_EXT=.gltf.json`.

The bot drives actual movement, climbing, swimming and interactions rather than invoking puzzle completion methods. It checks negative preconditions, all crossings, both-character checkpoint persistence and reload. Companion QA checks automatic following in both directions, explicit wait/call, preserved plate weight, cosmetic ordinary wind, the exceptional crossing throw, and safe stopping at an unbridged cliff. The production QA tool records cold-load payload/timing under a controlled 10 Mbps connection, animation/pose handoffs, cutscene pause, camera clearance, touch UI and low/medium/high frame timing. It uses installed Chrome and writes captures/results locally. `tools/bot-moor.mjs` remains a compatible alias.

The scoped game typecheck passes. A full `tsc --noEmit` also checks the preserved v1 experiments and still reports their pre-existing TSL/typing issues. Current validation is desktop Chrome on an NVIDIA GPU plus touch/viewport emulation; this is not a real-phone frame-rate measurement. This remains a one-player character-switching prototype, not network or split-screen multiplayer, and later chapters in the story drafts are not implemented.

## Credits and distribution

The default game's character skeleton/animations are Quaternius Universal Animation Library assets, CC0 1.0. Runtime animation files are reduced, not replaced. Geometry, coat detail, scenery, sky, fog, sound effects and score in v3 are generated by project code. No reference-video footage is distributed.

- [Quaternius Library](https://quaternius.com/packs/universalanimationlibrary.html), [Library 2](https://quaternius.com/packs/universalanimationlibrary2.html) and [CC0 FAQ](https://quaternius.com/faq.html).
- three.js: MIT. Copyright/license included in `public/licenses/three-MIT.txt`.
- Rapier / Dimforge: Apache 2.0. License included in `public/licenses/rapier-Apache-2.0.txt`; physics library unmodified.
- Optional legacy skies/surfaces/models: Poly Haven, CC0 ([license](https://polyhaven.com/license)); optional props: Quaternius, CC0. Original asset-source tools and credits are retained. These assets are omitted from the lean release.

The in-game menu links to `CREDITS.html`, which ships with the release. No noncommercial, editorial-only, or share-alike assets were added in this pass.
