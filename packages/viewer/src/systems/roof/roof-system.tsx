import {
  type AnyNode,
  type AnyNodeId,
  getDutchEndSlopeFaces,
  getDutchRoofShapeMetrics,
  getEffectiveNode,
  getRoofModuleFaces,
  getRoofShapeInsets,
  getRoofShapeRatios,
  getSegmentSlopeFrame,
  hasSegmentMaterialOverride,
  nodeRegistry,
  normalizeRoofSegmentTrim,
  ROOF_SHAPE_DEFAULTS,
  type RoofNode,
  type RoofSegmentNode,
  type RoofType,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ADDITION, Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import { computeBoundsTree } from 'three-mesh-bvh'
import { ensureRenderableGeometryAttributes } from '../../lib/csg-utils'

function csgGeometry(brush: Brush): THREE.BufferGeometry {
  return brush.geometry as unknown as THREE.BufferGeometry
}

function csgMaterials(brush: Brush): THREE.Material[] {
  const mat = (brush as any).material
  return Array.isArray(mat) ? mat : [mat]
}

const csgEvaluator = new Evaluator()
csgEvaluator.useGroups = true
;(csgEvaluator as any).consolidateGroups = false // shared dummyMats across brushes causes consolidation to misalign groupIndices vs groupOrder indices → crash
csgEvaluator.attributes = ['position', 'normal', 'uv', 'uv2']

function computeGeometryBoundsTree(geometry: THREE.BufferGeometry) {
  ;(geometry as any).computeBoundsTree = computeBoundsTree
  ;(geometry as any).computeBoundsTree({ maxLeafSize: 10 })
}

function prepareBrushForCSG(brush: Brush) {
  ensureRenderableGeometryAttributes(brush.geometry)
  computeGeometryBoundsTree(brush.geometry)
  brush.updateMatrixWorld()
}

// Pooled objects to avoid per-frame allocation in updateMergedRoofGeometry
const _matrix = new THREE.Matrix4()
const _position = new THREE.Vector3()
const _quaternion = new THREE.Quaternion()
const _scale = new THREE.Vector3(1, 1, 1)
const _yAxis = new THREE.Vector3(0, 1, 0)
const _uvFaceNormal = new THREE.Vector3()
const _uvWorldDown = new THREE.Vector3(0, -1, 0)
const _uvDownSlope = new THREE.Vector3()
const _uvAcrossSlope = new THREE.Vector3()
// World transform of the segment whose geometry is currently being built, so
// vertical (gable wall) faces project their UVs in WORLD space — identical to
// the wall kind's `applyWorldPlanarWallUVs` (U = ±worldX/Z, V = 1 - worldY) so
// the gable band tiles continuously into the walls below. Identity = local
// (the default outside a segment build). Set via `withSegmentUvMatrix`.
const _segmentUvMatrix = new THREE.Matrix4()
const _segmentUvNormalMatrix = new THREE.Matrix3()
const _uvWorldPoint = new THREE.Vector3()
const _uvWorldNormal = new THREE.Vector3()
const _prevSegmentUvMatrix = new THREE.Matrix4()
const _prevSegmentUvNormalMatrix = new THREE.Matrix3()

function withSegmentUvMatrix<T>(matrix: THREE.Matrix4, build: () => T): T {
  _prevSegmentUvMatrix.copy(_segmentUvMatrix)
  _prevSegmentUvNormalMatrix.copy(_segmentUvNormalMatrix)
  _segmentUvMatrix.copy(matrix)
  _segmentUvNormalMatrix.getNormalMatrix(matrix)
  try {
    return build()
  } finally {
    _segmentUvMatrix.copy(_prevSegmentUvMatrix)
    _segmentUvNormalMatrix.copy(_prevSegmentUvNormalMatrix)
  }
}

// Scratch matrices for composing a segment's world transform (roof group ∘
// segment) at each build, without per-call allocation.
const _segWorldMatrix = new THREE.Matrix4()
const _roofGroupMatrix = new THREE.Matrix4()
const _segLocalMatrix = new THREE.Matrix4()
const _uvTmpPos = new THREE.Vector3()
const _uvTmpQuat = new THREE.Quaternion()
const _uvUnitScale = new THREE.Vector3(1, 1, 1)

/** Compose the world transform `T(roofPos)·Ry(roofRot) · T(segPos)·Ry(segRot)`. */
function composeSegmentWorldMatrix(
  roofPosition: readonly number[] | undefined,
  roofRotation: number,
  segPosition: readonly number[],
  segRotation: number,
): THREE.Matrix4 {
  _roofGroupMatrix.compose(
    _uvTmpPos.set(roofPosition?.[0] ?? 0, roofPosition?.[1] ?? 0, roofPosition?.[2] ?? 0),
    _uvTmpQuat.setFromAxisAngle(_yAxis, roofRotation),
    _uvUnitScale,
  )
  _segLocalMatrix.compose(
    _uvTmpPos.set(segPosition[0] ?? 0, segPosition[1] ?? 0, segPosition[2] ?? 0),
    _uvTmpQuat.setFromAxisAngle(_yAxis, segRotation),
    _uvUnitScale,
  )
  return _segWorldMatrix.multiplyMatrices(_roofGroupMatrix, _segLocalMatrix)
}
const _tmpVec3A = new THREE.Vector3()
const _tmpVec3B = new THREE.Vector3()
const _surfaceRay = new THREE.Ray()
const _surfaceOrigin = new THREE.Vector3()
const _surfaceDir = new THREE.Vector3(0, -1, 0)
const _surfaceHits: THREE.Intersection[] = []
const _surfaceV0 = new THREE.Vector3()
const _surfaceV1 = new THREE.Vector3()
const _surfaceV2 = new THREE.Vector3()
const _surfaceFaceNormal = new THREE.Vector3()

// Pending merged-roof updates carried across frames (for throttling)
const pendingRoofUpdates = new Set<AnyNodeId>()
const warnedMergedRoofNaNIds = new Set<AnyNodeId>()
const MAX_ROOFS_PER_FRAME = 1
const MAX_SEGMENTS_PER_FRAME = 3

// ============================================================================
// ROOF SYSTEM
// ============================================================================

export const RoofSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  // Subscribe so an override-only update (no scene write) still re-runs
  // the component, letting the useFrame loop pick up the latest dirtyNodes
  // set from the render pass that received the override-publishing
  // `markDirty` call. Mirrors WallSystem / DoorSystem.
  useLiveNodeOverrides((s) => s.overrides)

  useFrame(() => {
    // Clear stale pending updates when the scene is unloaded
    if (rootNodeIds.length === 0) {
      pendingRoofUpdates.clear()
      warnedMergedRoofNaNIds.clear()
      for (const cached of mergedRoofSegmentGeometryCache.values()) {
        disposeCachedMergedRoofSegmentGeometrySet(cached)
      }
      mergedRoofSegmentGeometryCache.clear()
      return
    }

    if (dirtyNodes.size === 0 && pendingRoofUpdates.size === 0) return

    const nodes = useScene.getState().nodes

    // --- Pass 1: Process dirty roof-segments (throttled) ---
    let segmentsProcessed = 0
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node) return

      // Cutting roof accessories cascade their dirty mark to the host
      // segment's parent roof so the merged shell re-CSGs with the new
      // cut. Non-cutting accessories (vents, panels, gutters, etc.) sit on
      // top of the shell and should not force a full roof merge.
      const def = nodeRegistry.get(node.type)
      // Kinds with `dirtyHandledByOwnSystem` (door / window) reach the roof
      // through their own geometry system's parentId cascade instead —
      // their dirty marks belong to that system, not to this loop.
      const roofAccessory = def?.capabilities?.roofAccessory
      if (roofAccessory && !roofAccessory.dirtyHandledByOwnSystem) {
        const segId = (node as { roofSegmentId?: string }).roofSegmentId
        const seg = segId ? (nodes[segId as AnyNodeId] as RoofSegmentNode | undefined) : undefined
        if (roofAccessory.buildCut && seg?.parentId) {
          pendingRoofUpdates.add(seg.parentId as AnyNodeId)
        }
        clearDirty(id as AnyNodeId)
        return
      }

      if (node.type === 'roof-segment') {
        const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
        // Merge any live override (width / depth / wallHeight / pitch /
        // rotation) so the mesh rebuild reflects the in-flight handle drag
        // without zustand churn. When no override is set this returns the
        // scene node unchanged. Same pattern as DoorSystem / WallSystem.
        const effectiveSegment = getEffectiveNode(node as RoofSegmentNode)
        if (mesh) {
          // Only compute expensive individual CSG when the segment is actually rendered
          // (its parent group is visible = the roof is selected for editing)
          const isVisible = mesh.parent?.visible !== false
          // Accessory-reveal mode (RoofEditSystem): the wrapper is shown so
          // portaled handles render, but the merged shell stays visible and
          // the segment meshes are stripped to empty placeholders. Rebuilding
          // per-segment CSG here would draw UNCUT geometry on top of the
          // merged shell — hiding a freshly cut opening (door / window /
          // skylight) until the next deselect. Full edit mode hides the
          // merged mesh, so gate the rebuild on its visibility.
          const revealOnly =
            mesh.parent?.name === 'segments-wrapper' &&
            mesh.parent?.parent?.getObjectByName('merged-roof')?.visible === true
          if (isVisible && !revealOnly && segmentsProcessed < MAX_SEGMENTS_PER_FRAME) {
            updateRoofSegmentGeometry(effectiveSegment, mesh, nodes)
            segmentsProcessed++
          } else if (isVisible && !revealOnly) {
            return // Over budget — keep dirty, process next frame
          } else {
            // Just sync transform, skip CSG — the merged roof handles visuals.
            // But replace the initial BoxGeometry once: it has 6 groups (materialIndex 0-5)
            // while roofMaterials only has 4 entries. Three.js raycasts into invisible groups,
            // so MeshBVH hits groups[4].materialIndex → undefined.side → crash.
            if (mesh.geometry.type === 'BoxGeometry') {
              mesh.geometry.dispose()
              const placeholder = new THREE.BufferGeometry()
              // Three zero-vertices (one degenerate, invisible triangle), not an
              // empty attribute: an empty position (count 0) leaves WebGPU vertex
              // buffer slot 0 unbound if the mesh is ever drawn, and computeBoundsTree
              // needs a real position buffer to index.
              placeholder.setAttribute(
                'position',
                new THREE.Float32BufferAttribute(new Float32Array(9), 3),
              )
              placeholder.setAttribute(
                'normal',
                new THREE.Float32BufferAttribute(new Float32Array(9), 3),
              )
              placeholder.setAttribute(
                'uv',
                new THREE.Float32BufferAttribute(new Float32Array(6), 2),
              )
              placeholder.setAttribute(
                'uv2',
                new THREE.Float32BufferAttribute(new Float32Array(6), 2),
              )
              computeGeometryBoundsTree(placeholder)
              mesh.geometry = placeholder
            }
            mesh.position.set(
              effectiveSegment.position[0],
              effectiveSegment.position[1],
              effectiveSegment.position[2],
            )
            mesh.rotation.y = effectiveSegment.rotation
          }
          clearDirty(id as AnyNodeId)
        } else {
          clearDirty(id as AnyNodeId)
        }
        // Queue the parent roof for a merged geometry update
        if (effectiveSegment.parentId) {
          pendingRoofUpdates.add(effectiveSegment.parentId as AnyNodeId)
        }
      } else if (node.type === 'roof') {
        pendingRoofUpdates.add(id as AnyNodeId)
        clearDirty(id as AnyNodeId)
      }
    })

    // --- Pass 2: Process pending merged-roof updates (max 1 per frame) ---
    let roofsProcessed = 0
    for (const id of pendingRoofUpdates) {
      if (roofsProcessed >= MAX_ROOFS_PER_FRAME) break

      const node = nodes[id]
      if (node?.type !== 'roof') {
        pendingRoofUpdates.delete(id)
        continue
      }

      const group = sceneRegistry.nodes.get(id) as THREE.Group
      if (!group) continue

      const mergedMesh = group.getObjectByName('merged-roof') as THREE.Mesh | undefined
      if (!mergedMesh) continue

      if (mergedMesh.visible !== false) {
        // Only rebuild when visible — RoofEditSystem re-triggers via markDirty on edit mode exit
        updateMergedRoofGeometry(node as RoofNode, group, nodes)
        roofsProcessed++
      }

      pendingRoofUpdates.delete(id)
    }
  }, 5) // Priority 5: run after all other systems have settled

  return null
}

