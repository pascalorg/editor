# Render / Material / WebGPU 修复记录

> 目的：记录这次墙面颜色、填充材质、solid/rendered 差异、WebGPU zero-count draw 的问题根因和修复方向，避免后续再次改回错误实现。

## 背景

画布右上角 Display 里有 Render 模式：

- `solid`
- `rendered`

源仓库的正确效果是：

1. **不管 solid 还是 rendered，墙面都支持纯色和填充色显示。**
2. **solid 和 rendered 不能看起来完全一样。**
   - `solid` 使用更轻的 Lambert 风格材质，视觉更平。
   - `rendered` 使用 Standard/PBR 材质，并通过 post-processing / SSGI 等效果让物体更立体。

## 这次出现的问题

### 1. 墙面填充在 solid 下看不到

现象：

- 墙面“纯色”设置在 solid 下可见。
- 墙面“填充”设置在 solid 下不可见或一闪而过。
- 切到 rendered 后填充能看到。

错误理解：

- 曾把 solid 理解为“不显示贴图，只显示代表色”。
- 这不符合源仓库效果。

源仓库行为：

- `solid` 仍然会应用填充预设的 albedo 贴图。
- 区别只是材质类型：
  - `solid`：`MeshLambertNodeMaterial`
  - `rendered`：`MeshStandardNodeMaterial`

关键文件：

- `packages/viewer/src/lib/materials.ts`

正确方向：

- `createMaterialFromPreset()` 在 solid 下也必须调用 `applyMaterialPresetToMaterials()`。
- 不要在 solid 下跳过贴图。
- 不要把填充预设强行降级为纯色 fallback。

## 2. solid 和 rendered 看起来一样

现象：

- rendered 没有明显立体感。
- 物品自身阴影 / AO / GI 效果弱化或消失。

原因：

- 本地曾把 `SSGI_PARAMS.enabled` 改成了 `false`。
- rendered 的 post-processing 效果被关掉后，看起来会接近 direct render / solid。
- 另外 post-fx 降级状态如果长期保留，也可能导致切回 rendered 后仍走 direct renderer path。

关键文件：

- `packages/viewer/src/components/viewer/post-processing.tsx`

正确方向：

- `SSGI_PARAMS.enabled` 应保持 `true`，与源仓库一致。
- `shading === 'rendered'` 时允许 SSGI / post-processing 参与。
- 切换 render / edges / shadows / scene 时，应重新尝试 post-processing pipeline，不要永久卡在降级 direct path。

## 3. 墙面填充颜色一闪后丢失 / 画布颜色变深

相关原因：

- 墙材质在下一帧被 `WallCutout` 或 wall renderer 重新替换。
- 替换时如果没有带上当前 viewer render settings，就可能把当前 solid/rendered、theme、color preset、textures 状态弄丢。

关键文件：

- `packages/viewer/src/systems/wall/wall-materials.ts`
- `packages/viewer/src/systems/wall/wall-cutout.tsx`
- `packages/nodes/src/wall/renderer.tsx`
- `packages/editor/src/components/editor/selection-manager.tsx`

正确方向：

- 生成墙材质时必须带当前 render settings：
  - `shading`
  - `textures`
  - `colorPreset`
  - `sceneTheme`
- 墙材质 cache hash 也要包含这些 render settings。
- hover / paint preview 也必须用同一套 render settings，否则 preview 清理或下一帧系统更新会覆盖用户选择。

## 4. WebGPU 报错：Vertex buffer slot was not set

典型日志：

```txt
[viewer] WebGPU uncaptured error: Vertex buffer slot 1 required by [RenderPipeline "renderPipeline_MeshLambertNodeMaterial_..."] was not set.
[Invalid CommandBuffer from CommandEncoder "renderContext_2"] is invalid due to a previous error.
```

后续定位日志：

```txt
[viewer] skipped a zero-count draw (would poison the WebGPU command encoder) {
  name: 'merged-stair',
  material: 'MeshLambertNodeMaterial',
  group: { count: 0, materialIndex: 0, start: 0 }
}
```

根因：

