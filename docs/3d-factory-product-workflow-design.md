# 3D Factory Product Workflow Design

## Baseline

Current implementation is backed up as:

- Commit: `b4ade4d5`
- Tag: `202607043Dfactory1.0`
- Backup branch: `codex/backup-202607043Dfactory1.0`

This document designs the next product layer on top of the 1.0 baseline. The goal is not to add more isolated tools. The goal is to make the existing abilities feel like one intelligent industrial scene workflow.

## Product Positioning

The product should feel like an industrial 3D scene copilot:

- It can place normal built-in objects.
- It can generate objects through AI geometry construction.
- It can generate from image references.
- It can generate articulated or joint-aware assets.
- It can install industry packs and generate factory scenes.
- It can preserve semantic assemblies so users can edit equipment and subparts.
- It can bind real-time WebSocket data to equipment, parts, visual states, and dashboards.
- It can still let users manually adjust canvas objects when automation is not enough.

The interaction model should hide tool complexity by default. Users should start from intent, not from choosing the correct generator.

## Product Problem

The current capability set is powerful, but it risks becoming a toolbox:

- Users must understand whether to use normal assets, AI geometry, image modeling, industry pack generation, or data binding.
- The canvas organization is still biased toward building floors, while many factories are not floor-based.
- Generated results can be hard to understand unless the user can see why the system chose a profile, recipe, or fallback.
- WebSocket binding can feel disconnected from geometry if it is not part of the same semantic object model.
- Manual editing and AI editing can fight each other if selected equipment, selected subpart, and selected data binding are not clearly scoped.

## Design Principle

Use one product principle:

```txt
Intent first, semantic scene second, tool choice third.
```

The user should say what they want. The system should choose the route:

- built-in object
- industry pack
- recipe-backed semantic assembly
- semantic profile-parts assembly
- image-to-model
- joint asset generator
- free geometry fallback
- data binding flow
- local edit to selected object or selected subpart

The UI should show the chosen route only when it helps the user trust or adjust the result.

## Core Experience Model

### 1. Unified Intent Entry

Replace scattered generation entry points with one primary command surface:

```txt
What do you want to create, change, or connect?
```

Examples:

- `生成一个炼油厂`
- `生成一个带液位的储罐`
- `按这张图生成一台设备`
- `给这个机械臂加关节`
- `把 tank_01.level 绑定到储罐液位`
- `选中这个蒸馏塔，给它加塔外螺旋梯`
- `把罐区内壁透明度调到 0.3`

The command system classifies the intent into:

- `create_scene`
- `create_equipment`
- `create_asset_from_image`
- `create_joint_asset`
- `edit_selected_equipment`
- `edit_selected_part`
- `bind_data`
- `inspect_or_explain`
- `repair_or_optimize_scene`

### 2. Generation Plan Preview

Before applying a large change, show a plan preview:

```txt
Request: 生成一个炼油厂
Industry pack: refinery.basic
Stations: 16
Recipe-backed assemblies: 13
Semantic profile-parts assemblies: 3
Generic fallback: 0
Ports: generated
Data binding: not configured
Action: Preview / Apply / Edit plan
```

The preview turns AI from a black box into a controlled assistant.

### 3. Scene Structure Instead Of Floor Tree

Floors should become one kind of scene organization, not the main mental model.

Introduce a `Scene Structure` panel with switchable grouping modes:

- Spatial: `Site > Zone > Area > Equipment`
- System: `Mechanical / Piping / Electrical / Instrument / Building / Safety`
- Data: `Bound / Unbound / Alarm / Offline`
- Asset Source: `Built-in / Industry pack / AI generated / Image generated / Imported`
- Elevation: `Ground / Platform / Floor / Pipe rack level`

For building design, the old floor tree still exists as an `Elevation/Floor` structure mode.

For factories, the default should be `System` or `Spatial`, not `Floor`.

