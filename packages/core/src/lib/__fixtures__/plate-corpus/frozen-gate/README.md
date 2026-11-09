Trimmed, anonymised production scenes from the frozen `f03f3ce4` M4/M5 evidence.
Node IDs, coordinates, construction, saved holes and transport intent are
retained; names, asset URLs and project IDs are neutral. Furniture and unrelated
level geometry are omitted; ancestor levels and stair source/destination
construction remain so opening queries use the real stack. `areas` and `gaps`
retain the frozen report's measurements and sample stations.

- `scene-21`: one of the largest reported area losses and a reported gap scene.
  M4 preserves its visible area within 1%; ensuring missing stair holes
  accounts for the later loss, and its reported gap samples lie in newly
  ensured stair openings (9 walls), including boundary cuts.
- `scene-10`, `scene-19`: legacy elevators parented to levels. The service
  query must find the owning building before client reparenting, including a
  level whose building is recorded only through `building.children`. Client
  hydration, shared normalization and mounted opening systems must agree.

Visible area in `scene-21` (m²): 25.675 before M4, 25.675 after M4 and 22.108
after opening repair. Saved holes are never redrawn to make the area/gap
measurements pass.
