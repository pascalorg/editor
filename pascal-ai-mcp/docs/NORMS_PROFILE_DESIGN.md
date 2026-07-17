# 硬性规范档案（NormProfile）设计

状态：**已确认（2026-07-10）**，核心批次已落码（见 §4）。落点全部在 pascal-ai-mcp（不动 packages/mcp）。

> **真相源约定**：规则的**语义和理由**以本文档为准；**具体数值**一旦落码，以 `src/norms/profile-*.ts` 为准（本文档数值是拍板时的初始值）。尚未落码的字段在 §4 标注归属批次。修改流程：改文档 → 同步代码 → eval 回归。
>
> 姊妹文档：[LAYOUT_STRATEGY_DESIGN.md](LAYOUT_STRATEGY_DESIGN.md)（策略规则与拓扑细则）。

## 1. 架构

```
src/norms/
  profile.ts        # NormProfile 类型 + 注册表 + 选择逻辑
  profile-jp.ts     # 日本档案（首个目标市场）
  profile-default.ts# 现行硬编码值原样收拢（回归基线，行为不变）
```

- **选择方式**：环境变量 `PASCAL_NORM_PROFILE=jp`（config.ts 读入）；brief 里若提取到明确的地区事实（如"日本""东京"）可覆盖，覆盖时在 notes 里注明。
- **消费方**（✅=已接 profile，⏳=仍硬编码、随 §4 后续批次接入）：
  - ✅ `layout-partitioner`：房间最小净宽、走廊宽度、长宽比上限（含 narrow_lot 独立上限）、房型默认面积、帖量化、scorer 参数
  - ✅ `plan-validator`：面积区间档位（`roomAreaBounds` 四界模型，含 LDK 阶梯）
  - ⏳ `layout-metrics`：面积档位表（band table）按 profile 生成
  - ⏳ `completion-gates`：采光/设备门槛的参数
  - ⏳ `furniture-checklist`：房型必备清单按 profile 可增删（日本的分离式卫浴见 §3）
- **分级原则不变**：安全/可用性 → fatal（gate/校验拦截）；舒适性 → warning（进 layoutQuality 评分）。

## 2. 日本档案数值（已确认）

### 2.1 法规硬约束（fatal，依据建築基準法）

| # | 规范 | 数值 | 依据 | 落点 |
|---|---|---|---|---|
| J1 | 居室采光：窗面积 ≥ 地板面积 × **1/7** | 窗地比 1/7 | 基準法 28 条 | gates（新增 gate：采光比） |
| J2 | 居室换气：开口 ≥ 地板面积 × **1/20** | 1/20 | 同上 | 同 J1（开窗即同时满足，合并检查） |
| J3 | 居室天花板高 ≥ **2.1m** | 2.1m | 施行令 21 条 | scene-executor 建墙高度下限校验 |
| J4 | 户内走廊有效宽 ≥ **0.78m**（建议值 0.85m） | 0.78 fatal / 0.85 warning | 惯例（法规对户内无强制，共用走廊另计） | partitioner 走廊宽度参数（JP 档案设计宽 0.91m＝尺モジュール半間，扣墙厚后仍 ≥0.78） |

### 2.2 市场惯例硬约束（fatal，日本住宅不这么做就是错）

| # | 规范 | 数值/规则 | 落点 |
|---|---|---|---|
| J5 | **玄関必备**：任何户型必须有玄关，入户门只开在玄关 | required room | plan-builder prompt 规则 + 分区器自动补玄关 + gate 1 |
| J6 | **卫浴分离**：トイレ（厕所）与 浴室/洗面脱衣室 是两个独立房间，禁止合并出"带淋浴的马桶间" | 拆分房型 | 房型枚举扩展走**方案 B**（已拍板）：仍用 `bathroom` 类型 + name 区分 + 清单按 profile 拆 |
| J7 | 房间尺寸以 **帖** 对齐：**1帖=1.62㎡**（已拍板，通用值），面积取整到 0.25帖 | 网格对齐 | partitioner 面积/坐标量化（面积级已落，坐标级待后续） |

### 2.3 面积档位（帖制；下限 fatal，舒适区间 warning）

**LDK/DK 下限随卧室数阶梯（2026-07-10 修正）**——依据不動産公正取引協議会「LDK等の広さの目安」：居室（卧室）1 间时 DK≥4.5帖、LDK≥8帖；**居室 2 间以上时 DK≥6帖、LDK≥10帖**。落码为随 bedroomCount 的函数，不是常数。

**2026-07-16 参照库校准**——11 份在售参照体检（TEMPLATES.md #3/#5/#6/#8）驱动的回调：寝室下限 4.5帖→4帖（4.3–4.4帖 洋室在真实紧凑户型反复出现，降为 warn 不再 fatal）、单居室（bedroomCount≤1）唯一居室兼起居上限放宽到 14.5帖、1K/1R 廊下型キッチン下限 2帖、洗面/トイレ warn 界 1帖→0.8帖；**DK 档独立落码**为 `dkAreaBounds`（plan-validator 按 room-vocab `isDiningKitchenName` 对 DK 命名的 living_kitchen 选档，不再被 LDK 阶梯误伤）。

