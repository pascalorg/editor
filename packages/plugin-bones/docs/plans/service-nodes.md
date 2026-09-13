# Service-entry nodes — draggable building/utility interface points

User ask (2026-08-16): move the electric panel / water heater like a door
(select, menu, drag along wall); wires+pipes FOLLOW. Identifying signs on
panel + WH. Main power arrival, main water shut-off valve, main sewer exit
to the street — all placed, labeled, draggable (wall or floor, height too).
"You have your own node I guess… think of the spirit of the editor."

## Design (spirit of the editor: like doors/windows = nodes you drag)

New node kind `bones:service` (one kind, `serviceType` discriminator):
  { id: objectId('bonesservice'), type: 'bones:service',
    serviceType: 'panel' | 'water-heater' | 'power-entry' | 'water-entry' | 'sewer-exit',
    parentId: LevelId,
    // wall-mounted types mirror the host item wall contract so the host's
    // existing drag-on-wall interaction works: wallId + wallT (0..1) + heightAff
    wallId?: string, wallT?: number, heightAff?: number,
    // floor-placed types (sewer-exit, optionally water/power entry):
    position?: [x, y, z] (level-local), rotation?: yaw }

Lifecycle:
- On X-Ray create (the ⚡ button) — and on enable of showElectrical /
  showPlumbing — computeLevel does NOT create nodes; the PANEL offers
  "Place service points" (single action, idempotent): creates the five
  nodes at the engines' current auto positions (panelMountU, WH garage
  rule, meter wall, sewer exit point). Deliberate user action = safe
  scene mutation.
- Engines consume overrides: layoutElectrical/routeWiring take an optional
  panel override (wallId+wallT+heightAff → position/rotation); plumbing
  takes water-entry/WH/sewer-exit overrides. If the node exists, its
  position IS the truth; auto-placement only when absent. Reactivity is
  free: computeLevel re-runs on any node change → wires/pipes re-route to
  the dragged location (verified pattern: openings recompute, A2).
- Validation: panel on a wall keeps NEC 110.26 working space + RO
  clearance checks → warning flag when the user drags it somewhere
  non-compliant (never block the drag; flag in panel + takeoff flags).
  Water entry: shut-off valve fixture at entry (P2903.9.1 full-open
  valve); sewer exit: below-slab, slope check recomputes from new exit.

Renderer/labels:
- Each service node gets a custom renderer: equipment box + SIGN — small
  plate with canvas-texture text ('PANEL' + bolt glyph, 'WH', 'WATER' +
  valve wheel, 'SEWER'), double-sided, offset off the wall face.
- Power entry: service drop/lateral member (heavy cable) from outside the
  footprint to the panel via the entry point; water entry: 1in main from
  outside to meter+valve; sewer: 4in pipe from stack exit under slab to
  street side. All recompute from node positions.

Host integration to verify first (scout):
- Does the host render unknown plugin node kinds' children of a level via
  NodeRenderer? (bones:framing renders already — yes, via nodeRegistry.)
- Drag-on-wall: does the host expose the wall-drag interaction for plugin
  nodes (ItemNode's attachTo machinery) or do we need placement.tsx-style
  custom tool? bones:lumber already has a placement tool — reuse pattern.
- Selection menu: def.inspector fields (serviceType read-only, heightAff
  slider) via the stock inspector like FramingNode booleans.

Gates: engine override tests (panel override → homeruns land at override;
sewer override → drains re-slope to new exit + monotonic gate still
green); RO-clearance warning on bad drag position; idempotent placement
action. Loop: skeptic + visual drag QA (drag panel along wall → wires
follow in <1 recompute; drag sewer exit → slopes re-derive).