### 4. Canvas Display Annotations

The canvas should stay in one normal editing mode. Display settings decide which annotations are visible without changing scene data or editing behavior.

Main user-facing annotations:

- 区名: spatial zone names.
- 设备标注: semantic equipment names, footprints, editable parts, and port counts.
- 数据绑定标注: bound/unbound data status, binding fields, sample/current cached values, and drag/drop binding targets.

Removed from the main toolbar after product review:

- Layout: normal canvas editing is already the default.
- Equipment View: folded into Display settings as equipment annotations.
- Data View: renamed to data binding annotations because real-time movement belongs to Preview/Run mode.
- Process: dense factory-wide route overlays were confusing and duplicated Data-driven flow visuals.
- Maintenance: deferred until there is real work-order, alarm, or inspection-route data.
- Elevation: still exists in Scene Structure for building/floor projects, but is not a factory canvas view.

### 5. Capability-Driven Inspector

The right inspector should be generated from the selected object's capability profile.

Object routing:

- Plain geometry shows the generic node property panel.
- Plain user-created assemblies show a lightweight group panel.
- Semantic equipment assemblies show an equipment panel.
- Semantic equipment parts route back to the parent equipment panel and expose part-specific controls.
- Image, AI, and joint assets show their asset-specific controls.

For semantic equipment, use task-based sections instead of many peer tabs:

- Equipment settings: identity, profile, recipe, device-level params.
- Appearance and parts: exposed semantic parts, material, color, opacity.
- Data and dynamics: binding target, current value, visual effect such as level, flow, color, pulse, or visibility.
- Connections and source: ports, route links, industry pack, AI/source metadata.

Default behavior:

- If semantic equipment is selected, edit equipment-level params first.
- If a semantic equipment part is selected, keep the parent equipment context visible.
- If user says "all ladders" or "all tanks", expand scope intentionally.

### 6. Data Binding Flow

WebSocket binding should be a guided workflow, not only a technical setting.

Recommended steps:

1. Connect: enter WebSocket URL, auth if needed, preview messages.
2. Parse: detect JSON fields, units, timestamps, equipment ids.
3. Match: suggest equipment or ports by id/name/alias.
4. Bind: map field to semantic target.
5. Visualize: choose liquid level, color, label, animation, alarm, trend.
6. Validate: show sample live update on canvas.

Binding targets should include:

- equipment parameter, for example `liquidLevel`
- semantic part material, for example `shell.opacity`
- port value, for example `flowRate`
- visual state, for example `running`, `alarm`, `offline`
- transform or animation, for example conveyor speed
- label and dashboard trend

### 7. Workflow Graph For Advanced Users

Borrow the idea of node workflow systems, but keep it hidden by default.

The internal workflow for a factory request can be represented as:

```txt
Prompt
  -> Intent classifier
  -> Pack resolver
  -> Process template resolver
  -> Equipment compiler
  -> Semantic assembly patch builder
  -> Port and route composer
  -> Quality report
  -> Apply to canvas
```

Advanced users can open this as a `Workflow` panel:

- See what happened.
- Re-run only one stage.
- Replace one station profile.
- Save the workflow as a template.
- Share it with another project.

This should feel like "explain and tune the automation", not like forced visual programming.

## Detailed Interaction Flows

### Flow A: Generate A Factory From One Sentence

1. User enters `生成一个炼油厂`.
2. System classifies `create_scene`.
3. Pack resolver checks installed packs.
4. If missing, show pack install gate.
5. If installed, resolve factory template.
6. Show generation plan preview.
7. User applies.
8. Canvas opens in Layout with Equipment/Data available as focused views.
9. Scene Structure defaults to System for factory scenes.
10. Quality report lists recipe-backed and profile-parts equipment.

Success criteria:

- User does not need to choose a generator manually.
- No hidden generic fallback unless explicitly reported.
- User can immediately select a station and edit its semantic assembly.

