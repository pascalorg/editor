# Scene runtime

*Computing on a copy of the scene: detached scenes, tracked reads, deterministic ids, complete patches, and applying them with a dependency check.*

Applies to: `packages/core/src/runtime/**`, `packages/core/src/store/**` (environments, history control), `packages/core/src/systems/document-reconcile.ts`, the shared operations in `packages/core/src/agent-operations/**`, and `packages/mcp/src/bridge/**`.

A host that runs a long agent tool (a scene program, a compile, a batch of operations) does not want to hold the person's editor while it computes, nor let the computation touch the live store before it is known to fit. `@pascal-app/core/runtime` gives it a scene of its own: compute there, get a patch and the list of what was read, then apply the patch to the live scene only if nothing that was read has changed meanwhile. The runtime is library code; when and where a host applies is the host's (DECISIONS.md E-018).

## One store, one environment

Every scene store is built by `createSceneStore(environment)`. The **environment** holds what history keeps outside the store: pause depths and leases, the commit bus and its pending commit, commit node-id scopes, gesture drafts, the hydration boundary, the space-detection pause, the batched dirty-mark frame. The editor's store is `createSceneStore(liveSceneEnvironment)`.

- A store runs its actions, writes and undo inside its own environment; a function that takes a store (`pauseSceneHistory(store)`, `runAsSingleSceneHistoryStep(store, …)`) uses that store's; any other call uses the environment of the store acting, or the live one.
- So a second store never pauses, commits to, or drafts in the editor's, and `subscribeSceneCommits` at module level only ever hears the editor's commits.
- `environment.dispose()` makes every later read or write of its store throw `SceneEnvironmentDisposedError`, from actions captured earlier and from late async continuations alike.

