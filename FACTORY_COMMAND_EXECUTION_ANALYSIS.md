# Factory Creation & Command Execution 完整运行逻辑分析

## 核心发现

### 问题 1: "创建一个炼油厂" → 系统完整流程

✅ **流程链路**:
- API: POST /api/ai-harness/runs (route.ts:L49)
- 启动: ensureFactoryRunRunning() (factory-runner.ts:L853)
- 主循环: runFactoryRun() (factory-runner.ts:L866)
  - Step 1: buildFactoryRunResultFromSelectionEdit() (L884) - 检查是否编辑现有对象
  - Step 2: planFactoryRequest() (factory-planner.ts) - AI 规划工厂类型
  - Step 3: composeProcessLine() (process-line-composer.ts) - 组合工艺线路
    - 创建壳体、设备、管道（根据介质上色，但透明度固定为1）
  - 返回 patches（所有创建指令）

### 问题 2: "把管道透明度设置成80%" → 能执行吗？

❌ **当前不能**

**原因**:
- 系统会识别为"选择编辑"命令
- 调用 composeSelectionEdit() 分发器
- 但没有 looksLikeSelectionOpacityEdit() 函数
- 所有编辑函数都不匹配 → 返回 null
- 降级到"规划新工厂"流程（错误的处理）

**现有编辑函数** (factory-selection-edit.ts:L1254):
1. composeSelectionDeleteEdit() - 删除
2. composeSelectionMoveEdit() - 移动
3. composeSelectionRotateEdit() - 旋转
4. composeSelectionColorEdit() - 改颜色 ✅
5. composeSelectionTankKindEdit() - 改罐体
6. composeSelectionTowerLevelEdit() - 改塔吊
7. composeSelectionGeometryEdit() - 改大小
8. composeSelectionReplaceEdit() - 替换
9. **composeSelectionOpacityEdit() - 改透明度** ❌ 缺失

## 关键代码位置

### 工厂创建流程
- API: app/api/ai-harness/runs/route.ts:L49
- 启动: lib/ai-harness-runs/factory-runner.ts:L853
- 主循环: lib/ai-harness-runs/factory-runner.ts:L866
- 规划: lib/ai-harness-runs/factory-planner.ts
- 工艺线路: lib/ai-harness-runs/process-line-composer.ts
- 管道颜色: process-line-composer.ts:L64-73 (MEDIUM_COLOR)
- 管道创建: process-line-composer.ts:L375-408 (createConnectionPatch)

### 选择编辑流程
- 入口: factory-runner.ts:L884 buildFactoryRunResultFromSelectionEdit()
- 分发: factory-selection-edit.ts:L1254 composeSelectionEdit()
- 颜色编辑（参考）: factory-selection-edit.ts:L1158 composeSelectionColorEdit()
- 检测: factory-selection-edit.ts:L121 looksLikeSelectionColorEdit()
- 解析: factory-selection-edit.ts:L239 resolveSelectionEditColor()

## 实现透明度编辑所需代码

### 1. 检测函数
```typescript
export function looksLikeSelectionOpacityEdit(prompt: string) {
  return /透明度|opacity|transparent|alpha|半透明|(\d+)\s*%/.test(prompt)
}
```

### 2. 解析函数
```typescript
export function resolveSelectionOpacity(prompt: string): number | undefined {
  const percentMatch = /(\d+(?:\.\d+)?)\s*%/.exec(prompt)
  if (percentMatch) {
    return Math.max(0, Math.min(1, Number(percentMatch[1]) / 100))
  }
  
  const floatMatch = /0\.\d+/.exec(prompt)
  if (floatMatch) {
    return Math.max(0, Math.min(1, Number(floatMatch[0])))
  }
  
  if (/全透明|完全透明|invisible/.test(prompt)) return 0
  if (/半透明|semi-transparent/.test(prompt)) return 0.5
  if (/不透明|opaque/.test(prompt)) return 1
  
  return undefined
}
```

### 3. 执行函数
```typescript
export function composeSelectionOpacityEdit(input: {
  prompt: string
  context?: unknown
}): FactorySelectionEditResult | null {
  const opacity = resolveSelectionOpacity(input.prompt)
  if (opacity === undefined) return null
  
  const snapshot = selectionSnapshotFromContext(input.context)
  if (!snapshot?.selectedIds.length) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason: 'No canvas object is selected.',
    }
  }
  
  const candidates = expandedEditableNodes(snapshot).filter(
    (node) => MATERIAL_NODE_TYPES.has(node.type) || node.color !== undefined
  )
  
  if (!candidates.length) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason: 'No selectable object with material found.',
    }
  }
  
  const patches = candidates.flatMap((node) => {
    const material = { ...node.material } as Record<string, unknown>
    if (!material.properties) {
      material.properties = {}
    }
    const properties = material.properties as Record<string, unknown>
    properties.opacity = opacity
    properties.transparent = opacity < 1
    
    return [{
      op: 'update' as const,
      id: node.id,
      data: { material }
    }]
  })
  
  return {
    patches,
    nodeIds: patches.map(p => p.id),
    changed: patches.map(
      p => snapshot.nodes.find(n => n.id === p.id)?.name ?? p.id
    ),
    summary: patches.map(
      p => `${snapshot.nodes.find(n => n.id === p.id)?.name ?? p.id}: opacity -> ${opacity}`
    )
  }
}
```

### 4. 更新分发函数 (L1254-1268)
在 composeSelectionEdit() 中加入:
```typescript
composeSelectionOpacityEdit(input) ??  // ← 在 ColorEdit 之后
```

## 工厂初始创建中的透明度

- 位置: factory-selection-edit.ts:L254-266 customMaterial()
- 当前值: opacity: 1 (硬编码100%不透明)
- transparent: false

## 选择编辑数据流

```
context = {
  selection: {
    selectedIds: ['pipe_1', 'pipe_2', 'pipe_3'],
    nodes: [
      { id: 'pipe_1', type: 'pipe', color: '#38bdf8', material: {...} },
      { id: 'pipe_2', type: 'pipe', color: '#38bdf8', material: {...} },
      { id: 'pipe_3', type: 'pipe', color: '#38bdf8', material: {...} },
    ]
  }
}
  ↓
composeSelectionOpacityEdit(input)
  ↓
返回 3 个 patches:
[
  { op: 'update', id: 'pipe_1', data: { material: { properties: { opacity: 0.8, transparent: true } } } },
  { op: 'update', id: 'pipe_2', data: { material: { properties: { opacity: 0.8, transparent: true } } } },
  { op: 'update', id: 'pipe_3', data: { material: { properties: { opacity: 0.8, transparent: true } } } }
]
  ↓
WebSocket 发送到渲染引擎
  ↓
3D 视图中管道变为 80% 透明
```

## 参考实现（颜色编辑）

颜色编辑是完整的参考实现:
- 检测: looksLikeSelectionColorEdit() (L121-125)
- 解析: resolveSelectionEditColor() (L239-252)
- 执行: composeSelectionColorEdit() (L1158-1198)
- 材质: customMaterial() (L254-266)
- 节点类型: MATERIAL_NODE_TYPES (L63-92)

