# Pascal Viewer in Home Assistant Lovelace

Analysis date: 2026-05-03

## Executive Recommendation

The right product shape is:

- Pascal editor stays outside Home Assistant and remains the authoring app.
- Lovelace gets a viewer-only Pascal surface for dashboard use.
- The Lovelace viewer reads a published Pascal scene artifact and uses Home Assistant state/actions from the Lovelace runtime.
- The full editor should not be embedded in Lovelace except as a later, separate "open/edit in Pascal" flow.

That split matches both sides:

- Pascal already separates durable scene data in `@pascal-app/core`, a standalone 3D canvas in `@pascal-app/viewer`, and editor-specific tools/panels in `@pascal-app/editor`.
- Home Assistant Lovelace custom cards are web components that receive Home Assistant data and can call Home Assistant services.

The short-term proof can be an iframe to a Pascal-hosted viewer URL. The real integration should be a Lovelace custom card that wraps a viewer-only Pascal bundle.

## Why Not Embed the Full Editor

The editor is the wrong runtime for Lovelace.

The editor owns:

- scene authoring
- sidebars, tool modes, command palette, floorplan editing, selection manager, auto-save
- Home Assistant connection/import UI
- grouping and binding authoring
- keyboard/tool workflows designed for laptop/desktop use

Lovelace owns:

- dashboard layout
- current Home Assistant state
- service-call dispatch
- mobile/tablet-friendly control surfaces

Putting the full editor inside Lovelace would mix authoring with dashboard use. It would also carry a lot of UI and state that Lovelace does not need. The viewer-only embed can still render the Pascal scene, show smart-home overlays, and call Home Assistant services without exposing authoring tools.

The editor can still provide a small "Publish to Home Assistant" workflow later, but the rendered Lovelace surface should not be the editor.

## Current Pascal Fit

Pascal already has most of the required boundaries:

- `@pascal-app/core` owns the scene graph, collections, node schema, and Home Assistant binding nodes.
- `@pascal-app/viewer` exports `<Viewer />`, uses the shared `useScene` scene store, and accepts children for app-specific systems.
- `@pascal-app/editor` mounts the viewer with editor-only systems, panels, overlays, and save/load flows.
- The Home Assistant PR added durable `home-assistant-binding` nodes and editor-side room controls that can be saved with the scene.

The Lovelace work should create a new consuming shell around `@pascal-app/viewer`, not move Lovelace code into `packages/viewer` and not embed `packages/editor`.

## Home Assistant Fit

Home Assistant gives us two feasible embedding mechanisms.

### Option A: Webpage/iframe Card

Home Assistant has a webpage card with YAML like:

```yaml
type: iframe
url: https://pascal.example.com/viewer/home
aspect_ratio: 75%
```

This is the fastest proof because the Pascal viewer can keep running as a normal web app. It is useful for demos and private setups.

Limitations:

- Home Assistant does not pass the Lovelace `hass` object through the iframe.
- The iframe content needs its own Home Assistant auth/session or a backend proxy.
- LAN/remote exposure and CORS become user setup problems.
- The dashboard cannot naturally resize/configure the viewer as a native card.

Use this only as the first spike.

### Option B: Custom Lovelace Card

Home Assistant custom cards are JavaScript modules registered as Lovelace resources and implemented as custom elements. HA passes frontend data through `hass` / contexts, and cards can call services through HA's frontend API.

This is the product path:

```yaml
type: custom:pascal-viewer-card
default_level: main
view_mode: 3d
scene:
  version: 1
  scene:
    nodes: {}
    rootNodeIds: []
show_controls: true
```

The custom card should:

- load a Pascal scene artifact
- mount a viewer-only Pascal runtime
- receive Home Assistant state from Lovelace
- call Home Assistant services through `hass.callService`
- expose card sizing for sections/masonry dashboards

This gives Lovelace-native state/control without asking users to run a separate Pascal server at dashboard time.

## How Home Assistant Users Actually Use Lovelace

The useful product target is not just "can a webpage be embedded." The target is "does this feel like a normal Home Assistant dashboard surface."

Relevant Lovelace usage patterns:

1. Dashboards are built from views and cards.
   - Home Assistant users usually add cards through the dashboard editor.
   - The default layout is now sections, but masonry, panel, and sidebar layouts are still normal.
   - A Pascal viewer needs to work as both a normal resizable card and as the only card in a full-width panel view.