// ============================================================================
// GEOMETRY GENERATION
// ============================================================================

function updateRoofSegmentGeometry(
  node: RoofSegmentNode,
  mesh: THREE.Mesh,
  nodes?: Record<string, AnyNode>,
) {
  const newGeo = generateRoofSegmentGeometry(node, nodes)

  mesh.geometry.dispose()
  mesh.geometry = newGeo
  computeGeometryBoundsTree(newGeo)

  mesh.position.set(node.position[0], node.position[1], node.position[2])
  mesh.rotation.y = node.rotation
}

/**
 * Subtract every hosted accessory cut (`capabilities.roofAccessory.
 * buildCut`) from a segment's brushes, in SEGMENT-LOCAL space. Shared by
 * the merged-shell path AND the per-segment path (full edit mode /
 * painted segments) — without the latter, selecting a segment used to
 * swap the merged shell for uncut per-segment meshes and every door /
 * window / skylight hole vanished until deselect. Children are read
 * live-effective so an in-flight handle drag carves the live hole.
 * Registry-driven so the viewer never names a kind.
 */
function subtractAccessoryCuts(
  brushes: RoofSegmentBrushSet,
  segment: RoofSegmentNode,
  nodes: Record<string, AnyNode>,
) {
  let workingShin = brushes.shinSlab
  let workingDeck = brushes.deckSlab
  let workingWall = brushes.wallBrush
  for (const childElemId of segment.children ?? []) {
    const storedChild = nodes[childElemId as AnyNodeId]
    if (!storedChild) continue
    const childElem = getEffectiveNode(storedChild)
    const meta =
      typeof childElem.metadata === 'object' && childElem.metadata !== null
        ? (childElem.metadata as Record<string, unknown>)
        : undefined
    if (meta?.isTransient) continue

    const childDef = nodeRegistry.get(childElem.type)
    const buildCut = childDef?.capabilities?.roofAccessory?.buildCut
    if (!buildCut) continue

    const cutGeo = buildCut(childElem, segment)
    if (!cutGeo) continue

    // Wrap the kind-emitted geometry in a Brush. Kinds return raw
    // shapes; the viewer welds (mandatory after rotations leave
    // duplicated verts), attaches a single material group, and
    // builds the bounds tree — keeping kind code free of
    // three-bvh-csg / three-mesh-bvh imports.
    const welded = mergeVertices(cutGeo, 1e-4)
    cutGeo.dispose()
    const idxCount = welded.getIndex()?.count ?? 0
    if (idxCount === 0) {
      welded.dispose()
      continue
    }
    welded.clearGroups()
    welded.addGroup(0, idxCount, 0)
    welded.computeVertexNormals()
    ensureRenderableGeometryAttributes(welded)
    computeGeometryBoundsTree(welded)
    const cut = new Brush(welded, dummyMats[0])
    cut.updateMatrixWorld()

    const cutScope = childDef?.capabilities?.roofAccessory?.cutScope ?? 'all'
    try {
      if (cutScope !== 'wall') {
        const nextShin = csgEvaluator.evaluate(workingShin, cut, SUBTRACTION) as Brush
        workingShin.geometry.dispose()
        prepareBrushForCSG(nextShin)
        workingShin = nextShin

        const nextDeck = csgEvaluator.evaluate(workingDeck, cut, SUBTRACTION) as Brush
        workingDeck.geometry.dispose()
        prepareBrushForCSG(nextDeck)
        workingDeck = nextDeck
      }

      const nextWall = csgEvaluator.evaluate(workingWall, cut, SUBTRACTION) as Brush
      workingWall.geometry.dispose()
      prepareBrushForCSG(nextWall)
      workingWall = nextWall
    } catch (e) {
      console.error(`[${childElem.type}] cut CSG failed:`, e)
    } finally {
      cut.geometry.dispose()
    }
  }
  brushes.shinSlab = workingShin
  brushes.deckSlab = workingDeck
  brushes.wallBrush = workingWall
}

function getMergedRoofSegmentBrushes(
  roofNode: RoofNode,
  segment: RoofSegmentNode,
  nodes: Record<string, AnyNode>,
): RoofSegmentBrushSet | null {
  const segmentId = segment.id as AnyNodeId
  const cacheKey = getMergedRoofSegmentCacheKey(roofNode, segment, nodes)
  const cached = mergedRoofSegmentGeometryCache.get(segmentId)
  if (cached?.key === cacheKey) {
    return cloneCachedMergedRoofSegmentBrushes(cached)
  }

  const brushes = withSegmentUvMatrix(
    composeSegmentWorldMatrix(
      roofNode.position,
      roofNode.rotation ?? 0,
      segment.position,
      segment.rotation ?? 0,
    ),
    () => getRoofSegmentBrushes(segment),
  )
  if (!brushes) {
    disposeCachedMergedRoofSegmentGeometrySet(cached)
    mergedRoofSegmentGeometryCache.delete(segmentId)
    return null
  }

  subtractAccessoryCuts(brushes, segment, nodes)

  _matrix.compose(
    _position.set(segment.position[0], segment.position[1], segment.position[2]),
    _quaternion.setFromAxisAngle(_yAxis, segment.rotation),
    _scale,
  )

  const applyTransform = (brush: Brush) => {
    csgGeometry(brush).applyMatrix4(_matrix)
    brush.updateMatrixWorld()
  }

  applyTransform(brushes.shinSlab)
  applyTransform(brushes.deckSlab)
  applyTransform(brushes.wallBrush)
  applyTransform(brushes.innerBrush)
  brushes.rakeBoards?.applyMatrix4(_matrix)

  const nextCached: CachedMergedRoofSegmentGeometrySet = {
    key: cacheKey,
    deckSlab: {
      geometry: csgGeometry(brushes.deckSlab).clone(),
      materials: csgMaterials(brushes.deckSlab),
    },
    shinSlab: {
      geometry: csgGeometry(brushes.shinSlab).clone(),
      materials: csgMaterials(brushes.shinSlab),
    },
    wallBrush: {
      geometry: csgGeometry(brushes.wallBrush).clone(),
      materials: csgMaterials(brushes.wallBrush),
    },
    innerBrush: {
      geometry: csgGeometry(brushes.innerBrush).clone(),
      materials: csgMaterials(brushes.innerBrush),
    },
    rakeBoards: brushes.rakeBoards?.clone() ?? null,
  }
  disposeCachedMergedRoofSegmentGeometrySet(cached)
  mergedRoofSegmentGeometryCache.set(segmentId, nextCached)

  const cloned = cloneCachedMergedRoofSegmentBrushes(nextCached)
  disposeRoofSegmentBrushSet(brushes)
  return cloned
}

function updateMergedRoofGeometry(
  roofNode: RoofNode,
  group: THREE.Group,
  nodes: Record<string, AnyNode>,
) {
  const mergedMesh = group.getObjectByName('merged-roof') as THREE.Mesh | undefined
  if (!mergedMesh) return

  // Segments that carry their own material / preset (catch-all or any of
  // the role-specific fields) are rendered as their own per-segment mesh
  // in `RoofRenderer` so the painted material is preserved. Exclude them
  // from the merged shell — otherwise the merged mesh would draw on top
  // with the roof's default material.
  //
  // Merge each child through `getEffectiveNode` so an in-flight handle
  // drag (live override on width / depth / wallHeight / pitch / rotation)
  // is reflected in the merged shell during the drag, not only on commit.
  const children = (roofNode.children ?? [])
    .map((id) => {
      const scn = nodes[id] as RoofSegmentNode | undefined
      return scn ? getEffectiveNode(scn) : undefined
    })
    .filter((n): n is RoofSegmentNode => n !== undefined && !hasSegmentMaterialOverride(n))

  if (children.length === 0) {
    mergedMesh.geometry.dispose()
    // Keep a valid position attribute so Drei's BVH can index safely.
    mergedMesh.geometry = new THREE.BoxGeometry(0, 0, 0)
    return
  }

  let totalShinSlab: Brush | null = null
  let totalDeckSlab: Brush | null = null
  let totalWall: Brush | null = null
  let totalInner: Brush | null = null
  const rakeBoardGeometries: THREE.BufferGeometry[] = []

  for (const child of children) {
    const brushes = getMergedRoofSegmentBrushes(roofNode, child, nodes)
    if (!brushes) continue
    if (brushes.rakeBoards) {
      rakeBoardGeometries.push(brushes.rakeBoards)
    }

    if (totalShinSlab) {
      const next: Brush = csgEvaluator.evaluate(totalShinSlab, brushes.shinSlab, ADDITION) as Brush
      totalShinSlab.geometry.dispose()
      brushes.shinSlab.geometry.dispose()
      prepareBrushForCSG(next)
      totalShinSlab = next
    } else {
      totalShinSlab = brushes.shinSlab
    }

    if (totalDeckSlab) {
      const next: Brush = csgEvaluator.evaluate(totalDeckSlab, brushes.deckSlab, ADDITION) as Brush
      totalDeckSlab.geometry.dispose()
      brushes.deckSlab.geometry.dispose()
      prepareBrushForCSG(next)
      totalDeckSlab = next
    } else {
      totalDeckSlab = brushes.deckSlab
    }

    if (totalWall) {
      const next: Brush = csgEvaluator.evaluate(totalWall, brushes.wallBrush, ADDITION) as Brush
      totalWall.geometry.dispose()
      brushes.wallBrush.geometry.dispose()
      prepareBrushForCSG(next)
      totalWall = next
    } else {
      totalWall = brushes.wallBrush
    }

    if (totalInner) {
      const next: Brush = csgEvaluator.evaluate(totalInner, brushes.innerBrush, ADDITION) as Brush
      totalInner.geometry.dispose()
      brushes.innerBrush.geometry.dispose()
      prepareBrushForCSG(next)
      totalInner = next
    } else {
      totalInner = brushes.innerBrush
    }
  }

  if (totalShinSlab && totalDeckSlab && totalWall && totalInner) {
    try {
      const finalWallTrimmed = csgEvaluator.evaluate(totalWall, totalInner, SUBTRACTION)
      prepareBrushForCSG(finalWallTrimmed)

      const shinDeck = csgEvaluator.evaluate(totalShinSlab, totalDeckSlab, ADDITION)
      prepareBrushForCSG(shinDeck)
      const combined = csgEvaluator.evaluate(shinDeck, finalWallTrimmed, ADDITION)
      prepareBrushForCSG(combined)

      const resultGeo = csgGeometry(combined)
      if (geometryHasInvalidAttributes(resultGeo)) {
        if (!warnedMergedRoofNaNIds.has(roofNode.id)) {
          console.warn(
            '[RoofSystem] Skipping merged roof geometry with invalid attributes',
            roofNode.id,
          )
          warnedMergedRoofNaNIds.add(roofNode.id)
        }
        resultGeo.dispose()
        finalWallTrimmed.geometry.dispose()
        shinDeck.geometry.dispose()
        totalShinSlab.geometry.dispose()
        totalDeckSlab.geometry.dispose()
        totalWall.geometry.dispose()
        totalInner.geometry.dispose()
        for (const geometry of rakeBoardGeometries) geometry.dispose()
        return
      }

      const resultMaterials = csgMaterials(combined)

      const matToIndex = new Map<THREE.Material, number>([
        [dummyMats[0], 0],
        [dummyMats[1], 1],
        [dummyMats[2], 2],
        [dummyMats[3], 3],
      ])

      for (const g of resultGeo.groups) {
        g.materialIndex = mapRoofGroupMaterialIndex(g.materialIndex, resultMaterials, matToIndex)
      }

      let finalGeo = resultGeo
      if (rakeBoardGeometries.length > 0) {
        const merged = mergeGeometriesPreservingGroups([finalGeo, ...rakeBoardGeometries])
        if (merged) {
          finalGeo.dispose()
          finalGeo = merged
        }
      }
      for (const geometry of rakeBoardGeometries) geometry.dispose()

      finalGeo.computeVertexNormals()
      ensureRenderableGeometryAttributes(finalGeo)
      mergedMesh.geometry.dispose()
      mergedMesh.geometry = finalGeo

      finalWallTrimmed.geometry.dispose()
      shinDeck.geometry.dispose()
    } catch (e) {
      console.error('Merged roof CSG failed:', e)
    }

    totalShinSlab.geometry.dispose()
    totalDeckSlab.geometry.dispose()
    totalWall.geometry.dispose()
    totalInner.geometry.dispose()
    for (const geometry of rakeBoardGeometries) geometry.dispose()
  }
}

