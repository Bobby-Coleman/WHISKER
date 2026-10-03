# Whisker

A browser game built from the *Kitten and Knight* game specification and its reference clip (neither is included in this repository). A small armoured kitten and a tall knight cross a wet, wind-torn moor to the castle. You play one of them while the other follows, and switch whenever you like: most of the way can only be made with both, the kitten for what is small and the knight for what is heavy.

Play it at https://bobby-coleman.github.io/WHISKER/. It runs best on WebGPU and falls back to WebGL2 where WebGPU is missing.

## The story

The moor kept a watch of nine knights once. Now it keeps one, and she is very small. A knight comes out of the fog with the castle's seal: every watch is called home before the marsh rises. She does not leave her post for strangers.

It is told in chapter cards, a few lines at a time and short camera moments, never long cutscenes. The kitten starts out keeping her distance and will not let the knight pick her up; each place they get through together closes the gap (she follows closer, and from the third chapter she lets him lift her). The weather turns from morning mist to haze to dusk as they go.

| | Chapter | |
| --- | --- | --- |
| | **The Last Watch** | who they are and why they go |
| I | **The Sheepfold** | she lets the stranger in |
| II | **The Chapel** | it opens to two; eight empty pegs and one small shield |
| III | **The Bell** | she lets him lift her; the castle answers |
| IV | **The Causeway** | the drowned road and the sluice |
| V | **The Warden's Gate** | he holds the gate while she runs under |

## Controls

| Keyboard and mouse | Gamepad | Touch | Action |
| --- | --- | --- | --- |
| WASD or arrows | Left stick | Left thumb (floating stick) | Move, relative to the camera |
| Shift | Hold RB | Push the stick part way | Walk |
| Space | A | Jump | Jump |
| Mouse (click to capture, Esc to release) or drag | Right stick | Right thumb drag | Look |
| Wheel | | | Camera distance |
| Tab | Y | Switch | Change between the kitten and the knight |
| E | X | Act | Interact (lift, pull, turn, take) |
| Q | B | Wait | The companion waits or follows |
| G | LB | Hint | A hint for where you are stuck (one also comes on its own after a long while) |
| R | Back | | Back to where the current chapter began |
| H | | Settings button | Settings and controls panel |
| C / F | | | Clean render (no image treatment) / 4:3 reference framing |
| P | | Settings | Performance stats |
| 1-4, 0 | | | Review camera presets, 0 returns to play |

The settings panel also has the look (Modern or Vintage), the treatment-strength slider, ambient occlusion, the handheld camera, quality (high, medium, low), adaptive resolution, volume and a material lab.

## The five puzzles (spoilers)

1. **The Sheepfold.** The knight cannot fit through the drain under the yard wall east of the gate. The kitten can. Inside she hangs from the winch handle and her weight brings the gate up.
2. **The Chapel.** The door needs both pressure stones held at once. The big flagstone ignores the kitten, and the small stone sits in a gap the knight cannot crawl into. Walk the knight onto the flagstone and switch to the kitten (he keeps his weight on it), then crawl her through the gap to the small stone. Inside, she takes the last small shield.
3. **The Bell** (north-west). The tower door is barred from inside. The knight lifts the kitten (once she trusts him) and sets her on the window ledge. She rides the bell rope down, which rings the bell, and the castle on the horizon answers. Then she lifts the door bar.
4. **The Causeway.** The marsh has drowned the castle road, too deep for either of them. At the sluice on its east bank, only the kitten fits through the hatch of the pin hut, where she pulls the pin that locks the wheel. The knight turns the wheel until the gate jams a hand's breadth up. The beam over the gate would never hold the knight, but the kitten can jump onto it (or be set on it) and kick loose the branch caught in the slot. The knight turns the wheel again, and the marsh drains off the road.
5. **The Warden's Gate.** The portcullis is far too heavy for a kitten. The knight heaves it up and holds it, but not for long: switch to the kitten, run under it and pull the counterweight release in the bay behind, and the gate stays up. If his arms give first, he can lift it again.

## Image

- **Photographed overcast skies.** Three CC0 Poly Haven skies (one per weather) light the moor and fill its reflections, each scaled so the light it casts on level ground matches the tuning target. The mist band at the horizon and the ground below it are added from the fog's real depth along each ray, so polished steel reads the way it does in the clip: bright streaks of sky and mist, darker where it mirrors the turf.
- **Scanned surfaces.** The ground, mud, stone, timber and slates are CC0 photoscans (Poly Haven), packed into two WebP textures each (colour and height, normal, roughness and occlusion) and blended by height, triplanar where they wrap.
- **Steel.** Plate is worked steel with baked occlusion, edge and cavity masks, etched scrollwork, hammered dents, scratches in the roughness and a film of rain (beads on faces that look up, runs on the sides) as a clear coat. Screen-space reflections at half resolution (high quality) let it mirror what is really around it, the wearer's own sleeves, the ground and the other character.
- **Fur and eyes.** About 87,000 groomed strands over a shell undercoat, with clumping in three levels, flyaways and length maps after a production groom. The kitten's eyes were sized and placed from the reference in face widths, with a wet cornea and a catchlight.
- **Temporal anti-aliasing** on the HDR image (TRAA with motion vectors; fur and grass blades write their own), then depth of field, bloom, filmic tone mapping and the grade.
- **Ambient occlusion.** Ground-truth AO at half resolution, depth-aware blurred, sized to the character on screen, sparing polished metal.
- **The wind and the camera.** A gale with gusts drives the grass, reeds, drizzle and the cape, which streams out sideways and whips in the gusts. The camera is handheld, as if someone were following on foot: breathing drift, a step bob while moving and a judder in the gusts (it can be turned off in the settings).
- **Two looks.** *Modern* (the default) keeps colour and depth with a gentle S-curve and sharpening. *Vintage* keeps the reference clip's archive feel: lifted blacks, muted colour, softened luma and chroma, faint compression breakup, grain and lens falloff. The treatment slider scales either one, and C turns both off.

