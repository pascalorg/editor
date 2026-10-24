'use client'

import {
  type AnyNodeId,
  type CupolaNode,
  type RoofSegmentNode,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  type ColorPreset,
  createMaterial,
  createMaterialFromPresetRef,
  resolveMaterialRef,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { accessoryFinish } from '../shared/accessory-finish'
import { useSegmentTrimClippedGeometry } from '../shared/use-segment-trim-clip'
import { buildCupolaGeometry } from './geometry'

const defaultMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.7,
  metalness: 0.2,
})

/**
 * Cupola renderer. Same transform stack as the box vent — the cupola is
 * parented to a roof-segment, so this reads the segment directly and
 * reproduces the segment-local transform (segment position → rotation →
 * cupola position → cupola yaw → roof-fitting mesh). No animation.
 */
const CupolaRenderer = ({ node: storeNode }: { node: CupolaNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'cupola', ref)
  const handlers = useNodeEvents(storeNode, 'cupola')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset: ColorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)
  const sceneMaterials = useScene((s) => s.materials)

  const overrides = useLiveNodeOverrides(
    (s) => s.get(storeNode.id as AnyNodeId) as Partial<CupolaNode> | undefined,
  )
  const node: CupolaNode = overrides ? ({ ...storeNode, ...overrides } as CupolaNode) : storeNode

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const geometry = useMemo(
    () => buildCupolaGeometry(node, segment),
    [
      node.width,
      node.depth,
      node.height,
      node.roofStyle,
      node.finial,
      node.rotation,
      node.position[0],
      node.position[2],
      segment,
    ],
  )
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(() => {
    const roleDefault = accessoryFinish('roof', colorPreset, THREE.FrontSide, sceneTheme, shading)
    const resolve = (role: 'base' | 'body' | 'roof' | 'louvers') => {
      if (!textures) return roleDefault
      const slotMaterial = resolveMaterialRef(node.slots?.[role], sceneMaterials, shading)
      if (slotMaterial) return slotMaterial
      if (node.material) return createMaterial(node.material, shading)
      if (node.materialPreset) {
        return createMaterialFromPresetRef(node.materialPreset, shading) ?? defaultMaterial
      }
      return accessoryFinish(
        'roof',
        colorPreset,
        THREE.FrontSide,
        sceneTheme,
        shading,
        role === 'roof' ? 'metal' : 'coated',
      )
    }
    return [resolve('base'), resolve('body'), resolve('roof'), resolve('louvers')]
  }, [
    textures,
    colorPreset,
    sceneTheme,
    shading,
    node.slots,
    node.material,
    node.materialPreset,
    sceneMaterials,
  ])

  const yAxis = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const composedQuat = useMemo(() => {
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(yAxis, node.rotation ?? 0)
    return yawQuat
  }, [node.rotation, yAxis])

  // Map cupola-local geometry into the host segment's local frame (where the
  // trim cut prisms live) — same pose the inner mesh group is mounted with.
  const localToSegment = useMemo(
    () =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(node.position[0] ?? 0, node.position[1] ?? 0, node.position[2] ?? 0),
        composedQuat,
        new THREE.Vector3(1, 1, 1),
      ),
    [node.position[0], node.position[1], node.position[2], composedQuat],
  )
  const clippedGeometry = useSegmentTrimClippedGeometry(geometry, segment, localToSegment)

  if (!segment) return null

  const segPos = segment.position ?? [0, 0, 0]
  const segRotY = segment.rotation ?? 0

  return (
    <group position={segPos} rotation-y={segRotY}>
      <group
        position={[node.position[0] ?? 0, node.position[1] ?? 0, node.position[2] ?? 0]}
        quaternion={composedQuat}
        ref={ref}
        visible={node.visible}
      >
        <mesh
          castShadow
          geometry={clippedGeometry ?? geometry}
          material={material}
          name="cupola-surface"
          receiveShadow
          {...handlers}
        />
      </group>
    </group>
  )
}

export default CupolaRenderer
