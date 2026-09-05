# AUTO HOUSE GENERATOR — design (P1, Jul 3)

## v3 REQUIREMENTS (Steve, Jul 3 night — "keep working until it looks AAA ready")
1. OPEN CONCEPT is the default: great room + kitchen + dining = ONE contiguous open space
   — NO walls between them (island/peninsula + furniture define the zones; labels place in
   zones of the open poly). "No closed-off kitchen… open concepts and all that jazz."
   Half/pony walls or cased openings only where a style wants separation.
2. NO closed-off/long hallways: open plan kills most circulation; bedroom-wing hall short
   (≤12ft), wide (42"+), always daylight/vista-ended if possible — never a closed tube.
3. CEILINGS 9'-0" MIN in generated designs (settings.wallHeight/level height = 108),
   user can swap after. Style may vault the great room later.
4. WINDOW HEADS at door head height (6'8"–8'0" head, i.e. sill = head − window height),
   NOT hung from the top plate — "roof removed shows the windows at the top" bug: audit
   how gen.js computes sill vs makeWindow's sill semantics and fix so heads align at
   ~82" (8' walls) / ~96" (9' walls) with taller windows getting LOWER sills.
5. DOORS: interior doors = proper solid interior type — NO glass/exterior door types
   inside ("wrong doors like glass doors inside"). Check makeDoor/type vocabulary;
   closets may use narrower doors. Exterior rear = slider/french to yard when style fits.
6. ENTRANCES: front entry composition must read real — porch/stoop centered on the door,
   proper landing + steps, door w/ correct swing, foyer inside, not a door punched
   mid-wall ("entrances suck").
7. Study REAL floor plans for the layout archetypes (builder catalog patterns: open-core
   ranch, split-bedroom, corridor-free cottage) and encode them as layout templates the
   scorer can choose among — not just recursive boxes.

Steve: "auto house generator — fits within the setback, nice designs of all types, graph
network (master with master bath etc), presets, different styles, beautiful 1-story,
2-story, ADU mode selector, generates fast and stunning, knows if it's on a hill it goes
into the hill, different entrances, porch tool, roofs are automatic — it's just moving
walls and creating stories. Sometimes rooms are up front, kitchen in the back, sometimes
kitchen in the corner — only so many locations in a house."

## Shape
`HA.generator.generate(model, opts)` in js/gen.js — MUTATES levels/roof/foundation/
finishes/fixtures/entrances/decks, PRESERVES model.site (lot, terrain, geo, frontEdge)
+ project + settings the user owns. Seeded RNG (mulberry32) so opts.seed reproduces a
design; "reroll" = new seed. opts: { mode:'1story'|'2story'|'adu', style, beds, baths,
garage:boolean, porch:'full'|'entry'|'none'|'auto', seed }.

## Pipeline
1. ENVELOPE: HA.site.setbackLines(model).poly (fallback: default 60x100 lot w/ 20/5/15
   setbacks when no lot). Orient to the FRONT edge (HA.site.classifyEdges /
   model.site.frontEdge): local frame u=along front, v=depth into the lot. Everything
   below happens in the local frame on a 6" grid; project back at the end.
2. FOOTPRINT: target SF per mode (adu 600-1000, 1story 1200-2000, 2story/level
   900-1400). Rect W×D inside envelope w/ margins; then STYLE JOG: cut/add one corner
   notch or bump (L/T massing) 4-10ft. Clamp inside envelope (inset 6").
3. ROOM GRAPH (the "only so many locations" truth): zones as recursive slices.
   - PUBLIC band (front): entry hall + living; porch carved OUT of or added ON front.
   - SERVICE: kitchen+dining VARIANTS by seed: back-center / back-left corner /
     back-right corner / mid-side galley. Kitchen ADJACENT to dining, near garage/
     service entry when garage on.
   - PRIVATE wing: master suite (bed + bath + WIC) at back corner OPPOSITE kitchen (or
     front corner variant), secondary beds share a hall + bath. Laundry near
     kitchen/garage (1story) or upstairs hall (2story).
   - 2story: stairs (fixture 'stairs' 38x132) off the entry, up = beds/baths; down =
     public+kitchen+master-option ('master down' variant by seed).
   - adu: studio/1-bed compact graph, kitchen run on a wall, bath back corner.
   - Guarantee: every room ≥ min dims (bed 10x10, bath 5x8, kitchen 10x10, hall ≥3.5ft),
     every room reachable via doors (graph edges = door openings), bedrooms get egress
     windows, baths/kitchen exterior when possible for windows.
4. WALLS: exterior loop ext2x6 (HA.makeWall), interior int2x4 partitions from slice
   edges. Openings: front door (36) @ entry, interior doors (30/32) on graph edges,
   windows: living 2×(48x60), beds egress 36x48 min sill 44, kitchen 48x36 over sink,
   baths 24x24. Snap all coords to the 6" grid; dedupe/merge collinear walls.
5. PORCH ("porch tool"): 'full' = porch walls (type porch) across the front + entrance
   + posts; 'entry' = 6x8 stoop + entrance + gable/shed porch roof (roof.entranceRoof
   options exist); auto = style-driven (farmhouse full, others entry).
6. HILLSIDE: sample HA.terrain heightAtInches at the 4 footprint corners (when terrain
   on). Δ > 30" across depth → foundation 'basement' + basementDepth 96 (daylight
   side downhill: "goes into the hill"); Δ 12-30" → 'raised' stemHeight 24-36; else
   slab/raised by style. ADU stays slab unless Δ>30.
7. STYLE: presets pick roof (type/pitch/eaveStyle/overhang) + finishes (products.js ids
   + SW colors) + porch default:
   - farmhouse: gable 8/12, closed eave 12", board? hardie, white + black trim, full porch
   - craftsman: gable 6/12 w/ 24" overhang exposed tails, earth tones, entry porch w/ posts
   - ranch: hip 4/12 16" closed, long-low massing bias (W≥1.8D), muted greens
   - modern: shed 2/12 (roof.style shed?) or low hip, dark siding, no porch, big windows
   - cottage: hip-gable 6/12, cozy massing, soft blue/cream
8. FIXTURES + LABELS: kitchen run (base+upper+sink+range+fridge+island if ≥12ft wall),
   baths (toilet+vanity+tub/shower), beds (bed size by room, nightstand, dresser),
   living (sofa+coffee+tv), dining table, laundry (washer+dryer), water_heater in
   garage/closet; room_label per room. Electrical: skip (existing auto tools later).
9. FINALIZE: model.roof.enabled=true (auto roof), sync handled by caller; generateSet
   NOT auto-run (sheets self-update handles it).

## UI
'🏠 Generate' button next to 🎲 Style: small dialog — mode selector (1-Story/2-Story/
ADU), style chips, beds/baths steppers, porch select, [Generate] + [🎲 Reroll]
(keeps opts, new seed). Undo-friendly: snapshot before mutate (app.undoStack push —
use existing undo mechanism in app.js).

## Tests (dev-generator-test.cjs)
- seeds 1..40 × all modes: generates w/o throw; exterior loop closes (HA.exteriorLoop);
  every room label sits inside the loop; all walls inside setback poly (when lot);
  roof solves (HA.buildRoof ok); bedroom count matches opts; every bedroom has a
  window; door-graph connectivity (flood fill across door openings reaches all rooms);
  2story: stairs fixture exists on L0 + L1 walls form a closed loop; determinism:
  same seed → identical wall coords.
