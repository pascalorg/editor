# AI Geometry Generation

This document captures the design intent for the primitive/parts generation flow so future sessions do not have to recover the context from chat history.

## Current strategy

Geometry generation has three levels:

1. `compose_object` for supported whole-object templates.
2. `compose_parts` for reusable mechanical or industrial part blueprints.
3. `compose_primitive` for fully custom low-level geometry.

Prefer `compose_parts` when the requested object is a recognizable assembly made of reusable physical components, but not a fixed hard-coded template. A standing fan is not implemented as a one-off fan template; it is built from base, pole, bracket, motor housing, blades, and protective grill parts. The same pattern is used for pumps, blowers, conveyors, tanks, valves, and other equipment.

## Hard rule: no generated motion

Primitive and parts generation must create static editable geometry. Do not reintroduce automatic motion prompts, continuous rotations, animated assemblies, or viewer-side motion systems for generated primitives.

## Core boundaries

`packages/core/src/lib/part-compose.ts` may contain pure procedural geometry logic and shape blueprints. It must stay independent from Three.js, viewer systems, editor tools, React, UI state, floorplan state, or canvas-specific behavior.

Editor prompt/schema wiring lives in:

```txt
packages/editor/src/components/ui/sidebar/panels/ai-chat-panel/index.tsx
```

## `compose_parts` concepts

Important input fields:

- `parts`: ordered reusable part requests.
- `autoComplete`: defaults to enabled. Recognized equipment families can add missing essentials.
- `position`: object origin; part positions are local offsets.
- `rotation`: part-level Euler rotation.
- `axis`: physical axis for cylinders, rings, ports, flanges, rollers, and tanks.
- `side`: semantic side for ports/flanges (`left`, `right`, `top`, `bottom`, `front`, `back`).
- `outletAngle`: volute casing discharge angle in the XY plane.
- `includeBolts`: `flange_ring` defaults to bolted; set false for a plain flange or when adding a separate `bolt_pattern`.
- `connectTo`: part id, name, kind, or prior part index to snap this part to another part.
- `connectPoint` / `childPoint`: semantic parent/child connection points used with `connectTo`.
- `anchor` / `childAnchor`: legacy geometric anchors used with `connectTo` for simple top/front/back/left/right snapping.
- `enhanceVisualDetails`: adds recommended non-essential visual details when explicitly enabled or when the object name asks for realism/detail.

## Supported part families

### Fans

Recommended blueprint:

```txt
circular_base
vertical_pole
support_bracket
motor_housing
radial_blades
protective_grill
optional control_knob
```

Use `protective_grill` for a real fan cage. It creates a shallow bowl-like guard with concentric rings, radial spokes, side ribs, and a rear outer ring. Use `radial_blades` for swept airfoil-like blades instead of rectangular panels.

### Pumps and centrifugal blowers

Recommended blueprint:

```txt
skid_base
ribbed_motor_body or rounded_machine_body
volute_casing
inlet_port
outlet_port
flange_ring
optional impeller_blades
optional control_box
optional vent_slats
```

Use `outletAngle` to point the discharge neck. `flange_ring` already includes bolts by default.

### Conveyors

Recommended blueprint:

```txt
conveyor_frame
roller_array
belt_surface
```

This gives a readable belt conveyor with side rails, legs, rollers, and belt.

### Tanks and vessels

Use:

```txt
cylindrical_tank
pipe_port / inlet_port / outlet_port
flange_ring
```

Use `axis: "x"` for horizontal vessels and `axis: "y"` for vertical vessels where supported by the part.

### Valves

Recommended blueprint:

```txt
valve_body
handwheel
flange_ring
```

### Additional factory equipment

Use these parts for broader plant scenes:

- `gearbox_body` for gearboxes and reducers.
- `filter_vessel` for cartridge filters and vertical pressure filters.
- `heat_exchanger` for shell-and-tube exchangers.
- `agitator_tank` for mixing tanks.
- `pipe_rack` for pipe corridors.
- `platform_ladder` for access platforms and ladders.

### Office desks

Use `compose_parts` instead of the generic table template when the request needs visible drawers, metal legs, or a more explicit structural breakdown:

```txt
desk_top
leg_set
optional drawer_stack
```

`desk_top.length` is the X footprint and `desk_top.width` is the Z/front-back depth. Match `leg_set.length` / `leg_set.width` to the desktop footprint and set `leg_set.height` so the desktop top reaches the requested height.

### Electrical cabinets and cable trays

Use:

```txt
electrical_cabinet
cable_tray
optional nameplate
optional warning_label
optional vent_slats
```

