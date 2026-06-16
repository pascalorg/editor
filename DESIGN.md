# Design

## Source of truth
- Status: Draft
- Last refreshed: 2026-06-11
- Primary product surfaces: AI sidebar / LLM chat panel, generated geometry preview card, generated asset placement and saving.
- Evidence reviewed:
  - `README.md` — Pascal is a React Three Fiber/WebGPU 3D building editor with separated core/viewer/editor responsibilities.
  - `apps/editor/app/page.tsx` and `apps/editor/components/scene-loader.tsx` — AI is a sidebar tab that mounts `AiChatPanel`.
  - `packages/editor/src/components/ui/sidebar/panels/ai-chat-panel/index.tsx` — current LLM flow sends tool schemas, executes geometry tool calls, and immediately creates scene nodes.
  - `packages/core/src/schema/nodes/item.ts` — current catalog assets are `AssetInput` records with `src`, thumbnail, dimensions, category, and source.
  - `wiki/architecture/layers.md` and `wiki/architecture/viewer-isolation.md` — editor-only UI belongs outside viewer internals; viewer stays editor-agnostic.

## Brand
- Personality: professional, creative, spatial, CAD-adjacent but approachable.
- Trust signals: every AI output should expose what was generated, whether it is draft/placed/saved, and what action will mutate the scene.
- Avoid: silently inserting model output into the canvas before the user has reviewed it.

## Product goals
- Goals:
  - Let users review AI-generated geometry in the chat history before it affects the scene.
  - Make generated objects actionable with two obvious choices: `放置画布` and `存入素材`.
  - Support iterative refinement by sending the prior generated geometry plus the user's modification request back to the model.
  - Preserve editability for primitive/assembly outputs whenever possible.
- Non-goals:
  - Pixel-perfect CAD rendering inside the chat card.
  - Adding editor-specific state or AI workflow concepts to `@pascal-app/viewer`.
  - Treating a saved primitive assembly as a generic GLB unless the user explicitly exports it.
- Success signals:
  - Users can identify the shape from the chat preview without placing it.
  - Users can place or save the same generated result without re-prompting.
  - Follow-up prompts produce a revised version that clearly references the prior version.

## Personas and jobs
- Primary personas:
  - Designer/modeler using natural language to create editable blockout geometry.
  - Operator building a reusable local asset library from AI generations.
- User jobs:
  - Generate a candidate object.
  - Inspect its form from the chat thread.
  - Place it into the current level only when satisfied.
  - Save reusable objects to `Items -> Mine`.
  - Ask for targeted changes without restating the full original prompt.
- Key contexts of use:
  - Narrow sidebar on desktop.
  - Mobile bottom sheet with limited vertical space.
  - Slow or unreliable LLM/tool calls.

## Information architecture
- Primary navigation: existing sidebar tab `AI`.
- Core routes/screens:
  - AI chat thread.
  - Generated geometry preview card inside assistant messages.
  - Items panel `Mine` source for saved generated assets.
- Content hierarchy for generated card:
  1. Status and title, e.g. `草稿 · 风扇 v1`.
  2. Interactive mini 3D preview.
  3. Compact metadata: part count, dimensions, generation mode.
  4. Primary action: `放置画布`.
  5. Secondary action: `存入素材`.
  6. Revision affordance: "不满意？直接输入修改意见".

## Design principles
- Review before mutate: LLM tool output becomes a draft artifact first; canvas mutation happens only through an explicit user action.
- Drafts are durable in the thread: every generated result remains visible, with status changes such as `草稿`, `已放置`, `已存入素材`, or `已被 v2 替换`.
- Revisions are full replacements first: follow-up generation should ask the model for a complete revised geometry payload, not a partial patch, until patch tooling is proven reliable.
- Tradeoffs:
  - A draft artifact layer adds state complexity, but avoids surprise scene mutations.
  - Saving primitive geometry as an editable Pascal asset is better UX than saving a non-editable GLB, but may require extending the generated asset format.

## Visual language
- Color: reuse existing sidebar tokens (`background`, `accent`, `border`, `muted-foreground`) and the AI accent purple `#a684ff`.
- Typography: compact 11–12px sidebar copy; card title medium weight; metadata 10–11px.
- Spacing/layout rhythm: card padding 8–10px; preview aspect ratio around 4:3 or 16:10; actions aligned at card bottom.
- Shape/radius/elevation: rounded-xl card with subtle border; dropdown/preview card should feel like the existing AI panel controls.
- Motion: lightweight loading shimmer/spinner during generation; no camera auto-spin by default.
- Imagery/iconography: use existing Iconify/lucide icons; preview canvas is the primary visual.

