---
description: Node type definitions, Zod schema pattern, and how to create nodes in the scene
globs: packages/core/src/schema/**
alwaysApply: false
---

# Node Schemas

All node types are defined as Zod schemas in `packages/core/src/schema/nodes/`. Each schema extends `BaseNode` and exports both the schema and its inferred TypeScript type.

**Sources**: @packages/core/src/schema/base.ts, @packages/core/src/schema/nodes/

## BaseNode

Every node shares these fields:

```ts
{
  object: 'node'            // always literal 'node'
  id: string                // typed ID e.g. "wall_abc123"
  type: string              // node type discriminator e.g. "wall"
  name?: string             // optional display name
  parentId: string | null   // parent node ID; null = root
  visible: boolean          // defaults to true
  metadata: Record<string, unknown>  // arbitrary JSON, defaults to {}
}
```

## Defining a New Node Type

```ts
// packages/core/src/schema/nodes/my-node.ts
import { z } from 'zod'
import { BaseNode, objectId, nodeType } from '../base'

export const MyNode = BaseNode.extend({
  id: objectId('my-node'),      // generates IDs like "my-node_abc123"
  type: nodeType('my-node'),    // sets literal type discriminator
  // add node-specific fields:
  width: z.number().default(1),
  label: z.string().optional(),
}).describe('My node — one-line description of what it represents')

export type MyNode = z.infer<typeof MyNode>
export type MyNodeId = MyNode['id']
```

Then add `MyNode` to the `AnyNode` union in `packages/core/src/schema/types.ts`.

## Creating Nodes in Tools

Always use `.parse()` to validate and generate a proper typed ID. Never construct a plain object manually.

```ts
import { WallNode } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'

// 1. Parse validates and fills defaults (including auto-generated id)
const wall = WallNode.parse({ name: 'Wall 1', start: [0, 0], end: [5, 0] })

// 2. createNode(node, parentId?) inserts it into the scene
const { createNode } = useScene.getState()
createNode(wall, levelId)
```

For batch creation:

```ts
const { createNodes } = useScene.getState()
createNodes([
  { node: WallNode.parse({ start: [0, 0], end: [5, 0] }), parentId: levelId },
  { node: WallNode.parse({ start: [5, 0], end: [5, 4] }), parentId: levelId },
])
```

## Updating Nodes

```ts
const { updateNode } = useScene.getState()
updateNode(wall.id, { height: 2.8 })   // partial update, merges with existing
```

## Real Examples

- **Simple geometry node**: @packages/core/src/schema/nodes/wall.ts — `start`, `end`, `thickness`, `height`
- **Polygon node**: @packages/core/src/schema/nodes/slab.ts — `polygon: [number, number][]`, `holes`
- **Positioned node**: @packages/core/src/schema/nodes/item.ts — `position`, `rotation`, `scale`, `asset`

## Rules

- **Always use `.parse()`** — it generates the correct ID prefix and fills defaults. `WallNode.parse({...})` not `{ type: 'wall', id: '...' }`.
- **Never hardcode IDs.** Let `objectId('type')` generate them.
- **Add new node types to `AnyNode`** in `types.ts` or they won't be accepted by the store.
- **Keep schemas in `packages/core`**, not in the viewer or editor — the schema is shared by all packages.
