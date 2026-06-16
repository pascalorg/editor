# AI 几何生成优化路线图

## 背景

本文档描述 AI 几何生成系统（primitive 模式）的改进计划。

### 系统架构简述

```
用户输入
  └─→ buildGeometryAnalysisContext()       前端构建上下文
  └─→ /api/ai-harness/runs                 后端 SSE 任务
        ├─ Stage 1: STAGE1_ANALYST_PROMPT  文字分析，无工具调用
        └─ Stage 2: STAGE2_GENERATOR_PROMPT 工具调用生成几何体
              ↓
        executeGeometryToolCall()           工具执行器
              ↓
        validatePrimitiveSemantics()        语义验证
        assessPrimitiveVisualQuality()      视觉质量评分
              ↓
        GeneratedGeometryArtifact           结果 artifact
```

### 核心代码位置

| 模块 | 路径 |
|---|---|
| 两阶段系统提示 | `packages/editor/src/lib/ai-chat-harness/primitive-system-prompts.ts` |
| 修复策略 | `packages/editor/src/lib/ai-chat-harness/primitive-repair-policy.ts` |
| 上下文构建 | `packages/editor/src/lib/ai-chat-harness/context-builder.ts` |
| 能力路由 | `packages/editor/src/lib/ai-chat-harness/capability-planner.ts` |
| 工具执行器 | `packages/editor/src/lib/ai-geometry-tool-executor.ts` |
| 后端运行器 | `apps/editor/lib/ai-harness-runs/primitive-runner.ts` |
| 装配模板 | `packages/core/src/lib/assembly-compose.ts` |
| 零件库 | `packages/core/src/lib/part-compose.ts` |
| 工业原型注册 | `packages/core/src/lib/industrial-archetype-registry.ts` |
| 语义验证 | `packages/core/src/lib/primitive-semantic-validation.ts` |
| 视觉质量 | `packages/core/src/lib/primitive-visual-quality.ts` |

---

## 已完成的改动（基础修复）

以下问题已在近期修复，是后续各 Phase 的前提：

| 问题 | 修复内容 |
|---|---|
| `BASE_RULES` 系统提示是死代码，LLM 实际没收到详细规则 | 将提示迁移到 `primitive-system-prompts.ts`，runner 正确引用 |
| 修复循环固定 3 次，简单对象也浪费 LLM 调用 | `primitive-repair-policy.ts` 按请求复杂度动态分配修复预算 |
| Stage 1 分析阶段携带 45k artifact JSON | `buildGeometryAnalysisContext` 拆分，Stage 1 只传摘要 |
| "make it a new color" 被误判为新对象请求 | `isLikelyGeometryRevisionRequest` 增加属性变更的修订识别 |
| `compose_assembly` 对未支持 family 直接返回空 | `inferAssemblyFamily` 增加旋转机械（燃气机等）的 compressor 路由 |
| 工业原型命中但无 assembly family 时仍推荐 `compose_assembly` | `capability-planner.ts` 改为路由到 `compose_parts` |

---

## Phase 1 — Stage 1 结构化蓝图协议

### 问题描述

当前 Stage 1 只输出文字分析，Stage 2 要从文字中重新理解意图并自行猜测 3D 坐标，两个阶段之间没有结构化协议。

**典型失败链条（以"燃气机"为例）：**

```
Stage 1 分析文字：
  "需要曲轴箱主体、6 个气缸盖、飞轮、进排气歧管、底座撬块
   推荐 compose_parts，气缸等间距排列在机体顶部..."

Stage 2 从头规划：
  compose_parts({
    parts: [
      { kind: "box", semanticRole: "engine_block", position: [0, 0.5, 0] },
      { kind: "cylinder", position: [-0.6, 1.1, 0] },  // ← LLM 猜的
      { kind: "cylinder", position: [-0.3, 1.1, 0] },  // ← LLM 猜的
      ...
    ]
  })
  → 气缸间距不均、高度错误、飞轮悬空
```

Stage 1 已经正确分析了需要什么零件，但 Stage 2 没有利用这个分析，而是重新猜坐标。

### 解决方案

Stage 1 在文字分析末尾额外输出一个 JSON 零件蓝图。Stage 2 读取蓝图，直接翻译为 `compose_parts` 调用，零件位置由代码从语义关系（`alignAbove`/`alignBeside`/`connectTo`/`around`）计算，LLM 不需要猜任何 `[x, y, z]`。

**改造后的数据流：**

