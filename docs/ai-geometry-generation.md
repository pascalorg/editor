# AI Geometry Generation

This document captures the design intent for the primitive/parts generation flow so future sessions do not have to recover the context from chat history.

## Current strategy

Geometry generation has four active levels:

1. `compose_assembly` for supported complete object families that do not have a dedicated parts family.
2. `compose_recipe` for built-in deterministic primitive recipe packs.
3. `compose_parts` for reusable mechanical or industrial part blueprints and dedicated parts families.
4. `compose_primitive` for fully custom low-level geometry and derived primitive aliases.

Industrial equipment is now profile-first. Concrete equipment knowledge belongs in
device profiles, while family ids describe reusable layout/execution capability.
When no stable profile matches, Stage 1 should produce a runtime
`deviceProfileDraft`; the executor validates it, executes it through
`compose_parts`, and saves a generated candidate only when profile-aware quality is
high enough. Generated candidates remain below workspace/imported/builtin profiles
in priority and are never promoted to stable automatically.

`compose_object` is retired from active AI tool routing. Object-like requests should
route through family assembly, reusable parts, recipes, or the controlled freeform
fallback.

Prefer `compose_recipe` for known high-friction closed-form parts. Prefer
`compose_parts` when the requested object is a recognizable assembly made of
reusable physical components, especially when a device profile or generated
candidate exists. Do not add a new family for each industrial device; add profile
data unless the object needs a genuinely new reusable layout capability.

See `docs/device-profile-architecture.md` for the profile source, lifecycle,
validator, quality, and migration rules.

Primitive "high fidelity" means editable, stylized fidelity: stronger proportions,
clearer silhouettes, rounded/tapered manufactured forms, and stable semantic
subassemblies. It does not mean Articraft/GLB photorealism. Keep Articraft assets
separate from primitive repair and recipe flows.

## Internal Recipe Registry

The internal registry lives in:

```txt
packages/core/src/lib/primitive-recipes.ts
```

It is not a user-facing plugin system yet. It is a deterministic routing layer that
lets the model choose `recipeId + params` instead of hand-authoring large schemas
for families where procedural defaults matter.

Current recipe ids:

```txt
vehicle.sedan
vehicle.suv
vehicle.sports
vehicle.van
vehicle.truck
valve.gate
valve.ball
robotArm.threeAxis
```

The registry expands recipes into existing core builders (`compose_parts` or
`compose_robot_arm`), then reuses the same semantic validation, visual quality
scoring, repair memory, and generated assembly output as other primitive tools.

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

### Industrial family registries

Industrial equipment is parts-first. For these requests, route through `compose_parts`
with a family id and top-level dimensions, then let the registry fill required parts
and clamp unsafe values:

```txt
family: pump
required: skid_base, ribbed_motor_body, volute_casing, inlet_port, outlet_port
optional: flange_ring, impeller_blades, control_box, nameplate, warning_label

family: conveyor
required: conveyor_frame, roller_array, belt_surface
optional: ribbed_motor_body, warning_label, nameplate

family: electrical
required: electrical_cabinet
optional: cable_tray, nameplate, warning_label, vent_slats

family: pipe_system
required: pipe_run
optional: pipe_elbow, flange_ring, valve_body
```

Each part exposes LLM-safe params in `part-registry.ts`, such as `length`, `width`,
`height`, `radius`, `count`, `axis`, and color fields. The normalizer maps overall
`length`/`width`/`height`/`diameter` to sensible part dimensions while preserving
explicit `parts[].params`.

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

### Aircraft

Complete aircraft are generated through the family/parts registry instead of a
single opaque object template. Use `compose_parts` with `family:"aircraft"` and
top-level dimensions/colors, then tune optional `parts[].params` when needed:

```txt
aircraft_fuselage
aircraft_wing
aircraft_engine
aircraft_vertical_stabilizer
aircraft_horizontal_stabilizer
aircraft_landing_gear
```

`aircraft_fuselage.length` is the overall X length. The composer derives the
scaled wing, engine, tail, window, and landing-gear placement from that length.
Use `aircraft_fuselage.count` for cabin window count, `aircraft_engine.count`
for one to four engines, `aircraft_engine.radius` for nacelle size, and
`aircraft_wing.bladeSweep` / `verticalCurve` for the wing silhouette. If the LLM
uses aliases such as `fuselage`, `wing`, `jet_engine`, `t_tail`, or
`landing_gear`, the registry normalizes them to the aircraft part kinds and
fills any missing required parts.

### Kiosks, booths, and small buildings

Small, single-room public-facing structures should use the dedicated kiosk
family before falling back to generic parts:

```txt
kiosk_body
kiosk_roof
kiosk_opening
optional kiosk_counter
optional kiosk_sign
optional kiosk_awning
```

