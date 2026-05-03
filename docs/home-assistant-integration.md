# Pascal x Home Assistant

Research date: 2026-04-15

## Goal

Understand how Home Assistant works, how the `ha-floorplan` "Floorplanner Home" example is put together, and what the clean replacement path looks like for Pascal's 2D/3D editor.

## What Home Assistant Is

Home Assistant (HA) is a home automation platform with three parts that matter here:

1. A backend that owns entities, states, attributes, automations, and services.
2. A frontend that renders dashboards and panels.
3. APIs that let clients read live state and call services.

For a Pascal integration, HA is not the renderer. It is the source of truth for automation state and the command target for actions such as `light.turn_on`, `light.toggle`, `fan.set_percentage`, or `climate.set_temperature`.

## How the `ha-floorplan` Example Works

The reference example at `https://experiencelovelace.github.io/ha-floorplan/docs/example-floorplanner-home/` is fundamentally a binding layer between HA entities and SVG elements:

- The background is an SVG exported from Floorplanner.
- YAML maps HA entities like `light.kitchen` to SVG element ids like `area.kitchen`.
- `tap_action` triggers HA services such as `light.toggle`.
- `state_action` mutates presentation by setting CSS classes or text.
- CSS turns those classes into visual behavior like room glow, fan spin, and temperature labels.

That means `ha-floorplan` is mostly:

1. Entity-to-element mapping.
2. Live state subscription.
3. Service-call dispatch on interaction.
4. CSS-driven visual state.

The Pascal replacement should preserve those four capabilities, but use Pascal's scene graph and render systems instead of SVG + CSS as the visual layer.

## Relevant Pascal Extension Points

### 1. Arbitrary node metadata already exists

`packages/core/src/schema/base.ts` defines `BaseNode.metadata` as JSON. This is the easiest place to attach HA bindings such as:

```ts
{
  ha: {
    entityId: "light.kitchen",
    tapAction: { domain: "light", service: "toggle" },
    presentAs: "room-light"
  }
}
```

The repo already uses metadata for runtime visual state (`navigationMoveVisual`), so HA mapping fits the existing pattern.

### 2. Item interactivity is already modeled

`packages/core/src/schema/nodes/item.ts` already supports:

- interactive controls: `toggle`, `slider`, `temperature`
- interactive effects: `animation`, `light`

This is a strong fit for HA entities:

- `light.*` -> toggle + brightness slider + light effect
- `fan.*` -> toggle + spinning animation
- `climate.*` -> temperature control
- `switch.*` -> toggle

### 3. Runtime control state already exists

`packages/core/src/store/use-interactive.ts` stores per-item control values at runtime.

Today those values are local UI state. For HA, the same store can become the view-model that is driven by HA entity state and also pushes service calls back to HA when the user interacts.

### 4. Viewer systems already render interactive behavior

The viewer already contains the main pieces needed for visual feedback:

- `packages/viewer/src/systems/interactive/interactive-system.tsx`
  Renders in-scene controls for interactive items.
- `packages/viewer/src/systems/item-light/item-light-system.tsx`
  Converts interactive light effects into actual Three.js point lights.
- `packages/viewer/src/components/renderers/item/item-renderer.tsx`
  Applies animation and light registrations based on interactive effects.
- `packages/viewer/src/hooks/use-node-events.ts`
  Emits click, move, enter, leave, context-menu, and double-click events for nodes.

This means Pascal already has most of the "visual reaction" side of a HA floorplan replacement.

### 5. Pascal already has a native 2D floorplan surface

`packages/editor/src/components/editor/floorplan-panel.tsx` is important. Pascal does not need SVG to offer a floorplan view; it already has a first-party 2D floorplan representation tied to the scene graph.

That gives us two possible presentation modes:

- 2D floorplan view backed by Pascal geometry.
- 3D viewer backed by Pascal geometry.

Both can point at the same HA entity bindings.

### 6. Packaging matters

The repo is split in a useful way:

- `@pascal-app/core` and `@pascal-app/viewer` are reusable packages.
- `@pascal-app/editor` is closer to the product shell and expects a Next/React environment.
- `apps/editor` is the full Next.js app.

This matters because Home Assistant frontend extensions are web-component oriented, while Pascal is React/Next based. Reusing `core` + `viewer` is easier than trying to inject the full app shell into Lovelace immediately.

## How HA Relates to Pascal

The clean mental model is:

- HA owns device truth.
- Pascal owns spatial truth.
- A mapping layer joins them.

More concretely:

- HA entity ids map to Pascal nodes, zones, rooms, or items.
- HA state changes update Pascal runtime state.
- Pascal interactions call HA services.
- Pascal renderers translate HA state into 2D/3D visuals.

So Pascal is not replacing Home Assistant. Pascal is replacing the rendering/binding approach used by SVG-based floorplans.

## Chosen Integration Path

The plan is Solution A only:

- Pascal runs as its own app.
- Home Assistant runs as the server.
- Pascal connects to HA the same way the official phone app conceptually does: as an authenticated client of the HA instance.

Transport plan:

- WebSocket API for live entity updates.
- REST or WebSocket service calls for commands.

Why this is the active plan:

- It matches the current React/Next architecture.
- It lets us reuse `@pascal-app/core` and `@pascal-app/viewer` with minimal HA-specific shell code.
- It avoids any dependency on Lovelace or HA frontend packaging.
- It is enough to prove replacement parity with `ha-floorplan`.

Out of scope for this phase:

- embedding Pascal as a Home Assistant panel
- embedding Pascal as a Lovelace card

## Recommended Architecture

### 1. Add an HA binding schema on top of node metadata

Start with metadata instead of hard-wiring new node types.

Suggested shape:

```ts
type HaBinding = {
  entityId: string
  tapAction?:
    | { type: "toggle" }
    | { type: "service"; domain: string; service: string; data?: Record<string, unknown> }
  presentation?: {
    kind: "room-light" | "device-light" | "fan" | "temperature-label" | "occupancy" | "generic"
    stateClassMap?: Record<string, string>
    textTemplate?: string
  }
}
```

Attach it under `node.metadata.ha`.

### 2. Add an HA client adapter

Create a small adapter layer that exposes:

- `connect()`
- `subscribeEntities(entityIds, callback)`
- `callService(domain, service, data)`
- `getStates()`

This should be isolated from rendering code so we can support:

- direct browser-to-HA connections
- local-network and remote-internet HA URLs
- a proxy if needed later

## Remote Access Model

Remote access is a first-class requirement for Solution A.

Pascal should support connecting to:

- a local HA instance such as `http://homeassistant.local:8123`
- a remote HA instance such as `https://ha.example.com`

Conceptually this should behave like the HA phone app model:

- the user points Pascal at an HA server URL
- Pascal authenticates as a client of that HA instance
- Pascal keeps a live connection open for entity updates
- Pascal sends commands back to that same HA instance

Phase 1 should assume:

- one configurable HA base URL
- one authenticated user session or token
- reconnect and resubscribe behavior when the socket drops
- a clear disconnected/auth-failed state in the UI

### 3. Add a sync system between HA state and Pascal runtime state

The sync layer should:

- pull initial HA state
- subscribe to updates
- write derived values into `useInteractive`
- optionally mark scene nodes dirty when visuals depend on HA state

Example mappings:

- `light.kitchen.state === "on"` -> interactive toggle `true`
- `light.kitchen.attributes.brightness` -> slider value
- `fan.office.state === "on"` -> animation active
- `sensor.livingroom_temperature.state` -> text label content

### 4. Use Pascal presentation instead of SVG CSS tricks

Replace SVG/CSS behaviors with Pascal-native rendering:

- room lighting -> zone overlay opacity/material/emissive changes
- fans -> GLTF animation or transform animation
- sensor labels -> 2D floorplan labels or 3D HTML overlays
- device active state -> item glow, icon swap, light effect, or material change

### 5. Keep 2D and 3D on the same binding model

Do not build separate HA bindings for floorplan and 3D.

The binding should target scene nodes, and both:

- `floorplan-panel.tsx`
- the 3D viewer

should read from the same mapped runtime state.

## Discovery Notes

For the "real smart device" picker, the correct model is not "scan arbitrary Wi-Fi clients and guess." Home Assistant discovery is integration-driven.

- For finding the HA server itself, the native-app model is zeroconf discovery of `_home-assistant._tcp.local`, with manual URL entry as the fallback when zeroconf is not available.
- For finding local devices, Home Assistant integrations prefer discovery protocols such as zeroconf/mDNS and SSDP/UPnP, and may also use domain-specific mechanisms like HomeKit, DHCP, Bluetooth, USB, or Matter.
- For Pascal, that means the best practical picker is:
  1. Try HA-style LAN discovery signals first, especially mDNS/zeroconf and SSDP for local smart devices.
  2. Fall back to the connected HA instance's known entities/devices, because HA is already the normalization layer the user trusts.

This is the approach now used in the editor spike: LAN discovery first, then HA-managed entity discovery as the authoritative fallback. In the current setup, the Chromecast device is surfaced through the connected HA entity when raw LAN broadcast discovery on the laptop is incomplete.

## First Feature Slice

The smallest useful parity slice with `ha-floorplan` is:

1. Bind one `light.*` entity to one Pascal room/zone.
2. Click the room in 2D and 3D to call `light.toggle`.
3. Subscribe to HA state and change zone overlay/emissive intensity when the light turns on/off.
4. Bind one `sensor.*` entity to a label in the floorplan.
5. Bind one `fan.*` entity to an item animation.

If those three bindings work, Pascal has already replaced the core value of the SVG floorplan example.

## Practical Recommendation

Build the first spike as a Pascal-hosted app that talks directly to a user-selected HA server, with remote access supported from the start.

Reason:

- fastest path to a working prototype
- least conflict with the current React/Next architecture
- best reuse of `@pascal-app/core` and `@pascal-app/viewer`
- same basic client/server model users already understand from the HA phone app

## Immediate Next Steps

1. Add a small HA binding type and metadata helpers in `@pascal-app/core`.
2. Create a new HA adapter package or app-local module using `home-assistant-js-websocket`.
3. Implement a `useHomeAssistant` store for connection state, auth state, entity cache, and service calls.
4. Add connection settings for HA base URL plus credential/session input.
5. Implement reconnect and resubscribe behavior for dropped sockets.
6. Drive one zone and one item from real HA state.
7. Expose binding controls in the editor so nodes can be assigned entity ids.

## Source Notes

- HA floorplan reference:
  `https://experiencelovelace.github.io/ha-floorplan/docs/example-floorplanner-home/`
- HA WebSocket API:
  `https://developers.home-assistant.io/docs/api/websocket/`
- HA REST API:
  `https://developers.home-assistant.io/docs/api/rest/`
- HA frontend architecture:
  `https://developers.home-assistant.io/docs/frontend/architecture/`
- HA custom cards:
  `https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/`
- HA JS WebSocket client:
  `https://github.com/home-assistant/home-assistant-js-websocket`
- HA native app connection setup:
  `https://developers.home-assistant.io/docs/api/native-app-integration/setup/`
- HA networking and discovery:
  `https://developers.home-assistant.io/docs/network_discovery/`
- HA discovery manifest guidance:
  `https://developers.home-assistant.io/docs/creating_integration_manifest`
