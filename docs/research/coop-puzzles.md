# Two characters, one player: puzzle research for Whisker v3

What this covers: design research for the kitten and knight puzzles in `docs/V3.md`. It has a list of principles
taken from Hazelight (It Takes Two, Split Fiction), Brothers, ICO, The Last Guardian, Unravel Two, Trine, Portal 2
co-op, Pico Park, Biped, We Were Here and a few others. It also has a catalogue of 31 puzzle patterns rewritten for
our two characters, a refined Chapter One, and five ideas for Chapter Two.

A note on sources: this environment blocked direct page fetches, so every source below was read through
search-engine excerpts of the page. Quotes are short and close to the original, but check the exact wording before
you reuse one in public.

Shorthand used throughout:

- **J**: the jump distance they share (same for both).
- **M**: his mantle height ("chest-high", about 1.3 m for a 1.8 m knight).
- **Pin**: any small kitten-only interactable, such as a peg, latch, rope loop, small switch or pawl.
- **Hold**: a knight state that lasts across a switch, such as standing on a plate, holding a gate up or holding her up.

---

## 1. Principles

1. **Give every beat one new idea, and never reuse a whole puzzle.** Josef Fares: "narrative games can become very
   repetitive... we need to get away from finding one mechanic and then just repeating it over and over again." It
   Takes Two never repeats a major mechanic from one level to the next.
   *For us:* their abilities are fixed for the whole game, while Hazelight hands out new gadgets each level. So our
   variety has to come from what each verb is used on. The climb goes over a field wall, then up a mill, then up a
   drawbridge chain. The throw goes onto a wall, then across a gap in a gust.
   [GamingBolt](https://gamingbolt.com/narrative-games-can-become-very-repetitive-josef-fares-promises-max-variety-for-it-takes-two),
   [GameSpot review](https://www.gamespot.com/reviews/it-takes-two-review/1900-6417655/)
2. **Pair the abilities: one sets up, the other cashes in.** In It Takes Two, Cody's nails pin platforms and make
   swing points for May's hammer. His sap weighs platforms down and her match ignites it. In the snow globe they get
   a pair of magnets.
   *For us:* he makes room (holds, shelters, pushes, throws) and she changes something (unhooks, pulls a pin, slips
   through). Some beats should flip this, so she makes room for him (she drops the counterweight, or she lowers the
   water).
   [The Tartan review](https://the-tartan.org/2024/03/25/it-takes-two-review-one-of-the-best-co-op-games-ever/),
   [Wikipedia: It Takes Two](https://en.wikipedia.org/wiki/It_Takes_Two_(video_game))
3. **The player should learn each mechanic in seconds.** Fares on Split Fiction: with this pace of new ideas,
   players have to pick up each mechanic very quickly, because long tutorials kill momentum. Prototyping is cheap
   and polish is expensive, and about 20 to 30% of ideas are cut. *For us:* teach by placing things in the level,
   with at most one prompt per new verb. Cut anything that needs explaining.
   [GamesBeat: Split Fiction interview](https://gamesbeat.com/how-josef-fares-stayed-focused-on-the-co-op-action-adventure-with-split-fiction-interview/),
   [Xbox Wire interview](https://news.xbox.com/en-us/2025/03/05/split-fiction-josef-fares-interview/)
4. **Introduce, develop, twist, conclude, then drop it.** Koichi Hayashida's kishotenketsu for Super Mario 3D World:
   a mechanic is taught, developed, twisted and thrown away "in about five minutes flat". *For us:* use this shape
   inside each beat, and use it again across the whole chapter.
   [MCV](https://www.mcvuk.com/development/video-nintendos-level-design-secrets-in-four-steps),
   [Kotaku](https://kotaku.com/what-made-super-mario-3d-world-so-great-1691916400)
5. **Teach each thing on its own first, then combine.** Portal introduces each element alone in a safe room and
   only then layers it with others. *For us:* the first time a verb appears, nothing can go wrong and nothing else
   is going on.
   [Game Developer: Portal 2 design review](https://www.gamedeveloper.com/design/portal-2-game-design-review-part-1),
   [Best of GDC: Portal](https://www.gamedeveloper.com/pc/best-of-gdc-the-secrets-of-i-portal-i-s-huge-success)
6. **Make the mechanics carry the relationship.** In Brothers, the big brother carries the little one across water,
   and the little one squeezes through gaps to open bigger doors. In the ending, the input of the brother who has
   died becomes the way to swim. *For us:* shelter from the wind, the lift and the throw, and holding the gate for
   her are acts of care. Save one mechanical payoff for late in the game. STORY.md already has one: "you can no
   longer switch".
   [Godisageek review](https://godisageek.com/2013/08/brothers-tale-sons-review/),
   [GDC Narrative Review (PDF)](https://media.gdcvault.com/gdc2017/GameNarrativeReview/Kristian%20Skistad%20Game%20Narrative%20Review%20Brothers%20-%20A%20Tale%20of%20Two%20Sons.pdf),
   [Giant Bomb: A Tale of One Game](https://giantbomb.com/articles/a-tale-of-one-game/1100-4736/)
7. **Make them depend on each other, and define each by what they can't do.** In Brothers, the big brother can't
   fit and the little brother can't swim. In The Lost Vikings, Erik is the only one who can jump at all, and Olaf's
   shield becomes Erik's platform. *For us:* he must never be just a forklift. Every beat should give him a
   heavy, satisfying action: a shoulder-charge, a heave, a throw.
   [Tropedia: The Lost Vikings](https://tropedia.fandom.com/wiki/The_Lost_Vikings)
8. **A companion you rely on must be reliable.** ICO builds attachment through dependency: you hold Yorda's hand,
   call her, and open the doors only she can open. The Last Guardian makes Trico disobedient on purpose ("doesn't
   always do what you ask"). That works for a creature you command, but it would be poison when you play both
   characters. V3's rule ("stays exactly where you left it") is right, and the AI must never "help".
   [MobyGames: ICO](https://www.mobygames.com/game/5158/ico/),
   [KeenGamer on Trico](https://www.keengamer.com/articles/features/opinion-pieces/making-sense-of-trico-the-last-guardians-misunderstood-hero)
9. **Solo switching needs a way to travel together and no puzzle that needs both at once.** Brothers solves
   simultaneous action with one stick per brother, and we can't. Trine's single-player shows one hero at a time.
   Unravel Two lets the solo player merge the two Yarnys to travel and split them for puzzles. *For us:* nothing may
   need both characters acting at the same moment. Every hold is a latch. Consider letting her ride on his
   shoulders while they travel.
   [Destructoid: Trine single player](https://www.destructoid.com/review-trine-single-player/),
   [Nintendo Wire: Unravel Two](https://nintendowire.com/news/2019/03/25/review-unravel-two-on-switch/)
10. **It must be clear at a glance who can use what.** ICO marks the doors only Yorda can open, and they glow.
    Valve's playtests replaced a "shimmery force field" with glass because players misread it. Portal 2 co-op added
    pings and a picture-in-picture view of the partner's screen. *For us:* use one colour and shape language
    for each character (section 2).
    [MobyGames: ICO](https://www.mobygames.com/game/5158/ico/),
    [Best of GDC: Portal](https://www.gamedeveloper.com/pc/best-of-gdc-the-secrets-of-i-portal-i-s-huge-success),
    [Co-Optimus: Portal 2 co-op](https://www.co-optimus.com/review/749/page/2/portal-2-co-op-review.html)
11. **Simple problems, tools with many uses.** Guardian of Light's creative director: "give the player simple
    problems and give them tools that have a lot of utility". Totec's shield is a platform, and Lara's grapple rope
    is a tightrope for him. *For us:* seven verbs (hold, push, throw, pin, climb, swim, shelter) in many contexts.
    A small team can't afford many one-off gadgets.
    [Co-Optimus preview](https://www.co-optimus.com/preview/490/lara-croft-and-the-guardian-of-light-co-op-hands-on-preview.html),
    [Engadget hands-on](https://www.engadget.com/2010-05-18-hands-on-lara-croft-and-the-guardian-of-light.html)
12. **Split them up, and let each see the other's obstacle.** Portal 2 co-op separates the players with force
    fields so each works on their own side. In The Last Guardian, the boy crawls through a gap to a switch that lets
    Trico in. Parallel routes give switching its best rhythm.
    [Co-Optimus: Portal 2 co-op](https://www.co-optimus.com/review/749/page/2/portal-2-co-op-review.html),
    [Wikipedia: The Last Guardian](https://en.wikipedia.org/wiki/The_Last_Guardian)
13. **A small character turns scenery into level.** In Minish Cap, small holes in walls become routes and ordinary
    objects become obstacle courses. At 5 : 1, every wall in our world has a second layer of paths for her: drains,
    sheep creeps, the gap under a gate, ivy.
    [Superjump: Minish Cap](https://www.superjumpmagazine.com/to-understand-zeldas-future-look-to-its-handheld-past/)
14. **Keep it flowing, because frustration isn't the goal.** Fares: it is a narrative experience, so it shouldn't be
    too hard and should stay "fluid and moving forward all the time". *For us:* nothing dies. A reset takes about
    2 s. Nothing can soft-lock. Alternate puzzle, set piece and breather. Each beat in It Takes Two runs about 5 to 15
    minutes. Ours should run 1 to 3.
    [GamesBeat: It Takes Two interview](https://gamesbeat.com/josef-fares-youll-love-it-takes-two-or-you-can-break-his-arms-and-legs/)
15. **Let weight and physics explain themselves.** Pico Park (stack the cats to reach the key, and everyone must
    reach the door), Biped (pressure switches) and Unravel Two (one Yarny anchors or counterweights the other) are
    readable because everyone understands weight. Trine allows several solutions. *For us:* a plate sinks under
    him and only twitches under her. A plank bends under her and refuses him.
    [Wikipedia: Pico Park](https://en.wikipedia.org/wiki/Pico_Park),
    [Nintendo Life: Biped](https://www.nintendolife.com/news/2020/06/feature_biped_producer_on_the_cute_co-op_platformers_journey_to_switch),
    [GameSpot: Unravel Two](https://www.gamespot.com/reviews/unravel-2-review-partners-in-twine/1900-6416931/),
    [Game Developer: Trine](https://www.gamedeveloper.com/pc/interview-talking-i-trine-i-with-frozenbyte)

Also worth watching, though it couldn't be fetched here: Game Maker's Toolkit, *On the Level: It Takes Two*. It
plays through the Tree level with its designer, Oliver Granlund
([GMTK post](https://x.com/gamemakerstk/status/1441068467000651776)). We Were Here builds its puzzles on
information split between the players (one sees the clue, the other the lock). That is weak for one player, so we
skip it apart from "she can see over the wall"
([Game Developer: Road to the IGF](https://www.gamedeveloper.com/game-platforms/road-to-the-igf-total-mayhem-games-i-we-were-here-i-)).

### 1.1 Rules for single-player switching (the pitfalls)

1. **The character you leave keeps doing what it was doing.** It never moves by itself, never walks into a hazard,
   and never lets go. While inactive it can't be harmed by puzzle hazards. An idle kitten in the wind hunkers down
   and grips (claws in, ears flat) and does not move. An idle knight never slides into deep water.
2. **Every hold is a latch, never a timer.** Anything one character keeps doing while the other acts must last
   indefinitely: standing on a plate, holding a gate, holding her up, a crank that clicks and stays wound. Never
   ask for two inputs at once.
3. **Timing belongs only to the character you control, and it is generous.** Gust lulls last at least 2.5 s. A
   dropped bridge stays down. A throw is one action by one character.
4. **Call never breaks a hold.** If you call him while he is holding a gate, he stays put, grunts and glances at the
   gate, and the hold indicator pulses. You release a hold only by switching to him and letting go. This keeps the
   portcullis from coming down on her.
5. **Call refuses in a way you can see.** If the path is blocked (wind with no lee, deep water for him, a wall for
   him), the follower sits down and gives a clear tell: she meows and flattens her ears, he shrugs and taps the wall.
   A follower never takes an unsafe path. On the ridge she will not come out into the wind (see beat 5).
6. **The switch camera blends fast (about 0.35 s)** and keeps an off-screen marker on the other character. While
   the other is holding something, a small portrait icon shows it (Portal 2's picture-in-picture, made tiny).
7. **Show the result of remote actions.** When she triggers something that helps him far away (a bridge drops),
   play a 1 to 1.5 s result shot from his side, then return control to her.
8. **Count switches per puzzle** as the complexity budget: 1 or 2 early, at most 5 late. Avoid leapfrog shuffles
   (moving him, then her, then him again through the same problem). Replace them with a block that stands in for him.
9. **Make soft-locks impossible.** Push blocks run on rails with end stops. Every one-way drop has a way back (her
   creep holes, his ramp). A fall drops you into a soft bowl or water with a walk-out. A reset volume puts the
   character back at the last safe spot in about 2 s.
10. **Travel together.** Call is enough. An optional extra borrowed from Unravel Two's merge: when he is called and
    she is next to him, she hops onto his shoulders and rides. This also gives breathers and set pieces a single
    character to control.

---

## 2. The catalogue: 31 two-character patterns

### 2.0 Visual language: who can use what

One rule worth enforcing everywhere: **a pink ribbon means hers and steel blue means his**, matching her bow and his
armour. Anything she can operate has a small pink ribbon or tassel. Anything he can operate is painted steel blue
and is chunky.

| Thing | Who | Look |
|---|---|---|
| Ivy, rough timber, chain | her | bright leafy green blobs on grey stone. Timber is dark brown with horizontal battens. Chain links are big. |
| Smooth dressed stone | nobody climbs it | pale, flat, crisp edges, no moss |
| Small gap (bars, drain, creep, cat flap) | her | a dark opening at her height with worn edges. Bars sit a kitten-head apart. |
| Pin, latch, small switch | her | a brass peg at kitten height with a pink tassel |
| Crank, winch, high lever | him | chunky steel-blue iron at his hand height (1.0 to 1.2 m, high lever 2.2 m) |
| Pushable block, trunk, cart | him | drag marks on the ground along the push axis, rope handles |
| Plate | him (or something as heavy) | a big square slab, slightly raised, with a carved helm glyph and a chain running to what it opens. It sinks with dust under him. |
| Rotten boards, thin plank | her only | grey, cracked, gaps between the boards. It creaks and dips when he tests it. It bends a little under her. |
| Shallow water (up to his waist) | both | light turquoise, visible pebbles, reeds |
| Deep water | her only | dark navy with a sharp colour edge at the drop-off and no visible bottom |
| Fast water | sweeps her away | white streaks, a loud rush |
| Wind, gusts | push her | grass waves and pennants. Each gust is announced by a wave running through the grass 1 s before it. |
| Lee (shelter) | her | a wedge of calm grass behind rocks and behind him, with no particles in it |
| Throw target | he throws, she lands | a straw bale, flat coping or nest. A bird sits there and flies off as he aims. |

Each pattern lists its setup, the solution, what it teaches, how to make it readable, and what switching needs.
The number of switches assumes you start on the character who arrives first.

### A. Anchor and act (one holds, the other acts)

**A1. The held portcullis and ratchet.** *Refs: V3 Castle Gate, Brothers.*
- Setup: a portcullis (bars 0.15 m apart) with a toothed rail on the inside. A ratchet catch with a pink ribbon sits
  inside at her height.
- Solution: he heaves the portcullis up and holds it. You switch, she slips through the bars and throws the catch.
  You switch back, he lets go, and the gate stays up.
- Teaches: a hold that lasts across a switch, and turning a hold into a latch.
- Readable: the catch only bites when the gate is up, because its teeth are visible above the catch. If she paws it
  while the gate is down, it clicks back.
- Switching: 2 switches. Call never releases the hold (rule 4).

**A2. The plate holds the door.** *Refs: Portal, Biped, Pico Park.*
- Setup: a door that is open only while a plate is pressed. Behind it is a small space with a pin that opens his
  main way, or locks the door open.
- Solution: he stands on the plate, the door rises, and she runs through and pulls the pin.
- Teaches: he holds things by standing, and he stays where you leave him.
- Readable: a chain runs from the plate to the door, and the door rises as the plate sinks.
- Switching: 1. He stays on the plate when you switch.

**A3. Too light for the plate.** *Refs: Portal (the cube on the button).*
- Setup: like A2, but he is the one who has to get through.
- Solution: he pushes a block or chest onto the plate. Or, in a later variant, she pulls a pin that drops a stone
  sack onto it.
- Teaches: she is light, and something can stand in for him.
- Readable: under her the plate twitches 1 cm with a tiny "tink". Under the block it sinks with a thud.
- Switching: 0 or 1.

**A4. Counterweight scales.** *Refs: Unravel Two (counterweights), It Takes Two (sap weighs platforms down).*
- Setup: two platforms hang from one rope over a big visible pulley. A is on the ground and B is under a high
  ledge. Over B's top position hangs a stone sack held by a pin.
- Solution: she stands on B and he steps onto A. A sinks and B lifts her to the ledge. She steps off and pulls the
  sack's pin. The sack lands on B, B sinks, and A lifts him.
- Teaches: weight works both ways, and she can make weight she doesn't have.
- Readable: the two platforms look alike, the pulley wheel turns visibly, and the sack sits directly above B.
- Switching: 2 or 3.

**A5. Crank and ride.** *Refs: Brothers (winches), the v2 watch-house hoist.*
- Setup: a basket or platform on a rope, with a crank at the bottom.
- Solution: she gets in and he cranks. She rides up.
- Teaches: he powers the lift and she rides it.
- Readable: the crank is steel blue and the basket is kitten-sized.
- Switching: 1. The crank has a ratchet, so letting go mid-turn never drops her. v2 already did this, so in v3 use
  it once at most, or twist it (the basket carries a weight to her instead of carrying her).

**A6. Hold her up.** *Refs: Brothers (boosts), Pico Park (stacking).*
- Setup: a pin in a slot about 2.4 m up a smooth wall, too high to jump to and with no ledge to throw her onto.
- Solution: he lifts her and holds her up, and the hold lasts. You switch, and she paws the pin from his hands.
- Teaches: lifting is also a hold, not only a throw.
- Readable: she sits on his raised gauntlets, and the slot is right above him.
- Switching: 1 or 2. While held she can only paw or reach.

**A7. Knight in the ford.** *Refs: Lost Vikings (Olaf's shield as a platform), Last Guardian (Trico as terrain).*
- Setup: fast water (white streaks) that would sweep her to a safe beach downstream. The stepping stones have one
  gap too far for her. The water there reaches his waist.
- Solution: he wades into the gap and stands still, and she hops stone, then his shoulders, then stone.
- Teaches: his body is terrain.
- Readable: the fast water looks different from calm water, and the gap's stone is missing with only a stump left.
- Switching: 1. His shoulders count as ground only while he stands still.

### B. Size gates (she goes where he can't)

**B1. The latch on the far side (climb over).** *Refs: V3 Stone Wall, ICO.*
- Setup: a wall higher than M with no way around (it ends in cliffs or gorse). A solid plank gate is tied with a
  rope loop on the far side. A patch of ivy grows a few metres away, on both faces of the wall.
- Solution: she climbs, drops over, and unhooks the loop. He walks through, or you call him.
- Teaches: switching, Call, and the fact that she goes where he can't.
- Readable: the rope tail shows over the gate top. The gate rattles but holds when he pushes it ("tied", not
  "locked"). The first time he tries the ivy it tears and he slides back.
- Switching: 1, and you can finish from her side with Call.

**B2. Under the bars.** *Refs: Brothers (the little brother through narrow openings).*
- Setup: an iron-barred gate with a bolt on the far side at her height.
- Solution: she slips through and draws the bolt.
- Teaches: bars are a door for her.
- Readable: the bars are a kitten-head apart. She does a squeeze animation. He presses his helm against the bars.
- Switching: 1.

**B3. The drain run.** *Refs: Last Guardian (the boy crawls round to the switch), Minish Cap.*
- Setup: a culvert at ground level (0.3 m) with a trickle of water. It runs 5 to 10 m under the wall and comes up
  under a grate inside.
- Solution: she goes through, pushes up the grate, and opens the way from inside.
- Teaches: she can leave his sight, and there is a second layer of space.
- Readable: a dark arch at her height with water running out and light at the far end, where a shaft of light
  falls through the grate.
- Switching: 1 or 2. The camera has to handle a low ceiling (pull in tight and look along the tunnel). Show his
  marker the whole time.

**B4. The creep hole (the way back).** *Refs: sheep creeps in real drystone walls.*
- Setup: a low square hole (0.3 m) through a wall next to a gate. From outside it is blocked by a loose stone that
  can only be knocked out from inside.
- Solution: once inside, she knocks the stone out. From then on the creep is her two-way door.
- Teaches: small gaps are her doors, and it removes a soft-lock after any throw or drop into an enclosure.
- Readable: a dark square with worn stones and a lighter stone wedged in it.
- Switching: none. It is a safety valve.

**B5. Each has a part (high lever, low niche).** *Refs: Lost Vikings, ICO's two-person doors.*
- Setup: a double-locked door. One lock is a high lever (2.2 m) and the other is a pin deep in a narrow niche
  (0.3 m) that his gauntlet doesn't fit into.
- Solution: he pulls the lever and she pulls the pin, in any order. Both latch.
- Teaches: complementary parts, and reading height and size.
- Readable: two pennants on the door, one steel blue and one pink, each flipping up when its lock is done.
- Switching: 1, and nothing has to happen at the same time.

### C. Throw and boost

**C1. Make a step.** *Refs: Portal, Pico Park.*
- Setup: a ledge at about 1.9 m (above M and above her jump) on a smooth wall, with a block nearby (about 0.9 m).
- Solution: he pushes the block under the ledge. Both climb, block then ledge, because each step is under M.
- Teaches: building height, and his mantle limit.
- Readable: the block is visibly half the height of the ledge, and drag marks lead to the right spot.
- Switching: 0 or 1 (Call her).

**C2. Throw to a ledge.** *Refs: V3 abilities, Donkey Kong Country's team-up throw.*
- Setup: a ledge 3 m up on smooth stone, with a straw bale or flat coping as the target.
- Solution: he lifts her, aims and throws.
- Teaches: the throw.
- Readable: an arc preview while aiming (a dotted line of dust motes). A soft cone snaps the throw onto valid
  targets, and the bird flies off the target.
- Switching: she must be next to him, so you call her and then lift. Optionally, control passes to her when she
  lands. She must always be able to get down safely.

**C3. Throw over a wall (the blind chain).** *Refs: Brothers, ICO.*
- Setup: a tall enclosure with smooth walls. The gate is barred inside by a bar held with a pin, and it is also
  swollen shut.
- Solution: he throws her onto the wall top. She drops in and pulls the bar pin. He shoulders the stuck gate open.
- Teaches: a chain of three actions, two of them his. You trust what you can't see.
- Readable: from outside, the bar's end shows through a gap in the gate. Inside, the pin has a pink ribbon. When
  she pushes the gate it doesn't move (she paws at it). His shoulder-charge breaks it open with a thud.
- Switching: 2. Pair it with B4 so she can always get out.

**C4. Throw across a gap.** *Refs: Lara Croft and the Guardian of Light.*
- Setup: a gap between J and 1.6 J, too far to jump. On the far side is a pin that drops a bridge or opens his way.
- Solution: he throws her across, and she makes his way.
- Teaches: the throw covers distance.
- Readable: the landing pad and the far-side mechanism can both be seen from where he throws.
- Switching: 1. A short throw falls into something soft with a quick climb back.

**C5. See-saw launch.** *Refs: classic toy physics, Pico Park.*
- Setup: a plank on a log pivot below a high ledge. Next to the see-saw's raised end is a chest-high ledge he can
  mantle onto.
- Solution: she sits on the low end. He mantles the ledge and drops onto the raised end, and she flies up to the
  high ledge.
- Teaches: his weight is energy, and her lightness is flight.
- Readable: a paw-print mat on her end and a boot-print dent on his. The target ledge is directly above.
- Switching: 2. Script her arc when the trigger fires instead of simulating it, so it always lands.

### D. Weight on structures

**D1. Thin planks and rotten bridges (she crosses, he can't).** *Refs: Brothers, Last Guardian.*
- Setup: a crossing of thin or rotten boards over a drop, with his route blocked on the far side.
- Solution: she crosses and opens his way (unhooks a gate, drops a sturdy bridge section).
- Teaches: light against heavy on structures.
- Readable: grey cracked boards with gaps. When he puts a foot on them they creak and dip, and he steps back. Over
  a deadly drop he simply refuses and the boards never break. Over a safe lower level, use D2.
- Switching: 1.

**D2. Break through.** *Refs: The Lost Vikings (Erik smashes soft walls), V3 abilities.*
- Setup: a boarded-up doorway, or a rotten floor hatch over a safe lower level (a cellar, or water at his waist).
- Solution: he shoulders or stomps through, and the boards break into a new path.
- Teaches: weight is a key, and order matters. Anything upstairs that needs doing has to be done first, so pair
  the break with a way back up (stairs, a lift he cranks, her climb).
- Readable: the same grey boards, with one big crack and light leaking through. Dust puffs when he stands near.
- Switching: 1 or 2.

**D3. Push a bridge.** *Refs: V3 ditch, Trine (physics bridges).*
- Setup: a ditch about 1.6 J wide with steep sides and a walk-out ramp at one end. A fallen trunk lies along the
  near bank.
- Solution: he pushes the crown end. The trunk swings around its root plate and drops into notches on the far
  bank. Both cross.
- Teaches: his push builds paths for both of them.
- Readable: drag marks and a worn arc in the grass, with notches cut on the far bank. When she pushes it she
  strains and nothing moves.
- Switching: 0 or 1. The trunk moves on a fixed arc so it can never be lost in the ditch.

### E. Water

**E1. She swims, he can't.** *Refs: Brothers (reversed: there the big brother swims), V3 Mill Stream.*
- Setup: a shallow shelf, then a deep channel. The way for him is something on the far side.
- Solution: she swims across and works the far-side pin, which drops a raised bridge section.
- Teaches: swimming, and his limit, shown without a death. He wades to the drop-off and is pushed back gently.
- Readable: the shallow-to-deep colour edge, and bubbles and a comic shake when he turns back.
- Switching: 1.

**E2. Lower the water.** *Refs: Zelda water temples, STORY.md marsh sluices.*
- Setup: a basin too deep for him with a sluice at its end. The sluice pin can be reached by swimming.
- Solution: she pulls the pin, the water drains to waist depth, and he wades.
- Teaches: changing the state of the world for the other character.
- Readable: a moss line on the walls marks the low level. Stepping stones appear as the water drops.
- Switching: 1.

**E3. The drowned plate.** *Refs: the v2 watch-house sluice plate.*
- Setup: a plate under waist-deep water holds a culvert gate open. She floats and can't press it.
- Solution: he wades in and stands on it, and she swims through the culvert.
- Teaches: a twist on water. His sinking is a strength here, and her floating is the weakness.
- Readable: the plate is visible through clear shallow water, with the helm glyph and a chain to the gate. Bubbles
  rise when it is pressed.
- Switching: 1 or 2.

### F. Wind

**F1. Shelter hopping.** *Refs: V3 Windy Ridge.*
- Setup: a path in the wind with rocks on the windward side and a soft slope on the lee side. Gusts come every
  4 to 5 s and last 1.5 s.
- Solution: she runs from one lee pocket to the next during lulls.
- Teaches: wind, its warning, and the lee.
- Readable: the grass wave arrives 1 s before each gust. Pennants stream. Calm grass shows the lee.
- Switching: while idle she hunkers and is never blown. He walks through unaffected, leaning into the wind.

**F2. The moving windbreak.** *Refs: V3 Windy Ridge, Lost Vikings (Olaf's shield).*
- Setup: a stretch of open path too long to cross in one lull.
- Solution: he stands in the open stretch on the windward edge, and she runs through his lee.
- Teaches: his body shelters her. This is the relationship as a mechanic.
- Readable: his tabard streams downwind, the calm wedge is drawn in the grass behind him, and particles part
  around him.
- Switching: 2. A follower won't walk into gusts (rule 5), so Call can't skip the puzzle.

**F3. The permanent windbreak.** *Refs: A3, moved into the wind.*
- Setup: two open stretches in a row, with a hay cart or boulder in a groove beside the first.
- Solution: he pushes the cart into the first stretch, where it stops at a notch, then stands in the second.
- Teaches: something can stand in for him. This echoes A3 in a new context.
- Readable: the groove and the notch, and the cart's own lee once it is in place.
- Switching: 2 or 3, with no leapfrog.

**F4. The wind-assisted throw (twist).** *Refs: combines C4 and F1.*
- Setup: a gap too wide for a normal throw (about 2.5 J), with a tailwind of gusts across it.
- Solution: he throws her during a gust. Her cape opens and she sails across.
- Teaches: the wind becomes a tool, and the throw gets timing.
- Readable: pennants stream toward the far side, and the grass wave announces the gust. A throw in a lull falls
  short into a soft heather bowl, and she climbs back in about 10 s.
- Switching: no switching during the timed part.

**F5. Updraft.** *Refs: glider levels in many platformers, Split Fiction's fairy form.*
- Setup: a cleft or vent blowing straight up, with a column of leaves spiralling, and a high ledge above. A heavy
  grate or cart covers the vent.
- Solution: he pushes the cover off. She steps in, rises with her cape out, and drifts onto the ledge. In a
  variant he stands on the grate to stop the draught until she is in place, then steps off.
- Teaches: wind lifts whatever is light, and he controls it.
- Readable: the leaf column, and her ears and cape fluttering at the edge of the vent.
- Switching: 1 or 2.

**F6. The kite (stretch goal).** *Refs: Unravel Two (anchor and swing).*
- Setup: he holds a rope tied to her harness at a gale gap.
- Solution: the wind blows her out over the gap. He walks along the edge to steer her onto a far ledge, then lets
  go or reels her in.
- Teaches: trust, and steering two bodies with one.
- Readable: the rope, and the wind streaming.
- Switching: he is controlled and she is a passive kite. This needs a distance constraint plus wind force, so it
  is a stretch goal.

### G. Structure

**G1. Parallel paths.** *Refs: Portal 2 co-op, Last Guardian.*
- Setup: two routes side by side, divided by bars or windows. His is big doors and beams, and hers is rafters and
  drains. Each route blocks the other in turn.
- Solution: she pulls a pin that opens his door. He lifts a fallen beam off her drain exit. Repeat 2 or 3 times,
  then they meet again.
- Teaches: interleaving, and reading the other side.
- Readable: windows and bars let each see the other's obstacle, and each obstacle carries its owner's colour.
- Switching: 3 to 5. This is where switching shines. Call shows "can't reach" while they are split.

**G2. The separation.** *Refs: Brothers' ending, Portal 2 co-op.*
- Setup: a scripted beat splits them, such as a grate she falls through or a portcullis slamming between them.
- Solution: each makes progress alone, linked by G1 patterns, until they meet again (a lift he cranks up with her
  in it).
- Teaches: absence. It makes the player feel the bond.
- Readable: a clear camera beat. Each character's goal stays visible from the other's side.
- Switching: as G1.

---

## 3. Chapter One, "The Road to the Castle": proposed sequence

A bright windy morning. The wind is always there in the grass and pennants from the first step, as a warning of
the ridge. The castle on its crag stays in view. The chapter runs in kishotenketsu shape: intro (beats 1 to 2),
development (3 to 5), twist (6), conclusion and set piece (7). A breather (a walk, a vista, a line of dialogue)
follows beats 2, 4 and 6.

| # | Beat | New verb or pair | Patterns | Role | Switches | Time |
|---|---|---|---|---|---|---|
| 1 | The Field Wall | switch, Call. She climbs, he can't | B1 | intro (hers) | 1 | 1.5 min |
| 2 | The Ditch | he pushes, both cross | D3 | intro (his) | 0–1 | 1 min |
| 3 | The Sheepfold | throw, a 3-step chain, creep hole | C2, C3, B4 | development | 2 | 2 min |
| 4 | The Mill Stream | she swims, he can't | E1 (+D1 preview) | new element | 1 | 2 min |
| 5 | The Windy Ridge | wind, his lee, a cart as stand-in | F1, F2, F3 | new element and development | 4–5 | 3 min |
| 6 | The Tor Gap | **twist:** the wind carries her | F4 | twist | 1 | 1.5 min |
| 7 | The Castle Gate | **set piece:** swim, chain, drawbridge, portcullis | E1, A1, B2 | conclusion | 3 | 3 min |

That is about 15 minutes of play.

Changes from V3.md:
- The Sheepfold is new (beat 3). It teaches the throw and his shoulder-charge early, so the twist can build on the
  throw.
- The Mill Stream comes before the Windy Ridge, so that wind, then the wind twist, then the castle run as one
  build-up. The moat swim at the gate repeats the mill lesson as a callback.
- The ridge gets a third step (the cart as a windbreak) and the follow rule "she won't come out into the wind".
  Without that rule, Call would solve the ridge.
- The Tor Gap is new: the twist beat.
- At the Castle Gate the ratchet logic is spelled out, and the drawbridge fall is staged as the set piece.

### Beat 1: The Field Wall (intro: switching, her climb, Call)
- **Build:** a drystone wall 1.7 m high (above M) and 30 m long, running between two rock outcrops. A solid plank
  gate stands in it, with a rope loop over the gatepost on the far side and its tail visible over the top. A patch
  of ivy 1.5 m wide covers both faces of the wall, 4 m from the gate.
- **Play:** you start as the knight. He pushes the gate and it rattles but holds. He tries the ivy and it tears,
  and he slides back with a shrug. Prompt: "Tab: Whisker". She climbs, drops over and unhooks the loop, and the gate
  swings open. Prompt: "Q: Call", and he walks through to her.
- **Teaches:** switching, his limit, her climb, Call. Nothing can go wrong.

### Beat 2: The Ditch (intro: his push)
- **Build:** a ditch 1.6 J wide and 1.2 m deep with steep, unclimbable sides, a trickle at the bottom, and a
  walk-out ramp at the near end. A fallen trunk (radius 0.35 m, 5 m long) lies along the near bank with its root
  plate at one end. The far bank has two notches.
- **Play:** if either of them jumps they land in the ditch and walk out. He pushes the crown end, the trunk swings
  around its root and drops into the notches, and both walk across. If she pushes she strains and nothing moves.
- **Breather:** a sheep meadow, the castle in full view, one line of dialogue.

### Beat 3: The Sheepfold (development: throw, a chain of three, the creep hole)
- **Build:** a square fold 8 x 8 m with smooth pale walls 2.4 m high (no ivy anywhere). The road goes in through the
  near gate and out through a gap in the far wall. The near gate is barred inside by a timber bar held with a pin,
  and it is swollen shut. Beside the gate is a creep hole blocked from outside by a loose stone. A crow sits on the
  coping above the gate.
- **Play:** he calls her, lifts her, and aims at the coping, and the crow flies off. He throws. She drops inside
  and pulls the bar pin, and the bar falls. When she pushes the gate, nothing moves. Switch to him: a
  shoulder-charge, and the gate bursts open. She can also knock the stone out of the creep, which the camera hints
  at with a short pan if she lingers.
- **Teaches:** throw, the first chain, and the creep as her door. The creep also means she can never be stuck
  inside.

### Beat 4: The Mill Stream (new element: water)
- **Build:** a stream 7 m wide. A shallow shelf 2 m wide (0.7 m deep, his waist), then a deep dark channel 3 m wide,
  then a far shelf 2 m wide. An old footbridge on two stone piers has its middle 3 m as a leaf hinged at the far
  pier and standing up. A rope runs from the top of the leaf over a pulley on the mill wall to a pin on the mill's
  gallery, 3 m up. The mill's stream-side wall is rough timber (climbable). The wheel turns, as decor only.
  Optionally a few grey thin boards on the gallery, which she crosses lightly, as a preview of Chapter Two.
- **Play:** he wades out to the drop-off, gets bubbles and a gentle push back, and shakes himself. She swims the
  deep channel, climbs the mill timbers and knocks the pin. Result shot from his side: the rope runs and the leaf
  booms down. He crosses, and she climbs down or he calls her.
- **Breather:** the road climbs toward the ridge, and the wind sound and grass motion build.

### Beat 5: The Windy Ridge (new element and development: wind, his lee, a stand-in)
- **Build:** a crest path 2.5 m wide and 60 m long. On the windward (left) side, rocks (boxes 1.2 to 1.6 m tall).
  On the lee (right) side, a steep grass slope into a bowl: a fall slides her down and she respawns at her last
  shelter about 2 s later. A base breeze slows her. Gusts come every 4.5 s, last 1.5 s with a 1 s warning, and push
  her about 2 m sideways off the path if she has no shelter.
- **5a Shelter hops:** rocks 3 m apart. She crosses alone in the lulls. He walks through unaffected. If you call
  her, she won't leave her shelter (she flattens her ears and meows), which teaches that he can't just bring her.
- **5b The long gap:** 8 m of bare path. You walk him to the middle of the windward edge, switch, and run her
  through his lee. He walks on while she waits behind the next rock.
- **5c Two gaps:** two bare stretches in a row, with a hay cart in a groove beside the first. He pushes the cart
  into gap 1 (it stops at a notch), then stands in gap 2. She runs both.
- **Teaches:** wind, the lee, his body as shelter, and something standing in for him.

### Beat 6: The Tor Gap (twist: the wind carries her)
- **Build:** the ridge breaks at a cleft 2.5 J wide. A normal throw reaches about 1.6 J and falls short. On the far
  side a plank bridge stands upright against a post, hinged at the far edge and tied with a rope held by a pin.
  Pennants on both edges stream toward the far side, because here the wind blows along the throw. Below is a heather
  bowl with ivy rocks to climb back up (about 10 s).
- **Play:** a throw in a lull falls short into the bowl. A throw in a gust opens her cape and she sails across. She
  pulls the pin, the bridge falls, and he walks over.
- **Why it is the twist:** for a whole beat the wind was the enemy, and now it is the solution. The throw from
  beat 3 gains timing and direction. Nothing new to learn, only a new combination.
- **Alternative twist** if the throw-in-wind feels fiddly: an updraft vent (F5). A cart covers the vent, he pushes
  it off, and she rides up to a ledge where the bridge pin is.

### Beat 7: The Castle Gate (conclusion and set piece)
- **Build:** the road ends at a moat 8 m wide that is deep all the way across. The drawbridge (a 3 x 6 m slab) is
  raised on the far side and hinged at the bottom. Two chains run from its top into slots in the gatehouse. A third
  chain, the counterweight chain, hangs down the gatehouse wall into the moat and is climbable like ivy. In the
  winding room (an interior box, open on the camera side) a windlass drum is held by a pawl, which is her pin.
  Behind the bridge is a portcullis with bars 0.15 m apart, and inside it a toothed rail with a ratchet catch with a
  pink ribbon at her height.
- **Play:**
  1. She swims the moat while he waits at the edge. The mill taught that deep water is hers.
  2. She climbs the chain into the winding room.
  3. She knocks the pawl, and the **set piece** plays (about 6 s, on a timeline): the windlass spins and the chains
     rattle. The drawbridge tips slowly, then slams down. Dust rolls out, birds burst from the towers and a banner
     unrolls down the gatehouse. A wide shot from behind the knight, then a cut to his face. Control comes back to
     her inside the gatehouse, and she drops down to the gate passage.
  4. He crosses to the portcullis. She can slip through the bars to him and back at any time.
  5. He heaves the portcullis up and holds it (A1). You switch to her. She is already inside, or she slips back
     through the bars, and throws the catch: clack. You switch back, he lets go, and the portcullis holds. They walk under it together. The bailey opens up: banners,
     a bell, the rider from the summons. End of the chapter.
- **Ratchet logic:** the catch only bites when the gate is raised. Pulling it while the gate is down does nothing:
  she paws it and it clicks back. That rules out doing the steps in the wrong order.
- **Optional set-piece insert between beats 6 and 7: "The Gale Walk".** The strongest gust of the day hits on the
  descent. She rides on his shoulders, tucked under his cape. You control only him, walking into the gale and
  holding Brace through each gust. There is no puzzle, it is all bond, and it uses `carry.ts` and the shoulder-ride
  travel mode.

---

## 4. Chapter Two, inside the castle: five beats

These use the verbs Chapter One saved: plates, rotten boards, thin planks, cranks and high levers, counterweights,
drains, and the drowned plate. They also include one separation, to set up STORY.md's late twist "you can no
longer switch".

**C2-1. The Kitchen: cat flap and scales** (B2, A4, D1)
- The kitchen-yard door is barred, and there is a cat flap in it. She goes in and pulls the bar pin.
- Inside, the larder gallery is 3.5 m up. A great meat hoist is the counterweight scales: she stands on B, he
  steps on A, and she rises.
- On the gallery she walks a thin shelf too weak for him, to the pin of a flour sack hanging over B. The sack
  drops, B sinks, and he rises.
- Readability: flour puffs when the sack lands, and the hoist's pulley sits in the middle of the room.

**C2-2. The Great Hall: two plates and an empty suit of armour** (A2, A3, B5)
- The doors to the stair tower open only while both of two plates are pressed. He is one weight, and she only
  goes "tink".
- A display suit of armour stands on a wheeled plinth, a visual rhyme with him. He pushes it onto plate 2 and
  stands on plate 1, and the doors swing open. But they close again when he steps off.
- She climbs a tapestry (climbable cloth, like ivy) to the minstrels' gallery. She walks the beam over the doors
  (thin, hers only) and pulls the latch pin that pins them open. He steps off and the doors stay open.
- This develops A2 and A3 into a chain of three, and adds the joke of the knight and the empty knight.

**C2-3. The Drains: the separation (twist)** (G2, G1, E2, E3, A5)
- Crossing the courtyard, she slips through a drain grate. This is a scripted, telegraphed story beat, not a fail.
  The drop is 2 m into the drains and the walls are smooth, so she can't get back up.
- They now play in parallel. Above, he works the courtyard: he stands on the drowned plate in the horse trough
  pool, which holds a culvert gate open below for her. He turns a sluice crank that lowers a flooded drain so she
  can pass.
- Below, she pulls pins that open his doors, through gratings she can see him through.
- They meet again at the castle well. He cranks the bucket up and she is sitting in it, which reuses the well
  bucket idea from STORY.md.
- Twist: for the first time she is alone in the dark, and he becomes the one who operates the world for her.

**C2-4. The Ramparts: wind, now with walls** (F1, F2, F3, F5)
- The wall-walk in a gale. Merlons are shelters, broken sections are the gaps, and arrow slits blow narrow jets of
  wind across the walk.
- New here: wooden shutters on hinges that he pushes shut as permanent windbreaks.
- At the end, the kitchen chimney's warm updraft (smoke and sparks rising) carries her to the roof of the keep,
  where she pulls the pin on the tower door for him.
- This is a callback to Chapter One with one new tool (shutters) and one new use (the updraft).

**C2-5. The Great Bell (set piece)** (A5, A6, G1)
- The great bell must be raised to ring the summons, or to call the healers in STORY.md's arc.
- He works the great winch at the foot of the tower. The winch clicks and holds at each floor, so it is safe to
  switch. The bell rises up the shaft with her riding on top.
- At each floor a trapdoor blocks the shaft, and she pulls its pin as the bell arrives. There are three floors.
  The last floor is too high for the rope, so he climbs the stairs and lifts her to the release catch (A6).
- She unhooks the catch, the bell swings and rings, and the camera pulls out over the castle while bells answer
  across the moor. End of the chapter.

---

## Appendix: building blocks for the code

These are the primitives every pattern above uses. Each can be built from boxes, cylinders and trigger volumes.

| Primitive | Parameters | Notes |
|---|---|---|
| `Climbable` (ivy, timber, chain, tapestry) | surface, who: kitten | The knight's attempt plays the "too heavy" tear-and-slide once per surface. |
| `SmallGap` (bars, drain, creep, cat flap) | portal pair, who: kitten | A squeeze animation, with the camera pulled in. A creep can start one-way (a loose stone knocked out from inside). |
| `Pin` | event, oneShot, requiresState? | Has a pink tassel. `requiresState` covers things like the ratchet catch that only works when the gate is up. |
| `Plate` | threshold (kitten 1, knight 20, block 20), link | Sinks in proportion to weight. Under her it twitches and goes "tink". |
| `HeavyGate` | mode: tied, barred, stuck, lift; ratchet? | A lift gate is a knight hold that lasts across switches. A stuck gate needs his shoulder. |
| `Crank` | target 0..1, rate, ratchet: true | Never unwinds when released. |
| `Pushable` | rail or arc path, stops, resetPose | Never free physics. A reset volume puts it back. |
| `Lift/Throw` | snap cone, arc preview, maxRange 1.6 J, wind assist | The throw is one knight action. The landing can optionally pass control to her. |
| `Water` | depth map (shallow ≤ 0.9 m, deep), current | Knight: a soft push back at the drop-off. Kitten: swims, and is carried by the current. |
| `WindZone` | dir, base, gust period, length, warning | Lee test: a ray from her upwind about 2.5 m hits a rock or the knight's capsule. She hunkers while idle. |
| `Rotten` | mode: refuse (over a drop) or break (over a safe level) | Creaks and dips before anything happens. |
| `Counterweight` | two platforms, a pulley, masses | Moves only by mass difference, slowly and readably. |
| `ResetVolume` | safe spawn per character | Back in about 2 s. No death. |

Each puzzle should also ship a scripted bot solution for `tools/cap.mjs`: the list of switches and actions above,
in order. A puzzle the bot can't solve in that order has an ordering or soft-lock bug.

---

## Sources

- GamingBolt, Fares on variety: https://gamingbolt.com/narrative-games-can-become-very-repetitive-josef-fares-promises-max-variety-for-it-takes-two
- GameSpot, It Takes Two review: https://www.gamespot.com/reviews/it-takes-two-review/1900-6417655/
- GamesBeat, It Takes Two interview: https://gamesbeat.com/josef-fares-youll-love-it-takes-two-or-you-can-break-his-arms-and-legs/
- GamesBeat, Split Fiction interview: https://gamesbeat.com/how-josef-fares-stayed-focused-on-the-co-op-action-adventure-with-split-fiction-interview/
- Xbox Wire, Split Fiction interview: https://news.xbox.com/en-us/2025/03/05/split-fiction-josef-fares-interview/
- The Ringer, Fares interview: https://www.theringer.com/2021/4/22/22396763/josef-fares-it-takes-two-interview-co-op-gaming
- Unreal Engine, It Takes Two developer interview: https://www.unrealengine.com/developer-interviews/it-takes-two-lovingly-marries-story-and-gameplay-together
- The Tartan, It Takes Two ability pairs: https://the-tartan.org/2024/03/25/it-takes-two-review-one-of-the-best-co-op-games-ever/
- Wikipedia, It Takes Two: https://en.wikipedia.org/wiki/It_Takes_Two_(video_game)
- Wikipedia, Split Fiction: https://en.wikipedia.org/wiki/Split_Fiction
- GMTK, On the Level: It Takes Two (with Oliver Granlund): https://x.com/gamemakerstk/status/1441068467000651776
- Per Stenbeck (Hazelight) interview: https://blog.metu.edu.tr/gates/?p=2189
- Giant Bomb, A Tale of One Game (Brothers): https://giantbomb.com/articles/a-tale-of-one-game/1100-4736/
- Godisageek, Brothers review: https://godisageek.com/2013/08/brothers-tale-sons-review/
- GDC Narrative Review, Brothers (PDF): https://media.gdcvault.com/gdc2017/GameNarrativeReview/Kristian%20Skistad%20Game%20Narrative%20Review%20Brothers%20-%20A%20Tale%20of%20Two%20Sons.pdf
- MobyGames, ICO: https://www.mobygames.com/game/5158/ico/
- Wikipedia, The Last Guardian: https://en.wikipedia.org/wiki/The_Last_Guardian
- KeenGamer, Trico: https://www.keengamer.com/articles/features/opinion-pieces/making-sense-of-trico-the-last-guardians-misunderstood-hero
- Nintendo Wire, Unravel Two: https://nintendowire.com/news/2019/03/25/review-unravel-two-on-switch/
- GameSpot, Unravel Two review: https://www.gamespot.com/reviews/unravel-2-review-partners-in-twine/1900-6416931/
- Game Developer, Trine interview: https://www.gamedeveloper.com/pc/interview-talking-i-trine-i-with-frozenbyte
- Destructoid, Trine single player: https://www.destructoid.com/review-trine-single-player/
- Co-Optimus, Portal 2 co-op: https://www.co-optimus.com/review/749/page/2/portal-2-co-op-review.html
- AWN, Erik Wolpaw on Portal 2: https://www.awn.com/print/blog/talking-portal-2-valve-software-s-erik-wolpaw
- Game Developer, Portal 2 design review: https://www.gamedeveloper.com/design/portal-2-game-design-review-part-1
- Game Developer, Best of GDC (Portal): https://www.gamedeveloper.com/pc/best-of-gdc-the-secrets-of-i-portal-i-s-huge-success
- Wikipedia, Pico Park: https://en.wikipedia.org/wiki/Pico_Park
- Nintendo Life, Biped: https://www.nintendolife.com/news/2020/06/feature_biped_producer_on_the_cute_co-op_platformers_journey_to_switch
- Game Developer, We Were Here: https://www.gamedeveloper.com/game-platforms/road-to-the-igf-total-mayhem-games-i-we-were-here-i-
- Tropedia, The Lost Vikings: https://tropedia.fandom.com/wiki/The_Lost_Vikings
- Co-Optimus, Guardian of Light preview: https://www.co-optimus.com/preview/490/lara-croft-and-the-guardian-of-light-co-op-hands-on-preview.html
- Engadget, Guardian of Light hands-on: https://www.engadget.com/2010-05-18-hands-on-lara-croft-and-the-guardian-of-light.html
- MCV, Nintendo's four-step level design: https://www.mcvuk.com/development/video-nintendos-level-design-secrets-in-four-steps
- Kotaku, Super Mario 3D World: https://kotaku.com/what-made-super-mario-3d-world-so-great-1691916400
- Superjump, Minish Cap: https://www.superjumpmagazine.com/to-understand-zeldas-future-look-to-its-handheld-past/
