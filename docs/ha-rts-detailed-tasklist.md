# HA + RTS Detailed High-Level Task List

## Purpose

This file is the execution task list derived from [ha-rts-architecture-migration-plan.md](/C:/Users/briss/.codex/worktrees/610d/editor/docs/ha-rts-architecture-migration-plan.md).

It is intentionally:

- detailed
- high-level
- dependency-aware
- organized so the work can be executed phase by phase without skipping hidden prerequisites

This file does **not** authorize a push or a PR.

Its job is to break the approved architecture plan into implementation work that can be completed and validated until the branch becomes PR-ready.

## Global Rules

- Do not push a branch because a phase is complete.
- Do not submit a PR because this task list is complete.
- Treat every phase as unfinished until its validation items pass.
- If the implementation deviates from the migration plan, update the plan first, then continue.
- If a task reveals a conflicting architecture decision, stop and resolve the document before continuing.

## Fixture-First Validation Rule

Because the current Pascal layout is not the user's real apartment and the current Home Assistant instance does not have a full real-device setup, all demo validation must be done against a **fake but real Home Assistant fixture** first.

That means:

- Home Assistant itself is real
- the imported entities/actions used for testing are fake/demo/template/helper-backed
- every feature demo must be proven against that fixture before it is shown as validated

Optional later smoke checks against a real physical device are useful, but they are not the main development loop for this migration.

## HA Sandbox Fixture

This fixture is the required Home Assistant-side test bed for the Pascal demos.

It should be created in the local Home Assistant instance and kept stable while the Pascal work is being implemented.

### Fixture Goal

Provide a deterministic set of fake HA resources that match the Pascal demo layout rooms and let us test:

- single light linking
- grouped light linking
- brightness control
- fan control
- trigger-only actions
- import refresh
- grouping behavior

### Fixture Resource Map

These are the target HA resources the Pascal demos should use.

- `light.pascal_dining_single`
  - fake dimmable light
  - used for:
    - `F3`
    - `F7`
    - `F11`
    - `F14`
- `light.pascal_dining_group`
  - fake grouped dimmable light
  - used for:
    - `F4`
    - `F8`
    - `F12`
- `fan.pascal_master_bedroom`
  - fake controllable fan
  - used for:
    - `F5`
    - `F9`
    - `F13`
- `script.pascal_living_room_demo`
  - fake trigger-only action
  - used for:
    - `F6`
    - `F15`
- `scene.pascal_living_room_evening`
  - optional second trigger-only import for scene coverage
  - used as backup/extra proof for:
    - `F6`
    - `F15`

### Recommended Fixture Construction

Build the fixture in Home Assistant using:

- helpers for raw fake state
  - `input_boolean`
  - `input_number`
  - `input_button`
- template entities for real HA-like domains
  - template `light`
  - template `fan`
- scripts/scenes for trigger-only imports
- HA `group` if grouped entity behavior needs to be exercised as an HA-side grouped control

### Fixture Creation Tasks

#### H0.1 Create helper state for the fake dining single light

Create:

- one `input_boolean` for on/off
- one `input_number` for brightness

Target output:

- helper state backing `light.pascal_dining_single`

#### H0.2 Create helper state for the fake dining grouped light

Create:

- one `input_boolean` for grouped on/off
- one `input_number` for grouped brightness

Target output:

- helper state backing `light.pascal_dining_group`

#### H0.3 Create helper state for the fake master bedroom fan

Create:

- one `input_boolean` for fan on/off
- one `input_number` for fan speed/percentage

Target output:

- helper state backing `fan.pascal_master_bedroom`

#### H0.4 Create template entities

Create:

- `light.pascal_dining_single`
- `light.pascal_dining_group`
- `fan.pascal_master_bedroom`

Requirements:

- the lights must be controllable and expose brightness
- the fan must be controllable and expose speed/percentage if supported by the template choice

#### H0.5 Create trigger-only imports

Create:

- `script.pascal_living_room_demo`
- optionally `scene.pascal_living_room_evening`

Requirements:

- at least one trigger-only HA thing must be importable without pretending to be a toggle

#### H0.6 Confirm import visibility

After fixture creation, confirm the HA import layer can surface:

- `light.pascal_dining_single`
- `light.pascal_dining_group`
- `fan.pascal_master_bedroom`
- `script.pascal_living_room_demo`
- optional `scene.pascal_living_room_evening`

### Fixture Completion Check

Do not count any Pascal demo as valid until:

- the fixture exists in HA
- the import route can see the fixture resources
- the fixture resources are stable enough to be reused across demos

