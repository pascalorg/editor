'use client'

import {
  type AnyNode,
  type AnyNodeId,
  hiddenWallPointerEventsHeld,
  useRegistry,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  getVisibleWallMaterials,
  NodeRenderer,
  useLibraryMaterialsVersion,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { createPlaceholderGeometry } from '../shared/placeholder-geometry'
import {
  extractWallSelectionRay,
  WALL_COLLISION_MESH_NAME,
  wallPointerEventsSuppressed,
} from './pointer-transparency'
import { createWallRayHitClassifier } from './selection-hit-owner'
import { useWallTreatmentLevelData } from './treatment-level-data'
import { createWallExtraSlotMaterials, WallTreatments } from './treatments'

/**
 * Thin wall renderer.
 *
 * Mounts a placeholder mesh, registers it with `sceneRegistry`, marks the
 * node dirty so `WallSystem` fills the geometry on the next frame, and
 * recursively renders hosted children (doors / windows / wall-mounted
 * items) inside the wall's local frame.
 *
 * Behaviorally identical to the legacy `WallRenderer` in
 * `@pascal-app/viewer/components/renderers/wall/wall-renderer.tsx`.
 * Phase 6 deletes the legacy file; until then both coexist and the Phase 0
 * shims pick which one renders based on `nodeRegistry.has('wall')`.
 *
 * No `geometry` field on the wall definition yet — wall's geometry depends
 * on level-batch miter data (see `WallSystem.calculateLevelMiters`), which
 * doesn't fit the generic `(node, ctx) => Group` shape without `ctx.levelData`.
 * That decision lands in a later milestone; for now the system retains
 * ownership of the rebuild loop.
 */
const WallRenderer = ({ node }: { node: WallNode }) => {
  const ref = useRef<Mesh>(null!)
  const placeholderGeometry = useMemo(() => createPlaceholderGeometry(3), [])
  const collisionPlaceholderGeometry = useMemo(() => createPlaceholderGeometry(), [])

  useRegistry(node.id, 'wall', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  useEffect(() => {
    return () => {
      placeholderGeometry.dispose()
      collisionPlaceholderGeometry.dispose()
    }
  }, [collisionPlaceholderGeometry, placeholderGeometry])

  const rawHandlers = useNodeEvents(node, 'wall')
  // Hidden walls participate in hover/selection NEAREST-FIRST: when the
  // wall-mode pass hides this wall (`WallCutout` stamps `userData.wallHidden`
  // — X-ray 'down' mode, cutaway-hidden faces, auto-mode interior
  // partitions), its invisible full-height collision mesh handles the event
  // only when no hit that OWNS selection semantics outranks it — its own
  // hosted doors / windows / wall-mounted children, any selectable at
  // ~equal-or-nearer depth (device boxes at the face), or wall-mounted gear
  // on a wall behind it (the #683 D4 receptacle class) all win instead.
  // Passive geometry (Bones framing members, the wall's own render mesh,
  // gizmos — see `selection-hit-owner.ts`) never outranks it. Returning
  // early without stopPropagation lets R3F continue to that next
  // intersection. Free-standing objects clearly BEHIND the wall no longer
  // steal the hover: the wall in front highlights (the Bones framing
  // renders exactly there).
  // Two exceptions keep ALL events (see `wallPointerEventsSuppressed`):
  // delete mode (hidden walls stay hover-targetable for the deleteInvisible
  // highlight flow) and a live hidden-wall pointer hold (a door / window
  // move / place tool is tracking the cursor via wall events — without the
  // wall the opening detaches into the floor free-follow).
  const classifyRayHit = useMemo(() => createWallRayHitClassifier(node.id), [node.id])
  const handlers = useMemo(() => {
    const gated = {} as typeof rawHandlers
    for (const key of Object.keys(rawHandlers) as (keyof typeof rawHandlers)[]) {
      const fn = rawHandlers[key] as (e: unknown) => void
      ;(gated as Record<string, (e: unknown) => void>)[key] = (e: unknown) => {
        const wallHidden = ref.current?.userData?.wallHidden === true
        if (
          wallPointerEventsSuppressed({
            wallHidden,
            hoverHighlightMode: useViewer.getState().hoverHighlightMode,
            hiddenWallHoldActive: hiddenWallPointerEventsHeld(),
            // Reduced lazily: visible walls never suppress, so don't walk
            // the intersection list for every hover move over them.
            selectionRay: wallHidden
              ? extractWallSelectionRay(e, ref.current, classifyRayHit)
              : undefined,
          })
        ) {
          return
        }
        fn(e)
      }
    }
    return gated
  }, [classifyRayHit, rawHandlers])
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)
  const childNodes = useScene(
    useShallow((state) =>
      (node.children ?? [])
        .map((childId) => state.nodes[childId as AnyNodeId])
        .filter((child): child is AnyNode => child !== undefined),
    ),
  )
  const treatmentLevelData = useWallTreatmentLevelData((state) =>
    node.parentId ? state.byLevelId.get(node.parentId) : undefined,
  )
  // Subscribe to the scene-material palette so editing a `scene:` material a
  // wall slot references re-renders the wall live (the wall-system geometry
  // dirty loop never fires for a material-only edit). `getMaterialsForWall`'s
  // content hash keeps unaffected walls on their cached materials.
  const sceneMaterials = useScene((s) => s.materials)
  // Same for the dynamic library: AI-generated `library:mtl_*` presets
  // register after mount, and a dangling ref cached as the slot default must
  // re-resolve when they land.
  const libraryMaterialsVersion = useLibraryMaterialsVersion()
  const baseMaterials = getVisibleWallMaterials(
    node,
    shading,
    textures,
    colorPreset,
    sceneTheme,
    sceneMaterials,
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: libraryMaterialsVersion invalidates the ref resolution inside createWallExtraSlotMaterials
  const extraMaterials = useMemo(
    () => createWallExtraSlotMaterials(node, shading, sceneMaterials),
    [node, sceneMaterials, shading, libraryMaterialsVersion],
  )
  useEffect(
    () => () => {
      const baseSet = new Set(baseMaterials)
      const owned = new Set(Object.values(extraMaterials).filter((entry) => !baseSet.has(entry)))
      for (const entry of owned) entry.dispose()
    },
    [baseMaterials, extraMaterials],
  )

  return (
    <mesh
      castShadow
      geometry={placeholderGeometry}
      material={baseMaterials}
      receiveShadow
      ref={ref}
      visible={node.visible}
    >
      <mesh
        geometry={collisionPlaceholderGeometry}
        name={WALL_COLLISION_MESH_NAME}
        visible={false}
        {...handlers}
      />

      {treatmentLevelData && (
        <WallTreatments
          childrenNodes={childNodes}
          levelData={treatmentLevelData}
          materials={extraMaterials}
          node={node}
        />
      )}

      {(node.children ?? []).map((childId) => (
        <NodeRenderer key={`${node.id}:${childId}`} nodeId={childId} />
      ))}
    </mesh>
  )
}

export default WallRenderer
