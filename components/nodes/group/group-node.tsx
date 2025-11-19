import { Group } from 'lucide-react'
import { z } from 'zod'
import { registerComponent } from '@/lib/nodes/registry'

// ============================================================================
// GROUP RENDERER PROPS SCHEMA
// ============================================================================

export const GroupRendererPropsSchema = z.object({}).optional()

// ============================================================================
// REGISTER GROUP COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'group',
  nodeName: 'Group',
  editorMode: 'building',
  toolIcon: Group,
  rendererPropsSchema: GroupRendererPropsSchema,
  nodeEditor: () => null, // No specific editor logic for generic groups yet
  nodeRenderer: null,
})