## Editor Demo Contract

Every feature in this task list must be verifiable inside the Pascal editor, on the default layout map currently served by:

- `apps/editor/app/api/default-layout/route.ts`
- backing file: `C:\Users\briss\Downloads\layout_2026-04-08.json`

Every validation slice must be:

- demonstration-ready in the editor
- anchored to a real room/item on that layout
- no more than 4 clicks per feature

For the connect/import demos, assume these real-life prerequisites are already true before counting feature clicks:

- Home Assistant is running and reachable
- the editor is already open on the default layout
- the browser already has a valid Home Assistant login session if the connect flow redirects through HA auth
- the HA sandbox fixture described above has already been created

### Click Budget Rule

For this document:

- a click means a deliberate UI click or press on a product control
- a drag on a slider counts as one pointer action
- camera orbit/pan/zoom is not counted against the feature click budget
- keyboard shortcuts are allowed only when explicitly called out, but the preferred path is still click-first

### Demo Rooms And Item Anchors

Use these real layout anchors when validating features:

- `Dining room`
  - 3 `Ceiling Lamp` items
  - 1 `Recessed Light`
  - use for:
    - single-light link demo
    - multi-item light-group demo
    - grouped RTS placement demo
- `Kicthen`
  - note: this room is spelled `Kicthen` in the current layout data
  - 2 `Ceiling Lamp` items
  - multiple `Recessed Light` items
  - use for:
    - dense-light room demo
    - brightness/slider demo
- `Master bedroom`
  - 1 `Ceiling fan`
  - 4 `Recessed Light` items
  - use for:
    - fan link demo
    - fan RTS action demo
- `Living room`
  - 2 `Table Lamp` items
  - use for:
    - trigger-only action link demo
    - single/group placement demo when needed
- `Garage 2`
  - use for:
    - empty-room-hidden demo

For all RTS visibility demos (`F7` through `F16`), first move the camera until the named room is visible and its RTS pill can appear on screen. Camera motion is part of the real-life demo flow, but it does not count against the click budget.

For item-link demos (`F3` through `F6`, plus `F17`), first move the camera until the named item is visible and easy to click in the editor. Camera motion is part of the real-life demo flow, but it does not count against the click budget.

## Feature Validation Map

Each feature below is a mandatory editor-visible validation slice.

Unless a feature explicitly says otherwise, use the named HA sandbox fixture resources in these demos rather than ad-hoc imports.

### F1. Connect Home Assistant

Goal:

- prove the user can connect from the editor

Starting state:

- editor open on the default layout
- HA panel closed
- Home Assistant reachable
- browser already authenticated with Home Assistant if the auth redirect is used

Steps:

1. Click the Home Assistant entry point in the editor shell.
2. Click `Connect Home Assistant`.

Expected result:

- connection status becomes connected
- import controls become available
- the connection targets the single linked HA instance configured through the panel URL fields, not a multi-instance picker

Click budget:

- 2 clicks

### F2. Refresh Imports

Goal:

- prove the user can fetch current HA imports

Starting state:

- HA panel already open
- HA already connected

Steps:

1. Click `Refresh imports`.

Expected result:

- imported HA rows refresh in place
- no scene data is mutated just by refreshing
- the refreshed list includes the sandbox fixture rows:
  - `light.pascal_dining_single`
  - `light.pascal_dining_group`
  - `fan.pascal_master_bedroom`
  - `script.pascal_living_room_demo`

Click budget:

- 1 click

### F3. Link One HA Light To One Pascal Item

Goal:

- prove one imported HA entity can be linked to one Pascal item

Layout anchor:

- one `Dining room` `Ceiling Lamp`

Starting state:

- HA panel open
- imports loaded
- use the imported row `script.pascal_living_room_demo`
- use the imported row `fan.pascal_master_bedroom`
- use the imported row `light.pascal_dining_group`
- use the imported row `light.pascal_dining_single`

Steps:

1. Click one `Dining room` ceiling lamp in the editor.
2. Click the direct link action on one imported light row.

Expected result:

- a collection is created or updated
- the selected lamp is now represented by that collection

Click budget:

- 2 clicks

### F4. Link One HA Light To A Multi-Item Pascal Group

Goal:

- prove one imported HA entity can be linked to a group of Pascal items

Layout anchor:

- 3 `Dining room` `Ceiling Lamp` items

Starting state:

- HA panel open
- imports loaded

Steps:

1. Click the left `Dining room` ceiling lamp.
2. `Ctrl`+click the middle `Dining room` ceiling lamp.
3. `Ctrl`+click the right `Dining room` ceiling lamp.
4. Click the direct link action on one imported light row.