2. Cards are expected to display state and perform actions.
   - Built-in cards commonly expose `tap_action`, `hold_action`, and `double_tap_action`.
   - Common actions include `more-info`, `toggle`, `perform-action`, `navigate`, `url`, `assist`, and `none`.
   - Pascal should map its in-scene controls to this action vocabulary where possible instead of inventing a separate dashboard action model.
3. Floorplan users already do spatial dashboards, but with heavy manual setup.
   - The built-in picture elements card overlays entity icons, labels, images, and buttons on top of a static image.
   - `ha-floorplan` uses SVG, CSS, and YAML rules to map elements to entities and actions.
   - This is the closest existing mental model for Pascal: a spatial home card whose objects reflect HA state and trigger HA actions.
   - Pascal's difference should be that the spatial scene and entity bindings are authored visually in Pascal, then exported, rather than hand-positioned in YAML/SVG/CSS.
4. Custom cards are normal for advanced dashboards.
   - Custom cards are registered as JavaScript resources and used with `type: custom:...`.
   - HACS is the adoption path users already understand for community frontend cards.
   - Public adoption wants a HACS-ready bundle and an inline card config exported from Pascal, not a workflow that writes into HA internals.
5. Lovelace is not the place for initial account setup.
   - A dashboard card should not ask the user to discover, authorize, import, and place devices.
   - That belongs in Pascal editor or a future HA integration/config flow.
   - The card can expose lightweight card configuration: scene URL, default floor, view mode, controls, and fallback rendering mode.

This strengthens the earlier split: editor on laptop/desktop for authoring, viewer-only card in Lovelace for daily dashboard use.

## Product Shape Against Existing HA Patterns

### Compared With Picture Elements

Picture elements users create a background image and manually place state icons, labels, images, and action buttons with CSS positions.

Pascal should replace that manual layer with:

- a 3D scene exported from Pascal
- entity/resource bindings exported from Pascal
- generated default actions per resource
- viewer-controlled projection of controls into the 3D scene
- optional card config for only dashboard-level concerns

Pascal should not try to generate a picture-elements YAML file as the main product path. That would throw away the 3D viewer and reduce Pascal to a static floorplan asset generator. It could be a compatibility export later, but it should not drive the Lovelace architecture.

### Compared With `ha-floorplan`

`ha-floorplan` is a better conceptual comparison because it already has:

- a dedicated floorplan card
- one config per floorplan instance
- SVG/CSS/YAML resources
- rules connecting visual elements to Home Assistant entities
- Home Assistant actions such as service calls

Pascal should follow the same product category but move authoring out of YAML/SVG editing:

```yaml
type: custom:pascal-viewer-card
scene_url: /local/pascal/scenes/home.scene.json
default_level: main
view_mode: 3d
tap_action:
  action: more-info
hold_action:
  action: toggle
```

The Pascal card can still support per-device action overrides in the exported scene artifact. The Lovelace YAML should stay small because the rich mapping already exists in the Pascal artifact.

### Compared With Webpage/iframe Cards

The webpage card is useful only for proof:

- It can embed a Pascal-hosted viewer route.
- It supports sizing via `aspect_ratio` and background hiding.
- It does not give the embedded page the Lovelace `hass` object.
- It introduces separate auth, LAN exposure, and mixed-content constraints.

For demos, iframe is enough to answer "can Pascal visually live inside HA." For real use, iframe is the wrong state/control boundary.

### Compared With Normal Device Cards

Normal HA users often add cards by entity or by card type. They expect cards to be small, predictable, and compatible with dashboard editing.

That means Pascal should offer two card modes:

1. `overview` mode for full floor/house panel views.
2. `room` or `collection` mode for embedding one room/group as a normal card in a sections dashboard.

The second mode matters because not everyone wants a full dashboard tab consumed by Pascal. A user might want:

- kitchen Pascal card next to a thermostat card
- living room Pascal card next to media controls
- garage Pascal card next to camera and alarm cards
- full-home Pascal panel as a wall tablet view

## Updated Use Case Flow Mapping

### Flow A: Pascal-First Full Home Dashboard

