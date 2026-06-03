# 家具目录条目格式（`CATALOG_ITEMS`）

本文说明 [`packages/editor/src/components/ui/item-catalog/catalog-items.tsx`](./packages/editor/src/components/ui/item-catalog/catalog-items.tsx) 中每条 `AssetInput` 的字段含义，以及如何追加、删除自定义条目。

类型定义：[`packages/core/src/schema/nodes/item.ts`](./packages/core/src/schema/nodes/item.ts) 中的 `assetSchema`。

---

## 目录

- [参考示例](#参考示例-cactus)
- [字段一览](#字段一览)
- [分类取值](#分类取值)
- [URL 要求](#url-要求thumbnail--src--floorplanurl)
- [GLB 模型要求](#glb-模型要求src)
- [尺寸与校正](#尺寸与校正dimensions--offset--rotation--scale)
- [`attachTo` 与 `surface`](#attachto-与-surface)
- [`tags` 与侧栏筛选](#tags-与侧栏筛选)
- [开发 UI：添加 / 删除](#开发-ui添加--删除-catalog-itemstsx)
- [手动改源码](#手动追加一条目录)
- [相关文件](#相关文件)
- [注意事项](#注意事项)

---

## 参考示例（Cactus）

```ts
{
  id: 'cactus',
  category: 'furniture',
  name: 'Cactus',
  tags: ['cactus', 'rack', 'stand', 'floor'],
  thumbnail:
    'https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items/system/cactus/thumbnail.png',
  src: 'https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items/system/cactus/model.glb',
  floorPlanUrl:
    'https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items/system/cactus/floor-plan.png',
  dimensions: [0.34, 0.39, 0.27],
  offset: [-0.0039, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
},
```

---

## 字段一览

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `id` | ✅ | `string` | 目录内唯一标识，建议小写 + 连字符 |
| `category` | ✅ | `string` | 侧栏分类，见 [分类取值](#分类取值) |
| `name` | ✅ | `string` | 显示名称 |
| `thumbnail` | ✅ | `string` | 缩略图 URL |
| `src` | ✅ | `string` | 3D 模型 `.glb` / `.gltf`，见 [GLB 要求](#glb-模型要求src) |
| `dimensions` | 推荐 | `[w, h, d]` | 占位尺寸（**米**）：宽、高、深；碰撞与平面图 |
| `offset` | 推荐 | `[x, y, z]` | 模型校正平移（米），默认 `[0,0,0]` |
| `rotation` | 推荐 | `[x, y, z]` | 模型校正旋转（**弧度**） |
| `scale` | 推荐 | `[x, y, z]` | 模型校正缩放，默认 `[1,1,1]` |
| `tags` | 推荐 | `string[]` | 筛选与搜索；见 [tags](#tags-与侧栏筛选) |
| `floorPlanUrl` | 可选 | `string` | 平面图俯视图 |
| `attachTo` | 可选 | `'wall' \| 'wall-side' \| 'ceiling'` | 不设则为落地摆放 |
| `surface` | 可选 | `{ height: number }` | 可叠放台面高度（米） |
| `interactive` | 可选 | 对象 | 灯控、动画等 |
| `source` | 可选 | `'library' \| 'community' \| 'mine'` | 来源筛选 |
| `isDraft` | 可选 | `boolean` | 草稿标记 |

---

## 分类取值

**Furnish → Items** 侧栏按 `category` 分 Tab：

| `category` | 侧栏 Tab |
| --- | --- |
| `furniture` | Furniture |
| `appliance` | Appliance |
| `kitchen` | Kitchen |
| `bathroom` | Bathroom |
| `outdoor` | Outdoor |

`door`、`window` 类型存在，但门/窗通常用 **Build** 工具栏；自定义门模型可放在 `furniture` 并设 `attachTo: 'wall'` / `'wall-side'`。

---

## URL 要求（`thumbnail` / `src` / `floorPlanUrl`）

校验见 `packages/core/src/schema/asset-url.ts`：

- ✅ `https://…` 公网地址
- ✅ `/items/…/model.glb`（对应 `apps/editor/public/items/`）
- ✅ `asset://…`（IndexedDB）
- ✅ 开发环境 `http://localhost` / `127.0.0.1`
- ❌ `file://`、`javascript:` 等

`src` 须为 **GLB/GLTF**；缩略图、平面图为图片 URL。

未设置 `NEXT_PUBLIC_ASSETS_CDN_URL` 时，`/items/...` 走**同源**（本地 dev 即 `localhost:3002`）。

---

## GLB 模型要求（`src`）

通过 **Three.js `useGLTF`** 加载，**不支持** FBX、3DS、OBJ（需先在 Blender 等工具转成 GLB）。

### 推荐规格

| 指标 | 推荐 | 可接受 | 不推荐 |
| --- | --- | --- | --- |
| mesh 数 | **1** | 2～10 | 50+ |
| 三角面 | 500～5k | 5k～30k | 100k+ |
| 文件大小 | &lt; 1 MB | 1～3 MB | &gt; 5 MB |
| 包围盒 | 宽约 0.3～3 m，高约 0.3～7 m | 略大 | 数百～上千「单位」 |
| 原点 | 底面中心贴地 | 可 `offset` 微调 | 几何离原点数百米 |

内置参考：Cactus / Tree 约 **1 mesh、&lt;1MB、几米见方**。

### 坐标与 CAD 导出

- 单位按 **米**；`dimensions` 也是米。
- 落地：节点在 `(x, 0, z)`，模型底面应在 `y ≈ 0`。
- CAD/SketchUp 常见问题：根节点 90° matrix、`Active View` 大坐标、网格远离原点 → **有占位、看不见**。

### `dimensions` / `scale` / `offset` 分工

| 字段 | 作用 |
| --- | --- |
| `dimensions` | **逻辑占位**（碰撞、能否放下、平面图），**不**缩放 GLB |
| `scale` | 视觉缩放（如毫米模型 `scale: [0.001, 0.001, 0.001]`） |
| `offset` | 视觉平移；模型已居中时多为 `[0,0,0]` |

`dimensions` 应与 **`scale` 后的视觉占地** 一致，否则会出现「看得见但放不进」或相反。

### 贴墙门示例（毫米 GLB）

GLB 包围盒约 788×145×2042（毫米）、高度沿 Z 轴时，目录可类似：

```ts
{
  id: 'my-door',
  category: 'furniture',
  name: '单开门',
  tags: ['wall', 'door', 'custom'],
  thumbnail: '/icons/couch.png',
  src: 'https://example.com/door.glb',
  dimensions: [0.9, 2.1, 0.12],
  offset: [0, 0, 0],
  rotation: [-Math.PI / 2, 0, 0],
  scale: [0.001, 0.001, 0.001],
  attachTo: 'wall-side',
},
```

放置时把光标移到 **墙体表面** 再点击，不要点在地板上。

### 编辑器自动居中

加载家具时，若包围盒中心距原点 &gt; 约 10 m（CAD 导出），Viewer 会**自动平移**几何到放置点附近（落地、贴墙、吊顶均适用）。实现：[`wrap-scene-for-placement.ts`](./packages/viewer/src/lib/wrap-scene-for-placement.ts)。

仍建议在 DCC 中规范导出；自动居中不能替代正确的 `scale` / `rotation`。

### Blender 导出清单

1. 删除无 mesh 的辅助节点（如 `Active View`）
2. **Ctrl+J** 合并为一个对象
3. 原点设到物体底面中心，**Apply All Transforms**
4. 导出 **GLB**，+Y Up，尺寸为米级
5. 用 [glTF Viewer](https://gltf-viewer.donmccurdy.com/) 复核

### 常见问题

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 有占位、看不见 | 原点远 + `scale` 不对 | 重导出；调 `scale`/`rotation`；硬刷新 |
| 地面放不进（红圈） | `dimensions` 过大或旧物占格 | 改 `dimensions`；删场景中旧节点 |
| 贴墙无反应 | 未点在墙上；`attachTo` 错误 | 用 `wall`/`wall-side`；光标贴墙 |
| 加载失败 | CORS / 非 GLB | 控制台 `Could not load` |

---

## 尺寸与校正（`dimensions` / `offset` / `rotation` / `scale`）

- `dimensions`：逻辑占位，不改 GLB 文件。
- `offset` / `rotation` / `scale`：对齐 Pascal 放置约定；新模型几乎都要调。
- `rotation` 单位为**弧度**（`Math.PI / 2` = 90°）。

流程：先放置 → 悬空/陷地/朝向不对 → 改三项直至贴合。

---

## `attachTo` 与 `surface`

| `attachTo` | 行为 |
| --- | --- |
| （省略） | 落地，`ItemTool` 地面放置 |
| `wall` | 贴墙（烟感、开关、门洞等） |
| `wall-side` | 侧向贴墙（搁板、门扇等） |
| `ceiling` | 吊顶 |

`surface: { height: n }`：可在该高度上叠放其他物品（如电视柜 `0.35`）。

---

## `tags` 与侧栏筛选

- **放置方式**（蓝芯片）：`floor`、`wall`、`ceiling`、`countertop`
- **功能标签**（紫/灰芯片）：任意字符串，用于搜索

建议：

- 落地物：含 `floor`
- 贴墙物：含 `wall`（不要只写 `floor`）
- **通过「添加」Tab 写入的条目**：自动带 `custom`，并可在同 Tab **删除**；手动改源码时请加 `'custom'`，否则开发 UI 里删不掉

---

## 开发 UI：添加 / 删除 `catalog-items.tsx`

仅本地 **`bun dev`**（`NODE_ENV=development`）可用。侧栏 **「添加」** Tab。

### 添加

填写名称、分类、尺寸、`attachTo` 等；模型/缩略图/平面图可填 **URL** 或上传文件（**URL 优先**）。

点击 **「写入 catalog-items.tsx 并放置」**：

1. 上传文件时保存到 `apps/editor/public/items/<id>/`
2. 在 `catalog-items.tsx` 末尾追加条目（`tags` 含 `custom`）
3. 跳转到 **Items** 进入放置

API：`POST /api/catalog-items`（`multipart/form-data`，字段 `metadata` + 可选 `model` / `thumbnail` / `floorPlan`）

### 删除

Tab 底部 **「删除自定义家具」**：

- 仅列出带 **`custom`** 标签的条目
- 确认后从 `catalog-items.tsx` 删除该对象，并删除 `public/items/<id>/`（若存在）
- **内置 CDN 家具**不可删

API：`DELETE /api/catalog-items?id=<条目id>`

**说明：** 删除目录**不会**移除场景里已放置的实例；需手动删节点或重新 Load Build。

---

## 手动追加一条目录

### 资源

| 资源 | 格式 | 说明 |
| --- | --- | --- |
| 模型 | `.glb` | 见 [GLB 要求](#glb-模型要求src) |
| 缩略图 | PNG/WebP | `thumbnail` |
| 平面图（可选） | PNG | `floorPlanUrl` |

### 代码位置

在 `CATALOG_ITEMS` 数组末尾追加（`/** Built-in catalog plus` 标记之前）：

```ts
{
  id: 'my-new-chair',
  category: 'furniture',
  name: 'My Chair',
  tags: ['floor', 'chair', 'custom'],
  thumbnail: '/items/my-new-chair/thumbnail.png',
  src: '/items/my-new-chair/model.glb',
  dimensions: [0.6, 0.9, 0.6],
  offset: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
},
```

保存后热更新，在 **Furnish → Items** 对应分类中可见。

### 最小条目（仅验证加载）

```ts
{
  id: 'test-chair',
  category: 'furniture',
  name: 'Test Chair',
  tags: ['floor', 'custom'],
  thumbnail: '/icons/couch.png',
  src: 'https://example.com/model.glb',
  dimensions: [1, 1, 1],
},
```

占位可能不准，需后续补全 `scale` / `offset` / `rotation`。

---

## 相关文件

| 文件 | 作用 |
| --- | --- |
| [`catalog-items.tsx`](./packages/editor/src/components/ui/item-catalog/catalog-items.tsx) | 目录数据 |
| [`item-catalog.tsx`](./packages/editor/src/components/ui/item-catalog/item-catalog.tsx) | 目录网格、选中放置 |
| [`add-catalog-panel.tsx`](./packages/editor/src/components/ui/sidebar/panels/add-catalog-panel.tsx) | 添加 / 删除 UI |
| [`apps/editor/app/api/catalog-items/route.ts`](./apps/editor/app/api/catalog-items/route.ts) | 开发环境 POST / DELETE API |
| [`apps/editor/lib/catalog-items-fs.ts`](./apps/editor/lib/catalog-items-fs.ts) | 读写源码与 `public/items/` |
| [`item.ts`](./packages/core/src/schema/nodes/item.ts) | `AssetInput` schema |
| [`wrap-scene-for-placement.ts`](./packages/viewer/src/lib/wrap-scene-for-placement.ts) | GLB 远离原点时自动居中 |
| [`asset-catalog.ts`](./packages/mcp/src/tools/asset-catalog.ts) | MCP 目录（需单独同步 `id`） |

---

## 注意事项

1. 新增 `src` 前阅读 [GLB 模型要求](#glb-模型要求src)。
2. `id` 全文件唯一。
3. 自定义条目建议保留 **`custom`** 标签，以便开发 UI 删除。
4. MCP：`place_item` 使用 `MCP_CATALOG_ITEMS`，Agent 要能放置需在 MCP 目录同步相同 `id`。
5. 场景内已放置家具的 `item.asset` 会写入 JSON；`Load Build` 不依赖目录条目是否仍存在。
6. 不支持 FBX/3DS 直接作 `src`；须转 GLB。