The node and material registries stay shared. A detached scene checks the registry against the versions its `ExecutionContext` captured (`captureRegistryVersions()`, taken once the host's plugins are loaded) and refuses to open on a different one.

## A detached scene

```ts
const scene = openDetachedScene(snapshot, { base, context, ids: effectIds(effectId) })
const result = scene.execute(AGENT_OPERATIONS.add_wall, input, agentContext) // plain data
const patch = scene.patch()               // field-level SceneOperationPatch since `snapshot`
const dependencies = scene.dependencies() // what the computation read
scene.dispose()
```

- **Canonical snapshot.** `snapshot` is a document as the editor holds it (`getSceneDocument()`, or a saved draft): already migrated. `loadCanonicalSnapshot` puts it in the store as it is; no migration, healing or load-time normalisation runs again, so nothing (a level gap, an opening) changes on load.
- **Owned, read-only data.** The scene loads a deep-frozen copy of the snapshot, copies what it is given to write (host changes, bridge writes) before freezing it, and freezes every record its writes produce: nothing reached through it, a nested array of a node or a material included, can change the caller's data, the editor's store, or the baseline of its patch. Nested values already handed out stay readable after `dispose()`: they are frozen and belong to no store, so reading one is reading a copy.
- **No previews.** Inside the scene's scope (and inside `reconcileDocument`), the editor's live previews are hidden (`withoutLivePreviews`): field overrides, drag transforms and an in-flight terrain stroke. A computation reads saved state only.
- **Scope.** `scene.run(fn)` runs `fn` in the scene's environment, with its id allocator and a support index built from its own nodes. `host()` (an `AgentHostRuntime`) and `execute()` run there. Code that awaits must read and mint before its first await (as `compileAndStoreGeometryScript` does): the scope is synchronous.
- **Ids.** `generateId`, and so every schema default, reads the allocator in scope (`withIdAllocator`). `effectIds(effectId)` mints `prefix_` and 16 base-36 characters of SHA-256(`effectId:n`): recomputing an effect from the same snapshot mints the same ids, so a retried commit is idempotent. Outside a scope, ids stay random.
- **Patch.** `patch()` settles any derived writes still owed, then diffs the document against the snapshot: creates and deletes with their position among their siblings, changed and removed fields, materials, collections, plugin state. A parent's `children` is written only when its order changed beyond what the creates and deletes account for. The patch is verified by applying it to the snapshot; a root reorder, which a patch cannot express, throws.
- **Results.** Views handed out of the scene die with it; `execute` returns its result through `materialize`, a plain copy.

`liveSceneRuntime` is the editor's store behind the same `SceneRuntime` interface (plain reads, random ids), so code written against a runtime runs on either.

## Tracked reads

A detached scene's `DocumentReader` records each read as a `Dependency`:

| Read | Recorded as |
|---|---|
| `get(id)`, a field of the node it returns | `node` with the fields read (`[]`: only its presence, including an absent node) |
| `query({ entity, where })`, `queryNodes`, `queryCollections` | `query` with the ids it matched; an empty result is recorded too |
| `orderedChildren(id)`, `orderedChildIds` | `order`: where an order is consumed (a stair's riser split) |
| a collection, a material, the plugin list | `collection` (fields), `material`, `plugins` |
| a support query (slab, wall, item support) | `scope` on the level asked about: the spatial index is not visible to the reader. A level scope also covers the level's ancestors (building transform, site terrain) |
| what the store's actions plan around the changes (default gutters, ridge vents and downspouts on roof edits, merges and reference cleanup on deletions, curve clearance between walls, sanitised values) | `scope` on the level of every change that runs a planner, written or not (a disabled gutter is a decision too; a segment's planners run only on the fields they read, so a rename runs none), and on every level an unrequested write lands on (`declareActionDependencies`): the actions read the scene directly |
| a project file, an artifact | `file` / `artifact`, declared by the host (`scene.declare`) |

Rules that keep the record precise:

- **Select, don't enumerate.** Enumerating the `nodes` record records a query over every node: any node created meanwhile then conflicts. Shared operations select with `queryNodes(nodes, { type, parentId })`; a Biome rule refuses `Object.values / keys / entries` of `nodes` in `agent-operations/`, and an operation that genuinely reads the whole scene (verify_scene) says so in a `biome-ignore`.
- **Copying is not reading.** Spreading a node or collection reads all of it. Code that only carries untouched fields through to a write copies `untracked(value)`.
- **Views are per version.** `reader.nodes` is a read-only view of the current record version; identity-keyed memos (level elevations) keep working, and `reader.track(older)` views an earlier version so two versions compare by identity. `queryNodes` and `orderedChildIds` on a view select within the version it is of.
- **Order is a dependency only where it is read.** A parent's child list changed by an independent create or delete is bookkeeping (below); reading the list itself (`node.children`) records it exactly.

## Complete reconciliation

`reconcileDocument(store, before)` settles every derived write an edit owes, synchronously, to a fixed point:

1. room structure (zones, auto ceilings, floor plates) for the levels whose structure changed, as space detection derives a batch;
2. stair rises, and the floor openings stairs and elevators own, re-deriving the levels they cut;
3. the elevation of wall-supported roofs.

Levels are chosen as space detection chooses them for a commit (from the nodes the edit changed; a parent whose child list alone changed adds nothing), and each pass runs only on a change to its own inputs; the roof pass resolves only the roofs the edit can move (`roofsAffectedBy`: a changed roof or segment, the roofs on a changed wall's level and the level above; for a slab, its own level, the level below and every level above in its building; every roof when a level, building or site changed). Each scoping is tested against the complete reconciliation of the same edit. Support queries read a support index kept per store (`supportIndexOf`): slabs, walls and ceilings bulk-loaded once, then brought up to date in place from the nodes each edit changed; item collision cells are built only when a placement query asks. It never reads the editor's previews. The editor's systems (`StairOpeningSystem`, `ElevatorOpeningSystem`, `RoofElevationSystem`) plan with the same functions, so after a host settles an edit they find nothing to write; while a host settles (`runSettlingDocument`), they and space detection stand down, so derived ids are minted once, in the host's order. A runtime's `reconcile` is `reconcileDocument` reading through its reader; the MCP bridge settles every node edit with it.

## Commits

A host that edits the editor's store writes, then settles derived construction under a history pause. `runAsSettledSceneStep(store, run)` makes that one undo step and one commit: the commit carries the document as settled, with the derived nodes' ids among its changed ids, so collaboration receives the roof a wall edit moved in the same commit as the wall. `createAgentHost` and the MCP bridge write through it.

## Applying: `applyPatchWithDependencies`

```ts
const applied = applyPatchWithDependencies(current, patch, dependencies, baseDoc, external)
// { ok: true, next, patch: rebased } | { ok: false, changed: ChangedEntity[] }
```

- **Dependencies** are compared between `baseDoc` (the snapshot) and `current`: node fields and presence, query membership (absence included), order, collection fields, materials, plugins, scopes, and files and artifacts through the host's `external` lookups. Any difference is a conflict (`reason: 'dependency'`).
- **Writes**: a field the patch writes that someone changed meanwhile to another value is a conflict (`reason: 'write'`); so is deleting a node that changed.
- **Merge**: otherwise the patch lands field by field. Fields others changed on the same node or collection are kept (a rename lands beside a recolour). Children created independently under one parent each keep their place after the sibling they followed.

The result's `patch` is rebased onto `current`: what an editor applies (`applySceneOperationPatch`).

## The comparison contract

`runtime/fixture-parity.test.ts` runs every shared-tool and `add_object` fixture both ways from the same canonical snapshot, context, id seed and registry: detached, and on the editor's store with its document systems mounted. The patches and results must be identical, nothing may write after the live call returns, and the detached patch applied to the editor must land on the same document with no further write. A fixture that cannot is listed in the test's `EXCEPTIONS` with its reason; there are none today.

## MCP

`new SceneBridge({ runtime })` binds the bridge to a runtime; the default is the editor's store. The bridge reads through the runtime's reader and runs every write in its scope. Core does not import the MCP: the host opens the detached scene and constructs the bridge. `createPascalMcpServer` starts every tool handler in the scene's scope (`SceneOperations.runInScene`), and tools that await (add_object, add_column) mint their ids before the first await and re-enter the scope to plan; a custom `SceneOperations` without `runInScene` keeps unscoped, random ids.
