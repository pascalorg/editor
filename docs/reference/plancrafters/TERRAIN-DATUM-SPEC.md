# TERRAIN DATUM + FOUNDATION GRADE TRUTH (Steve, Jul 3)

Steve verbatim: "reset the terrain point on the house to the HIGHEST point where the
house intersects, keeping the top of footing always 8 inches above grade on the house.
Garages can sit on stem walls — usually like a 6 inch stemwall above a 12 inch footing,
typically always slab, so it should be consistent. Otherwise we have to adjust the
terrain on auto import when the house changes size — the terrain should reset correctly."

## A. HOUSE DATUM = HIGHEST INTERSECTING GRADE + 8" CLEARANCE
- Sample the natural terrain surface across the HOUSE FOOTPRINT (exterior loop,
  dense grid or perimeter+interior samples).
- The governing point is the HIGHEST natural grade under/at the footprint.
- Set the vertical datum so TOP OF FOUNDATION (top of stem / top of slab edge)
  sits ≥ 8" ABOVE that highest grade point (CRC-style siding/grade clearance —
  nothing wood ever below grade anywhere around the house).
- Concretely: the terrain's house offset (what site.terrain.offsetIn manual
  fiddling compensates for today) auto-derives: offset = highestGradeUnderHouse
  such that stemTop(=FF datum family) − highestGrade == 8" + stem exposure per
  foundation type. Keep site.terrain.offsetIn as a USER DELTA applied ON TOP of
  the auto datum (so existing saved offsets still mean something — document the
  migration: auto datum + user delta; a model with a big manual offset may need
  the user to zero it — status-note when auto datum changes significantly).
- RECOMPUTE TRIGGERS: terrain import/ensure, house footprint change (walls
  added/moved/resized — the loop hash changes), move-house, generate. This is
  the "terrain should reset correctly when the house changes size" ask. Cheap:
  recompute in terrain.ensure + when heightAtInches' cached loop hash changes.

## B. GARAGE FOUNDATION = CONSISTENT SLAB-ON-STEM
- The garage ALWAYS founds as: SLAB with a perimeter STEM ~6" above its grade
  over a 12" FOOTING — regardless of the house foundation type (house raised →
  garage still slab; the 18" house-FF-to-garage-slab drop from rev 557 stands,
  now expressed as: garage slab elevation per its own stem/grade rule, steps
  make up the difference).
- Garage stem/footing shows in the foundation plan + sections + takeoff
  (concrete volumes) like the house foundation does.
- Garage slab still slopes conceptually to the door (note, not geometry).

## C. CONSISTENCY RULES
- With terrain OFF (flat): highest grade == flat plane → same 8" rule, so slab
  houses read stemTop 8" above flat grade consistently.
- Hillside: the 8" governs at the HIGH side; the LOW side exposes more stem — the
  foundation builder already handles stepped stems/deep sides; the datum change
  only moves the reference.
- The driveway/terrain pad from rev 557 keys off garageInfo — verify it still
  meets the (possibly re-datumed) garage slab.

## Tests
Fixtures: flat terrain (offset auto == 8" rule), sloped fixture (datum == highest
corner + 8", low side deeper exposure), footprint RESIZE recomputes datum, garage
stem 6"/footing 12" present in foundation data + takeoff, rev-557 garagefloor tests
stay green, manual offsetIn still applies as a delta.
