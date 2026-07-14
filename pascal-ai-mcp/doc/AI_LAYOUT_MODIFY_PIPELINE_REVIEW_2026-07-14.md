# pascal-ai-mcp 户型生成与修改管线 Review

日期：2026-07-14

范围：生成策略、分区、校验、场景/家具执行器、NormProfile、ModifyOp、plan-first 修改状态、局部删除吸收与 `unionAdjacentPolygons`。未审、未改 `packages/mcp`。

## 验证结果

- `bun test`：371 pass，0 fail
- `bunx tsc --noEmit`：通过
- `bun run eval/run-eval.ts --dry-run`：20 个用例，0 个结构性问题

以上只说明现有测试和 dry-run 基线通过；下面的问题主要来自未覆盖的失败路径和设计不变式核对。

## 高危

### H1. 结构重建不是事务，清场失败会留下残缺场景

文件：`pascal-ai-mcp/src/agent.ts:1248-1263`

`rebuildScenePlanFirst` 先逐个 `delete_node` 清除 zone/wall/slab/ceiling/item，再调用 `executeLayoutPlan`。清除阶段的 `catch` 会吞掉所有异常，只按“已经被 cascade 删除”处理；真正的删除失败也会继续执行新计划。之后 `executeLayoutPlan` 即使返回 `executionIssues`，流程仍继续到家具、快照、`persistScene` 和完成回复。

失败场景：某个删除请求因 MCP/存储错误失败，旧节点仍在；随后新 plan 又创建部分节点，最终场景可能是旧结构、新结构和重复墙体的混合。若新计划执行到一半失败，现场停在半成品，但流程仍可能持久化并进入 `completed_with_issues`。没有旧版本恢复或原子提交保证，且下一次修改会把半成品当成当前场景继续处理。

### H2. 重建中途异常会让 session 快照与现场状态分裂，重试不能安全恢复

文件：`pascal-ai-mcp/src/agent.ts:1271-1302`、`pascal-ai-mcp/src/agent.ts:1350-1385`

新 `layoutIntent`、`layoutPlan`、`strategy` 和 `zoneRoomTypes` 在结构执行完成后、家具执行之前就写入 session；家具布置、家具修改、手动家具重放或后续诊断任一步抛错时，`modify()` 的 catch 只恢复 phase/保留 pending 请求，不回滚这些快照，也不回滚已删除/已创建的场景节点。

失败场景：新结构已经部分创建，`executeFurniturePlan` 因 MCP 错误中断。session 已声明新 plan，但现场可能缺 zone、缺家具或仍有旧节点；用户确认重试同一 pending modification 时，agent 会以新快照为事实再次执行，无法回到修改前的完整状态，可能重复创建或再次删除。

### H3. `StrategyDecision.notes` 没有生产消费者，违反“每个字段必须有消费者”不变式

文件：`pascal-ai-mcp/src/strategy.ts:32-49`、`pascal-ai-mcp/src/plan-builder.ts:303-306`

`deriveStrategy` 生成的 `decision.notes` 被放在 `StrategyDecision` 中并持久化到 `session.strategy`，但生成计划只追加 `applyStrategy(...).notes`，没有把 `decision.notes` 写入 `LayoutPlan.notes`、回复或 eval 输出；全仓生产代码也没有读取 `strategy.notes`。

失败场景：策略判定为田の字、狭长地块、厨房范围不在需求内等重要决策时，内部决策理由丢失。后续修改和审计只能看到结构结果，无法看到当初的策略理由；更直接地说，该字段当前是“打了标签没人看”。

## 中

### M1. JP `areaQuantization` 仅声明未执行，J7 的 0.25 帖约束没有进入生成/修改结果

文件：`pascal-ai-mcp/src/norms/profile.ts:75-86`、`pascal-ai-mcp/src/norms/profile-jp.ts:74-75`

`NormProfile` 暴露 `areaQuantization`，JP profile 设置为 `1.62㎡ × 0.25`，并提供 `quantizeAreaSqm`；但该函数除测试外没有生产调用，`normalizeRooms`、`applyModifyOps`、`partitionLayout` 和 validator 都使用原始 target/几何面积。

失败场景：JP 修改请求 `resize_room` 到 8.1㎡，或者模型生成 7.83㎡ 目标时，计划不会被量化到 0.25 帖网格。profile 看起来已启用 J7，实际场景与设计文档的面积对齐要求不一致。

### M2. 混合多 op 没有按“结构先、家具后”规范化，结果依赖模型输出顺序

