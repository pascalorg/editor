# Component Registry Implementation

## Overview

This document describes the implementation of the Zod-backed component registry system for the scene graph node architecture. The registry provides a centralized way to register, discover, and manage building components with type-safe schemas and lifecycle hooks.

## Architecture

### 1. Registry Core (`lib/nodes/registry.ts`)

The registry module provides:

- **Zod-powered schemas** for renderer props validation
- **Type-safe registration API** for component authors
- **Helper functions** for renderer/builder lookup
- **Centralized component metadata**

#### Key Types

```typescript
interface ComponentConfig {
  nodeType: string                           // Must match node.type
  nodeName: string                           // Human-readable name
  editorMode: 'select' | 'delete' | 'building' | 'guide'
  toolName?: string                          // For building mode
  toolIcon?: React.ComponentType             // Tool icon component
  rendererPropsSchema?: z.ZodType            // Zod schema for renderer props
  nodeEditor?: React.FC                      // Editor logic (maps actions → nodes)
  nodeRenderer: React.FC<{ node: BaseNode }> // 3D renderer component
}
```

**Key Design Decisions:**
- **nodeEditor** contains the logic that maps user actions to scene graph operations (add/update/delete nodes)
- **nodeRenderer** is the 3D visual component
- Node editors use `useEditor` hooks directly - no separate context system
- Renderer props schemas validate renderer-specific configuration, not full node structure

### 2. Component Registrations

#### Wall Node (`components/nodes/wall/wall-node.tsx`)

- **Renderer Props Schema**: `WallRendererPropsSchema` - co-located schema validating renderer-specific props (optional)
- **Node Editor**: `WallNodeEditor` - manages two-click wall placement logic using `useEditor` hooks and grid events
- **Node Renderer**: Reuses existing `WallRenderer`
- **Registration**: `registerComponent()` is invoked inside the module so importing `wall-node` registers everything

#### Column Node (`components/nodes/column/column-node.tsx`)

- **Renderer Props Schema**: `ColumnRendererPropsSchema` - validates renderer props (height, diameter)
- **Node Editor**: `ColumnNodeEditor` - handles hover preview plus single-click placement via `useEditor`
- **Node Renderer**: Reuses existing `ColumnRenderer`
- **Registration**: Registration happens within `column-node` as a side effect

> Both node editors previously lived in `components/editor/elements/*-builder.tsx`; the builder files were removed in favor of this co-located approach.

### 3. Integration Points

#### Editor Integration (`components/editor/index.tsx`)

- Side-effect imports node modules (`@/components/nodes/wall/wall-node` and `@/components/nodes/column/column-node`) to trigger registration
- Uses `getNodeEditor()` helper to render node editors for wall and column
- Maintains fallback to legacy builders for non-migrated components

```tsx
// Helper component
function RegistryNodeEditor({ toolName }: { toolName: string }) {
  const NodeEditor = getNodeEditor(toolName)
  if (!NodeEditor) return null
  return <NodeEditor />
}

// In render:
{/* Registry-based node editors for migrated components */}
{controlMode === 'building' &&
  activeTool &&
  ['wall', 'column'].includes(activeTool) &&
  isActiveFloor && <RegistryNodeEditor toolName={activeTool} />}

{/* Legacy builders for non-migrated components */}
{controlMode === 'building' && activeTool === 'room' && isActiveFloor && (
  <RoomBuilder />
)}
```

#### Renderer Integration (`components/renderer/node-renderer.tsx`)

- Checks registry for renderer first: `getRenderer(node.type)`
- Falls back to direct imports if not registered
- Ensures backward compatibility during migration

```tsx
const RegistryRenderer = getRenderer(node.type)

{RegistryRenderer ? (
  <RegistryRenderer node={node} />
) : (
  // Fallback to legacy renderers
)}
```

#### Registration Imports

- Registration now occurs within each node module
- Any runtime that needs the component simply imports the node module for its side effects
- Additional helper utilities (`getNodeEditor`, `getRenderer`, etc.) continue to live in `lib/nodes/registry`

## Usage

### Registering a New Component

