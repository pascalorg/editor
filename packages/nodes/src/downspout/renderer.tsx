'use client'

import {
  type AnyNodeId,
  type DownspoutNode,
  type GutterNode,
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
import { computeEaveY } from '../gutter/eave-snap'
import { resolveGutterOutletById } from '../gutter/outlet-lookup'
import { useSegmentTrimClippedGeometry } from '../shared/use-segment-trim-clip'
import { buildDownspoutGeometry } from './geometry'
import { computeDownspoutRouting } from './routing'

const defaultMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.7,
  metalness: 0.25,
})

/**
 * Downspout renderer. Mount chain mirrors the gutter's, then nests
 * one level deeper into the outlet position in gutter-mesh-local:
 *
 *   segment.position → segment.rotation (Y)
 *     → [gutter.position[0], computeEaveY(segment), gutter.position[2]]
 *     → gutter.rotation (Y)
 *     → [outlet.x, outlet.y, outlet.z]
 *     → mesh (pipe descends from Y = 0)
 *
 * Pulling the gutter's eave Y from `computeEaveY(effectiveSegment)`
 * means the downspout follows wallHeight / overhang / pitch changes
 * live, on the same frame as the gutter. The gutter and segment also
 * subscribe to `useLiveNodeOverrides` so drag-in-flight changes flow
 * through too.
 */
