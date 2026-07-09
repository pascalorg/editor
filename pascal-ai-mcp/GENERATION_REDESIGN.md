# 户型生成主流程重设计：LayoutIntent → 确定性分区 → 校验 → 批量施工

状态：设计方案 v2（已按 Codex 8 条审核意见修订），待审核，未动代码。
取代 `OPTIMIZATION_PLAN.md` 批次二至五；其批次一产出 `src/layout-metrics.ts` + 单测已完成、冒烟通过，复用为本方案校验器核心。

**核心决策：模型只出"意图"，几何和施工全部是确定性代码。**
模型出现在四处：需求提取（现有）、LayoutIntent 生成（1 次纯 JSON）、Intent 修正（≤2 次）、装饰性修复（≤2 轮）。房间坐标由确定性矩形分区器计算，建房间/开门窗/放家具由执行器直接调 MCP，全程 0 模型调用。结构性失败一律回规划层重来，不进自由修复循环。

v2 相对 v1 的修订（对应审核意见）：
①计划在创建任何 Pascal 场景之前生成并通过校验；②schema 拆为 LayoutIntent（模型输出，无坐标）与 LayoutPlan（分区器输出，含坐标），LLM 直出多边形仅作对比实验路径；③家具执行器单一策略；④完成门槛从"每 zone 有门"改为"无房间与公共动线隔绝"；⑤开放式厨房第一版合并为 `living_kitchen` 房型，不做 opening 降级 door；⑥结构/面积/邻接类失败回 Plan 层重规划，不交给自由 repair loop；⑦eval 断言继续判定 Case 成败；⑧修正 modify 路径的描述矛盾。

---

## 1. 当前流程 → 新流程映射

新流程总序（注意：**第 1–3 步发生在创建任何 Pascal 场景之前**，规划不通过则零废场景）：

```
确认 brief
→ ① plan-builder：模型输出 LayoutIntent（房间清单/类型/目标面积/采光需求，无坐标）
→ ② layout-partitioner：确定性代码把 Intent 排成矩形分区 LayoutPlan（含坐标/连接/入户）
→ ③ plan-validator：确定性校验；不过 → 只修正 Intent JSON，≤3 轮；仍不过 → 失败，不建场景
→ ④ 创建场景脚手架（create_house_from_brief / clearLevelForRebuild，从这里才第一次碰 Pascal）
→ ⑤ scene-executor：批量 create_room + dedupe + 按 plan 开门窗（0 模型调用）
→ ⑥ furniture-executor：语义家具清单驱动的确定性放置（0 模型调用）
→ ⑦ 验收：collectDiagnostics + layoutQuality + completion-gates
→ ⑧ 分流：结构性失败 → 回 ① 重规划重建（上限 1 次）；装饰性问题 → ≤2 轮修复
→ ⑨ persistScene 保存版本
```

| 现流程环节 | 处置 | 新环节 |
|---|---|---|
| ingest / extractRequirements / evaluate / 确认 | 保留不动 | 同左 |
| （无对应——现在是建完才发现问题） | **新增，且前置于建场景** | ①②③ 规划三件套 |
| create_house_from_brief 脚手架 | 保留，但**后移**到计划通过之后 | ④ |
| 结构阶段 runPhaseToConvergence（逐间建、每间前 get_zones、禁止预排坐标） | **整段删除** | ⑤（坐标来自 plan） |
| dedupeSharedWalls | 保留 | ⑤ 内 |
| 门窗阶段 runPhaseToConvergence | **整段删除** | ⑤（门=connection 共享墙段中点，窗=外墙最长边，入户门=entry 房间外墙；代码计算） |
| furnish_room + 模型逐件补救 | **整体替换**（见 §4，单一策略） | ⑥ |
| refineAndDiagnose 验证 + ≤3 轮自由修复 | **收缩并分流** | ⑦⑧：结构性失败回规划层；自由修复只剩装饰性问题、≤2 轮、prompt 注入 plan 快照并禁改房间结构 |
| phase 判定：无 issue 即 completed | **替换** | 硬门槛全过才 completed，否则 completed_with_issues |
| persistScene | 保留，确认每次成功生成/修改后调用 | ⑨ |
| modify() 增量修改路径 | **策略保留，两处接线**（见 §6，v1 文档"一行不动"的说法不准确，已修正） | — |