Expected result:

- one collection represents the selected lamp group
- that group can later render as one RTS control centered on the group

Click budget:

- 4 clicks

### F5. Link One HA Fan To One Pascal Fan

Goal:

- prove a fan-capable HA entity can be linked cleanly

Layout anchor:

- `Master bedroom` `Ceiling fan`

Starting state:

- HA panel open
- imports loaded

Steps:

1. Click the `Master bedroom` ceiling fan.
2. Click the direct link action on one imported fan row.

Expected result:

- a collection is created or updated for the ceiling fan
- the collection exposes fan-appropriate control capability

Click budget:

- 2 clicks

### F6. Link One Trigger-Only HA Action

Goal:

- prove a script/scene/automation-style import can be linked even when it is not an on/off entity

Layout anchor:

- one `Living room` `Table Lamp`

Starting state:

- HA panel open
- imports loaded

Steps:

1. Click one `Living room` table lamp.
2. Click the direct link action on one imported script, scene, or automation row.

Expected result:

- a trigger-only collection is created or updated
- the collection can later render as an action tile instead of a persistent state tile

Click budget:

- 2 clicks

### F7. See A Single RTS Control In The Correct Place

Goal:

- prove a single-item-linked collection renders in the right spot

Layout anchor:

- the single linked `Dining room` ceiling lamp from `F3`

Starting state:

- `F3` already completed

Steps:

1. Click the `Dining room` RTS pill if the room panel is collapsed.

Expected result:

- the control appears anchored over the linked lamp position, not at an arbitrary room point

Click budget:

- 1 click

### F8. See A Grouped RTS Control In The Correct Place

Goal:

- prove a grouped collection renders at the center of its linked Pascal item group

Layout anchor:

- the 3 linked `Dining room` ceiling lamps from `F4`

Starting state:

- `F4` already completed

Steps:

1. Click the `Dining room` RTS pill if needed.

Expected result:

- the grouped control appears centered on the 3-lamp group
- it is not centered on the whole room unless that happens to be the true group center

Click budget:

- 1 click

### F9. See A Fan RTS Control In The Correct Place

Goal:

- prove a fan-linked collection renders at the fan location

Layout anchor:

- the linked `Master bedroom` ceiling fan from `F5`

Starting state:

- `F5` already completed

Steps:

1. Click the `Master bedroom` RTS pill if needed.

Expected result:

- the fan control appears at the ceiling fan location

Click budget:

- 1 click

### F10. Confirm Empty Rooms Stay Hidden

Goal:

- prove unlinked rooms do not show RTS controls

Layout anchor:

- `Garage 2`

Starting state:

- there is no linked collection for `Garage 2`

Steps:

1. Move the camera so `Garage 2` is visible.

Expected result:

- no RTS room pill or control panel appears for `Garage 2`

Click budget:

- 0 clicks

### F11. Trigger A Single Linked Light

Goal:

- prove a single linked entity-backed control can affect HA from the RTS UI

Layout anchor:

- the single linked `Dining room` lamp from `F3`

Starting state:

- `F3` and `F7` already completed
- the `Dining room` panel is still open from `F7`

Steps:

1. Click the single linked `Dining room` light control.

Expected result:

- the linked HA light action fires
- Pascal visual state updates to match the new HA-backed state

Click budget:

- 1 click

### F12. Trigger A Grouped Light Control

Goal:

- prove one grouped control affects all linked Pascal items through one HA-backed collection

Layout anchor:

- the grouped `Dining room` lamp collection from `F4`

Starting state:

- `F4` and `F8` already completed
- the `Dining room` panel is still open from `F8`

Steps:

1. Click the grouped `Dining room` control.

Expected result:

- the grouped HA-backed control fires
- all linked lamps reflect the resulting state

Click budget:

- 1 click

### F13. Trigger A Fan Control

Goal:

- prove a fan collection can execute from the RTS UI

Layout anchor:

- the linked `Master bedroom` fan from `F5`

Starting state:

- `F5` and `F9` already completed
- the `Master bedroom` panel is still open from `F9`

Steps:

1. Click the `Master bedroom` fan control.

Expected result:

- the fan HA action fires
- Pascal reflects the fan state correctly

Click budget:

- 1 click

### F14. Use A Room Slider

Goal:

- prove a slider-capable collection can be adjusted from the RTS UI

Layout anchor:

- the single linked `Dining room` light collection from `F3`

Starting state:

- `F3` and `F7` already completed
- the linked HA light from `F3` supports brightness
- the `Dining room` panel is still open from `F7`

