# Save Build 导出 JSON 字段说明

在 **Settings → Save & Load → Save Build** 时，编辑器会把当前场景序列化为 JSON 并下载为 `layout_YYYY-MM-DD.json`（例如 `layout_2026-05-26.json`）。

实现见 `packages/editor/src/components/ui/sidebar/panels/settings-panel/index.tsx`：导出内容为 `useScene` 中的 **`nodes`** 与 **`rootNodeIds`**，不含编辑器 UI 状态、不含 `collections`（收藏夹分组另存于场景 store，但 Save Build 未写入该字段）。

**Load Build** 读取同一格式：`{ nodes, rootNodeIds }` 即可还原场景。

---

## 顶层结构

```json
{
  "nodes": { /* 所有节点的字典，key 为节点 id */ },
  "rootNodeIds": [ /* 场景根节点 id 列表 */ ]
}
```

| 字段 | 类型 | 含义 |
|------|------|------|
| `nodes` | `Record<string, Node>` | 场景中**每一个**节点的完整数据。键名与节点内的 `id` 一致。 |
| `rootNodeIds` | `string[]` | 场景树的**顶层**节点 id。常见为 `site_…` 或 `building_…`。Load 时从这些 id 开始遍历整棵树。 |

---

## 节点图如何串起来

每个节点通过以下字段构成一棵树（部分节点还有横向引用，如墙上的门窗）：

| 关系字段 | 含义 |
|----------|------|
| `id` | 全局唯一标识，格式一般为 `{type}_{随机串}`，如 `wall_0j28n7nskm2sst7m`。 |
| `type` | 节点类型，决定还有哪些字段合法（见下文分类型说明）。 |
| `parentId` | 父节点 `id`；顶层节点为 `null`。 |
| `children` | **仅 id 列表**（字符串数组），指向子节点；子节点的完整数据仍在 `nodes` 里。 |

典型层级（由外到内）：

```
site（地块）
  └── building（楼栋）
        └── level（楼层）
              ├── wall / slab / zone / item / stair / …
              └── wall.children → 墙上的 door / window / item
```

**注意：** `children` 里只存 id，不要省略对应条目；`nodes` 中必须存在每个被引用的 id。

---

## 所有节点共有的字段（BaseNode）

绝大多数节点都包含：

