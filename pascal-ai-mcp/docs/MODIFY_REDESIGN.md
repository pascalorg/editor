# 修改流程重设计（Modify = 编辑 Intent，不是编辑场景）

状态：**已确认（2026-07-13）**，§8 四项按建议方案拍板，按 §9 批次落码。落点全部在 pascal-ai-mcp（不动 packages/mcp）。

**与生成流程的边界**：修改流程不依赖生成流程的内部实现，只依赖三个契约——① `LayoutIntent` schema 向后兼容；② 生成完成后写全 session 快照（`layoutIntent` / `layoutPlan` / `strategy`，这是两条流程唯一的接口）；③ `partitionLayout` / `executeLayoutPlan` 签名扩展用可选参数。守住这三条，生成侧任意演进（新拓扑、调参、预设户型库产 plan）对修改侧透明，且质量提升自动流入修改侧（同一分区器/执行器）；稳定性锚点是 session 的旧 plan 快照而非当前生成算法，生成算法升级不会让存量场景的修改行为漂移。

> **真相源约定**：与姊妹文档一致——语义和判定规则以本文档为准，数值落码后以代码为准，修改流程 = 改文档 → 同步代码 → eval 回归。
>
> 姊妹文档：[LAYOUT_STRATEGY_DESIGN.md](LAYOUT_STRATEGY_DESIGN.md)（策略层）、[NORMS_PROFILE_DESIGN.md](NORMS_PROFILE_DESIGN.md)（规范档案）。

## 1. 问题与定位

生成侧已是 plan-first：模型只出语义（LayoutIntent），坐标由分区器确定性计算，家具由执行器确定性摆放。**修改侧（`agent.ts` `modify()`）还是旧架构**：模型拿 MCP 工具自由编辑场景、自己算坐标，靠护栏（原墙只读锁、guard prompt、plan 快照注入、事后 gates）兜底。已知病灶：

- 新增/调整房间的质量无人把关（eval case-13：要求 6–8㎡ 书房，模型建了 15㎡——护栏只查"没拆旧的"，不查"新的合不合规"）；
- 家具修改没有确定性路径（增删换全靠模型裸调工具，不过 `checkFurniturePlacement`）；
- 删除操作豁免全部保护，级联后果只靠事后 gates；
- `session.layoutPlan` 快照修改后不刷新，连续修改会与现场脱节。

**决策（2026-07-13 已拍板）：不给旧流程打补丁，直接在新架构上重建修改流程。** 核心原则与生成侧相同：**模型只翻译意图，坐标永远确定性**。

## 2. 管线

```
用户修改请求（session.pendingModification）
   ↓  模型（本流程唯一模型调用）：自然语言 → ModifyOp[]（零坐标）
parseModifyOps → 校验 op 引用（房间 id/名称能否解析到现有 plan）
   ↓
┌─ 家具类 op ────────────────────────────────────────────────┐
│ 不重分区、不动结构：直接映射到家具执行器的确定性子操作      │
│ （§5），改完重跑 checkFurniturePlacement + gates            │
└────────────────────────────────────────────────────────────┘
┌─ 结构类 op ────────────────────────────────────────────────┐
│ applyModifyOps(session.layoutIntent, ops) → 新 LayoutIntent │
│   ↓ deriveStrategy（facts 不变，targets 随 op 更新）        │
│   ↓ partitionLayout(intent, profile, strategy,             │
│                      { previousPlan, lockFootprint })      │
│     ── 稳定性约束见 §4                                      │
│   ↓ validateLayoutPlan（NormProfile 面积界天然生效）        │
│   ↓ diff(旧 plan, 新 plan) → 用户可读的变更预览             │
│   ↓ 确认后：结构重建（§6）→ 家具执行器 → gates              │
└────────────────────────────────────────────────────────────┘
   ↓
session.layoutIntent / layoutPlan / zoneRoomTypes 快照全部刷新（修复病灶④）
```

