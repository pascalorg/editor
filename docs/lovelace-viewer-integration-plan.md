# Pascal Lovelace Viewer Integration Plan

Plan date: 2026-05-03

## Goal

Build a Home Assistant Lovelace integration where Pascal-authored smart-home scenes can run inside Home Assistant dashboards as viewer-only cards.

The core user need is:

- author the home layout and HA bindings in Pascal on a laptop or desktop
- export a viewer artifact for a Home Assistant Lovelace card
- use the artifact in Lovelace as a normal dashboard card
- see realtime HA state in the Pascal viewer
- control HA entities from Pascal controls inside Lovelace
- avoid embedding the full Pascal editor in Home Assistant

## 1. Conceptual Plan

### Product Model

Pascal should act like a visual authoring tool plus runtime viewer, not like a replacement Home Assistant frontend.

The split should be:

- Pascal editor: imports HA resources, places devices, creates bindings, validates the scene, and exports the Lovelace card config.
- Pascal Lovelace card: displays the published scene, receives HA state from Lovelace, and sends HA actions back through Lovelace.
- Home Assistant: remains the source of realtime entity state, auth, service execution, dashboard layout, and mobile/tablet shell.

This is closest to a 3D, visually-authored version of picture-elements or floorplan cards.

### User-Facing Story

1. User opens Pascal outside Home Assistant.
2. User connects Pascal to Home Assistant and imports smart-home resources.
3. User visually places or verifies devices, rooms, groups, and controls.
4. User exports a Lovelace card config from Pascal.
5. User installs the Pascal Lovelace card through HACS.
6. User adds the Pascal card to a Lovelace dashboard.
7. Lovelace passes HA state into the Pascal viewer.
8. User taps Pascal controls inside the card and HA performs the action.

### Product Constraints

- The Lovelace card must not require a second Home Assistant login.
- The Lovelace card must not run the Pascal editor.
- The Lovelace card must work as a normal HA card, not only as a full-page app.
- The Lovelace card should support both wall-tablet/full-home dashboards and smaller room cards.
- The exported artifact must not contain HA access tokens or local machine paths.
- The setup should not depend on custom one-off bridges that only work on the developer machine.
- The setup must not require Home Assistant core changes, `custom_components`, add-ons, scripts inside Home Assistant, or writes to Home Assistant `.storage`.

### Non-Goals For The First Implementation

- Full scene editing inside Lovelace.
- Device import/discovery inside the Lovelace card.
- OAuth or HA authorization flow inside the card.
- Replacing Home Assistant dashboard editing.
- Generating a static picture-elements dashboard as the main product path.

## 2. Architectural Plan

### Target Modules

Use four layers with explicit ownership:

```text
packages/core
  Owns scene graph data, durable HA binding nodes, artifact schema helpers, and pure validation.

packages/viewer
  Owns the standalone 3D canvas and viewer-safe presentation primitives.
  It must remain editor-agnostic.

packages/lovelace-card
  Owns the Home Assistant custom card wrapper, Lovelace config parsing,
  artifact loading, HA state adapter, and Lovelace-specific injected systems.

packages/editor
  Owns authoring, HA import/connect UI, binding placement, validation UI,
  and the export/publish workflow.
```

The key architecture decision is that Lovelace-specific behavior should be injected into `<Viewer>` from `packages/lovelace-card`, the same way editor-specific systems are injected from the editor. The viewer should expose extension points but should not learn about Lovelace or `hass`.

### Data Ownership

Durable authored data:

- building/level/room/item scene graph
- HA binding nodes
- collection/group definitions
- default Lovelace viewer config chosen during export
- asset references

Runtime HA data:

- current entity state
- availability
- brightness, color, speed, position, mode, media state
- service call results
- transient hover/pressed/loading/error states

Runtime HA state should not mutate the authored scene graph just because an entity state changed. It should feed viewer/runtime state and visual effects.

### Published Artifact

The Pascal editor should export a scene artifact that the Lovelace card can load:

```ts
type PascalLovelaceSceneArtifact = {
  version: 1
  scene: {
    nodes: Record<string, unknown>
    rootNodeIds: string[]
    collections?: Record<string, unknown>
  }
  homeAssistant: {
    bindings: PascalLovelaceBinding[]
    entityIndex: Record<string, PascalLovelaceEntityBinding[]>
  }
  viewer: {
    defaultMode: 'overview' | 'room' | 'compact'
    defaultLevelId?: string | null
    defaultRoomId?: string | null
    viewMode: '3d' | '2d'
    levelMode?: 'stacked' | 'exploded' | 'solo' | 'manual'
    wallMode?: 'up' | 'cutaway' | 'down'
    camera?: unknown
  }
  assets: {
    baseUrl?: string
    files?: Record<string, string>
  }
}
```

The artifact should be validated before export and again before load.

### Lovelace Card Runtime

The card runtime should look like:

```tsx
<Viewer selectionManager="custom">
  <PascalLovelaceHomeAssistantSystem
    artifact={artifact}
    hass={hass}
    config={cardConfig}
  />
</Viewer>
```

