# Reference line and justification

Stored `wall.start` → `wall.end` is the reference line; `wall-frame.ts`
owns lateral offsets. Absent `justification` means Center. `a` puts the
body left of the directed line; `b` puts it right. Wall-local +z is left.

The Reference control uses Inside / Center / Outside only with one known
interior and one known exterior face; Inside/Outside name the anchored
reference face. Otherwise A / Center / B name the body side.
Center removes the optional field. Thickness edits keep the reference fixed.

Switching preserves faces by shifting the reference by old minus new body
centre offset. `planWallMoveJunctions` slides connected neighbour endpoints
along their lines to the new host intersection, including mid-span T-stems.
All touched walls commit together in one undo step. Isolated curved
references become concentric arcs (endpoints and sagitta change).

Only an actual start/end swap uses `reverseWallDirection`: it swaps
justification and front/back classification and negates curve sagitta.
Endpoint drags, including rotations through 90°, never swap orientation
fields. Split, bridge, group transform and duplicate preserve stored order;
merge aligns genuinely reversed input walls through the reversal helper.

Corner edges intersect at actual face offsets. Justified two-wall junctions
close at the body-centreline intersection (endpoint tangents for arcs), with
reference-vertex fallback for parallel, degenerate or over-limit intersections.
Multiway fans retain the reference vertex. T-stems stop at the host near face;
their closing point lies between the trimmed edges, avoiding a sliver.
All-centred junctions use the legacy path byte-for-byte (the 1a golden).
Mixed junctions also change the centred member's footprint to close the joint.

Endpoint snapping and graph connectivity use reference lines. Detected room
polygons follow body centrelines, so redefining references preserves rooms.
Auto slabs adopt actual faces at render time; support uses that same polygon.
Surface classification samples outward from the body centre. Openings and
embedded items use the body centre; wall-side items and cabinet snaps use
faces. Plan body polygons and side handles use kernel offsets; endpoint
handles stay on references. Opening ghosts keep host context for proxy depth.