## 2. Schema：LayoutIntent 与 LayoutPlan 分离

**LayoutIntent —— 模型的输出物。只有语义，没有坐标。**

```ts
export type RoomType =
  | 'bedroom' | 'living' | 'living_kitchen' | 'dining' | 'kitchen' | 'bathroom'
  | 'study' | 'hallway' | 'entry' | 'storage' | 'balcony' | 'other'

export type LayoutIntent = {
  targetTotalAreaSqm: number
  rooms: Array<{
    id: string                      // intent 内唯一，如 "bedroom-1"
    name: string                    // 展示名，如 "主卧"
    type: RoomType
    targetAreaSqm?: number          // 缺省时分区器按房型默认值分配并整体缩放
    requiresExteriorWindow?: boolean // 缺省按房型默认（卧室/客厅/书房 true）
  }>
  adjacency?: Array<{ a: string; b: string }>  // 超出动线默认规则的额外邻接意愿
}
```

**LayoutPlan —— 分区器的输出物。坐标、连接、入户全部由代码生成。**

```ts
export type LayoutPlan = {
  footprint: { width: number; depth: number }   // 原点(0,0)，轴对齐
  entry: { roomId: string }                     // 入户门开在该房间最长外墙边
  rooms: Array<{
    id: string; name: string; type: RoomType
    polygon: Array<[number, number]>            // 轴对齐、精确铺满 footprint
    requiresExteriorWindow: boolean
  }>
  connections: Array<{ from: string; to: string; type: 'door' }>
}
```

要点：

- **开放式厨房（意见⑤）**：brief 要求开放厨房时，plan-builder 直接产出一间 `living_kitchen`，一个 zone、无隔断，家具清单取 living+kitchen 并集；不引入 `opening` 连接类型，避免"降级成门"的语义错误。`opening` 留作 schema 扩展位，v1 不实现。
- **门窗坐标不进任何 schema**：门 = 共享墙段中点；窗 = requiresExteriorWindow 房间最长外墙边（与门冲突让位次长边）；入户门 = entry 房间最长外墙边中点。全部执行器计算。
- 家具不进 schema：由房型必备清单驱动（§4）。
- **LLM 直出多边形仅作对比路径**：plan-builder 留一个实验开关让模型直接输出 LayoutPlan 几何，走同一个校验器，用于批次 B 评估分区器 vs LLM 坐标的质量差距；默认关闭，不是主路径。

**确定性分区器（layout-partitioner.ts）—— Intent → Plan：**

带状 guillotine 布局 v1：公共带（客厅/餐厅/厨房，贴入口侧外墙）+ 私密带（卧室/书房/卫生间，贴对侧外墙），带内按目标面积比例分宽；私密房间 ≥2 间时在两带之间插入贯通走廊（宽约 1.1–1.2m），否则私密房直接与公共枢纽相邻。footprint 宽度 W 在 `√总面积 × [0.7, 1.5]` 内离散搜索，以"无房间宽度 <1.8m、无长宽比 >3、footprint 比例合理"为目标择优；无解则报错要求调整 Intent（房间数/面积），不硬凑。连接关系随布局结构自动生成（枢纽—走廊—各私密房、枢纽—厨房等），共享边 ≥0.9m 由构造保证。多间房且无公共房型时自动补一条走廊作为枢纽并在 notes 中注明（动线是基础设施，不违反"不擅自加功能空间"规则）。产出天然满足：铺满无缝隙、无重叠、卧室贴外墙（私密带贴外侧）、公共带贴入口侧。

