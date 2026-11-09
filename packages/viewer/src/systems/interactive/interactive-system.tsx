'use client'

import {
  type AnyNode,
  type AnyNodeId,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useCallback, useState } from 'react'
import type { Object3D } from 'three'
import { SelectionCallout } from '../../components/viewer/selection-callout'
import useViewer from '../../store/use-viewer'
import { calloutSubtitle, hasCallout, nodeCalloutActions } from './callout-actions'

function calloutTitle(node: AnyNode): string {
  if (node.name) return node.name
  const asset = (node as { asset?: { name?: string } }).asset
  if (asset?.name) return asset.name
  const word = node.type.replaceAll('-', ' ')
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * The parametric viewer's callout on the one selected element: its name, what
 * it is, and what it can do (open a door, switch a lamp, close the shutters).
 */
export const InteractiveSystem = () => {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const walkthrough = useViewer((s) => s.walkthroughMode)
  const node = useScene((s) =>
    selectedIds.length === 1
      ? (s.nodes[selectedIds[0] as AnyNodeId] as AnyNode | undefined)
      : undefined,
  )
  if (walkthrough || !node || !hasCallout(node.type)) return null
  return <NodeCallout key={node.id} node={node} />
}

function NodeCallout({ node }: { node: AnyNode }) {
  const [object, setObject] = useState<Object3D | null>(null)
  // The renderer registers the object a frame or more after selection lands,
  // and may swap it for a new one when the element rebuilds (a sash opening).
  useFrame(() => {
    const registered = sceneRegistry.nodes.get(node.id) ?? null
    if (registered !== object) setObject(registered)
  })

  const title = calloutTitle(node)
  const interactive = useInteractive()
  const actions = nodeCalloutActions(node, title, interactive)
  const dismiss = useCallback(() => {
    const { selection, setSelection } = useViewer.getState()
    if (selection.selectedIds.includes(node.id)) setSelection({ selectedIds: [] })
  }, [node.id])

  if (!object) return null
  return (
    <SelectionCallout
      actions={actions}
      object={object}
      onDismiss={dismiss}
      subtitle={calloutSubtitle(node, title)}
      title={title}
    />
  )
}
