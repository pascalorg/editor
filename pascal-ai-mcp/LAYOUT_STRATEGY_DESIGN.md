# 户型策略层（LayoutStrategy）设计

状态：方案已确认（2026-07-10），按 §6 批次落地。落点全部在 pascal-ai-mcp（不动 packages/mcp）。

> 真相源约定：规则的**语义、判定条件和理由**以本文档为准；**具体数值**一旦落码，以代码为准（NormProfile 数值见 `src/norms/profile-*.ts`，策略决策表见 `src/strategy.ts`），代码注释回指本文档章节号。修改流程固定为：**改本文档规则 → 同步代码 → eval 回归**。

## 1. 定位与原则

策略层是 AI 生成流程里的一个**确定性中间层**：不让模型每次从零自由发挥，而是先由规则根据需求判定户型类型、面积段、厨房模式、面积分配等，再引导/约束 LayoutIntent 的生成和分区器的执行。

三条不变式：

1. **零模型调用**——`deriveStrategy` 是纯函数（决策表），可单测穷举；
2. **每个输出字段必须有代码消费者**——没有消费者的字段不进 schema（避免"打了标签没人看"）；
3. **每条约束有明确的执行档位**（§4）——能用规则强制执行的不劳烦模型。

## 2. 管线位置

```
brief 确认（现有模型调用，扩展抽取 BriefFacts）
   ↓
deriveStrategy(facts, targets, normProfile)      ← 纯函数，零模型调用
   ↓  StrategyDecision
buildLayoutPlan:
   ① Intent prompt 注入 strategy 约束（引导模型）
   ② parseLayoutIntent → applyStrategy(intent, strategy)（规则静默修正）
   ③ partitionLayout(intent, strategy)（拓扑选择 + 参数 + 打分权重）
   ④ validateLayoutPlan(plan, targets, strategy)（一致性硬校验 → plan_rejected 回路）
```

不新增模型调用；失败分流复用现有 correction loop 和 priorFailures 机制。
策略决策随 plan 快照持久化进 `WorkflowSession`（modify 流程要能看到当初的决策）。

## 3. 文字规则决策表（本文档的核心，同步/修改都看这里）

### 3.1 areaBand（面积段）

由 `targetTotalAreaSqm` 判定。断点是**默认值选择器**，不是硬门槛（typology 同时看房间清单）。

| 档位 | 区间 | 对应日本市场典型 |
|---|---|---|
| tiny | < 25㎡ | ワンルーム / 1K（单身） |
| compact | 25 – 45㎡ | 1DK / 1LDK |
| standard | 45 – 70㎡ | 2LDK / 紧凑 3LDK |
| large | ≥ 70㎡ | 3LDK+ / 家庭户型 |

### 3.2 typology（户型拓扑）

枚举值**只包含分区器当前真能执行的拓扑**；每落地一个新拓扑（§6 S3+），才开放对应枚举值。

narrow_lot 落地细则（S3，2026-07-10）：单房间 brief 仍判 studio（singleRoomPlan 处理）；无公共枢纽（living/LDK/hallway 均缺）时分区器静默回退 standard 路径（corridor-hub 本身就是线性的）；有 footprintHint 时地块尺寸固定为 footprint（短边为宽），与目标总面积冲突时以地块为准；无尺寸仅有"长条"关键词时在 2.4–上限 区间搜索长宽比。轮廓长宽比上限走独立参数 `maxFootprintAspectNarrowLot`（default 4.0 / jp 4.5，代码为准）。拓扑形态：枢纽（LDK）全宽置于入口端（z=0），服务房型照常嵌入；其余房间沿进深堆叠——公共房型贴枢纽（厨房保湿区）、私密房型在远端——由右侧纵向走廊串联；堆叠房间 ≤1 时省走廊直连枢纽；嵌入房间一律开门向宿主（走廊只覆盖枢纽顶边一段，band 的"顶角开向走廊"规则不适用）。

