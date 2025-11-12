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

#### Wall Component (`components/registry/wall.tsx`)

- **Renderer Props Schema**: `WallRendererPropsSchema` - validates renderer-specific props (optional)
- **Node Editor**: `WallBuilder` - manages two-click wall placement logic using `useEditor` hooks
- **Node Renderer**: Reuses existing `WallRenderer`

#### Column Component (`components/registry/column.tsx`)

- **Renderer Props Schema**: `ColumnRendererPropsSchema` - validates renderer props (height, diameter)
- **Node Editor**: `ColumnBuilder` - manages single-click column placement logic using `useEditor` hooks
- **Node Renderer**: Reuses existing `ColumnRenderer`

### 3. Integration Points

#### Editor Integration (`components/editor/index.tsx`)

- Imports registry to trigger component registration
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

#### Registry Module (`components/registry/index.ts`)

- Pure TypeScript module (no JSX)
- Imports and triggers component registrations
- Re-exports registry utilities (`getNodeEditor`, `getRenderer`, etc.)

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

### Pending Migration
- ⏳ Room
- ⏳ Custom Room
- ⏳ Roof
- ⏳ Slab
- ⏳ Door
- ⏳ Window
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
- `components/registry/wall.tsx` - Wall node editor + registration
- `components/registry/column.tsx` - Column node editor + registration

### Modified
- `components/editor/index.tsx` - Added `RegistryNodeEditor` helper, imports registry components directly
- `components/renderer/node-renderer.tsx` - Added registry renderer lookup with `getRenderer()`
- `package.json` - Added zod v4 dependency

### Removed
- `components/registry/index.ts` - Unnecessary middleman file

