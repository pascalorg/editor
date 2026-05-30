'use client'

import {
  type AnyNodeId,
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
import { useShallow } from 'zustand/react/shallow'
import { computeGutterMitres } from './corner-mitre'
import { computeEaveY } from './eave-snap'
import { buildGutterGeometry } from './geometry'

const defaultMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.7,
  metalness: 0.25,
})

/**
 * Gutter renderer. Mounts at the eave of the host roof-segment — the
 * gutter hangs level off the eave line (gravity wins; no slope tilt).
 * Transform stack:
 *
 *   segment.position → segment.rotation (Y) → gutter.position
 *     → gutter.rotation (Y) → mesh
 *
 * The registered ref sits on the inner group that applies position +
 * rotation, so `NodeArrowHandles` reads gutter-mesh-local coords for
 * its chevron placements (same pattern as ridge-vent).
 *
 * `useLiveNodeOverrides` merges in-flight handle drags onto the store
 * node so the mesh tracks the drag without flushing zustand each
 * frame.
 */
const GutterRenderer = ({ node: storeNode }: { node: GutterNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'gutter', ref)
  const handlers = useNodeEvents(storeNode, 'gutter')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset: ColorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)

  const overrides = useLiveNodeOverrides(
    (s) => s.get(storeNode.id as AnyNodeId) as Partial<GutterNode> | undefined,
  )
  const node: GutterNode = overrides
    ? ({ ...storeNode, ...overrides } as GutterNode)
    : storeNode

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  // While the user is dragging the segment's wall-height / overhang /
  // pitch handle, the drag pipeline writes to useLiveNodeOverrides
  // instead of the scene store — the scene entry above stays at the
  // pre-drag value until pointer-up. Subscribing to the segment's live
  // overrides too lets the gutter's `computeEaveY` see the in-flight
  // height and slide up/down on every frame of the drag.
  const segmentOverrides = useLiveNodeOverrides((s) =>
    node.roofSegmentId
      ? (s.get(node.roofSegmentId as AnyNodeId) as Partial<RoofSegmentNode> | undefined)
      : undefined,
  )
  const effectiveSegment: RoofSegmentNode | undefined = segment
    ? segmentOverrides
      ? ({ ...segment, ...segmentOverrides } as RoofSegmentNode)
      : segment
    : undefined

  // Same-segment sibling gutters drive the corner-mitre detector. Pull
  // them as a fresh array each store update; `useShallow` keeps the
  // reference stable when the array contents haven't changed, so the
  // mitres useMemo below only re-runs when a sibling actually moves.
  const siblingGutters = useScene(
    useShallow((state) => {
      const segmentId = node.roofSegmentId as AnyNodeId | undefined
      if (!segmentId) return [] as GutterNode[]
      const seg = state.nodes[segmentId] as RoofSegmentNode | undefined
      if (!seg) return []
      const out: GutterNode[] = []
      for (const id of seg.children ?? []) {
        const n = state.nodes[id as AnyNodeId]
        if (n?.type === 'gutter' && n.id !== storeNode.id) out.push(n as GutterNode)
      }
      return out
    }),
  )

  const mitres = useMemo(
    () => computeGutterMitres(node, siblingGutters),
    [
      node.position[0],
      node.position[1],
      node.position[2],
      node.rotation,
      node.length,
      siblingGutters,
    ],
  )

  const geometry = useMemo(
    () => buildGutterGeometry(node, mitres),
    [
      node.length,
      node.size,
      node.thickness,
      node.profile,
      node.endCapLeft,
      node.endCapRight,
      node.hangerStyle,
      node.hangerSpacing,
      mitres.left,
      mitres.right,
    ],
  )
  useEffect(() => () => geometry.dispose(), [geometry])

  // Paint surface: explicit material wins, then preset, then the cached
  // default. FrontSide everywhere — DoubleSide on any NodeMaterial inside
  // the MRT scenePass compiles a back-face shader variant that doesn't
  // declare outputs for every MRT target and poisons the render context
  // (see `materials.ts` line 77, and the glazing FrontSide fix in
  // 9400f1c5). The U-channel cross-section in `geometry.ts` is traced as
  // a single closed polygon around the material — both the exterior shell
  // and the interior trough walls are part of the same outward-wound
  // boundary, so ExtrudeGeometry produces outward-facing normals on every
  // visible face. FrontSide is therefore sufficient and DoubleSide is not
  // needed.
  const material = useMemo(() => {
    if (!textures || (!node.material && !node.materialPreset)) {
      return createSurfaceRoleMaterial('roof', colorPreset, THREE.FrontSide, sceneTheme)
    }
    return node.material
      ? createMaterial(node.material, shading)
      : (createMaterialFromPresetRef(node.materialPreset, shading) ?? defaultMaterial)
  }, [textures, colorPreset, sceneTheme, shading, node.material, node.materialPreset])

  if (!segment || !effectiveSegment) return null

  // `node.position` is segment-local — the placement tool resolves the
  // eave click via `segObj.worldToLocal`. The renderer mounts under
  // `roof-elements` (only the roof transform inherited), so we
  // re-apply the segment's roof-local transform here. Mirrors the
  // ridge-vent / box-vent pattern; without this gutters on rotated
  // segments would land on the first segment instead.
  //
  // Y is derived live from `effectiveSegment` (scene + drag overrides)
  // instead of trusting `node.position[1]` — so changing wallHeight,
  // overhang, or pitch on the parent segment moves the gutter on the
  // very next frame, including while a segment-height handle is
  // mid-drag. Matches the chimney/box-vent pattern of pulling host-
  // segment geometry at draw time rather than caching it at placement.
  const segPos = segment.position ?? [0, 0, 0]
  const segRotY = segment.rotation ?? 0
  const liveEaveY = computeEaveY(effectiveSegment)

  return (
    <group position={segPos} rotation-y={segRotY}>
      <group
        position={[node.position[0] ?? 0, liveEaveY, node.position[2] ?? 0]}
        ref={ref}
        rotation-y={node.rotation ?? 0}
        visible={node.visible}
      >
        <mesh
          castShadow
          geometry={geometry}
          material={material}
          name="gutter-surface"
          receiveShadow
          {...handlers}
        />
      </group>
    </group>
  )
}

export default GutterRenderer