function geometryHasInvalidAttributes(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')
  if (!(position && position.count > 0)) return true

  for (const name of ['position', 'normal', 'uv', 'uv2']) {
    const attribute = geometry.getAttribute(name)
    if (!attribute) continue
    for (let i = 0; i < attribute.array.length; i++) {
      if (!Number.isFinite(attribute.array[i])) return true
    }
  }

  const index = geometry.getIndex()
  if (!index || index.count === 0) return true
  for (let i = 0; i < index.count; i++) {
    const value = index.getX(i)
    if (!Number.isInteger(value) || value < 0 || value >= position.count) return true
  }

  for (const group of geometry.groups) {
    if (
      !Number.isInteger(group.start) ||
      !Number.isInteger(group.count) ||
      group.start < 0 ||
      group.count <= 0 ||
      group.start + group.count > index.count
    ) {
      return true
    }
  }

  return false
}

/**
 * Four dummy materials used as identity placeholders during CSG. Shared
 * across every input brush so three-bvh-csg can preserve reference
 * equality on the result and `mapRoofGroupMaterialIndex` can map result
 * groups back to slots 0..3. Exposed so kinds that compose additional
 * CSG ops on top of `getRoofSegmentBrushes` (e.g. dormer) use the same
 * identity refs.
 */
export const roofCsgDummyMats: [
  THREE.MeshBasicMaterial,
  THREE.MeshBasicMaterial,
  THREE.MeshBasicMaterial,
  THREE.MeshBasicMaterial,
] = [
  new THREE.MeshBasicMaterial(),
  new THREE.MeshBasicMaterial(),
  new THREE.MeshBasicMaterial(),
  new THREE.MeshBasicMaterial(),
]
// Internal alias kept so the surrounding file's many call sites don't churn.
const dummyMats = roofCsgDummyMats

export const ROOF_MATERIAL_SLOT_COUNT = 4

type RoofSegmentBrushSet = {
  deckSlab: Brush
  shinSlab: Brush
  wallBrush: Brush
  innerBrush: Brush
  rakeBoards: THREE.BufferGeometry | null
}

type CachedMergedRoofSegmentGeometrySet = {
  key: string
  deckSlab: CachedMergedRoofSegmentBrush
  shinSlab: CachedMergedRoofSegmentBrush
  wallBrush: CachedMergedRoofSegmentBrush
  innerBrush: CachedMergedRoofSegmentBrush
  rakeBoards: THREE.BufferGeometry | null
}

type CachedMergedRoofSegmentBrush = {
  geometry: THREE.BufferGeometry
  materials: THREE.Material[]
}

const mergedRoofSegmentGeometryCache = new Map<AnyNodeId, CachedMergedRoofSegmentGeometrySet>()

function disposeCachedMergedRoofSegmentGeometrySet(
  cached: CachedMergedRoofSegmentGeometrySet | undefined,
) {
  if (!cached) return
  cached.deckSlab.geometry.dispose()
  cached.shinSlab.geometry.dispose()
  cached.wallBrush.geometry.dispose()
  cached.innerBrush.geometry.dispose()
  cached.rakeBoards?.dispose()
}

function disposeRoofSegmentBrushSet(brushes: RoofSegmentBrushSet) {
  brushes.deckSlab.geometry.dispose()
  brushes.shinSlab.geometry.dispose()
  brushes.wallBrush.geometry.dispose()
  brushes.innerBrush.geometry.dispose()
  brushes.rakeBoards?.dispose()
}

function cloneCachedBrush(cached: CachedMergedRoofSegmentBrush): Brush {
  const brush = new Brush(cached.geometry.clone(), cached.materials)
  prepareBrushForCSG(brush)
  return brush
}

function cloneCachedMergedRoofSegmentBrushes(
  cached: CachedMergedRoofSegmentGeometrySet,
): RoofSegmentBrushSet {
  return {
    deckSlab: cloneCachedBrush(cached.deckSlab),
    shinSlab: cloneCachedBrush(cached.shinSlab),
    wallBrush: cloneCachedBrush(cached.wallBrush),
    innerBrush: cloneCachedBrush(cached.innerBrush),
    rakeBoards: cached.rakeBoards?.clone() ?? null,
  }
}

function getMergedRoofAccessoryCachePayload(
  segment: RoofSegmentNode,
  nodes: Record<string, AnyNode>,
): unknown[] {
  const payload: unknown[] = []
  for (const childElemId of segment.children ?? []) {
    const storedChild = nodes[childElemId as AnyNodeId]
    if (!storedChild) continue
    const childElem = getEffectiveNode(storedChild)
    const meta =
      typeof childElem.metadata === 'object' && childElem.metadata !== null
        ? (childElem.metadata as Record<string, unknown>)
        : undefined
    if (meta?.isTransient) continue

    const childDef = nodeRegistry.get(childElem.type)
    if (!childDef?.capabilities?.roofAccessory?.buildCut) continue
    payload.push(childElem)
  }
  return payload
}

function getMergedRoofSegmentCacheKey(
  roofNode: RoofNode,
  segment: RoofSegmentNode,
  nodes: Record<string, AnyNode>,
): string {
  return JSON.stringify({
    roofPosition: roofNode.position ?? [0, 0, 0],
    roofRotation: roofNode.rotation ?? 0,
    segment,
    accessories: getMergedRoofAccessoryCachePayload(segment, nodes),
  })
}

export function mapRoofGroupMaterialIndex(
  groupMaterialIndex: number | undefined,
  csgMaterials: THREE.Material[],
  matToIndex: Map<THREE.Material, number>,
): number {
  if (groupMaterialIndex === undefined) return 0

  // Primary path — reference-equality lookup. Fast and exact when
  // three-bvh-csg preserves the original `dummyMats` references on
  // the result brush.
  const sourceMaterial = csgMaterials[groupMaterialIndex]
  const mappedIndex = sourceMaterial ? matToIndex.get(sourceMaterial) : undefined
  if (mappedIndex !== undefined) return mappedIndex

  // Robust fallback — every input brush was constructed with the same
  // 4-slot `dummyMats` array, so after N union/subtraction passes the
  // result's material array is `[dummyMats[0..3], dummyMats[0..3], ...]`
  // and the group's materialIndex is `slot + (brushOffset * 4)`. The
  // slot we care about is therefore `materialIndex % 4`. Without this
  // fallback, any CSG pass that returns a fresh `Material` object (or
  // clones the dummyMats refs) makes every group collapse to slot 0
  // (Wall) — which is the "shape is there but the wrong colour"
  // symptom roofs show after deselect / refresh.
  return (
    ((groupMaterialIndex % ROOF_MATERIAL_SLOT_COUNT) + ROOF_MATERIAL_SLOT_COUNT) %
    ROOF_MATERIAL_SLOT_COUNT
  )
}

function normalizeRoofMaterialIndex(materialIndex: number | undefined): number {
  if (materialIndex === undefined || !Number.isFinite(materialIndex)) return 0
  const normalized = Math.trunc(materialIndex)
  if (normalized < 0 || normalized >= ROOF_MATERIAL_SLOT_COUNT) return 0
  return normalized
}

function remapDutchRakeBoardMaterials(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')
  if (!position) return

  const index = geometry.getIndex()
  const triangleCount = (index?.count ?? position.count) / 3
  if (!Number.isFinite(triangleCount) || triangleCount <= 0) return

  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const triangleMaterials = new Array<number>(triangleCount).fill(DUTCH_RAKE_SIDE_MATERIAL_INDEX)

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const offset = triangleIndex * 3
    const ia = index ? index.getX(offset) : offset
    const ib = index ? index.getX(offset + 1) : offset + 1
    const ic = index ? index.getX(offset + 2) : offset + 2

    a.fromBufferAttribute(position, ia)
    b.fromBufferAttribute(position, ib)
    c.fromBufferAttribute(position, ic)
    ab.subVectors(b, a)
    ac.subVectors(c, a)
    normal.crossVectors(ab, ac).normalize()

    triangleMaterials[triangleIndex] =
      Math.abs(normal.y) > SHINGLE_SURFACE_EPSILON
        ? DUTCH_RAKE_TOP_MATERIAL_INDEX
        : DUTCH_RAKE_SIDE_MATERIAL_INDEX
  }

  geometry.clearGroups()
  let currentMaterial = triangleMaterials[0] ?? DUTCH_RAKE_SIDE_MATERIAL_INDEX
  let groupStart = 0

  for (let triangleIndex = 1; triangleIndex < triangleCount; triangleIndex += 1) {
    const materialIndex = triangleMaterials[triangleIndex] ?? DUTCH_RAKE_SIDE_MATERIAL_INDEX
    if (materialIndex === currentMaterial) continue

    geometry.addGroup(groupStart * 3, (triangleIndex - groupStart) * 3, currentMaterial)
    groupStart = triangleIndex
    currentMaterial = materialIndex
  }

  geometry.addGroup(groupStart * 3, (triangleCount - groupStart) * 3, currentMaterial)
}

const SHINGLE_SURFACE_EPSILON = 0.02
const RAKE_FACE_NORMAL_EPSILON = 0.3
const RAKE_FACE_ALIGNMENT_EPSILON = 0.35
const TRIM_CUT_EPSILON = 0.002
const DUTCH_RAKE_SIDE_MATERIAL_INDEX = 1
const DUTCH_RAKE_TOP_MATERIAL_INDEX = 3
const DUTCH_RAKE_SLOPE_SEAT_OFFSET = 0.0002

function pushDoubleSidedFace(targetFaces: THREE.Vector3[][], face: THREE.Vector3[]) {
  targetFaces.push(face)
  targetFaces.push(face.map((point) => point.clone()).reverse())
}

function hasSegmentTrim(node: RoofSegmentNode): boolean {
  const trim = normalizeRoofSegmentTrim(node)
  return (
    trim.left > 0 ||
    trim.right > 0 ||
    trim.front > 0 ||
    trim.back > 0 ||
    trim.frontLeft > 0 ||
    trim.frontRight > 0 ||
    trim.backLeft > 0 ||
    trim.backRight > 0 ||
    trim.frontLeftX > 0 ||
    trim.frontLeftZ > 0 ||
    trim.frontRightX > 0 ||
    trim.frontRightZ > 0 ||
    trim.backLeftX > 0 ||
    trim.backLeftZ > 0 ||
    trim.backRightX > 0 ||
    trim.backRightZ > 0
  )
}