1. User opens Pascal on a laptop.
2. User connects to Home Assistant.
3. Pascal imports entities, devices, areas, scripts, scenes, automations, and groups.
4. User places or confirms devices in the 3D house.
5. User chooses dashboard defaults: floor, camera, wall mode, visible controls.
6. Pascal exports:
   - inline Lovelace card config
   - HACS install instructions
7. User installs the card through HACS.
8. User adds a panel-view card in HA:

```yaml
title: Home
type: panel
cards:
  - type: custom:pascal-viewer-card
    mode: overview
    scene:
      version: 1
      scene:
        nodes: {}
        rootNodeIds: []
```

9. Lovelace passes `hass` state to the card.
10. Pascal viewer renders live state and dispatches HA actions.

### Flow B: Existing HA Dashboard With Pascal Room Cards

1. User already has a normal HA dashboard.
2. User exports one Pascal scene artifact.
3. User adds several smaller Pascal cards to sections:

```yaml
type: custom:pascal-viewer-card
scene_url: /local/pascal/scenes/home.scene.json
mode: room
room: kitchen
```

4. Each card filters the same scene to one room/collection.
5. Other HA cards remain nearby: thermostat, alarm, camera, energy, media.

This is probably the most HA-native experience because it respects the existing dashboard rather than replacing it.

### Flow C: Floorplan User Migrating From YAML/SVG

1. User already likes a floorplan dashboard but dislikes manual positioning and YAML rules.
2. Pascal imports HA entities and gives them spatial placement.
3. Pascal exports one artifact instead of many handwritten SVG/CSS/YAML rules.
4. User adds `custom:pascal-viewer-card` where their picture-elements or floorplan card used to be.
5. User only returns to Pascal when changing layout or adding visual bindings.

This should be the strongest public-facing pitch: "interactive 3D floorplan for Home Assistant, authored visually."

### Flow D: Wall Tablet / Kiosk View

1. User creates a dedicated Lovelace panel view.
2. Pascal card runs full-width/full-height.
3. Card uses a low-control UI: floor selector, home/reset view, maybe room filter.
4. In-scene controls handle device interaction.
5. Heavy editor affordances stay absent.

This flow puts pressure on performance, touch hit targets, WebGL fallback, and idle rendering.

## Recommended Architecture

### 1. Pascal Authoring App

The desktop/laptop Pascal editor remains the place where users:

1. connect to Home Assistant
2. import entities, devices, scenes, scripts, automations, and groups
3. place devices/items/rooms in the Pascal scene
4. choose smart-home room-control layout
5. save the authored scene
6. publish a viewer artifact for Home Assistant

The authoring app can provide an "Export Lovelace card config" action. The output should be pasted into a Lovelace manual card after the HACS card is installed.

### 2. Viewer Artifact

The viewer artifact should be a JSON payload derived from the Pascal scene graph:

```ts
type PascalLovelaceSceneArtifact = {
  version: 1
  scene: {
    nodes: Record<string, unknown>
    rootNodeIds: string[]
    collections?: Record<string, unknown>
  }
  homeAssistant: {
    bindings: Array<{
      collectionId: string
      resources: Array<{
        id: string
        kind: 'entity' | 'scene' | 'script' | 'automation'
        entityId?: string | null
        actions: Array<{
          domain: string
          service: string
          serviceData?: Record<string, unknown>
        }>
      }>
    }>
  }
  viewer: {
    camera?: unknown
    defaultLevelId?: string | null
    levelMode?: 'stacked' | 'exploded' | 'solo' | 'manual'
    wallMode?: 'up' | 'cutaway' | 'down'
    overlayVisibility?: {
      actions: boolean
      devices: boolean
      groups: boolean
    }
  }
  assets: {
    baseUrl?: string
    version?: string
  }
}
```

This should be viewer-safe data only. It should not include editor UI state such as active tool, command palette state, floorplan pane ratio, selected sidebar panel, or local Home Assistant OAuth tokens.

### 3. Lovelace Custom Card Shell

Create a new package or app target such as:

```text
packages/lovelace-card/
  src/pascal-viewer-card.ts
  src/pascal-viewer-runtime.tsx
  src/ha-state-adapter.ts
  src/scene-artifact-loader.ts
```

Responsibilities:

- define `customElements.define('pascal-viewer-card', PascalViewerCard)`
- implement `setConfig(config)`
- accept `hass` updates from Home Assistant
- load the scene artifact from `scene_url` or inline config
- call `useScene.getState().setScene(...)` with artifact scene data
- mount `<Viewer selectionManager="custom">` into the card
- inject a Lovelace-specific Home Assistant sync system as a viewer child