L 形轮廓（case-07）：v1 分区器仅矩形 footprint；L 形在批次 B 把 footprint 扩展为轴对齐多边形 + 两个矩形带的拼接（校验器网格法本来就支持任意轴对齐多边形，不用改）。

## 3. 计划校验器（plan-validator.ts）

纯函数：`validateLayoutPlan(plan, targets) → { fatal: string[]; warnings: string[]; score: number }`。
fatal 非空 → 违规清单注入 Intent 修正 prompt（模型只改 JSON），≤3 轮；仍不过 → 本次生成失败。**校验发生在创建任何场景之前（意见①）。**

| # | 检查 | 级别 |
|---|---|---|
| 1 | schema/几何合法：id 唯一、多边形轴对齐无自交、entry/connection 引用存在 | fatal |
| 2 | 房间都在 footprint 内 | fatal |
| 3 | 房间互不重叠（顶点压缩网格法） | fatal |
| 4 | 铺满：union ≥ footprint × 0.98 | fatal |
| 5 | footprint 面积 vs 目标 ±10% | fatal |
| 6 | 房间数量/类型 vs brief（按 type 枚举精确比对；living_kitchen 同时满足客厅与厨房要求） | fatal |
| 7 | 房型面积区间 / 长宽比 / 走道占比（复用 layout-metrics 档位表）| 超硬阈值 fatal，其余 warning |
| 8 | requiresExteriorWindow 房间 ≥1 条边贴 footprint 边界（≥0.9m） | fatal |
| 9 | 每条 connection 共享边 ≥0.9m | fatal |
| 10 | 动线：全部房间从 entry 可达；每个卧室不穿厨/卫/其他卧室可达公共空间（living_kitchen 计为公共） | fatal |
| 11 | entry 房间有 ≥0.9m 外墙边 | fatal |

分区器产出的 plan 应构造性满足 2/3/4/8/9/11——校验器仍全量检查，作为分区器自身的回归安全网，也为 LLM 直出几何的对比路径服务。

## 4. 批量施工（0 模型调用）

**scene-executor.ts（结构+门窗）**：按 plan.rooms 连续 `create_room` → `dedupeSharedWalls` → `get_walls` 一次 → 每条 connection 找共享墙段 `add_door`（中点，swing 朝大房间）→ entry 外墙加入户门 → requiresExteriorWindow 房间外墙 `add_window` → `get_zones` 实测比对。单调用失败重试 1 次，仍失败记入 executionIssues。

**furniture-executor.ts（意见③：单一策略，不用 furnish_room）**：

```
对每个房间：
  按房型取语义必备清单 → 对照已放置项找缺失
  → 每个缺失项：search_assets（固定检索词，按占地面积升序，优先 compact）
  → 确定性找位：网格扫描房间内贴墙位置（旋转足迹不越界、不与已放置重叠、不挡门及门弧）
  → 原规格放不下 → 换更小规格重试 → 仍放不下 → 记入 furnitureReport.missing
```

清单（required 项）：卧室=床+衣柜；客厅=沙发+茶几；厨房=水槽柜+灶台+冰箱；卫生间=马桶+洗手台+淋浴或浴缸；书房=书桌+办公椅；living_kitchen=客厅∪厨房清单。找位算法复用 `checkFurniturePlacement` 的旋转足迹求交逻辑反向使用；放置结果再用 checkFurniturePlacement 自检，保证执行器不产出它自己都判违规的摆放。

## 5. 验收、分流与完成门槛

**completion-gates.ts 硬门槛**（缺任一不得进 `completed`）：