function buildTrimCutBrush(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  minY: number,
  maxY: number,
): Brush | null {
  const width = maxX - minX
  const height = maxY - minY
  const depth = maxZ - minZ
  if (!(width > 0 && height > 0 && depth > 0)) return null

  const geometry = new THREE.BoxGeometry(width, height, depth)
  geometry.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)
  ensureRenderableGeometryAttributes(geometry)
  computeGeometryBoundsTree(geometry)

  const cut = new Brush(geometry, dummyMats)
  cut.updateMatrixWorld()
  return cut
}

type TrimPlanPoint = readonly [number, number]

function buildDiagonalTrimCutBrush(
  bounds: {
    minX: number
    maxX: number
    minZ: number
    maxZ: number
    minY: number
    maxY: number
  },
  lineA: TrimPlanPoint,
  lineB: TrimPlanPoint,
  outsidePoint: TrimPlanPoint,
): Brush | null {
  const dx = lineB[0] - lineA[0]
  const dz = lineB[1] - lineA[1]
  const lineLength = Math.hypot(dx, dz)
  const height = bounds.maxY - bounds.minY
  if (!(lineLength > 0 && height > 0)) return null

  const ux = dx / lineLength
  const uz = dz / lineLength
  let nx = -uz
  let nz = ux
  const midX = (lineA[0] + lineB[0]) / 2
  const midZ = (lineA[1] + lineB[1]) / 2
  const toOutsideX = outsidePoint[0] - midX
  const toOutsideZ = outsidePoint[1] - midZ
  let normalFlipped = false
  if (nx * toOutsideX + nz * toOutsideZ < 0) {
    nx *= -1
    nz *= -1
    normalFlipped = true
  }

  const boundsDiagonal = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)
  const cutterLength = Math.max(lineLength, boundsDiagonal) * 2
  const cutterDepth = boundsDiagonal * 2
  const centerX = midX + nx * (cutterDepth / 2 - TRIM_CUT_EPSILON)
  const centerZ = midZ + nz * (cutterDepth / 2 - TRIM_CUT_EPSILON)
  const yaw = Math.atan2(-uz, ux) + (normalFlipped ? Math.PI : 0)

  const geometry = new THREE.BoxGeometry(cutterLength, height, cutterDepth)
  geometry.rotateY(yaw)
  geometry.translate(centerX, (bounds.minY + bounds.maxY) / 2, centerZ)
  ensureRenderableGeometryAttributes(geometry)
  computeGeometryBoundsTree(geometry)

  const cut = new Brush(geometry, dummyMats)
  cut.updateMatrixWorld()
  return cut
}

function subtractCutFromSegmentBrushes(brushes: RoofSegmentBrushSet, cut: Brush) {
  for (const key of ['shinSlab', 'deckSlab', 'wallBrush', 'innerBrush'] as const) {
    const next = csgEvaluator.evaluate(brushes[key], cut, SUBTRACTION) as Brush
    brushes[key].geometry.dispose()
    prepareBrushForCSG(next)
    brushes[key] = next
  }
}

function buildSegmentTrimCutBrushes(segment: RoofSegmentNode): Brush[] {
  const trim = normalizeRoofSegmentTrim(segment)
  if (
    trim.left === 0 &&
    trim.right === 0 &&
    trim.front === 0 &&
    trim.back === 0 &&
    trim.frontLeft === 0 &&
    trim.frontRight === 0 &&
    trim.backLeft === 0 &&
    trim.backRight === 0 &&
    trim.frontLeftX === 0 &&
    trim.frontLeftZ === 0 &&
    trim.frontRightX === 0 &&
    trim.frontRightZ === 0 &&
    trim.backLeftX === 0 &&
    trim.backLeftZ === 0 &&
    trim.backRightX === 0 &&
    trim.backRightZ === 0
  ) {
    return []
  }

  const { activeRh } = getSegmentSlopeFrame(segment)
  const extra =
    segment.wallThickness + segment.overhang + segment.deckThickness + segment.shingleThickness + 2
  const minX = -segment.width / 2 - extra
  const maxX = segment.width / 2 + extra
  const minZ = -segment.depth / 2 - extra
  const maxZ = segment.depth / 2 + extra
  const minY = -2
  const maxY = segment.wallHeight + activeRh + segment.deckThickness + segment.shingleThickness + 2

  const cuts: Brush[] = []

  if (trim.left > 0) {
    const planeX = -segment.width / 2 + trim.left
    const cut = buildTrimCutBrush(minX, planeX + TRIM_CUT_EPSILON, minZ, maxZ, minY, maxY)
    if (cut) cuts.push(cut)
  }
  if (trim.right > 0) {
    const planeX = segment.width / 2 - trim.right
    const cut = buildTrimCutBrush(planeX - TRIM_CUT_EPSILON, maxX, minZ, maxZ, minY, maxY)
    if (cut) cuts.push(cut)
  }
  if (trim.front > 0) {
    const planeZ = segment.depth / 2 - trim.front
    const cut = buildTrimCutBrush(minX, maxX, planeZ - TRIM_CUT_EPSILON, maxZ, minY, maxY)
    if (cut) cuts.push(cut)
  }
  if (trim.back > 0) {
    const planeZ = -segment.depth / 2 + trim.back
    const cut = buildTrimCutBrush(minX, maxX, minZ, planeZ + TRIM_CUT_EPSILON, minY, maxY)
    if (cut) cuts.push(cut)
  }

  const leftX = -segment.width / 2 + trim.left
  const rightX = segment.width / 2 - trim.right
  const frontZ = segment.depth / 2 - trim.front
  const backZ = -segment.depth / 2 + trim.back

  if (trim.frontLeftX > 0 && trim.frontLeftZ > 0) {
    const cut = buildDiagonalTrimCutBrush(
      { minX, maxX, minZ, maxZ, minY, maxY },
      [leftX + trim.frontLeftX + TRIM_CUT_EPSILON, frontZ],
      [leftX, frontZ - trim.frontLeftZ - TRIM_CUT_EPSILON],
      [minX, maxZ],
    )
    if (cut) cuts.push(cut)
  }
  if (trim.frontRightX > 0 && trim.frontRightZ > 0) {
    const cut = buildDiagonalTrimCutBrush(
      { minX, maxX, minZ, maxZ, minY, maxY },
      [rightX, frontZ - trim.frontRightZ - TRIM_CUT_EPSILON],
      [rightX - trim.frontRightX - TRIM_CUT_EPSILON, frontZ],
      [maxX, maxZ],
    )
    if (cut) cuts.push(cut)
  }
  if (trim.backLeftX > 0 && trim.backLeftZ > 0) {
    const cut = buildDiagonalTrimCutBrush(
      { minX, maxX, minZ, maxZ, minY, maxY },
      [leftX, backZ + trim.backLeftZ + TRIM_CUT_EPSILON],
      [leftX + trim.backLeftX + TRIM_CUT_EPSILON, backZ],
      [minX, minZ],
    )
    if (cut) cuts.push(cut)
  }
  if (trim.backRightX > 0 && trim.backRightZ > 0) {
    const cut = buildDiagonalTrimCutBrush(
      { minX, maxX, minZ, maxZ, minY, maxY },
      [rightX - trim.backRightX - TRIM_CUT_EPSILON, backZ],
      [rightX, backZ + trim.backRightZ + TRIM_CUT_EPSILON],
      [maxX, minZ],
    )
    if (cut) cuts.push(cut)
  }

  return cuts
}

function subtractSegmentTrimCuts(brushes: RoofSegmentBrushSet, segment: RoofSegmentNode) {
  const cuts = buildSegmentTrimCutBrushes(segment)
  for (const cut of cuts) {
    try {
      subtractCutFromSegmentBrushes(brushes, cut)
    } catch (e) {
      console.error('Roof trim CSG failed:', e)
    } finally {
      cut.geometry.dispose()
    }
  }
}

/**
 * Subtract a segment's trim cuts from an arbitrary segment-local geometry,
 * returning the clipped result. The input geometry is consumed (disposed) on
 * each successful CSG pass — callers that need to keep the original must pass a
 * clone. Returns the input untouched when the segment has no trim. Used
 * internally for rake-board / end-slope attachments and exported so roof
 * accessories (chimney, vents, skylight, …) can clip their own meshes by the
 * same trim, in the same segment-local frame.
 */
export function clipGeometryBySegmentTrim(
  geometry: THREE.BufferGeometry | null,
  segment: RoofSegmentNode,
): THREE.BufferGeometry | null {
  if (!geometry) return null

  const cuts = buildSegmentTrimCutBrushes(segment)
  if (cuts.length === 0) return geometry

  let currentGeometry = geometry
  for (const cut of cuts) {
    try {
      const brush = new Brush(currentGeometry, dummyMats)
      prepareBrushForCSG(brush)
      const next = csgEvaluator.evaluate(brush, cut, SUBTRACTION) as Brush
      const trimmed = csgGeometry(next).clone()
      currentGeometry.dispose()
      next.geometry.dispose()
      ensureRenderableGeometryAttributes(trimmed)
      currentGeometry = trimmed
    } catch (e) {
      console.error('Roof trim CSG failed for attachment geometry:', e)
    } finally {
      cut.geometry.dispose()
    }
  }

  return currentGeometry
}

/**
 * Generate complete hollow-shell geometry for a roof segment.
 * Ports the prototype's CSG approach using three-bvh-csg.
 */
