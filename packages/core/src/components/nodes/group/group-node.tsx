import { GroupNode } from '@pascal/core/scenegraph/schema/nodes/group'
import { Group } from 'lucide-react'
import { registerComponent } from '../../../registry'

// ============================================================================
// REGISTER GROUP COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'group',
  nodeName: 'Group',
  editorMode: 'building',
  toolIcon: Group,
  schema: GroupNode,
  nodeEditor: () => null, // No specific editor logic for generic groups yet
  nodeRenderer: null,
})
