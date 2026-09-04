# Launch kit — pascal-blender

Everything reusable for the public release. Voice: builder-to-builder, show
don't tell, one concrete claim per sentence.

---

## One-liner (repo description, link previews)

> Open your Pascal editor scenes in Blender — one drag-and-drop, fully
> editable, zero data loss.

## Short pitch (README top, Product Hunt tagline)

> Pascal's scene graph is a clean parametric JSON. This Blender extension
> rebuilds it natively — real walls with live door/window booleans, parametric
> roofs, instanced furniture, your floor levels as collections — and keeps
> every byte of the original JSON inside the .blend, provably recoverable.

---

## Tweet thread (main launch)

**Tweet 1 (hook + hero visual)**
You can now open your https://editor.pascal.app scenes in Blender.

Drag the JSON into the viewport → a real, editable Blender project.
Not a triangle soup. Walls, roofs, doors — all still objects.

Free & open source 🧵
[attach: 15-30s screen recording — see "Demo video script" below]

**Tweet 2 (the lossless flex)**
"Import" usually means "lossy bake".

This one is provably lossless: the test suite rebuilds the original JSON
from the .blend alone and asserts it's deep-equal to the source file. Every
node keeps its data in custom properties. Delete nothing, guess nothing.

**Tweet 3 (the editable flex + gif)**
Doors and windows stay live: each one is parented to its wall and drags a
boolean cutter with it.

Move the door → the hole follows.
[attach: 5-10s gif of grabbing a door along a wall]

**Tweet 4 (why it matters)**
Design the house in the browser in minutes. Render it in Blender with
Cycles, sun studies, grass, camera animation — whatever you want.

Web speed for modeling. Blender power for everything after.

**Tweet 5 (CTA)**
Install: grab the zip, drag it into Blender. That's it.

Want auto-updates? Add our extension repo once in Blender's preferences:
pascalorg.github.io/pascal-blender/index.json

⬇️ https://github.com/pascalorg/pascal-blender
Editor (also open source): https://github.com/pascalorg/editor

**Alt single-tweet version (if no thread):**
Your Pascal editor scenes now open in Blender — drag & drop the JSON, get a
fully editable project (live wall openings, parametric roofs, furniture as
instances), with the original data provably preserved. Free & open source:
https://github.com/pascalorg/pascal-blender
[attach video]

---

## Demo video script (~25 s, screen recording, no voiceover needed)

1. (0–5 s) Pascal editor in browser: orbit around a house, open the export,
   download the JSON.
2. (5–9 s) Drag the .json file into Blender's 3D viewport → import dialog →
   Import. House appears.
3. (9–15 s) Open the outliner: Building → Level 0 / Level 1 collections.
   Click a wall, N-panel → Pascal tab shows its parameters.
4. (15–20 s) Grab a door, slide it along the wall — the opening follows live.
5. (20–25 s) Switch to Cycles rendered view, sun rotates, end on the hero
   angle + repo URL as text overlay.

Caption overlay ideas: "browser → Blender", "zero data loss", "openings stay live".

---

## Reddit / forum posts

**r/blender (title):** I made a free extension that imports parametric
houses from a browser-based editor (Pascal) — walls with live boolean
openings, not baked meshes

**Body sketch:** what Pascal is (open-source web editor, scene = JSON),
what the importer preserves (hierarchy as collections, parametric params as
custom props, full source JSON in a Text datablock), the losslessness test,
link, screenshots. Invite scene files that break it.

**Blender Artists / Devtalk:** more technical angle — Extensions platform
packaging, MANIFOLD boolean solver for thin-wall cutouts, the deep-equal
round-trip harness. Ask for feedback on the exporter design.

**Hacker News (Show HN):** Show HN: Lossless importer from a web-based
home design tool into Blender — the "provably lossless" test harness is the
HN-bait; link the design doc.

---

## Talking points (interviews, replies)

- The editor's own GLB export bakes to triangles; this consumes the scene
  JSON instead, so a wall is still "start, end, thickness, height".
- Losslessness is enforced by CI: import → reconstruct JSON from the .blend
  → deep-equal with the source, incl. unknown node types and future fields.
- Real scenes already stress-tested (capture-merge sliver walls broke the
  miter math on day one; fixed with a miter limit + regression fixture).
- Roadmap: two-way sync (Blender edits → back to the editor), exact
  hollow-shell roof CSG, asset relinking.

## Assets in this folder

| File | Use |
|---|---|
| `hero-clay-render.png` | hero image (Cycles clay, real user scene) |
| `real-house-eevee.png` | secondary screenshot |
| (record yourself) demo video per script above | the actual viral asset — video >> stills |

Suggested extra shots to capture in the UI: outliner hierarchy close-up,
N-panel Pascal tab, the drag-and-drop moment, editor-vs-Blender side by side.
