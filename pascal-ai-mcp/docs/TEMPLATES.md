# 户型参照库（templates/）

目录结构（2026-07-17 整理）：模板按质量分子目录——`templates/good/`（合格参照）、`templates/bad/`（反例）；预览镜像同一布局——`layout-previews/templates/good|bad/` 是参照渲染，`layout-previews/templates/ours/` 是分区器对同房型程序的对比渲染（此前 `--ours` 后缀混在平铺目录里，屡次被误认成模板本体）。加载器（`template-seed.ts templateFilePaths`）读根目录 + 一层子目录，散放在根的 JSON 仍然有效。

状态：底座已落地（2026-07-14），现有 15 个参照（14 好 1 反，含 11 张真实间取り图转换）。挂起 1 张：① 真实 2DK 55.69㎡（上下两块错位的异形轮廓、中央玄関动线）待 L 形/异形 footprint 支持（GENERATION_REDESIGN §10.2）后转换——矩形化会铺进 ~12㎡ 不存在的角落并抹平其「狭长+下方居室离卫浴远」的形态要点；（3LDK 70.4㎡ 已于 2026-07-16 拍板按标注面积收录为 tpl-jp-3ldk-70，面积口径存疑记录在其 source 字段。）用途：**评测/校准资产优先，同时已接入生成种子**；安全命中时直接等比缩放参照计划，拒绝原因进入请求 trace，未命中回落分区器。

## 格式

每个模板一个 JSON，`plan` 字段与 `LayoutPlan` 完全同构（validator/scorer/渲染器零改造直接消费）：

```jsonc
{
  "id": "tpl-jp-2ldk-60-tanoji",
  "meta": {
    "market": "jp",              // NormProfile id
    "label": "2LDK 59.9㎡ 田の字",
    "source": "出处（真实间取り图/手工整理）",
    "quality": "good",           // good | bad
    "badReasons": [],            // 反例必填：每条对应一个应被 scorer/validator 捕获的坏模式
    "typology": "tanoji",        // 对应策略层枚举，供对比生成时派生 strategy
    "roomProgram": "2ldk",       // 日本房型编号（1r/1k/Ndk/Nldk）——与请求侧确定性解析出的编号精确匹配
    "notes": "形态要点"
  },
  "plan": { "footprint": …, "entry": …, "rooms": […], "connections": […] }
}
```

坐标要求：轴对齐、房间铺满 footprint（validator 覆盖率检查会抓漏）；精度到 0.1m 足够（照间取り图目测按比例量）。房型必须用系统 12 枚举；日本卫浴分离按方案 B（トイレ/洗面脱衣/浴室都是 `bathroom` 类型 + 名字区分）。

## 体检脚本

```bash
bun run scripts/check-templates.ts
```

对每个模板输出三层：① 我们的 validator 对参照的裁决（**good 参照被判 fatal = 规则错，不是市场错**）；② scorer 视角（penalty/房间长宽比/走廊占比——**bad 例得分优于 good 例 = 缺惩罚项**）；③ 同房型程序过我们的分区器的对比结果 + 并排 SVG（参照在 `layout-previews/templates/good|bad/`，我们的生成在 `layout-previews/templates/ours/`）。

## 维护约定

- 新增参照：仿照现有 JSON，跑一遍体检确认 good 参照 validator 无 fatal（有 fatal 先判断是模板画错还是规则错，规则错记进下面的校准清单）；
- 反例的每条 badReason 都应能指认一个 scorer 惩罚项/validator 检查；体检显示未捕获的即开发任务；
- 校准发现 → 改 NORMS/LAYOUT 设计文档数值表 → 同步代码 → eval 回归（真相源流程不变）。

## 首轮体检发现（2026-07-14，待处理清单）