### Flow B: Generate A Single Equipment

1. User enters `生成一个离心泵`.
2. System classifies `create_equipment`.
3. Resolver chooses recipe-backed semantic assembly if possible.
4. If no recipe exists, resolver chooses semantic profile-parts.
5. If no profile exists, system creates a generic draft with a clear warning.
6. Inspector opens to equipment params.

Success criteria:

- Known industrial equipment is stable and editable.
- Unknown equipment remains possible but visibly marked as draft.

### Flow C: Edit Selected Equipment

1. User selects a tank assembly.
2. User says `液位调到 60%, 外壳透明一点`.
3. AI routes to `edit_selected_equipment`.
4. It updates `liquidLevel` and shell opacity.
5. It does not regenerate the whole tank.

Success criteria:

- Existing manual adjustments are preserved where possible.
- Edit scope is visible in the run result.

### Flow D: Edit Selected Part

1. User selects a distillation tower helical ladder tread or ladder group.
2. User says `把这个梯子颜色改成黄色`.
3. AI routes to `edit_selected_part`.
4. It modifies only semantic roles under `sourcePartKind: helical_ladder`.

Success criteria:

- Selection scope is respected.
- The user can switch between instance edit and profile edit.

### Flow E: Image-To-Model

1. User drops an image and asks for a device.
2. System classifies `create_asset_from_image`.
3. If the image matches a known profile, ask whether to use semantic profile-parts.
4. If not, use image modeling path and mark result as imported/generated asset.
5. Offer "convert visible parts to semantic assembly" when possible.

Success criteria:

- Image generation does not bypass the semantic scene model.
- The result can still be organized, selected, and bound to data.

### Flow F: Bind Real-Time Data

1. User opens Display and enables data binding annotations.
2. User connects a WebSocket source.
3. System previews fields.
4. User drags `tank_01.level` to a tank.
5. System suggests `liquidLevel`.
6. User confirms.
7. Canvas shows live liquid level and trend.

Success criteria:

- Binding is visual and reversible.
- Bound fields are visible in data binding annotations and the equipment inspector.

## Data And Domain Model Additions

### Scene Organization

```ts
type SceneStructureMode =
  | 'spatial'
  | 'system'
  | 'data'
  | 'asset-source'
  | 'elevation'
```

Scene nodes should be grouped through metadata, not moved into incompatible parent types only for UI grouping.

Recommended metadata:

```ts
type SceneOrganizationMetadata = {
  siteId?: string
  zoneId?: string
  processId?: string
  stationId?: string
  systemKind?: 'mechanical' | 'piping' | 'electrical' | 'instrument' | 'building' | 'safety'
  elevationBand?: string
  sourceKind?: 'builtin' | 'industry-pack' | 'ai-generated' | 'image-generated' | 'imported'
}
```

### Canvas Display Annotations

```ts
type CanvasAnnotationOverlay = 'equipment' | 'data-binding'
```

Each annotation overlay defines:

- visible overlays
- selectable targets
- default inspector focus
- label density
- equipment or data emphasis

### Semantic Target

```ts
type SemanticTarget = {
  nodeId: string
  assemblyId?: string
  semanticRole?: string
  sourcePartKind?: string
  sourcePartId?: string
  portId?: string
  dataBindingId?: string
}
```

This is the shared object for selection, AI edits, inspector, and data binding.

### Data Binding

```ts
type SceneDataBinding = {
  id: string
  sourceId: string
  sourceField: string
  target: SemanticTarget
  targetProperty: string
  transform?: {
    scale?: number
    offset?: number
    clamp?: [number, number]
    unit?: string
  }
  visualization?: {
    label?: boolean
    colorRamp?: string
    alarmThreshold?: number
    animation?: 'none' | 'pulse' | 'rotate' | 'flow'
    trend?: boolean
  }
}
```

## Development Phases

### Phase 1: Intent Router And Plan Preview