The custom element can mount a React root internally because Pascal viewer is React/R3F. That is heavier than a pure Lit card, but it preserves the existing viewer. The card wrapper itself should stay thin and web-component-compatible.

### 4. Home Assistant State Adapter

The card should not use the editor's OAuth/local-env server modules. In Lovelace, HA already knows the active authenticated user and provides state/action access.

The adapter shape should be:

```ts
type LovelaceHomeAssistantAdapter = {
  getState(entityId: string): HassEntity | null
  callService(domain: string, service: string, data: Record<string, unknown>): Promise<void>
  subscribe(callback: () => void): () => void
}
```

Implementation:

- read live entity state from `hass.states`
- map entity state into Pascal runtime control values
- call `hass.callService(domain, service, data)` for user actions
- derive labels and unavailable/error states from HA state objects

This avoids a second Home Assistant login inside Lovelace.

### 5. Viewer Runtime Sync

Add a Lovelace-only injected system:

```tsx
<Viewer selectionManager="custom">
  <PascalLovelaceHomeAssistantSystem
    artifact={artifact}
    hass={hass}
    onServiceCall={adapter.callService}
  />
</Viewer>
```

That system should:

- build a map from HA entity IDs to Pascal binding resources
- update `useInteractive` values from `hass.states`
- update viewer-only effects such as TV glow, light intensity, fan animation, lock/open state, and unavailable styling
- dispatch service calls when the user interacts with a room control

State from Home Assistant should normally remain runtime state. It should not mutate the authored scene graph just because a light turned on or a cover changed position.

## Runtime Data Flow Details

The product flows above describe how users would approach the feature. The runtime flows below describe what the software should actually do.

### Export/Install Flow

1. User opens Pascal editor on laptop/desktop.
2. User connects Pascal to Home Assistant.
3. Pascal imports HA resources and service capabilities.
4. User places or groups devices in the spatial scene.
5. User adjusts room-control pills and overlay layout.
6. User saves the Pascal scene.
7. User exports a generated Lovelace card config from Pascal.
8. User installs `custom:pascal-viewer-card` through HACS and pastes the generated config into a dashboard card.

### Card Load Flow

1. Home Assistant loads the custom card module installed by HACS.
2. Lovelace creates `<pascal-viewer-card>`.
3. HA calls `setConfig()` with the inline scene and view options.
4. The card validates and loads the scene artifact from its own config.
5. The card seeds Pascal `useScene` with the authored scene.
6. The card receives `hass` updates from Home Assistant.
7. The card maps `hass.states` into Pascal viewer runtime state.
8. The viewer renders the 3D/2D dashboard scene with live device state.

### Action/State Flow

1. User taps a Pascal room-control pill or device control in Lovelace.
2. The Lovelace system resolves the bound HA action.
3. The card calls `hass.callService(domain, service, data)`.
4. Home Assistant updates the entity state.
5. Lovelace passes a fresh `hass` object to the card.
6. The Pascal runtime sync updates control values and visual effects.

This is the same directional flow Lovelace expects: action -> HA backend -> new `hass` state -> card rerender/runtime update.

### Round Trip Editing Flow

The Lovelace viewer should have a lightweight "Edit in Pascal" affordance later, not an embedded full editor.

Possible flow:

1. User sees something wrong in Lovelace.
2. User opens a link to Pascal editor with scene ID or imported artifact.
3. User edits the scene in Pascal.
4. User republishes the artifact.
5. Lovelace reloads the scene artifact.

This keeps authoring workflows out of the dashboard.

## Information Layout Inside Lovelace

The Lovelace card should not copy the editor side panel. It should behave like a dashboard card.

Recommended layout:

- Main surface: viewer canvas.
- Optional compact header: scene name, HA unavailable indicator, view mode switch.
- In-scene controls: existing Pascal room-control pills, scaled for touch.
- Minimal bottom/edge controls: floor/level selector, reset camera, expand fullscreen.
- Error states: missing scene artifact, unsupported WebGPU, missing entities, unavailable HA services.

Recommended card modes:

- `overview`: full home/floor view for panel dashboards and wall tablets.
- `room`: one room/collection cropped or filtered for sections dashboards.
- `compact`: state-first card where the 3D view is smaller and the strongest controls remain visible.

