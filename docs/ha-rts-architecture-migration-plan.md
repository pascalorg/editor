# HA + RTS Production Integration Migration Plan

## Purpose

This document is the implementation plan for the production Home Assistant + RTS integration in Pascal.

It is written to be:

- a clear development history layout
- file-by-file
- dependency-aware
- explicit enough that, if implemented one-to-one, the result should be PR-ready for `main`

This plan covers only Home Assistant and RTS control work. It does **not** cover robot/navigation features.

This plan does **not** authorize pushing a branch or submitting a pull request.

Its purpose is narrower:

- define the work required to become PR-ready
- define the evidence required to reach that state
- forbid push/PR submission before those conditions are met and separately approved

## Product Goal

The shipped product should let a person:

1. connect Pascal to the Home Assistant instance they already use at home
2. import the smart-home things they already have in Home Assistant
3. link those imported things to virtual Pascal items or item groups
4. see Pascal RTS-style controls appear automatically in the virtual house
5. click those controls to affect the real home through Home Assistant

## Core Model

There are four separate responsibilities:

- **Home Assistant**
  - owns the real devices, their current state, and real-world actions
- **Pascal scene graph**
  - owns the virtual house, rooms, and virtual items
- **Collections**
  - define what one Pascal control means
  - link imported HA things to Pascal items
- **RTS UI**
  - renders controls and handles user interaction
  - does not define durable control meaning

Short version:

- `ItemNode` = visual object in the virtual house
- `Collection` = durable Pascal control object
- Home Assistant = real smart-home truth
- RTS = runtime presentation of those controls

## What Counts As PR-Ready

This migration is only PR-ready when all of the following are true:

- Pascal can connect to a real Home Assistant instance
- Pascal can import the right first-class HA things:
  - devices/entities
  - scripts
  - scenes
  - selected triggerable automations
  - meaningful HA groupings/helpers if supported
- The imported HA list is refreshable app data, not copied wholesale into saved scene collections
- Collections are the only durable control model
- Users can link imported HA things to Pascal items or item groups through the editor UI
- RTS buttons are rendered from collections, not viewer-local grouping state
- RTS button position is computed from linked Pascal geometry
- Empty rooms do not show control panels
- Pascal uses exactly one collection-based command path to Home Assistant
- Home Assistant state flows back into Pascal and updates visible control state
- Reloading the scene preserves bindings correctly
- The old item-direct prototype path is removed or fully unreachable
- The implementation is proven against a real HA instance and a real Pascal scene

If any of those are missing, the work is **not** ready for `main`.

PR-ready in this document means:

- the implementation has reached the internal quality bar for review
- the branch is eligible for a future push and PR decision

It does **not** mean:

- push now
- open a PR now
- merge now

## Locked Decisions For This PR

To keep the implementation deterministic, these decisions are fixed for this merge:

- `Collection` remains the only durable Pascal control object
- the HA import list stays refreshable app-level data
- full imported HA payloads are not embedded into scene collections
- RTS placement is computed from Pascal geometry in this PR
- the runtime action route remains at the existing `device-action` path for this PR, but the payload and behavior become collection-only
- `packages/editor/src/components/editor/home-assistant-connectivity-panel.tsx` is removed or converted into a thin wrapper with no separate behavior so the shipped UX has one HA authoring flow
- `apps/editor/app/api/home-assistant/discover-devices/route.ts` is removed from the final merged state and `import-resources` becomes the only public import surface
- `packages/editor/src/components/ui/panels/lazy-navigation-panel.tsx` is part of this migration because the final HA panel must stay reachable in the shipped editor shell
- browser-local RTS grouping is removed as durable behavior in this PR
- demo validation is performed first against fake/demo/template/helper-backed HA resources inside a real HA instance
- physical-device smoke checks are optional extra proof, not the main development loop for this PR

## Scope Priorities

### Must be first-class in this migration

- devices/entities:
  - lights
  - fans
  - media players / TVs
  - switches
  - covers
  - climate devices