Status: complete for the v2 first release.

Goal:

- One command entry can route to factory generation, single equipment generation, selected edit, image generation, joint asset, or data binding.

Deliverables:

- Intent classifier contract.
- Generation plan preview model.
- UI panel for preview and apply.
- Logging of chosen route and fallback reason.

Validation:

- `生成一个炼油厂` routes to industry pack generation.
- `生成一个离心泵` routes to equipment generation.
- With selected tank, `液位 60%` routes to selected edit.
- Missing industry pack shows install gate instead of generic generation.

Phase 1 delivery status:

- Done: factory intent preview builds a blocked preview when a known prompt requires a missing industry pack.
- Done: installed industry-pack factory requests produce a confirmable preview instead of a generic fallback.
- Done: single-equipment prompts route through semantic equipment compilation before primitive fallback.
- Done: selected-object edits produce scoped update patches instead of regenerating whole equipment.
- Done: factory run summaries include route, fallback, apply, and missing-pack evidence for the user-facing preview/result surface.

Verification:

- `bun test apps/editor/lib/ai-harness-runs/intent-preview-service.test.ts`
- `bun test apps/editor/lib/ai-harness-runs/single-equipment-compiler.test.ts`
- `bun test apps/editor/lib/ai-harness-runs/factory-runner.test.ts`
- `bun test apps/editor/lib/ai-harness-runs/workflow-summary.test.ts`

Deferred to later polish:

- Rich editable plan UI before apply. The first release has preview/apply evidence and install blocking, while deeper plan editing belongs with later workflow-template work.

### Phase 2: Scene Structure Panel

Status: delivered for v2 foundation.

Goal:

- Replace floor-only mental model with switchable scene structures.

Deliverables:

- Scene Structure panel.
- Group by spatial, system, data, asset source, elevation.
- Preserve existing floor/elevation behavior as one mode.

Validation:

- Refinery defaults to system/spatial grouping.
- Building/floor projects can still use floor grouping.
- Selecting a station row selects the correct assembly on canvas.

Delivered:

- Site panel now opens with Scene Structure as the primary structure view.
- Auto mode chooses System for industry/factory scenes, Elevation for building/floor scenes, and Spatial for general scenes.
- System mode collapses refinery/factory stations to representative assemblies instead of listing every primitive, pipe, and detail part.
- Spatial, System, Data, Asset Source, and Elevation modes are available from the same panel.
- Elevation mode preserves the previous floor/level content instead of deleting the old building workflow.
- Structure rows synchronize selection with canvas/inspector and scroll selected rows into view.
- Inspector and AI now share object capability profiles, so selected-object edits can see semantic parts, editable params, and read-only ports.

Verification:

- `bun test packages/editor/src/lib/scene-structure.test.ts`
- `bun test packages/editor/src/lib/object-capabilities.test.ts packages/editor/src/lib/ai-chat-harness/context-builder.test.ts`
- `bunx playwright test e2e/scene-structure.spec.ts`
- `bun run --cwd apps/editor check-types`

Deferred to later phases:

- Equipment footprints and data labels belong to Phase 3 Canvas Display Annotations.
- Capability-driven equipment configuration belongs to Phase 4 Inspector.
- Scene Structure search, large-scene virtualization, and saved per-project structure preferences are product polish items after the v2 foundation is stable.

### Phase 3: Canvas Display Annotations

Status: MVP closed and product scope tightened after product review.

Goal:

- Let users turn helpful annotations on/off without switching the canvas into confusing modes.

Deliverables:

- Display menu entries.
- Equipment footprints and part affordances.
- Data binding labels and binding affordances.
- Annotation-specific selection targets.

Validation:

- Default canvas keeps normal editing uncluttered.
- Equipment annotations show semantic equipment affordances and preserve selection.
- Data binding annotations show bound/unbound status, cached/sample values, and binding drop targets.
- Process, Maintenance, and Elevation are not factory canvas views.

