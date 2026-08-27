# Modular cabinet QA session

Temporary working checklist for the UX cases supplied on 2026-08-27.

## Status key

- [ ] Not tested
- [x] Working
- [~] Needs work
- [?] Needs investigation

## Current case

- [~] 2.5 Constrained run reflow (donor system)

  Expected: When a run is fixed between two walls, increasing one cabinet's width keeps the total run extent fixed by shrinking eligible neighboring base cabinets. Plain door, drawer, and shelf cabinets may donate width; appliances must never donate. The nearest eligible cabinets donate first, initially down to 0.3 m and then, only if necessary, down to their permitted trim floor.

  Result: Needs work. The current solver only enters donor mode when both run ends are detected as constrained, then consumes the nearest donor completely before touching the equally close donor on the other side. Ordinary donors stop at 0.3 m; the 0.05 m trim floor applies only to corner-linked modules. This does not match the expected bilateral response when the center cabinet grows.

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

## Deferred cases

- [~] 1.15 Curved-wall snapping

  Curved-wall projection and tangent rotation work once the existing-cabinet mover receives pointer movement. The placed-item direct-drag handoff still drops its initial movement, so this case remains deferred while QA jumps to item 21.

## Untested cases passed over for now

- [ ] 2.3 Width change in an open run

## Open fix queue

No open fixes from completed cases.
