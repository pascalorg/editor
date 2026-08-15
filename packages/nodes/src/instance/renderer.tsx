'use client'

import {
  type AnyNodeId,
  buildCollectionMembershipIndex,
  type InstanceNode,
  isHiddenByCollections,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useRef } from 'react'
import type { Group, Material, Mesh } from 'three'
import { useIsInsideDefinitionSource } from './definition-source-context'
import { useDefinitionRenderData } from './render-cache'

const NO_RAYCAST = () => {}

export default function InstanceRenderer({ node }: { node: InstanceNode }) {
  const registeredRef = useRef<Group>(null!)
  const handlers = useNodeEvents(node, 'instance')
  useRegistry(node.id, 'instance', registeredRef)

  const data = useDefinitionRenderData(node.definitionId)
  const insideDefinitionSource = useIsInsideDefinitionSource()
  const liveTransform = useLiveTransforms((state) => state.get(node.id as AnyNodeId))
  const liveOverride = useLiveNodeOverrides((state) => state.overrides.get(node.id))
  const collectionMembership = useScene((state) =>
    buildCollectionMembershipIndex(state.collections),
  )
  const active = useViewer(
    (state) =>
      state.hoveredId === node.id ||
      state.selection.selectedIds.includes(node.id) ||
      state.previewSelectedIds.includes(node.id) ||
      state.externalSelectedIds.includes(node.id),
  )
  const isExporting = useViewer((state) => state.isExporting)

  const overridePosition = liveOverride?.position as [number, number, number] | undefined
  const overrideRotation = liveOverride?.rotation as [number, number, number] | number | undefined
  const overrideScale = liveOverride?.scale as [number, number, number] | undefined
  const position = liveTransform?.position ?? overridePosition ?? node.position
  const rawRotation = overrideRotation ?? node.rotation
  const baseRotation: [number, number, number] =
    typeof rawRotation === 'number' ? [0, rawRotation, 0] : rawRotation
  const rotation: [number, number, number] = liveTransform
    ? [baseRotation[0], liveTransform.rotation, baseRotation[2]]
    : baseRotation
  const scale = overrideScale ?? node.scale
  const visible = node.visible !== false && !isHiddenByCollections(collectionMembership, node.id)
  const bounds = data?.bounds ?? { center: [0, 0.5, 0] as const, size: [1, 1, 1] as const }
  const freshPlacement =
    typeof node.metadata === 'object' &&
    node.metadata !== null &&
    !Array.isArray(node.metadata) &&
    node.metadata.isNew === true
  const showGeometry =
    insideDefinitionSource ||
    active ||
    isExporting ||
    (freshPlacement && Boolean(liveTransform || liveOverride))

  return (
    <group
      position={position}
      ref={registeredRef}
      rotation={rotation}
      scale={scale}
      userData={{ measurementSurface: false }}
      visible={visible}
      {...handlers}
    >
      {!isExporting && (
        <mesh position={bounds.center}>
          <boxGeometry args={bounds.size} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
      )}
      {showGeometry &&
        data?.parts.map((part) => (
          <mesh
            castShadow={part.castShadow}
            dispose={null}
            geometry={part.geometry}
            key={part.key}
            material={part.material as Material}
            matrix={part.matrix}
            matrixAutoUpdate={false}
            name={part.name}
            raycast={NO_RAYCAST as Mesh['raycast']}
            receiveShadow={part.receiveShadow}
            renderOrder={part.renderOrder}
          />
        ))}
    </group>
  )
}