Recommended Lovelace config surface:

```yaml
type: custom:pascal-viewer-card
scene_url: /local/pascal/scenes/home.scene.json
mode: overview
default_level: main
view_mode: 3d
renderer: auto
show_header: true
show_floor_selector: true
tap_action:
  action: more-info
hold_action:
  action: toggle
```

This mirrors HA's normal card shape: small YAML, dashboard-level options, and HA action names. The scene artifact should carry the detailed room/device binding data.

Avoid:

- full editor sidebar
- build/furnish/zone modes
- command palette
- catalog/preset panels
- scene tree
- OAuth connect flow

For a dashboard, the visible data hierarchy should be:

1. spatial layout first
2. active room/device state second
3. controls only where bound and actionable
4. configuration hidden in Lovelace card editor/YAML

## Feasibility and Risks

### Feasible Now

- A viewer-only bundle can load Pascal scene JSON and render it.
- Lovelace can host custom cards and pass current HA state.
- Existing Home Assistant binding nodes can carry the resource/action mapping.
- Existing room-control overlay logic can be reused if lifted out of editor-only dependencies.
- The first proof can use an iframe card quickly.

### Main Engineering Risks

1. Bundle size: `@pascal-app/viewer`, Three.js, R3F, and React will be large for a Lovelace card.
2. WebGPU support: Home Assistant mobile WebViews and older browsers may not support the current WebGPU viewer path.
3. React in custom elements: HA examples lean toward web components/Lit. A React-mounted custom element is possible, but must be isolated and carefully packaged.
4. Editor leakage: current HA room overlay code imports editor store/UI assumptions. The Lovelace card needs a viewer-safe or card-local control layer.
5. Asset loading: GLB/texture URLs must resolve from Home Assistant `/local`, Pascal CDN, or another trusted asset base.
6. Scene artifact versioning: published scene JSON needs a stable schema and migration story.
7. Auth/security: never put long-lived HA tokens into exported scene JSON or Lovelace card config.

### WebGPU Fallback Decision

This is the biggest feasibility question.

The current viewer creates a `THREE.WebGPURenderer`. For Lovelace, we should either:

- add a viewer prop/runtime option that allows WebGL fallback for embedded/mobile dashboards, or
- make the Lovelace card show a clear unsupported-renderer state when WebGPU is unavailable.

For adoption, WebGL fallback is likely necessary. A dashboard card that fails on common HA tablets would be hard to recommend.

## Implementation Phases

### Phase 0: Iframe Proof

Goal: prove Lovelace can display Pascal viewer content.

- Add a viewer-only route in Pascal, not the editor route.
- Render a published scene without editor panels.
- Add Lovelace `iframe` YAML.
- Let the Pascal-hosted viewer keep using its current HA connection path.

This proves visual fit but not native Lovelace integration.

### Phase 1: Viewer-Only Pascal Runtime

Goal: split a reusable viewer shell from editor.

- Create a `PascalViewerRuntime` component.
- Accept a `SceneGraph` and viewer config.
- Mount `@pascal-app/viewer` with only viewer-safe systems.
- Remove editor store/panel/tool dependencies.
- Keep HA state/control as injected adapter interfaces.

This is useful for both iframe and custom-card paths.

### Phase 2: Lovelace Custom Card MVP

Goal: native Lovelace card.

- Build `pascal-viewer-card.js` as an ESM custom element.
- Load a scene artifact from `scene_url`.
- Consume `hass.states`.
- Display live on/off/unavailable states.
- Call `hass.callService` for toggles/triggers.
- Support HA-style `tap_action`, `hold_action`, and `double_tap_action`.
- Support `overview`, `room`, and `compact` card modes.
- Support card sizing and a minimal card config form.
- Register `window.customCards` metadata so the card appears cleanly in the dashboard card picker.

First supported resources:

- lights
- switches
- fans
- media players / TVs
- covers/locks if binding data already exists

### Phase 3: Export Workflow From Pascal Editor

Goal: make it usable by normal users.

- Add "Export Lovelace viewer" in Pascal editor.
- Emit inline Lovelace card config.
- Do not copy files into HA `/config/www/pascal`, write `.storage`, or require scripts inside Home Assistant.
- Validate missing assets/entities before export.
- Provide a preview of what the Lovelace card will render.

