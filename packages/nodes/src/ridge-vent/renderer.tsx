'use client'

import {
  type AnyNodeId,
  getEffectiveRoofSurfaceMaterial,
  getEffectiveSegmentSurfaceMaterial,
  type RidgeVentNode,
  type RoofNode,
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
  getRoofMaterialArray,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RIDGE_LIFT, resolveRidgeSnap } from '../shared/ridge-snap'
import { getRoofTopSurfaceY } from '../shared/roof-surface'
import { useSegmentTrimClippedGeometry } from '../shared/use-segment-trim-clip'
import { buildRidgeVentGeometry } from './geometry'

function ridgeVentSegmentGeometryKey(segment: RoofSegmentNode | undefined): string {
  if (!segment) return 'none'
  const trim = segment.trim
  return [
    segment.roofType,
    segment.width,
    segment.depth,
    segment.wallHeight,
    segment.pitch,
    segment.wallThickness,
    segment.deckThickness,
    segment.overhang,
    segment.shingleThickness,
    segment.gambrelLowerWidthRatio,
    segment.gambrelLowerHeightRatio,
    segment.mansardSteepWidthRatio,
    segment.mansardSteepHeightRatio,
    segment.dutchHipWidthRatio,
    segment.dutchHipHeightRatio,
    trim.left,
    trim.right,
    trim.front,
    trim.back,
    trim.frontLeft,
    trim.frontRight,
    trim.backLeft,
    trim.backRight,
    trim.frontLeftX,
    trim.frontLeftZ,
    trim.frontRightX,
    trim.frontRightZ,
    trim.backLeftX,
    trim.backLeftZ,
    trim.backRightX,
    trim.backRightZ,
  ].join('|')
}

/**
 * Ridge vent renderer. Sits along the ridge of a roof-segment — no
 * slope tilt is needed (the ridge IS the high line of the segment), so
 * the transform stack is simply
 *
 *   segment.position → segment.rotation (Y) → vent.position
 *     → vent.rotation (Y) → mesh
 *
 * Mirrors the box-vent renderer otherwise (segment lookup via
 * useScene, live-transform follow for parent drags). Style-specific
 * default materials let unpainted ridge vents read as their material
 * family (matte standard / shingled grey / brushed metal) before the
 * user opens the paint tray.
 */