| 值 | 判定规则（v1） | 分区器拓扑 | 状态 |
|---|---|---|---|
| studio | 单房间 | singleRoomPlan | 现有 |
| standard_band | 其余全部 | band guillotine（有枢纽）/ corridor-hub（无枢纽） | 现有 |
| narrow_lot | siteHint 长宽比 > 2.2，或 brief 明示长条地块 | 线性拓扑（沿长边排房） | ✅ S3（2026-07-10） |
| tanoji（田の字） | standard/large 档 2–3 卧（brief 有明确卧室数；站点约束 narrow_lot/l_shape 优先） | 中央縦走廊：玄関→廊下、两侧洋室、尽头全宽 LDK | ✅ S4（2026-07-10） |
| l_shape | brief 明示 L 形（关键词，站点约束） | 主翼公区 + 侧翼私区，footprint 带真 L 多边形 | ✅ S5（2026-07-10） |

tanoji 落地细则（S4，2026-07-10）：**偏好拓扑**——田の字候选可行即用，全部不可行时回退 band 搜索（纯比分竞争会被 band 更大的可行域挤掉，故不混池比分）；玄関格子生在中央走廊柱底端（宽=走廊宽，豁免最小净宽检查，日式 0.9–1.2m 玄関属正常），够不着走廊的侧翼格子（如玄関旁的浴室）开门向玄関；侧翼服务房型在下（近玄関）、私密房型在上（近 LDK）。

l_shape 落地细则（S5，2026-07-10）：**站点约束**——只出 L 候选；`LayoutFootprint` 扩展可选 `polygon`（轴对齐，width/depth 保持包围盒语义），消费方三处：validator 覆盖率/面积基数用真 L 面积、scene-executor 外墙检测（开窗/入户门）沿 L 边界、`footprintBoundary`/`longestExteriorEdge` 多边形感知；主翼=单排 band（LDK 最左、其上叠侧翼，浴室/储物/玄关照常嵌入 LDK），侧翼=私密房型堆叠，≥2 间时带内侧走廊（走廊底边开向 LDK），1 间时直连 LDK；翼宽比例在 0.35/0.45/0.55×W 中搜索。

### 3.3 kitchenMode（厨房模式）

| 条件（按序判定） | 结果 |
|---|---|
| 用户明示开放式（BriefFacts.kitchenPreference = open） | open |
| 用户明示独立厨房 | closed |
| 未明示，areaBand ∈ {tiny, compact} | open（合并为 living_kitchen） |
| 未明示，areaBand ∈ {standard, large} | closed |

**用户显式意愿永远压过档位默认**；档位默认与用户意愿冲突时（如 30㎡ 要独立厨房）不硬改，转为 validator warning 进 notes。

**范围守卫（kitchenInScope，2026-07-10 补）**：厨房模式指令只在厨房确在需求范围内时注入 prompt——需求没有明确房间清单（默认全屋）、清单含厨房/LDK、或用户明示了厨房偏好，三者满足其一。只要求卧室的 brief（eval case-12 场景）不注入，否则"保留独立的厨房房间"这类措辞会诱导模型加建范围外房间。`kitchenMode` 字段照常判定（schema 稳定），仅 prompt 注入受门控；`applyStrategy` 的合并规则不受影响（它只处理 intent 里已存在的房间，不加建）。

### 3.4 roomAreaTargets（面积分配）

不在策略层另建数值——**从 NormProfile 的面积档位表取**（`NORMS_PROFILE_DESIGN.md` §2.3），含 LDK/DK 随卧室数的阶梯。策略层只做两件事：按 areaBand 在舒适区间内取 ideal 值；总面积不够装下全部 ideal 时按类型优先级压缩（卧室、LDK 保 ideal，走廊/储物先压到 min）。

### 3.5 窗与邻接