失败分流复用现有 correction loop：ModifyOp 解析失败/引用不到房间 → 修正 prompt 重试（≤2 轮）；分区/校验失败 → 引用失败原因回给用户（"这个改动放不下，因为…"），**不静默放弃也不硬改**。

## 3. ModifyOp schema（v1）

```ts
type ModifyOp =
  // --- 结构类（触发重分区） ---
  | { op: 'add_room';    room: { name: string; type: RoomType; targetAreaSqm?: number };
      near?: string }                          // near：希望邻接的房间 id/名称 → intent.adjacency
  | { op: 'remove_room'; room: string }        // id 或名称（三语 room-vocab 解析）
  | { op: 'resize_room'; room: string; targetAreaSqm: number }
  | { op: 'rename_room'; room: string; name: string }   // 纯元数据，不重分区
  // --- 家具类（不触发重分区） ---
  | { op: 'add_furniture';    room: string; item: string; }   // item 走目录检索词
  | { op: 'remove_furniture'; room: string; item: string; }
  | { op: 'swap_furniture';   room: string; from: string; to: string }

type ModifyPlan = { ops: ModifyOp[]; note?: string }   // note：模型对歧义的说明，进回复
```

规则：

- **一次请求可以多 op**（"删掉书房，主卧扩到 18 平"→ 两个 op），按结构类先、家具类后的顺序应用；
- 房间引用解析顺序：plan 房间 id 精确匹配 → 名称精确匹配 → room-vocab 类型匹配（唯一时）；解析不到 → correction loop；
- `rename_room` 和纯家具 op **不触发重分区**（结构零变化是这类请求的正确语义）；
- 面积语义：`resize_room` 的目标面积会被 NormProfile 面积界夹紧（超 fatal 界直接拒绝并说明，在 soft 界外记 warning note）——case-13 的 15㎡ 书房问题在 schema 层面消灭；
- 与旧流程的 `pendingOperation: 'create'|'update'|'delete'` 分类兼容：路由层把三类都译成 ModifyOp（delete 确认机制保留，见 §7）。

## 4. 布局稳定性（本设计唯一的新算法问题）

重跑分区器不能把用户没让动的房间洗牌。三层机制，全部确定性：

1. **footprint 锁定**：修改时 `W` 固定为现状 plan 的 W（消掉最大变数）；`D` 允许随总面积增减浮动。add/remove_room 改变总面积时，总面积 = 旧总面积 ± 该房间面积（其他房间面积**不重新分配**，靠分区器现有 scale 机制微调）；
2. **偏离惩罚（新 scorer 项）**：`planDeviationPenalty = Σ 房间矩形中心位移(m) × weight`，对新旧 plan 都存在的房间计算；进 `ScoringParams`（`deviationWeight`，仅修改路径非零）——"动得最少的可行方案胜出"，正好是 §3.6 反馈回路框架下的一个常规惩罚项；
3. **带序保持**：分区器候选生成时，旧 plan 中各房间的带位置（public/private band、列顺序）作为首选排列先试，失败才回退全排列搜索。

预期效果分级（写进 eval 断言）：resize 单房间 → 其余房间中心位移 ≤0.5m；add/remove → 同带房间保序、对侧带房间位移 ≤0.5m。做不到时不硬凑——diff 预览会如实展示变化范围，由用户确认。

## 5. 家具类 op 的确定性执行

全部复用 furniture-executor 现有能力，模型零参与：

| op | 执行 |
|---|---|
| remove_furniture | `item` 经目录检索词匹配房间内现有 item 节点（zoneRoomTypes 定房间、catalog tags 定物品）→ MCP 删除节点；匹配多个时删最后放置的一个并在回复说明 |
| add_furniture | 目录检索 → `rankCandidates` → `findWallPlacement` 贴墙扫描（带门净空/碰撞检查）→ 放置；放不下 → 失败原因如实回复（复用灶台修复后的"房间挤 vs 目录缺规格"细分） |
| swap_furniture | remove + add 原子执行；add 失败则回滚 remove（先算好位置再删旧的） |