1. ~~validator 0.9m 浮点边界 bug~~ ✅ 已修（2026-07-14）：长度测量在源头（sharedBoundaryLength/longestSharedEdge/longestExteriorEdge）厘米取整——3.6−2.7 的浮点残差不再让 0.9m 门边冤枉差 1e-16。田の字参照 fatal 3→0（score 32→92）；
2. ~~1K 动线规则误伤~~ ✅ 已修（2026-07-14）：`kitchenIsCirculation`（layout-plan 导出，plan-validator #10 / gate-5 / findIsolatedBedrooms 三份拷贝共用）——仅「单居室 + 无走廊 + 无客厅/LDK/餐厅」的纯 1K 形态把厨房视为可通行；有社交空间的户型穿厨房照旧拦截。1K 参照 fatal 1→0（score 76→96）；
3. ~~jp 面积档偏窄~~ ✅ 已修（2026-07-16 校准）：寝室 fatalMin 4.5帖→4帖、softMin 6帖→4.5帖，单居室（bedroomCount≤1）softMax 放宽到 14.5帖（1K 16㎡ 主室 / 1R 22.8㎡ スタジオ不再 warn）；4.3–4.4帖 洋室降为 warn（保留「偏紧」信号）。原始记录：**jp 面积档偏窄**：洋室 softMin 6帖 判掉真实田の字的 5.5帖 洋室；单间主室 16㎡ 超上限 warn；（2026-07-15 tpl-jp-1ldk-31 佐证：真实在售 1LDK 的 4.8帖 洋室 warn——「压居室换大 DK」是紧凑户型的市场常态；2026-07-16 追加：tpl-jp-2ldk-54 洋室1 4.4帖=7.0㎡ FATAL、tpl-jp-3dk-49 洋室4.3帖=7.0㎡ FATAL——小居室在真实紧凑户型反复出现且已到 fatal 档；tpl-jp-1r-37 スタジオ 22.8㎡ 超 bedroom 上限 warn，同「单间主室超上限」类）
4. **分区器缺「水回りコア」手法（根本差距）**：真实日本户型把 トイレ/洗面/浴室/収納 横向打包成中段无窗服务核，我们的拓扑只会全宽堆叠或角位嵌入——三个 good 参照的同房型程序（60㎡ 内 8+ 房间）我们的分区器**全部无解**。这是生成质量差距的主因；
5. ~~DK 被拿 LDK 的档卡~~ ✅ 已修（2026-07-16）：`NormProfile.dkAreaBounds`（jp：下限 4.5/6帖 随卧室数、舒适 6–10帖）+ plan-validator 按 room-vocab `isDiningKitchenName`（DK/ダイニングキッチン，LDK 命名先排除）对 living_kitchen 选档；2DK/3DK/1LDK 四处 DK 误伤全清。原始记录：**DK 被拿 LDK 的档卡**：真实 2DK 的 7.5帖 DK（12.1㎡）被判 fatal「超出合理区间 19.44–32.4㎡」——`living_kitchen` 类型没有区分 DK/LDK，代码一律套 LDK 阶梯下限（12帖），而 NORMS §2.3 明明写了 DK 下限 4.5/6帖。需要按名字（DK vs LDK）或面积段选档；（2026-07-15 tpl-jp-1ldk-31 佐证：8.4帖 DK 13.7㎡ 同样被 LDK 档卡 warn；tpl-jp-2dk-42 佐证：7.0帖 DK 13.6㎡ 被卡 FATAL——13.7 warn / 13.6 fatal 说明档位边界正好落在这一带，误伤敏感；2026-07-16 追加：tpl-jp-3dk-49 的 6.1帖 DK 10.6㎡ 同样 FATAL）
6. ~~洗面室/トイレ 1帖下限偏紧~~ ✅ 已修（2026-07-16 校准）：bathroom softMin 1帖→0.8帖（1.3–1.5㎡ 真实洗面/トイレ不再 warn），fatalMin 0.7帖 不变。原始记录：洗面室/トイレ 1帖下限偏紧（真实 0.9帖 常见），洋室 9.72 下限反复撞线——面积档位统一等参照攒够后一次校准。
7. ~~storage 不应参与长宽比检查/惩罚~~ ✅ 已修（2026-07-16）：plan-validator 长宽比检查与 check-templates planMetrics 的 penalty 房间集合都排除 storage（同 hallway 处理）；tpl-jp-1ldk-31 penalty 6.46→1.66。原始记录：**storage 不应参与长宽比检查/惩罚**（2026-07-15，tpl-jp-1ldk-31）：0.5m 进深 × 1.4m 宽的クローゼット是标准壁橱形态，却吃一条 aspect warn 并贡献了 scorer penalty 的大头（maxRoomAspect 2.8 全由壁橱产生）——建议 aspect 检查与 penalty 的房间集合排除 storage（planMetrics 已对 hallway 这么做）。
8. ~~kitchen 面积档下限对 1K/1R 廊下型キッチン过高~~ ✅ 已修（2026-07-16 校准）：单居室（bedroomCount≤1）kitchen fatalMin 2帖 / softMin 2.5帖，家庭户型保持 3帖。原始记录：**kitchen 面积档下限对 1K/1R 廊下型キッチン过高**（2026-07-16，tpl-jp-1k-22 / tpl-jp-1r-37）：独立 kitchen 房型下限 4.86㎡（3帖）把真实 1K 的 4.8㎡ 廊下型厨房和 1R 的 4.2㎡ 厨房都判 FATAL——单身户型的厨房本就是 2–3帖 的动线兼用带；与 #2 的 1K 动线豁免同思路，kitchen 面积档需按户型规模分档或对单居室户型放宽下限。
9. ~~LD（客餐分离）被拿 LDK 阶梯卡~~ ✅ 已修（2026-07-16，tpl-jp-2ldk-58 驱动）：独立厨房+客餐厅分离形态的 9.6帖「リビング・ダイニング」被 living 档（LDK 12帖起）判 fatal——与 #5 的 DK 误伤同构。落码 `ldAreaBounds`（jp：下限随卧室数 6/8帖、舒适 8–16帖，NORMS §2.3 LD 行），`areaBoundFor` 仅当户型含独立 kitchen 时对 `living` 选档，validator/modify/strategy 三处共用。
10. ~~迷你收纳的施工表达~~ ✅ 已落地（2026-07-16，随模板种子接入；评审修正 2026-07-16）：scene-executor 连接门循环判定 storage 且（面积 <1.5㎡ 或最小边 <0.8m）→ `cut_opening` 后补一刀 `apply_patch` 把节点 update 成 `openingKind:'opening'`（cut_opening 的输入 schema 不透传该字段，不补这刀落成的是默认平开门）；宽度 clamp 到 [0.5, 0.9]m（下限真 clamp）；判定与 0.5m 下限收敛到 layout-plan 由 executor 与 plan-validator #9 共享（validator 对壁橱连接放宽到 0.5m，否则放宽在正常链路不可达）；gate 连通图照常认门；柜门/引き戸的视觉表达属 viewer 层，结构侧到此为止。原始记录：**迷你收纳的施工表达**（2026-07-15 拍板，生成种子接入时的决策项）：模板里的クローゼット/押入按 storage 房间忠实转换（日本壁橱本就是墙体围合空间，且房间必须铺满 footprint），**模板侧不改**；但 connections 只有 `door` 一种类型，接生成种子时 scene-executor 会把 0.7㎡ 壁橱建成带平开门的迷你房间。届时给执行器加规则：storage 且面积 <1.5㎡ 或进深 <0.8m → 按嵌入式壁橱处理（墙体照建、开口用引き戸/柜门表达，不开平开门）。


