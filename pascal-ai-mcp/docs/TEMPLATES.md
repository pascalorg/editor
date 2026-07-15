# 户型参照库（templates/）

状态：底座已落地（2026-07-14），首批 4 个手工参照（3 好 1 反）。用途按拍板（2026-07-13 讨论）：**评测/校准资产优先**，生成种子（模板作 `previousPlan` 锚点喂分区器）等校准结论出来后再接。

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

对每个模板输出三层：① 我们的 validator 对参照的裁决（**good 参照被判 fatal = 规则错，不是市场错**）；② scorer 视角（penalty/房间长宽比/走廊占比——**bad 例得分优于 good 例 = 缺惩罚项**）；③ 同房型程序过我们的分区器的对比结果 + 并排 SVG（`layout-previews/templates/`，`--ours` 后缀）。

## 维护约定

- 新增参照：仿照现有 JSON，跑一遍体检确认 good 参照 validator 无 fatal（有 fatal 先判断是模板画错还是规则错，规则错记进下面的校准清单）；
- 反例的每条 badReason 都应能指认一个 scorer 惩罚项/validator 检查；体检显示未捕获的即开发任务；
- 校准发现 → 改 NORMS/LAYOUT 设计文档数值表 → 同步代码 → eval 回归（真相源流程不变）。

## 首轮体检发现（2026-07-14，待处理清单）

1. ~~validator 0.9m 浮点边界 bug~~ ✅ 已修（2026-07-14）：长度测量在源头（sharedBoundaryLength/longestSharedEdge/longestExteriorEdge）厘米取整——3.6−2.7 的浮点残差不再让 0.9m 门边冤枉差 1e-16。田の字参照 fatal 3→0（score 32→92）；
2. ~~1K 动线规则误伤~~ ✅ 已修（2026-07-14）：`kitchenIsCirculation`（layout-plan 导出，plan-validator #10 / gate-5 / findIsolatedBedrooms 三份拷贝共用）——仅「单居室 + 无走廊 + 无客厅/LDK/餐厅」的纯 1K 形态把厨房视为可通行；有社交空间的户型穿厨房照旧拦截。1K 参照 fatal 1→0（score 76→96）；
3. **jp 面积档偏窄**：洋室 softMin 6帖 判掉真实田の字的 5.5帖 洋室；单间主室 16㎡ 超上限 warn；
4. **分区器缺「水回りコア」手法（根本差距）**：真实日本户型把 トイレ/洗面/浴室/収納 横向打包成中段无窗服务核，我们的拓扑只会全宽堆叠或角位嵌入——三个 good 参照的同房型程序（60㎡ 内 8+ 房间）我们的分区器**全部无解**。这是生成质量差距的主因；
5. **DK 被拿 LDK 的档卡**：真实 2DK 的 7.5帖 DK（12.1㎡）被判 fatal「超出合理区间 19.44–32.4㎡」——`living_kitchen` 类型没有区分 DK/LDK，代码一律套 LDK 阶梯下限（12帖），而 NORMS §2.3 明明写了 DK 下限 4.5/6帖。需要按名字（DK vs LDK）或面积段选档；
6. 洗面室/トイレ 1帖下限偏紧（真实 0.9帖 常见），洋室 9.72 下限反复撞线——面积档位统一等参照攒够后一次校准。

