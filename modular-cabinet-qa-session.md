# Modular cabinet QA session

Temporary working checklist for the UX cases supplied on 2026-08-27.

## Status key

- [ ] Not tested
- [x] Working
- [~] Needs work
- [?] Needs investigation

## Current case

- [x] 2.7 Preset width debt — exact restore

  Expected: If changing a cabinet to a wider preset makes neighboring cabinets shrink, changing it back must return every donor cabinet to its exact original width. Repeatedly switching between presets must not lose or accumulate width.

  Result: Fixed and verified in a fresh open scene in Chrome. A/B/C started at 0.50/0.50/0.50 m; resizing B against A produced 0.30/0.70/0.50 m; selecting 300 mm restored 0.50/0.30/0.50 m. Width exchanged through a side-arrow resize records the actual donor and returns that debt before any unrelated neighbor can grow.

## Completed cases

- [x] 1.1 Ghost preview with live validity
- [x] 1.2 Wall snap, back flush with automatic yaw
- [x] 1.3 Wall-owned dragging, wall priority over grid, and two-wall L-corner constraint
- [x] 1.4 Edge snap to a neighboring cabinet
- [x] 1.5 Corner snap to wall ends
- [x] 1.6 Grid snap by visible footprint edges
- [x] 1.7 Alignment guides
- [x] 1.8 Island placement type
- [x] 1.9 Continuous run, drag to fill
- [x] 1.10 Continuous run, L-turn at a hinge
- [x] 1.11 Force place through collisions
- [x] 1.12 2D and 3D placement parity
- [x] 1.13 Placement audio and facing feedback
- [x] 1.14 Auto-rotate to face a wall while dragging
- [x] 2.1 Add cabinet left / right
- [x] 2.2 Side add trimmed by a wall
- [x] 2.4 Width change with one wall-constrained end
- [x] 2.5 Constrained run reflow (donor system)
- [x] 2.6 Reflow rejection when nothing fits

## Deferred cases

- [~] 1.15 Curved-wall snapping

  Curved-wall projection and tangent rotation work once the existing-cabinet mover receives pointer movement. The placed-item direct-drag handoff still drops its initial movement, so this case remains deferred while QA jumps to item 21.

## Untested cases passed over for now

- [ ] 2.3 Width change in an open run

## Open investigation queue

- [?] Recheck center → left → right creation order. One Chrome pass left the run at two cabinets after an enabled Add right action, with no console error; the reverse order worked repeatedly.
- [?] T3's in-app browser rendered the 3D viewport black with a WebGPU `configure` failure, so the width-arrow interaction could not be verified there.