- 需窗房型沿用 `defaultRequiresWindow`（卧室/客厅/LDK/书房），策略层只在 BriefFacts.explicitWindowRooms 有额外要求时补标记；
- 邻接沿用 `LayoutIntent.adjacency`，策略层按 typology 补常规邻接（如厨房贴 LDK）。

### 3.6 打分参数（布局质量偏好）

进分区器 scorer 的惩罚权重，不拦截只排序。已落码为 `NormProfile.scoring`（`ScoringParams`：idealFootprintAspect/footprintAspectWeight、roomAspectSoft/roomAspectExcessWeight、corridorShareSoft/corridorShareExcessWeight），统一入口 `scoreCandidate()`（layout-partitioner 导出）——即原三项内联 penalty 的参数化。策略级 per-decision 权重覆盖等有规则真正需要变权重时再加（不变式 2）。人工评测发现的坏模式沉淀为**新惩罚项 + 权重**，不是自由文本。

### 3.7 刻意不做的（等有消费者再加）

`circulationMode`（只有 band 拓扑时是空标签）、`avoidPatterns`（= scorerWeights 的语义化别名）、`furnitureProfile`（家具执行器已确定性；分档是 furniture-checklist 按 profile 增删的事）、用户显式指定户型（"我要田字形"，已拍板暂缓）。

## 4. 约束执行三档

| 档 | 内容 | 机制 |
|---|---|---|
| 规则直接执行 | open 厨房→合并 living_kitchen；面积缺省/越界→夹到档位区间；补窗标记；补玄关（J5） | `applyStrategy()` 静默修正，**不消耗修正轮**，修正记入 notes |
| 需模型配合 | 房间清单覆盖 brief 要求、名称跟随用户语言 | prompt 注入 strategy 摘要 + validator 一致性检查 → correction loop |
| 布局质量偏好 | 少走廊、忌碎空间、忌狭长 | scorerWeights 进分区器打分 |

## 5. 输入输出 schema（S1 已落码，代码为准：`src/strategy.ts`）

```ts
type BriefFacts = {                       // v1：从 briefSummary 确定性关键词抽取（零模型调用）
  kitchenPreference?: 'open' | 'closed'   // 词表 src/lang/strategy-vocab.ts；"2LDK" 记为 open
  siteHint?: { widthM: number; depthM: number }  // S3：地块尺寸（"宽5米长18米"/"5m×18m"三语）
  narrowLot?: boolean                     // S3：明示长条地块但未给尺寸
}

type StrategyDecision = {
  typology: 'studio' | 'standard_band' | 'narrow_lot'  // 枚举随 S4+ 扩展
  areaBand: 'tiny' | 'compact' | 'standard' | 'large'
  kitchenMode: 'open' | 'closed'
  kitchenModeSource: 'user' | 'band_default'  // 冲突规则（§3.3）需要知道谁定的
  kitchenInScope: boolean                 // §3.3 范围守卫：false 时厨房模式指令不进 prompt
  entryRequired: boolean                  // J5：jp 档案下必须有玄関
  footprintHint?: { widthM: number; depthM: number }  // S3：仅 narrow_lot 时设置，消费者=分区器
  notes: string[]                         // 决策依据，进 plan.notes 和 eval 报告
}
```

按 §1 不变式 2，**尚无消费者的字段不进 schema**，随消费者批次落码：`roomAreaTargets`（S2，等 profile 面积档位）、`scorerWeights` / `partitionParams`（S2，等 scorer 抽出）、`explicitWindowRooms` / `ensuiteBedroomCount`（暂无消费者）。`siteHint` / `footprintHint` 已随 S3 落码（2026-07-10）。BriefFacts v1 用确定性关键词扫描而非扩展模型抽取 schema——不动 brief prompt，回归风险为零；S3 的 siteHint 也走关键词抽取（`detectSiteHint` 三语尺寸模式），模型抽取版等确定性抽取在 eval 中暴露漏检时再评估。