`electrical_cabinet` creates the manufactured cabinet silhouette with a door panel, seam, handle, vent slats, label, and nameplate. `cable_tray` creates ladder-style tray rails and rungs for plant electrical routing.

### Process piping

Use:

```txt
pipe_run
pipe_elbow
flange_ring
optional valve_body
```

`pipe_run` creates a straight hollow pipe with end couplings. `pipe_elbow` creates a 90-degree swept bend. Use `connectTo` plus `connectPoint` / `childPoint` for flanges and valves where possible.

### Bicycles

Recommended blueprint:

```txt
bicycle_wheels
bicycle_frame
bicycle_fork
handlebar
saddle
chain_loop
```

The bicycle family is a structural side-view approximation: tires/rims/spokes, triangular frame tubes, front fork, handlebar, saddle, and chain loop.

### Cars and small vehicles

Recommended blueprint:

```txt
vehicle_body
vehicle_wheels
vehicle_windows
headlights
bumper
```

Use extra `nameplate`, `warning_label`, and `seam_ring` only when the prompt asks for industrial labels or panel seams.

## Connection and self-check

`compose_parts` supports semantic connection points so parts can attach to named mechanical interfaces instead of raw offsets:

```json
{
  "parts": [
    { "id": "outlet", "kind": "pipe_port", "axis": "z" },
    {
      "kind": "flange_ring",
      "connectTo": "outlet",
      "connectPoint": "open",
      "childPoint": "back"
    }
  ]
}
```

Supported first-pass points include pipe `open/base`, volute `inlet/outlet`, motor or gearbox `shaft`, valve `inlet/outlet/stem`, vessel `top/nozzle/left/right`, and flange `front/back`. Legacy `anchor` / `childAnchor` still works for simple geometric snapping. This resolves the child part center from approximate parent/child extents and is intended for common mechanical snapping such as flange-to-port or port-to-volute, not full CAD constraints.

`assessPartBlueprint(input)` scores recognized families and reports missing required parts, optional parts, recommended details, missing detail parts, and user-facing recommendations. Required checks support alternatives; for example pump motor/body can be `ribbed_motor_body`, `rounded_machine_body`, or `motor_housing`.

`autoComplete` uses the same family specs to add essentials for fans, pumps, conveyors, bicycles, cars, valves, desks, electrical cabinets, and pipe systems. It only fills required structure; visual-detail suggestions such as nameplates or warning labels are reported by assessment and should be added when the prompt asks for detail or when a later visual scoring pass decides the object is too plain.

## Visual detail scoring

`assessPartVisualDetails(input)` computes a rule-based detail score for recognized families. It checks whether expected detail parts are present, such as:

- pump: impeller, nameplate, warning label, flange
- fan: control knob and protective grill
- conveyor: drive motor and warning label
- vehicle: windows, lights, bumper, seam/nameplate details
- valve: flanged ends and handwheel
- desk: drawer stack
- pipe system: elbow, flange, and valve details
- electrical: cable tray, nameplate, warning label, and vent details

`composePartPrimitives` can call `enhancePartBlueprintWithVisualDetails` internally when `enhanceVisualDetails` is true or the object name asks for realistic/detailed output. This pass only adds visual details, not required structural parts; required structure remains owned by `autoComplete`.

## Dimension semantics

Stage 1 dimension semantics live in:

```txt
packages/core/src/lib/dimension-semantics.ts
```

The parser recognizes labeled and compact dimensions such as:

- `长120cm 宽60cm 高75cm`
- `120x60x75cm`
- `直径300mm 高1.2m`

Values are normalized to meters. For table/desk/furniture generation, user `长/length` maps to the X footprint (`width` in `compose_object`) and user `宽/width` maps to Z front-back depth. For vehicles, user length maps to the vehicle length/depth axis.

## Memory handling for long chats

When a conversation gets long, rely on repo artifacts rather than chat history:

1. This document records product and generation rules.
2. Tests in `packages/core/src/lib/part-compose.test.ts` capture expected structure.
3. The editor tool schema/prompt describes what the model should call.
4. The implementation in `part-compose.ts` is the authoritative behavior.

If a future session loses context, read this document first, then inspect the tests and implementation.

## Planned module split

`part-compose.ts` is intentionally still a single implementation file while the part library is evolving quickly. Once the APIs settle, split it without changing public imports:

```txt
packages/core/src/lib/part-compose/common.ts
packages/core/src/lib/part-compose/fan.ts
packages/core/src/lib/part-compose/vehicles.ts
packages/core/src/lib/part-compose/factory.ts
packages/core/src/lib/part-compose/index.ts
packages/core/src/lib/part-compose.ts   # compatibility re-export if needed
```

Do the split as a separate refactor after behavior tests are stable.
