# 3D Factory V2 Phase 1 Development Tasks

## Phase Goal

Phase 1 turns the current multi-entry AI experience into one intent-first workflow:

```txt
User intent -> route decision -> generation/edit plan preview -> user applies -> existing run pipeline
```

This phase does not implement Scene Structure, Canvas Lenses, or the full Semantic Inspector. It creates the product foundation that later phases will use.

## Baseline

V1 backup:

- Commit: `b4ade4d5`
- Tag: `202607043Dfactory1.0`
- Branch: `codex/backup-202607043Dfactory1.0`

V2 starts from current branch after:

- `docs/3d-factory-product-workflow-design.md`
- semantic assembly / industry pack v2 architecture
- all cloud industry packs migrated to schema v2

## Existing Local Anchors

Important existing files:

- `packages/editor/src/components/ui/sidebar/panels/ai-chat-panel/index.tsx`
  - current AI chat UI
  - current mode switcher
  - current factory/primitive/image/articraft send paths
  - current auto-route helper `shouldRouteAssetPromptToFactory`
- `apps/editor/lib/ai-harness-runs/types.ts`
  - current run modes: `articraft`, `image-to-3d`, `primitive`, `factory`
- `apps/editor/lib/ai-harness-runs/factory-runner.ts`
  - factory generation and selection edit path
- `apps/editor/lib/ai-harness-runs/primitive-runner.ts`
  - geometry generation path
- `apps/editor/lib/ai-harness-runs/single-equipment-compiler.ts`
  - single equipment route to semantic assembly
- `apps/editor/lib/profile-packs.ts`
  - installed/cloud pack validation and install state
- `apps/editor/lib/industry-pack-v2.ts`
  - v2 pack validation and station resolution
- `packages/editor/src/components/ui/action-menu/live-data-panel.tsx`
  - current live data/WebSocket surface

## Product Decisions For Phase 1

### Decision 1: One Primary Submit Path

The chat panel should stop asking the user to choose the correct technical route first. The primary send action should call an intent router.

Old technical routes remain internally:

- factory
- primitive
- image-to-3d
- articraft

But they become implementation routes, not the main product choice.

### Decision 2: Preview Before Large Scene Mutation

Factory-scale scene creation and ambiguous high-impact edits should show a plan preview before applying.

Small single-object generation can run directly in this phase, but the router must still produce a plan object.

### Decision 3: Industry Pack Gate Is Product-Level

If the intent needs an industry pack that is not installed, do not fall back to generic generation. Show an install gate and let the user continue after installation.

### Decision 4: Selection Controls Intent Scope

If the user has an equipment assembly or semantic part selected, edits should default to selected scope.

Examples:

- selected tank + `液位 60%` -> selected equipment edit
- selected helical ladder + `改成黄色` -> selected part edit
- no selection + `生成一个炼油厂` -> factory creation

### Decision 5: No Compatibility-Driven UI Fork

Do not keep adding mode-specific product UI branches. The Phase 1 work should introduce shared router and preview contracts, then adapt current routes behind them.

## New Contracts

### Intent Route

Add a shared route type, likely under:

```txt
apps/editor/lib/ai-harness-runs/intent-router.ts
```

Suggested type:

```ts
export type AiIntentRouteKind =
  | 'create-factory'
  | 'create-equipment'
  | 'create-asset-from-image'
  | 'create-joint-asset'
  | 'edit-selected-equipment'
  | 'edit-selected-part'
  | 'bind-live-data'
  | 'generic-geometry'
  | 'ask-or-explain'

export type AiIntentRoute = {
  kind: AiIntentRouteKind
  confidence: number
  prompt: string
  reason: string
  requiresPreview: boolean
  requiredPack?: {
    id: string
    version?: string
    installed: boolean
    reason: string
  }
  selectionScope?: {
    nodeIds: string[]
    semanticRole?: string
    sourcePartKind?: string
    assemblyId?: string
  }
  execution:
    | { mode: 'factory'; params?: Record<string, unknown> }
    | { mode: 'primitive'; params?: Record<string, unknown> }
    | { mode: 'image-to-3d'; params?: Record<string, unknown> }
    | { mode: 'articraft'; params?: Record<string, unknown> }
    | { mode: 'data-binding'; params?: Record<string, unknown> }
    | { mode: 'none'; params?: Record<string, unknown> }
}
```

### Plan Preview

Add a plan preview model, likely under:

```txt
apps/editor/lib/ai-harness-runs/generation-plan-preview.ts
```

Suggested type:

```ts
export type GenerationPlanPreview = {
  id: string
  route: AiIntentRoute
  title: string
  summary: string
  impact: 'low' | 'medium' | 'high'
  applyMode: 'direct' | 'confirm'
  steps: Array<{
    id: string
    label: string
    status: 'ready' | 'blocked' | 'warning'
    detail?: string
  }>
  metrics?: Array<{ label: string; value: string }>
  blockers: Array<{
    code: string
    message: string
    action?: 'install-pack' | 'select-target' | 'connect-data-source'
  }>
  warnings: string[]
}
```

### Chat Message Extension

Current chat messages already carry `factoryRunSummary`. Add a preview-bearing message state:

```ts
type ChatMessage = {
  ...
  generationPlanPreview?: GenerationPlanPreview
}
```

The UI should render a `GenerationPlanPreviewCard` before a run is started.

## Work Package 1: Intent Router

### Scope

Create deterministic first-pass routing. Keep it local and testable. Do not call an LLM in the first implementation.

### Files

Create:

- `apps/editor/lib/ai-harness-runs/intent-router.ts`
- `apps/editor/lib/ai-harness-runs/intent-router.test.ts`

Likely touch:

- `apps/editor/lib/ai-harness-runs/types.ts`

### Rules

Routing priority:

1. Image attachment + image mode words -> `create-asset-from-image`
2. Articraft / joint / robot arm motion asset words -> `create-joint-asset`
3. Selected semantic part + edit words -> `edit-selected-part`
4. Selected equipment + param edit words -> `edit-selected-equipment`
5. Factory/plant/industry-pack intent -> `create-factory`
6. Known single equipment -> `create-equipment`
7. WebSocket/data/bind words -> `bind-live-data`
8. Normal object generation -> `generic-geometry`
9. Question/explanation -> `ask-or-explain`

### Required Test Cases

- `生成一个炼油厂` -> `create-factory`
- `生成一个水泥厂` -> `create-factory`
- `生成一个离心泵` -> `create-equipment`
- `生成一个储罐，液位 60%` -> `create-equipment`
- selected tank + `液位调到 60%` -> `edit-selected-equipment`
- selected ladder + `改成黄色` -> `edit-selected-part`
- image attachment + `按图生成` -> `create-asset-from-image`
- `生成一个有关节的机械臂资产` -> `create-joint-asset`
- `绑定 websocket 数据` -> `bind-live-data`
- `这个设备来自哪个资源包` -> `ask-or-explain`

### Done Criteria

- Tests pass without React or browser.
- Router returns reason and confidence.
- Router marks factory scene creation as `requiresPreview: true`.
- Router marks missing data target as blocked instead of silently picking primitive generation.

## Work Package 2: Industry Pack Install Gate

### Scope

Detect pack requirement before generation. If missing, return a blocked preview with install action.

### Files

Create or extend:

- `apps/editor/lib/ai-harness-runs/industry-pack-intent-resolver.ts`
- `apps/editor/lib/ai-harness-runs/industry-pack-intent-resolver.test.ts`

Likely reuse:

- `apps/editor/lib/profile-packs.ts`
- `apps/editor/lib/ai-harness-runs/industry-factory-knowledge.ts`

### Rules

Known mappings:

- 炼油厂/refinery -> `industry.refinery.basic@0.1.0`
- 水泥厂/cement -> `industry.cement.basic@0.1.0`
- 火电厂/thermal power -> `industry.thermal-power.basic@0.1.0`
- 水处理/water treatment -> `industry.water-treatment.basic@0.1.0`
- 离散制造/discrete manufacturing -> `industry.discrete-manufacturing.basic@0.1.0`
- 电解铝/electrolytic aluminum -> `industry.electrolytic-aluminum.basic@0.1.0`
- 家电装配/appliance assembly -> `industry.appliance-assembly.basic@0.1.0`
- 通用流程/process -> `industry.process.basic@0.1.0`

### Required Test Cases

- Installed refinery pack -> route unblocked.
- Missing cement pack -> preview blocker `install-pack`.
- Unknown factory -> route to `generic-geometry` only if no industry intent match exists.

### Done Criteria

- Missing industry pack never falls back to free geometry silently.
- Preview includes pack id, version, display name if available.

## Work Package 3: Generation Plan Preview Builder

### Scope

Convert a route into a user-visible preview.

### Files

Create:

- `apps/editor/lib/ai-harness-runs/generation-plan-preview.ts`
- `apps/editor/lib/ai-harness-runs/generation-plan-preview.test.ts`

### Preview Types

Factory preview should show:

- industry pack
- process template if resolved
- station count when available
- recipe-backed count when available
- semantic profile-parts count when available
- generic fallback count
- expected action: preview/apply

Single equipment preview should show:

- route kind
- equipment type/profile if known
- whether semantic assembly or generic draft

Selected edit preview should show:

- selected target
- edit scope
- whether it will patch params or subpart material/dimensions

Data binding preview should show:

- source status
- target status
- blockers if no WebSocket source or no semantic target

### Required Test Cases

- refinery route creates high-impact confirm preview.
- single pump route creates low/medium direct preview.
- selected tank edit creates direct preview.
- missing pack creates blocked preview.

### Done Criteria

- Preview builder is pure and testable.
- Preview does not require React.

## Work Package 4: Chat Panel Integration

### Scope

Replace the current direct send decision with:

```txt
submit -> intent router -> plan preview or direct execution -> existing run subscription
```

### Files

Touch:

- `packages/editor/src/components/ui/sidebar/panels/ai-chat-panel/index.tsx`

Create if useful:

- `packages/editor/src/components/ui/sidebar/panels/ai-chat-panel/generation-plan-preview-card.tsx`

### UI Behavior

On send:

1. Build routing context:
   - input text
   - image attachment exists
   - current generation mode
   - conversation purpose
   - selected node ids
   - selected semantic metadata if available
   - installed pack state if already loaded
2. Call router.
3. Build preview.
4. If preview has blocker, render preview card only.
5. If `requiresPreview`, render preview card with Apply.
6. If direct, immediately call existing internal route.

### Required UI States

Preview card buttons:

- Apply
- Install pack
- Edit prompt
- Cancel

Initial implementation can make `Install pack` call existing install path or open pack panel if direct install is not ready.

### Done Criteria

- Existing primitive/image/articraft/factory flows still run through their existing APIs.
- Factory flow no longer depends on a separate visible "factory purpose" click before routing.
- Large factory intent does not start applying until the user confirms preview.

## Work Package 5: Run Logging And Route Evidence

### Scope

Every run should record route evidence so the result can explain itself.

### Files

Touch:

- `apps/editor/lib/ai-harness-runs/types.ts`
- `apps/editor/lib/ai-harness-runs/run-store.ts`
- route creators in `ai-chat-panel`

### Data

Add to run `context` or explicit field:

```ts
intentRoute: {
  kind: string
  confidence: number
  reason: string
  requiredPack?: ...
  previewId?: string
}
```

### Done Criteria

- Run result cards can display chosen route.
- Debugging can answer "why did this go to factory instead of primitive?"

## Work Package 6: E2E And Regression Tests

### Scope

Add enough tests to prove Phase 1 behavior.

### Test Layers

Unit:

- intent router
- industry pack resolver
- preview builder

Integration:

- `ai-chat-panel` submit helper if extracted
- factory run still completes from routed path

E2E:

- User enters `生成一个炼油厂`
- Preview appears
- User clicks Apply
- Factory run starts
- Canvas receives patches

Missing pack E2E can be deferred if pack install UI is not stable, but the route/preview unit test must exist.

### Required Commands

At minimum:

```bash
bun test apps/editor/lib/ai-harness-runs/intent-router.test.ts
bun test apps/editor/lib/ai-harness-runs/generation-plan-preview.test.ts
bun test apps/editor/lib/ai-harness-runs/industry-pack-intent-resolver.test.ts
bun test apps/editor/lib/ai-harness-runs/factory-runner.test.ts
bun run --cwd apps/editor check-types
```

If UI is touched:

```bash
bun test packages/editor/src/components/ui/sidebar/panels/ai-chat-panel/<new-tests>
```

If Playwright coverage is added:

```bash
bun run --cwd apps/editor e2e:factory
```

## Suggested Implementation Order

### Step 1: Pure Router Foundation

- Add router types and deterministic router.
- Add unit tests.

### Step 2: Pack Gate

- Add pack intent resolver.
- Add missing-pack blocked route.
- Add tests against cloud catalog and installed pack state.

### Step 3: Preview Builder

- Add preview model and tests.
- Build preview from route.

### Step 4: UI Card

- Add `GenerationPlanPreviewCard`.
- Render preview messages in chat.

### Step 5: Submit Path

- Replace `handleAssetSubmit` and factory submit branching with router pipeline.
- Keep old execution functions private.

### Step 6: Apply Preview

- Add Apply action that calls the chosen internal route.
- Store preview id in run context.

### Step 7: Validation

- Unit tests.
- Typecheck.
- Manual smoke:
  - `生成一个炼油厂`
  - `生成一个离心泵`
  - selected tank edit
  - image attachment route

## What To Avoid In Phase 1

- Do not build Scene Structure panel yet.
- Do not build Canvas Lens toolbar yet.
- Do not rebuild data binding UI yet.
- Do not add another visible top-level mode selector.
- Do not remove existing run modes until the router integration is stable.
- Do not add LLM-based routing before deterministic routing is tested.
- Do not silently downgrade missing industry packs to generic geometry.

## Acceptance Checklist

- One submit path exists for normal AI input.
- Intent route is visible in code and tests.
- Factory intent shows preview before apply.
- Missing industry pack shows install gate preview.
- Single equipment intent can still create semantic assembly.
- Existing image-to-3D and articulated asset paths remain callable.
- Route evidence is stored with runs.
- Typecheck passes.

## Phase 1 Exit Criteria

Phase 1 is complete when a user can type into one input:

```txt
生成一个炼油厂
```

and the product responds with:

1. a generation plan preview,
2. the required industry pack status,
3. expected station/equipment route summary,
4. an Apply button,
5. a factory run that uses the existing semantic industry-pack path after Apply.

At that point Phase 2 can safely start replacing the floor-first tree with Scene Structure.