export function getRoofSegmentBrushes(node: RoofSegmentNode): RoofSegmentBrushSet | null {
  const {
    roofType,
    width,
    depth,
    wallHeight,
    wallThickness,
    deckThickness,
    overhang,
    shingleThickness,
  } = node

  const { activeRh, tanTheta, cosTheta, sinTheta } = getSegmentSlopeFrame(node)
  const shapeRatios = getRoofShapeRatios({
    gambrelLowerWidthRatio: node.gambrelLowerWidthRatio,
    mansardSteepWidthRatio: node.mansardSteepWidthRatio,
    dutchHipWidthRatio: node.dutchHipWidthRatio,
    dutchHipHeightRatio: node.dutchHipHeightRatio,
    dutchWaistLengthRatio: node.dutchWaistLengthRatio,
    dutchGabletRake: node.dutchGabletRake,
  })

  const verticalRt = activeRh > 0 ? deckThickness / cosTheta : deckThickness
  // Gablet inset must track dutchHipWidthRatio so the 3D waist matches both
  // the 2D floorplan and the slope frame (which derives activeRh from the
  // same ratio). A hardcoded 0.25 desyncs the gablet from the parameter.
  const baseI = Math.min(width, depth) * node.dutchHipWidthRatio

  const getVol = (
    wExt: number,
    vOffset: number,
    baseY: number,
    matIndex: number,
    isVoid: boolean,
  ) => {
    const wV = Math.max(0.01, width + 2 * wExt)
    const dV = Math.max(0.01, depth + 2 * wExt)

    const autoDrop = wExt * tanTheta
    const whV = Math.max(0.01, wallHeight - autoDrop + vOffset)

    let rhV = activeRh
    if (activeRh > 0) {
      rhV = activeRh + autoDrop
      if (roofType === 'shed') rhV = activeRh + 2 * autoDrop
    }

    const safeBaseY = Math.min(baseY, whV - 0.05)

    let structuralI = baseI
    if (isVoid) {
      structuralI += deckThickness
    }

    const faces = getRoofModuleFaces({
      type: roofType,
      w: wV,
      d: dV,
      wh: whV,
      rh: rhV,
      baseY: safeBaseY,
      insets: { dutchI: structuralI },
      baseW: width,
      baseD: depth,
      tanTheta,
      shapeRatios,
      dutchTopRakeThickness: node.dutchTopRakeThickness,
    }).map((face) => face.map((point) => new THREE.Vector3(point.x, point.y, point.z)))
    return createGeometryFromFaces(faces, matIndex)
  }

  const wallGeo = getVol(wallThickness / 2, 0, 0, 0, false)
  const innerGeo = getVol(-wallThickness / 2, 0, -5, 2, false)

  const horizontalOverhang = overhang * cosTheta
  const deckExt = wallThickness / 2 + horizontalOverhang

  const deckTopGeo = getVol(deckExt, verticalRt, 0, 1, false)
  const deckBotGeo = getVol(deckExt, 0, -5, 0, true)

  const stSin = shingleThickness * sinTheta
  const stCos = shingleThickness * cosTheta

  const shinBotW = Math.max(0.01, width + 2 * deckExt)
  const shinBotD = Math.max(0.01, depth + 2 * deckExt)

  const deckDrop = deckExt * tanTheta
  const shinBotWh = wallHeight - deckDrop + verticalRt

  let shinBotRh = activeRh
  if (activeRh > 0) {
    shinBotRh = activeRh + deckDrop
    if (roofType === 'shed') shinBotRh = activeRh + 2 * deckDrop
  }

  let shinTopW = shinBotW
  let shinTopD = shinBotD
  let transZ = 0

  if (['hip', 'mansard', 'dutch'].includes(roofType)) {
    shinTopW += 2 * stSin
    shinTopD += 2 * stSin
  } else if (['gable', 'gambrel'].includes(roofType)) {
    shinTopD += 2 * stSin
  } else if (roofType === 'shed') {
    shinTopD += stSin
    transZ = stSin / 2
  }

  const shinTopWh = shinBotWh + stCos

  let shinTopRh = shinBotRh
  if (activeRh > 0) {
    shinTopRh = shinBotRh + stSin * tanTheta
  }

  const availableR = (Math.min(shinBotW, shinBotD) / 2) * 0.95
  const maxDrop = tanTheta > 0.001 ? availableR / tanTheta : 2.0
  const dropTop = Math.min(1.0, maxDrop * 0.4)
  const dropBot = Math.min(2.0, maxDrop * 0.8)

  const topBaseY = shinBotWh - dropTop
  const botBaseY = shinBotWh - dropBot

  const insetsBot = getRoofShapeInsets({
    roofType,
    width,
    depth,
    wh: shinBotWh,
    baseY: botBaseY,
    isVoid: true,
    brushW: shinBotW,
    brushD: shinBotD,
    tanTheta,
    shingleThickness,
    dutchHipWidthRatio: node.dutchHipWidthRatio,
  })
  const insetsTop = getRoofShapeInsets({
    roofType,
    width,
    depth,
    wh: shinTopWh,
    baseY: topBaseY,
    isVoid: false,
    brushW: shinTopW,
    brushD: shinTopD,
    tanTheta,
    shingleThickness,
    dutchHipWidthRatio: node.dutchHipWidthRatio,
  })

  const botFaces = getRoofModuleFaces({
    type: roofType,
    w: shinBotW,
    d: shinBotD,
    wh: shinBotWh,
    rh: shinBotRh,
    baseY: botBaseY,
    insets: insetsBot,
    baseW: width,
    baseD: depth,
    tanTheta,
    shapeRatios,
    dutchTopRakeThickness: node.dutchTopRakeThickness,
  }).map((face) => face.map((point) => new THREE.Vector3(point.x, point.y, point.z)))
  const topFaces = getRoofModuleFaces({
    type: roofType,
    w: shinTopW,
    d: shinTopD,
    wh: shinTopWh,
    rh: shinTopRh,
    baseY: topBaseY,
    insets: insetsTop,
    baseW: width,
    baseD: depth,
    tanTheta,
    shapeRatios,
    dutchTopRakeThickness: node.dutchTopRakeThickness,
  }).map((face) => face.map((point) => new THREE.Vector3(point.x, point.y, point.z)))

  let rakeBoards: THREE.BufferGeometry | null = null
  if (roofType === 'dutch' && insetsTop.dutchI !== undefined) {
    rakeBoards = buildDutchRakeBoards(
      shinTopW,
      shinTopD,
      shinTopWh,
      shinTopRh,
      insetsTop.dutchI,
      shapeRatios,
      node.dutchGabletRake ?? ROOF_SHAPE_DEFAULTS.dutchGabletRake,
      node.dutchTopRakeThickness ?? ROOF_SHAPE_DEFAULTS.dutchTopRakeThickness,
    )
  }

  const shinBotGeo = createGeometryFromFaces(botFaces, (normal) =>
    normal.y > SHINGLE_SURFACE_EPSILON ? 3 : 1,
  )
  const shinTopGeo = createGeometryFromFaces(topFaces, (normal) =>
    normal.y > SHINGLE_SURFACE_EPSILON ? 3 : 1,
  )

  if (transZ !== 0) {
    shinTopGeo.translate(0, 0, transZ)
    rakeBoards?.translate(0, 0, transZ)
  }

  const toBrush = (geo: THREE.BufferGeometry): Brush | null => {
    if (!geo?.attributes.position || geo.attributes.position.count === 0) return null
    if (!geo.index) return null
    // Strip zero-count groups — three-bvh-csg crashes with groupIndices[i] undefined
    // when a group exists but covers no triangles (can happen after mergeVertices)
    geo.groups = geo.groups.filter((g) => g.count > 0)
    if (geo.groups.length === 0) return null
    ensureRenderableGeometryAttributes(geo)
    if (geometryHasInvalidAttributes(geo)) return null
    computeGeometryBoundsTree(geo)
    const brush = new Brush(geo, dummyMats)
    brush.updateMatrixWorld()
    return brush
  }

  const eps = 0.002

  const wallBrush = toBrush(wallGeo)
  const innerBrush = toBrush(innerGeo)
  if (innerBrush) {
    const wV = Math.max(0.01, width - wallThickness)
    const dV = Math.max(0.01, depth - wallThickness)
    innerBrush.scale.set(1 + eps / wV, 1, 1 + eps / dV)
    innerBrush.updateMatrixWorld()
  }

  const deckTopBrush = toBrush(deckTopGeo)
  const deckBotBrush = toBrush(deckBotGeo)
  if (deckBotBrush) {
    const wV = Math.max(0.01, width + 2 * deckExt)
    const dV = Math.max(0.01, depth + 2 * deckExt)
    deckBotBrush.scale.set(1 + eps / wV, 1, 1 + eps / dV)
    deckBotBrush.updateMatrixWorld()
  }

  const shinTopBrush = toBrush(shinTopGeo)
  const shinBotBrush = toBrush(shinBotGeo)
  if (shinBotBrush) {
    const wV = shinBotW
    const dV = shinBotD
    shinBotBrush.scale.set(1 + eps / wV, 1, 1 + eps / dV)
    shinBotBrush.updateMatrixWorld()
  }

  wallGeo.dispose()
  innerGeo.dispose()
  deckTopGeo.dispose()
  deckBotGeo.dispose()
  shinTopGeo.dispose()
  shinBotGeo.dispose()

  if (deckTopBrush && deckBotBrush && wallBrush && innerBrush && shinTopBrush && shinBotBrush) {
    try {
      const deckSlab = csgEvaluator.evaluate(deckTopBrush, deckBotBrush, SUBTRACTION)
      prepareBrushForCSG(deckSlab)
      const shinSlab = csgEvaluator.evaluate(shinTopBrush, shinBotBrush, SUBTRACTION)
      prepareBrushForCSG(shinSlab)

      deckTopBrush.geometry.dispose()
      deckBotBrush.geometry.dispose()
      shinTopBrush.geometry.dispose()
      shinBotBrush.geometry.dispose()

      const brushes = {
        deckSlab,
        shinSlab,
        wallBrush,
        innerBrush,
        rakeBoards,
      }
      if (hasSegmentTrim(node)) {
        subtractSegmentTrimCuts(brushes, node)
        brushes.rakeBoards = clipGeometryBySegmentTrim(brushes.rakeBoards, node)
        // The clip is a CSG subtraction: rake faces can come back as
        // `slot + 4n` because the cutter contributes its own material array.
        // Preserve top roof-material faces (slot 3) and force only cutter /
        // side faces back to the rake side material.
        if (brushes.rakeBoards) {
          remapDutchRakeBoardMaterials(brushes.rakeBoards)
        }
      }

      return brushes
    } catch (e) {
      console.error('CSG prep failed:', e)
    }
  }

  if (deckTopBrush) deckTopBrush.geometry.dispose()
  if (deckBotBrush) deckBotBrush.geometry.dispose()
  if (shinTopBrush) shinTopBrush.geometry.dispose()
  if (shinBotBrush) shinBotBrush.geometry.dispose()
  if (wallBrush) wallBrush.geometry.dispose()
  if (innerBrush) innerBrush.geometry.dispose()
  rakeBoards?.dispose()

  return null
}

export function generateRoofSegmentGeometry(
  node: RoofSegmentNode,
  nodes?: Record<string, AnyNode>,
): THREE.BufferGeometry {
  const parentRoof = node.parentId ? nodes?.[node.parentId] : undefined
  const parentRoofPosition =
    parentRoof && 'position' in parentRoof ? (parentRoof.position as number[]) : undefined
  const parentRoofRotation =
    parentRoof && 'rotation' in parentRoof
      ? ((parentRoof as { rotation?: number }).rotation ?? 0)
      : 0
  const brushes = withSegmentUvMatrix(
    composeSegmentWorldMatrix(
      parentRoofPosition,
      parentRoofRotation,
      node.position,
      node.rotation ?? 0,
    ),
    () => getRoofSegmentBrushes(node),
  )
  if (!brushes) {
    // Fallback: simple box
    return new THREE.BoxGeometry(node.width, node.wallHeight, node.depth)
  }

  if (nodes) {
    subtractAccessoryCuts(brushes, node, nodes)
  }

  const { deckSlab, shinSlab, wallBrush, innerBrush, rakeBoards } = brushes
  let resultGeo = new THREE.BufferGeometry()

  try {
    const hollowWall = csgEvaluator.evaluate(wallBrush, innerBrush, SUBTRACTION)
    prepareBrushForCSG(hollowWall)
    const shinDeck = csgEvaluator.evaluate(shinSlab, deckSlab, ADDITION)
    prepareBrushForCSG(shinDeck)
    const combined = csgEvaluator.evaluate(shinDeck, hollowWall, ADDITION)
    prepareBrushForCSG(combined)

    resultGeo = csgGeometry(combined)
    if (geometryHasInvalidAttributes(resultGeo)) {
      resultGeo.dispose()
      resultGeo = csgGeometry(wallBrush).clone()
    }

    const resultMaterials = csgMaterials(combined)

    const matToIndex = new Map<THREE.Material, number>([
      [dummyMats[0], 0],
      [dummyMats[1], 1],
      [dummyMats[2], 2],
      [dummyMats[3], 3],
    ])

    for (const group of resultGeo.groups) {
      group.materialIndex = mapRoofGroupMaterialIndex(
        group.materialIndex,
        resultMaterials,
        matToIndex,
      )
    }

    remapRoofShellFaces(resultGeo, node)

    hollowWall.geometry.dispose()
    shinDeck.geometry.dispose()
  } catch (e) {
    console.error('Roof CSG failed:', e)
    resultGeo = csgGeometry(wallBrush).clone()
  }

  deckSlab.geometry.dispose()
  shinSlab.geometry.dispose()
  wallBrush.geometry.dispose()
  innerBrush.geometry.dispose()

  if (rakeBoards) {
    const merged = mergeGeometriesPreservingGroups([resultGeo, rakeBoards])
    rakeBoards.dispose()
    if (merged) {
      resultGeo.dispose()
      resultGeo = merged
    }
  }

  resultGeo.computeVertexNormals()
  ensureRenderableGeometryAttributes(resultGeo)
  return resultGeo
}