1. 必需房间齐全（卧室数、brief 明确要求的房型）
2. 总面积（union）在目标 ±10%
3. **动线接入（意见④）**：从入户门出发，经"门 + 无墙开放边界"构成的连通图，每个房间可达。不要求每个 zone 自己有门——living_kitchen 这类开放空间、以及经门洞连通的空间都合法；判定对象是"被隔绝的房间"，不是"没门的 zone"
4. 用户明确要求的外窗存在于对应房间的外墙上
5. 每个卧室不穿厨/卫/其他卧室可达公共空间
6. 厨卫必备设备齐全（清单 required 项）
7. 每个卧室有床和衣柜

**失败分流（意见⑥）**：验收后按性质二分——

- **结构性失败**（房间数量/类型不符、总面积超差、动线不通、房间重叠、要求的外窗缺失）→ **回 Plan 层**：失败事实注入 Intent 修正 prompt，重新走 ①②③，通过后清场重建（`clearLevelForRebuild`），整流程重建上限 1 次。自由 repair loop 无权处理这些问题。
- **装饰性问题**（家具缺失/重叠/挡门、窗位微调、门 swing 方向）→ 自由修复 ≤2 轮（`maxRepairRounds` 默认 3→2），修复 prompt 注入 plan 快照 + "禁止增删/移动/缩放任何房间"硬约束，before/after 快照比对兜底（复用 checkModificationProtection 机制）：修复轮若动了结构，撤销该轮并直接以 completed_with_issues 收尾。

## 6. 与现有修改场景流程的关系（意见⑧，修正 v1 措辞）

v1 说"modify 一行不动"不准确。准确表述：**modify 的增量修改策略保留**（不走 plan-first、不清场重建，checkModificationProtection 等机制原样），但有两处明确接入：

1. `session.layoutPlan` 快照注入 modify 的 purpose（房间清单+面积+连接关系），替代模型 get_walls 自查——case-13 连接被破坏正是缺这份事实来源；
2. modify 完成判定同样过 completion-gates（门槛是场景性质，与怎么建出来无关）；modify 修复轮上限同步为 2。

即 `modify()` 函数体会被修改（注入快照、换完成判定），但其"增量修改、不推倒重来"的策略不变。

## 7. 需要修改和新增的文件

| 文件 | 性质 | 内容 |
|---|---|---|
| `src/layout-plan.ts` | 新增 | LayoutIntent/LayoutPlan 类型、Intent JSON 解析容错、共享几何工具（点入多边形/共享边长/网格 union） |
| `src/layout-partitioner.ts` | 新增 | §2 确定性分区器 |
| `src/plan-validator.ts` | 新增 | §3 的 11 项检查 |
| `src/plan-builder.ts` | 新增 | Intent 生成/修正 prompt 循环（≤3 轮）+ LLM 直出几何的实验开关 |
| `src/scene-executor.ts` | 新增 | §4 结构+门窗执行器 |
| `src/furniture-executor.ts` | 新增 | §4 家具执行器 |
| `src/furniture-checklist.ts` | 新增 | 房型必备清单（gates 与执行器共用） |
| `src/completion-gates.ts` | 新增 | §5 硬门槛 |
| `src/layout-metrics.ts` | 已完成 | 校验器第 7/10 项核心 + 生成后 layoutQuality |
| `src/agent.ts` | 修改 | generate() 重写为 §1 新序；修复分流；phase 接 gates；modify 两处接线；删两段施工 prompt；共享几何函数迁出 |
| `src/types.ts` | 修改 | WorkflowSession.layoutPlan/layoutIntent；SceneResult + layoutQuality/gateFailures/modelCallsUsed |
| `src/config.ts` | 修改 | maxRepairRounds 3→2；aiTemperaturePlan(0.3)/aiTemperatureGeometry(0)/aiTemperatureIntent 拆分 |
| `eval/assertions.ts`、`run-eval.ts` | 修改 | **意见⑦：现有断言继续判定成败，一条不弱化**；新增断言（gates 全过、模型调用数上限、required 家具放置率）同样判 fail，随所属批次落地即生效；报告增加 layoutQuality 分与调用数展示 |