The custom element receives:

- `setConfig(config)` from Lovelace
- `hass` property updates from Home Assistant

The card should convert those into:

- artifact loading
- `useScene` hydration
- viewer presentation state
- HA state adapter updates
- service calls through `hass.callService`

### Deployment Path

Phase 0: iframe proof

- Create a viewer-only route in Pascal.
- Load one exported scene artifact.
- Embed that route in HA with the webpage/iframe card.
- Use this only to prove visual fit.

Phase 1: local custom card proof

- Build `pascal-viewer-card.js`.
- Load the built card as a frontend-only custom card.
- Use inline scene config exported by Pascal.
- Display live state from `hass.states`.

Phase 2: product custom card

- Add card picker metadata.
- Add built-in config form or simple editor schema.
- Support room/overview/compact modes.
- Support HA-style actions.
- Prepare HACS distribution with root `hacs.json` and `dist/pascal-viewer-card.js`.

Phase 3: export workflow

- Add Pascal editor export UI.
- Generate inline card config, validation report, and installation notes.
- Do not write into Home Assistant config, `.storage`, or dashboard files.

Phase 4: optional hosted artifact path

- If inline card config becomes too large, add Pascal-hosted artifact URLs outside Home Assistant.
- Do not make a Home Assistant backend integration mandatory for the viewer card MVP.

## 3. Feature-Specific Plan

### Lovelace Card Modes

`overview`

- full-home or full-floor view
- intended for panel dashboards or wall tablets
- shows the complete scene or selected level
- can include floor selector and reset camera

`room`

- filters or frames one room/collection
- intended for sections dashboards next to other HA cards
- useful for kitchen, living room, garage, bedroom views

`compact`

- smaller card footprint
- prioritizes live state and the strongest controls
- may reduce camera movement, labels, and secondary overlays

### Card Configuration

Start with:

```yaml
type: custom:pascal-viewer-card
mode: overview
room: kitchen
default_level: main
view_mode: 3d
scene:
  version: 1
  scene:
    nodes: {}
    rootNodeIds: []
  homeAssistant:
    bindings: []
renderer: auto
show_header: true
show_floor_selector: true
tap_action:
  action: more-info
hold_action:
  action: toggle
```

Required:

- `scene_url`

Optional:

- `mode`
- `room`
- `default_level`
- `view_mode`
- `renderer`
- `show_header`
- `show_floor_selector`
- `tap_action`
- `hold_action`
- `double_tap_action`

The rich mapping should stay in the exported artifact. Lovelace YAML should remain small.

### Supported HA Resources

Initial device/entity types:

- lights: on/off, brightness, color where available
- switches: on/off
- fans: on/off and speed/preset when available
- media players/TVs: on/off or media power state, basic visual active state
- covers: open/closed/position
- locks: locked/unlocked
- scenes/scripts: trigger action
- automations: trigger or enable/disable depending on binding type

The card should represent unsupported or missing resources clearly instead of silently failing.

### Actions

Default behavior:

- tap: HA `more-info` or Pascal default action
- hold: toggle where safe
- double tap: optional secondary action

The card should support HA-style action objects:

- `more-info`
- `toggle`
- `perform-action`
- `navigate`
- `url`
- `assist`
- `none`

For object-specific controls, the artifact can define concrete service calls. The card-level actions should act as defaults or fallbacks.

### Viewer UI

Show:

- viewer canvas
- compact HA unavailable indicator
- optional scene/floor label
- optional floor selector
- reset camera button
- in-scene Pascal controls
- error state when scene, renderer, or HA binding fails

Do not show:

- editor sidebar
- toolbars for build/furnish/zone modes
- catalog or scene tree
- Home Assistant connect/import UI
- OAuth panel
- command palette

### Pascal Editor Export

The editor export should:

1. validate scene has HA bindings
2. validate referenced entities still exist
3. validate asset references are portable
4. validate there are no local absolute paths
5. generate inline Lovelace card artifact
6. generate Lovelace card config
7. list missing/unsupported resources
8. provide HACS install instructions
9. provide a copy/download config path

### Error And Fallback UX

Card load errors:

- missing scene file
- invalid artifact version
- schema validation failure
- missing asset base URL

HA errors:

- missing entity
- unavailable entity
- service call rejected
- action not supported by entity domain

Renderer errors:

- WebGPU unavailable
- WebGL fallback unavailable
- canvas context lost

Each should produce a compact in-card error, not a blank panel.

## 4. Low-Level Specific Plan

### Step 1: Define Artifact Schema

Add a schema/type module in a location shared by editor and Lovelace code, likely core or a new package-local shared module:

```text
packages/core/src/home-assistant/lovelace-artifact.ts
```

Include:

- TypeScript types
- version constant
- parser/normalizer
- validation result type
- migration hook for future versions

Keep it pure. No browser APIs, no Three.js, no editor imports.

### Step 2: Extract Viewer-Only Runtime

Create a runtime component that can be used by both iframe proof and custom card:

```text
packages/lovelace-card/src/pascal-viewer-runtime.tsx
```

Responsibilities:

- accept artifact and card config
- hydrate `useScene`
- set viewer mode defaults
- mount `<Viewer>`
- inject Lovelace HA system when `hass` is available
- show error/loading states around the canvas

Avoid importing `packages/editor`.

### Step 3: Create Home Assistant Adapter

```text
packages/lovelace-card/src/ha-state-adapter.ts
```

Shape:

```ts
type LovelaceHomeAssistantAdapter = {
  getState(entityId: string): HassEntity | null
  callService(domain: string, service: string, data: Record<string, unknown>): Promise<void>
  getArea?(areaId: string): unknown
  getDevice?(deviceId: string): unknown
}
```

Implementation should read from `hass.states` and call `hass.callService`.

No tokens, no HA REST client, no OAuth flow.

### Step 4: Create Lovelace Sync System

```text
packages/lovelace-card/src/pascal-lovelace-home-assistant-system.tsx
```

Responsibilities:

- build entity-to-binding lookup
- map HA states into Pascal interactive state
- update viewer-only effects
- route user interactions to adapter actions
- keep runtime state separate from authored scene state

This is integration-specific, so it should be injected as a viewer child from the Lovelace card package.

### Step 5: Build Custom Element Wrapper

```text
packages/lovelace-card/src/pascal-viewer-card.ts
```

Responsibilities:

- define `customElements.define('pascal-viewer-card', PascalViewerCard)`
- implement `setConfig(config)`
- implement `set hass(nextHass)`
- mount/unmount React root
- load artifact from `scene_url`
- expose card picker metadata through `window.customCards`
- optionally expose a simple `getConfigForm`

The wrapper can be web-component-first while internally mounting React because Pascal viewer is React/R3F.

### Step 6: Add Build Target

Add a bundle target that emits:

```text
dist/pascal-viewer-card.js
```

Requirements:

- ESM module output
- no dev server dependency
- static asset path strategy
- sourcemap in development builds
- production build suitable for HACS

### Step 7: Add Viewer-Only Route For Iframe Proof

Add an app route only for early proof:

```text
apps/editor/app/lovelace-viewer/page.tsx
```

or a route with a clearer non-editor name if the app routing supports it.

Responsibilities:

- load a scene artifact by URL
- render the same viewer-only runtime
- avoid editor panels and tools

This route is not the final product path; it is for visual proof and debugging.

### Step 8: Add Editor Export

Add export logic in editor-side code:

```text
packages/editor/src/features/home-assistant/lovelace-export/
```

Responsibilities:

- collect scene graph
- collect HA binding nodes
- generate entity index
- validate portability
- serialize artifact
- generate YAML snippet
- expose export command/button in the HA panel or scene menu

This belongs in editor because it is authoring/export UI.

### Step 9: Add Examples And Docs

Add:

```text
docs/examples/lovelace/home.scene.json
docs/examples/lovelace/iframe-card.yaml
docs/examples/lovelace/custom-card.yaml
docs/lovelace-viewer-integration-plan.md
```

Keep examples free of local machine paths and secrets.

### Step 10: Test And Proof Matrix

Unit-level checks:

- artifact parser accepts valid artifact
- artifact parser rejects missing scene/bindings/version
- HA adapter maps basic entity states
- action resolver produces expected service calls

Integration checks:

- static scene loads into viewer runtime
- custom element mounts and unmounts without leaking React roots
- `hass` updates change visible device state
- service calls route through `hass.callService`

Manual browser proof:

- localhost viewer-only route renders without editor UI
- Lovelace iframe proof renders
- Lovelace custom card renders in a sections dashboard
- Lovelace custom card renders in a panel dashboard
- card shows a useful error when scene URL is wrong
- card shows a useful error when renderer is unsupported

Compatibility proof:

- Chrome desktop
- HA mobile app or mobile browser where possible
- one wall-tablet style viewport
- WebGPU available path
- WebGL fallback or unsupported-renderer path

## Implementation Order

1. Artifact schema and validation.
2. Viewer-only runtime that can load a static artifact.
3. Iframe proof route for fast visual validation.
4. Lovelace custom element that loads static artifact.
5. HA adapter reading `hass.states`.
6. HA service-call actions.
7. Card modes: `overview`, `room`, `compact`.
8. Editor export workflow.
9. HACS-ready packaging.
10. Optional Pascal-hosted artifact path if inline scene config becomes too large.

## Acceptance Criteria

The first useful MVP is done when:

- Pascal can export a portable Lovelace scene artifact.
- Home Assistant can load `custom:pascal-viewer-card`.
- The card can load the inline artifact exported by Pascal.
- The card renders without Pascal editor UI.
- HA entity state changes are visible in the Pascal scene.
- Tapping a supported Pascal control calls the appropriate HA service through Lovelace.
- The same artifact can be used in a full panel view and a smaller sections card.
- Missing scene/entity/renderer cases show clear in-card errors.
- No local paths, HA tokens, or developer-machine bridges are required.
