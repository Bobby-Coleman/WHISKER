# Cooperative moor pass

The story is a small creature and a heavily armoured companion crossing a hostile landscape. The puzzles make
that dependency playable: reach and agility expose a problem, strength changes the environment, and each
completed mechanism creates a route both can use. Wind changes from a threat into a tool at the tor.

## Research and applied principles

- [Hazelight's It Takes Two developer interview](https://www.unrealengine.com/developer-interviews/it-takes-two-lovingly-marries-story-and-gameplay-together?lang=en)
  describes designing mechanics around the situation in the story and creating two characters with distinct
  capabilities from the outset. Applied here as physical reasons for switching: a low hollow, a loaded winch,
  a swim, and a held gate. The relationship is demonstrated by actions, not only dialogue.
- [A Jolly Corpse's Wyv and Keep publisher page](https://store.steampowered.com/app/263960/Wyv_and_Keep_The_Temple_of_the_Lost_Idol/)
  describes two-character puzzle play controllable by one or two players, with teamwork across different worlds.
  Applied here as persistent positioning and readable dependency chains that work with a single player's
  character switching. The mill develops weight substitution rather than asking for a second arbitrary key.
- [EA's official It Takes Two page](https://www.ea.com/games/it-takes-two/it-takes-two)
  presents an adventure built for cooperative play. WHISKER currently has one-player switching, so mechanisms
  latch or remain held across switches and no interaction demands simultaneous input from two humans.

These are transferable design principles. No level layouts, dialogue, artwork, music or characters from these
games have been copied. This pass adds procedural meshes only, so it introduces no third-party asset licences.

## Final playable sequence

| Beat | Observation / reasoning | Kitten's part | Knight's part | Persistent result |
|---|---|---|---|---|
| Field wall | Gate tied on its far side; ivy climbs over | Climb and lift the loop | Cross the freed gate | Gate stays open |
| Root hollow | Oak jams at an old repair wedge; hollow is too low for steel armour | Enter the physical low passage and pull the recessed wedge | Swing the freed oak into its notches | A shared ditch crossing |
| Sheepfold | No climbable wall; bar inside, swollen gate outside | Accept a throw, pull bar pin; open creep hole for a return route | Throw her, then shoulder the unbarred gate | Gate stays open |
| Mill scales | Weight plate tensions the winch pawl; handle is too far away for one knight to occupy both | Swim and climb to the gallery; pin refuses while the rope is loaded | Substitute a stone ballast for his weight, then turn the winch | Rope unloaded, kitten releases bridge, shared crossing |
| Windy ridge | Rocks block wind; one long gap needs a companion, the next a movable substitute | Move in lulls and rest in shelter | Stand in the windward gap; push the cart into another | Safe route is built with positioning |
| Tor gap | Gust that was dangerous can carry a throw farther | Ride the gust, release far-side bridge pin | Aim using the live arc and throw toward the hay | A shared tor crossing |
| Castle gate | Chain reaches winding room; portcullis only catches when raised | Swim, climb, release drawbridge; set raised gate's ratchet | Cross the bridge and hold the portcullis | Both enter together |

## Reliability and feel

- Checkpoints require both characters beyond the crossing and its mechanism actually solved. A scouting kitten
  can no longer save a checkpoint that silently completes an unfinished gate on reload.
- Wrong order yields a local mechanical response (rattle, taut rope, slipping winch) and a short explanation.
- The mill has no time limit. The ballast has a fixed groove and stop, so it cannot fall into the river or be
  accidentally pushed out of reach.
- A waiting actor retains its position through switches. Invisible follower catch-up refuses closed walls,
  climb elevation, deep water and routes with no supporting ground, preserving puzzle dependencies.
- Pressure plates keep their authored surface height and count grounded actors or their authored ballast.
- Throws show an inexpensive prediction using the actual release point and motor parameters. Wind assistance
  remains directional and steerable rather than scripted teleporting.
- Respawn clears accumulated wind and swimming state; the moor explicitly clears prologue story poses.
- Idle drawbridge chains and the plate-to-winch rope are rebuilt only when their state changes.

## Validation

`node tools/bot-coop.mjs http://127.0.0.1:4176/?level=moor&fresh work/coop-caps` drives actual motor input,
climbing, swimming, switches and interactions through browser debug hooks, rather than calling puzzle completion
methods. It includes negative checks for the jammed oak, unloaded weight plate, and taut gallery rope, then
positive checks for the full intended solutions and all remaining moor beats. It fails on the first bad result
by default; set `COOP_CONTINUE=1` for a diagnostic run that prints all outcomes.

The completed production run on local Windows Chrome passed every assertion, including a full reload from
the persisted castle checkpoint, with no JavaScript page errors or camera issues. The visible west-ridge fall
was rescued and the legitimate shelter/cart/gust route still reached the castle. The whole-game production
build passes; `tsc --noEmit` still reports pre-existing v1 `src/world` and `src/render` typing issues, with no
errors in the changed v3 files. The local run is functional evidence, not a claim of performance on a phone.