// ============================================================================
// FACE-BASED GEOMETRY HELPERS (ported from prototype)
// ============================================================================

type Insets = {
  iF?: number
  iB?: number
  iL?: number
  iR?: number
  dutchI?: number
}

type RawGeometryGroup = {
  start: number
  count: number
  materialIndex: number
}

function createGeometryFromRawAttributes(
  positions: number[],
  normals: number[],
  uvs: number[],
  groups: RawGeometryGroup[],
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(Array.from({ length: positions.length / 3 }, (_, i) => i))
  for (const group of groups) {
    geometry.addGroup(group.start, group.count, group.materialIndex)
  }
  ensureRenderableGeometryAttributes(geometry)
  return geometry
}

function mergeGeometriesPreservingGroups(
  geometries: THREE.BufferGeometry[],
): THREE.BufferGeometry | null {
  if (geometries.length === 0) return null

  const merged = mergeGeometries(geometries, false)
  if (!merged) return null

  merged.clearGroups()

  let indexStart = 0
  for (const geometry of geometries) {
    if (geometry.groups.length > 0) {
      for (const group of geometry.groups) {
        merged.addGroup(indexStart + group.start, group.count, group.materialIndex ?? 0)
      }
    } else {
      const count = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0
      if (count > 0) {
        merged.addGroup(indexStart, count, 0)
      }
    }

    indexStart += geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0
  }

  return merged
}

function collectGeometryPlanes(geometry: THREE.BufferGeometry): THREE.Plane[] {
  const source = geometry.index ? geometry.toNonIndexed() : geometry
  const position = source.getAttribute('position') as THREE.BufferAttribute | undefined
  const planes: THREE.Plane[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  if (!position) return planes
  for (let i = 0; i + 2 < position.count; i += 3) {
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, i + 1)
    c.fromBufferAttribute(position, i + 2)
    const plane = new THREE.Plane().setFromCoplanarPoints(a, b, c)
    if (Number.isFinite(plane.normal.x) && plane.normal.lengthSq() > 1e-10) {
      planes.push(plane.normalize())
    }
  }
  if (source !== geometry) source.dispose()
  return planes
}

function splitShellByFacePlanes(
  geometry: THREE.BufferGeometry,
  planes: THREE.Plane[],
  materialIndex: number,
): THREE.BufferGeometry {
  if (planes.length === 0) return geometry

  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const position = source.getAttribute('position') as THREE.BufferAttribute | undefined
  const normal = source.getAttribute('normal') as THREE.BufferAttribute | undefined
  const uv = source.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!position || !normal || !uv) {
    source.dispose()
    return geometry
  }

  const groups =
    source.groups.length > 0 ? source.groups : [{ start: 0, count: position.count, materialIndex }]
  const keptPositions: number[] = []
  const keptNormals: number[] = []
  const keptUvs: number[] = []
  const keptGroups: RawGeometryGroup[] = []
  let keptVertexCount = 0
  const point = new THREE.Vector3()
  const triNormal = new THREE.Vector3()

  const pushTriangle = (
    targetPositions: number[],
    targetNormals: number[],
    targetUvs: number[],
    targetGroups: RawGeometryGroup[],
    startVertex: number,
    groupMaterialIndex: number,
    vertexOffset: number,
  ) => {
    if (
      targetGroups.length === 0 ||
      targetGroups[targetGroups.length - 1]!.materialIndex !== groupMaterialIndex
    ) {
      targetGroups.push({ start: startVertex, count: 0, materialIndex: groupMaterialIndex })
    }
    const targetGroup = targetGroups[targetGroups.length - 1]!
    for (let k = 0; k < 3; k += 1) {
      const vi = vertexOffset + k
      targetPositions.push(position.getX(vi), position.getY(vi), position.getZ(vi))
      targetNormals.push(normal.getX(vi), normal.getY(vi), normal.getZ(vi))
      targetUvs.push(uv.getX(vi), uv.getY(vi))
    }
    targetGroup.count += 3
  }

  const isPlaneMatch = (vertexOffset: number) => {
    if (
      materialIndex >= 0 &&
      triNormal.fromBufferAttribute(normal, vertexOffset).y <= SHINGLE_SURFACE_EPSILON
    ) {
      return false
    }
    triNormal.fromBufferAttribute(normal, vertexOffset).normalize()
    return planes.some((plane) => {
      if (Math.abs(triNormal.dot(plane.normal)) < 0.999) return false
      for (let k = 0; k < 3; k += 1) {
        point.fromBufferAttribute(position, vertexOffset + k)
        if (Math.abs(plane.distanceToPoint(point)) > 1e-3) return false
      }
      return true
    })
  }

  for (const group of groups) {
    const groupStart = Math.max(0, group.start)
    const groupEnd = Math.min(position.count, group.start + group.count)
    for (let i = groupStart; i + 2 < groupEnd; i += 3) {
      if (group.materialIndex === materialIndex && isPlaneMatch(i)) {
        continue
      }
      pushTriangle(
        keptPositions,
        keptNormals,
        keptUvs,
        keptGroups,
        keptVertexCount,
        group.materialIndex ?? 0,
        i,
      )
      keptVertexCount += 3
    }
  }

  source.dispose()
  geometry.dispose()
  return createGeometryFromRawAttributes(keptPositions, keptNormals, keptUvs, keptGroups)
}

export function remapRoofShellFaces(geometry: THREE.BufferGeometry, node: RoofSegmentNode) {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()

  if (!(position && index) || index.count === 0 || geometry.groups.length === 0) return

  geometry.computeBoundingBox()

  const triangleCount = index.count / 3
  const triangleMaterials = new Array<number>(triangleCount).fill(0)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const centroid = new THREE.Vector3()
  const normal = new THREE.Vector3()

  for (const group of geometry.groups) {
    const startTriangle = Math.floor(group.start / 3)
    const endTriangle = Math.min(triangleCount, Math.floor((group.start + group.count) / 3))

    for (let triangleIndex = startTriangle; triangleIndex < endTriangle; triangleIndex++) {
      const indexOffset = triangleIndex * 3
      let materialIndex = normalizeRoofMaterialIndex(group.materialIndex)

      if (materialIndex === 1 || materialIndex === 3) {
        const ia = index.getX(indexOffset)
        const ib = index.getX(indexOffset + 1)
        const ic = index.getX(indexOffset + 2)

        a.fromBufferAttribute(position, ia)
        b.fromBufferAttribute(position, ib)
        c.fromBufferAttribute(position, ic)

        ab.subVectors(b, a)
        ac.subVectors(c, a)
        normal.crossVectors(ab, ac).normalize()

        centroid
          .copy(a)
          .add(b)
          .add(c)
          .multiplyScalar(1 / 3)

        if (node.roofType === 'dutch' && Math.abs(normal.y) > SHINGLE_SURFACE_EPSILON) {
          materialIndex = 3
        } else if (normal.y > SHINGLE_SURFACE_EPSILON) {
          materialIndex = 3
        } else if (isRakeFace(node, geometry, centroid, normal)) {
          materialIndex = 1
        } else {
          materialIndex = 0
        }
      }

      triangleMaterials[triangleIndex] = materialIndex
    }
  }

  geometry.clearGroups()

  let currentMaterial = triangleMaterials[0] ?? 0
  let groupStart = 0

  for (let triangleIndex = 1; triangleIndex < triangleCount; triangleIndex++) {
    const materialIndex = triangleMaterials[triangleIndex] ?? 0
    if (materialIndex === currentMaterial) continue

    geometry.addGroup(groupStart * 3, (triangleIndex - groupStart) * 3, currentMaterial)
    groupStart = triangleIndex
    currentMaterial = materialIndex
  }

  geometry.addGroup(groupStart * 3, (triangleCount - groupStart) * 3, currentMaterial)
}

function isRakeFace(
  node: RoofSegmentNode,
  geometry: THREE.BufferGeometry,
  centroid: THREE.Vector3,
  normal: THREE.Vector3,
) {
  const rakeAxis = getRakeAxis(node)
  const bounds = geometry.boundingBox

  if (!(rakeAxis && bounds)) return false
  if (Math.abs(normal.y) > RAKE_FACE_NORMAL_EPSILON) return false

  const axisNormal = rakeAxis === 'x' ? Math.abs(normal.x) : Math.abs(normal.z)
  if (axisNormal < RAKE_FACE_ALIGNMENT_EPSILON) return false

  const halfExtent =
    rakeAxis === 'x'
      ? Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x))
      : Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z))
  const axisCoord = rakeAxis === 'x' ? Math.abs(centroid.x) : Math.abs(centroid.z)
  const planeTolerance = Math.max(
    node.overhang + node.wallThickness + node.deckThickness + node.shingleThickness,
    0.25,
  )

  if (halfExtent - axisCoord > planeTolerance) return false

  return true
}

function getRakeAxis(node: RoofSegmentNode): 'x' | 'z' | null {
  if (node.roofType === 'gable' || node.roofType === 'gambrel') return 'x'
  return null
}

type ShapeWidthRatios = {
  gambrelLowerWidthRatio: number
  mansardSteepWidthRatio: number
  dutchHipWidthRatio: number
  dutchHipHeightRatio: number
  dutchWaistLengthRatio: number
  dutchGabletRake: number
}

/**
 * Generates faces for a roof module volume.
 * Supports: hip, gable, shed, gambrel, dutch, mansard, flat.
 *
 * `shapeRatios` controls the kink positions on multi-slope roofs. The
 * height ratios are already baked into `tanTheta` (via the slope frame)
 * so they don't need to be threaded again.
 */