- callable HA actions:
  - scripts
  - scenes
  - selected automations
  - useful existing HA groupings/helpers

### Secondary, not blocking `main`

- areas
- floors
- labels
- manual RTS placement overrides
- deep custom service-map authoring
- dedicated standalone HA integration package extraction

Those can come later. They should not block the first production merge.

## Durable vs Refreshable vs Runtime Data

### Durable scene data

Saved with the Pascal scene:

- collections
- collection membership (`nodeIds`)
- `controlNodeId`
- collection kind/capabilities
- collection presentation metadata
- stable references to imported HA resources

### Refreshable app data

Fetched from Home Assistant and refreshed over time:

- imported HA resource list
- current labels/domains/capabilities from HA
- live entity/action state cache
- auth/session state
- discovery state

### Runtime-only UI state

Ephemeral only:

- which RTS panel is open
- hover state
- drag state
- temporary edit mode state
- overlay suppression flags

## Canonical Data Direction

### Collection

Collections remain the main Pascal control object.

Suggested direction:

```ts
type ControlCollection = Collection & {
  kind: 'device' | 'group' | 'automation'
  controlNodeId?: AnyNodeId
  zoneIds?: ZoneNode['id'][]
  capabilities: Array<'power' | 'brightness' | 'speed' | 'temperature' | 'media' | 'volume' | 'trigger'>
  presentation?: {
    label?: string
    icon?: string
    rtsOrder?: number
  }
  homeAssistant?: {
    importIds: string[]
    primaryImportId?: string
    resourceKind: 'entity' | 'scene' | 'script' | 'automation' | 'group'
    aggregation: 'single' | 'group' | 'any_on' | 'all_on' | 'trigger_only'
    serviceMap?: Record<string, { domain: string; service: string }>
  }
}
```

### Imported Home Assistant resource

This is app-side integration data, not full scene data.

```ts
type ImportedHaResource = {
  id: string
  kind: 'entity' | 'scene' | 'script' | 'automation' | 'group'
  haId: string
  domain?: string
  label: string
  capabilities: string[]
  defaultAction?: { domain: string; service: string }
}
```

Key rule:

- collections store references to imported HA things
- collections do **not** store the full imported HA payload

## Development History Layout

The safest path to a mergeable implementation is the following ordered history.

Each phase below is intended to be one logical commit group or tightly related set of commits inside the final PR.

---

## Phase 1: Lock The Durable Collection Contract

### Why this phase comes first

Nothing else is stable until the saved scene model is correct.

The editor UI, RTS renderer, and backend routes all need one durable collection shape to target.

### Files

#### `packages/core/src/schema/collections.ts`

Change:

- finalize collection fields for:
  - control kind
  - capabilities
  - presentation
  - HA reference-based binding
- remove any dependence on embedding the full imported HA payload

#### `packages/core/src/schema/index.ts`

Change:

- export the final collection and HA reference types needed by editor/app code

#### `packages/core/package.json`

Change:

- keep the package export surface aligned with the final schema import path used by editor/app/server code
- preserve server-safe schema imports for route-layer code

#### `packages/core/src/store/use-scene.ts`

Change:

- normalize collections consistently on create/update/load
- add stable selectors/helpers for:
  - collections linked to item(s)
  - collections visible in a room
  - collection primary node resolution

#### `packages/editor/src/lib/scene.ts`

Change:

- persist collections as part of the app scene graph
- preserve them on scene load/apply

#### `packages/editor/src/hooks/use-auto-save.ts`

Change:

- autosave collections
- do not autosave runtime RTS state

### Interdependencies

- Phase 2 cannot be final until this phase is correct
- Phase 3 UI should bind to this contract, not invent another one
- Phase 4 RTS runtime must read this contract directly

### Exit criteria

- collections survive save/reload
- collection updates normalize cleanly
- no full imported HA payload is required to keep a saved scene valid

### PR-readiness review after Phase 1

Still **not PR-ready**.

Why:

- no import flow yet
- no editor linking flow yet
- no runtime collection-driven RTS yet
- no live HA execution path proven yet

So continue.

---

## Phase 2: Build The Refreshable HA Import Layer

### Why this phase comes second

Once the durable binding target exists, Pascal needs a clean list of what Home Assistant currently has.

This list must be refreshable and separate from the scene file.

### Files

#### `apps/editor/app/_lib/home-assistant-imports.ts`

Change:

- normalize the import list around first-class supported things:
  - entities/devices
  - scripts
  - scenes
  - selected automations
  - useful HA groupings/helpers
- keep areas/floors/labels as optional secondary metadata only

#### `apps/editor/app/_lib/home-assistant-discovery.ts`

Change:

- support import discovery cleanly
- remove item-centric assumptions

#### `apps/editor/app/_lib/home-assistant-auth.ts`

Keep:

- auth/session only

#### `apps/editor/app/_lib/home-assistant-linked-profile.ts`

Keep:

- linked profile/session data only
- no secrets in scene data

#### `apps/editor/app/api/home-assistant/connect/route.ts`

Change:

- after connect, make the app able to fetch imports immediately

#### `apps/editor/app/api/home-assistant/connection-status/route.ts`

Keep:

- normalized connection state

#### `apps/editor/app/api/home-assistant/import-resources/route.ts`

Change:

- return the normalized import list
- clearly separate import-list data from durable scene data

#### `apps/editor/app/api/home-assistant/discover-devices/route.ts`

Change:

- remove this route from the final merged state
- move all supported import callers to `import-resources`

### Interdependencies

- Phase 3 UI depends on this import list existing
- Phase 5 action execution should target resources described by this same import model

### Exit criteria

- connect succeeds
- import route returns a normalized list of supported HA things
- refresh works without mutating the saved scene model

### PR-readiness review after Phase 2

Still **not PR-ready**.

Why:

- users still cannot cleanly link imports to Pascal objects
- RTS still does not necessarily render from collections
- execution path not unified yet

So continue.

---

## Phase 3: Rebuild The Editor Around Connect -> Import -> Link

### Why this phase comes third

Once imports and durable collections exist, the editor must let the user bind them together simply.

This is the key first-time user workflow.

### Files

#### `packages/editor/src/lib/home-assistant-collections.ts`

Change:

- make this the canonical binding helper layer between:
  - imported HA resources
  - editor selection
  - collection schema
- create/update collections using HA references only

#### `packages/editor/src/lib/home-assistant-controls.ts`

Change:

- derive UI-facing controls from imported resources + collection capabilities
- support both:
  - stateful entity-backed controls
  - trigger-only controls

#### `packages/editor/src/lib/home-assistant-connect.ts`

Change:

- reduce this to connect/import/link flow helpers
- remove item-name heuristics and old item-centric assumptions

#### `packages/editor/src/components/ui/panels/home-assistant-panel.tsx`

Change:

- make this the main UX surface:
  - `Connect Home Assistant`
  - `Refresh imports`
  - browse imported resources
  - link selected resource to selected Pascal item(s)
  - auto-create/update collection
- keep advanced controls behind a secondary layer

#### `packages/editor/src/components/editor/home-assistant-connectivity-panel.tsx`

Change:

- remove its separate authoring behavior
- move its responsibilities into `home-assistant-panel.tsx`
- remove the file from the final merged state
- the shipped HA binding flow lives in `home-assistant-panel.tsx`

#### `packages/editor/src/components/ui/home-assistant-action-icon.tsx`

Change:

- drive icons from collection/import semantics, not item-link semantics

#### `packages/editor/src/components/editor/floating-action-menu.tsx`

Change:

- open binding flow
- do not execute HA actions directly

#### `packages/editor/src/components/editor/node-action-menu.tsx`

Change:

- keep generic node action role only
- any HA entry point should open binding UI, not own business logic

#### `packages/editor/src/components/editor/floorplan-panel.tsx`

Change:

- support selecting Pascal item(s)/groups for linking
- do not become a second HA business-logic center