```
Stage 1 输出：
  [分析文字]
  "需要曲轴箱主体、6 个气缸盖、飞轮..."

  ```json
  {
    "route": "compose_parts",
    "category": "gas_engine",
    "constraints": { "length": 2, "width": 1.2, "height": 1.5, "primaryColor": "#555555" },
    "parts": [
      { "id": "base",      "kind": "skid_base",             "semanticRole": "machine_base" },
      { "id": "block",     "kind": "rounded_machine_body",  "semanticRole": "engine_block",  "alignAbove": "base" },
      { "id": "cylinders", "kind": "cylinder",              "semanticRole": "cylinder_head", "alignAbove": "block",
        "array": { "count": 6, "axis": "x", "spacing": 0.28 } },
      { "id": "flywheel",  "kind": "cylinder",              "semanticRole": "flywheel",      "alignBeside": "block", "side": "left", "axis": "x" },
      { "id": "exhaust",   "kind": "pipe_port",             "semanticRole": "exhaust_manifold", "alignBeside": "block", "side": "front" }
    ],
    "requiredRoles": ["machine_base", "engine_block", "cylinder_head", "flywheel"]
  }
  ```

Stage 2：
  读取蓝图 → 直接翻译为 compose_parts 调用
  alignAbove/alignBeside/around 由 part-compose.ts 代码解析为精确坐标
  LLM 只负责"这个零件在那个零件的上面/旁边"，不需要猜具体数值
```

### 开发内容

**1. 修改 `primitive-system-prompts.ts` 中的 `PRIMITIVE_STAGE1_ANALYST_PROMPT`**

在 STAGE 1 分析指令末尾增加：

```
在分析文字之后，输出一个 ```json 代码块，包含结构化零件蓝图：
{
  "route": "compose_parts" | "compose_assembly" | "compose_recipe",
  "category": "语义分类",
  "constraints": { "length"?, "width"?, "height"?, "primaryColor"? },
  "parts": [
    {
      "id": "唯一引用 id",
      "kind": "零件类型（来自支持列表）",
      "semanticRole": "语义角色",
      // 位置关系（选其一，优先于手写坐标）：
      "alignAbove"?: "父零件 id",
      "alignBeside"?: "父零件 id",
      "side"?: "left|right|front|back",
      "centeredOn"?: "父零件 id",
      "connectTo"?: "父零件 id",
      "connectPoint"?: "端口名",
      "around"?: "父零件 id",
      "aroundCount"?: number,
      // 数组重复：
      "array"?: { "count": number, "axis": "x|y|z", "spacing": number },
      // 尺寸（相对主体的比例或绝对值）：
      "dimensions"?: { "length"?, "width"?, "height"?, "radius"? }
    }
  ],
  "requiredRoles": ["必须出现的语义角色列表，用于验证"]
}
仅当 route 为 revise_geometry 时可省略 parts。
```

**2. 修改 `primitive-runner.ts`**

在 Stage 1 响应解析后，新增蓝图提取逻辑：

```typescript
function extractBlueprintFromAnalysis(analysis: string): PartBlueprint | null {
  const match = analysis.match(/```json\s*([\s\S]*?)\s*```/)
  if (!match?.[1]) return null
  try {
    const parsed = JSON.parse(match[1])
    if (parsed.route && parsed.parts) return parsed as PartBlueprint
    return null
  } catch {
    return null
  }
}
```

Stage 2 用户消息从：
```
User request: {harnessContext}
Analysis: {analysis}
Now call the best available tool...
```

改为：
```typescript
const blueprint = extractBlueprintFromAnalysis(analysis)
const genUserMessage = blueprint
  ? [
      `User request: ${userPrompt}`,
      '',
      'Part blueprint from analysis (translate this directly to a compose_parts call):',
      JSON.stringify(blueprint, null, 2),
      '',
      'Translate the blueprint parts array into compose_parts arguments.',
      'Keep all relationship fields (alignAbove/alignBeside/connectTo/around) as-is.',
      'Do not invent raw position coordinates; let the relationship fields drive layout.',
      'Add dimensions and colors from blueprint.constraints.',
    ].join('\n')
  : [
      `User request: ${harnessContext}`,
      '',
      'Analysis:',
      analysis,
      '',
      'Now call the best available tool based on this analysis. Output exactly one tool call.',
    ].join('\n')