function getModuleFaces(
  type: RoofType,
  w: number,
  d: number,
  wh: number,
  rh: number,
  baseY: number,
  insets: Insets,
  baseW: number,
  baseD: number,
  tanTheta: number,
  shapeRatios: ShapeWidthRatios,
  dutchTopRakeThickness?: number,
): THREE.Vector3[][] {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const { iF = 0, iB = 0, iL = 0, iR = 0 } = insets

  const b1 = v(-w / 2 + iL, baseY, d / 2 - iF)
  const b2 = v(w / 2 - iR, baseY, d / 2 - iF)
  const b3 = v(w / 2 - iR, baseY, -d / 2 + iB)
  const b4 = v(-w / 2 + iL, baseY, -d / 2 + iB)
  const bottom = [b4, b3, b2, b1]

  const e1 = v(-w / 2, wh, d / 2)
  const e2 = v(w / 2, wh, d / 2)
  const e3 = v(w / 2, wh, -d / 2)
  const e4 = v(-w / 2, wh, -d / 2)

  const faces: THREE.Vector3[][] = []
  faces.push([b1, b2, e2, e1], [b2, b3, e3, e2], [b3, b4, e4, e3], [b4, b1, e1, e4], bottom)

  const h = wh + Math.max(0.001, rh)

  if (type === 'flat' || rh === 0) {
    faces.push([e1, e2, e3, e4])
  } else if (type === 'gable') {
    const r1 = v(-w / 2, h, 0)
    const r2 = v(w / 2, h, 0)
    faces.push([e4, e1, r1], [e2, e3, r2], [e1, e2, r2, r1], [e3, e4, r1, r2])
  } else if (type === 'hip') {
    if (Math.abs(w - d) < 0.01) {
      const r = v(0, h, 0)
      faces.push([e4, e1, r], [e1, e2, r], [e2, e3, r], [e3, e4, r])
    } else if (w >= d) {
      const r1 = v(-w / 2 + d / 2, h, 0)
      const r2 = v(w / 2 - d / 2, h, 0)
      faces.push([e4, e1, r1], [e2, e3, r2], [e1, e2, r2, r1], [e3, e4, r1, r2])
    } else {
      const r1 = v(0, h, d / 2 - w / 2)
      const r2 = v(0, h, -d / 2 + w / 2)
      faces.push([e1, e2, r1], [e3, e4, r2], [e2, e3, r2, r1], [e4, e1, r1, r2])
    }
  } else if (type === 'shed') {
    const t1 = v(-w / 2, h, -d / 2)
    const t2 = v(w / 2, h, -d / 2)
    faces.push([e1, e2, t2, t1], [e2, e3, t2], [e3, e4, t1, t2], [e4, e1, t1])
  } else if (type === 'gambrel') {
    const mz = (baseD / 2) * shapeRatios.gambrelLowerWidthRatio
    const dist = d / 2 - mz
    const mh = wh + dist * (tanTheta || 0)

    const m1 = v(-w / 2, mh, mz)
    const m2 = v(w / 2, mh, mz)
    const m3 = v(w / 2, mh, -mz)
    const m4 = v(-w / 2, mh, -mz)
    const r1 = v(-w / 2, h, 0)
    const r2 = v(w / 2, h, 0)
    faces.push(
      [e4, e1, m1, r1, m4],
      [e2, e3, m3, r2, m2],
      [e1, e2, m2, m1],
      [m1, m2, r2, r1],
      [e3, e4, m4, m3],
      [m3, m4, r1, r2],
    )
  } else if (type === 'mansard') {
    const i = Math.min(baseW, baseD) * shapeRatios.mansardSteepWidthRatio
    const mh = wh + i * (tanTheta || 0)

    const m1 = v(-w / 2 + i, mh, d / 2 - i)
    const m2 = v(w / 2 - i, mh, d / 2 - i)
    const m3 = v(w / 2 - i, mh, -d / 2 + i)
    const m4 = v(-w / 2 + i, mh, -d / 2 + i)
    const topW = w - i * 2
    const topD = d - i * 2

    faces.push([e1, e2, m2, m1], [e2, e3, m3, m2], [e3, e4, m4, m3], [e4, e1, m1, m4])

    if (Math.abs(topW - topD) < 0.01) {
      const r = v(0, h, 0)
      faces.push([m4, m1, r], [m1, m2, r], [m2, m3, r], [m3, m4, r])
    } else if (topW >= topD) {
      const r1 = v(-topW / 2 + topD / 2, h, 0)
      const r2 = v(topW / 2 - topD / 2, h, 0)
      faces.push([m4, m1, r1], [m2, m3, r2], [m1, m2, r2, r1], [m3, m4, r1, r2])
    } else {
      const r1 = v(0, h, topD / 2 - topW / 2)
      const r2 = v(0, h, -topD / 2 + topW / 2)
      faces.push([m1, m2, r1], [m3, m4, r2], [m2, m3, r2, r1], [m4, m1, r1, r2])
    }
  } else if (type === 'dutch') {
    const dutch = getDutchRoofShapeMetrics({
      w,
      d,
      wh,
      rh,
      dutchI: insets.dutchI,
      baseW,
      baseD,
      shapeRatios,
    })
    if (!dutch) return faces

    if (dutch.axis === 'width') {
      const m1 = v(-dutch.innerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
      const m2 = v(dutch.innerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
      const m3 = v(dutch.innerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)
      const m4 = v(-dutch.innerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)
      const o1 = v(-dutch.outerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
      const o2 = v(dutch.outerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
      const o3 = v(dutch.outerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)
      const o4 = v(-dutch.outerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)
      const r1 = v(-dutch.innerWaistHalfX, h, 0)
      const r2 = v(dutch.innerWaistHalfX, h, 0)
      const endSlopes = getDutchEndSlopeFaces({
        w,
        d,
        wh,
        rh,
        insets,
        baseW,
        baseD,
        shapeRatios,
        dutchTopRakeThickness,
      }).map((face) => face.map((point) => v(point.x, point.y, point.z)))
      faces.push([e1, e2, o2, m2, m1, o1], [e3, e4, o4, m4, m3, o3])
      if (endSlopes.length === 2) {
        faces.push(...endSlopes)
      } else {
        faces.push([e2, e3, o3, o2], [e4, e1, o1, o4])
      }
      faces.push([m1, m2, r2, r1], [m3, m4, r1, r2])
      faces.push([m4, m1, r1], [m2, m3, r2])
    } else {
      const m1 = v(-dutch.innerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
      const m2 = v(dutch.innerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
      const m3 = v(dutch.innerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)
      const m4 = v(-dutch.innerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)
      const o1 = v(-dutch.innerWaistHalfX, dutch.middleHeight, dutch.outerWaistHalfZ)
      const o2 = v(dutch.innerWaistHalfX, dutch.middleHeight, dutch.outerWaistHalfZ)
      const o3 = v(dutch.innerWaistHalfX, dutch.middleHeight, -dutch.outerWaistHalfZ)
      const o4 = v(-dutch.innerWaistHalfX, dutch.middleHeight, -dutch.outerWaistHalfZ)
      const r1 = v(0, h, dutch.innerWaistHalfZ)
      const r2 = v(0, h, -dutch.innerWaistHalfZ)
      const endSlopes = getDutchEndSlopeFaces({
        w,
        d,
        wh,
        rh,
        insets,
        baseW,
        baseD,
        shapeRatios,
        dutchTopRakeThickness,
      }).map((face) => face.map((point) => v(point.x, point.y, point.z)))
      faces.push([e2, e3, o3, m3, m2, o2], [e4, e1, o1, m1, m4, o4])
      if (endSlopes.length === 2) {
        faces.push(...endSlopes)
      } else {
        faces.push([e1, e2, o2, o1], [e3, e4, o4, o3])
      }
      faces.push([m2, m3, r2, r1], [m4, m1, r1, r2])
      faces.push([m1, m2, r1], [m3, m4, r2])
    }
  }

  return faces
}

function addDutchRakeBoard(
  apex: THREE.Vector3,
  base: THREE.Vector3,
  outward: THREE.Vector3,
  reach: number,
  thickness: number,
  topFaces: THREE.Vector3[][],
  sideFaces: THREE.Vector3[][],
) {
  if (!(reach > 0.001) || !(thickness > 0.0001)) return

  const apexOuter = apex.clone().addScaledVector(outward, reach)
  const baseOuter = base.clone().addScaledVector(outward, reach)
  const topPoly = [apex.clone(), base.clone(), baseOuter, apexOuter]

  const normal = new THREE.Vector3()
    .crossVectors(
      new THREE.Vector3().subVectors(topPoly[1]!, topPoly[0]!),
      new THREE.Vector3().subVectors(topPoly[2]!, topPoly[0]!),
    )
    .normalize()
  if (normal.y < 0) {
    topPoly.reverse()
    normal.multiplyScalar(-1)
  }

  const top = topPoly.map((point) =>
    point.clone().addScaledVector(normal, DUTCH_RAKE_SLOPE_SEAT_OFFSET),
  )
  const bottom = top.map((point) => new THREE.Vector3(point.x, point.y - thickness, point.z))
  pushDoubleSidedFace(topFaces, top)
  pushDoubleSidedFace(sideFaces, bottom.slice().reverse())
  for (let i = 0; i < top.length; i += 1) {
    const next = (i + 1) % top.length
    pushDoubleSidedFace(sideFaces, [
      top[i]!.clone(),
      top[next]!.clone(),
      bottom[next]!.clone(),
      bottom[i]!.clone(),
    ])
  }
}

function buildDutchRakeBoards(
  W: number,
  D: number,
  wh: number,
  rh: number,
  i: number,
  shapeRatios: ShapeWidthRatios,
  rake: number,
  thickness: number,
): THREE.BufferGeometry | null {
  if (!(rake > 0.001) || !(thickness > 0.0001) || !(i > 0.001) || !(rh > 0.001)) {
    return null
  }

  const dutch = getDutchRoofShapeMetrics({
    w: W,
    d: D,
    wh,
    rh,
    dutchI: i,
    baseW: W,
    baseD: D,
    shapeRatios: {
      ...shapeRatios,
      dutchGabletRake: rake,
    },
  })
  if (!dutch || !(dutch.rakeReach > 0.001)) return null

  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const topFaces: THREE.Vector3[][] = []
  const sideFaces: THREE.Vector3[][] = []

  if (dutch.axis === 'width') {
    addDutchRakeBoard(
      v(-dutch.innerWaistHalfX, dutch.peakHeight, 0),
      v(-dutch.innerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ),
      v(-1, 0, 0),
      dutch.rakeReach,
      thickness,
      topFaces,
      sideFaces,
    )
    addDutchRakeBoard(
      v(-dutch.innerWaistHalfX, dutch.peakHeight, 0),
      v(-dutch.innerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ),
      v(-1, 0, 0),
      dutch.rakeReach,
      thickness,
      topFaces,
      sideFaces,
    )
    addDutchRakeBoard(
      v(dutch.innerWaistHalfX, dutch.peakHeight, 0),
      v(dutch.innerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ),
      v(1, 0, 0),
      dutch.rakeReach,
      thickness,
      topFaces,
      sideFaces,
    )
    addDutchRakeBoard(
      v(dutch.innerWaistHalfX, dutch.peakHeight, 0),
      v(dutch.innerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ),
      v(1, 0, 0),
      dutch.rakeReach,
      thickness,
      topFaces,
      sideFaces,
    )
  } else {
    addDutchRakeBoard(
      v(0, dutch.peakHeight, dutch.innerWaistHalfZ),
      v(-dutch.innerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ),
      v(0, 0, 1),
      dutch.rakeReach,
      thickness,
      topFaces,
      sideFaces,
    )
    addDutchRakeBoard(
      v(0, dutch.peakHeight, dutch.innerWaistHalfZ),
      v(dutch.innerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ),
      v(0, 0, 1),
      dutch.rakeReach,
      thickness,
      topFaces,
      sideFaces,
    )
    addDutchRakeBoard(
      v(0, dutch.peakHeight, -dutch.innerWaistHalfZ),
      v(-dutch.innerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ),
      v(0, 0, -1),
      dutch.rakeReach,
      thickness,
      topFaces,
      sideFaces,
    )
    addDutchRakeBoard(
      v(0, dutch.peakHeight, -dutch.innerWaistHalfZ),
      v(dutch.innerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ),
      v(0, 0, -1),
      dutch.rakeReach,
      thickness,
      topFaces,
      sideFaces,
    )
  }

  const geometries: THREE.BufferGeometry[] = []
  if (topFaces.length > 0) {
    geometries.push(createGeometryFromFaces(topFaces, DUTCH_RAKE_TOP_MATERIAL_INDEX))
  }
  if (sideFaces.length > 0) {
    geometries.push(createGeometryFromFaces(sideFaces, DUTCH_RAKE_SIDE_MATERIAL_INDEX))
  }

  if (geometries.length === 0) return null
  if (geometries.length === 1) return geometries[0]!

  const merged = mergeGeometriesPreservingGroups(geometries)
  for (const geometry of geometries) geometry.dispose()
  return merged
}

/**
 * Converts an array of face polygons into a BufferGeometry.
 * Each face is triangulated via fan triangulation.
 */
function createGeometryFromFaces(
  faces: THREE.Vector3[][],
  matRule: number | ((normal: THREE.Vector3) => number) | null = null,
  options?: {
    treatBidirectionalSlopeFacesAsSlope?: boolean
  },
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const groups: { start: number; count: number; materialIndex: number }[] = []
  let vertexCount = 0

  for (const face of faces) {
    if (face.length < 3) continue

    const p0 = face[0]!
    const p1 = face[1]!
    const p2 = face[2]!
    const vA = new THREE.Vector3().subVectors(p1, p0)
    const vB = new THREE.Vector3().subVectors(p2, p0)
    const normal = new THREE.Vector3().crossVectors(vA, vB).normalize()
    if (normal.lengthSq() < 1e-12) continue
    let slopeAlignedDown: THREE.Vector3 | null = null
    let slopeAlignedAcross: THREE.Vector3 | null = null
    let slopeAlignedVOrigin = 0

    const slopeUvNormal =
      options?.treatBidirectionalSlopeFacesAsSlope && normal.y < 0
        ? normal.clone().multiplyScalar(-1)
        : normal

    if (Math.abs(slopeUvNormal.y) > SHINGLE_SURFACE_EPSILON) {
      _uvDownSlope.copy(_uvWorldDown).projectOnPlane(slopeUvNormal)
      if (_uvDownSlope.lengthSq() > 1e-8) {
        _uvDownSlope.normalize()
        _uvAcrossSlope.crossVectors(_uvDownSlope, slopeUvNormal).normalize()

        let highestPoint = face[0]!
        for (const candidate of face) {
          if (candidate.y > highestPoint.y) {
            highestPoint = candidate
          }
        }

        slopeAlignedDown = _uvDownSlope.clone()
        slopeAlignedAcross = _uvAcrossSlope.clone()
        slopeAlignedVOrigin = highestPoint.dot(slopeAlignedDown)
      }
    }

    let assignedMatIndex = 0
    if (typeof matRule === 'function') {
      assignedMatIndex = matRule(normal)
    } else if (matRule !== null && matRule !== undefined) {
      assignedMatIndex = matRule
    } else {
      const isVertical = Math.abs(normal.y) < 0.01
      assignedMatIndex = isVertical ? 0 : 1
    }

    let faceVertexCount = 0
    const startVertexCount = vertexCount

    for (let i = 1; i < face.length - 1; i++) {
      const fi = face[i]!
      const fi1 = face[i + 1]!
      positions.push(p0.x, p0.y, p0.z)
      positions.push(fi.x, fi.y, fi.z)
      positions.push(fi1.x, fi1.y, fi1.z)

      normals.push(normal.x, normal.y, normal.z)
      normals.push(normal.x, normal.y, normal.z)
      normals.push(normal.x, normal.y, normal.z)

      if (slopeAlignedDown && slopeAlignedAcross) {
        uvs.push(p0.dot(slopeAlignedAcross), slopeAlignedVOrigin - p0.dot(slopeAlignedDown))
        uvs.push(fi.dot(slopeAlignedAcross), slopeAlignedVOrigin - fi.dot(slopeAlignedDown))
        uvs.push(fi1.dot(slopeAlignedAcross), slopeAlignedVOrigin - fi1.dot(slopeAlignedDown))
      } else {
        pushRoofUv(uvs, p0, normal)
        pushRoofUv(uvs, fi, normal)
        pushRoofUv(uvs, fi1, normal)
      }

      indices.push(vertexCount, vertexCount + 1, vertexCount + 2)

      faceVertexCount += 3
      vertexCount += 3
    }

    groups.push({
      start: startVertexCount,
      count: faceVertexCount,
      materialIndex: assignedMatIndex,
    })
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)

  for (const g of groups) {
    geometry.addGroup(g.start, g.count, g.materialIndex)
  }

  // Merge identical vertices to optimize geometry for CSG and create clean topology
  const mergedGeo = mergeVertices(geometry, 1e-4)
  geometry.dispose()

  ensureRenderableGeometryAttributes(mergedGeo)
  return mergedGeo
}

function pushRoofUv(uvs: number[], point: THREE.Vector3, normal: THREE.Vector3) {
  // Project in WORLD space (via the current segment's world transform) so
  // vertical gable faces tile identically to the walls below; for a local
  // build the matrix is identity and this is the original behaviour.
  const p = _uvWorldPoint.copy(point).applyMatrix4(_segmentUvMatrix)
  _uvFaceNormal.copy(normal).applyMatrix3(_segmentUvNormalMatrix).normalize()
  _uvWorldNormal.copy(_uvFaceNormal)

  const absX = Math.abs(_uvFaceNormal.x)
  const absY = Math.abs(_uvFaceNormal.y)
  const absZ = Math.abs(_uvFaceNormal.z)

  if (absY >= absX && absY >= absZ) {
    uvs.push(p.x, p.z)
    return
  }

  if (_uvFaceNormal.y > SHINGLE_SURFACE_EPSILON) {
    _uvDownSlope.copy(_uvWorldDown).projectOnPlane(_uvFaceNormal)
    if (_uvDownSlope.lengthSq() > 1e-8) {
      _uvDownSlope.normalize()
      _uvAcrossSlope.crossVectors(_uvDownSlope, _uvFaceNormal).normalize()
      uvs.push(p.dot(_uvAcrossSlope), p.dot(_uvDownSlope))
      return
    }
  }

  // Vertical (gable wall) faces: U = ±worldX/Z (axis across the face normal),
  // V = 1 - worldY — the same world-space projection the wall kind uses.
  const wallV = 1 - p.y
  if (absX >= absZ) {
    uvs.push(_uvWorldNormal.x >= 0 ? p.z : -p.z, wallV)
    return
  }

  uvs.push(_uvWorldNormal.z >= 0 ? p.x : -p.x, wallV)
}

// ─── Skylight cutout ─────────────────────────────────────────────────
export type SurfaceFrame = {
  point: THREE.Vector3
  normal: THREE.Vector3
}

/**
 * Returns the outer roof surface frame (point + normal) at a given segment-local XZ.
 * This is used for skylight placement + cut direction so cutouts remain perpendicular
 * to the true roof surface even on multi-slope roofs (gambrel/mansard/dutch).
 */
export function getRoofOuterSurfaceFrameAtPoint(
  segment: RoofSegmentNode,
  lx: number,
  lz: number,
): SurfaceFrame {
  const {
    roofType,
    width,
    depth,
    wallHeight,
    wallThickness,
    deckThickness,
    overhang,
    shingleThickness,
  } = segment

  const { activeRh, tanTheta, cosTheta, sinTheta } = getSegmentSlopeFrame(segment)

  if (roofType === 'flat' || activeRh === 0) {
    return {
      point: new THREE.Vector3(lx, wallHeight + deckThickness + shingleThickness, lz),
      normal: new THREE.Vector3(0, 1, 0),
    }
  }

  const verticalRt = deckThickness / cosTheta
  const horizontalOverhang = overhang * cosTheta
  const deckExt = wallThickness / 2 + horizontalOverhang

  const stSin = shingleThickness * sinTheta
  const stCos = shingleThickness * cosTheta

  const shinBotW = Math.max(0.01, width + 2 * deckExt)
  const shinBotD = Math.max(0.01, depth + 2 * deckExt)
  const deckDrop = deckExt * tanTheta
  const shinBotWh = wallHeight - deckDrop + verticalRt

  let shinBotRh = activeRh
  if (activeRh > 0) {
    shinBotRh = activeRh + deckDrop
    if (roofType === 'shed') shinBotRh = activeRh + 2 * deckDrop
  }

  let shinTopW = shinBotW
  let shinTopD = shinBotD
  let transZ = 0
  if (['hip', 'mansard', 'dutch'].includes(roofType)) {
    shinTopW += 2 * stSin
    shinTopD += 2 * stSin
  } else {
    shinTopW += 2 * stSin
    shinTopD += 2 * stSin
    transZ = stSin
  }

  const shinTopWh = shinBotWh + stCos
  const shinTopRh = shinBotRh + stCos

  const topBaseY = 0

  const baseI = Math.min(width, depth) * 0.25
  // Dutch gablet waist tracks dutchHipWidthRatio (see getRoofSegmentBrushes);
  // the generic baseI above still drives the bottom-rect insets for other types.
  const dutchBaseI = Math.min(width, depth) * segment.dutchHipWidthRatio
  const getInsets = (
    _wh: number,
    _baseY: number,
    isVoid: boolean,
    _wV: number,
    _dV: number,
  ): Insets => {
    const inset = Math.max(0.01, baseI)
    let iF = 0
    let iB = 0
    let iL = 0
    let iR = 0

    if (roofType === 'hip') {
      iF = inset
      iB = inset
      iL = inset
      iR = inset
    } else if (roofType === 'gable' || roofType === 'gambrel') {
      iL = inset
      iR = inset
    } else if (roofType === 'mansard' || roofType === 'dutch') {
      iF = inset
      iB = inset
      iL = inset
      iR = inset
    } else if (roofType === 'shed') {
      iF = inset
    }

    let structuralI = dutchBaseI
    if (isVoid) {
      structuralI += shingleThickness
    }

    return { iF, iB, iL, iR, dutchI: structuralI }
  }

  const insetsTop = getInsets(shinTopWh, topBaseY, false, shinTopW, shinTopD)
  const shapeRatios: ShapeWidthRatios = {
    gambrelLowerWidthRatio: segment.gambrelLowerWidthRatio,
    mansardSteepWidthRatio: segment.mansardSteepWidthRatio,
    dutchHipWidthRatio: segment.dutchHipWidthRatio,
    dutchHipHeightRatio: segment.dutchHipHeightRatio,
    dutchWaistLengthRatio:
      segment.dutchWaistLengthRatio ?? ROOF_SHAPE_DEFAULTS.dutchWaistLengthRatio,
    dutchGabletRake: segment.dutchGabletRake ?? ROOF_SHAPE_DEFAULTS.dutchGabletRake,
  }
  const topFaces = getModuleFaces(
    roofType,
    shinTopW,
    shinTopD,
    shinTopWh,
    shinTopRh,
    topBaseY,
    insetsTop,
    width,
    depth,
    tanTheta,
    shapeRatios,
    segment.dutchTopRakeThickness,
  )

  const topGeo = createGeometryFromFaces(topFaces, (normal) =>
    normal.y > SHINGLE_SURFACE_EPSILON ? 3 : 1,
  )
  if (transZ !== 0) topGeo.translate(0, 0, transZ)
  topGeo.computeBoundingBox()

  const topY = wallHeight + activeRh + deckThickness + shingleThickness + 10
  _surfaceOrigin.set(lx, topY, lz)
  _surfaceRay.set(_surfaceOrigin, _surfaceDir)
  _surfaceHits.length = 0

  const pos = topGeo.getAttribute('position')
  const index = topGeo.getIndex()
  if (!pos || !index) {
    topGeo.dispose()
    return {
      point: new THREE.Vector3(lx, wallHeight, lz),
      normal: new THREE.Vector3(0, 1, 0),
    }
  }

  let bestT = Number.POSITIVE_INFINITY
  let bestPoint: THREE.Vector3 | null = null
  let bestNormal: THREE.Vector3 | null = null
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i)
    const b = index.getX(i + 1)
    const c = index.getX(i + 2)
    _surfaceV0.fromBufferAttribute(pos as any, a)
    _surfaceV1.fromBufferAttribute(pos as any, b)
    _surfaceV2.fromBufferAttribute(pos as any, c)

    const hit = _surfaceRay.intersectTriangle(_surfaceV0, _surfaceV1, _surfaceV2, false, _tmpVec3A)
    if (!hit) continue
    const t = hit.distanceTo(_surfaceOrigin)
    if (t < bestT) {
      bestT = t
      bestPoint = hit.clone()
      _surfaceFaceNormal
        .subVectors(_surfaceV1, _surfaceV0)
        .cross(_tmpVec3B.subVectors(_surfaceV2, _surfaceV0))
        .normalize()
      bestNormal = _surfaceFaceNormal.clone()
    }
  }

  topGeo.dispose()

  if (!bestPoint || !bestNormal) {
    return {
      point: new THREE.Vector3(lx, wallHeight, lz),
      normal: new THREE.Vector3(0, 1, 0),
    }
  }

  if (bestNormal.y < 0) bestNormal.multiplyScalar(-1)

  return { point: bestPoint, normal: bestNormal }
}