## Components
- Existing components to reuse:
  - `AiChatPanel` for thread state and model interaction.
  - Existing `useScene`/`useViewer` actions for explicit placement.
  - Existing Items panel generated asset refresh events where possible.
- New/changed components:
  - `GeneratedGeometryCard`: chat message content for one draft/revision.
  - `GeneratedGeometryPreview`: isolated mini 3D preview with right-drag orbit.
  - `GeneratedGeometryActions`: `放置画布`, `存入素材`, status badges.
  - `aiGenerationHarness` or equivalent module: model calls, tool schemas, validation, draft artifact creation, revision prompt construction.
- Variants and states:
  - Generating: skeleton card with spinner.
  - Draft: both actions enabled.
  - Placing: primary button busy.
  - Placed: primary button becomes `已放置` or `再次放置`.
  - Saving: secondary button busy.
  - Saved: secondary button becomes `已存入素材`.
  - Error: validation/API message with retry.
  - Superseded: old version remains visible but muted, linked to newer version.
- Token/component ownership:
  - Chat UI and preview card belong in `packages/editor`.
  - Model/api routes and local generated asset persistence belong in `apps/editor`.
  - Pure geometry normalization can live in `packages/core` only if it has no React, Three.js, viewer, or editor dependency.

## Accessibility
- Target standard: keyboard-operable controls and readable contrast.
- Keyboard/focus behavior:
  - Preview canvas must not trap focus.
  - Buttons need clear focus rings.
  - Provide keyboard alternatives for preview rotation: reset view and optional rotate-left/rotate-right buttons if the canvas is focused.
- Contrast/readability: status badges must remain legible on dark sidebar backgrounds.
- Screen-reader semantics:
  - Generated card should announce title, status, part count, and action labels.
  - Preview canvas should have an `aria-label` describing the object and interaction.
- Reduced motion and sensory considerations:
  - No forced spinning preview.
  - Respect reduced motion by disabling animated preview transitions.

## Responsive behavior
- Supported breakpoints/devices: desktop sidebar and mobile sidebar bottom sheet.
- Layout adaptations:
  - Desktop: preview card uses full sidebar width.
  - Mobile: preview card can collapse metadata; actions stay visible.
- Touch/hover differences:
  - Desktop: right-drag rotates; wheel zoom optional.
  - Touch: one-finger drag rotates, two-finger pinch zoom.
  - Suppress browser context menu only inside the preview canvas.

## Interaction states
- Loading: show an assistant message card with generation progress.
- Empty: existing AI empty state remains.
- Error: validation errors stay attached to the failed generation turn.
- Success: show generated card instead of only text summary.
- Disabled: actions disabled while generating, placing, or saving.
- Offline/slow network: keep draft artifact once generated; allow retry save/place independently.

## Content voice
- Tone: direct, action-oriented Chinese UI copy.
- Terminology:
  - `草稿` for not-yet-placed generated output.
  - `放置画布` for inserting into the current scene.
  - `存入素材` for saving to the user's generated asset library.
  - `继续修改` or "直接输入修改意见" for iterative generation.
- Microcopy rules:
  - Say whether an action mutates the scene.
  - Avoid exposing raw tool JSON unless in a debug/details disclosure.

## Implementation constraints
- Framework/styling system: React, Next.js app, Tailwind-style utility classes, existing Iconify/lucide icons.
- Design-token constraints: reuse existing sidebar colors and radius/elevation patterns.
- Performance constraints:
  - Mini preview must render only visible/generated cards or use a static thumbnail after initial render.
  - Avoid mounting many full R3F canvases for long chat histories; prefer thumbnail fallback for older cards.
  - Store serializable normalized geometry artifacts, not live Three.js objects.
- Compatibility constraints:
  - Do not move editor-only chat/AI logic into `packages/viewer`.
  - Do not let `packages/core` import Three.js, viewer, UI, tools, modes, or editor concepts.
  - Placement must clone/materialize fresh node IDs so the same draft can be placed more than once.
  - Saving primitive geometry may need a Pascal-geometry asset type or server-side conversion; do not force a GLB-only path if editability is required.
- Test/screenshot expectations:
  - Typecheck after changes.
  - UI verification should cover: generated card appears, right-drag rotates preview, `放置画布` creates/selects nodes, `存入素材` appears in Items `Mine`, follow-up prompt includes prior artifact.

## Harness architecture decision
- Use a harness-style architecture for LLM generation and revision.
- In this context, "harness" means the application layer that:
  1. Maintains conversation and artifact state.
  2. Sends tool schemas and prompts to the model.
  3. Validates and normalizes model tool calls.
  4. Executes allowed side effects only when appropriate.
  5. Feeds tool results or prior artifacts back into later model turns.
- The key change is that geometry tool execution should produce a draft `GeneratedGeometryArtifact`, not immediately mutate the scene.
- Revision prompt construction should include:
  - Original user prompt.
  - Current artifact summary and normalized tool arguments.
  - User modification request.
  - Instruction to return one complete replacement geometry call.
- This is harness architecture at the AI workflow layer, not a reason to violate Pascal's package layering.


## Pipe dynamic flow effects design
- Product intent:
  - Show readable process state for pipes (`water`, `steam`, `condensate`) without pretending to be a CFD/fluid simulation.
  - The effect should answer: "what medium is inside, which way is it flowing, and is it active?"
  - Default scene remains clean; rich motion appears when flow visualization is enabled globally or when a pipe is selected/inspected.
- Recommended effect tiers:
  1. **Surface flow indicator**: animated dashed/chevron bands moving along the pipe surface. This works for closed/insulated pipes and is the default low-cost mode.
  2. **Inner flow preview**: when selected or in an inspection mode, render a slightly smaller translucent tube/ribbon inside the pipe with moving color/alpha. Useful for water/condensate.
  3. **Steam plume/emission**: for steam, render soft billboard particles only at endpoints, valves, vents, or explicit leak markers; do not fill the whole pipe with smoke.
- Medium mapping:
  - `water`: blue/cyan, smooth flowing bands, moderate opacity.
  - `steam`: white/blue-white, fast wispy pulses, optional plume at open endpoints.
  - `condensate`: amber/light blue, slower heavier pulses.
- Data model direction:
  - Keep core data semantic and serializable. Add only domain fields to `PipeNode`, for example:
    - `flowEnabled?: boolean`
    - `flowDirection?: 'start-to-end' | 'end-to-start'`
    - `flowRate?: number`
    - `flowVisualization?: 'surface' | 'inner' | 'both'`
  - Do not store shader uniforms, animation frame state, Three.js objects, or editor-only toggles in core.
- Rendering architecture:
  - Geometry/path sampling stays pure; existing `samplePipeCenterline3D` is a good base.
  - The visual effect belongs in the pipe node geometry/renderer path under `packages/nodes/src/pipe` or the viewer-side registry renderer path, not in editor UI.
  - Per-frame animation belongs in the rendering component/material via `useFrame` or shader time uniforms; the scene store should not update every frame.
  - Editor controls for enabling flow, direction, and flow rate belong in pipe parametrics/inspector UI.
- Performance guardrails:
  - Prefer one shader/material with animated UV/time over many particle meshes.
  - Use particles only for steam plumes and only when visible/selected or global flow visualization is enabled.
  - Reuse sampled pipe centerlines; avoid rebuilding geometry every frame.
  - Respect reduced motion by slowing or disabling animated flow.
- UX controls:
  - Add a global view toggle: `Show pipe flow`.
  - Add pipe inspector controls: `Flow enabled`, `Direction`, `Rate`, `Visualization`.
  - Add a small direction affordance in 2D floorplan: arrows along pipe centerline when selected or flow view is on.
- Acceptance criteria:
  - A water pipe can show blue moving bands in the correct direction.
  - A steam pipe can show a subtle surface pulse and optional endpoint plume.
  - Changing medium/direction/rate updates the effect without changing pipe geometry.
  - Turning off `Show pipe flow` removes animation cost for ordinary viewing.
  - No editor-only flow state leaks into `packages/core` or `packages/viewer`.


## Dynamic property tab design
- Product intent:
  - Add a geometry/property-panel tab named `动态` for nodes that can visualize or play runtime behavior.
  - Avoid showing irrelevant dynamic controls for static building elements such as walls, slabs, stairs, roofs, doors, and ordinary structural geometry.
  - Support two dynamic families: process flow dynamics (pipe media such as steam/water/oil) and transform/pose dynamics (primitive assemblies rotating, moving, opening, pulsing).
- Capability model:
  - Dynamic support should be explicit, not inferred only from node type names.
  - Add a registry-level capability/descriptor concept such as `dynamic` or `animation`, with per-kind supported dynamic modes.
  - Static kinds omit the descriptor, so the `动态` tab is hidden by default.
  - AI/primitive-generated geometry can opt in by storing serializable dynamic specs on the generated artifact or resulting assembly metadata.
- Suggested dynamic spec shape:
  - `dynamic.enabled: boolean`
  - `dynamic.kind: 'flow' | 'motion' | 'state'`
  - For flow: `medium`, `direction`, `rate`, `visualization`, `temperature`, `pressure`.
  - For motion: `motionType`, `axis`, `amplitude`, `speed`, `loop`, `pivot`, `previewOnly`.
  - Store this as plain JSON domain/config data, not runtime Three.js objects or per-frame state.
- Pipe tab behavior:
  - `动态` tab appears for `pipe` because pipe has process metadata and flow visualization support.
  - Controls: Flow enabled, Medium (`steam`, `water`, `condensate`, future `oil`, `air`, `gas`), Direction, Flow rate, Visualization style, Temperature, Pressure.
  - Medium drives visual defaults but remains editable: water = blue bands, steam = white-blue pulse/plume, oil = amber/dark slow bands.
- Primitive/generated geometry tab behavior:
  - `动态` appears only if the node or assembly has dynamic metadata, or if the user clicks `Add dynamic behavior` from an eligible primitive/assembly.
  - Motion templates: Rotate, Move, Oscillate, Pulse, Open/Close, Custom sequence.
  - The panel should show a short natural-language summary, e.g. `Rotates around Y at 30°/s`.
  - Provide `Preview`, `Pause`, `Reset`, and `Apply as scene behavior` actions.
- Interaction rules:
  - If a selected node has no dynamic capability, do not show an empty `动态` tab. Optionally show a small disabled badge/tooltip: `This object has no dynamic behavior`.
  - For multi-selection, show the tab only when all selected nodes share a compatible dynamic family; otherwise show a compatibility summary.
  - Defaults should be generated from domain semantics: pipe.medium -> flow defaults; fan/propeller primitive -> rotate defaults; door/window -> state/open-close only if supported.
- Recognition strategy:
  - Primary source: explicit registry capability/descriptor.
  - Secondary source: node schema fields (`medium`, `flowEnabled`, `dynamic`, `metadata.ai.dynamicIntent`).
  - AI-generated primitives should include `dynamicIntent` only when the prompt asks for behavior, e.g. rotating fan, conveyor belt, moving arm.
  - Do not auto-add motion to walls/stairs just because they are geometry.
- Architecture constraints:
  - Core schema stores serializable dynamic config only.
  - Viewer/node renderers implement visual effects and preview animation.
  - Editor property panel decides whether to show the `动态` tab and writes config updates.
  - Per-frame playback must not mutate the scene store every frame.
- Acceptance criteria:
  - Selecting a pipe shows `动态` with flow controls.
  - Selecting a wall/stair does not show irrelevant dynamic controls.
  - Selecting an AI-generated rotating fan assembly shows `动态` with rotation controls.
  - A dynamic config can be saved/loaded with the scene and remains editable.


## Items GLB import discoverability design
- Product intent:
  - Make importing a local GLB feel like a clear user-owned asset creation path.
  - Users should understand that imported GLB files become reusable assets under `Items -> Mine` and can be placed immediately.
- Current evidence:
  - `packages/editor/src/components/ui/sidebar/panels/items-panel/index.tsx` owns the Items panel import affordance.
  - `packages/editor/src/components/ui/item-catalog/item-catalog.tsx` classifies imported GLB assets as `????` inside the `Mine`/`??` category.
- Recommended IA:
  - Do not show a global GLB import entry in every Items category.
  - Show a single import card only in `?? / Mine`, because that is where user-owned/imported assets live.
  - Keep the card visually prominent enough to work as the import entry point when users enter `Mine`.
- Recommended visual hierarchy:
  - In `Mine`: show a full-width compact CTA card above the asset grid.
  - Card content: `????` + `????????????????` + primary `?? GLB` button.
  - Search remains secondary and should not contain the GLB import action.
- Interaction states:
  - Idle: upload icon + `?? GLB`.
  - Importing: `????` with spinner, disabled.
  - Success: stay/switch to `Mine`, select the imported asset, show `??????????????`.
  - Error: keep error directly under the search/import area.
- Acceptance criteria:
  - The Items panel does not show a global `????` block outside `Mine`.
  - `Mine` clearly invites GLB import.
  - After import, users know where the model went and can place it immediately.

## Open questions
- [ ] Should `存入素材` preserve editability as Pascal geometry, or export a GLB-style item asset for compatibility?
- [ ] Should `放置画布` leave the draft reusable for multiple placements, or mark it as consumed?
- [ ] If v1 was already placed, should v2 offer `替换画布中的 v1` in addition to `放置画布`?
- [ ] Should older generated cards keep interactive 3D canvases, or collapse to thumbnails for performance?