| 字段 | 类型 | 必填 | 含义 |
|------|------|------|------|
| `object` | `"node"` | 是 | 固定字面量，表示这是一条场景节点记录。 |
| `id` | `string` | 是 | 节点唯一 id。 |
| `type` | `string` | 是 | 节点类型（`site`、`building`、`level`、`wall`、`item` 等）。 |
| `parentId` | `string \| null` | 是 | 父节点 id；无父级时为 `null`。 |
| `visible` | `boolean` | 否 | 是否在视图中显示，默认 `true`。 |
| `metadata` | `object` | 否 | 任意 JSON 元数据，默认 `{}`。可存工具来源、临时标记等。 |
| `name` | `string` | 否 | 在侧栏/树中显示的名称。 |
| `camera` | `Camera` | 否 | 与该节点关联的**已保存视角**（切到该楼层/区域时恢复）。见 [camera](#camera-对象)。 |
| `children` | `string[]` | 视类型 | 子节点 id 列表；有子节点的类型才出现。 |

---

## `camera` 对象

常出现在 `level`、`zone` 等节点上：

```json
"camera": {
  "position": [32.19, 13.35, 32.63],
  "target": [4.85, 0, 7.36],
  "mode": "perspective"
}
```

| 字段 | 类型 | 含义 |
|------|------|------|
| `position` | `[x, y, z]` | 相机位置，世界坐标，单位：**米**。 |
| `target` | `[x, y, z]` | 相机看向的目标点。 |
| `mode` | `"perspective"` \| `"orthographic"` | 透视 / 正交。 |
| `fov` | `number` | 可选，透视时的视野角度。 |
| `zoom` | `number` | 可选，正交时的缩放。 |

---

## `material` / 材质相关字段

墙、楼板、天花板、门、窗等结构节点可能带有材质。常见两种写法：

1. **`materialPreset`**：预设名（如 `"white"`、`"brick"`、`"wood"`）。
2. **`material`**：自定义材质对象：

```json
"material": {
  "preset": "custom",
  "properties": {
    "color": "#ffffff",
    "roughness": 0.5,
    "metalness": 0,
    "opacity": 1,
    "transparent": false,
    "side": "front"
  },
  "texture": {
    "url": "https://…/texture.jpg",
    "repeat": [1, 1]
  }
}
```

墙体还可分内外侧：`interiorMaterial` / `exteriorMaterial` 及对应 `*MaterialPreset`。

---

## 各 `type` 专有字段

### `site` — 地块

| 字段 | 含义 |
|------|------|
| `polygon` | 用地红线，`{ type: "polygon", points: [[x,z], …] }`，单位米，XZ 平面。 |
| `children` | 一般为 `building` 节点 id 列表。 |

### `building` — 楼栋

| 字段 | 含义 |
|------|------|
| `position` | `[x, y, z]` 在地块坐标系中的位置。 |
| `rotation` | `[x, y, z]` 旋转（弧度）。 |
| `children` | `level` 节点 id 列表。 |

### `level` — 楼层

| 字段 | 含义 |
|------|------|
| `level` | 楼层编号，`0` 通常为地面层，向上递增。 |
| `children` | 该层上的 `wall`、`slab`、`zone`、`item`、`stair`、`roof`、`scan`、`guide`、`spawn` 等 id。 |

### `wall` — 墙

| 字段 | 含义 |
|------|------|
| `start` | `[x, z]` 墙起点（楼层平面坐标）。 |
| `end` | `[x, z]` 墙终点。 |
| `thickness` | 墙厚（米），可选。 |
| `height` | 墙高（米），可选。 |
| `curveOffset` | 弧形墙的中点偏移（米），可选。 |
| `frontSide` / `backSide` | `"interior"` / `"exterior"` / `"unknown"`，剖切显示用。 |
| `children` | 附着的 `item` / `door` / `window` 的 id（若使用独立门窗节点）。 |
| `material*` | 墙体材质（见上）。 |

### `slab` — 楼板 / 地面

| 字段 | 含义 |
|------|------|
| `polygon` | `[[x,z], …]` 外轮廓顶点。 |
| `holes` | 洞轮廓数组，每个洞是一个 `[[x,z], …]` 多边形。 |
| `holeMetadata` | 与 `holes` 对应的元数据（楼梯开口等）。 |
| `elevation` | 板顶标高（米），默认约 `0.05`。 |
| `autoFromWalls` | 是否由闭合墙线自动生成。 |

### `ceiling` — 天花板

| 字段 | 含义 |
|------|------|
| `polygon` | 同楼板，XZ 轮廓。 |
| `holes` / `holeMetadata` | 同楼板。 |
| `height` | 天花板高度（米），默认约 `2.5`。 |
| `autoFromWalls` | 是否自动生成。 |
| `children` | 可附着的 `item`（如吊灯）id。 |

### `zone` — 功能分区

| 字段 | 含义 |
|------|------|
| `name` | 分区名称（如 "Living Room"）。 |
| `polygon` | `[[x,z], …]` 分区边界。 |
| `color` | 十六进制颜色，如 `"#3b82f6"`。 |

### `column` — 柱

含大量样式字段（`style`、`crossSection`、`height`、`radius` 等），用于参数化柱体几何。导出 JSON 会保留你在编辑器中设置的全部柱参数。

### `fence` — 围栏

| 字段 | 含义 |
|------|------|
| `start` / `end` | 围栏起终点 `[x, z]`。 |
| `height` / `thickness` | 高度、厚度（米）。 |
| `style` | `"slat"` / `"rail"` / `"privacy"` 等。 |
| `color` | 颜色。 |
| 其他 | `postSpacing`、`baseStyle`、`curveOffset` 等几何/样式参数。 |

### `stair` — 楼梯

| 字段 | 含义 |
|------|------|
| `position` | `[x, y, z]` 楼梯锚点。 |
| `rotation` | 绕 Y 轴旋转（**弧度**，标量 `number`）。 |
| `fromLevelId` / `toLevelId` | 连接的起止楼层 id。 |
| `stairType` | `"straight"` / `"curved"` / `"spiral"`。 |
| `width` / `totalRise` / `stepCount` / `thickness` | 宽、总升高、踏步数、结构厚度。 |
| `fillToFloor` | 是否填充实心到楼板。 |
| `railingMode` | 栏杆：`none` / `left` / `right` / `both`。 |
| 材质 | `material`、`railingMaterial`、`treadMaterial` 等。 |

### `roof` — 屋顶组

| 字段 | 含义 |
|------|------|
| `position` | 屋顶组中心 `[x, y, z]`。 |
| `rotation` | 绕 Y 轴旋转（弧度）。 |
| `children` | `roof-segment`（`rseg_…`）节点 id 列表。 |

### `roof-segment`（`type`: `"roof-segment"`）— 屋顶段

| 字段 | 含义 |
|------|------|
| `roofType` | `hip` / `gable` / `shed` / `gambrel` / `dutch` / `mansard` / `flat`。 |
| `width` / `depth` | 平面 footprint 尺寸（米）。 |
| `wallHeight` / `roofHeight` | 墙体高度、屋顶高度。 |
| `overhang` | 挑檐伸出距离。 |

> **旧版导出：** 部分早期 JSON 中 `roof` 可能带有 `length`、`leftWidth`、`rightWidth` 等字段，属于旧数据格式；新编辑器以 `roof` + `roof-segment` 为主。

### `item` — 家具 / 门窗模型 / 设备

物品类节点使用 **`asset`** 描述模型与目录信息：

| 字段 | 含义 |
|------|------|
| `position` | `[x, y, z]` 在世界/父级坐标系中的位置（米）。 |
| `rotation` | `[rx, ry, rz]` 旋转（**弧度**）。 |
| `scale` | `[sx, sy, sz]` 实例缩放。 |
| `side` | `"front"` / `"back"`，贴墙时的朝向。 |
| `wallId` | 附着的墙 id（与 `asset.attachTo` 配合）。 |
| `wallT` | 沿墙参数位置 `0~1`（0 起点，1 终点）。 |
| `children` | 叠放在此物品上的子 `item` id（如台面上的小物件）。 |
| `collectionIds` | 所属收藏夹 id 列表（若使用过 collections 功能）。 |
| `asset` | 见下表。 |

#### `item.asset` 对象

| 字段 | 含义 |
|------|------|
| `id` | 目录条目 id（如 `lounge-chair`），与 `catalog-items.tsx` 中一致。 |
| `category` | 分类：`furniture`、`kitchen`、`window`、`door` 等。 |
| `name` | 显示名。 |
| `thumbnail` | 目录缩略图 URL 或路径。 |
| `src` | **GLB/GLTF 模型** URL 或路径（如 `/items/…/model.glb`、`https://…`）。 |
| `floorPlanUrl` | 可选，2D 平面图俯视图。 |
| `dimensions` | `[宽, 高, 深]` 逻辑占位尺寸（米）。 |
| `offset` | 模型校正平移 `[x,y,z]`（米）。 |
| `rotation` | 模型校正旋转 `[x,y,z]`（弧度）。 |
| `scale` | 模型校正缩放 `[x,y,z]`。 |
| `attachTo` | 可选：`wall` / `wall-side` / `ceiling`，表示贴墙或吊顶。 |
| `tags` | 可选字符串数组，用于目录筛选。 |
| `surface` | 可选 `{ height: number }`，表示可在其上放置其他物品的高度。 |
| `interactive` | 可选，灯具开关、动画等交互配置。 |

**说明：** 许多门窗在导出 JSON 里 `type` 仍为 `"item"`，通过 `asset.category` 与 `asset.attachTo: "wall"` 区分；schema 里也支持独立的 `door` / `window` 节点类型（字段更多，含门扇分段、开启方式等）。

### `door` — 门（参数化）

除 BaseNode 与 `position` / `rotation` / `wallId` / `side` 外，还有 `width`、`height`、`doorType`、`segments`（门扇分格）、`swingAngle`、`openingKind` 等大量参数。完整列表见 `packages/core/src/schema/nodes/door.ts`。

### `window` — 窗（参数化）

类似门，含 `windowType`、`width`、`height`、`operationState`、`frameThickness` 等。见 `packages/core/src/schema/nodes/window.ts`。

### `scan` — 3D 扫描参考

| 字段 | 含义 |
|------|------|
| `url` | 扫描模型 URL（`.glb` / `.gltf` 或 `asset://…`）。 |
| `position` / `rotation` | 位姿。 |
| `scale` | 统一缩放系数（标量）。 |
| `opacity` | 不透明度 `0~100`。 |

### `guide` — 参考平面图

| 字段 | 含义 |
|------|------|
| `url` | 图片 URL 或 `asset://…`（浏览器本地存储 id）。 |
| `position` / `rotation` | 位姿。 |
| `scale` | 缩放。 |
| `opacity` | `0~100`。 |
| `scaleReference` | 可选比例尺校准：`start`、`end`、`realLengthMeters`、`metersPerUnit` 等。 |

### `spawn` — 出生点 / 漫游起点

| 字段 | 含义 |
|------|------|
| `position` | `[x, y, z]`。 |
| `rotation` | 绕 Y 轴朝向（弧度）。 |

---

## 坐标与单位约定

| 约定 | 说明 |
|------|------|
| 长度单位 | **米（m）** |
| 平面墙/板/区 | 使用 **`[x, z]`** 两点或 polygon，忽略竖向（高度由 `height` / `elevation` 等单独字段表示）。 |
| 旋转 | 节点 `rotation` 多为 **`[rx, ry, rz]` 弧度**；楼梯、屋顶、spawn 等有时为绕 Y 的**单个弧度值**。 |
| `item.asset.rotation` | 模型**校正**旋转，同样是弧度。 |

---

## 最小示例

```json
{
  "nodes": {
    "building_abc": {
      "object": "node",
      "id": "building_abc",
      "type": "building",
      "parentId": null,
      "visible": true,
      "metadata": {},
      "children": ["level_0"],
      "position": [0, 0, 0],
      "rotation": [0, 0, 0]
    },
    "level_0": {
      "object": "node",
      "id": "level_0",
      "type": "level",
      "parentId": "building_abc",
      "visible": true,
      "metadata": {},
      "children": ["item_chair"],
      "level": 0
    },
    "item_chair": {
      "object": "node",
      "id": "item_chair",
      "type": "item",
      "name": "Chair",
      "parentId": "level_0",
      "visible": true,
      "metadata": {},
      "position": [2, 0, 3],
      "rotation": [0, 0, 0],
      "scale": [1, 1, 1],
      "asset": {
        "id": "chair",
        "category": "furniture",
        "name": "Chair",
        "thumbnail": "/items/chair/thumbnail.png",
        "src": "/items/chair/model.glb",
        "dimensions": [0.6, 0.9, 0.6],
        "offset": [0, 0, 0],
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1]
      }
    }
  },
  "rootNodeIds": ["building_abc"]
}
```

---

## 与云端场景 API 的区别

| 方式 | 内容 |
|------|------|
| **Save Build** | 本机下载的 `layout_*.json`，仅 `nodes` + `rootNodeIds`。 |
| **云端 `/api/scenes`** | 可能包含项目元数据、版本号等；节点结构与本 JSON 同类，但包装在外层 API 响应中。 |

手工编辑 JSON 后可用 **Load Build** 导入；修改时务必保持 **id 唯一**、`parentId` / `children` **互相引用一致**，且 `src` / `url` 等资源地址可被编辑器加载（`https://`、`/`、`asset://` 等，见 `AssetUrl` 校验规则）。

---

## 相关源码

| 文件 | 说明 |
|------|------|
| `packages/editor/src/lib/scene.ts` | `SceneGraph` 类型定义 |
| `packages/core/src/schema/base.ts` | 节点基类 |
| `packages/core/src/schema/nodes/*.ts` | 各类型 Zod schema |
| `apps/editor/public/demos/demo_1.json` | 完整示例场景 |