## 房型编号匹配（2026-07-17）

此前 matcher 只按房间结构（卧室数/hubForm/厨房数/面积比）匹配，而模型会把 DK/LDK 随机拆成
dining+kitchen（+living），导致 NDK 全军覆没、NLDK 命中靠运气、1R 与 1K 结构上无法区分。修复分三层：

1. **确定性房型编号**（`parseRoomProgram` / `detectRoomProgram`，src/lang/strategy-vocab.ts）：从确认后的 brief（summary +
   结构化事实）解析 `1r | 1k | Ndk | Nldk`（NFKC 全角归一、大小写/空格变体）。SLDK/SDK 不再整体拒收：
   例如 `2SLDK → roomProgram:'2ldk' + serviceRoomCount:1`，base program 继续决定公共区，S 独立要求納戸；经
   `BriefFacts → StrategyDecision` 一路带到 Intent 归一化与模板 matcher，
   **不再从模型生成的房间名反推**。改造类 brief「现状 2DK → 目标 2LDK」按池优先级取目标编号
   （designGoals/hardConstraints > summary > assumptions/existingCondition，briefFactsFor），覆盖编号时同步设置或清除 S 状态。
2. **Intent 归一化**（applyStrategy）：NDK/NLDK 把 living/dining/kitchen/living_kitchen 的任意组合
   归一为一间 living_kitchen（名字按编号规范为 DK / LDK——两者 hubForm 不同、吃不同面积档，不可混）；
   NLDK+明确独立厨房则 living/dining（以及已有独立 kitchen 时的游离 living_kitchen，改名 LD）归一为
   一间 living、kitchen 保持独立（对应 tpl-jp-2ldk-58 的独立厨房变体；无独立 kitchen 的单个
   living_kitchen 不硬拆，保留冲突提示）；1K/1R 强制 kitchenMode=closed（source 'program'）+ 专用
   prompt 行（bedroom+kitchen，不要 living/dining/living_kitchen），归一化把无独立厨房时的
   living_kitchen 规范为 kitchen、多余 living/dining 并入主居室（无 bedroom 的畸形输出不强行归一）。
   1K/1R 同时明示开放式时编号优先、冲突写 notes；裸 DK/LDK 编号不再被词表误当成显式 open 偏好。
   SLDK 若模型漏出服务间，确定性补 `type:storage,name:納戸`；クローゼット/収納/衣帽间等普通收纳不抵扣 S。
   面积仅在所有被并房间都有显式值时求和（部分缺失会低估 hub），adjacency 重映射去重、id 稳定。
