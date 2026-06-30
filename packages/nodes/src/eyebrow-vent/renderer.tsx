'use client'

import {
  type AnyNodeId,
  type EyebrowVentNode,
  type RoofSegmentNode,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  type ColorPreset,
  createMaterial,
  createMaterialFromPresetRef,
  createSurfaceRoleMaterial,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { getAnalyticalNormal, surfaceQuatFromNormal } from '../shared/roof-surface'
import { useSegmentTrimClippedGeometry } from '../shared/use-segment-trim-clip'
import { buildEyebrowVentGeometry } from './geometry'

const defaultMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.7,
  metalness: 0.2,
})

/**
 * Eyebrow-vent renderer. Same transform stack as the box vent / cupola — the
 * vent is parented to a roof-segment, so this reads the segment directly and
 * reproduces the segment-local transform (segment position → rotation → vent
 * position → slope tilt → vent yaw → mesh). No animation.
 */
const EyebrowVentRenderer = ({ node: storeNode }: { node: EyebrowVentNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'eyebrow-vent', ref)
  const handlers = useNodeEvents(storeNode, 'eyebrow-vent')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset: ColorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)

  const overrides = useLiveNodeOverrides(
    (s) => s.get(storeNode.id as AnyNodeId) as Partial<EyebrowVentNode> | undefined,
  )
  const node: EyebrowVentNode = overrides
    ? ({ ...storeNode, ...overrides } as EyebrowVentNode)
    : storeNode

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const geometry = useMemo(
    () => buildEyebrowVentGeometry(node),
    [node.width, node.depth, node.height, node.style, node.louverCount, node.backRatio],
  )
  useEffect(() => () => geometry.dispose(), [geometry])

  const surfaceQuat = useMemo(() => {
    if (!segment) return new THREE.Quaternion()
    const normal = getAnalyticalNormal(node.position[0] ?? 0, node.position[2] ?? 0, segment)
    return surfaceQuatFromNormal(normal, new THREE.Quaternion())
  }, [segment, node.position[0], node.position[2]])

  const material = useMemo(() => {
    if (!textures || (!node.material && !node.materialPreset)) {
      return createSurfaceRoleMaterial('roof', colorPreset, THREE.FrontSide, sceneTheme)
    }
    return node.material
      ? createMaterial(node.material, shading)
      : (createMaterialFromPresetRef(node.materialPreset, shading) ?? defaultMaterial)
  }, [textures, colorPreset, sceneTheme, shading, node.material, node.materialPreset])

  const yAxis = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const composedQuat = useMemo(() => {
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(yAxis, node.rotation ?? 0)
    return new THREE.Quaternion().copy(surfaceQuat).multiply(yawQuat)
  }, [surfaceQuat, node.rotation, yAxis])

  // Map vent-local geometry into the host segment's local frame (where the trim
  // cut prisms live) — same pose the inner mesh group is mounted with.
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
          name="eyebrow-vent-surface"
          receiveShadow
          {...handlers}
        />
      </group>
    </group>
  )
}

export default EyebrowVentRenderer