const RidgeVentRenderer = ({ node: storeNode }: { node: RidgeVentNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'ridge-vent', ref)
  const handlers = useNodeEvents(storeNode, 'ridge-vent')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset: ColorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)

  // Merge live drag overrides on top of the store node so handle drags
  // update the mesh in-flight without flushing to zustand on every frame.
  // Same pattern as box-vent / chimney / dormer — the override is set by
  // `NodeArrowHandles`' drag handler and cleared on commit.
  const overrides = useLiveNodeOverrides(
    (s) => s.get(storeNode.id as AnyNodeId) as Partial<RidgeVentNode> | undefined,
  )
  const node: RidgeVentNode = overrides
    ? ({ ...storeNode, ...overrides } as RidgeVentNode)
    : storeNode
  const nodePosition = node.position ?? [0, 0, 0]

  const segmentStore = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )
  // Subscribe to the segment's live overrides too — when the user drags a
  // segment handle (width / depth / wallHeight / pitch / rotation), the
  // dimensions stream through `useLiveNodeOverrides` and don't hit the
  // store until release. Merging them lets the ridge ride the segment in
  // real time instead of snapping into place on commit.
  const segmentOverrides = useLiveNodeOverrides((s) =>
    node.roofSegmentId
      ? (s.get(node.roofSegmentId as AnyNodeId) as Partial<RoofSegmentNode> | undefined)
      : undefined,
  )
  const segment: RoofSegmentNode | undefined = segmentStore
    ? segmentOverrides
      ? ({ ...segmentStore, ...segmentOverrides } as RoofSegmentNode)
      : segmentStore
    : undefined
  const parentRoof = useScene((state) =>
    segmentStore?.parentId
      ? (state.nodes[segmentStore.parentId as AnyNodeId] as RoofNode | undefined)
      : undefined,
  )
  const segmentGeometryKey = ridgeVentSegmentGeometryKey(segment)
  const rotationY = node.rotation ?? 0
  const snap = useMemo(
    () =>
      segment && Math.abs(rotationY) < 1e-5
        ? resolveRidgeSnap(segment, nodePosition[0] ?? 0, nodePosition[2] ?? 0)
        : null,
    [segment, rotationY, nodePosition[0], nodePosition[2]],
  )
  const ridgeX = snap ? snap.localX : (nodePosition[0] ?? 0)
  const ridgeZ = snap ? snap.localZ : (nodePosition[2] ?? 0)
  const effectiveNode = useMemo<RidgeVentNode>(
    () => ({
      ...node,
      position: [ridgeX, nodePosition[1] ?? 0, ridgeZ],
    }),
    [node, ridgeX, ridgeZ, nodePosition[1]],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: `segmentGeometryKey` captures the segment fields that affect the generated mesh; depending on the whole segment would rebuild on unrelated node changes.
  const geometry = useMemo(
    () => buildRidgeVentGeometry(effectiveNode, segment),
    [
      effectiveNode.length,
      effectiveNode.width,
      effectiveNode.height,
      effectiveNode.style,
      effectiveNode.endCaps,
      effectiveNode.rotation,
      effectiveNode.position[0],
      effectiveNode.position[2],
      segmentGeometryKey,
    ],
  )

  useEffect(() => () => geometry.dispose(), [geometry])

  // Paint surface: FrontSide everywhere — DoubleSide on the role
  // material's NodeMaterial poisons the MRT scene pass (see `materials.ts`
  // line 77 / glazing fix 9400f1c5). Earlier this path forced DoubleSide
  // so the underside of the thin extruded ridge cap stayed visible from
  // below; that's now a known visual tradeoff — building the cap as a
  // closed solid in `geometry.ts` is the right fix if the underside-view
  // becomes noticeable.
  const material = useMemo(() => {
    const createDefaultTopMaterial = () => {
      const parentSpec = parentRoof ? getEffectiveRoofSurfaceMaterial(parentRoof, 'top') : undefined
      const spec = segment ? getEffectiveSegmentSurfaceMaterial(segment, 'top', parentSpec) : null

      if (typeof spec?.materialPreset === 'string') {
        const resolved = createMaterialFromPresetRef(spec.materialPreset, shading)
        if (resolved) return resolved
      }
      if (spec?.material !== undefined) {
        return createMaterial(spec.material, shading)
      }

      const roofMaterials = parentRoof
        ? getRoofMaterialArray(parentRoof, shading, textures, colorPreset, sceneTheme)
        : null
      return (
        roofMaterials?.[3] ??
        createSurfaceRoleMaterial('roof', colorPreset, THREE.FrontSide, sceneTheme)
      )
    }

    if (node.material) {
      return createMaterial(node.material, shading)
    }
    if (node.materialPreset) {
      return createMaterialFromPresetRef(node.materialPreset, shading) ?? createDefaultTopMaterial()
    }
    return createDefaultTopMaterial()
  }, [
    textures,
    colorPreset,
    sceneTheme,
    shading,
    node.material,
    node.materialPreset,
    segment,
    parentRoof,
  ])

  // Map vent-local geometry into the host segment's local frame (where the trim
  // cut prisms live). Recompose the same pose the inner mesh group is mounted
  // with — ridge snap for X/Z, slope-locked base Y + offset, yaw — so the clip
  // matches the rendered placement. Computed before the early return so the
  // hook order stays stable.
  const localToSegment = useMemo(() => {
    if (!segment) return new THREE.Matrix4()
    const baseY = getRoofTopSurfaceY(ridgeX, ridgeZ, segment)
    const yOffset = Math.max(-2, Math.min(2, nodePosition[1] ?? 0))
    const ridgeY = baseY + RIDGE_LIFT + yOffset
    return new THREE.Matrix4().compose(
      new THREE.Vector3(ridgeX, ridgeY, ridgeZ),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY),
      new THREE.Vector3(1, 1, 1),
    )
  }, [segment, ridgeX, ridgeZ, rotationY, nodePosition[1]])
  const clippedGeometry = useSegmentTrimClippedGeometry(geometry, segment, localToSegment)

  if (!segment) return null

  // `node.position` is segment-local (placement / move tools resolve the
  // click via `segObj.worldToLocal`), but the renderer mounts in the
  // roof's `roof-elements` group — which only carries the roof's
  // transform, not the segment's. Replicate the segment's roof-local
  // transform here so segment-local coords land at the correct world
  // point on every segment. Without this wrapper, ridge vents placed on
  // a non-origin / rotated segment (e.g. the back slope of a gable, or
  // any face of a hip) appeared on the first segment instead — the
  // "same segment" duplication bug.
  const segPos = segment.position ?? [0, 0, 0]
  const segRotY = segment.rotation ?? 0

  // Lock the BASE position to the rendered roof skin so the vent always starts
  // on the roof structure; treat `position[1]` and `position[2]` as user-tunable OFFSETS
  // off that base (Y above the surface, Z away from ridge centerline). So
  // after placement the inspector's Y / Z sliders nudge the vent off the
  // locked ridge without losing the slope-tracking base. X is the position
  // along the ridge — the snap re-clamps it to the segment's ridge span.
  const baseY = getRoofTopSurfaceY(ridgeX, ridgeZ, segment)
  // Clamp legacy stored Y (absolute peak height from earlier versions) so the
  // vent doesn't fly off when the field was an absolute Y instead of offset.
  const yOffset = Math.max(-2, Math.min(2, nodePosition[1] ?? 0))
  const ridgeY = baseY + RIDGE_LIFT + yOffset

  return (
    <group position={segPos} rotation-y={segRotY}>
      <group
        position={[ridgeX, ridgeY, ridgeZ]}
        ref={ref}
        rotation-y={rotationY}
        visible={node.visible}
      >
        <mesh
          castShadow
          geometry={clippedGeometry ?? geometry}
          material={material}
          name="ridge-vent-surface"
          receiveShadow
          {...handlers}
        />
      </group>
    </group>
  )
}

export default RidgeVentRenderer
