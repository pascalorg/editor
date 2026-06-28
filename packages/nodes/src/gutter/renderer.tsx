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
import { useSegmentTrimClippedGeometry } from '../shared/use-segment-trim-clip'
import { computeGutterMitres, type GutterWithSegment, NO_MITRES } from './corner-mitre'
import { computeSharedEaveY } from './eave-align'
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
  const node: GutterNode = overrides ? ({ ...storeNode, ...overrides } as GutterNode) : storeNode

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

  // Corner-mitre inputs: every other gutter under the SAME ROOF, plus
  // the roof's segments (for the frame lift). A flat array of node refs
  // keeps `useShallow` stable — it only re-renders when one of those
  // nodes actually changes. Cross-segment so gutters on different
  // segments mitre where their segments meet (the mitres useMemo pairs
  // each gutter back to its segment).
  const mitreNodes = useScene(
    useShallow((state) => {
      const segmentId = node.roofSegmentId as AnyNodeId | undefined
      const seg = segmentId ? (state.nodes[segmentId] as RoofSegmentNode | undefined) : undefined
      const roofId = seg?.parentId as AnyNodeId | undefined
      const roof = roofId
        ? (state.nodes[roofId] as { children?: readonly string[] } | undefined)
        : undefined
      if (!roof) return [] as (GutterNode | RoofSegmentNode)[]
      const out: (GutterNode | RoofSegmentNode)[] = []
      for (const sid of roof.children ?? []) {
        const s = state.nodes[sid as AnyNodeId]
        if (s?.type !== 'roof-segment') continue
        out.push(s as RoofSegmentNode)
        for (const gid of (s as RoofSegmentNode).children ?? []) {
          const g = state.nodes[gid as AnyNodeId]
          if (g?.type === 'gutter' && g.id !== storeNode.id) out.push(g as GutterNode)
        }
      }
      return out
    }),
  )

  // Mitres AND the run's shared eave height come from the same sibling
  // walk: both key off which gutters meet at corners. `siblings` carries
  // the FULL host segment (the alignment needs wallHeight / overhang /
  // pitch / roofType to derive each eave Y), which is a superset of what
  // the mitre detector reads — so one list feeds both.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const { mitres, sharedEaveY } = useMemo(() => {
    if (!effectiveSegment) return { mitres: NO_MITRES, sharedEaveY: undefined }
    const segById = new Map<string, RoofSegmentNode>()
    for (const n of mitreNodes) {
      if (n.type === 'roof-segment') segById.set(n.id, n as RoofSegmentNode)
    }
    const siblings: GutterWithSegment[] = []
    for (const n of mitreNodes) {
      if (n.type !== 'gutter') continue
      const g = n as GutterNode
      const seg = g.roofSegmentId ? segById.get(g.roofSegmentId) : undefined
      if (seg) siblings.push({ gutter: g, segment: seg })
    }
    return {
      mitres: computeGutterMitres(node, effectiveSegment, siblings),
      // `siblings` is typed for the mitre detector (position/rotation),
      // but the segment objects are the full RoofSegmentNodes from
      // `mitreNodes`, so `computeSharedEaveY` gets the eave-Y inputs it
      // needs at runtime.
      sharedEaveY: computeSharedEaveY(
        node,
        effectiveSegment,
        siblings as unknown as Parameters<typeof computeSharedEaveY>[2],
      ),
    }
  }, [
    node.position[0],
    node.position[1],
    node.position[2],
    node.rotation,
    node.length,
    effectiveSegment?.position?.[0],
    effectiveSegment?.position?.[2],
    effectiveSegment?.rotation,
    effectiveSegment?.wallHeight,
    effectiveSegment?.overhang,
    effectiveSegment?.pitch,
    effectiveSegment?.roofType,
    mitreNodes,
  ])

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
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
      // Value-compare the outlets array so the CSG drills only rebuild
      // when an outlet's offset / diameter changes or one is added.
      JSON.stringify(node.outlets),
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

  // Map gutter-local geometry into the host segment's local frame (where the
  // trim cut prisms live) — same pose the inner mesh group is mounted with
  // (position [x, liveEaveY, z] + yaw). Computed before the early return so the
  // hook order stays stable.
  const liveEaveYForClip = sharedEaveY ?? (effectiveSegment ? computeEaveY(effectiveSegment) : 0)
  const localToSegment = useMemo(
    () =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(node.position[0] ?? 0, liveEaveYForClip, node.position[2] ?? 0),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), node.rotation ?? 0),
        new THREE.Vector3(1, 1, 1),
      ),
    [node.position[0], node.position[2], node.rotation, liveEaveYForClip],
  )
  const clippedGeometry = useSegmentTrimClippedGeometry(geometry, effectiveSegment, localToSegment)

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
  // Prefer the connected run's shared height (aligns gutters meeting at
  // a corner whose segments derive different eave Ys); fall back to this
  // segment's own eave Y for an isolated gutter.
  const liveEaveY = sharedEaveY ?? computeEaveY(effectiveSegment)

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
          geometry={clippedGeometry ?? geometry}
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
