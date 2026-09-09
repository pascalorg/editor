# Inline equipment insertion tracker

Created: 2026-09-09. Current completed step: **1**. Next step: **2**.

This is the working record for the plan agreed in chat. Numbering preserves steps
0–14: preparation plus fourteen implementation steps. Execute one step at a time.
For each step, record the files changed, commits, checks actually run, remaining
limitations, and whether its completion gate passed. Step 1 decisions are recorded
in the pool plugin's `docs/inline-insertion-contract.md` and
`docs/adr/0001-pressure-pipe-ownership.md`.

## Step 0: checkpoint and workspace preparation — complete

- [x] Inventory existing tracked and untracked changes in both repositories.
- [x] Create dedicated local working branches.
- [x] Commit existing work separately from insertion implementation.
- [x] Verify both repositories are clean after checkpointing.
- [x] Record package versions and the current integration artifact.
- [x] Create this persistent tracker.

| Repository | Location | Working branch | Checkpoint commit |
| --- | --- | --- | --- |
| Editor | `/Users/sudhir/.t3/worktrees/editor/t3code-d7a0092e` | `work/inline-insertion-foundation` | `f5dedcd3d5f4a7c4cff53572645cd5a092f43bdc` |
| Pool plugin | `/Users/sudhir/Desktop/work/pool-pascal-plugin` | `work/inline-insertion-pool` | `1c6935b46766ac42c13b61bc793eea878ff380bb` |

Editor original branch: `t3code/start-server-3002`, original HEAD:
`f9843713bfe917014cd3ca35ce7ddfab70eaa298`.
Pool original branch: `main`, original HEAD:
`32d143146c7d12d9b8137f0ddb2aa5fc591241c1`.
Original branches were not advanced. No commits were pushed.

The editor checkpoint contains the existing pool bootstrap/package wiring,
automatic run end caps, hanger modes, and related pipe/duct changes: 20 files.
The plugin checkpoint contains the existing build and circular pool shape/catalog
changes, including its thumbnail: 9 files. These are baseline work, not completed
insertion features. Ignored files, dependencies, and secrets are not checkpointed.

Recovery: inspect a checkpoint with `git show <commit>`. To recover its complete
tracked tree safely, create a separate worktree with
`git worktree add <new-empty-directory> <checkpoint-commit>` in that repository.
Compare later feature work against these checkpoint commits, not the old branch
tips, to exclude pre-existing changes from review.

### Dependency baseline

- Editor packages core/editor/viewer/nodes: `1.0.0-beta.5`.
- Pool plugin: `0.1.0`; development dependencies core/editor/viewer:
  `1.0.0-beta.5`.
- Editor package manager pin: Bun `1.3.14`; plugin pin and currently installed
  executable: Bun `1.3.12`. Use each repository's pin when validating it.
- Editor consumes `file:../../../pool-pascal-plugin/release-artifact/pascal-app-plugin-pool-0.1.0.tgz`
  relative to `apps/editor`. This resolves through a sibling symlink to the plugin
  repository above. Source changes there do not automatically update the tarball.
- Tarball SHA-256: `8020a06ebe4c24ad6279424cc6ac2212613d4d2a59fe71af96caf8849c5e0a56`.
- Editor lock SHA-256: `ee52ef84f0fdded062461e517682aaef1e484dc37d67b3e2463bd7c1f05e1431`.
- Plugin lock SHA-256: `4662110051af811303ddbe4ae56e3a39e4606062d78206f2a5990b5c1ff0515d`.

These are recorded versions, not a claim that runtime compatibility has been
verified. Step 0 verification was Git status, checkpoint contents, versions, and
artifact hashes. No application tests or builds were run for this preparation.

## Implementation checklist

### 1. Domain contract — complete

- [x] Define pressure pipe, inline insertion, target section, route candidate,
  hard clearance, service clearance, and generated joint in the pool glossary.
- [x] Record initial scope and pressure-pipe representation decision.
- [x] Resolve circuit versus flow-role semantics, nominal size versus physical
  diameter, fitting/socket dimensions, and equipment-specific clearance inputs.
- [x] Decide how existing pool routes using DWV nodes are recognized and handled.
- [x] Gate: domain contract, ownership, and legacy-scene behavior recorded for implementation.

### 2. Pressure-pipe support — pending

- [ ] Add pressure run/fitting schemas and registry definitions with appropriate
  sizes, materials, circuits, and fitting types; keep DWV rules separate.