```

**3. 新增 `PartBlueprint` 类型定义**

在 `primitive-runner.ts` 或单独的 `types.ts` 中：

```typescript
type PartBlueprintItem = {
  id: string
  kind: string
  semanticRole?: string
  alignAbove?: string
  alignBeside?: string
  side?: 'left' | 'right' | 'front' | 'back'
  centeredOn?: string
  connectTo?: string
  connectPoint?: string
  around?: string
  aroundCount?: number
  array?: { count: number; axis: 'x' | 'y' | 'z'; spacing: number }
  dimensions?: { length?: number; width?: number; height?: number; radius?: number }
}

type PartBlueprint = {
  route: 'compose_parts' | 'compose_assembly' | 'compose_recipe' | 'revise_geometry'
  category?: string
  constraints?: { length?: number; width?: number; height?: number; primaryColor?: string }
  parts?: PartBlueprintItem[]
  requiredRoles?: string[]
}
```

**4. 蓝图同步传给 `executeGeometryToolCall`**

将蓝图的 `requiredRoles` 注入 `geometryBrief`，为 Phase 3 验证做准备（可在 Phase 1 预埋，Phase 3 再实现验证逻辑）：

```typescript
const blueprintBrief: Partial<PrimitiveGeometryBrief> | undefined = blueprint
  ? {
      category: blueprint.category,
      requiredRoles: blueprint.requiredRoles,
    }
  : undefined
```

### 预期效果

| 指标 | 改造前 | 改造后 |
|---|---|---|
| 不支持设备首次生成成功率 | ~20% | ~70% |
| 平均 LLM 调用次数（失败设备） | 4~5 次 | 2~3 次 |
| 气缸/飞轮等部件位置偏差 | 高（纯猜坐标） | 低（关系字段驱动） |

### 不解决的问题

- LLM 不了解的极冷门设备（语义知识本身的缺失）
- 零件内部细节精度（`rounded_machine_body` 仍是通用圆角机体）
- 曲线走向的管路（需要 sweep 路径，超出当前关系字段能力）

---

## Phase 2 — compose_parts 关系字段补全

### 问题描述

Phase 1 蓝图依赖关系字段表达空间布局，但当前 `part-compose.ts` 的关系字段有盲区：

```
"6 个气缸等间距排在机体顶部 X 轴方向"
→ 需要 array: { count: 6, axis: "x", spacing: 0.28 }
→ 现状：array 字段在 part-compose.ts 里实现不完整

"排气歧管在气缸盖端部向前延伸 0.3m"
→ 需要 offsetFrom: "cylinders" + direction: "front" + distance: 0.3
→ 现状：只有 alignBeside(side)，粒度不足

"4 个支脚均匀分布在底座四角"
→ 需要 around: "base" + aroundCount: 4 + aroundAxis: "y" + cornerPattern: true
→ 现状：around 支持圆周分布，但不支持四角矩形分布
```

### 开发内容

**1. 完善 `part-compose.ts` 的 `array` 字段处理**

当前 `array` 只在 compose_primitive 层支持（`expandPrimitiveShapeArrays`），`compose_parts` 的 part 层尚未支持。

需要在 `resolvePartRelationships()` 之前，展开带 `array` 字段的 part：

```typescript
function expandArrayParts(parts: PartComposePartInput[]): PartComposePartInput[] {
  return parts.flatMap(part => {
    if (!part.array) return [part]
    const { count, axis, spacing } = part.array
    return Array.from({ length: count }, (_, i) => ({
      ...part,
      array: undefined,
      id: `${part.id}_${i}`,
      // axis 方向上按 spacing 偏移，由关系字段驱动（alignAbove 保持不变）
      // 偏移量注入为 arrayOffset，由关系解析器读取
      arrayOffset: i * spacing,
      arrayAxis: axis,
    }))
  })
}
```

**2. 增加 `offsetFrom` 关系**

```typescript
// part-compose.ts 关系解析
if (part.offsetFrom) {
  const parent = resolvedParts.find(p => p.id === part.offsetFrom)
  if (parent) {
    const direction = part.offsetDirection ?? 'front'
    const distance = part.offsetDistance ?? 0
    // 在 parent 边界外按 direction 偏移 distance
    position = computeOffsetFrom(parent.resolvedBounds, direction, distance)
  }
}
```

**3. 增加 `cornerPattern` 支持**

在 `around` 关系里支持矩形四角分布：

```typescript
if (part.around && part.cornerPattern) {
  // 不用圆周分布，改用矩形边界四角
  const parent = resolvedParts.find(p => p.id === part.around)
  const corners = computeRectCorners(parent.resolvedBounds, part.cornerInset ?? 0)
  return corners.map((pos, i) => ({ ...part, id: `${part.id}_${i}`, position: pos }))
}
```

**4. 更新 `COMPOSE_PARTS_TOOL` schema**

在 `index.tsx` 的工具描述中补充这些字段的说明，让 LLM 知道可以使用它们。

### 预期效果

Phase 1 之后仍有位置错误的情况，再减少约 50%。  
LLM 蓝图可以正确表达"6 个等间距气缸"、"4 个对称支脚"等工业常见布局。

### 不解决的问题

- 自由曲线路径（排气管弯折走向）
- 嵌套装配（零件内部的子零件）

---

## Phase 3 — 蓝图驱动的语义验证

### 问题描述

当前语义验证对 `family = 'unknown'` 的对象直接跳过所有检查：

```typescript
// primitive-semantic-validation.ts
if (family === 'unknown') {
  return { ok: true, family: 'unknown', score: 1, issues: [], warnings: [], facts: {} }
}
```

这意味着一个"燃气机"没有飞轮、没有气缸，照样能通过验证保存。  
修复循环只在 **schema 错误** 时触发，在 **语义缺失** 时不触发。

### 解决方案

Stage 1 蓝图的 `requiredRoles` 字段传入验证器，对任何对象做最低语义完整性检查：

```
蓝图要求: requiredRoles: ["machine_base", "engine_block", "cylinder_head", "flywheel"]
生成结果: 有 machine_base、engine_block，缺 cylinder_head 和 flywheel