#### `packages/editor/src/store/use-editor.tsx`

Change:

- keep only ephemeral editor UI state
- move from item-level HA UI state to collection-oriented UI state

#### `packages/editor/src/components/ui/panels/panel-manager.tsx`

Change:

- make the HA/collection panel a first-class routed panel

#### `packages/editor/src/components/ui/panels/lazy-navigation-panel.tsx`

Change:

- keep the final HA panel reachable in the real shipped shell
- remove any temporary HA wiring that no longer matches the final panel structure

### Interdependencies

- depends on Phases 1 and 2
- Phase 4 runtime depends on the resulting collections being created cleanly

### Exit criteria

- a user can connect
- imports show up
- a selected Pascal item/group can be linked to an imported HA thing
- a collection is created/updated correctly

### PR-readiness review after Phase 3

Still **not PR-ready**.

Why:

- RTS runtime may still be using viewer-local grouping
- old runtime/action path may still exist
- live state sync still not fully proven

So continue.

---

## Phase 4: Make RTS Runtime Fully Collection-Driven

### Why this phase comes fourth

The editor can now create correct collections. The viewer must render directly from those collections and nothing else.

### Files

#### `packages/viewer/src/systems/interactive/interactive-system.tsx`

Change:

- make collections the only durable source of control meaning
- derive control tiles from collections, not raw item-local prototypes
- compute button/panel positions from linked Pascal geometry
- support:
  - entity-backed controls
  - trigger-only controls
- remove browser-local grouping as canonical state
- hide rooms that have no controls

#### `packages/viewer/src/store/use-viewer.ts`

Change:

- keep runtime-only RTS state only
- no durable grouping/control model here

#### `packages/viewer/src/store/use-viewer.d.ts`

Change:

- follow the runtime-only split

#### `packages/viewer/src/hooks/use-node-events.ts`

Change:

- ensure RTS interactions do not leak into scene selection

#### `packages/viewer/src/components/viewer/selection-manager.tsx`

Change:

- highlight collection-linked Pascal items
- do not resolve HA business rules here

#### `packages/editor/src/components/editor/selection-manager.tsx`

Change:

- coordinate selection suppression with RTS overlay use

#### `packages/editor/src/components/systems/zone/zone-system.tsx`

Change:

- keep room labels from competing with RTS control labels

#### `packages/editor/src/components/viewer-zone-system.tsx`

Change:

- same as above

#### `packages/editor/src/components/editor/index.tsx`

Change:

- compose the final systems only
- no business rules here

#### `packages/editor/src/index.tsx`

Change:

- keep package entry behavior aligned with the final HA panel/export surface
- do not expose prototype-only HA helpers as public package API

#### `packages/viewer/src/index.ts`

Change:

- keep package entry behavior aligned with the final collection-driven RTS runtime
- do not expose prototype-only HA runtime helpers as public package API

### Interdependencies

- depends on collections being created correctly in Phase 3
- depends on selection/panel state integration from editor-side files

### Exit criteria

- RTS overlays render from collections only
- no local browser storage is needed as the durable grouping model
- empty rooms do not show controls
- control placement follows linked Pascal geometry

### PR-readiness review after Phase 4

Still **not PR-ready**.

Why:

- action execution path may still be split
- HA state sync and real-world proof may still be incomplete

So continue.

---

## Phase 5: Unify Runtime Execution And HA State Sync

### Why this phase comes fifth

Now that viewer controls are collection-driven, every runtime action must go through one collection-based backend path.

### Files

#### `apps/editor/app/_lib/home-assistant-server.ts`

Change:

- keep only collection-based action execution
- translate collection actions into HA service calls
- support both:
  - stateful entity updates
  - trigger-only actions
- remove the old item-direct execution path

#### `apps/editor/app/api/home-assistant/device-action/route.ts`

Change:

- make it collection-action only
- remove old item-based payload handling
- keep the route path for this PR to reduce churn, but the semantics must be collection-only

#### `packages/editor/src/lib/home-assistant-controls.ts`

Change:

- align control generation with the final server action contract

#### `packages/viewer/src/systems/interactive/interactive-system.tsx`

Change:

- ensure tile interactions post only collection-action requests
- remove any remaining direct HA business logic from the viewer

### Interdependencies

- depends on Phase 4 runtime rendering using collections
- depends on Phase 2 import model and Phase 3 bindings

### Exit criteria

- every Pascal RTS action resolves through one collection-based backend path
- old item-direct execution cannot be triggered anymore

### PR-readiness review after Phase 5

Still **not PR-ready**.

Why:

- the code may now be architecturally correct, but it is not yet proven against real HA + real scene reload behavior
- cleanup and final verification are still required

So continue.

---

## Phase 6: Cleanup, Docs Alignment, And Real Proof

### Why this phase is last

This is the merge gate. The architecture may be correct before this phase, but it is not safe for `main` until the prototype leftovers are removed and the live flow is proven.

### Files

#### `docs/home-assistant-integration.md`

Change:

- align background integration notes with the final implemented architecture

#### `apps/editor/app/_components/home-assistant-connection-test.tsx`

Change:

- keep it as a dev-only diagnostic surface only
- remove it from the shipped user flow and from any production dependency chain

#### Any remaining touched HA/RTS files

Change:

- remove dead prototype branches, unused helpers, and obsolete local-storage assumptions
- remove unreachable item-link compatibility code
- ensure no auth/session data leaks into durable scene data
- remove duplicate HA authoring entry points if they still exist

### Required proof before merge

The final PR must prove all of the following:

1. Connect Pascal to a real Home Assistant instance
2. Import at least:
   - one fake/demo/template-backed HA device/entity inside that real HA instance
   - one fake/demo/template-backed script/scene/automation-style action inside that real HA instance
3. Link one imported HA thing to one Pascal item
4. Link one imported HA thing to multiple Pascal items
5. See the RTS control appear in the correct computed position
6. Trigger the control and affect the fake/demo/template-backed Home Assistant thing through the real HA instance
7. Refresh/reload Pascal and confirm the binding persists
8. Confirm empty rooms do not show controls
9. Confirm unlink/reconnect/import refresh still behave correctly
10. Confirm TypeScript/build checks are clean for touched packages

Optional extra proof if a real physical device is available:

- repeat one smoke test against a real HA-backed physical device such as a Chromecast

### Recommended proof set

- package typechecks
- touched package builds
- app route health checks
- real browser proof on the live app
- real Home Assistant command/state proof using the fake/demo/template-backed HA fixture
- optional extra physical-device smoke proof if one is available

### PR-readiness review after Phase 6

If all previous phases were implemented exactly as written and all proof above passes, the migration is **PR-ready for `main`**.

At that point the result should satisfy the merge bar because:

- the data model is clean
- the UI flow is clean
- the RTS runtime is collection-driven
- the execution path is unified
- the persistence model is durable
- the implementation is proven live

---

## File-by-File End State Summary

This section is the short reference for the expected final state of each file.

### Core

- `packages/core/src/schema/collections.ts`
  - final durable collection schema with HA references, not embedded HA payloads
- `packages/core/src/schema/index.ts`
  - exports final types
- `packages/core/package.json`
  - stable schema export path for app/server imports
- `packages/core/src/store/use-scene.ts`
  - canonical normalized collection store + selectors

### Editor persistence + helpers

- `packages/editor/src/lib/scene.ts`
  - persists collections
- `packages/editor/src/hooks/use-auto-save.ts`
  - autosaves collections only, not runtime RTS state
- `packages/editor/src/lib/home-assistant-collections.ts`
  - builds collection bindings from imports + selection
- `packages/editor/src/lib/home-assistant-controls.ts`
  - UI-facing control/action helpers aligned to collection model
- `packages/editor/src/lib/home-assistant-connect.ts`
  - connect/import/link helpers only

### Editor UI

