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

1. **footprint 锁定**（✅ M2）：修改时 `W` 固定为现状 plan 的 W（消掉最大变数）；`D` 允许随总面积增减浮动。add/remove_room 改变总面积时，总面积 = 旧总面积 ± 该房间面积（其他房间面积**不重新分配**，靠分区器现有 scale 机制微调）。锁定后无可行布局时**放开轮廓重搜并显式记 note**（"做不到时不硬凑"），变更幅度如实进回复；
2. **偏离惩罚（新 scorer 项）**（✅ M2）：`planDeviation(plan, previousPlan) = Σ 同 id 房间矩形中心位移(m)`，乘 `ScoringParams.deviationWeight`（default/jp 均 3/m，代码为准）加在候选罚分上，仅传入 `previousPlan` 时生效——"动得最少的可行方案胜出"，正好是 §3.6 反馈回路框架下的一个常规惩罚项；
3. **带序保持**（v1 由 1+2 吸收）：现有分区器带内排序本就是确定性的（按房型固定顺序），锁 W + 偏离惩罚已使同类候选中"保持原排列"者胜出；显式的"旧排列种子 + 失败回退全排列"等 eval 暴露洗牌案例再加。

配套（M2）：小书房（≤ carveablePublicMaxSqm）加入枢纽嵌入房型（kitchen/dining/study）——"在客厅里划一间书房"（case-13 原文）本质是嵌入操作，作为私密全进深柱的 ~7㎡ 书房在锁宽下必然过窄，会迫使每次此类修改都改动轮廓；书房嵌入角位优先贴外墙侧（需外窗）。现有预览 SVG 逐字节不变（现有意图无书房）。

预期效果（已写进离线分区断言）：resize 单房间 → 全部共有房间位移合计 <3m；add 小房间（嵌入路径）→ 合计 <8m。做不到时轮廓回退 + note 如实告知。

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
| M0 | ✅ 完成（2026-07-13）：`src/modify-ops.ts`——ModifyOp schema + `parseModifyOps`（容错解析，部分成功保留合法 op + 错误清单）+ `resolveRoomRef`（id→名称→词表类型唯一，歧义报错）+ `applyModifyOps`（纯函数，面积过 `TYPE_TO_KIND`+`roomAreaBounds` 判界：fatal 拒绝/soft 警告） | 346 单测过；零模型调用可测 |
| M1 | ✅ 完成（2026-07-13）：`src/furniture-modify.ts` 家具三件套（增=检索+贴墙扫描；删=目录 id 匹配→名称兜底，多匹配删最后放置；换=先算后删，放不下不删）+ agent 快速路径（`tryFurnitureModify`：一次模型调用译 op，空 ops/结构 op/解析失败静默回退 legacy；无 intent 快照的旧场景家具修改也可用）+ eval case-16/17/18（增/删/换，`itemChanges` 断言：item diff 匹配 + structureUntouched） | 353 单测过 + dry-run 18 用例 0 结构问题；线上 case-16/17/18 待余额恢复后跑 |
| M2 | ✅ 完成（2026-07-13）：稳定性机制（`partitionLayout` 第 4 参数 `{previousPlan}`：宽度搜索收敛为旧 W + `planDeviation`×`deviationWeight` 进候选罚分 + 锁定无解时放开轮廓重搜记 note）+ agent 结构管线（`tryPlanFirstModify`：翻译 op → `applyModifyOps` → deriveStrategy → 稳定性重分区 → validator → 结构全量重建（清 zone/wall/slab/ceiling/item 后 `executeLayoutPlan` + 清单家具重摆）→ session 三快照 + zoneRoomTypes 刷新；rename-only 走 `apply_patch` 改 zone 名不重建；拒绝路径 `rejectPlanFirstModify` 引用具体原因）+ 小书房入枢纽嵌入。**v1 与原设计的偏差**：diff 预览不再单独一轮确认——修改本就有确认环节，变更明细（applyModifyOps/partition notes）在重建后随回复给出；预生成预览等 ingest 侧接入翻译后再评估 | 357 单测过（case-13/14 复刻为离线分区断言 + 轮廓回退断言 + 无 stability 参数时与旧行为逐字段相等）；预览 SVG 逐字节不变 |
| M3 | **离线部分 ✅（2026-07-13）**：漂移检测（`sceneDriftedFromPlan`：房间数 + 排序面积档对比，容差 max(0.8㎡, 10%)——刻意不比名称（rename 是合法非结构编辑，rename 后 plan 快照名称同步）也不比墙几何（v1 无持久节点快照））+ 确认握手（漂移时警告一次 `modifyDriftWarning`，`session.modifyDriftConfirmed` 标记，同一 pending 请求确认后重建；换新请求时标记作废）+ `PASCAL_MODIFY_LEGACY=1` 开关（强制走旧路径，对照实验用）。旧场景回退路径已随 M2 落地（无快照 → 结构修改回 legacy，家具修改照常）。**剩余：线上 eval（case-13/14/16/17/18）**，key 恢复后跑 | 360 单测过；全绿后删 legacy 路径；文档状态改"已落地" |

M0–M2 核心为确定性代码，模型服务不可用也能开发（ModifyOp 翻译用 fixture 测）；唯一新模型 prompt（修改请求 → ModifyOp JSON）在 M1 一并写好但可后验。