抽取失败兜底：字段缺省时按 areaBand 默认规则走——**策略层永远能给出决策，绝不因输入不全而失败**。

## 6. 实施批次

| 批次 | 内容 | 回归要求 |
|---|---|---|
| S0 | ✅ 完成（2026-07-10）：NormProfile 骨架 + default 档案 + JP 分区参数/默认面积 + `PASCAL_NORM_PROFILE` 选择（详见 NORMS_PROFILE_DESIGN.md §4） | 行为不变，292 单测过；线上 eval 待跑 |
| S1 | ✅ 完成（2026-07-10）：`src/strategy.ts`（deriveBriefFacts/deriveStrategy/applyStrategy/strategyPromptLines）+ prompt 注入 + session.strategy 快照。一致性执行走 applyStrategy 确定性修正（比 validator 事后拦截少一轮修正），冲突只记 note | 303 单测过；线上 eval 待跑，预期修正轮数下降 |
| S2 | ✅ 完成（2026-07-10）：scorer 抽出（`scoreCandidate` + `NormProfile.scoring`）；profile 面积档位进 plan-validator（`roomAreaBounds` 四界模型，含 LDK 阶梯）；J7 帖量化（面积级，`quantizeAreaSqm`）；遗留③（分区器全部 + 校验器高频失败串带 `IssueL10n`，构造保证/仅 llmGeometry 路径的串保持 zh 直通）。**未含**：layout-metrics 场景侧 band 表接 profile、UB 规格绑 areaBand、坐标级量化——随后续批次 | 309 单测过，default 行为等价；线上 eval 待跑 |
| S3 | ✅ 完成（2026-07-10）：narrow_lot 线性拓扑（`tryNarrowLotLayout`，细则见 §3.2）+ footprintHint 管道（词表 `detectSiteHint`/`detectNarrowLot` → BriefFacts → StrategyDecision → `partitionLayout(intent, profile, strategy)`）+ `maxFootprintAspectNarrowLot`（default 4.0 / jp 4.5）+ 预览 `layout-previews/07-narrow-lot.svg` | 322 单测过（含 case-06 复刻分区断言），default 旧路径 SVG 逐字节不变；线上 eval case-06（expectedBounds 5×18 即选型断言）待余额恢复后跑 |
| S4 | ✅ 完成（2026-07-10）：田の字拓扑（`tryTanojiLayout`，细则见 §3.2）+ 偏好回退分发 + 判定规则（2–3 卧 × standard/large）+ 预览 `layout-previews/08-tanoji.svg`（validator score 100） | 328 单测过（含 2LDK 复刻分区断言 + 回退断言） |
| S5 | ✅ 完成（2026-07-10）：l_shape 拓扑（`tryLShapeLayout`，细则见 §3.2）+ `LayoutFootprint.polygon` schema 扩展（批次 B 遗留 §10.2 落地）+ 词表 `detectLShape` + 预览 `layout-previews/09-l-shape.svg`（validator score 100） | 328 单测过（含真 L 面积断言 + 单侧翼直连断言）；线上 eval 新 case 待补 |

长期反馈回路：eval/人工评测（layout-previews SVG）发现坏模式 → 新增 scorer 惩罚项或 validator 检查 → 调本文档 §3.6 权重表 → 同步代码。

## 7. 已拍板决策记录

| 日期 | 决策 |
|---|---|
| 2026-07-10 | areaBand 断点 25/45/70；拓扑顺序 narrow_lot → 田の字 → l_shape；用户显式指定户型暂不做；LDK/DK 下限随卧室数阶梯；UB 规格绑定 areaBand；洗面脱衣 1帖 fatal / 2帖 comfortable |
| 更早 | 帖=1.62㎡；卫浴分离方案 B；窗地比 executor 直接开够 + gate 兜底；LDK 语汇不进 Intent 规则（由策略层消化） |
