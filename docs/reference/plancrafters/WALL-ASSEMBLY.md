# Chief-Architect Wall Assembly — build plan + status

Steve wants true multi-layer wall assemblies (like Chief Architect): stud core wrapped
in finish + sheathing + cladding + WRB, dimensioned to the STUD, shown in 2D and modeled
in 3D. Running under `/loop 20m` (cron 7957bd30) until complete.

## Key decisions (locked)
- **Reference = the STUD.** Dims + foundation line up to the stud face (Steve: "the studs
  is how you line up your foundations"). Wall POSITION (centerline) is unchanged — never
  reposition existing walls.
- **Layers** (interior → exterior), z-offset from the wall centerline (z = wall +normal;
  `HA.interiorSign` picks the interior side):
  - interior wall: gyp | stud | gyp   (symmetric; existing t = stud + 1.0")
  - exterior wall: gyp | stud | sheathing | WRB | **cladding**
  - The existing wall `t` already covers gyp+stud+sheathing. **Cladding is ADDED OUTSIDE**
    on the exterior (stud stays put). Constants in `model.js`: `HA.GYP=0.5`, `HA.SHEATHING=0.5`,
    `HA.CLADDING=0.75`, `HA.WRB=0.02`. Helpers: `HA.wallStud`, `HA.wallStudHalf`, `HA.wallClad`.
- **Cladding = siding OR stucco, ONE thickness** (Steve: don't break them out; treat same).
  Material class already exists (materials.js: 'Siding' / 'Stucco'). Attach the active
  cladding material to the wall (later step); thickness stays 0.75" for both.

## Steps + status
1. ☑ **Assembly data model + constants** (`HA.GYP/SHEATHING/CLADDING/WRB`, `wallStud/wallStudHalf/wallClad`). rev 440.
2. ☑ **Dims → STUD face.** `exteriorLoopOD` (roof.js) + plan2d `dimTiers.offAt` now offset by
   `wallStudHalf` (was wall-face `wallT/2`). Verified: Wren 360→365.5 (stud), gate 91/91. rev 440.
3. ☑ **3D: model the cladding + sheathing layers.** In `view3d._buildWall`, CLADDING layer
   (thin extrude, `HA.CLADDING`=0.75") added on the exterior outside the stud+sheathing `t`,
   mitered via the `miter()` helper, own cladding material. Verified live rev 441 (ext walls
   = 3 meshes solid+gyp+cladding, int = solid+gyp; render clean, corners tight, no z-fight).
3D corner miter for walls is DONE (rev 439, `HA.wallEndMiter` + per-face vertex shift).
4. ☑ **2D: sheathing + cladding thickness lines.** rev 442. `plan2d._drawWallAssemblyLines()`
   draws the STUD-face loop (`HA.exteriorLoopFace`+`exteriorLoopStudDist`, a light hairline on
   top of the poché → shows the sheathing band) and the CLADDING outer-face loop
   (`HA.exteriorLoopClad`, `exteriorLoopCladDist` = wallT/2 + cladding → the siding line just
   outside the poché). Both return NULL (not a centerline fallback) if the loop can't offset,
   so a bad offset draws nothing. Verified live @42×: poché + stud line + white cladding band +
   outer siding line, corner mitered. Flows into printed sheets (same `_drawWalls`, opts.print).
5. ☑ **2D corner miter for the assembly.** Exterior loop (poché + layer lines) miters via
   `U.offsetPoly`. PLUS Chief-style **45° corner-cut lines** (rev 446): `_drawWallCornerMiters()`
   draws one thin diagonal per real exterior L-corner, from the inner poché corner
   (`exteriorLoopFace(-wallT/2)`) to the outer cladding corner (`exteriorLoopClad`) — the visible
   miter joint Steve was missing. Skips straight runs (cross-product≈0) + acute spikes
   (>4·wallT+24). T-junctions excluded (exteriorLoop = exterior walls only). Node-validated on
   rect (4) + L-shape (cedar_ridge, 6 corners). Interior-partition→exterior = butt (correct).
   NOTE (rev 445): 2D wall/cladding/sheathing/miter lines use CONSTANT thin px (0.75–1px) + an
   LOD gate (`scale·CLADDING < 0.8` → skip) — NOT `_afpx` (a FONT sizer, floors at 9px → looked
   fat on zoom-out). Steve: "wall lines should stay thin and crisp." Fixed + live-verified.
6. ☑ **Interior walls snap to the INNER wall face** when drawing (rev 447). Snap-PREVIEW to the
   inner face, STORE the centerline (Chief's model; storing at the face would break room weld
   0.5", miter/endExtension 1" neighbor search, and every exporter which reads wallA/wallB as
   centerlines). snap.js `collectFaceSnaps` (priority 0.5) emits the face foot (marker) + the
   parallel centerline foot (`cl`); plan2d `_solveSnap` emits inner-face target segments per
   exterior wall + returns `res.cl` on a face win; filled-square face marker glyph. Flag
   `model.settings.snaps.faceSnap` (default ON). 51/51 snap tests (+4 new), backward-compatible
   (centerline storage = byte-identical to legacy). Designed via a 5-agent workflow.
   NOTE (rev 448): **true 45° mitered wall FILLS** — `_wallQuad` now uses `HA.wallEndMiter`
   (the 3D solver) so corner quads ABUT at the miter instead of overlapping (Steve's "walls
   overlap still, show true 45"). Free ends/T-junctions/straight runs stay square (unchanged).
7. ☑ **Cladding material on wall types** — the 3D cladding mesh uses `HA.wallMaterial` =
   `wall.material` (exterior siding/stucco pick: lap/batten/stucco classes in model.js). rev 441.
9. ☑ **Interior DRYWALL shown + CHANGEABLE thicknesses** (rev 449-450; Steve: "drywall on the
   inside is missing… ensure the thicknesses are changeable, always stick to the framing").
   - DRYWALL LINE (rev 449): plan2d `_drawWallAssemblyLines` draws the interior stud face (loop
     offset in) → the drywall band on exterior walls; `_drawPartitionDrywallLines` adds it to
     interior partitions (both faces). 3D already has the interior gyp skin.
   - PARAMETRIC (rev 450): `model.settings.assembly {drywall,sheathing,cladding}` (defaults
     0.5/0.5/0.75). `HA.wallT` = DELTA formula (base_t + finish deltas) so defaults stay
     BYTE-IDENTICAL (ext2x4=5.0, porch=5.5 preserved) and only grow when edited. STUD is fixed
     (`HA.wallStud` reads explicit lumber; dims ride `wallStudHalf`). Per-side faces
     `wallExtFaceDist`/`wallIntFaceDist` for asymmetric finishes. `HA.syncAssembly(model)` pushes
     to the layer globals (hooked on load/loadModel/_restore). 3D gyp depth = `HA.GYP` (guarded:
     exact legacy path at 0.5). IFC layer-set thicknesses + cache-key follow. UI: "Wall assembly"
     settings section (drywall/sheathing/cladding inputs). Flag `HA.ASSEMBLY_PARAMETRIC` = revert.
     dev-assembly-test 19/19. Designed via a 5-agent workflow.
8. ◐ **Fix exports.** DONE: DXF (iocad — WALL-STUD + WALL-CLAD mitered polylines, rev 443),
   OBJ/glTF/STL (io3d — `cladding` group, CCW-outward, winding test green, rev 443), plan
   sheets (auto via plan2d `_drawWallAssemblyLines`), dims→stud-face everywhere (rev 440),
   IFC (iobim — real `IfcMaterialLayerSet` per wall type: gyp/stud/sheathing/cladding with
   thicknesses + `IfcMaterialLayerSetUsage`, dev-iobim test strengthened to validate the
   chain, rev 444). REMAINING: STEP kernel (iostepkernel) cladding boxes (task #27, OCCT).

## Guardrails
- Gate stays green (`app/deploy.sh` runs ~91 dev-*-test.cjs). ALWAYS test the mixed path.
- NEVER mutate Steve's live model — dev fixtures only (`HA.DESIGNS`/`HA.ADU_TEMPLATES`); to
  test in-browser use a fixture + block cloud-save, then restore + reload.
- Verify render-dependent work LIVE in the app (Chrome MCP tab 169340365) — harness can't see it.