## Performance

Measured on a laptop RTX 4070 at 1920x1080, high quality: 91-104 fps, 5.1-5.5 ms of GPU time per frame with SSR, AO and TAA on. That leaves room for 60 fps on a mid-range desktop GPU; medium and low quality drop SSR, AO and density for older machines and phones.

- **Loading bar.** The title screen shows each loading stage and how long it took; the same timings print to the console and appear in the stats panel.
- **Stats panel (P).** Frame rate, frame time with the worst recent frame, main-thread and GPU time, render resolution, draw calls and triangles.
- **Adaptive resolution.** When frames run long, the render resolution drops (down to 55%) and climbs back when there is room.
- **Few shaders.** Materials take per-object numbers as uniforms rather than baking them into shaders, and plants sit in large shared instanced batches, so the game compiles about 150 shader modules.

## Departures from the spec

The spec was treated as a guide. Where it and the reference clip disagree, the clip wins.

- **Hero characters are built in Blender by script.** Every model is generated by Python scripts in `blender/` instead of being sculpted by hand, so each can be rebuilt and tuned. The kitten's head is sculpted from signed-distance shapes, baked to colour, normal and roughness maps, and groomed. The plate, swords, the knight's helm and the boots are hard-surface models with rolled edges, rivets and baked masks. The code-built characters stay as the low-quality fallback.
- **Strand fur, which the spec rules out.** The clip's kitten is a fluffy longhair, and shells alone read as felt up close, so the kitten has groomed strands drawn as camera-facing ribbons with a hair shading model on top of a shell undercoat.
- **Grass is generated on the GPU.** Around the camera every blade is built in the vertex shader from a world-anchored grid, in two rings, clumped into tufts, bending with the wind by angle (so gusts flatten rather than stretch it) and parting around the characters' feet.
- **Custom physics and navigation instead of Rapier and Recast.** A small kinematic controller with per-character collision masks (the drain and the hatch admit only the kitten, the beam carries only her, a held portcullis lets only her under) and a region graph for the companion.
- **Models ship as base64 text** for the artifact host; dev builds read the binaries.

## Building

```
npm install
npm run dev                # http://localhost:5173 (?q=low|medium|high, ?webgl, ?look=vintage, ?ssr=0, ?aa=fxaa)
npm run build              # dist/
npm run artifact           # build, then write dist/artifact.html
```

Photographed assets: `node tools/fetch_assets.mjs` downloads the Poly Haven skies and textures into `assets-src/` (not committed), and `node tools/build_assets.mjs` writes the sky images, their light measurements (`public/models/env.json`) and the packed textures (`public/tex/`).

Hero assets need Blender 5.2 run with a Python path holding numpy, scipy, scikit-image and pillow for its Python 3.13:

```
blender -b --factory-startup --python-use-system-env --python blender/kitten_head_build.py   # head sculpt, baked maps
blender -b --factory-startup --python-use-system-env --python blender/kitten_head_groom.py   # head fur, whiskers, undercoat (KK_PREVIEW=1 renders a close-up)
blender -b --factory-startup --python-use-system-env --python blender/kitten_body_groom.py   # tail, ears, hips, legs and paws
blender -b --factory-startup --python-use-system-env --python blender/kitten_armor.py        # kitten plate and sword
blender -b --factory-startup --python-use-system-env --python blender/knight_armor.py        # knight helm, plate, gauntlets, boots and sword
```

To update the GitHub Pages site, build with `npm run artifact` and replace the contents of the `gh-pages` branch with `dist/`, leaving out the raw `.glb`, `.kkf` and `.bin` models (the build reads their `.txt` copies), `artifact.html` and `_wrapped.html`, and keeping the empty `.nojekyll` file.

Testing: `node playtest.mjs` plays the first three chapters through the `window.__kk` debug API in Chrome and prints the state and story after each step. `node tools/cap.mjs <url> <plan.json> <outDir>` runs a capture plan on the real GPU; `tools/plans/marsh.json` plays chapters IV and V through to the ending, and `tools/plans/refmatch2.json` frames the kitten as the reference does. In the console, `__kk.chapter(n)` jumps to the start of a chapter with the ones before it done.

## Known issues

- The chapel and yard walls look boxy from far away.
- The first load downloads about 20 MB of models, fur, skies and textures.
- In the winch corner the camera can tip almost straight down if the kitten faces away from the winch.
- The cape does not collide with walls, so in the pin hut it can pass through the stone.

## Credits and licences

- three.js 0.186.1, MIT licence.
- Skies (CC0, Poly Haven): Kloofendal Misty Morning, Misty Farm Road and Kloppenheim 01.
- Textures (CC0, Poly Haven): Leafy Grass, Brown Mud 02, Castle Wall Varriation, Castle Wall Slates, Mossy Rock, Weathered Planks and Roof Slates 02. CC0 asks for no attribution; they are credited here with thanks.
- Typeface: Cormorant Garamond via Google Fonts, SIL Open Font License.
- Tools: Blender 5.2 (GPL) through its Python API (the models it produced are this project's own), sharp (Apache-2.0) for asset processing, Playwright (Apache-2.0) for testing.
- Everything else (models, fur, sound, story) is made for this project by its code and scripts.