| 房型 | 下限（fatal） | 舒适区间（warning 界） | 说明 |
|---|---|---|---|
| 寝室（卧室） | **4帖 ≈ 6.5㎡（2026-07-16 校准）** | 4.5–8帖；**单居室上限 14.5帖** | 4.3–4.4帖 真实洋室降为 warn；1K/1R 唯一居室兼起居 |
| LDK（一体客餐厨） | 卧室≤1：8帖 ≈ 13㎡；卧室≥2：**10帖 ≈ 16.2㎡** | 12–20帖 | 对应 living_kitchen，阶梯见上 |
| DK | 卧室≤1：4.5帖；卧室≥2：**6帖** | 6–10帖 | **落码为 `dkAreaBounds`，按名字（DK/ダイニングキッチン，排除 LDK）选档（2026-07-16）** |
| LD（客餐分离，厨房独立） | 卧室≤1：6帖；卧室≥2：**8帖 ≈ 13㎡** | 8–16帖 | **落码为 `ldAreaBounds`，仅当户型含独立 kitchen 时对 `living` 选档（2026-07-16，tpl-jp-2ldk-58 的 9.6帖 LD 被 LDK 阶梯误伤驱动）** |
| 独立キッチン | 3帖 ≈ 4.9㎡；**单居室 2帖 ≈ 3.2㎡（2026-07-16 校准）** | 3–4.5帖；单居室 2.5帖 起 | 1K/1R 廊下型キッチン本就是 2–3帖 动线兼用带 |
| 玄関 | 1帖 ≈ 1.6㎡ | 1.5–2帖 | |
| トイレ | 0.75帖 ≈ 1.2㎡（0.78×1.2m 起） | **0.8帖 起（2026-07-16 校准）** | 方案 B 下与浴室同为 `bathroom` 类型，按 name 区分 |
| 浴室（UB） | 1216 规格 ≈ 1.92㎡ | 1616 规格 ≈ 2.56㎡ | **UB 规格绑定 areaBand（2026-07-10 修正）**：tiny/compact 默认 1216，standard 起 1616；按规格枚举，不按连续面积 |
| 洗面脱衣室 | **1帖 fatal / 2帖（1坪）comfortable（2026-07-10 修正）** | **0.8–2帖（2026-07-16 校准：真实 0.86–0.93帖 洗面室常见）** | 家庭户型惯例 1坪 |

### 2.4 原待定项（全部已拍板）

1. **帖的基准**：通用 **1.62㎡**。
2. **卫浴分离的房型枚举**：**方案 B**（`bathroom` 类型 + name 区分 + 清单按 profile 拆）。
3. **J1 窗地比**：executor 开窗时按 profile 反推最小窗宽直接开够，gate 兜底检查。
4. **LDK 命名（1LDK、2LDK）不进 plan-builder 的 Intent 生成规则**；LDK 语汇由策略层（LAYOUT_STRATEGY_DESIGN.md）消化。

## 3. 与现有批次的关系

- 不改主流程结构，只是把常量参数化——default 档案 = 现行为，回归零风险。
- J5 玄関规则会自然消化"入户门开在走廊"问题（日本档案下永远开在玄关）。
- J6 卫浴分离会改 furniture-checklist（トイレ=马桶；洗面脱衣=洗面台+洗衣机位；浴室=浴缸/淋浴）。
- **areaBand 断点（tiny <25㎡ / compact 25–45 / standard 45–70 / large ≥70）属于策略层**，定义与用途见 `LAYOUT_STRATEGY_DESIGN.md` §3.1；profile 为其提供面积档位数据。

## 4. 落码批次

| 批次 | 内容 | 状态 |
|---|---|---|
| S0 | `src/norms/` 骨架 + default 档案（行为不变，回归验证）+ JP 档案的分区参数/默认面积 + `PASCAL_NORM_PROFILE` 选择 | ✅ 2026-07-10 |
| S2（策略批次） | plan-validator 接 profile 面积档位（`roomAreaBounds` 四界模型，含 LDK 阶梯函数）；J7 帖量化（面积级）进 partitioner；scorer 参数进 profile | ✅ 2026-07-10 |
| S3–S5（策略批次） | 拓扑相关参数入 profile：`maxFootprintAspectNarrowLot`（default 4.0 / jp 4.5）等，细则见 LAYOUT_STRATEGY_DESIGN.md §3.2 | ✅ 2026-07-10 |
| 后续 | layout-metrics 场景侧 band 表接 profile；UB 规格绑 areaBand；坐标级帖量化；J5 玄関 gate 侧（applyStrategy 补玄関已落）；J6 卫浴分离清单；J1 采光 gate + executor 开窗反推 | 未开始 |
