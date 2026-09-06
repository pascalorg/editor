# ROOF PLANE CONTINUATION OVER POP-OUTS (Steve, Jul 3)

Steve (w/ redlined screenshot): "on ALL roof types, not just auto-generation — when the
roof transitions on an L-shaped house, or an addition pops out, the ROOF LINE should
CONTINUE (red line) and the wall swapped to hip when it needs to be GABLE for the wider
part of the house. In Chief they break the wall; our users won't be advanced — our
system needs to break the wall correctly at those pop-outs where the roof should
continue."

## The Chief mental model
Chief Architect: roof directives (gable / hip / full-height) live PER WALL SEGMENT.
A designer "breaks" a wall at a pop-out so the main segment keeps its gable and the
roof plane extends over the narrower pop-out. We must automate the break + the
directive inheritance.

## Proposed mechanism: ROOF LOOP ≠ WALL LOOP (preprocessing pass)
Before the straight skeleton runs, derive a simplified ROOF loop from the wall loop:
1. POP-OUT DETECTION: find edge runs (out → along → back) where:
   - the offset depth d is small relative to the local mass (e.g. d ≤ 8 ft AND
     d ≤ 40% of the adjacent mass's perpendicular span), and
   - the pop-out lies at/along a GABLE-END side (continuation along the ridge axis
     keeps the roof profile constant — extending a SLOPE downhill over a pop-out
     would collide with its plate, so eave-side pop-outs stay hip/valley as today), and
   - plate heights match.
2. For roof purposes REPLACE the notch with the continued straight line — the
   skeleton then produces planes as if the wall ran straight, so the main
   roof/gable CONTINUES across the pop-out (Steve's red line).
3. The pop-out's own walls become COVERED walls under the continued plane — the
   engine already has this machinery (edge meta `covered`, `coveredFn`, covered
   walls build up to the roof underside like porch walls). Reuse it; do not invent
   a parallel path.
4. AUTO WALL BREAK for directives: the wider mass's end wall is conceptually
   segmented at the pop-out; gable flags apply to the CONTINUED (roof-loop) edge,
   so "the wider part of the house stays gable" even though the wall loop jogs.
   Gable infill faces must fill from the pop-out's roof/plate up to the continued
   gable plane (the stepped gable look) with siding material.
5. Works for MANUAL houses too (not just generated): this runs inside
   buildRoof/buildOn preprocessing, keyed off geometry only. Add
   model.roof.continuePopouts (default TRUE) + a per-wall override flag later.

## Eligibility guard-rails
- Never continue over pop-outs deeper than the threshold (real wings keep their
  own roof + valleys — that's correct architecture).
- Never when plate heights differ (split-level).
- Never when the pop-out already carries a lower-roof/porch directive.
- Skeleton failure with the simplified loop → fall back to the unsimplified loop
  (fail-soft, byte-identical to today).

## Tests
Fixtures: L with a 4ft gable-end pop-out (continues — assert the main slope face's
poly2 spans the pop-out, gable stays on the wider end, no hip faces on the pop-out
corner); 12ft-deep wing (does NOT continue — valleys as today); eave-side pop-out
(does NOT continue); mismatched plates (no); manual non-generated model (continues);
generated garage L (unchanged behavior unless at gable end). Full glob green.
