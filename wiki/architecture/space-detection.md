# Space Detection

*Commit and replication contract for wall-driven room reconciliation.*

Applies to: `packages/core/src/lib/space-detection.ts`, `packages/core/src/store/**`, and collaboration consumers of `SceneCommit`.

Space detection derives room state from wall geometry. Reconciliation updates wall side classifications, creates or updates automatic slabs and ceilings, and updates their level's `children`. Those derived writes are part of the wall edit that triggered them, not a later background operation.

`reconcileSceneStructure` delegates generation to `reconcileLevelStructure`. The kernel owns
zones, one floor plate per compatible connected room group, per-room ceilings, and wall sides.
Plate matching prefers shared `zoneIds`, then polygon overlap, and retains identity across
partition edits at the same elevation. Retired plate hosts are remapped in the same patch set.
Open-supported room zones are stacked intent, excluded from planar identity matching.
Their authored polygons invalidate reconciliation; their independent plates carry
protected `support` and `railing` data. The kernel clips them against wall bodies,
cuts overlapping room ceilings, and keeps wall support unchanged. See
[the vertical model](vertical-model.md#stacked-mezzanine-rooms).

Deleting an auto plate explicitly writes `hasFloor: false` on its linked zones; removing a
manual cover allows an eligible room to join a generated plate again.

User wall deletion goes through `planWallDeletion` at `deleteNodes` and the MCP bridges.
An unshared room boundary becomes a separator over the same reference-line span in the
deleting operation, preserving room identity, finishes, plate and ceiling. Shared spans
receive no separator, so reconciliation merges the adjacent rooms with the usual overlap
identity and unit remapping. Ownership excludes rooms retired by the same selection, so
surviving neighbours remain enclosed. Free wall portions disappear. Selecting all remaining
walls together (at least two wall boundaries) removes the room, contents and unshared
separators. Deleting walls individually can leave a valid separator-only terrace. Deleting
a level never preserves its rooms.

Deletion preservation requires the stored room polygon to match a current face (IoU ≥ 0.9)
and is skipped while space detection is paused. Surviving walls and separators cover spans
before replacements are added. Low-level topology replacement patches carry their own
boundary intent. MCP batches plan all deletes together, then use the store deletion machinery
for healing, registry hooks and reference cleanup. Headless owners use `planSceneNodeChanges`.
The structure kernel absorbs the covered portions of separators whenever a wall overlaps
them, so every writer shares the same open-edge replacement behavior.

Load migration runs M3, M6, M4, then M5. M4 uses the same plate generator, moves top finishes
into zone floor intent, and assigns deterministic plate IDs. M5 expands legacy `side` slots
into `edge`, `riser`, and `underside`. Zone floor finishes remain stored intent until the floor
finish renderer is delivered.

## Writers contract and the refusal guard

Derived construction is a slab or ceiling marked `boundary: 'auto'` (legacy:
`autoFromWalls: true`). Everything else states *intent* — walls, separators, and
zones with `spaceRole: 'room'` plus `floor`, `hasFloor` and `hasCeiling` — and the
reconciler derives the construction from it.

`store/derived-node-guard.ts` is the one state-aware validator. It runs at every
public mutation boundary: the scene store's `createNodes` / `updateNodes` /
`applyNodeChanges` actions, the registry `SceneApi`, and the MCP scene bridge
(`packages/mcp/src/bridge/scene-bridge.ts`, which refuses during `applyPatch`'s
dry run so a rejected batch leaves the scene untouched). It throws
`DerivedNodeWriteError`.

- **Refused for every caller**: creating a derived slab or ceiling; changing its
  `polygon`, `zoneIds` / `zoneId`, `parentId`, its derived markers, or any hole
  whose `holeMetadata.source` is `room`. Mezzanine plate `support`, `railing`,
  elevation, thickness, recess and fill are also derived; edit the zone's floor intent.
- **Allowed for every caller**: material slots and presets, a ceiling's `height`,
  hosted `children`, authored holes (`manual` / `stair` / `elevator`), and a
  plate's construction (`elevation`, `thickness`, `recessed`) — the plate builder
  promotes an edited plate elevation into the room's `floor.elevation`, so that
  gesture is intent rather than a derived write.
- **Deleting** derived construction is not refused: the store turns it into the
  room's opt-out (`hasCeiling: false` for a ceiling, `hasFloor: false` for a
  plate) in the same action, so the reconciler does not rebuild what the user
  deleted. A cascade (deleting the level) carries no intent.
- **Converting to manual** goes through `detachDerivedNode(id, data)`, the
  sanctioned command behind the boundary editors, the 2D reshape affordances and
  the manual move: it clears the derived markers and the zone link in the same
  update that carries the caller's change.

The capability is a module-private token in `derived-node-guard.ts`, never
exported from the package index and never a flag on a node or a caller-supplied
boolean. `applyStructureReconciliation` (`lib/structure-commit.ts`) is the only
holder: the browser subscriber and the MCP bridge both go through it. The other
internal writers do not cross the guarded actions at all — load migrations run
inside `setScene`, history restore is a zundo snapshot swap, and host-patch
application writes through `useScene.setState`.

`packages/core/src/store/derived-writer-allowlist.test.ts` is the CI guardrail: a
new file under any package's `src` that writes the derived markers fails unless
it is on the kernel/migration allowlist. It scans code with comments stripped, so
prose that spells a marker out verbatim trips it too.

## Local commit boundary

`initSpaceDetectionSync` must remain a synchronous scene-store subscriber. A local wall mutation and all reconciliation it triggers must finish before zundo emits the mutation's `SceneCommit` snapshot.

Reconciliation pauses scene history while applying derived writes. This keeps the triggering edit and its generated state in one undo step, while the outer tracked mutation still captures the final reconciled graph in `SceneCommit.current`. The emitted snapshot must therefore contain:

- the triggering wall edit;
- reconciled `frontSide` and `backSide` values;
- generated or updated automatic slabs and ceilings; and
- the corresponding level `children` updates.

Do not schedule reconciliation from `subscribeSceneCommits`. Commit listeners run after the snapshot boundary. Because reconciliation writes are history-paused, moving the work there would neither amend the emitted snapshot nor produce a second local commit, leaving collaboration consumers unable to transmit the generated state.

## Host patch consumption

The originating client is the only client that reconciles a local wall edit and mints IDs for generated room surfaces. Collaboration transports the resulting before/current difference, including the generated nodes and parent updates.

Receiving clients apply that transmitted graph as a host patch. Host application is history-paused and may run while the scene is read-only, so space detection must not regenerate the room locally. The receiver consumes the originator's slab and ceiling IDs and records no local undo entry or local commit for the host change.

This two-sided contract prevents peers from independently minting different IDs for the same room:

1. Local wall edit → synchronous reconciliation → one complete local commit and one undo step.
2. Host patch → apply the transmitted generated state → no local reconciliation or local history entry.

Changes to space-detection scheduling, history pausing, scene commit delivery, or host patch application must preserve both sides of this contract.