改完重跑 `checkFurniturePlacement` + furniture gates，结果进回复。

## 6. 结构重建与手动编辑政策

**v1 重建方式：结构全量重建**——新 plan 经 `executeLayoutPlan` 重建墙体/门窗/房间，家具执行器重摆。不做"结构增量 diff 施工"（那是 v2 优化，复杂度高、v1 收益低——重建本身零模型调用、秒级完成）。

**手动编辑政策（待拍板，§8-1）**：重建会覆盖用户在编辑器里手改的结构。v1 建议方案 A：

- 修改前对比现场与 `layoutPlan` 快照（复用 `structuralDrift` 快照比对）：
  - 无漂移 → 直接走新流程；
  - 有漂移 → 提示"检测到手动修改，AI 结构修改将以重新规划为准重建（家具类修改不受影响）"，用户确认后执行；**家具类 op 不受漂移影响，永远可用**；
- 用户手动放置的家具（不在 furniture-checklist 内的 item）在重建后按原房间归属尽力重放（房间还在 → 重新扫描放置；房间没了 → 回复中列出）。

**版本安全**：重建前 `persistScene` 留档旧版本，回复中带旧版本号——出问题可回滚（存储层已有版本机制，不新增）。

## 7. 与现有路由的衔接

- `ingest()` 的意图分类（update/delete/create）不动；`awaiting_modification_confirmation` 确认机制不动（删除的二次确认保留——remove_room 属破坏性）；
- `modify()` 内部整体替换为新管线；旧自由编辑路径保留在 `PASCAL_MODIFY_LEGACY=1` 环境变量后面（对照实验用，不进 AppConfig，与 `AI_PLAN_LLM_GEOMETRY` 同风格），稳定后删除；
- 无 `layoutIntent` 快照的旧场景（新流程上线前生成的）：结构类 op 走 legacy 路径并在回复注明，家具类 op 照常走新路径（只需 zoneRoomTypes 或名称回退）。

## 8. 待拍板项

| # | 问题 | 建议 |
|---|---|---|
| 1 | 手动编辑政策：漂移时结构修改是"确认后重建"（方案 A）还是"拒绝并引导用户手动改"（方案 B） | A——B 会让 AI 修改在真实使用中大概率不可用 |
| 2 | remove_room 后的面积语义：footprint 缩小（总面积减）还是其余房间瓜分（总面积不变） | 缩小为默认；"把书房并进主卧"这类瓜分语义等有真实需求再加 merge_rooms op |
| 3 | 稳定性位移阈值（§4 的 0.5m）与 deviationWeight 数值 | 落码时以 eval/预览实测定，文档只定语义 |
| 4 | 旧流程退役时间 | case-13/14 + 新家具 eval case 全绿后删 legacy 路径 |

## 9. 实施批次

| 批次 | 内容 | 回归要求 |
|---|---|---|
| M0 | ModifyOp schema + `parseModifyOps`（容错解析，同 parseLayoutIntent 风格）+ `applyModifyOps`（纯函数：intent × ops → intent）+ 房间引用解析（三语） | 单测穷举各 op/引用失败/夹紧规则；零模型调用可测 |
| M1 | 家具类 op 三件套（§5）+ agent 路由（家具 op 不走重分区）+ 家具修改 eval case ×3（增/删/换） | 离线 e2e（真实 MCP、0 token）；新 eval case 断言 |
| M2 | 稳定性机制（footprint 锁 + deviationPenalty + 带序保持）+ 结构类 op 全管线 + diff 预览 | 稳定性单测（resize 不洗牌断言）；case-13/14 复刻为离线分区断言 |
| M3 | 手动编辑漂移检测接入 + 旧场景回退路径 + legacy 开关 + 线上 eval（case-13/14 + 家具 case） | 全绿后删 legacy；文档状态改"已落地" |

M0–M2 核心为确定性代码，模型服务不可用也能开发（ModifyOp 翻译用 fixture 测）；唯一新模型 prompt（修改请求 → ModifyOp JSON）在 M1 一并写好但可后验。