- `merged-stair` 占位几何里有 `group.count: 0`。
- WebGPU 对 draw validation 很严格。
- 即使 position attribute 存在，只要实际提交的是 zero-count group，也可能让 WebGPU command encoder 进入 invalid 状态。
- 一次错误 draw 会污染整个 CommandBuffer，后续渲染都会报 Invalid CommandBuffer。

关键文件：

- `packages/viewer/src/lib/drawable-geometry.ts`
- `packages/viewer/src/lib/webgpu-draw-guard.ts`
- `packages/viewer/src/lib/safe-geometry.ts`
- `packages/viewer/src/systems/stair/stair-system.tsx`

修复方向：

1. Renderer guard 不只检查 `position.count`，还要检查：
   - `drawRange.count`
   - `index.count`
   - `group.count`
   - `group.start` 是否越界
2. 对于真的不能画的 draw，在进入 WebGPU 前跳过。
3. 占位几何不要创建 `count: 0` 的 group。
   - 使用一个非空的退化三角形 group。
   - 视觉不可见，但 WebGPU validation 能通过。
4. 保护日志应为 `console.debug`，不要在正常后台运行时刷 `warn`。

## 5. 关于材质库 solid 代表色

曾补充过 `getMaterialSolidColorByRef()`：

- 用于没有贴图上下文的地方，例如 2D floorplan、ghost preview、textures 关闭时的 fallback。
- 不应该用它替代 solid 下的真实填充贴图显示。

正确使用场景：

- floorplan 填色
- ghost preview 颜色
- textures=false 的纯色 fallback
- ceiling overlay 这类只需要颜色、不需要真实贴图的预览

错误使用场景：

- solid 模式的真实 3D 填充材质渲染

## 保持和源仓库一致的准则

后续修改 Display / Render / Material 相关逻辑时，先确认以下约束：

1. `solid` 也要显示填充贴图。
2. `rendered` 要保留 PBR / SSGI / post-processing 立体效果。
3. 不要为了避免 WebGPU 问题关闭 rendered 的核心效果，除非有明确 fallback 和重试机制。
4. 不要生成 `group.count === 0` 的 geometry group 给 WebGPU。
5. 墙、屋顶、楼梯、道路、品件等通用材质入口应尽量走 `createMaterialFromPresetRef()` / `createMaterial()`，不要各自复制半套材质逻辑。
6. 任何 wall material rebuild 都必须传入当前 viewer render settings。

## 验证命令

相关修改后至少运行：

```bash
bun run build
```

在这些包里分别验证：

```bash
cd packages/core && bun run build
cd packages/viewer && bun run build
cd packages/nodes && bun run build
cd packages/editor && bun run check-types
```

如果改了材质库 fallback，可运行：

```bash
bun test packages/core/src/material-library.test.ts
```

如果出现 WebGPU draw 问题，重点查看是否有：

- `group.count: 0`
- `position.count: 0`
- 缺少 `uv / uv2 / normal / tangent / color`
- `drawRange.count <= 0`
- `index.count <= 0`

## 最近一次修复涉及的主要文件

- `packages/core/src/material-library.ts`
- `packages/viewer/src/lib/materials.ts`
- `packages/viewer/src/lib/drawable-geometry.ts`
- `packages/viewer/src/lib/webgpu-draw-guard.ts`
- `packages/viewer/src/lib/safe-geometry.ts`
- `packages/viewer/src/components/viewer/post-processing.tsx`
- `packages/viewer/src/systems/wall/wall-materials.ts`
- `packages/viewer/src/systems/wall/wall-cutout.tsx`
- `packages/viewer/src/systems/stair/stair-system.tsx`
- `packages/nodes/src/wall/renderer.tsx`
- `packages/nodes/src/road/geometry.ts`
- `packages/nodes/src/road/floorplan.ts`
- `packages/editor/src/components/editor/selection-manager.tsx`

## 一句话结论

这次问题不是单纯“颜色没写进去”，而是三条链路叠加：

1. solid 填充不应禁用贴图；
2. rendered 不能关闭 SSGI/post-processing；
3. WebGPU 不能接收 zero-count draw/group。

以后如果墙面填充、画布变深、rendered 不立体、WebGPU Invalid CommandBuffer 同时出现，优先从这三条链路排查。
