import { Group } from 'lucide-react'
import { z } from 'zod'
import { registerComponent } from '@/lib/nodes/registry'
import { GroupRenderer } from '@/components/renderer/group-renderer'

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
  nodeRenderer: GroupRenderer,
})