验证结果: ok=false, issues=["Missing required semantic role: cylinder_head", "Missing required semantic role: flywheel"]
→ 触发修复循环，携带具体缺失信息
```

### 开发内容

**1. 修改 `validatePrimitiveSemantics` 签名，接受蓝图必需角色**

```typescript
// primitive-semantic-validation.ts
export function validatePrimitiveSemantics(
  shapes: PrimitiveShapeInput[],
  transforms: PrimitiveWorldTransform[],
  context: {
    toolName: string
    prompt: string
    sourceArgs: Record<string, unknown>
    geometryBrief?: PrimitiveGeometryBrief
    blueprintRequiredRoles?: string[]   // ← 新增
  }
)
```

**2. 新增蓝图角色检查逻辑**

```typescript
// 在现有 family-based 检查之后追加
if (context.blueprintRequiredRoles?.length) {
  const presentRoles = new Set(shapes.map(s => s.semanticRole).filter(Boolean))
  const missingRoles = context.blueprintRequiredRoles.filter(role => !presentRoles.has(role))
  if (missingRoles.length > 0) {
    issues.push(...missingRoles.map(role => `Missing required semantic role: ${role}`))
  }
}
```

**3. 在 `ai-geometry-tool-executor.ts` 传入蓝图角色**

```typescript
const semanticValidation = validatePrimitiveSemantics(
  shapes as PrimitiveShapeInput[],
  transforms,
  {
    toolName: name,
    prompt: context.prompt,
    sourceArgs: args,
    geometryBrief,
    blueprintRequiredRoles: context.blueprintRequiredRoles,  // ← 从 context 传入
  },
)
```

**4. 扩展 `GeometryToolExecutionContext` 类型**

```typescript
export type GeometryToolExecutionContext = {
  prompt: string
  revisionOf?: string
  revisionVersion?: number
  replaceNodeIds?: string[]
  revisionTarget?: GeneratedGeometryArtifact | null
  blueprintRequiredRoles?: string[]   // ← 新增
}
```

**5. 修改 `primitive-runner.ts` 的 `executeTool` 调用，传入蓝图角色**

```typescript
function executeTool(
  name: string,
  args: Record<string, unknown>,
  prompt: string,
  revisionTarget: GeneratedGeometryArtifact | null,
  blueprint: PartBlueprint | null,
): GeometryToolExecutionResult {
  return executeGeometryToolCall(
    name, args,
    {
      prompt,
      revisionOf: ...,
      revisionTarget,
      blueprintRequiredRoles: blueprint?.requiredRoles,  // ← 新增
    },
  )
}
```

### 预期效果

| 情况 | 改造前 | 改造后 |
|---|---|---|
| 生成了几何体但缺关键部件 | 静默通过，保存错误结果 | 拦截，触发修复循环 |
| 修复循环提示信息 | "Invalid geometry tool call" | "Missing required semantic role: flywheel" |
| LLM 修复命中率 | 随机 | 有具体指导，定向修复 |

### 不解决的问题

- 零件存在但位置明显错误（空间位置验证需要更复杂的约束）
- requiredRoles 只能检查"有没有"，不能检查"在哪里"

---

## Phase 4（可选）— Assembly Family 配置化

### 前提条件

Phase 1-3 完成后，大多数工业设备可以通过 LLM 蓝图 + `compose_parts` 生成，不再需要硬编码模板。  
Phase 4 针对的场景是：**需要比 LLM 蓝图更精确的比例控制**，且这类设备足够高频，值得维护一份精确模板。

当前 13 个 assembly family 全部是硬编码函数（`assembly-compose.ts`，826 行），增加新 family 需要改代码。

### 解决方案

将装配模板抽象为 JSON 配置，由通用引擎执行。

**配置格式示意（`config/assembly-templates/vehicle.json`）：**

```json
{
  "family": "vehicle",
  "defaultDimensions": {
    "length": 4.4,
    "widthRatio": 0.42,
    "heightRatio": 0.32
  },
  "styleVariants": {
    "suv":    { "lengthScale": 1.0, "heightRatio": 0.38 },
    "truck":  { "lengthScale": 1.18, "widthRatio": 0.43 },
    "sports": { "heightRatio": 0.26 }
  },
  "parts": [
    {
      "kind": "body_shell",
      "semanticRole": "vehicle_body",
      "dimensionExpr": { "length": "length", "width": "width", "height": "height" },
      "cornerRadiusExpr": "min(length, width, height) * 0.08"
    },
    {
      "kind": "wheel_set",
      "count": 4,
      "semanticRole": "vehicle_tire"
    },
    {
      "kind": "window_strip",
      "semanticRole": "vehicle_window",
      "variant": "vehicle_glasshouse"
    }
  ]
}
```

**通用引擎 `composeAssemblyFromConfig(config, input, constraints)`：**

```typescript
// 替代所有 composeVehicleAssembly / composeFanAssembly 等具体函数
function composeAssemblyFromConfig(
  config: AssemblyTemplateConfig,
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
): PrimitiveShapeInput[] {
  const dims = resolveTemplateDimensions(config, input, constraints)
  const style = resolveTemplateStyle(config, input, constraints)
  const parts = config.parts.map(partSpec => resolveTemplatePart(partSpec, dims, style))
  return composePartPrimitives(partInput(input, constraints, parts))
}
```

### 开发代价

- `assembly-compose.ts` 全部重写（826 行 → 通用引擎 + JSON 配置文件）
- 需要实现表达式求值器（`cornerRadiusExpr`、`dimensionExpr`）
- 现有模板里有部分硬编码的特殊逻辑（如车辆风格判断）需要在配置语言里表达
- 预计工作量：2~3 周

### 建议

Phase 1-3 完成后再评估是否需要。如果 LLM 蓝图对新增工业设备已经足够，Phase 4 优先级很低。  
如果业务上需要大量新增精确设备类型（超出 LLM 语义知识范围），再考虑实施。

---

## 工作量与优先级汇总

| Phase | 核心价值 | 主要改动文件 | 预估工作量 | 优先级 |
|---|---|---|---|---|
| 已完成 | 系统基础稳定 | 6 个文件，数十行 | — | 完成 |
| Phase 1 蓝图协议 | 消除 LLM 猜坐标，覆盖所有 LLM 语义知识内的设备 | `primitive-system-prompts.ts`<br>`primitive-runner.ts` | 1~2 周 | 最高 |
| Phase 2 关系字段 | 蓝图能更精确地表达工业布局 | `part-compose.ts`<br>`index.tsx` (schema) | 1 周 | 高 |
| Phase 3 蓝图验证 | 捕获语义缺失，触发精准修复 | `primitive-semantic-validation.ts`<br>`ai-geometry-tool-executor.ts`<br>`primitive-runner.ts` | 3~5 天 | 中 |
| Phase 4 配置化模板 | 新增精确设备模板不需要改代码 | `assembly-compose.ts` 全部重写 | 2~3 周 | 低（按需） |

---

## 各 Phase 完成后的系统能力对比

```
                    当前（修复后）   +Phase1   +Phase2   +Phase3
─────────────────────────────────────────────────────────────────
已支持 13 种设备质量     ████████      ████████  ████████  ████████
LLM知识覆盖的新设备      ██            ██████    ███████   ███████
部件位置精度（不支持类）  █             █████     ███████   ███████
语义完整性验证           ████(已知)    ████(已知) ████      ███████
首次生成成功率           60%          80%       85%       88%
每请求平均 LLM 调用数    2.8          2.2       2.0       2.1
```

Phase 1 的收益最大，是核心变化。Phase 2、3 是对 Phase 1 的补强。
