# Pascal Home Assistant Integration

Pascal integrates with Home Assistant as a visual authoring tool plus a Lovelace viewer card.

The integration is intentionally frontend-only on the Home Assistant side. Users install a HACS dashboard card, add it to a dashboard, and load a Pascal scene artifact. No Home Assistant core changes, custom integrations, add-ons, `.storage` writes, or machine-specific bridges are required for the Lovelace viewer path.

## User Flow

1. Install the Pascal Lovelace card through HACS.
2. Open Pascal outside Home Assistant.
3. Connect Pascal to a Home Assistant instance.
4. Import Home Assistant resources into Pascal.
5. Bind devices, scripts, scenes, automations, or groups to Pascal rooms/items.
6. Export or publish a Lovelace scene artifact from Pascal.
7. Add `custom:pascal-viewer-card` to a Home Assistant dashboard.
8. Use the embedded Pascal viewer to see live Home Assistant state and call Home Assistant services.

The Pascal editor remains the authoring surface. Lovelace gets the viewer and runtime controls, not the full editor.

## Install Path

The Pascal Lovelace card is packaged as a HACS dashboard plugin.

```text
dist/pascal-viewer-card.js
hacs.json
```

Users add the Pascal repository as a HACS custom repository with category `Dashboard`, install the card, refresh the Home Assistant frontend, and add a manual Lovelace card.

Example card config:

```yaml
type: custom:pascal-viewer-card
scene_url: /local/pascal/home.scene.json
mode: overview
show_header: true
tap_action:
  action: toggle
```

The scene file is a static Pascal artifact. It can be served from Home Assistant `/local`, a user-controlled URL, or an exported inline card config when that is practical.

## Package Ownership

```text
packages/core
  Durable scene data, shared scene stores, node schemas, and pure logic.

packages/viewer
  The standalone 3D viewer, renderers, viewer systems, and viewer-safe extension points.

packages/home-assistant
  Home Assistant binding types, resource/action mapping, editor adapters,
  runtime room controls, item effects, server helpers for Pascal-side connection/import,
  and Lovelace export helpers.

packages/lovelace-card
  The Home Assistant custom card wrapper, HACS bundle, Lovelace config parsing,
  scene artifact loading, Home Assistant state/action bridge, and viewer runtime shell.

packages/editor
  Thin editor integration points that call the Home Assistant package.

apps/editor
  Next.js routes and API endpoints for the Pascal app shell.
```

Home Assistant-specific complexity should live in `packages/home-assistant` and `packages/lovelace-card`. Existing core, viewer, editor, and app files should only expose narrow extension points or call into those packages.

## Runtime Data Flow

### Authoring

Pascal connects to Home Assistant as a normal authenticated client. It discovers or imports Home Assistant resources, then stores durable bindings in the Pascal scene data.

Durable authored data includes:

- scene graph nodes
- collections and room/group structure
- Home Assistant resource bindings
- room-control presentation metadata
- portable asset references
- viewer defaults for Lovelace

Durable authored data must not include Home Assistant access tokens, local absolute machine paths, or transient live device state.

### Publishing

Pascal exports a Lovelace scene artifact:

```ts
type PascalLovelaceSceneArtifact = {
  version: 1
  scene: {
    nodes: Record<string, unknown>
    rootNodeIds: string[]
    collections?: Record<string, unknown>
  }
  homeAssistant?: {
    bindings?: unknown[]
  }
  viewer?: {
    defaultLevelId?: string | null
    defaultMode?: 'compact' | 'overview' | 'room'
    levelMode?: 'stacked' | 'exploded' | 'solo' | 'manual'
    viewMode?: '2d' | '3d'
    wallMode?: 'up' | 'cutaway' | 'down'
  }
}
```

The artifact is viewer-safe data. It is loaded by the Lovelace card and used to hydrate the Pascal scene store inside the card.

### Lovelace Rendering

Home Assistant loads `pascal-viewer-card.js` as a frontend resource. Lovelace creates `<pascal-viewer-card>`, calls `setConfig(config)`, and assigns the current `hass` object whenever Home Assistant state changes.

The card:

- loads the Pascal scene artifact
- mounts a React/R3F viewer runtime inside the custom element
- passes Home Assistant state into Pascal runtime controls
- renders Pascal room/device controls in the scene
- calls `hass.callService(domain, service, data)` for supported actions

Home Assistant remains the source of truth for live entity state. Pascal runtime state mirrors it for rendering and interaction.

## Supported Dashboard Modes

`overview`

Full-home or full-floor viewer intended for panel dashboards and wall tablets.

`room`

Focused room or collection view intended for sections dashboards next to regular Home Assistant cards.

`compact`

Smaller card footprint for state-first dashboards. The same scene artifact can be reused with less visible UI.

## Home Assistant Actions

The card uses Home Assistant's Lovelace runtime instead of a second Home Assistant login.

Typical action mapping:

- light and switch bindings call `turn_on`, `turn_off`, or `toggle`
- fan bindings call fan services and map speed/preset controls where available
- media player and TV bindings map power/media state and supported service calls
- scene, script, and automation bindings trigger the configured Home Assistant service

The action path is:

```text
Pascal control click
  -> binding/action resolver
  -> hass.callService(...)
  -> Home Assistant backend updates entity state
  -> Lovelace sends new hass object
  -> Pascal viewer updates controls and visuals
```

## Current Examples

Example Lovelace config:

```text
docs/examples/lovelace/custom-card.yaml
```

Example portable scene artifact:

```text
docs/examples/lovelace/home.scene.json
```

Build the HACS card bundle:

```bash
bun run --cwd packages/lovelace-card build:hacs
```

The Lovelace package build creates the card bundle and prepares HACS-facing release files.

## Constraints

- Do not embed the full Pascal editor in Lovelace.
- Do not require Home Assistant core changes.
- Do not require `custom_components`, add-ons, scripts, or `.storage` writes for the card path.
- Do not store Home Assistant tokens in exported scene artifacts.
- Do not hardcode local machine paths into artifacts or examples.
- Keep Lovelace-specific code out of `packages/viewer`.
- Keep editor-specific UI and stores out of the Lovelace card.
- Keep Home Assistant integration logic in `packages/home-assistant` and `packages/lovelace-card` whenever possible.

## Relationship To Floorplan Cards

Home Assistant floorplan cards usually bind entities to SVG elements and use YAML/CSS for state-dependent visuals. Pascal keeps the same core idea, but replaces the SVG/CSS surface with a Pascal scene graph and viewer runtime.

Home Assistant owns automation state and service execution. Pascal owns spatial presentation and authored bindings.
