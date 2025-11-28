// ============================================================================
// REGISTER BUILDING COMPONENT
// ============================================================================

import { Building2 } from 'lucide-react'
import { registerComponent } from '@/lib/nodes/registry'
import { BuildingNode } from '@/lib/scenegraph/schema/nodes/building'
import { BuildingRenderer } from './building-renderer'

// ============================================================================
// BUILDING BUILDER COMPONENT
// ============================================================================

/**
 * Building node editor component
 * Buildings don't have interactive editing UI
 */
export function BuildingNodeEditor() {
  return null
}

// ============================================================================
// REGISTER BUILDING COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'building',
  nodeName: 'Building',
  editorMode: 'building',
  schema: BuildingNode,
  nodeEditor: BuildingNodeEditor,
  nodeRenderer: BuildingRenderer,
  toolIcon: Building2,
})