- [ ] Implement drawing, ports, geometry, floor-plan output, selection, moving,
  and ghosts using the repository's current architectural contracts.
- [ ] Preserve legacy loading; do not infer conversion from proximity alone.
- [ ] Gate: draw/edit/save/reload/undo/redo work; pressure and DWV do not fuse.

### 3. Equipment port semantics — pending

- [ ] Add explicit inlet/outlet/bidirectional roles separate from socket direction.
- [ ] Configure pump, filter, heater, valve, skimmer, drain, and return inlet ports.
- [ ] Distinguish suction, return, and backwash circuits without preventing valid
  internal equipment transitions. Define behavior when flow is unknown.
- [ ] Gate: compatibility and flow assignment tests pass for every supported port.

### 4. Route search extraction — pending

- [ ] Refactor the existing plugin route search into deterministic planning.
- [ ] Return ranked candidates and structured failure reasons.
- [ ] Separate search, length/bend checks, collision checks, and scoring internally.
- [ ] Preserve the existing socket-to-socket feature as a caller.
- [ ] Gate: existing routing cases pass; ordering and diagnostics are deterministic.

### 5. Target-section acquisition — pending

- [ ] Resolve run ID, segment index, interpolation parameter, projected point,
  segment direction, and cursor distance.
- [ ] Filter incompatible/locked/wrong-level targets and exclude preview geometry.
- [ ] Handle vertices, nearby fittings, overlapping runs, and stable target retention.
- [ ] Use shared model-space results in 2D and 3D with appropriate picking adapters.
- [ ] Gate: target choice is predictable and independent of scene iteration order.

### 6. Pipe split planner — pending

- [ ] Plan two cuts while preserving the untouched multi-point path portions.
- [ ] Retain original ID on a defined side; preserve properties and parentage.
- [ ] Handle attachments, hangers, references, and existing endpoint connections.
- [ ] Reject degenerate retained spans; perform no scene mutations.
- [ ] Gate: split tests cover every section and short/endpoint/vertex cases.

### 7. Paired equipment routing — pending

- [ ] Solve inlet and outlet routes as complete pairs.
- [ ] Generate direct, L, vertical dogleg, horizontal offset, and combined offsets.
- [ ] Try valid left/right/above/below choices; rank whole assemblies.
- [ ] Keep local insertion separate from the existing underground-route policy.
- [ ] Gate: supported feasible fixtures yield valid pairs; bounded search failures
  do not claim that no possible route exists.

### 8. Exact fitting materialization — pending

- [ ] Convert candidate paths to real fitting and straight-section nodes.
- [ ] Derive trimming from registered socket positions and fitting takeout.
- [ ] Validate permitted reducers and exact joint coincidence/direction.
- [ ] Reject zero/negative lengths; stabilize candidate IDs without per-frame
  persistent node creation.
- [ ] Gate: preview and commit use the same resolved members and joints.

### 9. Collision and clearance validation — pending

- [ ] Implement broad-phase filtering and detailed volume checks.
- [ ] Check pipes, elbows, equipment, retained target spans, scene obstacles,
  paired routes, and non-adjacent members against one another.
- [ ] Permit only intended socket contact; model service envelopes separately.
- [ ] Specify hidden-object and unavailable-geometry policies explicitly.
- [ ] Gate: obstacle, self-collision, short-riser, blocked-approach, and valid joint
  fixtures pass. Unknown clearance must not be reported as validated.

### 10. First usable slice: two-way valve — pending

- [ ] Implement same-elevation insertion during new placement and unconnected moves.
- [ ] Show target highlight, removed interval, cuts, equipment, and connection ghosts.
- [ ] Provide valid/invalid feedback and route cycling; reconcile keyboard bindings
  with the host's current interaction scope and snapping rules.
- [ ] Match 2D and 3D behavior; enforce one owner for preview and commit.
- [ ] Revalidate affected scene inputs before committing the exact selected plan.
- [ ] Gate: one undo/redo covers the whole insertion; cancel changes no scene/history.

### 11. Height-aware valve routing — pending

- [ ] Enable above/below insertion with actual elbow takeout and minimum riser length.
- [ ] Expose valid side choices without silently moving equipment.
- [ ] Gate: above/below, blocked-side, wall, and insufficient-height fixtures pass
  in both views, with elevation feedback in floor plan.