- `packages/editor/src/components/ui/panels/home-assistant-panel.tsx`
  - main `Connect -> Import -> Link` UI
- `packages/editor/src/components/editor/home-assistant-connectivity-panel.tsx`
  - deleted or reduced to a thin wrapper with no separate HA behavior
- `packages/editor/src/components/ui/home-assistant-action-icon.tsx`
  - presentation-only
- `packages/editor/src/components/editor/floating-action-menu.tsx`
  - opens HA binding flow, does not execute HA directly
- `packages/editor/src/components/editor/node-action-menu.tsx`
  - generic node actions only
- `packages/editor/src/components/editor/floorplan-panel.tsx`
  - supports selection-based linking, not HA business logic ownership
- `packages/editor/src/store/use-editor.tsx`
  - ephemeral collection-oriented UI state only
- `packages/editor/src/components/ui/panels/panel-manager.tsx`
  - first-class HA panel routing
- `packages/editor/src/components/ui/panels/lazy-navigation-panel.tsx`
  - final HA panel entry point wiring in the shipped shell
- `packages/editor/src/components/editor/selection-manager.tsx`
  - selection safety only
- `packages/editor/src/components/systems/zone/zone-system.tsx`
  - room label suppression only
- `packages/editor/src/components/viewer-zone-system.tsx`
  - same
- `packages/editor/src/components/editor/index.tsx`
  - composition only
- `packages/editor/src/index.tsx`
  - stable package entrypoint with no prototype-only HA API leakage

### Viewer

- `packages/viewer/src/systems/interactive/interactive-system.tsx`
  - collection-driven RTS rendering and interaction only
- `packages/viewer/src/index.ts`
  - stable package entrypoint with no prototype-only HA runtime API leakage
- `packages/viewer/src/store/use-viewer.ts`
  - runtime-only RTS state
- `packages/viewer/src/store/use-viewer.d.ts`
  - matching runtime-only typing
- `packages/viewer/src/hooks/use-node-events.ts`
  - overlay event suppression only
- `packages/viewer/src/components/viewer/selection-manager.tsx`
  - runtime highlight/suppression only

### App shell / routes

- `apps/editor/app/_lib/home-assistant-imports.ts`
  - normalized import-list builder
- `apps/editor/app/_lib/home-assistant-server.ts`
  - collection-action to HA-service translation only
- `apps/editor/app/_lib/home-assistant-auth.ts`
  - auth/session only
- `apps/editor/app/_lib/home-assistant-discovery.ts`
  - discovery support for import model
- `apps/editor/app/_lib/home-assistant-linked-profile.ts`
  - linked profile/session only
- `apps/editor/app/api/home-assistant/connect/route.ts`
  - connection bootstrap
- `apps/editor/app/api/home-assistant/connection-status/route.ts`
  - connection health
- `apps/editor/app/api/home-assistant/import-resources/route.ts`
  - import list endpoint
- `apps/editor/app/api/home-assistant/device-action/route.ts`
  - collection-action endpoint only
- `apps/editor/app/api/home-assistant/discover-devices/route.ts`
  - removed from the final merged state
- `apps/editor/app/api/home-assistant/oauth/start/route.ts`
  - OAuth start
- `apps/editor/app/api/home-assistant/oauth/callback/route.ts`
  - OAuth callback
- `apps/editor/app/api/home-assistant/unlink/route.ts`
  - unlink without destroying scene collections
- `apps/editor/app/_components/home-assistant-connection-test.tsx`
  - dev-only diagnostic surface or removed from the final merged state

## Final Push And PR Rule

Do **not**:

- push this branch because it matches the plan
- submit a PR because the implementation is "PR-ready"
- treat PR-readiness as permission to merge

This document only defines the condition where the work becomes ready for a later push/PR decision.

A branch may be considered PR-ready only when:

- the implementation matches this document
- the proof list in Phase 6 passes
- the code and migration document are still aligned

Even then, pushing or submitting a PR remains a separate explicit decision and is outside the scope of this plan.