## 8. 实施批次（4 批，A 先行，暂不接主流程）

**批次 A：计划层（纯离线，不碰 agent.ts / 不接 generate，零 token，~3-4 人日）**
`layout-plan.ts` + `layout-partitioner.ts` + `plan-validator.ts` + `furniture-checklist.ts` + `completion-gates.ts` + 全部单测。
验证：单测 fixtures——典型 Intent（单间/studio/一居/两居/三居/开放厨房）经分区器产出的 plan 全部通过校验器零 fatal；11 类非法 plan 各被对应检查拦下；gates 7 项各有过/不过 fixture；分区器对"无解 Intent"（如 30㎡ 塞 4 卧）明确报错不硬凑。
**批次 A 完成后交审：分区器对几个典型 Intent 的实际产出坐标（可视化或坐标清单），确认布局质量可接受，再批 B。**

**批次 B：接入主流程——规划前置 + 结构门窗施工（~3-4 人日）**
`plan-builder.ts` + `scene-executor.ts` + generate() 重写（家具暂沿旧路径）+ LLM 直出几何对比实验。
回归：case-01/02/03/04/06/07。硬指标：规划失败时零废场景；结构+门窗 0 模型调用（trace 断言）；case-03 面积 ≤±10%；case-04 三连跑收敛且总调用 <20。

**批次 C：家具执行器（~2-3 人日）**
`furniture-executor.ts` 接入，删旧家具 prompt。
回归：case-02/03/09。硬指标：required 家具放置率 ≥90%，且执行器输出经 checkFurniturePlacement 自检零违规。

**批次 D：门槛接线 + 失败分流 + 收尾（~2-3 人日）**
gates 接 phase、结构性失败回规划层（重建上限 1）、修复轮 ≤2 + plan 快照约束 + before/after 兜底、每轮 persistScene、温度拆分、eval 新断言（判 fail）与报告。
回归：全量 15 case 对照 §9 目标；人为构造缺床/隔绝房间场景验证不得进 completed；人为构造面积超差验证走重规划而非 repair loop。

## 9. 模型调用数与耗时预期

| 场景 | 现状 | 新流程构成 | 预期 |
|---|---|---|---|
| 简单（case-01/02） | case-02: 42 次 / 141s | 提取 1 + Intent 1-2 + 施工 0 + 修复 0-1 轮(≤4) | **3–7 次**（目标 ≤15 ✓），耗时约 30–60s |
| 三居（case-04） | 3 连败 | 提取 1 + Intent 1-3 + 施工 0 + 重规划 0-1 + 修复 ≤2 轮(≤5/轮) | **5–17 次**（目标 ≤20 ✓） |
| 自动工作流完成率 | — | 结构性失败被挡在建场景之前 | ≥90%（D 批实测） |
| 核心断言通过率 | — | 面积/房间数/动线由构造保证 | ≥80%（D 批实测） |
| 家具基础完整率 | case-02 有缺 | 清单+确定性找位+compact 降级 | ≥90% |

## 10. 已知风险与待定项

1. **分区器布局质量**：带状 v1 只会产出"横平竖直的规整户型"——这正是当前目标（对齐官方 Agent 的矩形房间水平），但主卧朝向、干湿分区等更细的偏好 v1 不管；批次 A 交审产出坐标时一起评估。
2. **L 形轮廓**（case-07）：批次 B 扩展 footprint 为轴对齐多边形；case-10 日式（榻榻米等）依赖家具清单扩展，不影响结构层。
3. **修复轮越界**：已有三重防线（prompt 约束、before/after 快照撤销、结构性问题根本不进修复轮），残余风险是撤销实现的完备性。
4. **MCP 能力核实**（批次 B 前）：add_door 的 swing 参数语义；版本保存 API（persistScene 之外是否有显式版本点）。
5. **search_assets 检索质量**：固定检索词能否稳定命中 compact 资产，批次 C 用真实 catalog 校准检索词表。