Steps:

1. Drag the brightness slider on the linked `Dining room` light tile.

Expected result:

- the HA brightness action fires
- Pascal updates the visible intensity state

Click budget:

- 1 pointer action

### F15. Trigger A Script/Scene/Automation Tile

Goal:

- prove a trigger-only collection can execute without pretending to be an on/off entity

Layout anchor:

- the trigger-only `Living room` collection from `F6`

Starting state:

- `F6` already completed
- the trigger-only import used here is `script.pascal_living_room_demo` unless the optional scene is being used for extra coverage

Steps:

1. Click the `Living room` RTS pill.
2. Click the trigger-only RTS tile.

Expected result:

- the imported script/scene/automation action fires
- no fake persistent toggle state is required

Click budget:

- 2 clicks

### F16. Reload And Keep The Same Bindings

Goal:

- prove collection bindings survive a reload

Starting state:

- at least `F3`, `F4`, and `F5` already completed

Steps:

1. Reload the editor page.
2. Click the `Dining room` RTS pill.
3. Click the `Master bedroom` RTS pill.

Expected result:

- previously linked controls still appear
- grouped and single-item bindings are preserved

Click budget:

- 3 actions

### F17. Unlink One Existing Binding

Goal:

- prove the user can remove a binding cleanly

Layout anchor:

- one already linked `Dining room` or `Living room` item

Starting state:

- HA panel open
- at least one binding exists

Steps:

1. Click the linked Pascal item.
2. Click the `Unlink` action in the HA panel.

Expected result:

- the collection link is removed or updated appropriately
- the corresponding RTS control disappears or updates after runtime refresh

Click budget:

- 2 clicks

## Final Outcome This Task List Is Driving Toward

When all tasks here are done, Pascal should be able to:

1. connect to an existing Home Assistant instance
2. import existing Home Assistant devices and callable actions
3. let the user link imported HA things to Pascal items or groups of items
4. save those links durably through collections
5. render RTS controls from those collections
6. send all actions through one collection-based HA execution path
7. restore the same bindings after reload
8. hide empty rooms and avoid viewer-local durable grouping logic

## Work Sequence Overview

The execution order is:

0. HA sandbox fixture
1. Durable collection contract
2. HA import layer
3. Editor connect/import/link flow
4. Collection-driven RTS runtime
5. Unified HA action execution and state sync
6. Cleanup and proof

Do not reorder those phases unless the architecture plan changes.

---

## Phase 0 Task List: Provision The HA Sandbox Fixture

### Goal

Build the fake-but-real Home Assistant entities and actions needed to test the Pascal demos before showing them as validated.

### Files And Systems In Scope

- Home Assistant helper configuration
- Home Assistant template entities
- Home Assistant scripts/scenes/groups
- Pascal import route output as the verification surface

### Tasks

#### 0.1 Create the helper-backed fake state

Tasks:

- create helper state for the dining single light
- create helper state for the dining grouped light
- create helper state for the master bedroom fan
- create any trigger helper needed by the demo script

Validation:

- helper state can be changed in HA and is visible there before Pascal is involved

#### 0.2 Create the fake HA entities

Tasks:

- create `light.pascal_dining_single`
- create `light.pascal_dining_group`
- create `fan.pascal_master_bedroom`

Validation:

- all three entities exist in HA
- the lights expose brightness
- the fan exposes usable control state

#### 0.3 Create the trigger-only HA actions

Tasks:

- create `script.pascal_living_room_demo`
- optionally create `scene.pascal_living_room_evening`

Validation:

- at least one trigger-only import exists and can be manually run in HA

#### 0.4 Verify Pascal can see the fixture

Tasks:

- connect Pascal to HA
- refresh imports
- confirm the fixture rows appear in the editor import list

Validation:

- the import list includes:
  - `light.pascal_dining_single`
  - `light.pascal_dining_group`
  - `fan.pascal_master_bedroom`
  - `script.pascal_living_room_demo`

### Phase 0 Stop Conditions

Stop and fix before moving on if:

- the fixture entities do not exist in HA
- the fixture entities are not controllable enough for the demos
- Pascal cannot import the fixture rows

### Phase 0 Completion Check

- fixture exists
- fixture is controllable in HA
- Pascal import can see the fixture
- demos now have stable fake HA targets

If not all four are true, do not start Phase 1.

---

## Phase 1 Task List: Lock The Durable Collection Contract

### Goal

Make the saved Pascal scene capable of carrying the final control model safely.

### Files In Scope

