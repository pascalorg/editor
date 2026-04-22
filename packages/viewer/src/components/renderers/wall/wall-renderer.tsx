import { useRegistry, useScene, type WallNode } from '@pascal-app/core'
import { useLayoutEffect, useRef } from 'react'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import useViewer from '../../../store/use-viewer'
import { getVisibleWallMaterials } from '../../../systems/wall/wall-materials'
import { NodeRenderer } from '../node-renderer'

export const WallRenderer = ({ node }: { node: WallNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'wall', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'wall')
  const materialPreview = useViewer((state) =>
    state.materialPreview?.target === 'wall' && state.materialPreview.nodeId === node.id
      ? state.materialPreview
      : null,
  )
  const previewNode =
    materialPreview && materialPreview.role === 'interior'
      ? {
          ...node,
          interiorMaterial: materialPreview.material,
          interiorMaterialPreset: materialPreview.materialPreset,
          material: undefined,
          materialPreset: undefined,
        }
      : materialPreview && materialPreview.role === 'exterior'
        ? {
            ...node,
            exteriorMaterial: materialPreview.material,
            exteriorMaterialPreset: materialPreview.materialPreset,
            material: undefined,
            materialPreset: undefined,
          }
        : node
  const material = getVisibleWallMaterials(previewNode)

  return (
    <mesh castShadow material={material} receiveShadow ref={ref} visible={node.visible}>
      <boxGeometry args={[0, 0, 0]} />
      <mesh name="collision-mesh" visible={false} {...handlers}>
        <boxGeometry args={[0, 0, 0]} />
      </mesh>

      {node.children.map((childId) => (
        <NodeRenderer key={`${node.id}:${childId}`} nodeId={childId} />
      ))}
    </mesh>
  )
}
