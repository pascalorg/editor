# Glazed roof forms

Research date: 2026-10-13. Domain reference for greenhouse, conservatory and canopy roofs. Implementation suggestions below are proposals, not existing Pascal behavior.

## What the user is describing

A greenhouse is primarily a growing space; glasshouse is a common name for a glass greenhouse. Greenhouses can be freestanding or attached. Manufacturers also use conservatory and sunroom for glazed house extensions intended for occupation. These names describe uses and building arrangements, not one roof shape. Ultraframe offers gable, lean-to, Georgian and Victorian conservatories; Hartley offers pitched and lean-to greenhouses. [Hartley greenhouse range](https://hartley-botanic.com/about/), [Ultraframe conservatory styles](https://www.ultraframe-conservatories.co.uk/extension-types/conservatory).

An open-sided glazed shelter is a glass canopy or veranda. Solarlux sells a glass canopy that becomes an enclosed glass house when vertical glazing is added. A roof should therefore work independently of curtain walls. [Solarlux SDL Atrium plus](https://solarlux.com/en/systems/sdl-atrium-plus.html).

## Shape vocabulary

| Form | Geometry | Relevance to Pascal |
| --- | --- | --- |
| Gable / span roof | Two planar slopes meet at a ridge; end elevations are gabled. | Reuse the existing gable shape. |
| Lean-to | One slope descending from a higher side, commonly against an existing building. | Reuse shed, with lean-to as a user-facing description or preset. |
| Hip / pyramid | Slopes on all sides; a pyramid has an apex instead of a long ridge. | Existing hip geometry is the starting point. |
| Quonset / hoop / barrel arch | Rounded transverse profile repeated along the length. | Requires an arched profile; conical is a different geometry. |
| Gothic arch | Curved sides meet at a pointed apex. | Requires its own curved profile; not simply a steep gable. |
| Faceted Victorian | A bay front has three or five faces, giving a rounded appearance through planar facets. | Requires polygonal plan and glazing layout; do not confuse with continuously curved glazing. |
| Lantern | A raised upper glazed roof produces a two-tier roof. | Treat as roof composition or a hosted rooflight, depending on scope. |

UMass identifies Quonset, Gothic and gable greenhouse roofs, and notes Gothic roofs shed snow more readily. Its gutter-connected greenhouse consists of repeated gable or arch bays joined at gutter level. [UMass greenhouse selection](https://www.umass.edu/agriculture-food-environment/greenhouse-floriculture/fact-sheets/selecting-building-commercial-greenhouse).

Ultraframe describes variable-pitch lean-to roofs, faceted Victorian fronts and two-tier lanterns. Its Georgian conservatories have rectangular plans with slopes from each edge. Hartley's Grange is a glass greenhouse with a pyramidal roof and an opening apex. [Ultraframe roof style options](https://trade.ultraframe-conservatories.co.uk/trade/our-products/roofing-systems/glass-roof/style-options/), [Ultraframe conservatory styles](https://www.ultraframe-conservatories.co.uk/extension-types/conservatory), [Hartley Grange](https://hartley-botanic.com/magazine/new-hartley-grange-greenhouse/).

## Glazing and structure

Glass, rigid polycarbonate and polyethylene film are separate covering choices. UMass distinguishes low-cost double film, corrugated polycarbonate, insulating structured sheets and glass. These choices change the panel/frame construction as well as the appearance. [UMass greenhouse selection](https://www.umass.edu/agriculture-food-environment/greenhouse-floriculture/fact-sheets/selecting-building-commercial-greenhouse).

For glass, Hartley's Tradition 8 is a concrete example of flat panes with individual rubber seals, narrow metal framing and eaves gutters. It specifies 4 mm toughened safety glass for that product; that thickness should not become a universal roof default. [Hartley Tradition 8](https://hartley-botanic.com/product/tradition-8-greenhouses-us/).

Solid polycarbonate can be transparent; multiwall polycarbonate is translucent and offers more insulation. Palram permits its SUNLITE sheets to bend into arches, but the minimum radius depends on sheet thickness and internal structure. Its examples are 1.4 m for 8 mm twin-wall and 5 m for 25 mm X-Lite. Support conditions and wind/snow loads also affect spans. [Palram SUNLITE](https://www.palram.com/uk/product/sunlite-polycarbonate-multi-wall/).

Film does not have the same discrete rigid-pane assembly. GrowSpan's Gothic Pro combines galvanized steel arches, a double film roof and polycarbonate end walls. Another Gothic Pro variant uses multiwall polycarbonate. Shape and covering are independently selectable concepts. [GrowSpan Gothic Pro](https://www.growspan.com/structures/pro-greenhouses/gothic-pro/), [GrowSpan Gothic polycarbonate specification](https://www.growspan.com/wp-content/uploads/2024/02/GrowSpan-Gothic-Pro-Polycarbonate-Greenhouse.pdf).

A framed glazed roof has glazing bars supporting panes, a ridge at the high junction, an eaves beam around low edges, and valley members where slopes meet inward. Gaskets, caps and glazing stops retain and seal the panes. Ultraframe also uses transom bars and describes accommodating differential expansion between aluminium and PVC components. A glass tint applied to an opaque roof does not represent this assembly. [Ultraframe glass roof system](https://trade.ultraframe-conservatories.co.uk/trade/our-products/roofing-systems/glass-roof/).

## Water and ventilation

Hartley's longitudinal gutters collect roof water for disposal or storage. Solarlux also offers concealed canopy drainage. These are rainwater routes, separate from internal condensation management. [Hartley Tradition 8](https://hartley-botanic.com/product/tradition-8-greenhouses-us/), [Solarlux SDL Atrium plus](https://solarlux.com/en/systems/sdl-atrium-plus.html).

Greenhouse natural ventilation can use ridge and side openings. Conservatory systems can use background trickle vents and discrete opening roof windows. Ultraframe offers manually or electrically operated roof vents, including thermostat/rain-sensor options. These are opening assemblies, rather than the opaque ridge-vent detail on an ordinary tiled roof. [Penn State greenhouse structures](https://courses.worldcampus.psu.edu/welcome/hort101/print.html), [Ultraframe glass roof system](https://trade.ultraframe-conservatories.co.uk/trade/our-products/roofing-systems/glass-roof/).

## Implementation suggestions

Keep roof shape and construction separate. A proposed `Standard | Glazed` construction selector can coexist with gable, shed and hip shapes. Greenhouse, conservatory and veranda are presets that combine those choices with walls and accessories.

Start with framed flat-pane glazing on existing gable and shed roofs. Define frame dimensions, divisions per slope or target panel size, pane thickness and glazing/frame materials. Clip edge panes to roof faces, share ridge/eaves members, and keep roof-level editing and identities intact. Panel spacing should be measured on the sloping face rather than projected blindly from plan.

An arched roof is a second geometry task. Distinguish true curved sheets from a faceted approximation made with flat glass panes. Polycarbonate bend limits are product constraints, not a universal schema cap. Gothic and barrel profiles need shared geometry and height/normal queries so wall tops, gutters and hosted items agree with the rendered roof.

Defer fully detailed seals, tie-bar engineering and automated ventilation until the basic glazed roof is coherent. If thermal, structural or light-transmission values are exposed later, store supplied or measured values explicitly; visual transparency alone does not establish those properties.

## Fit with Pascal's current code

The following is a code-based implementation proposal, not a committed schema or feature. Paths refer to this checkout as inspected on the research date.

### Separate shape from construction

Pascal's [RoofType](../../packages/core/src/schema/nodes/roof-segment.ts) selects geometry. It should continue to mean gable, shed, hip and the other shapes. Add a separate roof-system choice, displayed as **Roof system: Standard / Glazed**, rather than adding `greenhouse` to the shape enum. Autodesk's sloped-glazing roof preserves footprint/slope authoring and adds curtain panels, grids and mullions. This is a useful precedent for the separation. [Autodesk sloped glazing](https://help.autodesk.com/view/RVT/2019/ENU/?caas=caas%2Fvideo%2Fyoutube%2Flesson%2F143413-courseId-100332.html).

The [roof node](../../packages/core/src/schema/nodes/roof.ts) can own the construction default and glazing configuration. Segments can inherit it; add an explicit segment override if mixed standard/glazed segments are included in the slice. Preserve inactive settings when switching systems, as [curtain walls](../curtain-walls.md) do. Missing fields must resolve to today's standard behavior, and any persisted schema change must include its load path under E-003.

### Reuse curtain-wall concepts, with roof-specific geometry

The existing [curtain configuration](../../packages/core/src/schema/nodes/curtain-wall.ts), [layout](../../packages/nodes/src/wall/curtain-wall-layout.ts) and [materials](../../packages/nodes/src/wall/curtain-wall-materials.ts) provide concrete references:

- Panel count, maximum spacing and fixed spacing with alignment.
- Frame, glass and solid material roles; glass tint, opacity and roughness.
- Glass, solid and empty infill, with individual-cell overrides.
- Live preview and one committed undo step, already documented in the wall panel.

Reuse or extract the pure grid-divider calculation when both kinds actually need it. Do not import the wall builder into roofs or rotate an entire wall node onto its side. Wall layout assumes wall-local horizontal distance and vertical height; roof layout needs a local frame on each slope. Hip edge cells also need clipping to triangular or trapezoidal facets. Cell identity needs a face identifier as well as row and column. User spacing should measure metres along the face, not horizontal projected distance. Merge shared ridge and border members so adjoining slopes do not double the frame.

For the first version, expose two grid directions, frame width/depth, border width, pane thickness and glass appearance. Do not copy wall-only spandrel settings automatically. Roof glazing can later offer framing profiles appropriate to its construction.

### Keep the existing roof lifecycle

The [roof system](../../packages/viewer/src/systems/roof/roof-system.tsx) assumes four standard material slots and builds wall, deck and covering brushes. A glazed branch must replace the opaque deck/covering in both merged and individual segment rendering. Keeping those solids under transparent panes would conceal the interior. A glass material alone also creates no framing or pane boundaries.

Implement glazing geometry and editor controls in the built-in roof folders. A narrow geometry adapter passed from the registered kind-owned system is a candidate, following the existing [wall adapter](../../packages/nodes/src/wall/curtain-wall-adapter.ts); the exact contract should be chosen during implementation. Keep viewer code editor-agnostic and do not grow a second roof-update loop. Reuse dirty tracking, live overrides, rebuild budgets, cache invalidation and geometry disposal under E-001, E-002, E-007 and E-010.

The glazed mesh must resolve separate frame/glass/solid paint slots through the registry. Preserve opaque frame shadows while checking glass appearance in rendered and clay modes. Existing segment-material overrides and the [roof renderer](../../packages/nodes/src/roof/renderer.tsx)'s split between merged and separately painted segments need deliberate handling.

### Compose the complete enclosure

The roof builder also produces wall shells and gable infill. [wallShell](../../packages/core/src/schema/nodes/roof-segment.ts) can already include or omit those shells, but omitting them does not create glazed gable ends. A complete greenhouse needs a defined end-wall path: clipped glazed infill using the existing [roof wall-face profiles](../../packages/core/src/schema/nodes/roof-segment-walls.ts), or a separately implemented wall-to-roof fit. Avoid a second opaque wall occupying the same area.

Room intent can suppress derived ceilings with [hasCeiling: false](../../packages/core/src/schema/nodes/zone.ts). A greenhouse/conservatory preset should account for this explicitly; switching an arbitrary roof to glazed should not silently change unrelated rooms.

Use the existing accessory hosting and cut contracts for rooflights where they fit, but make cuts work on panes and affected frame members. An empty cell is an opening, not an operable vent. Opening vents require an actual assembly. Roof-face queries should reject accessory placement in an empty region instead of treating the entire mathematical slope as physical support. Gutters can follow existing eave geometry; automatic opaque-roof ridge vents and wooden fascia should not appear by default on a glazed system.

### Rounded roofs are a separate geometry slice

The current conical shape is radial around an apex. The shed `arc` bends a shed in plan. Neither produces a barrel arch rising across the width. Introduce a transverse curved profile for barrel and later Gothic roofs, with span and rise as useful authoring dimensions. A curve has changing local slope, so one global pitch cannot describe the entire surface.

Resolve geometry, heights, normals, bounds and panel layout from the same profile. Update accessory placement, cuts, trim rails, measurement features, floorplan linework, gable/end infill, gutters and overlap clipping together. Existing [surface helpers](../../packages/nodes/src/shared/roof-surface.ts), core height sampling and the viewer's outer-surface query contain separate calculations; rounded roofs would expose discrepancies if only the visible mesh changed.

### Suggested delivery order and acceptance checks

1. Glazed gable and shed roofs using existing placement, footprint, pitch and move/resize behavior. Include framing, pane materials, roof/end-infill policy, 2D representation, save/load and agent authoring.
2. Hip/pyramid glazing, with clipped edge panes and shared hip/ridge framing. Multi-segment and mixed construction should have an explicit supported scope.
3. Barrel arches, then Gothic profiles. Choose curved sheets versus faceted flat panes explicitly.
4. Greenhouse/conservatory presets combining curtain walls, glazed roofs, door access, ceiling intent, gutters and opening rooflights where supported.

Each delivered slice needs observable checks through package exports under T-001: old roofs still load and render; panes match slope dimensions; glass reveals the interior; resizing updates frames and cuts with one undo step; 2D and 3D agree; hosted openings remain cut when selected or painted; empty cells remain empty; default accessories are appropriate; exported geometry keeps frame and glazing materials; agent creation and updates use the same schema.

The current [MCP create_roof](../../packages/mcp/src/tools/construction-tools.ts) maintains a separate shape list and exposes no glazing configuration. Extend the appropriate shared/plugin-owned contract and execution path with the slice, following E-016, rather than making the feature available only in the inspector. [IFC export](../../packages/ifc-converter/src/export/scene-to-ifc.ts) currently aggregates segments as roof slabs under an IfcRoof; exporting pane/frame semantics requires a deliberate mapping beyond visual GLB output.
