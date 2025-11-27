// ============================================================================
// REGISTER COLUMN COMPONENT
// ============================================================================

import { Layers } from 'lucide-react'
import z from 'zod'
import { GridTiles } from '@/components/editor/grid-tiles'
import { useEditor } from '@/hooks/use-editor'
import { componentRegistry, registerComponent } from '@/lib/nodes/registry'
import { LevelNode } from '@/lib/scenegraph/schema/nodes/level'
import { LevelRenderer } from './level-renderer'

// ============================================================================
// LEVEL BUILDER COMPONENT
// ============================================================================
/**
 * Helper component to render registry-based node editors by tool name
 */
function RegistryNodeEditor({ toolName }: { toolName: string }) {
  const entry = componentRegistry.getByTool(toolName)
  if (!entry?.config.nodeEditor) return null
  const NodeEditor = entry.config.nodeEditor
  return <NodeEditor />
}

/**
 * Helper component to render all node editors for a specific mode
 */
function RegistryModeEditors({ mode }: { mode: 'guide' | 'select' | 'delete' | 'building' }) {
  const entries = componentRegistry.getByMode(mode)
  return (
    <>
      {entries.map((entry) => {
        if (!entry.config.nodeEditor) return null
        const NodeEditor = entry.config.nodeEditor
        return <NodeEditor key={entry.config.nodeType} />
      })}
    </>
  )
}
/**
 * Level builder component
 * Uses useEditor hooks directly to manage level placement
 */
export function LevelNodeEditor() {
  const controlMode = useEditor((state) => state.controlMode)
  const activeTool = useEditor((state) => state.activeTool)

  return (
    <>
      {controlMode === 'building' && activeTool && <RegistryNodeEditor toolName={activeTool} />}
      {controlMode === 'guide' && <RegistryModeEditors mode="guide" />}
      <GridTiles />
    </>
  )
}

// ============================================================================
// REGISTER LEVEL COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'level',
  nodeName: 'Level',
  editorMode: 'building',
  schema: LevelNode,
  nodeEditor: LevelNodeEditor,
  nodeRenderer: LevelRenderer,
  toolIcon: Layers,
})