This covers ticket booths, vendor stalls, newsstands, small pavilions, sheds,
guard booths, and compact booth-like buildings. Top-level `length`, `width`,
and `height` control the overall footprint and height; individual
`parts[].params` can override specific pieces such as the service-window size,
counter width, roof style, sign size, or awning dimensions. The generated roles
include `kiosk_body`, `roof`, `opening`, `service_counter`, `sign_panel`, and
`awning`, which makes follow-up revisions more precise than the generic
`main_body` / `support_base` fallback.

### Generic long-tail objects

When no dedicated family/recipe matches, the fallback path should still prefer a
controlled parts plan before raw `compose_primitive`. Use `family:"generic"` and
semantic generic parts:

```txt
generic_body
generic_base
generic_panel
generic_handle
generic_spout
generic_control_panel
generic_display
generic_foot_set
generic_opening
generic_detail_accent
```

This is the preferred bridge for coffee machines, simple devices, display
fixtures, and other long-tail requests that do not have a dedicated family. The executor can
infer a generic plan automatically from the prompt and top-level dimensions; for
example a coffee/espresso machine gets a `generic_body`, support base, control
panel, spout, and cup platform. These generic parts expose safe dimensions such
as `length`, `width`, `height`, `thickness`, `radius`, `cornerRadius`, and color
fields, so follow-up revisions can address semantic parts instead of editing
anonymous primitive boxes.

### Cars and small vehicles

Preferred path: `compose_recipe` with one of `vehicle.sedan`, `vehicle.suv`,
`vehicle.sports`, `vehicle.van`, or `vehicle.truck`. Use compact params such as
`color`, `size`, `sizeScale`, `length`, `width`, `height`, and `highFidelity`.

Fallback `compose_parts` blueprint when the recipe does not cover the requested
vehicle:

```txt
vehicle_body
vehicle_wheels
vehicle_windows
headlights
bumper
```

Use extra `nameplate`, `warning_label`, and `seam_ring` only when the prompt asks for industrial labels or panel seams.
For small cars without exact dimensions, recipe params can use `size:"small"` or
`sizeScale:0.8`. In fallback `compose_parts`, put `sizeScale` on `vehicle_body` (for example
`sizeScale: 0.8`) and use either top-level `primaryColor` or `vehicle_body.primaryColor`
for the body color. The composer accepts these part-local aliases because the model often
keeps the color and scale with the semantic body part.

Vehicle primitive quality is checked in two layers:

- semantic validation: exactly one body, four tires, windows, headlights, and bumpers
- visual quality scoring: wheel/body proportions, non-boxy cabin, separated windows,
  front/rear deck layering, rocker/sill shadow, and subtle wheel-arch/fender hints

For "high fidelity", "好看", "真实", "别太方", or smoothness follow-ups, keep the
vehicle in `compose_parts`. Tune `vehicle_body.cornerRadius`, `cornerSegments`,
`cabinTopScale`/`roofCornerAngle`, `detail:"high"`, and
`enhanceVisualDetails:true`; do not rebuild the car as raw primitive boxes.

Vehicle style presets are supported through `vehicle_body.vehicleStyle` (or
style/variant intent): `sedan`, `suv`, `sports`, `van`, and `truck`. They change
default length/width/height, cabin footprint/taper, wheel radius, wheelbase,
track width, and ground clearance so "SUV", "跑车", "面包车", and "皮卡" do not all
share the same silhouette.

### Robot arms

Use `compose_recipe({recipeId:"robotArm.threeAxis"})` for 3-axis robot arm
requests. Use `compose_robot_arm` directly for robot arm, cobot, manipulator,
FANUC arm, or 6-axis arm requests that are not covered by the 3-axis recipe. Both
paths produce an editable primitive assembly with semantic
roles such as `robot_base`, `base_joint`, `shoulder_joint`, `upper_arm`,
`elbow_joint`, `forearm`, `wrist_joint`, `tool_flange`, and `end_effector`.

For "圆形底盘 / round base" pass `baseShape:"round"`; for "3轴/3-axis" pass
`axisCount:3`; default to `pose:"work-ready"` and `endEffector:"gripper"` for a
readable bent silhouette. Robot arms also participate in semantic and visual
quality checks so missing joints/links are repairable before the result reaches
the canvas.

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

`autoComplete` uses the same family specs to add essentials for fans, pumps, conveyors, bicycles, cars, aircraft, valves, desks, electrical cabinets, and pipe systems. It only fills required structure; visual-detail suggestions such as nameplates or warning labels are reported by assessment and should be added when the prompt asks for detail or when a later visual scoring pass decides the object is too plain.

## Visual detail scoring

`assessPartVisualDetails(input)` computes a rule-based detail score for recognized families. It checks whether expected detail parts are present, such as:

- pump: impeller, nameplate, warning label, flange
- fan: control knob and protective grill
- conveyor: drive motor and warning label
- vehicle: windows, lights, bumper, seam/nameplate details
- aircraft: fuselage, wings, engines, tail stabilizers, and landing gear
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

Values are normalized to meters. For table/desk/furniture generation, user `长/length` maps to the X footprint and user `宽/width` maps to Z front-back depth. For vehicles, user length maps to the vehicle length/depth axis.

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