3. **matcher 编号门**（findTemplateSeed）：请求与模板都带 roomProgram 时必须精确相等（1R/1K、
   1DK/1LDK 由此分开）；1R/1K 的縦长廊下形态是该房型的典型形态，编号精确匹配时豁免
   「site-constrained 模板不种无约束请求」规则（**仅限 1r/1k**，うなぎの寝床 1LDK 不豁免），
   排序上 typology 一致的命中优先于豁免命中。候选拒绝原因写入请求 trace
   （PhaseToolTrace.notes，调试数据，不给用户）。SLDK/SDK 另加服务间数量门：只有明确命名为納戸/サービスルーム等、
   且数量足够的 storage 才能满足 S；普通衣柜型 storage 不计数，所以普通 NLDK 模板不会静默吞掉服务间。

模板核对结论：
- `tpl-jp-1ldk-31`：图面 DK8.4帖 ≥ 8帖，按表示規約居室 1 间时达 LDK 档，1LDK 出售成立——hub
  房间名改建模为 LDK（roomProgram=1ldk），代价是多一条 8.4帖 < 12帖 舒适下限的 soft warn（合理信号）；
- `tpl-jp-2ldk-58`：LD+独立 K 是**独立厨房 2LDK 变体**（hubForm=separate 属实），普通 2LDK 归一为单一
  LDK 后按结构不命中，只有明确要求独立厨房时命中，预期行为；
- `tpl-jp-1k-22/26` 保留 `typology: narrow_lot`（策略明确约束狭长地块时仍按 typology 精确匹配），
  普通 1K 请求经上述豁免可命中；
- `tpl-jp-1ldk-54-unagi` 明确含一间納戸，可在房型、面积和 narrow_lot 约束同时匹配时安全服务 1SLDK；
  其余不含明确服务间的 NLDK 模板不能服务 SLDK；
- **1R 的业务定义**（2026-07-17 拍板）：结构上与 1K 同形建模——厨房作为独立 kitchen 房间（居室一角/
  廊下型的厨房区，见 tpl-jp-1r-37），「主室与厨房无隔断」的语义由 `kitchenIsCirculation` 豁免承担；
  1R 与 1K 的区分靠 roomProgram 编号门，不靠结构。