- `packages/core/src/schema/collections.ts`
- `packages/core/src/schema/index.ts`
- `packages/core/package.json`
- `packages/core/src/store/use-scene.ts`
- `packages/editor/src/lib/scene.ts`
- `packages/editor/src/hooks/use-auto-save.ts`

### Tasks

#### 1.1 Finalize collection schema

File:

- `packages/core/src/schema/collections.ts`

Tasks:

- add or finalize the durable collection fields for:
  - `kind`
  - `capabilities`
  - `presentation`
  - `homeAssistant.importIds`
  - `homeAssistant.primaryImportId`
  - `homeAssistant.resourceKind`
  - `homeAssistant.aggregation`
  - `homeAssistant.serviceMap`
- ensure the schema is reference-based, not payload-based
- remove or stop using any field pattern that assumes the full imported HA payload lives in the collection
- keep `nodeIds` and `controlNodeId` as core fields

Validation:

- schema type is expressive enough for:
  - single entity-backed control
  - grouped entity-backed control
  - trigger-only action control

#### 1.2 Export the stable schema surface

Files:

- `packages/core/src/schema/index.ts`
- `packages/core/package.json`

Tasks:

- export all final schema types needed by:
  - editor code
  - app route code
  - server-side helpers
- ensure the schema import path used by server-side code is stable and safe

Validation:

- app/editor/server code can import the final schema types without going through unstable/public barrels

#### 1.3 Normalize collection storage behavior

File:

- `packages/core/src/store/use-scene.ts`

Tasks:

- normalize collections on:
  - create
  - update
  - scene load
  - scene replace/reset
- add helpers/selectors for:
  - collections by Pascal item id
  - collections by room/zone context
  - collection primary node resolution

Validation:

- collection data shape is consistent after CRUD operations
- selectors are sufficient for editor UI and RTS runtime

#### 1.4 Persist collections through the app scene graph

Files:

- `packages/editor/src/lib/scene.ts`
- `packages/editor/src/hooks/use-auto-save.ts`

Tasks:

- make app scene load/apply carry collections through
- make autosave include collections
- confirm runtime-only UI state is not included

Validation:

- save -> reload restores collections
- re-applying a scene does not lose collection data

### Phase 1 Stop Conditions

Stop and fix before moving on if:

- collections disappear on reload
- collections require embedded HA payloads to remain usable
- server/editor code still needs unstable schema import paths

### Phase 1 Completion Check

- collections persist correctly
- collections are normalized
- collections are reference-based
- this phase unlocks the data safety required before any demo features can be trusted

If not all three are true, do not start Phase 2.

---

## Phase 2 Task List: Build The Refreshable HA Import Layer

### Goal

Expose one normalized, refreshable import surface for the Home Assistant things Pascal cares about.

### Files In Scope

- `apps/editor/app/_lib/home-assistant-imports.ts`
- `apps/editor/app/_lib/home-assistant-discovery.ts`
- `apps/editor/app/_lib/home-assistant-auth.ts`
- `apps/editor/app/_lib/home-assistant-linked-profile.ts`
- `apps/editor/app/api/home-assistant/connect/route.ts`
- `apps/editor/app/api/home-assistant/connection-status/route.ts`
- `apps/editor/app/api/home-assistant/import-resources/route.ts`
- `apps/editor/app/api/home-assistant/discover-devices/route.ts`

### Tasks

#### 2.1 Normalize the import list model

File:

- `apps/editor/app/_lib/home-assistant-imports.ts`

Tasks:

- define the normalized imported resource shape used by the app
- make the import list include:
  - supported entities/devices
  - scripts
  - scenes
  - selected automations
  - supported grouped/helper resources if meaningful
- keep areas/floors/labels only as optional secondary metadata

Validation:

- import list has one consistent shape regardless of original HA source type

#### 2.2 Align discovery to the import model

File:

- `apps/editor/app/_lib/home-assistant-discovery.ts`

Tasks:

- remove item-centric or older prototype assumptions
- make discovery support the import-list builder rather than bypassing it

Validation:

- discovery output can feed normalized import building directly

#### 2.3 Keep auth/session concerns isolated

Files:

- `apps/editor/app/_lib/home-assistant-auth.ts`
- `apps/editor/app/_lib/home-assistant-linked-profile.ts`

Tasks:

- confirm these files remain auth/profile/session concerns only
- ensure no scene-level persistence leaks auth data

Validation:

- auth/session data is not serialized into collections or scene saves

#### 2.4 Make connect bootstrap imports immediately

Files:

