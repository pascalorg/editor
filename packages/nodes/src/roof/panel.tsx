'use client'

import { type RoofNode, useScene } from '@pascal-app/core'
import { commitParametricNodeFields, PanelRows, PanelWrapper } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { roofPanelModel } from './panel-model'

export default function RoofPanel() {
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const nodes = useScene((state) => state.nodes)
  const node = selectedId ? nodes[selectedId] : undefined
  if (node?.type !== 'roof') return null
  return (
    <PanelWrapper
      title={node.name || 'Roof'}
      icon="/icons/roof.webp"
      width={300}
      onClose={() => useViewer.getState().setSelection({ selectedIds: [] })}
    >
      <PanelRows
        rows={roofPanelModel.rows({
          node: node as RoofNode,
          nodes,
          update: (patch) => commitParametricNodeFields(node.id, patch),
        })}
      />
    </PanelWrapper>
  )
}