### 12. Heater insertion — pending

- [ ] Assign inlet/outlet correctly, including close ports on the same equipment face.
- [ ] Enforce paired-route separation, socket approaches, and service clearance.
- [ ] Explain wrong-circuit and unresolved-flow cases; preview flow when known.
- [ ] Gate: equal/different heights, flipped poses, and alternative routes work.

### 13. Moving connected equipment — pending

- [ ] Implement the registered equipment move interaction.
- [ ] Define the exact editable route extent and stop at branches or ambiguous joints.
- [ ] Preview reroutes for all occupied ports while preserving the original scene.
- [ ] Commit pose and route replacements atomically; reject invalid releases safely.
- [ ] Gate: move/cancel/undo/redo/save/reload preserve connectivity and unrelated work.

### 14. Advanced assemblies — pending

- [ ] Three-way valve branch insertion with explicit port selection.
- [ ] Pump-specific straight approaches from supported equipment data.
- [ ] Filter backwash routing.
- [ ] Manufacturer-defined heater bypass templates.
- [ ] Explicit route validation after equipment or obstacle edits.
- [ ] Evaluate persisted joint identity only if evidence warrants a schema change.
- [ ] Gate: each assembly has its own acceptance fixtures and verified UI behavior.

## Shared acceptance rules

- Planning and hover never mutate saved nodes.
- Both new connections are checked together.
- Preview geometry and committed geometry agree.
- Failed or stale plans cannot partially commit.
- Unrelated scene geometry stays unchanged; no automatic structure cuts.
- One edit produces one undoable scene transaction.
- Apply applicable behavior in both 2D and 3D in the same feature slice.
- Hydraulic sizing, pump selection, and construction certification are outside
  the initial insertion scope; catalog constraints must identify their source.
- Unit tests exercise planner outcomes; integration tests exercise real scene
  transactions and connectivity. Browser coverage is a known existing gap and
  must be recorded honestly until a host fixture or manual QA pass covers it.
- Record performance against representative crowded scenes before choosing a
  search budget; distinguish budget exhaustion from proven invalid geometry.

## Progress log

### 2026-09-09 — step 0

Created the two working branches and checkpoint commits listed above. Captured
all 20 editor and 9 plugin changed/untracked files in their respective snapshots.
Verified both worktrees were clean after checkpointing. Added this tracker.
Next implementation unit at that point was step 1.

### 2026-09-09 — step 1

Completed the domain contract in the pool plugin:

- `CONTEXT.md`: plumbing glossary.
- `docs/inline-insertion-contract.md`: scope, circuits, flow, dimensions,
  connectivity, clearance, transaction behavior, legacy handling, and acceptance cases.
- `docs/adr/0001-pressure-pipe-ownership.md`: accepted ownership decision.
- `docs/README.md` and `docs/pool-pipe-routing.md`: discovery links and distinction
  between current runtime behavior and the implementation contract.

Decisions: separate generic host pressure-pipe kinds; pool-specific circuits and
equipment rules in the plugin; explicit distinction between socket direction and
flow; declared size profiles rather than guessed metric/imperial matches; strict
generated-joint checks; both connections planned together; hidden physical objects
still block routes; explicit legacy conversion without load-time reinterpretation.
Original run ID remains on the path-start side, independent of flow direction.

Verification: `git diff --check` passed. Plugin `bun run check-docs` reported only
the existing missing `circle` entry in `docs/node-reference.md`, associated with
the pool-shape work. It reported no missing local links or headings. No application
tests/builds or browser checks were run because this step changes documentation.
Numerical manufacturer constraints remain for catalog implementation and source
verification; this contract introduces no claimed manufacturer requirements.

Workspace drift: the plugin checkout is now on `main` at `32d1431`, with existing
pool-shape changes, rather than the step 0 feature branch. Step 1 plugin documents
are deliberately left uncommitted there. Before step 2 edits the plugin, inspect
its state again and isolate feature work without overwriting those changes. The
editor remains on `work/inline-insertion-foundation`; this tracker is committed there.

Completion gate: passed for the documented contract. Runtime support is pending.
Next step: 2, generic pressure-pipe support in the host.

### Future step record template

- Step/status:
- Decisions:
- Files and commits:
- Checks run and results:
- Manual 2D/3D verification:
- Remaining limitations or blockers:
- Completion gate:
- Next step:
