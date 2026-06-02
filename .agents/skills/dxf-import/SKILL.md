---
name: dxf-import
description: >
  Use this skill for ANY task touching DXF import functionality in Pascal Editor.
  Covers all five modules: DxfValidator, DxfGeometryParser, VisionAnalyzer,
  MergeEngine, McpImporter. Triggers on keywords: dxf, import, floor plan,
  CAD, wall detection, parallel lines, vision analyze, merge engine,
  dxf-validator, dxf-geometry-parser, dxf-preview, ImportDxfTool,
  vision-analyze API route. Also triggers when user asks to "add import",
  "fix import", or "test import" related to building/architectural files.
---

# DXF Import — Complete Domain Knowledge

## 1. Feature Overview

Import architectural floor plan DXF files into Pascal Editor as fully editable
scenes (Wall / Slab / Door / Window / Zone nodes). The pipeline uses a
dual-channel architecture: precise geometry from code + semantic understanding
from AI vision, merged before writing to Pascal via MCP tools.

Out of scope for Phase 1:
- .dwg format (binary, needs server-side ezdxf conversion — Phase 2)
- Multi-floor auto-detection
- Furniture/fixture block mapping to Item nodes

---

## 2. User-Facing Flow

```
Upload DXF
  ↓
Front-end quick render (Canvas, < 500ms) ← user sees preview, decides to import
  ↓
User clicks "Confirm Import"
  ↓  (two parallel tracks start here)
  ├─ Channel A: Web Worker geometry parse  →  coords JSON
  └─ Channel B: canvas.toDataURL → API route → Vision model  →  semantic JSON
  ↓
Merge layer combines A + B
  ↓
MCP tool call sequence writes Pascal scene
  ↓
Editor opens with imported scene
   + original DXF rendered as Guide node (overlay for manual correction)
```

Progress bar shown to user after "Confirm Import":
- Stage 1: "解析中…"  (Channel A running)
- Stage 2: "识别中…"  (Channel B running, parallel)
- Stage 3: "融合中…"  (MergeEngine)
- Stage 4: "生成场景…" (MCP writes)

---

## 3. File Locations

Follow Pascal's layer rules strictly. Never put logic in wrong layer.

```
packages/core/src/lib/importers/
  dxf-validator.ts          ← pure logic, no React, no UI
  dxf-geometry-parser.ts    ← pure logic, runs in Web Worker
  dxf-merge-engine.ts       ← pure logic, no React
  mcp-importer.ts           ← pure logic, calls @pascal-app/mcp tools

apps/editor/components/tools/
  ImportDxfTool.tsx          ← tool entry UI, file picker

apps/editor/components/
  DxfPreview.tsx             ← Canvas 2D preview renderer
  DxfValidationFeedback.tsx  ← rejection reason display
  ImportProgress.tsx         ← 4-stage progress bar

apps/editor/app/api/vision-analyze/
  route.ts                   ← server-side only, holds Vision API key
```

**Layer rules (from AGENTS.md):**
- `packages/core` — zero UI, zero React, zero rendering imports
- `packages/viewer` — rendering only, never imports from `apps/editor`
- `apps/editor` — composes everything, owns all UI

---

## 4. DxfValidator — Rejection Gate

Run before user confirms import. Uses dxf-parser entity list as input.
Output type: `ValidationResult`.

```typescript
type ValidationResult = {
  passed: boolean
  confidence: number        // 0–1
  warnings: string[]        // soft issues, user can proceed
  rejectReasons: string[]   // hard blocks, import refused
}
```

### Hard reject (any one → refuse)

| Check | Method | Example reject case |
|---|---|---|
| Scale out of range | BBox diagonal < 3m OR > 500m | Mechanical part (48×32mm) |
| Too few line entities | LINE + LWPOLYLINE count < 10 | Pure annotation or empty file |
| Mechanical entity dominance | CIRCLE + SPLINE > 60% of all entities | Gear, pipe fitting |
| No parallel line pairs | Zero pairs with spacing 80–400mm | Circuit diagram, structural plan |
| No closable region | No line group that can form a closed polygon | Isolated line fragments |
| File too large | File size > 10MB | Reject before parsing |

### Soft warnings (allowed to proceed, show to user)

| Check | Warning message |
|---|---|
| No recognisable layer names | "未找到墙体图层（如 WALL、墙），识别准确率可能降低" |
| Low parallel pair ratio | "仅识别到 X% 的线段为墙体，建议检查图层命名" |
| Many arcs (ARC > 20% of entities) | "检测到弧形元素，弧墙导入需要额外处理" |
| No DIMENSION entities | "未找到尺寸标注，请确认图纸单位（mm 或 m）" |
| File > 1MB | "图纸较复杂，导入时间可能较长" |

### Rejection feedback format (shown to user)

Rejection message MUST contain: reason + detected data + suggested action.
Never show only "无法导入" without explanation.

Example:
```
❌ 无法导入此文件

检测结果：
• 图纸范围：48mm × 32mm（疑似机械零件图）
• 直线实体中未发现平行线对（墙体特征缺失）
• CIRCLE 实体占比 71%

建议：
• 请确认上传的是建筑平面图（户型图）
• 如果是正确的户型图，请检查图纸单位设置
```

---

## 5. DxfPreview — Quick Canvas Render

Goal: show outline within 500ms of upload. Uses HTML5 Canvas 2D only.
Do NOT use Three.js or any 3D renderer here.

### Filter order (apply in sequence until entity count < 2000)

1. Remove: HATCH, SOLID, VIEWPORT (no visual value for preview)
2. Remove: TEXT, MTEXT, DIMENSION (annotation)
3. Remove: INSERT sub-entities (keep only insertion point)
4. Spatial uniform downsample (last resort)

### Performance tiers

| Filtered entity count | Strategy | Target time |
|---|---|---|
| < 2,000 | Render all | < 200ms |
| 2,000–8,000 | Wall layer only, skip annotations | < 500ms |
| > 8,000 | Uniform spatial downsample to 2,000 | < 500ms, show notice |
| File > 10MB | Reject before parsing | Instant |

### Screenshot for Channel B

After preview renders, get screenshot with:
```typescript
const dataUrl = canvas.toDataURL('image/png')
```
DO NOT use headless browser (Puppeteer/Playwright). Reuse the already-rendered
preview canvas. Resize to 1024×1024px before sending to Vision API.

---

## 6. Channel A — DxfGeometryParser

Run in Web Worker (never block main thread).
Input: dxf-parser entity list.
Output: CoordsJSON (see schema below).

### Step 1 — Layer analysis

```
Priority order:
1. Layers whose name contains: WALL, 墙, A-WALL, 承重墙, 隔墙, ARCH-WALL
   → process these entities first, high confidence
2. No recognised layer names found
   → fall back: apply geometric heuristics to ALL LINE + LWPOLYLINE
3. Always skip layers containing: HATCH, TEXT, DIM, ANNO, FURNITURE, 家具, 标注
```

### Step 2 — Coordinate normalisation

```
1. Read $INSUNITS from DXF header
   → 4 = mm, 6 = m, missing = infer from BBox size
   Inference rule: if BBox max dimension < 100 → assume metres
                   if BBox max dimension ≥ 100 → assume millimetres

2. Convert all coordinates to metres (Pascal internal unit)

3. Round all coordinates to 0.001m precision (1mm)

4. Endpoint snapping:
   if distance between two endpoints < 0.005m (5mm) → merge to same point
```

### Step 3 — Parallel line pair detection (wall recognition core)

For each line segment A, find candidate partner B where ALL conditions hold:

```
angle difference      < 1°          (parallel)
perpendicular distance ∈ [0.08, 0.40]m  (valid wall thickness 80–400mm)
length difference     < 20%         (excludes annotation lines)
projection overlap    > 30% of shorter segment length
```

If multiple B candidates → pick highest overlap × (1 / distance_variance) score.

Result per matched pair:
```
centreline = midpoint line between A and B
thickness  = perpendicular distance
→ emit WallCandidate { start, end, thickness }
```

### Step 4 — Intersection correction

Handle all junction types. Failure here causes disconnected walls and prevents
Slab auto-generation (v0.6.0 feature requires closed wall loops).

```
L-junction:  snap both wall endpoints to exact intersection point
T-junction:  split the through-wall at intersection; all three endpoints
             snap to intersection
Cross (+):   four wall segments; all four endpoints snap to centre intersection
Oblique:     solve line equations to find intersection point; snap endpoints
```

Tolerance: if computed intersection is within 10mm of existing endpoint,
snap rather than create new point.

### Step 5 — Door and window detection

```
Door signature:   short LINE segment (< 1.2m) + ARC on same wall face
                  → DoorOpening { wallId, positionAlongWall, width, height=2.1 }

Window signature: wall gap (LINE missing in double-wall pair) OR
                  block INSERT with name containing WIN / WINDOW / 窗
                  → WindowOpening { wallId, positionAlongWall, width, height=1.2 }

If confidence < 0.7 → mark as unresolved, let Channel B resolve
```

### CoordsJSON output schema

```typescript
type CoordsJSON = {
  unit: 'm'
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
  walls: Array<{
    id: string            // e.g. "w_001"
    start: [number, number]
    end: [number, number]
    thickness: number     // metres
    height: number        // default 2.8m if not in DXF
    layerName?: string
  }>
  openings: Array<{
    id: string            // e.g. "o_001"
    type: 'door' | 'window' | 'unresolved'
    wallId: string
    positionAlongWall: number   // 0–1 ratio
    width: number
    height: number
    confidence: number
  }>
  closedRegions: Array<{
    id: string
    polygon: Array<[number, number]>
  }>
  confidence: number
  warnings: string[]
}
```

---

## 7. Channel B — VisionAnalyzer

Server-side only (`apps/editor/app/api/vision-analyze/route.ts`).
Vision API key MUST NOT appear in any client bundle or be logged.

Model: claude-sonnet-4-20250514 (multimodal).
Input: base64 PNG (1024×1024), from canvas.toDataURL().
Timeout: 10 seconds. On timeout → skip Channel B, continue with Channel A only.

### System prompt (send exactly, do not paraphrase)

```
You are an architectural floor plan analyser. Analyse the image and respond
ONLY with valid JSON — no prose, no markdown fences, no explanation.

Rules:
1. If this is NOT an architectural floor plan (mechanical drawing, circuit
   diagram, site plan, etc.) return: {"valid":false,"reason":"<one sentence>"}
2. All coordinates are relative to image: top-left=(0,0), bottom-right=(1,1).
   x increases rightward, y increases downward.
3. Use standard Chinese room names: 客厅, 主卧, 次卧, 厨房, 卫生间, 餐厅,
   书房, 阳台, 走廊, 玄关, 储藏室.
4. Report confidence per element (0.0–1.0). Below 0.6 = uncertain.
5. Never invent data. If unsure, omit the element.
```

### SemanticJSON output schema

```typescript
type SemanticJSON = {
  valid: boolean
  reason?: string          // only when valid=false
  confidence: number       // overall
  rooms: Array<{
    name: string           // Chinese room name
    center: [number, number]   // relative 0–1 coords
    approxAreaM2: number
    confidence: number
  }>
  openings: Array<{
    type: 'door' | 'window' | 'sliding_door' | 'opening'
    location: [number, number]   // relative 0–1 coords
    facing?: 'north'|'south'|'east'|'west'
    confidence: number
  }>
  wallTypes: Array<{
    location: [number, number]
    type: 'exterior' | 'interior' | 'load_bearing'
    confidence: number
  }>
  warnings: string[]
}
```

---

## 8. MergeEngine

Input: CoordsJSON (Channel A) + SemanticJSON (Channel B).
Output: list of Pascal nodes ready for createNode().

### Coordinate system conversion (B → A)

Channel B uses relative image coords (0–1), must convert to real metres:

```typescript
realX = relativeX * (bbox.maxX - bbox.minX) + bbox.minX
realY = (1 - relativeY) * (bbox.maxY - bbox.minY) + bbox.minY
// Note: Y axis is flipped (image Y down, world Y up)
```

### Merge rules (apply in order)

```
RULE 1 — B confirms A wall:
  Channel B reports a wall-type region overlapping a Channel A WallCandidate
  → use A coordinates (precise), attach B metadata (wall type, adjacent room names)

RULE 2 — B resolves A ambiguity:
  Channel A has two WallCandidates overlapping same region (ambiguous)
  Channel B confidence for one > 0.75
  → keep the candidate spatially closer to B location

RULE 3 — B finds opening A missed:
  Channel B reports door/window, Channel A has 'unresolved' or nothing nearby
  → convert B relative coords to real coords
  → find nearest wall within 0.3m
  → create DoorOpening or WindowOpening on that wall

RULE 4 — Room name attachment:
  Channel B room centre converts to real coords
  → find closedRegion in Channel A whose polygon contains that point
  → attach { metadata: { name: roomName } } to Zone node

RULE 5 — Conflict detection:
  Channel A wall endpoint vs Channel B reported wall position differ > 10% of wall length
  → mark node: { metadata: { importWarning: 'position_mismatch', needsReview: true } }
  → still create the node (do not drop it)
  → UI shows yellow warning badge on this node
```

### When Channel B is unavailable (timeout or API error)

Continue with Channel A result only. Log warning. Do not fail the import.
Room names will be absent; user can add them manually.

---

## 9. McpImporter — Pascal Scene Write

Uses `@pascal-app/mcp` tools. Write order is mandatory — never reorder.

```
Step 1: load_scene (if project exists) OR create new scene
Step 2: create_building
Step 3: create_level  (elevation=0, height=2.8 unless DXF provides height)
Step 4: create_wall × N  (all walls, batch)
Step 5: add_door × M  (after walls exist — doors reference wallId)
Step 6: add_window × K  (after walls exist)
Step 7: set_zone × Z  (room boundaries with metadata.name from merge)
Step 8: (automatic) v0.6.0 closed wall loop → Slab auto-generated, no action needed
Step 9: create GuideNode with original DXF rendered as PNG overlay
```

### Node construction (from AGENTS.md convention)

```typescript
// ALWAYS use NodeType.parse then createNode — never construct raw objects
const wall = WallNode.parse({
  type: 'wall',
  parentId: levelId,
  start: [x1, y1, 0],
  end: [x2, y2, 0],
  thickness: 0.24,
  height: 2.8,
  visible: true,
  metadata: {
    importSource: 'dxf',
    layerName: originalLayer,
    wallType: mergedType,   // 'exterior' | 'interior' | 'load_bearing'
    needsReview: false
  }
})
useScene.getState().createNode(wall, levelId)
```

### Version conflict handling

```
On MCP tool response live_sync_version_conflict:
  → call load_scene to reload
  → retry the failed mutation
  → max 3 retries
  → on 3rd failure: show user "导入冲突，请刷新页面后重试"
```

---

## 10. Accuracy Expectations

Set these expectations when discussing or testing the feature.

| DXF type | Channel A alone | With Channel B | Main risk |
|---|---|---|---|
| Residential, named layers | 90–95% | 93–97% | Complex junctions |
| Residential, no layer names | 75–85% | 83–92% | Wall misidentification |
| Scanned-to-vector old drawings | 50–65% | 65–75% | Discontinuous lines |
| Curved / oblique walls | 60–75% | 70–82% | Arc centreline calc |
| Mechanical / circuit / gear | — | — | Blocked by Validator |

**Correction workflow for imperfect imports:**
1. Guide node (original DXF as PNG overlay) stays visible after import
2. Nodes with `metadata.needsReview=true` show yellow badge in editor
3. User can toggle Guide visibility to compare and manually correct
4. "Re-import" option lets user adjust parameters (wall thickness range,
   layer selection) and retry

---

## 11. Dependencies

```
dxf-parser          npm, browser-safe, no native deps — parse DXF text
@pascal-app/mcp     already in repo ≥ 0.4.0 — MCP tool calls
@pascal-app/core    already in repo ≥ 0.6.0 — node schemas
Anthropic Vision    server-side only, claude-sonnet-4-20250514
```

Install dxf-parser:
```bash
bun add dxf-parser --filter=@pascal-app/core
```

---

## 12. Critical Constraints (never violate)

```
✗ Do NOT import dxf-parser in Node.js server code — browser bundle only
✗ Do NOT put ANTHROPIC_API_KEY in any client-side file or log
✗ Do NOT construct raw node objects — always WallNode.parse({}) first
✗ Do NOT import from apps/editor inside packages/core or packages/viewer
✗ Do NOT call useScene from inside packages/core lib functions
   (lib functions are pure; stores are accessed only from React components
    or systems running in render loop)
✗ Do NOT skip endpoint snapping — disconnected walls break Slab auto-generation
✗ Do NOT run DxfGeometryParser on main thread — use Web Worker
```

---

## 13. Testing Checklist

Before marking any phase complete, verify:

```
□ Upload a valid residential DXF → preview renders in < 500ms
□ Upload a gear/mechanical DXF → validator rejects with clear reason
□ Upload file > 10MB → rejected before parsing
□ Parallel line detection finds ≥ 90% of walls in test fixture
□ L/T/cross junctions produce connected wall endpoints (no gaps > 5mm)
□ Closed wall loops trigger Slab auto-generation (v0.6.0 behaviour)
□ Channel B timeout (mock 11s delay) → import completes with Channel A only
□ Nodes with needsReview=true show yellow badge in editor
□ Guide node (DXF overlay) visible and toggleable after import
□ MCP version conflict → auto-retry succeeds on retry 1 or 2
□ No ANTHROPIC_API_KEY appears in browser network requests
□ bun typecheck passes with zero errors
□ bun test packages/core passes
```

---

## 14. Development Phase Order

Implement in this order. Do not start a later phase before earlier ones pass
the testing checklist.

```
Phase 1 (P0): DxfValidator + DxfPreview
  → file upload → canvas render → reject/warn before confirm

Phase 2 (P0): DxfGeometryParser + McpImporter (Channel A only)
  → full import pipeline without AI vision
  → Guide node overlay
  → basic door/window detection

Phase 3 (P1): VisionAnalyzer + MergeEngine (add Channel B)
  → semantic room names
  → AI-confirmed openings
  → conflict warnings (needsReview badge)

Phase 4 (P1): UX polish
  → 4-stage progress bar
  → re-import with parameter adjustment
  → ImportProgress + DxfValidationFeedback components

Phase 5 (P2 — future): .dwg support
  → server-side ezdxf conversion to .dxf
  → reuse entire existing pipeline unchanged
```