Foundation delivered:

- Editor state now has persisted `showEquipmentOverlay` and `showDataBindingOverlay` values.
- The bottom canvas toolbar no longer exposes Layout/Equipment/Data view modes.
- The top-right Display menu owns 区名, 设备标注, and 数据绑定标注 so all canvas labels live in one place.
- Scene Structure e2e verifies annotation toggles can happen while station selection remains stable.
- Equipment annotations render semantic equipment cards, footprint outlines, editable part chips, and port counts from the shared object capability resolver; clicking an equipment card selects the same assembly used by Scene Structure and Inspector.
- Data binding annotations render bound and ready-to-bind equipment cards from live-data and dynamic binding metadata; bound cards show binding summaries and sample/cached values while preserving normal selection behavior.
- Canvas annotation helpers now centralize safe metadata parsing, equipment identity detection, base positioning, station ids, and rough equipment height estimates so future overlays do not fork the same rules.

Post-MVP polish:

- Equipment annotation polish: true assembly bounds, part-side anchors, and direct affordances for editable semantic parts.
- Data binding annotation polish: freshness, alarm severity colors, and direct binding entry points. Real motion remains a Preview/Run-mode concern.
- Maintenance/elevation-specific overlays should only return when backed by real inspection or building workflows, not as always-on factory modes.

### Phase 4: Capability-Driven Inspector

Status: Complete.

Goal:

- Make semantic assemblies and subparts understandable and editable.

Deliverables:

- Equipment settings section.
- Appearance and parts section.
- Data and dynamics section.
- Connections and source section.
- Instance edit versus profile edit affordance.

Validation completed:

- Selecting equipment shows recipe/profile identity and instance parameters in the equipment settings section.
- Selecting semantic parts shows part selection plus generic material and opacity controls.
- Connections and source shows port connection, target equipment, target port, route node, source pack, and unconnected state.
- Data and dynamics shows live data and dynamic binding status.

Delivered:

- Basic Inspector now routes by object capability profile.
- Plain geometry keeps the generic node panel.
- Plain user-created assemblies show a lightweight group panel instead of fake equipment settings.
- Semantic equipment assemblies show equipment settings, appearance/parts, data/dynamics, and connections/source sections.
- Semantic equipment parts route back to the parent equipment panel and expose part-specific controls without duplicating the generic material panel.
- Equipment settings separates instance edit affordance from read-only profile/industry-pack identity.
- Appearance and parts lists semantic parts and can select exposed part nodes; editable parts expose material and opacity controls in place.
- Connections and source lists declared connection anchors with medium/side metadata and resolves route/pipe metadata back into each port.
- Data and dynamics summarizes live-data and dynamic binding metadata and can bind fixed data fields to semantic targets.

Deferred extension:

- Add ladder/platform-specific part controls once refinery/cement recipes expose those part contracts beyond generic material controls.

### Phase 5: Data Binding Workflow

Goal:

- Make WebSocket binding visual, safe, and semantic.

Deliverables:

- Fixed/demo live data source for Phase 5 validation.
- Message preview and semantic field detector.
- Assisted field-to-equipment binding from Inspector, AI generation preview, and fixed-field drag/drop.
- Data binding inspector and data binding annotation cards.
- Dynamic preview runtime for semantic level, flow, and alarm pulse bindings.

Validation:

- Bind `level` to `liquidLevel`.
- Bind `flow` to pipe or pump port label.
- Bind `alarm` to color or pulse state.
- Disconnect and reconnect source without losing binding config.

Phase 5 delivery status:

- Done: fixed factory live data source is seeded automatically for editor scenes.
- Done: selected semantic equipment exposes binding targets in the AI context and Inspector data/dynamics section.
- Done: AI data-binding preview can write deterministic `dynamicBindings` to the selected node.
- Done: fixed live data fields can be dragged onto data binding annotation cards to create semantic bindings.
- Done: data binding annotations and the equipment inspector read the same binding contract and show current cached/sample values.
- Done: browser coverage verifies tank level binding, alarm pulse binding, dynamic preview animation, and reset/reseed persistence.
- Deferred: user-managed WebSocket source add/remove UI. For the current product phase, data sources remain fixed while the binding workflow is hardened.
- Deferred: freeform drop-to-raw-3D-surface targeting and multi-source field browsing. Current drag/drop is scoped to fixed fields and data binding annotation cards.

### Phase 6: Workflow Graph And Run History

Goal:

- Let advanced users inspect, tune, and reuse generated workflows.

Deliverables:

- Run history panel.
- Workflow graph view for a generation run.
- Re-run from a stage.
- Save generation plan as template.

Validation:

- Factory generation run shows pack resolver, template resolver, equipment compiler, route composer, quality report.
- User can re-run only one station after changing its profile.

Phase 6 delivery status:

- Done: AI harness runs expose a derived workflow graph from existing run/result/event data.
- Done: recent runs expose compact workflow summaries for a run history panel.
- Done: the AI panel includes a minimal Runs inspector that opens the workflow stages for a selected run.
- Done: station-scoped equipment compiler re-run can create a new focused run from a saved process plan.
- Done: station rerun results replace the old matching station nodes on the canvas during apply.
- Deferred: save generation plan as reusable template.

### Phase 7: Image And Joint Asset Integration

Goal:

- Bring image-to-model and joint asset generation into the same semantic scene model.

Deliverables:

- Image-generated asset source metadata.
- Joint asset semantic controls.
- Optional conversion to semantic assembly when recognizable.

Validation:

- Image-generated equipment appears in Asset Source grouping.
- Joint asset exposes articulation controls.
- AI edits can target generated asset without losing source metadata.

Phase 7 delivery status:

- Done: placed image-to-3D and Articraft assets write a standard `metadata.assetSource` contract.
- Done: object capability reads and Scene Structure Source grouping recognize the standard asset source contract.
- Done: Articraft joint assets expose asset-level Inspector controls for record-wide joint preview, reset, selection, and per-joint edits.
- Done: AI geometry placement and revision replacement preserve standard asset source metadata on the new root assembly.
- Done: recognizable image-to-3D and Articraft model assets receive semantic equipment contracts during placement.

### Phase 8: Product Polish And Safety

Goal:

- Make the experience feel predictable.

Deliverables:

- Undo/redo grouped by workflow run.
- Before/after preview.
- Fallback warnings.
- Missing industry pack install guidance.
- Quality report summary.

Phase 8 delivery status:

- Done: factory run results now share a tested experience summary for quality, fallback warnings, missing pack guidance, apply state, and debug details.
- Done: factory run apply results include a before/after change preview with node counts and created/updated/deleted samples.
- Done: factory run canvas application now writes one scene state change so undo/redo treats the whole run as a single step.
- Done: live data snapshots now sanitize bad WebSocket values before they reach rendering, data binding annotations, or Inspector consumers.
- Done: Phase 8 QA verifies installed industry-pack factory runs resolve templates from the editor server cwd and render refinery smoke screenshots.

Validation:

- Large generation can be undone in one step.
- User sees why a fallback happened.
- Bad WebSocket data does not break scene rendering.

### Phase 9: Release Readiness And Pack Operations

Goal:

- Turn the v2 factory workflow into a repeatable release candidate, not a set of manually verified demos.

Deliverables:

- Factory release-readiness gate for installed/cloud industry packs.
- Server-cwd-safe pack and template resolution checks.
- Repeatable smoke evidence for one-sentence factory generation.
- Clear separation between fast release checks and heavier browser visual QA.
- Product-facing release notes for what a user can trust in v2.

Phase 9 delivery status:

- Done: factory release QA script verifies installed intent-routed packs resolve process templates from the editor server cwd.
- Done: factory release QA can write JSON readiness evidence and product-facing v2 release notes with `--out-dir`.
- Done: factory release-candidate command sequences readiness, core tests, typecheck, and Biome into one local RC gate.
- Done: product-facing Factory V2 release notes describe the user experience, V1-to-V2 changes, current boundaries, and RC commands.
- Done: final refinery visual smoke reached quality 100 with canvas render evidence, distinct isometric/top/side screenshots, and zero browser console/page/request failures.

Validation:

- `bun run --cwd apps/editor factory:release-qa`
- `bun run --cwd apps/editor factory:release-qa -- --out-dir apps/editor/qa-artifacts/factory-release-readiness/latest`
- `bun run --cwd apps/editor factory:release-candidate`
- `bun run --cwd apps/editor factory:release-candidate -- --with-visual-smoke --base-url http://localhost:3002`
- `bun test apps/editor/scripts/factory-release-readiness.test.ts`
- `docs/factory-v2-release-notes.md`
- `docs/factory-v2-release-evidence.md`

## Implementation Priority

Recommended first slice:

1. Intent Router And Plan Preview.
2. Scene Structure Panel.
3. Capability-Driven Inspector.
4. Data Binding Workflow.

These four create the biggest product jump because they make existing capabilities feel unified.

Canvas views should follow immediately after because they turn the factory scene from a static model into an understandable operating workspace.

## Non-Goals For The First Release

- Full OpenUSD import/export.
- Full node-graph workflow editor.
- Real physics simulation.
- Multi-user collaboration.
- Automatic promotion of generated profile drafts to stable industry packs.
- Making every industry device recipe-backed.

The first release should keep semantic profile-parts as a valid high-quality path.

## Risks

### Too Many Modes

Risk:

- Canvas views, structure modes, inspector sections, and workflow graph can become overwhelming.

Mitigation:

- Default to the right mode based on intent.
- Hide advanced workflow graph until the user asks to inspect details.

### AI Overwrites Manual Work

Risk:

- AI edits may regenerate an assembly and destroy user changes.

Mitigation:

- Selection-aware edit scope.
- Prefer param patch and semantic part patch.
- Show before/after and support run-level undo.

### Industry Packs Become Data Dumps

Risk:

- Packs may include many profiles but still feel generic.

Mitigation:

- Require semantic parts, primary roles, quality rules, and station resolution.
- Keep recipe binding optional but valuable.
- Report profile-parts versus fallback clearly.

### Data Binding Becomes Technical

Risk:

- Users may need to understand JSON paths and WebSocket protocols.

Mitigation:

- Provide field detection, suggestions, drag/drop binding, and live preview.

## External Product References

- ComfyUI: node-based AI workflow and reusable generation pipelines.
  https://github.com/comfy-org/comfyui
- tldraw Make Real: intent from sketch or selected canvas area to generated result.
  https://github.com/tldraw/make-real
- Node-RED: low-code event and IoT flow binding.
  https://nodered.org/
- NVIDIA Omniverse and OpenUSD: semantic industrial digital twin direction.
  https://www.nvidia.com/en-us/omniverse/
  https://www.nvidia.com/en-us/glossary/openusd/
- Rerun: time-aware multimodal spatial data visualization.
  https://github.com/rerun-io/rerun
- Cesium Digital Twins: large scene streaming and contextual data overlays.
  https://cesium.com/use-cases/digital-twins/

## Done Definition

This product redesign is successful when:

- A new user can generate a factory without knowing what an industry pack is.
- A technical user can see exactly which pack, profile, recipe, or fallback was used.
- A user can select equipment or a subpart and edit it without regenerating everything.
- A user can bind live data to semantic equipment without writing code.
- A factory scene can be viewed as layout, equipment, or data without exposing confusing route clutter.
- Floor-based interaction remains available but is no longer the default for non-building factories.