const DownspoutRenderer = ({ node: storeNode }: { node: DownspoutNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'downspout', ref)
  const handlers = useNodeEvents(storeNode, 'downspout')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset: ColorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)

  const overrides = useLiveNodeOverrides(
    (s) => s.get(storeNode.id as AnyNodeId) as Partial<DownspoutNode> | undefined,
  )
  const node: DownspoutNode = overrides
    ? ({ ...storeNode, ...overrides } as DownspoutNode)
    : storeNode

  // Host gutter — both scene + live overrides so drag-in-flight gutter
  // moves (length / position) reposition the downspout immediately.
  const gutter = useScene((s) =>
    node.gutterId ? (s.nodes[node.gutterId as AnyNodeId] as GutterNode | undefined) : undefined,
  )
  const gutterOverrides = useLiveNodeOverrides((s) =>
    node.gutterId
      ? (s.get(node.gutterId as AnyNodeId) as Partial<GutterNode> | undefined)
      : undefined,
  )
  const effectiveGutter: GutterNode | undefined = gutter
    ? gutterOverrides
      ? ({ ...gutter, ...gutterOverrides } as GutterNode)
      : gutter
    : undefined

  // Segment of the host gutter (the downspout's own scene-graph parent
  // is the same segment — same as roof accessories — so the chain
  // segment → gutter-mesh-local is what we need to reach the outlet).
  const segment = useScene((s) =>
    effectiveGutter?.roofSegmentId
      ? (s.nodes[effectiveGutter.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )
  const segmentOverrides = useLiveNodeOverrides((s) =>
    effectiveGutter?.roofSegmentId
      ? (s.get(effectiveGutter.roofSegmentId as AnyNodeId) as Partial<RoofSegmentNode> | undefined)
      : undefined,
  )
  const effectiveSegment: RoofSegmentNode | undefined = segment
    ? segmentOverrides
      ? ({ ...segment, ...segmentOverrides } as RoofSegmentNode)
      : segment
    : undefined

  // Routing back to the wall — memoised on the gutter/segment values
  // that actually move the jog or the collar bore, so the pipe geometry
  // only rebuilds when one of those changes (not on every override-merge
  // render). Resolves to null when the gutter has no outlet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const routing = useMemo(
    () =>
      effectiveGutter && effectiveSegment
        ? computeDownspoutRouting(effectiveGutter, effectiveSegment, node.outletId)
        : null,
    [
      effectiveGutter?.profile,
      effectiveGutter?.size,
      // The outlets array — its referenced entry's diameter / offset
      // drives the collar bore + nesting.
      effectiveGutter ? JSON.stringify(effectiveGutter.outlets) : undefined,
      effectiveSegment?.overhang,
      node.outletId,
    ],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const geometry = useMemo(
    () => buildDownspoutGeometry(node, routing),
    [
      node.length,
      node.diameter,
      node.standoff,
      node.shape,
      node.strapStyle,
      node.strapSpacing,
      node.terminal,
      routing,
    ],
  )
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(() => {
    if (!textures || (!node.material && !node.materialPreset)) {
      return createSurfaceRoleMaterial('roof', colorPreset, THREE.FrontSide, sceneTheme)
    }
    return node.material
      ? createMaterial(node.material, shading)
      : (createMaterialFromPresetRef(node.materialPreset, shading) ?? defaultMaterial)
  }, [textures, colorPreset, sceneTheme, shading, node.material, node.materialPreset])

  // Map downspout-local geometry into the host segment's local frame (where the
  // trim cut prisms live). Recompose the same outlet pose the inner mesh group
  // is mounted with (gutter offset + rotation → outlet → eave Y). Computed
  // before the early returns so the hook order stays stable.
  const localToSegment = useMemo(() => {
    if (!effectiveGutter || !effectiveSegment) return new THREE.Matrix4()
    const outlet = resolveGutterOutletById(effectiveGutter, node.outletId)
    if (!outlet) return new THREE.Matrix4()
    const liveEaveY = computeEaveY(effectiveSegment)
    const gutterRotY = effectiveGutter.rotation ?? 0
    const gutterX = effectiveGutter.position[0] ?? 0
    const gutterZ = effectiveGutter.position[2] ?? 0
    const cos = Math.cos(gutterRotY)
    const sin = Math.sin(gutterRotY)
    const outletSegX = gutterX + (outlet.x * cos + outlet.z * sin)
    const outletSegZ = gutterZ + (-outlet.x * sin + outlet.z * cos)
    const outletSegY = liveEaveY + outlet.y
    return new THREE.Matrix4().compose(
      new THREE.Vector3(outletSegX, outletSegY, outletSegZ),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), gutterRotY),
      new THREE.Vector3(1, 1, 1),
    )
  }, [effectiveGutter, effectiveSegment, node.outletId])
  const clippedGeometry = useSegmentTrimClippedGeometry(geometry, effectiveSegment, localToSegment)

  if (!effectiveGutter || !effectiveSegment) return null
  const outlet = resolveGutterOutletById(effectiveGutter, node.outletId)
  if (!outlet) return null

  const segPos = effectiveSegment.position ?? [0, 0, 0]
  const segRotY = effectiveSegment.rotation ?? 0
  const liveEaveY = computeEaveY(effectiveSegment)
  const gutterRotY = effectiveGutter.rotation ?? 0

  // Bake the gutter's position + Y-rotation into the registered ref so it
  // sits as a DIRECT child of the segment-transform group — its local
  // pose is the outlet's full segment-local placement. `NodeArrowHandles`
  // copies the registered object's LOCAL transform into the segment's
  // object (it assumes a flat node → scene-parent chain); with the old
  // nested segment → gutter → outlet groups it only saw the innermost
  // `[outlet.x …]` offset and the handles landed at the roof centre.
  const gutterX = effectiveGutter.position[0] ?? 0
  const gutterZ = effectiveGutter.position[2] ?? 0
  const cos = Math.cos(gutterRotY)
  const sin = Math.sin(gutterRotY)
  const outletSegX = gutterX + (outlet.x * cos + outlet.z * sin)
  const outletSegZ = gutterZ + (-outlet.x * sin + outlet.z * cos)
  const outletSegY = liveEaveY + outlet.y

  return (
    <group position={segPos} rotation-y={segRotY}>
      <group
        position={[outletSegX, outletSegY, outletSegZ]}
        ref={ref}
        rotation-y={gutterRotY}
        visible={node.visible}
      >
        <mesh
          castShadow
          geometry={clippedGeometry ?? geometry}
          material={material}
          name="downspout-surface"
          receiveShadow
          {...handlers}
        />
      </group>
    </group>
  )
}

export default DownspoutRenderer