- `apps/editor/app/api/home-assistant/connect/route.ts`
- `apps/editor/app/api/home-assistant/connection-status/route.ts`
- `apps/editor/app/api/home-assistant/import-resources/route.ts`

Tasks:

- make connect establish the session needed for imports
- make status route return what the UI needs to know if import is possible
- make import route return normalized imports only

Validation:

- connect works
- status reflects connected vs unlinked states cleanly
- import route returns normalized data once connected

#### 2.5 Remove the extra public import surface

File:

- `apps/editor/app/api/home-assistant/discover-devices/route.ts`

Tasks:

- move any remaining callers to `import-resources`
- remove this route from the final merged state

Validation:

- there is exactly one public import surface for HA resources

### Phase 2 Stop Conditions

Stop and fix before moving on if:

- imports are still split across multiple incompatible routes
- imports mutate scene data
- import responses still depend on item-level assumptions

### Phase 2 Completion Check

- connect works
- import works
- refresh works
- imports are normalized
- only one public import surface remains
- demo features unlocked:
  - `F1`
  - `F2`

If not all five are true, do not start Phase 3.

---

## Phase 3 Task List: Rebuild The Editor Around Connect -> Import -> Link

### Goal

Give the user one clean flow to bind imported HA things to Pascal items through collections.

### Files In Scope

- `packages/editor/src/lib/home-assistant-collections.ts`
- `packages/editor/src/lib/home-assistant-controls.ts`
- `packages/editor/src/lib/home-assistant-connect.ts`
- `packages/editor/src/components/ui/panels/home-assistant-panel.tsx`
- `packages/editor/src/components/editor/home-assistant-connectivity-panel.tsx`
- `packages/editor/src/components/ui/home-assistant-action-icon.tsx`
- `packages/editor/src/components/editor/floating-action-menu.tsx`
- `packages/editor/src/components/editor/node-action-menu.tsx`
- `packages/editor/src/components/editor/floorplan-panel.tsx`
- `packages/editor/src/store/use-editor.tsx`
- `packages/editor/src/components/ui/panels/panel-manager.tsx`
- `packages/editor/src/components/ui/panels/lazy-navigation-panel.tsx`

### Tasks

#### 3.1 Build the collection-binding helper layer

File:

- `packages/editor/src/lib/home-assistant-collections.ts`

Tasks:

- convert editor selection + imported HA resource into a collection update
- create collections when none exist
- update existing collections when one already represents the selected Pascal item/group
- ensure only stable HA references are written

Validation:

- linking the same HA thing twice does not create inconsistent collection state

#### 3.2 Align editor-side control helpers

Files:

- `packages/editor/src/lib/home-assistant-controls.ts`
- `packages/editor/src/lib/home-assistant-connect.ts`

Tasks:

- derive UI-facing control affordances from collection capabilities and imported resource kind
- remove item-name or item-type heuristics that bypass the collection model
- make connect/import/link helper logic point to the new flow only

Validation:

- the UI can distinguish:
  - stateful controls
  - trigger-only controls

#### 3.3 Make one main HA authoring panel

File:

- `packages/editor/src/components/ui/panels/home-assistant-panel.tsx`

Tasks:

- implement the main flow:
  - connect
  - refresh imports
  - browse imports
  - link to selected Pascal item(s)
  - create/update collection
- keep advanced metadata editing secondary

Validation:

- a user can complete the first-time flow from this panel alone

#### 3.4 Remove the duplicate HA authoring surface

File:

- `packages/editor/src/components/editor/home-assistant-connectivity-panel.tsx`

Tasks:

- move any needed behavior into the main HA panel
- remove the file from the final merged state

Validation:

- there is one HA authoring flow in the shipped editor

#### 3.5 Align HA entry points across the editor

Files:

- `packages/editor/src/components/ui/home-assistant-action-icon.tsx`
- `packages/editor/src/components/editor/floating-action-menu.tsx`
- `packages/editor/src/components/editor/node-action-menu.tsx`
- `packages/editor/src/components/editor/floorplan-panel.tsx`
- `packages/editor/src/store/use-editor.tsx`
- `packages/editor/src/components/ui/panels/panel-manager.tsx`
- `packages/editor/src/components/ui/panels/lazy-navigation-panel.tsx`

Tasks:

- make action entry points open the HA binding flow
- remove direct HA execution from UI affordances
- keep only collection-oriented ephemeral UI state
- ensure the HA panel is actually reachable in the shipped shell

Validation:

- all HA UI entry points lead into the same binding flow

### Phase 3 Stop Conditions

Stop and fix before moving on if:

- there are still two HA authoring flows
- the main panel cannot complete connect/import/link alone
- UI actions still bypass collections and target items directly

