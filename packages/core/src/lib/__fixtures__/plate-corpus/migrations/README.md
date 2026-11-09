Trimmed, anonymised levels from the production migration corpus. Each file
retains wall/slab/zone IDs, plan coordinates, construction, materials and holes
after the shared normalization/healing/vertical prefix, before M3–M6–M4–M5;
names and project IDs are neutral. Furniture and unrelated levels are omitted.
The retained level has a null parent and ordinal zero; child lists contain only
retained nodes. One level per distinct legacy case:

- `scene-23`: a stale small floor overlapping a much larger or moved room.
- `scene-11`: zero visible floor area in a room buried inside thick walls.
- `scene-27`: disconnected miter islands emitted as separate plate components.
- `scene-25` (two levels): stored wall coverage over curved and mitered faces,
  stair holes and finish overlays.
- `scene-09`: recessed auto slab preserved verbatim.
- `scene-05`, `scene-08`: legacy string and object materials rejected by the
  slab schema.
- `scene-03`: a reverse boundary misclassified as its own hole; an oversized
  generic zone must not be adopted over it.
- `scene-01`: no bounded room; unmatched construction is demoted with its
  geometry and id intact.
- `scene-12`: snapped junction representatives must not depend on wall
  insertion order.
- `scene-20`: a preserved source hole contains a whole detected room.

`../legacy-load/` contains four levels before healing and vertical migration.
`scene-04` omits legacy slab holes; `scene-13` omits level children; `scene-16`
and `scene-22` retain stairs and their destination levels to reproduce
client-only opening writes. Their tests compare shared migrations plus additive
opening normalization with real client hydration, before/after opening-system
mount and on reload. Non-geometric furniture is omitted.
