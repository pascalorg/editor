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
import { resolveGutterOutletPlacement } from '../gutter/outlet-lookup'
import { buildDownspoutGeometry } from './geometry'

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
      ? (s.get(effectiveGutter.roofSegmentId as AnyNodeId) as
          | Partial<RoofSegmentNode>
          | undefined)
      : undefined,
  )
  const effectiveSegment: RoofSegmentNode | undefined = segment
    ? segmentOverrides
      ? ({ ...segment, ...segmentOverrides } as RoofSegmentNode)
      : segment
    : undefined

  const geometry = useMemo(() => buildDownspoutGeometry(node), [node.length, node.diameter])
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(() => {
    if (!textures || (!node.material && !node.materialPreset)) {
      return createSurfaceRoleMaterial('roof', colorPreset, THREE.FrontSide, sceneTheme)
    }
    return node.material
      ? createMaterial(node.material, shading)
      : (createMaterialFromPresetRef(node.materialPreset, shading) ?? defaultMaterial)
  }, [textures, colorPreset, sceneTheme, shading, node.material, node.materialPreset])

  if (!effectiveGutter || !effectiveSegment) return null
  const outlet = resolveGutterOutletPlacement(effectiveGutter)
  if (!outlet) return null

  const segPos = effectiveSegment.position ?? [0, 0, 0]
  const segRotY = effectiveSegment.rotation ?? 0
  const liveEaveY = computeEaveY(effectiveSegment)
  const gutterRotY = effectiveGutter.rotation ?? 0

  return (
    <group position={segPos} rotation-y={segRotY}>
      <group
        position={[
          effectiveGutter.position[0] ?? 0,
          liveEaveY,
          effectiveGutter.position[2] ?? 0,
        ]}
        rotation-y={gutterRotY}
      >
        <group position={[outlet.x, outlet.y, outlet.z]} ref={ref} visible={node.visible}>
          <mesh
            castShadow
            geometry={geometry}
            material={material}
            name="downspout-surface"
            receiveShadow
            {...handlers}
          />
        </group>
      </group>
    </group>
  )
}

export default DownspoutRenderer