### Phase 4: Native HA Install Path

Goal: reduce manual setup.

- Package a HACS-ready dashboard/frontend card.
- Include `hacs.json`, root `dist/pascal-viewer-card.js`, and clear HACS custom-repository instructions.
- Keep the product path frontend-only; no HA custom integration is required for this step.
- Add documentation for Pascal CDN assets and inline scene config.
- Add migration/versioning for scene artifacts.

## Decision Matrix

| Path | Feasibility | Setup burden | Native HA state/control | Good for |
|---|---:|---:|---:|---|
| Iframe to Pascal-hosted viewer | High | Medium | Low | quick demo |
| Custom Lovelace card wrapping viewer | Medium | Medium | High | product path |
| Full editor in Lovelace | Low | High | Medium | not recommended |
| Custom HA panel | Medium | High | High | later fullscreen dashboard |

## Concrete First Slice for `dev-lovelace`

The first code-bearing slice should be:

1. Add a viewer-only route or package component that can render a scene artifact without editor panels.
2. Export one current HA-bound Pascal scene as `docs/examples/lovelace/home.scene.json` or similar.
3. Add a minimal iframe Lovelace YAML example for visual proof only.
4. Add a custom-card technical spike that mounts the viewer and reads a static scene JSON.
5. Add a minimal card config schema with `scene_url`, `mode`, `room`, `default_level`, `view_mode`, and `renderer`.
6. Only after that, wire live `hass.states`, HA-style actions, and `hass.callService`.

The first slice should not try to embed editor tools, scene tree, OAuth setup, or device-import UI in Lovelace.

## Open Questions

- Should the Lovelace card bundle React and R3F directly, or should we first expose a smaller viewer web component from Pascal?
- Do we need a WebGL fallback before any public Lovelace card can be considered usable?
- When inline scene config becomes too large, should artifacts move to Pascal cloud or user-hosted static files?
- Should export overwrite one artifact, version artifacts by scene ID, or keep multiple named scenes?
- How should card configuration select a default floor/view/camera when the user has a large multi-level Pascal scene?
- Which controls should be visible on mobile versus wall-tablet dashboards?

## Source Notes

- Home Assistant dashboards are views made of cards; cards are added through the dashboard UI and can be resized/configured depending on layout: https://www.home-assistant.io/dashboards/cards/
- Home Assistant views include sections, masonry, panel, and sidebar layouts; panel views are intended for one full-width card such as a map or image: https://www.home-assistant.io/dashboards/views/
- Home Assistant actions define tap, hold, and double-tap behavior with action types such as `more-info`, `toggle`, `perform-action`, `navigate`, `url`, `assist`, and `none`: https://www.home-assistant.io/dashboards/actions/
- Home Assistant picture elements cards show how spatial dashboards are commonly built from a background image plus positioned entity icons, labels, buttons, and actions: https://www.home-assistant.io/dashboards/picture-elements/
- Home Assistant custom cards are custom elements and can be registered as Lovelace resources: https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/
- Home Assistant custom cards can use `hass-action` to reuse the standard card action model: https://developers.home-assistant.io/blog/2023/07/07/action-event-custom-cards/
- Home Assistant frontend data is provided through `hass` and contexts such as states, devices, areas, floors, and auth: https://developers.home-assistant.io/docs/frontend/data/
- Home Assistant frontend data flow uses WebSocket/REST and passes `hass` down to components: https://developers.home-assistant.io/docs/frontend/architecture/
- Home Assistant resources under `/local` come from `<config>/www`: https://developers.home-assistant.io/docs/frontend/custom-ui/registering-resources/
- Home Assistant webpage cards can embed external pages by iframe: https://www.home-assistant.io/dashboards/iframe/
- `ha-floorplan` is the closest existing custom-card mental model: one floorplan configuration can live in YAML or a separate file, maps visual elements to entities, and performs HA actions: https://experiencelovelace.github.io/ha-floorplan/docs/usage/
- `ha-floorplan` recommends HACS for installation and documents the manual JS-file/resource path as the fallback: https://experiencelovelace.github.io/ha-floorplan/docs/quick-start/
- HACS publishing requires a public GitHub repository, README, topics/description, and `hacs.json`; releases are preferred for versioned distribution: https://hacs.xyz/docs/publish/start/