### Phase 3 Completion Check

- one main HA panel exists
- imports can be linked to Pascal selection
- collections are created/updated correctly
- duplicate HA authoring surface is gone
- demo features unlocked:
  - `F3`
  - `F4`
  - `F5`
  - `F6`
  - `F17`

If not all four are true, do not start Phase 4.

---

## Phase 4 Task List: Make RTS Runtime Fully Collection-Driven

### Goal

Make the viewer render and interact only through durable collections.

### Files In Scope

- `packages/viewer/src/systems/interactive/interactive-system.tsx`
- `packages/viewer/src/store/use-viewer.ts`
- `packages/viewer/src/store/use-viewer.d.ts`
- `packages/viewer/src/hooks/use-node-events.ts`
- `packages/viewer/src/components/viewer/selection-manager.tsx`
- `packages/editor/src/components/editor/selection-manager.tsx`
- `packages/editor/src/components/systems/zone/zone-system.tsx`
- `packages/editor/src/components/viewer-zone-system.tsx`
- `packages/editor/src/components/editor/index.tsx`
- `packages/editor/src/index.tsx`
- `packages/viewer/src/index.ts`

### Tasks

#### 4.1 Replace prototype RTS derivation with collection derivation

File:

- `packages/viewer/src/systems/interactive/interactive-system.tsx`

Tasks:

- derive room controls from collections only
- remove raw item-local control derivation as the canonical source
- support entity-backed and trigger-only collection controls

Validation:

- control tiles are explainable entirely from collection data

#### 4.2 Compute placement from Pascal geometry

File:

- `packages/viewer/src/systems/interactive/interactive-system.tsx`

Tasks:

- compute control position from linked Pascal items/groups
- do not depend on durable viewer-local placement data
- hide rooms that have no controls

Validation:

- linked single item -> correct centered button
- linked group -> correct group-centered button
- empty room -> no control shown

#### 4.3 Remove viewer-local durable grouping

Files:

- `packages/viewer/src/systems/interactive/interactive-system.tsx`
- `packages/viewer/src/store/use-viewer.ts`
- `packages/viewer/src/store/use-viewer.d.ts`

Tasks:

- remove local-storage grouping as authoritative state
- keep only runtime UI state in viewer store

Validation:

- reloading the page does not rely on local viewer state to recover the real control model

#### 4.4 Keep selection and labels clean

Files:

- `packages/viewer/src/hooks/use-node-events.ts`
- `packages/viewer/src/components/viewer/selection-manager.tsx`
- `packages/editor/src/components/editor/selection-manager.tsx`
- `packages/editor/src/components/systems/zone/zone-system.tsx`
- `packages/editor/src/components/viewer-zone-system.tsx`

Tasks:

- prevent RTS interactions from selecting underlying scene nodes accidentally
- highlight the correct linked Pascal items
- stop zone labels from competing with RTS labels

Validation:

- clicking RTS controls does not open unrelated item-selection UI
- room labels are not duplicated

#### 4.5 Clean package entrypoints

Files:

- `packages/editor/src/components/editor/index.tsx`
- `packages/editor/src/index.tsx`
- `packages/viewer/src/index.ts`

Tasks:

- keep composition/entrypoint behavior aligned with the final model
- avoid exposing prototype-only HA runtime helpers as stable API

Validation:

- package surfaces match the final runtime architecture

### Phase 4 Stop Conditions

Stop and fix before moving on if:

- RTS still depends on viewer-local durable grouping
- empty rooms still show controls
- placements are not computed from linked Pascal geometry

### Phase 4 Completion Check

- RTS is collection-driven
- placement is geometry-driven
- empty rooms are hidden
- viewer state is runtime-only
- demo features unlocked:
  - `F7`
  - `F8`
  - `F9`
  - `F10`

If not all four are true, do not start Phase 5.

---

## Phase 5 Task List: Unify Runtime Execution And HA State Sync

### Goal

Ensure every runtime action and state update follows one collection-based path.

### Files In Scope

- `apps/editor/app/_lib/home-assistant-server.ts`
- `apps/editor/app/api/home-assistant/device-action/route.ts`
- `packages/editor/src/lib/home-assistant-controls.ts`
- `packages/viewer/src/systems/interactive/interactive-system.tsx`

### Tasks

#### 5.1 Make server execution collection-only

Files:

- `apps/editor/app/_lib/home-assistant-server.ts`
- `apps/editor/app/api/home-assistant/device-action/route.ts`

Tasks:

- translate collection actions into HA service calls
- support:
  - stateful entity-backed actions
  - trigger-only actions
- remove item-direct payload handling

Validation:

- every action can be explained as:
  - RTS tile
  - collection
  - backend route
  - HA service call

#### 5.2 Align control helpers to the final action contract

File:

- `packages/editor/src/lib/home-assistant-controls.ts`

Tasks:

- align generated control intents with the final collection-action route contract

Validation:

- editor-generated control behavior matches what the backend accepts

#### 5.3 Align the viewer to the final action contract

File:

- `packages/viewer/src/systems/interactive/interactive-system.tsx`

Tasks:

- make tile interactions post only collection-action requests
- remove remaining direct HA logic from the viewer

Validation:

- viewer cannot trigger the old item-based HA path

#### 5.4 Confirm HA state flows back into Pascal cleanly

Primary files:

- `apps/editor/app/_lib/home-assistant-server.ts`
- any runtime state/helper files touched during implementation

Tasks:

- confirm HA state updates reflect into the collection-backed runtime model
- confirm Pascal visual state follows collection state

Validation:

- toggling or triggering through HA is reflected back in Pascal runtime state

### Phase 5 Stop Conditions

Stop and fix before moving on if:

- item-direct execution is still reachable
- stateful and trigger-only actions do not share the same collection path
- HA state changes do not reflect back to Pascal cleanly

### Phase 5 Completion Check

- one collection-action path exists
- old item path is gone or unreachable
- HA state updates come back into Pascal
- demo features unlocked:
  - `F11`
  - `F12`
  - `F13`
  - `F14`
  - `F15`

If not all three are true, do not start Phase 6.

---

## Phase 6 Task List: Cleanup, Documentation Alignment, And Real Proof

### Goal

Remove prototype leftovers and prove the completed flow in the real app.

### Files In Scope

- `docs/home-assistant-integration.md`
- `apps/editor/app/_components/home-assistant-connection-test.tsx`
- any remaining touched HA/RTS files with leftover prototype logic

### Tasks

#### 6.1 Align the supporting docs

File:

- `docs/home-assistant-integration.md`

Tasks:

- align background explanation with the implemented architecture
- keep the doc descriptive, not contradictory to the migration plan

Validation:

- docs no longer describe an older item-centric or payload-centric model

#### 6.2 Remove leftover prototype paths

Files:

- all remaining touched HA/RTS files that still contain transitional logic

Tasks:

- remove dead prototype code
- remove obsolete local-storage assumptions
- remove unreachable item-link compatibility
- remove duplicate HA authoring entry points
- keep auth/session data out of scene saves

Validation:

- no dead prototype path remains reachable from the shipped app

#### 6.3 Keep diagnostics out of the shipped flow

File:

- `apps/editor/app/_components/home-assistant-connection-test.tsx`

Tasks:

- keep it as dev-only diagnostics only
- ensure production flow does not depend on it

Validation:

- user-facing flow does not depend on debug/test components

#### 6.4 Run final real-world proof

Tasks:

- connect Pascal to a real HA instance
- import:
  - one real device/entity
  - one real script/scene/automation-style action
- link one imported HA thing to one Pascal item
- link one imported HA thing to multiple Pascal items
- verify the RTS control appears in the correct computed position
- trigger the control and affect the real HA-backed thing
- reload and verify bindings persist
- confirm empty rooms stay hidden
- confirm unlink/reconnect/import refresh works

Validation:

- all real-world proof items pass without manual data patching

#### 6.5 Run final technical proof

Tasks:

- run touched package typechecks
- run touched package builds
- run app route health checks
- capture real browser proof on the live app

Validation:

- all required technical checks pass

### Phase 6 Stop Conditions

Stop and fix before declaring the branch PR-ready if:

- any live HA proof fails
- any persistence proof fails
- any old path remains reachable
- any touched package typecheck/build fails

### Phase 6 Completion Check

- docs align
- prototype leftovers are removed
- real HA proof passes
- technical proof passes
- demo features revalidated:
  - `F1` through `F17`

If not all four are true, the branch is not PR-ready.

---

## Final PR-Ready Gate

The branch becomes PR-ready only when:

- Phase 0 is complete
- Phases 1 through 6 are complete
- every phase completion check passed before moving on
- the final real-world proof passed
- the final technical proof passed
- the migration plan and this task list still match the implementation

## Explicit Non-Authorization Rule

Even when every task here is complete:

- do not push the branch automatically
- do not submit a PR automatically
- do not treat task completion as merge authorization

This file defines the work needed to become ready for a later push/PR decision. It does not grant that decision.