```tsx
import { registerComponent } from '@/lib/nodes/registry'
import { useEditor } from '@/hooks/use-editor'
import { emitter } from '@/events/bus'
import { z } from 'zod'

// 1. Define Zod schema for renderer props (optional)
const MyNodeRendererPropsSchema = z.object({
  // Renderer-specific props, not the full node
  customColor: z.string().optional(),
  lodLevel: z.number().optional(),
})

// 2. Create node editor (maps user actions → scene graph operations)
function MyNodeEditor() {
  const addNode = useEditor((state) => state.addNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  
  useEffect(() => {
    const handleClick = (e: GridEvent) => {
      // Map user action to node creation
      addNode({ 
        type: 'my-node',
        name: 'My Node',
        visible: true,
        opacity: 100,
        children: [],
      } as any, selectedFloorId)
    }
    
    emitter.on('grid:click', handleClick)
    return () => emitter.off('grid:click', handleClick)
  }, [addNode, selectedFloorId])
  
  return null // Editor logic, not visual
}

// 3. Create node renderer (3D visual component)
function MyNodeRenderer({ node }: { node: BaseNode }) {
  return <mesh>...</mesh>
}

// 4. Register component
registerComponent({
  nodeType: 'my-node',
  nodeName: 'My Node',
  editorMode: 'building',
  toolName: 'my-node',
  toolIcon: MyIcon,
  rendererPropsSchema: MyNodeRendererPropsSchema,
  nodeEditor: MyNodeEditor,
  nodeRenderer: MyNodeRenderer,
})
```

### Adding to Editor

Update `components/editor/index.tsx` to include your tool:

```tsx
['wall', 'column', 'my-node'].includes(activeTool)
```

The `RegistryNodeEditor` helper will automatically find and render your node editor!

## Benefits

1. **Type Safety**: Zod schemas provide runtime validation for renderer props
2. **Centralized Config**: All component metadata in one place
3. **Discoverable**: Registry can introspect available components
4. **Simple Integration**: Builder components use existing `useEditor` hooks directly
5. **Gradual Migration**: Fallback system allows incremental adoption
6. **Testable**: Components can be registered/unregistered for testing
7. **No Context Overhead**: No parallel state management - everything uses `useEditor`

## Migration Status

### Migrated Components
- ✅ Wall
- ✅ Column
- ✅ Slab
- ✅ Door
- ✅ Window
- ✅ Roof
- ✅ Room
- ✅ Custom Room

### Pending Migration
- ⏳ Reference Image
- ⏳ Scan

## Future Enhancements

1. **Dynamic Tool Menu**: Generate building menu from registry
2. **Validation Layer**: Use schemas to validate all node mutations
3. **Plugin System**: Allow third-party components via registry
4. **Undo/Redo**: Hook into lifecycle for command pattern
5. **Serialization**: Use schemas for JSON export/import validation

## Files Created/Modified

### Created
- `lib/nodes/registry.ts` - Core registry module (metadata & utilities)
- `components/nodes/wall/wall-node.tsx` - Wall node editor + registration (co-located with renderer)
- `components/nodes/column/column-node.tsx` - Column node editor + registration (co-located with renderer)
- `components/nodes/slab/slab-node.tsx` - Slab node editor + registration
- `components/nodes/door/door-node.tsx` - Door node editor + registration
- `components/nodes/window/window-node.tsx` - Window node editor + registration
- `components/nodes/roof/roof-node.tsx` - Roof node editor + registration
- `components/nodes/room/room-node.tsx` - Room node editor + registration
- `components/nodes/custom-room/custom-room-node.tsx` - Custom room node editor + registration

### Modified
- `components/editor/index.tsx` - Imports all node modules to trigger registration and renders `RegistryNodeEditor` for all building tools
- `components/renderer/node-renderer.tsx` - Uses registry renderer lookup with `getRenderer()`
- `package.json` - Added zod v4 dependency

### Removed
- `components/editor/elements/wall-builder.tsx`
- `components/editor/elements/column-builder.tsx`
- `components/editor/elements/slab-builder.tsx`
- `components/editor/elements/door-builder.tsx`
- `components/editor/elements/window-builder.tsx`
- `components/editor/elements/roof-builder.tsx`
- `components/editor/elements/room-builder.tsx`
- `components/editor/elements/custom-room-builder.tsx`
- `components/registry/index.ts`
- `components/registry/wall.tsx`
- `components/registry/column.tsx`