文件：`pascal-ai-mcp/src/modify-ops.ts:217-225`、`pascal-ai-mcp/src/agent.ts:1018-1023`、`pascal-ai-mcp/src/agent.ts:1285-1293`

`applyModifyOps` 按 `plan.ops` 原顺序遍历，仅把家具 op 收集到数组，并没有先稳定地分成结构批次和家具批次。家具引用在当时的 intent 上解析，但结构重建后的家具操作统一延迟到新房间上执行。

失败场景：用户请求“删除卫生间，并移除卫生间里的洗衣机”，模型若先输出 `remove_furniture` 再输出 `remove_room`，家具 op 会先被接受，随后重建时目标房间已经不存在而失败；若家具 op 引用新增房间但被模型放在 `add_room` 前，则在解析阶段直接报找不到房间。相同语义只因模型输出顺序不同而得到不同结果。

### M3. 局部吸收路径沿用旧 `strategy` 快照，删除后策略可能已经过期

文件：`pascal-ai-mcp/src/agent.ts:1042-1054`

单独 `remove_room` 成功走 `absorbRoomInPlan` 时，传入 `rebuildScenePlanFirst` 的 strategy 是 `session.strategy` 原值；只有 session 没有 strategy 时才重新 derive。吸收路径改变了 intent 的房间数/类型，但没有根据新的 targets 重算策略。

失败场景：原 plan 是 2 卧室 standard/large，策略为 `tanoji`；局部删除一间卧室后变成 1 卧室，当前策略应回到 `standard_band`，但 session 仍保存 `tanoji`。下一次修改、eval 或审计读取到的 strategy 与当前 layoutIntent/layoutPlan 不一致。虽然下一次普通结构修改会重新 derive，但快照在中间状态已经不自洽。

### M4. `sceneDriftedFromPlan` 只比较排序后的面积多重集，等面积手改不会触发警告

文件：`pascal-ai-mcp/src/agent.ts:2545-2557`

漂移检测丢弃房间身份和几何位置，只排序 zone 面积后逐项比较。面积不变的平移、等面积重塑、两个同面积房间互换，都会返回 `false`。

失败场景：用户在编辑器中把一面分隔墙平移，但通过另一面墙补回面积，使每个 zone 面积仍在容差内；或者交换两个同面积卧室的位置。plan-first 结构修改不会出现“手动修改”确认，随后全量重建直接覆盖用户改动。

### M5. `unionAdjacentPolygons` 的 key 精度、共线判断和面积容差不一致，会把近邻间隙/重叠误当成合法并集

文件：`pascal-ai-mcp/src/layout-plan.ts:560-610`、`pascal-ai-mcp/src/layout-plan.ts:637-652`

端点以 `toFixed(3)` 作为拓扑 key，但简化共线使用 `1e-9`，最终面积检查只要求误差不超过 `max(0.01㎡, total×0.001)`。因此原始几何只差几十分之一毫米到约 0.5mm 时，key 会把不完全相同的边强行视为同一边，面积检查又会放行真实并集面积与返回多边形面积的差异。

可复现场景（直接调用当前函数）：两个 2m×2m 矩形，一个从 x=2.0000 开始，另一个从 x=1.9996 开始，存在 0.4mm 重叠；函数返回 `[0,0]-[4,0]-[4,2]-[0,2]`，面积 8㎡，而输入面积和为 8.0008㎡。同样的 0.4mm 间隙也会被桥接成完整矩形。代码注释声明 overlapping/disjoint 应返回 null，但此边界实际返回了并集。

## 低

### L1. `unionAdjacentPolygons` 缺少直接的几何边界测试，现有测试只通过吸收场景间接覆盖

文件：`pascal-ai-mcp/src/layout-plan.test.ts`（当前无 `unionAdjacentPolygons` 直接测试）、`pascal-ai-mcp/src/layout-partitioner.test.ts:518-601`

当前测试覆盖了若干 `absorbRoomInPlan` 正常布局和回退路径，但没有直接断言 union 对部分共享边、反向边、近似坐标、窄凹口、点接触、重叠、间隙、重复共线段的返回值。上面的 M5 边界因此不会被基线捕获，几何算法的核心契约没有独立回归保护。

## 结论

- 高危：3
- 中：5
- 低：1
- MCP 相关代码：未修改

结论：需要修改后再合并。首先应处理重建清场/执行失败后的事务一致性，以及 session 快照与现场状态分裂；其次处理策略/NormProfile 的未消费字段和混合 op 顺序问题。
