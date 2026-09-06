# ROOF POLICY — massing-aware style + bearing truth (Steve, Jul 6)

Steve verbatim: "its almost like we should include some box designs where the garage
aligns with the face and roof can pass over and go gable easily, and the ones that pop
out we make all those hips... if the house has pop outs then just make that one a hip
one by default — should clean up most of the messes... can you rethink the edge cases
and algorithm and ensure this works correctly — the roof is a big issue on procedural
generation, get it working near perfect."

## A. MASSING-AWARE ROOF POLICY (generator)
The roof style must be chosen by what the MASSING can support, not the style vocabulary
alone:
1. Classify the composed footprint: FLUSH BOX (rectangle, or garage/wings aligned with
   the faces — no convex pop-outs beyond ~continuation depth) vs POPPED (any wing/garage
   projecting).
2. FLUSH BOX → the style's gable vocabulary applies freely (roof passes straight over,
   gables easy — Steve's "box designs").
3. POPPED → HIP BY DEFAULT for the whole design (hips always resolve). Gables only where
   proven safe (an isolated wing END CAP whose planes die in clean per the C5/cone
   machinery — keep, it works) — when in doubt, hip.
4. NEW MASSING VARIANT: deliberately generate FLUSH-GARAGE designs (garage face aligned
   with the main front) some of the time for gable-heavy styles (farmhouse/craftsman) so
   they keep their gabled character with a massing that supports it. Seeded choice:
   flush-garage box (gables) vs popped garage (hip package).
5. Too-wide-for-gable guard: very wide simple boxes may still prefer hip per style rules.

## B. WING/LOWER-ROOF BEARING TRUTH (engine)
Steve verbatim: "roofs frame to the INSIDE of the wall basically... to keep a roof
straight, its a shared wall with the roof above — the roof ABOVE goes to the outside
wall because thats the bearing point, but adding a roof from the right side, it has a
bearing point on the math to the INSIDE wall framing top plate, and the roof projects
up — it still stops outside the 2nd story and looks visually correct, but we pull the
math from DIFFERENT SIDES by hand."
- The UPPER/main roof planes bear on THEIR walls' OUTSIDE faces (as today).
- A LOWER roof dying INTO an upper wall computes its plane from the bearing at the
  INSIDE FACE / top plate of the shared wall (ledger line), projecting upward — the
  skin still terminates against the upper wall's outside face visually, but the plane
  equation anchors at the inside-face bearing. Fixes the "logic don't work right" on
  2-story garage wings.

## C. KILL THE CATASTROPHIC CLASS
Some lots still generate near-total unskinned roofs (screenshot Jul 6: half the plan
white). The policy (A) should make these impossible — hip-default on popped massing —
but ALSO instrument: if the built roof fails coverage (unskinned area > ~2% of footprint)
the generator must RETRY with the hip-everything fallback before accepting (self-healing
gate inside generate()).

## D. THEME COLORS ON RANDOM (separate, style scope)
Random changes siding but NOT the theme palette (trim/door/shutter — settings.colors).
Random must roll the full coordinated palette per style (curated trim/door/shutter
combos, seeded).
