# pascal-ai-mcp 户型生成与修改管线复核

日期：2026-07-14

本次只读复核未修改实现代码，未触碰 `packages/mcp`。

## 验证结果

- `bun test`：387 pass，0 fail
- `bunx tsc --noEmit`：通过
- `bun run eval/run-eval.ts --dry-run`：20 个用例，0 个结构性问题

上一版问题复核：

- `StrategyDecision.notes` 已写入 `LayoutPlan.notes`，已修复。
- 混合结构/家具 op 已按最终房间集合解析，已修复上一版的顺序依赖。
- 局部吸收后 strategy 已按新 intent 重新 derive，已修复。
- `unionAdjacentPolygons` 精度已提高，0.4mm 间隙/重叠已加入测试并拒绝，已修复该边界。
- 清场残留检查已增加，但重建整体仍不是事务性的，见 H1/H2。

## 高危

### H1. 新 plan 执行失败仍会继续家具、刷新快照并完成持久化

文件：`pascal-ai-mcp/src/scene-executor.ts:255-277`、`pascal-ai-mcp/src/agent.ts:1273-1323`

`executeLayoutPlan` 对 `create_room`、读墙、开门窗等失败通过 `callWithRetry` 收集到 `executionIssues` 后继续执行，并返回报告；`rebuildScenePlanFirst` 没有在 `built.executionIssues` 非空时中止，而是继续执行家具和手动家具重放，随后刷新 `zoneRoomTypes/layoutIntent/layoutPlan/strategy` 并进入 `finishPlanFirstModify`。

失败场景：新 plan 创建第二个房间失败，或者建墙/开门失败。现场已经不是旧场景，也不是完整新场景，但流程仍可能刷新 session 快照并 `persistScene`，最终以 `completed_with_issues` 表示成功完成。下一次修改会把不完整结构当成当前 plan 的确定性结果继续操作；清场后的 leftover 检查无法覆盖这个阶段的半成品。

### H2. 清场和后处理没有回滚；“场景未持久化，可重试”并不等于现场未改变

文件：`pascal-ai-mcp/src/agent.ts:1255-1271`、`pascal-ai-mcp/src/agent.ts:1311-1323`、`pascal-ai-mcp/src/agent.ts:1350-1404`

清场阶段仍吞掉单个 `delete_node` 异常，只在之后检查是否有剩余节点；如果部分节点已经删除、后续删除或 `get_scene` 检查失败，现场已经被破坏但没有恢复。即使所有执行阶段完成，session 快照也在 `finishPlanFirstModify` 的诊断、`persistScene`、gates 之前写入；这些后处理抛错时，`modify()` 会保留 pending 请求并允许重试，但不会恢复现场或旧快照。

失败场景：旧场景清掉一半后清场检查请求失败；或者新结构已建完但 `collectDiagnostics`/`persistScene` 失败。用户确认重试时，pending 修改会在已删除或已重建的现场上再次执行，无法回到修改前的原子状态。注释中的“场景未持久化，可重试”只描述版本存储，不保证现场状态。

## 中

### M1. 漂移检测仍无法识别房间身份交换

文件：`pascal-ai-mcp/src/agent.ts:2567-2604`

新的 `sceneDriftedFromPlan` 已从面积比较升级为 polygon 集合比较，但输入只有 zone polygon，没有 zone id/name/type；它把当前所有 zone 与 plan 中所有 room 做无序匹配。因此它验证的是“几何集合相同”，不是“每个房间仍在原来的位置/身份”。

可复现场景：plan 中有两个相同大小的卧室矩形 A、B；现场交换两个 zone 的身份/名称或类型，但 polygon 集合不变。当前函数返回 `false`，不会触发人工修改警告，后续重建会在不提示的情况下覆盖这类手动房间交换。当前新增测试覆盖了等面积重塑，但没有覆盖这种等几何集合、不同房间身份的场景。

### M2. JP `areaQuantization` 仍然只有声明和单测，没有生产消费者

文件：`pascal-ai-mcp/src/norms/profile.ts:75-86`、`pascal-ai-mcp/src/norms/profile-jp.ts:74-75`

`quantizeAreaSqm` 仍只被 `profile.test.ts` 调用；生成、`applyModifyOps`、分区器和 validator 都没有调用它。JP profile 虽配置了 0.25 帖网格，但 `resize_room` 和生成 intent 的目标面积仍可为任意小数。

失败场景：JP 请求把房间调整到 8.1㎡，或模型输出 7.83㎡，最终 plan 不会执行 J7 的面积级量化。现有测试证明工具函数本身正确，但没有证明管线真正使用该函数。

## 低

### L1. 重建失败路径仍缺少集成测试

文件：`pascal-ai-mcp/src/agent.test.ts`、`pascal-ai-mcp/src/scene-executor.test.ts`

新增测试覆盖了 union、drift 和纯函数 op，但没有覆盖 plan-first 重建中的：删除部分成功后失败、新 plan 中途 `create_room` 失败、`executeLayoutPlan.executionIssues` 后是否禁止家具/快照刷新、诊断或持久化失败后的 retry。上述 H1/H2 因此仍只能从实现路径确认，现有 387 个测试不会捕获回归。

## 结论

- 高危：2
- 中：2
- 低：1
- 上一版已修复：4 项
- MCP 相关代码：未修改

结论：仍需要修改后再合并。当前最优先打开 `agent.ts` 的 `rebuildScenePlanFirst` 和 `scene-executor.ts` 的错误返回路径；纯函数、策略 notes、混合 op 与 union 边界本轮已基本闭环。
