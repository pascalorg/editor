'use client'

import {
  type AnyNodeId,
  type RoofSegmentNode,
  type TurbineVentNode,
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
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { getAnalyticalNormal, surfaceQuatFromNormal } from '../shared/roof-surface'
import { useSegmentTrimClippedGeometry } from '../shared/use-segment-trim-clip'
import { buildTurbineVentBase, buildTurbineVentHead } from './geometry'

const defaultMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.6,
  metalness: 0.35,
})

/**
 * Turbine vent renderer. Reproduces the box-vent transform stack
 * (segment → slope tilt → yaw) so the vent rides whatever roof face it
 * sits on, then adds the one thing no other vent has: the head spins.
 *
 * The mesh is split into a static base (flange + throat) and a head
 * (finned crown + cap + knob) mounted in an inner `<group>` that
 * `useFrame` rotates about its own vertical axis at `node.spinSpeed`
 * rad/s (0 = static). The spin lives entirely below the registered ref
 * group, so the handle frame — read off the registered group — is
 * untouched.
 */
const TurbineVentRenderer = ({ node: storeNode }: { node: TurbineVentNode }) => {
  const ref = useRef<THREE.Group>(null!)
  const headRef = useRef<THREE.Group>(null)
  useRegistry(storeNode.id, 'turbine-vent', ref)
  const handlers = useNodeEvents(storeNode, 'turbine-vent')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset: ColorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)

  // Merge live overrides (panel slider drags) on top of the store node so
  // the mesh updates frame-by-frame without polluting undo history.
  const overrides = useLiveNodeOverrides(
    (s) => s.get(storeNode.id as AnyNodeId) as Partial<TurbineVentNode> | undefined,
  )
  const node: TurbineVentNode = overrides
    ? ({ ...storeNode, ...overrides } as TurbineVentNode)
    : storeNode

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const baseGeometry = useMemo(
    () => buildTurbineVentBase(node),
    [node.diameter, node.height, node.neckHeight, node.baseOverhang],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const headGeometry = useMemo(
    () => buildTurbineVentHead(node),
    [node.style, node.diameter, node.height, node.neckHeight, node.vaneCount],
  )
  useEffect(() => () => baseGeometry.dispose(), [baseGeometry])
  useEffect(() => () => headGeometry.dispose(), [headGeometry])

  // Idle spin. `delta` keeps it frame-rate independent; speed 0 holds the
  // head still (the default — turbines start paused). Reads `node.spinSpeed`
  // through the render closure so the panel slider / Play toggle take effect
  // live.
  const spin = node.spinSpeed ?? 0
  useFrame((_, delta) => {
    if (headRef.current && spin !== 0) {
      headRef.current.rotation.y += spin * delta
    }
  })

  // Orient the vent to whatever roof face it sits on — same analytical
  // normal the box-vent / solar-panel / skylight share.
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

  // Compose slope tilt + yaw onto a single quaternion so the registered
  // ref's local frame is vent-mesh-local (handles read this frame).
  const yAxis = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const composedQuat = useMemo(() => {
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(yAxis, node.rotation ?? 0)
    return new THREE.Quaternion().copy(surfaceQuat).multiply(yawQuat)
  }, [surfaceQuat, node.rotation, yAxis])

  const neckHForClip = Math.max(
    0.02,
    Math.min(node.neckHeight ?? 0.09, Math.max(0.12, node.height) * 0.5),
  )
  // Map vent-local geometry into the host segment's local frame (where the trim
  // cut prisms live). The base sits at the inner group's pose; the head is
  // nested one level deeper at [0, neckH, 0], so its clip matrix composes that
  // offset. (When the head is spinning — opt-in, default paused — the cut edge
  // rotates with it, which is acceptable for the animation.)
  const baseLocalToSegment = useMemo(
    () =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(node.position[0] ?? 0, node.position[1] ?? 0, node.position[2] ?? 0),
        composedQuat,
        new THREE.Vector3(1, 1, 1),
      ),
    [node.position[0], node.position[1], node.position[2], composedQuat],
  )
  const headLocalToSegment = useMemo(
    () =>
      new THREE.Matrix4()
        .copy(baseLocalToSegment)
        .multiply(new THREE.Matrix4().makeTranslation(0, neckHForClip, 0)),
    [baseLocalToSegment, neckHForClip],
  )
  const clippedBase = useSegmentTrimClippedGeometry(baseGeometry, segment, baseLocalToSegment)
  const clippedHead = useSegmentTrimClippedGeometry(headGeometry, segment, headLocalToSegment)

  if (!segment) return null

  // Replicate the parent segment's roof-local transform — see the long
  // note in box-vent's renderer for why segment-local coords must be
  // bridged through the segment frame here.
  const segPos = segment.position ?? [0, 0, 0]
  const segRotY = segment.rotation ?? 0
  const neckH = Math.max(0.02, Math.min(node.neckHeight ?? 0.09, Math.max(0.12, node.height) * 0.5))

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
          geometry={clippedBase ?? baseGeometry}
          material={material}
          name="turbine-vent-base"
          receiveShadow
          {...handlers}
        />
        <group position={[0, neckH, 0]} ref={headRef}>
          <mesh
            castShadow
            geometry={clippedHead ?? headGeometry}
            material={material}
            name="turbine-vent-head"
            receiveShadow
            {...handlers}
          />
        </group>
      </group>
    </group>
  )
}

export default TurbineVentRenderer
