// ============================================================================
// REGISTER BUILDING COMPONENT
// ============================================================================

import { Building2 } from 'lucide-react'
import { registerComponent } from '../../../registry'
import { SiteNode } from '@pascal/core/scenegraph/schema/nodes/site'
import { SiteRenderer } from './site-renderer'

// ============================================================================
// BUILDING BUILDER COMPONENT
// ============================================================================

/**
 * Building node editor component
 * Buildings don't have interactive editing UI
 */
export function SiteNodeEditor() {
  return null
}

// ============================================================================
// REGISTER BUILDING COMPONENT
// ============================================================================

registerComponent({
  nodeType: 'site',
  nodeName: 'Site',
  editorMode: 'building',
  schema: SiteNode,
  nodeEditor: SiteNodeEditor,
  nodeRenderer: SiteRenderer,
  toolIcon: Building2,
})
