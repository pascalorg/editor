import {
  type AnyNode,
  type AnyNodeId,
  getConicalRoofCoverage,
  getDutchEndSlopeFaces,
  getDutchRoofShapeMetrics,
  getEffectiveNode,
  getRoofModuleFaces,
  getRoofPlanBounds,
  getRoofSegmentSurfaceY,
  getRoofShapeInsets,
  getRoofShapeRatios,
  getSegmentSlopeFrame,
  hasSegmentMaterialOverride,
  isBandedShedSegment,
  nodeRegistry,
  normalizeRoofSegmentTrim,
  pointInPolygon2D,
  ROOF_SHAPE_DEFAULTS,
  type RoofNode,
  type RoofPlanBounds,
  type RoofSegmentNode,
  type RoofType,
  roofOverlapEntryOwns,
  roofPlanBoundsOverlap,
  sceneRegistry,
  unionPolygons,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ADDITION, Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import { computeBoundsTree } from 'three-mesh-bvh'
import { applyWorldScaleBoxUVs } from '../../lib/box-uv'
import { ensureRenderableGeometryAttributes, subtractCsgBrush } from '../../lib/csg-utils'

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

/**
 * Degenerate placeholder for a roof mesh with nothing to draw (initial
 * BoxGeometry swap-out, or a roof whose segments were all deleted/painted).
 * Three zero-vertices (one invisible triangle), not an empty attribute: an
 * empty position (count 0) leaves WebGPU vertex buffer slot 0 unbound if the
 * mesh is ever drawn, and computeBoundsTree needs a real position buffer to
 * index. Deliberately NO groups: count-0 groups crash MeshBVH's packed-tree
 * build (it partitions roots by group), and a BoxGeometry's 6 groups against
 * the 4 roof materials crash raycasts and GLTFExporter. Group-less + a
 * zero-area triangle is safe everywhere — it draws nothing under an array
 * material and can never be ray-hit.
 */
function createDegenerateRoofPlaceholder(): THREE.BufferGeometry {
  const placeholder = new THREE.BufferGeometry()
  placeholder.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
  placeholder.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
  placeholder.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
  placeholder.setAttribute('uv2', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
  computeGeometryBoundsTree(placeholder)
  return placeholder
}

// Pending merged-roof updates carried across frames (for throttling)
const pendingRoofUpdates = new Set<AnyNodeId>()
const previousRoofPlanBounds = new Map<AnyNodeId, RoofPlanBounds>()
const warnedMergedRoofNaNIds = new Set<AnyNodeId>()
const MAX_ROOFS_PER_FRAME = 1
const MAX_SEGMENTS_PER_FRAME = 3

function queueSiblingRoofUpdates(roofId: AnyNodeId, nodes: Record<string, AnyNode>) {
  pendingRoofUpdates.add(roofId)
  const roof = nodes[roofId]?.type === 'roof' ? getEffectiveNode(nodes[roofId]) : undefined
  if (roof?.type !== 'roof' || !roof.parentId) return
  const currentBounds = getRoofPlanBounds({
    position: roof.position,
    rotation: roof.rotation,
    segments: (roof.children ?? []).flatMap((id) => {
      const segment = nodes[id as AnyNodeId]
      if (segment?.type !== 'roof-segment') return []
      const effective = getEffectiveNode(segment)
      return [
        {
          position: effective.position,
          rotation: effective.rotation,
          width: effective.width,
          depth: effective.depth,
        },
      ]
    }),
  })
  const oldBounds = previousRoofPlanBounds.get(roofId)
  if (currentBounds) previousRoofPlanBounds.set(roofId, currentBounds)
  const parent = nodes[roof.parentId as AnyNodeId]
  if (!parent || !('children' in parent) || !Array.isArray(parent.children)) return
  for (const siblingId of parent.children) {
    const sibling = nodes[siblingId as AnyNodeId]
    if (sibling?.type !== 'roof' || sibling.id === roofId) continue
    const effectiveSibling = getEffectiveNode(sibling)
    const siblingBounds = getRoofPlanBounds({
      position: effectiveSibling.position,
      rotation: effectiveSibling.rotation,
      segments: (effectiveSibling.children ?? []).flatMap((id) => {
        const segment = nodes[id as AnyNodeId]
        if (segment?.type !== 'roof-segment') return []
        const effective = getEffectiveNode(segment)
        return [
          {
            position: effective.position,
            rotation: effective.rotation,
            width: effective.width,
            depth: effective.depth,
          },
        ]
      }),
    })
    if (!siblingBounds) continue
    previousRoofPlanBounds.set(sibling.id, siblingBounds)
    if (
      (currentBounds && roofPlanBoundsOverlap(currentBounds, siblingBounds)) ||
      (oldBounds && roofPlanBoundsOverlap(oldBounds, siblingBounds))
    ) {
      pendingRoofUpdates.add(sibling.id)
    }
  }
}

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
      previousRoofPlanBounds.clear()
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
              mesh.geometry = createDegenerateRoofPlaceholder()
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
          queueSiblingRoofUpdates(effectiveSegment.parentId as AnyNodeId, nodes)
        }
      } else if (node.type === 'roof') {
        queueSiblingRoofUpdates(id as AnyNodeId, nodes)
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
    // Not BoxGeometry: its 6 groups against the merged mesh's 4-material array
    // crash GLTFExporter (materials[4] → undefined) when the roof bakes.
    mergedMesh.geometry = createDegenerateRoofPlaceholder()
    return
  }

  let totalShinSlab: Brush | null = null
  let totalDeckSlab: Brush | null = null
  let totalWallShell: Brush | null = null
  const rakeBoardGeometries: THREE.BufferGeometry[] = []
  const directSegmentGeometries: THREE.BufferGeometry[] = []
  const csgChildren: RoofSegmentNode[] = []

  for (const child of children) {
    const directGeometry = withSegmentUvMatrix(
      composeSegmentWorldMatrix(
        roofNode.position,
        roofNode.rotation ?? 0,
        child.position,
        child.rotation ?? 0,
      ),
      () => buildCustomShedGeometry(child, nodes) ?? buildDirectConicalSectorGeometry(child),
    )
    if (directGeometry) {
      let withPanels = addShedInsetEndPanels(directGeometry, [child], false)
      _matrix.compose(
        _position.set(child.position[0], child.position[1], child.position[2]),
        _quaternion.setFromAxisAngle(_yAxis, child.rotation),
        _scale,
      )
      withPanels.applyMatrix4(_matrix)
      withPanels = clipDirectRoofGeometryAgainstSiblings(withPanels, child, nodes, 'roof')
      directSegmentGeometries.push(withPanels)
      continue
    }
    csgChildren.push(child)
    const brushes = getMergedRoofSegmentBrushes(roofNode, child, nodes)
    if (!brushes) continue
    if (brushes.rakeBoards) {
      rakeBoardGeometries.push(brushes.rakeBoards)
    }

    const occludingInterior = buildOccludingRoofInterior(child, nodes, 'roof')
    if (occludingInterior) {
      const exposedShingles = subtractCsgBrush(brushes.shinSlab, occludingInterior, csgEvaluator)
      brushes.shinSlab.geometry.dispose()
      brushes.shinSlab = exposedShingles

      const exposedDeck = subtractCsgBrush(brushes.deckSlab, occludingInterior, csgEvaluator)
      brushes.deckSlab.geometry.dispose()
      brushes.deckSlab = exposedDeck
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

    if (!shouldIncludeRoofSegmentWallShell(child, roofNode)) {
      brushes.wallBrush.geometry.dispose()
      brushes.innerBrush.geometry.dispose()
    } else {
      let wallShell = csgEvaluator.evaluate(
        brushes.wallBrush,
        brushes.innerBrush,
        SUBTRACTION,
      ) as Brush
      brushes.wallBrush.geometry.dispose()
      brushes.innerBrush.geometry.dispose()
      prepareBrushForCSG(wallShell)

      if (occludingInterior) {
        const exposedWall = subtractCsgBrush(wallShell, occludingInterior, csgEvaluator)
        wallShell.geometry.dispose()
        wallShell = exposedWall
      }

      if (totalWallShell) {
        const next = csgEvaluator.evaluate(totalWallShell, wallShell, ADDITION) as Brush
        totalWallShell.geometry.dispose()
        wallShell.geometry.dispose()
        prepareBrushForCSG(next)
        totalWallShell = next
      } else {
        totalWallShell = wallShell
      }
    }
    occludingInterior?.geometry.dispose()
  }

  if (totalShinSlab && totalDeckSlab) {
    try {
      const shinDeck = csgEvaluator.evaluate(totalShinSlab, totalDeckSlab, ADDITION)
      prepareBrushForCSG(shinDeck)
      let combined = shinDeck
      if (totalWallShell) {
        combined = csgEvaluator.evaluate(shinDeck, totalWallShell, ADDITION)
      }
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
        if (combined !== shinDeck) shinDeck.geometry.dispose()
        totalShinSlab.geometry.dispose()
        totalDeckSlab.geometry.dispose()
        totalWallShell?.geometry.dispose()
        for (const geometry of rakeBoardGeometries) geometry.dispose()
        for (const geometry of directSegmentGeometries) geometry.dispose()
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

      let finalGeo = addShedInsetEndPanels(resultGeo, csgChildren, true)
      const appendedGeometries = [...rakeBoardGeometries, ...directSegmentGeometries]
      if (appendedGeometries.length > 0) {
        const merged = mergeGeometriesPreservingGroups([finalGeo, ...appendedGeometries])
        if (merged) {
          finalGeo.dispose()
          finalGeo = merged
        }
      }
      for (const geometry of rakeBoardGeometries) geometry.dispose()
      for (const geometry of directSegmentGeometries) geometry.dispose()
      directSegmentGeometries.length = 0

      finalGeo.computeVertexNormals()
      ensureRenderableGeometryAttributes(finalGeo)
      mergedMesh.geometry.dispose()
      mergedMesh.geometry = finalGeo

      if (combined !== shinDeck) shinDeck.geometry.dispose()
    } catch (e) {
      console.error('Merged roof CSG failed:', e)
    }

    totalShinSlab.geometry.dispose()
    totalDeckSlab.geometry.dispose()
    totalWallShell?.geometry.dispose()
    for (const geometry of rakeBoardGeometries) geometry.dispose()
  }

  if (directSegmentGeometries.length > 0) {
    const finalGeo =
      directSegmentGeometries.length === 1
        ? directSegmentGeometries[0]!
        : mergeGeometriesPreservingGroups(directSegmentGeometries)
    if (finalGeo) {
      finalGeo.computeVertexNormals()
      ensureRenderableGeometryAttributes(finalGeo)
      mergedMesh.geometry.dispose()
      mergedMesh.geometry = finalGeo
    }
    for (const geometry of directSegmentGeometries) {
      if (geometry !== finalGeo) geometry.dispose()
    }
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
const ROOF_EDGE_MATERIAL_INDEX = 0
const ROOF_INSET_WALL_MATERIAL_INDEX = 2
const DUTCH_RAKE_SIDE_MATERIAL_INDEX = 1
const DUTCH_RAKE_TOP_MATERIAL_INDEX = 3
const DUTCH_RAKE_SLOPE_SEAT_OFFSET = 0.0002

function pushDoubleSidedFace(targetFaces: THREE.Vector3[][], face: THREE.Vector3[]) {
  targetFaces.push(face)
  targetFaces.push(face.map((point) => point.clone()).reverse())
}

type ShedEndSide = 'left' | 'right'
type RoofPlanPolygon = [number, number][]

function readShedFootprintPieces(node: RoofSegmentNode): RoofPlanPolygon[] {
  const value = node.shedFootprintPieces
  if (!Array.isArray(value)) return []
  return value.flatMap((polygon) => {
    if (!Array.isArray(polygon)) return []
    const points = polygon.flatMap((point): [number, number][] => {
      if (!Array.isArray(point) || point.length < 2) return []
      const x = readFiniteNumber(point[0])
      const z = readFiniteNumber(point[1])
      return x === null || z === null ? [] : [[x, z]]
    })
    return points.length >= 3 && points.length === polygon.length ? [points] : []
  })
}

function readShedOpenEndSides(node: RoofSegmentNode): Set<ShedEndSide> {
  const value = node.shedOpenEndSides
  if (!Array.isArray(value)) return new Set()
  return new Set(value.filter((side): side is ShedEndSide => side === 'left' || side === 'right'))
}

function shouldIncludeRoofSegmentWallShell(node: RoofSegmentNode, parentRoof?: RoofNode): boolean {
  if (node.wallShell === 'include') return true
  if (node.wallShell === 'omit') return false
  if (node.roofType !== 'shed') return true

  // Older composite roofs use overlapping shed segments as deck pieces. Their
  // wall volumes were never part of the rendered shell and make CSG grow
  // exponentially when unioned together.
  return !parentRoof || (parentRoof.children?.length ?? 0) <= 1
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

// Material slot the freshly exposed trim plane is assigned to. Slot 0 is the
// wall/trim band — the same finish the gable walls render with (concrete-drywall
// by default, continuous with the walls below). `remapRoofShellFaces` does not
// reclassify slot 0, so any new interior face CSG carves out of a BoxGeometry
// cutter lands on the wall band regardless of which box face it came from.
// Without this the box's default 6 groups (materialIndex 0..5) collapse via
// mod-4 and `remapRoofShellFaces` would reshuffle the vertical ones across
// slots. Accessories still clamp the slot via `useSegmentTrimClippedGeometry`
// when they expose fewer material slots.
const TRIM_CUT_MATERIAL_SLOT = 0
function assignTrimCutterSlot(geometry: THREE.BufferGeometry): void {
  geometry.clearGroups()
  const count = geometry.index ? geometry.index.count : geometry.getAttribute('position').count
  geometry.addGroup(0, count, TRIM_CUT_MATERIAL_SLOT)
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
  // World-metre UVs on the cutter so the newly exposed interior faces produced
  // by CSG inherit tiled UVs (1 uv unit per metre) instead of the box's default
  // 0→1-per-face, which would stretch the finish to fit each cut face.
  applyWorldScaleBoxUVs(geometry, width, height, depth)
  assignTrimCutterSlot(geometry)
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
  // World-metre UVs so the diagonal cut's interior face inherits tiled UVs.
  applyWorldScaleBoxUVs(geometry, cutterLength, height, cutterDepth)
  assignTrimCutterSlot(geometry)
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
  const conicalCoverage = getConicalRoofCoverage(node)

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
    materialRule?: (normal: THREE.Vector3) => number,
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
      conicalStartAngle: conicalCoverage.startAngle,
      conicalSweepAngle: conicalCoverage.sweepAngle,
    }).map((face) => face.map((point) => new THREE.Vector3(point.x, point.y, point.z)))
    return createGeometryFromFaces(faces, materialRule ?? matIndex)
  }

  const wallGeo = getVol(wallThickness / 2, 0, 0, 0, false)
  const innerGeo = getVol(-wallThickness / 2, 0, -5, 2, false)

  const horizontalOverhang = overhang * cosTheta
  const deckExt = wallThickness / 2 + horizontalOverhang

  const shedRoofSideMaterialRule =
    roofType === 'shed'
      ? (normal: THREE.Vector3) =>
          normal.y > SHINGLE_SURFACE_EPSILON ? 3 : ROOF_EDGE_MATERIAL_INDEX
      : undefined
  const deckTopGeo = getVol(deckExt, verticalRt, 0, 1, false, shedRoofSideMaterialRule)
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

  if (['hip', 'mansard', 'dutch', 'conical'].includes(roofType)) {
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
    conicalStartAngle: conicalCoverage.startAngle,
    conicalSweepAngle: conicalCoverage.sweepAngle,
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
    conicalStartAngle: conicalCoverage.startAngle,
    conicalSweepAngle: conicalCoverage.sweepAngle,
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

  const shedRoofSideMaterialIndex = roofType === 'shed' ? ROOF_EDGE_MATERIAL_INDEX : 1
  const shinBotGeo = createGeometryFromFaces(botFaces, (normal) =>
    normal.y > SHINGLE_SURFACE_EPSILON ? 3 : shedRoofSideMaterialIndex,
  )
  const shinTopGeo = createGeometryFromFaces(topFaces, (normal) =>
    normal.y > SHINGLE_SURFACE_EPSILON ? 3 : shedRoofSideMaterialIndex,
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
  const parentNode = node.parentId ? nodes?.[node.parentId] : undefined
  const parentRoof = parentNode?.type === 'roof' ? parentNode : undefined
  const parentRoofPosition = parentRoof?.position
  const parentRoofRotation = parentRoof?.rotation ?? 0
  const segmentWorldMatrix = composeSegmentWorldMatrix(
    parentRoofPosition,
    parentRoofRotation,
    node.position,
    node.rotation ?? 0,
  )
  const directSegmentGeometry = withSegmentUvMatrix(
    segmentWorldMatrix,
    () => buildCustomShedGeometry(node, nodes) ?? buildDirectConicalSectorGeometry(node),
  )
  if (directSegmentGeometry) {
    let result = addShedInsetEndPanels(directSegmentGeometry, [node], false)
    if (nodes) {
      result = clipDirectRoofGeometryAgainstSiblings(result, node, nodes, 'segment')
    }
    result.computeVertexNormals()
    ensureRenderableGeometryAttributes(result)
    return result
  }
  const brushes = withSegmentUvMatrix(segmentWorldMatrix, () => getRoofSegmentBrushes(node))
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
    const shinDeck = csgEvaluator.evaluate(shinSlab, deckSlab, ADDITION)
    prepareBrushForCSG(shinDeck)
    let combined = shinDeck
    let hollowWall: Brush | null = null
    if (shouldIncludeRoofSegmentWallShell(node, parentRoof)) {
      hollowWall = csgEvaluator.evaluate(wallBrush, innerBrush, SUBTRACTION)
      prepareBrushForCSG(hollowWall)
      combined = csgEvaluator.evaluate(shinDeck, hollowWall, ADDITION)
    }
    prepareBrushForCSG(combined)

    const siblingInterior = nodes ? buildOccludingRoofInterior(node, nodes, 'segment') : null
    if (siblingInterior) {
      const unclipped = combined
      combined = subtractCsgBrush(unclipped, siblingInterior, csgEvaluator)
      unclipped.geometry.dispose()
      siblingInterior.geometry.dispose()
    }

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
    resultGeo = addShedInsetEndPanels(resultGeo, [node], false)

    hollowWall?.geometry.dispose()
    if (combined !== shinDeck) shinDeck.geometry.dispose()
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

function clipDirectRoofGeometryAgainstSiblings(
  geometry: THREE.BufferGeometry,
  node: RoofSegmentNode,
  nodes: Record<string, AnyNode>,
  space: 'roof' | 'segment',
): THREE.BufferGeometry {
  const siblingInterior = buildOccludingRoofInterior(node, nodes, space)
  if (!siblingInterior) return geometry

  const brush = new Brush(geometry, dummyMats)
  prepareBrushForCSG(brush)
  try {
    const clipped = subtractCsgBrush(brush, siblingInterior, csgEvaluator)
    const clippedGeometry = csgGeometry(clipped)
    const clippedMaterials = csgMaterials(clipped)
    const materialIndices = new Map<THREE.Material, number>([
      [dummyMats[0], 0],
      [dummyMats[1], 1],
      [dummyMats[2], 2],
      [dummyMats[3], 3],
    ])
    for (const group of clippedGeometry.groups) {
      group.materialIndex = mapRoofGroupMaterialIndex(
        group.materialIndex,
        clippedMaterials,
        materialIndices,
      )
    }
    geometry.dispose()
    clippedGeometry.computeVertexNormals()
    ensureRenderableGeometryAttributes(clippedGeometry)
    return clippedGeometry
  } catch (error) {
    console.error('Direct roof intersection CSG failed:', error)
    return geometry
  } finally {
    siblingInterior.geometry.dispose()
  }
}

function buildOccludingRoofInterior(
  node: RoofSegmentNode,
  nodes: Record<string, AnyNode>,
  space: 'roof' | 'segment',
): Brush | null {
  if (!node.parentId) return null
  const parent = nodes[node.parentId as AnyNodeId]
  if (parent?.type !== 'roof') return null

  const roofEntries = collectSiblingRoofEntries(parent, nodes)
  const currentEntry = roofEntries.find(({ segment }) => segment.id === node.id)
  if (!currentEntry) return null
  const targetRoofInverse = composeRoofTransform(parent).invert()
  const targetSegmentInverse = composeSegmentTransform(node).invert()
  let combinedInterior: Brush | null = null

  for (let siblingIndex = 0; siblingIndex < roofEntries.length; siblingIndex++) {
    const entry = roofEntries[siblingIndex]!
    const sibling = entry.segment
    if (sibling.id === node.id) continue
    if (sibling.roofType === 'shed') continue
    const siblingOwnsOverlap = roofOverlapEntryOwns(
      roofOverlapEntry(entry.roof, sibling, nodes),
      roofOverlapEntry(currentEntry.roof, node, nodes),
    )
    if (!siblingOwnsOverlap) continue
    const siblingBrushes = getRoofSegmentBrushes(sibling)
    if (!siblingBrushes) continue

    const siblingInTargetRoof = new THREE.Matrix4()
      .multiplyMatrices(targetRoofInverse, composeRoofTransform(entry.roof))
      .multiply(composeSegmentTransform(sibling))
    const relativeMatrix =
      space === 'segment'
        ? new THREE.Matrix4().multiplyMatrices(targetSegmentInverse, siblingInTargetRoof)
        : siblingInTargetRoof
    csgGeometry(siblingBrushes.innerBrush).applyMatrix4(relativeMatrix)
    siblingBrushes.innerBrush.updateMatrixWorld()

    siblingBrushes.shinSlab.geometry.dispose()
    siblingBrushes.deckSlab.geometry.dispose()
    siblingBrushes.wallBrush.geometry.dispose()
    siblingBrushes.rakeBoards?.dispose()

    if (combinedInterior) {
      const next = csgEvaluator.evaluate(
        combinedInterior,
        siblingBrushes.innerBrush,
        ADDITION,
      ) as Brush
      combinedInterior.geometry.dispose()
      siblingBrushes.innerBrush.geometry.dispose()
      prepareBrushForCSG(next)
      combinedInterior = next
    } else {
      combinedInterior = siblingBrushes.innerBrush
    }
  }

  return combinedInterior
}

function roofOverlapEntry(
  roof: RoofNode,
  segment: RoofSegmentNode,
  nodes: Record<string, AnyNode>,
) {
  const supportSegment =
    roof.support?.kind === 'roof' ? nodes[roof.support.roofSegmentId as AnyNodeId] : undefined
  return {
    roofId: String(roof.id),
    segmentId: String(segment.id),
    supportRoofId:
      supportSegment?.type === 'roof-segment' && supportSegment.parentId
        ? String(supportSegment.parentId)
        : undefined,
    supportRoofSegmentId:
      roof.support?.kind === 'roof' ? String(roof.support.roofSegmentId) : undefined,
    roofType: segment.roofType,
    width: segment.width,
    depth: segment.depth,
  }
}

function collectSiblingRoofEntries(
  targetRoof: RoofNode,
  nodes: Record<string, AnyNode>,
): Array<{ roof: RoofNode; segment: RoofSegmentNode }> {
  const parent = targetRoof.parentId ? nodes[targetRoof.parentId as AnyNodeId] : undefined
  const orderedRoofIds =
    parent && 'children' in parent && Array.isArray(parent.children)
      ? parent.children.filter((id): id is RoofNode['id'] => nodes[id]?.type === 'roof')
      : [targetRoof.id]
  if (!orderedRoofIds.includes(targetRoof.id)) orderedRoofIds.push(targetRoof.id)

  return orderedRoofIds.flatMap((roofId) => {
    const roof = getEffectiveNode(nodes[roofId] as RoofNode)
    return (roof.children ?? []).flatMap((segmentId) => {
      const segment = nodes[segmentId as AnyNodeId]
      return segment?.type === 'roof-segment' ? [{ roof, segment: getEffectiveNode(segment) }] : []
    })
  })
}

function composeRoofTransform(roof: RoofNode): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...roof.position),
    new THREE.Quaternion().setFromAxisAngle(_yAxis, roof.rotation ?? 0),
    new THREE.Vector3(1, 1, 1),
  )
}

function composeSegmentTransform(segment: RoofSegmentNode): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...segment.position),
    new THREE.Quaternion().setFromAxisAngle(_yAxis, segment.rotation ?? 0),
    new THREE.Vector3(1, 1, 1),
  )
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

// Signed bend reference for a banded segment: the divisor that turns a flat
// along-width coordinate into an arc angle.
function bandSignedRef(arc: NonNullable<RoofSegmentNode['arc']>): number {
  return (Math.sign(arc.centerZ) || 1) * arc.radius
}

// Concentric map: rotate a flat segment-local (x, z) about the stored arc center by
// the angle its along-width coordinate subtends. The back (wall) edge lands at the
// wall's radius, the front edge at radius ± depth — a thin annular band, never a disc.
function bendBandPoint(
  arc: NonNullable<RoofSegmentNode['arc']>,
  signedRef: number,
  x: number,
  z: number,
): { x: number; z: number } {
  const phi = (x - arc.centerX) / signedRef
  const radial = z - arc.centerZ
  return {
    x: arc.centerX - radial * Math.sin(phi),
    z: arc.centerZ + radial * Math.cos(phi),
  }
}

// Remap every vertex of a flat segment-local geometry onto the concentric band,
// keeping Y. Used for the side-infill end panels so they follow the arc ends.
function applyBandBendToGeometry(
  geometry: THREE.BufferGeometry,
  arc: NonNullable<RoofSegmentNode['arc']>,
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) return
  const signedRef = bandSignedRef(arc)
  for (let index = 0; index < position.count; index++) {
    const bent = bendBandPoint(arc, signedRef, position.getX(index), position.getZ(index))
    position.setX(index, bent.x)
    position.setZ(index, bent.z)
  }
  position.needsUpdate = true
}

// Faceted annular-band deck for a shed segment bent across its width. The slope runs
// unchanged along depth (Z); the width axis (X) sweeps the stored concentric arc, so
// the deck hugs the host wall as a thin band and can never balloon into a disc.
function buildConcentricBandDeckGeometry(node: RoofSegmentNode): THREE.BufferGeometry | null {
  const arc = node.arc
  if (!arc) return null
  const width = node.width
  const halfWidth = width / 2
  const halfDepth = node.depth / 2
  const signedRef = bandSignedRef(arc)
  const { cosTheta } = getSegmentSlopeFrame(node)
  const verticalThickness =
    node.deckThickness / Math.max(0.1, cosTheta) + node.shingleThickness * cosTheta
  const facetCount = Math.max(4, Math.min(32, Math.ceil(width / 0.4)))

  const bend = (localX: number, localZ: number) => {
    const bent = bendBandPoint(arc, signedRef, localX, localZ)
    return new THREE.Vector3(bent.x, getRoofSegmentSurfaceY(node, localX, localZ), bent.z)
  }

  const backBottom: THREE.Vector3[] = []
  const frontBottom: THREE.Vector3[] = []
  for (let index = 0; index <= facetCount; index++) {
    const localX = -halfWidth + (index / facetCount) * width
    backBottom.push(bend(localX, -halfDepth))
    frontBottom.push(bend(localX, halfDepth))
  }

  const raise = (point: THREE.Vector3) =>
    new THREE.Vector3(point.x, point.y + verticalThickness, point.z)
  const backTop = backBottom.map(raise)
  const frontTop = frontBottom.map(raise)
  const faces: THREE.Vector3[][] = []

  for (let index = 0; index < facetCount; index++) {
    const next = index + 1
    // Each angular interval is its own convex quad. A single polygon around
    // the complete annular boundary is concave, so fan triangulation sends
    // diagonals through the open center and fills the roof as a solid sector.
    faces.push(
      [
        backBottom[index]!.clone(),
        backBottom[next]!.clone(),
        frontBottom[next]!.clone(),
        frontBottom[index]!.clone(),
      ],
      [
        frontTop[index]!.clone(),
        frontTop[next]!.clone(),
        backTop[next]!.clone(),
        backTop[index]!.clone(),
      ],
      [
        backBottom[next]!.clone(),
        backBottom[index]!.clone(),
        backTop[index]!.clone(),
        backTop[next]!.clone(),
      ],
      [
        frontBottom[index]!.clone(),
        frontBottom[next]!.clone(),
        frontTop[next]!.clone(),
        frontTop[index]!.clone(),
      ],
    )
  }

  const last = facetCount
  faces.push(
    [backBottom[0]!.clone(), frontBottom[0]!.clone(), frontTop[0]!.clone(), backTop[0]!.clone()],
    [
      frontBottom[last]!.clone(),
      backBottom[last]!.clone(),
      backTop[last]!.clone(),
      frontTop[last]!.clone(),
    ],
  )
  const merged = createGeometryFromFaces(faces, (normal) =>
    normal.y > SHINGLE_SURFACE_EPSILON ? 3 : ROOF_EDGE_MATERIAL_INDEX,
  )
  merged.computeVertexNormals()
  ensureRenderableGeometryAttributes(merged)
  return merged
}

type ConicalLayerProfile = {
  eaveY: number
  peakY: number
  radius: number
}

function buildDirectConicalSectorGeometry(node: RoofSegmentNode): THREE.BufferGeometry | null {
  if (node.roofType !== 'conical' || hasSegmentTrim(node)) return null
  const coverage = getConicalRoofCoverage(node)
  if (coverage.fullCircle) return null

  const { activeRh, tanTheta, cosTheta, sinTheta } = getSegmentSlopeFrame(node)
  const deckRadius = node.width / 2 + node.wallThickness / 2 + node.overhang * Math.max(0, cosTheta)
  const deckDrop = (deckRadius - node.width / 2) * tanTheta
  const deckVerticalThickness = node.deckThickness / Math.max(0.1, cosTheta)
  const shingleRadialThickness = node.shingleThickness * sinTheta
  const shingleVerticalThickness = node.shingleThickness * cosTheta
  const deckBottom: ConicalLayerProfile = {
    radius: deckRadius,
    eaveY: node.wallHeight - deckDrop,
    peakY: node.wallHeight + activeRh,
  }
  const deckTop: ConicalLayerProfile = {
    radius: deckRadius,
    eaveY: deckBottom.eaveY + deckVerticalThickness,
    peakY: deckBottom.peakY + deckVerticalThickness,
  }
  const shingleTop: ConicalLayerProfile = {
    radius: deckRadius + shingleRadialThickness,
    eaveY: deckTop.eaveY + shingleVerticalThickness,
    peakY: deckTop.peakY + shingleVerticalThickness + shingleRadialThickness * tanTheta,
  }
  const radialSegments = Math.max(
    1,
    Math.ceil((48 * Math.abs(coverage.sweepAngle)) / (Math.PI * 2)),
  )
  const angles = Array.from(
    { length: radialSegments + 1 },
    (_, index) => coverage.startAngle + (index / radialSegments) * coverage.sweepAngle,
  )
  const ring = (profile: ConicalLayerProfile) =>
    angles.map(
      (angle) =>
        new THREE.Vector3(
          Math.cos(angle) * profile.radius,
          profile.eaveY,
          Math.sin(angle) * profile.radius,
        ),
    )
  const deckBottomRing = ring(deckBottom)
  const deckTopRing = ring(deckTop)
  const shingleTopRing = ring(shingleTop)
  const deckBottomApex = new THREE.Vector3(0, deckBottom.peakY, 0)
  const deckTopApex = new THREE.Vector3(0, deckTop.peakY, 0)
  const shingleTopApex = new THREE.Vector3(0, shingleTop.peakY, 0)

  const orient = (face: THREE.Vector3[], upward: boolean) => {
    const normalY = new THREE.Vector3()
      .subVectors(face[1]!, face[0]!)
      .cross(new THREE.Vector3().subVectors(face[2]!, face[0]!)).y
    return normalY >= 0 === upward ? face : [...face].reverse()
  }
  const layerFaces = (
    bottomRing: THREE.Vector3[],
    bottomApex: THREE.Vector3,
    topRing: THREE.Vector3[],
    topApex: THREE.Vector3,
  ) => {
    const bottomFaces: THREE.Vector3[][] = []
    const topFaces: THREE.Vector3[][] = []
    const edgeFaces: THREE.Vector3[][] = []
    for (let index = 0; index < radialSegments; index += 1) {
      const next = index + 1
      bottomFaces.push(
        orient(
          [bottomRing[index]!, bottomRing[next]!, bottomApex].map((point) => point.clone()),
          false,
        ),
      )
      topFaces.push(
        orient(
          [topRing[index]!, topRing[next]!, topApex].map((point) => point.clone()),
          true,
        ),
      )
      edgeFaces.push([
        bottomRing[index]!.clone(),
        bottomRing[next]!.clone(),
        topRing[next]!.clone(),
        topRing[index]!.clone(),
      ])
    }
    const last = radialSegments
    edgeFaces.push(
      [bottomApex.clone(), bottomRing[0]!.clone(), topRing[0]!.clone(), topApex.clone()],
      [bottomApex.clone(), topApex.clone(), topRing[last]!.clone(), bottomRing[last]!.clone()],
    )
    return { bottomFaces, topFaces, edgeFaces }
  }

  const deck = layerFaces(deckBottomRing, deckBottomApex, deckTopRing, deckTopApex)
  const shingles = layerFaces(deckTopRing, deckTopApex, shingleTopRing, shingleTopApex)
  const geometries = [
    createGeometryFromFaces([...deck.bottomFaces, ...deck.edgeFaces], ROOF_EDGE_MATERIAL_INDEX),
    createGeometryFromFaces(shingles.topFaces, 3),
    createGeometryFromFaces(shingles.edgeFaces, ROOF_EDGE_MATERIAL_INDEX),
  ]

  if (node.wallHeight > 0.001) {
    const outerRadius = node.width / 2 + node.wallThickness / 2
    const innerRadius = Math.max(0.005, node.width / 2 - node.wallThickness / 2)
    const outerBottom = angles.map(
      (angle) => new THREE.Vector3(Math.cos(angle) * outerRadius, 0, Math.sin(angle) * outerRadius),
    )
    const outerTop = outerBottom.map(
      (point) => new THREE.Vector3(point.x, node.wallHeight, point.z),
    )
    const innerBottom = angles.map(
      (angle) => new THREE.Vector3(Math.cos(angle) * innerRadius, 0, Math.sin(angle) * innerRadius),
    )
    const innerTop = innerBottom.map(
      (point) => new THREE.Vector3(point.x, node.wallHeight, point.z),
    )
    const wallFaces: THREE.Vector3[][] = []
    for (let index = 0; index < radialSegments; index += 1) {
      const next = index + 1
      pushDoubleSidedFace(wallFaces, [
        outerBottom[next]!,
        outerBottom[index]!,
        outerTop[index]!,
        outerTop[next]!,
      ])
      pushDoubleSidedFace(wallFaces, [
        innerBottom[index]!,
        innerBottom[next]!,
        innerTop[next]!,
        innerTop[index]!,
      ])
    }
    const last = radialSegments
    pushDoubleSidedFace(wallFaces, [outerBottom[0]!, innerBottom[0]!, innerTop[0]!, outerTop[0]!])
    pushDoubleSidedFace(wallFaces, [
      innerBottom[last]!,
      outerBottom[last]!,
      outerTop[last]!,
      innerTop[last]!,
    ])
    geometries.push(createGeometryFromFaces(wallFaces, ROOF_EDGE_MATERIAL_INDEX))
  }

  const merged = mergeGeometriesPreservingGroups(geometries)
  for (const geometry of geometries) geometry.dispose()
  if (!merged) return null
  merged.computeVertexNormals()
  ensureRenderableGeometryAttributes(merged)
  return merged
}

function clipRoofPolygonAtX(
  polygon: readonly [number, number][],
  boundaryX: number,
  keepGreater: boolean,
): RoofPlanPolygon {
  const clipped: RoofPlanPolygon = []
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    const currentInside = keepGreater ? current[0] >= boundaryX : current[0] <= boundaryX
    const nextInside = keepGreater ? next[0] >= boundaryX : next[0] <= boundaryX
    if (currentInside) clipped.push([current[0], current[1]])
    if (currentInside === nextInside) continue
    const ratio = (boundaryX - current[0]) / (next[0] - current[0])
    clipped.push([boundaryX, current[1] + (next[1] - current[1]) * ratio])
  }
  return clipped
}

function sanitizeRoofPlanPolygon(polygon: RoofPlanPolygon): RoofPlanPolygon {
  const tolerance = 1e-8
  const points = polygon.filter((point, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length]!
    return Math.hypot(point[0] - previous[0], point[1] - previous[1]) > tolerance
  })

  let changed = true
  while (changed && points.length >= 3) {
    changed = false
    for (let index = 0; index < points.length; index++) {
      const previous = points[(index + points.length - 1) % points.length]!
      const point = points[index]!
      const next = points[(index + 1) % points.length]!
      const cross =
        (point[0] - previous[0]) * (next[1] - point[1]) -
        (point[1] - previous[1]) * (next[0] - point[0])
      if (Math.abs(cross) > tolerance) continue
      points.splice(index, 1)
      changed = true
      break
    }
  }

  return points
}

function facetBandedRoofPieces(
  pieces: readonly RoofPlanPolygon[],
  width: number,
): RoofPlanPolygon[] {
  const facetCount = Math.max(4, Math.min(32, Math.ceil(width / 0.4)))
  const halfWidth = width / 2
  const facetWidth = width / facetCount
  const faceted: RoofPlanPolygon[] = []
  for (const piece of pieces) {
    for (let index = 0; index < facetCount; index++) {
      const minX = -halfWidth + index * facetWidth
      const maxX = index === facetCount - 1 ? halfWidth : minX + facetWidth
      const clipped = clipRoofPolygonAtX(clipRoofPolygonAtX(piece, minX, true), maxX, false)
      const area = clipped.reduce((sum, point, pointIndex) => {
        const next = clipped[(pointIndex + 1) % clipped.length]!
        return sum + point[0] * next[1] - next[0] * point[1]
      }, 0)
      if (clipped.length >= 3 && Math.abs(area) > 1e-8) faceted.push(clipped)
    }
  }
  return faceted
}

function facetBandedRoofBoundary(
  polygon: RoofPlanPolygon,
  width: number,
): [RoofPlanPolygon[number], RoofPlanPolygon[number]][] {
  const facetCount = Math.max(4, Math.min(32, Math.ceil(width / 0.4)))
  const halfWidth = width / 2
  const facetWidth = width / facetCount
  const boundaries = Array.from(
    { length: facetCount - 1 },
    (_, index) => -halfWidth + (index + 1) * facetWidth,
  )
  const segments: [RoofPlanPolygon[number], RoofPlanPolygon[number]][] = []
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]!
    const end = polygon[(index + 1) % polygon.length]!
    const deltaX = end[0] - start[0]
    const splits = boundaries
      .flatMap((boundaryX) => {
        if (Math.abs(deltaX) <= 1e-8) return []
        const ratio = (boundaryX - start[0]) / deltaX
        return ratio > 1e-8 && ratio < 1 - 1e-8 ? [ratio] : []
      })
      .sort((left, right) => left - right)
    const points = [0, ...splits, 1].map(
      (ratio) =>
        [
          start[0] + (end[0] - start[0]) * ratio,
          start[1] + (end[1] - start[1]) * ratio,
        ] as RoofPlanPolygon[number],
    )
    for (let pointIndex = 0; pointIndex + 1 < points.length; pointIndex++) {
      segments.push([points[pointIndex]!, points[pointIndex + 1]!])
    }
  }
  return segments
}

function transformShedPlanPoint(
  node: RoofSegmentNode,
  point: readonly [number, number],
  nodes?: Record<string, AnyNode>,
): [number, number] {
  const rotation = node.rotation ?? 0
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const segmentPoint: [number, number] = [
    (node.position[0] ?? 0) + point[0] * cos + point[1] * sin,
    (node.position[2] ?? 0) - point[0] * sin + point[1] * cos,
  ]
  const ownerId =
    node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>).managedByLeanTo
      : undefined
  const owner = typeof ownerId === 'string' ? nodes?.[ownerId] : undefined
  if (owner?.type !== 'lean-to-extension') return segmentPoint
  const ownerRotation = owner.rotation[1] ?? 0
  const ownerCos = Math.cos(ownerRotation)
  const ownerSin = Math.sin(ownerRotation)
  return [
    (owner.position[0] ?? 0) + segmentPoint[0] * ownerCos + segmentPoint[1] * ownerSin,
    (owner.position[2] ?? 0) - segmentPoint[0] * ownerSin + segmentPoint[1] * ownerCos,
  ]
}

function inverseTransformShedPlanPoint(
  node: RoofSegmentNode,
  point: readonly [number, number],
  nodes?: Record<string, AnyNode>,
): [number, number] {
  const ownerId =
    node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>).managedByLeanTo
      : undefined
  const owner = typeof ownerId === 'string' ? nodes?.[ownerId] : undefined
  let source = point
  if (owner?.type === 'lean-to-extension') {
    const ownerRotation = owner.rotation[1] ?? 0
    const ownerCos = Math.cos(ownerRotation)
    const ownerSin = Math.sin(ownerRotation)
    const dx = point[0] - (owner.position[0] ?? 0)
    const dz = point[1] - (owner.position[2] ?? 0)
    source = [dx * ownerCos - dz * ownerSin, dx * ownerSin + dz * ownerCos]
  }
  const rotation = node.rotation ?? 0
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const dx = source[0] - (node.position[0] ?? 0)
  const dz = source[1] - (node.position[2] ?? 0)
  return [dx * cos - dz * sin, dx * sin + dz * cos]
}

function pointInOrNearShedPolygon(
  point: readonly [number, number],
  polygon: RoofPlanPolygon,
  tolerance: number,
): boolean {
  if (pointInPolygon2D([point[0], point[1]], polygon, { includeBoundary: false })) return true
  if (!(tolerance > 0)) return false

  const toleranceSquared = tolerance * tolerance
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]!
    const end = polygon[(index + 1) % polygon.length]!
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const lengthSquared = dx * dx + dz * dz
    const ratio =
      lengthSquared > 1e-12
        ? Math.max(
            0,
            Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared),
          )
        : 0
    const closestX = start[0] + dx * ratio
    const closestZ = start[1] + dz * ratio
    const distanceSquared =
      (point[0] - closestX) * (point[0] - closestX) + (point[1] - closestZ) * (point[1] - closestZ)
    if (distanceSquared <= toleranceSquared) return true
  }
  return false
}

function readMetadataString(node: AnyNode, key: string): string | undefined {
  const metadata = node.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

// The lean-to assembly records, per managed shed segment, the ids of the
// neighbouring lean-tos it is actually joined to. Restricting sibling detection
// to these keeps a shed from mitering against a run it merely passes near in
// world space (e.g. the two free ends of a J that overlap across its mouth).
function shedJointNeighborLeanTos(node: RoofSegmentNode): Set<string> | null {
  const metadata = node.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).leanToShedJointNeighbors
  if (!Array.isArray(value)) return null
  const ids = value.filter((entry): entry is string => typeof entry === 'string')
  return ids.length > 0 ? new Set(ids) : null
}

function isJoinedShedSibling(
  node: RoofSegmentNode,
  candidate: RoofSegmentNode,
): boolean {
  const neighbors = shedJointNeighborLeanTos(node)
  if (!neighbors) return true
  const candidateOwner = readMetadataString(candidate, 'managedByLeanTo')
  return candidateOwner !== undefined && neighbors.has(candidateOwner)
}

function shedJoinTolerance(
  node: RoofSegmentNode,
  sibling: RoofSegmentNode,
  nodes?: Record<string, AnyNode>,
): number {
  const sideOverhang = (segment: RoofSegmentNode) => {
    const structuralSpan = readFiniteNumber(segment.shedSideInfillSpan)
    if (structuralSpan !== null) return Math.max(0, (segment.width - structuralSpan) / 2)
    const managedBy =
      segment.metadata && typeof segment.metadata === 'object' && !Array.isArray(segment.metadata)
        ? (segment.metadata as Record<string, unknown>).managedByLeanTo
        : undefined
    const owner = typeof managedBy === 'string' ? nodes?.[managedBy] : undefined
    return owner?.type === 'lean-to-extension'
      ? Math.max(owner.leftOverhang, owner.rightOverhang)
      : 0
  }
  return Math.max(
    0.02,
    Math.min(
      0.2,
      Math.max(
        node.overhang,
        sibling.overhang,
        node.wallThickness,
        sibling.wallThickness,
        sideOverhang(node),
        sideOverhang(sibling),
      ),
    ),
  )
}

function edgeTouchesSiblingShed(
  node: RoofSegmentNode,
  start: readonly [number, number],
  end: readonly [number, number],
  nodes: Record<string, AnyNode> | undefined,
): boolean {
  if (!nodes) return false
  const metadata =
    node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>).managedByLeanTo
      : undefined
  const ownerId = typeof metadata === 'string' ? metadata : undefined
  const scopeId = (segment: RoofSegmentNode): string | undefined => {
    const segmentOwnerId =
      segment.metadata && typeof segment.metadata === 'object' && !Array.isArray(segment.metadata)
        ? (segment.metadata as Record<string, unknown>).managedByLeanTo
        : undefined
    const owner = typeof segmentOwnerId === 'string' ? nodes[segmentOwnerId] : undefined
    let parentId: string | undefined = owner?.parentId ?? segment.parentId ?? undefined
    const parent = parentId ? nodes[parentId] : undefined
    if (parent?.type === 'wall') parentId = parent.parentId ?? undefined
    return parentId
  }
  const nodeScope = scopeId(node)
  const siblings = Object.values(nodes).filter(
    (candidate): candidate is RoofSegmentNode =>
      candidate.type === 'roof-segment' &&
      candidate.id !== node.id &&
      (Boolean(node.parentId && candidate.parentId === node.parentId) ||
        (typeof ownerId === 'string' &&
          nodeScope !== undefined &&
          scopeId(candidate) === nodeScope &&
          Boolean(
            candidate.metadata &&
              typeof candidate.metadata === 'object' &&
              !Array.isArray(candidate.metadata) &&
              typeof (candidate.metadata as Record<string, unknown>).managedByLeanTo === 'string',
          ))) &&
      candidate.roofType === 'shed' &&
      isJoinedShedSibling(node, candidate),
  )
  if (siblings.length === 0) return false

  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length <= 1e-6) return false
  const nx = -dz / length
  const nz = dx / length
  for (const ratio of [0.25, 0.5, 0.75]) {
    const x = start[0] + dx * ratio
    const z = start[1] + dz * ratio
    const world = transformShedPlanPoint(node, [x, z], nodes)
    const samples: [number, number][] = [
      world,
      transformShedPlanPoint(node, [x + nx * 1e-4, z + nz * 1e-4], nodes),
      transformShedPlanPoint(node, [x - nx * 1e-4, z - nz * 1e-4], nodes),
    ]
    for (const sample of samples) {
      if (
        siblings.some((sibling) => {
          const local = inverseTransformShedPlanPoint(sibling, sample, nodes)
          const footprints = readShedFootprintPieces(sibling)
          const polygons =
            footprints.length > 0
              ? footprints
              : sibling.managedByParent
                ? [managedShedFootprint(sibling)]
                : []
          return polygons.some((polygon) =>
            pointInOrNearShedPolygon(local, polygon, shedJoinTolerance(node, sibling, nodes)),
          )
        })
      ) {
        return true
      }
    }
  }
  return false
}

function findSiblingShedAcrossEdge(
  node: RoofSegmentNode,
  start: readonly [number, number],
  end: readonly [number, number],
  nodes: Record<string, AnyNode> | undefined,
): RoofSegmentNode | undefined {
  if (!nodes) return undefined
  const ownerId =
    node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>).managedByLeanTo
      : undefined
  const scopeId = (segment: RoofSegmentNode): string | undefined => {
    const segmentOwnerId =
      segment.metadata && typeof segment.metadata === 'object' && !Array.isArray(segment.metadata)
        ? (segment.metadata as Record<string, unknown>).managedByLeanTo
        : undefined
    const owner = typeof segmentOwnerId === 'string' ? nodes[segmentOwnerId] : undefined
    let parentId: string | undefined = owner?.parentId ?? segment.parentId ?? undefined
    const parent = parentId ? nodes[parentId] : undefined
    if (parent?.type === 'wall') parentId = parent.parentId ?? undefined
    return parentId
  }
  const nodeScope = scopeId(node)
  const siblings = Object.values(nodes).filter(
    (candidate): candidate is RoofSegmentNode =>
      candidate.type === 'roof-segment' &&
      candidate.id !== node.id &&
      (Boolean(node.parentId && candidate.parentId === node.parentId) ||
        (typeof ownerId === 'string' &&
          nodeScope !== undefined &&
          scopeId(candidate) === nodeScope &&
          Boolean(
            candidate.metadata &&
              typeof candidate.metadata === 'object' &&
              !Array.isArray(candidate.metadata) &&
              typeof (candidate.metadata as Record<string, unknown>).managedByLeanTo === 'string',
          ))) &&
      candidate.roofType === 'shed' &&
      isJoinedShedSibling(node, candidate),
  )
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length <= 1e-6) return undefined
  const nx = -dz / length
  const nz = dx / length
  return siblings.find((sibling) =>
    [0.25, 0.5, 0.75].every((ratio) => {
      const x = start[0] + dx * ratio
      const z = start[1] + dz * ratio
      const samples: [number, number][] = [
        transformShedPlanPoint(node, [x, z], nodes),
        transformShedPlanPoint(node, [x + nx * 1e-4, z + nz * 1e-4], nodes),
        transformShedPlanPoint(node, [x - nx * 1e-4, z - nz * 1e-4], nodes),
      ]
      return samples.some((sample) => {
        const local = inverseTransformShedPlanPoint(sibling, sample, nodes)
        const footprints = readShedFootprintPieces(sibling)
        const polygons =
          footprints.length > 0
            ? footprints
            : sibling.managedByParent
              ? [managedShedFootprint(sibling)]
              : []
        return polygons.some((polygon) =>
          pointInOrNearShedPolygon(local, polygon, shedJoinTolerance(node, sibling, nodes)),
        )
      })
    }),
  )
}

function shedWorldYOrigin(node: RoofSegmentNode, nodes: Record<string, AnyNode>): number {
  const ownerId =
    node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>).managedByLeanTo
      : undefined
  const owner = typeof ownerId === 'string' ? nodes[ownerId] : undefined
  if (owner?.type === 'lean-to-extension') {
    return (owner.position[1] ?? 0) + (node.position[1] ?? 0)
  }
  const parent = node.parentId ? nodes[node.parentId] : undefined
  return (parent?.type === 'roof' ? (parent.position[1] ?? 0) : 0) + (node.position[1] ?? 0)
}

function shedVerticalThickness(node: RoofSegmentNode): number {
  const { cosTheta } = getSegmentSlopeFrame(node)
  return node.deckThickness / Math.max(0.1, cosTheta) + node.shingleThickness * cosTheta
}

function buildShedJointTransitionFaces(
  node: RoofSegmentNode,
  sibling: RoofSegmentNode,
  start: readonly [number, number],
  end: readonly [number, number],
  nodes: Record<string, AnyNode>,
  verticalThickness: number,
): THREE.Vector3[][] {
  const nodeWorldY = shedWorldYOrigin(node, nodes)
  const siblingWorldY = shedWorldYOrigin(sibling, nodes)
  const siblingThickness = shedVerticalThickness(sibling)
  const heights = (point: readonly [number, number]) => {
    const ownTop = getRoofSegmentSurfaceY(node, point[0], point[1]) + verticalThickness
    const worldPoint = transformShedPlanPoint(node, point, nodes)
    const siblingPoint = inverseTransformShedPlanPoint(sibling, worldPoint, nodes)
    const siblingTop =
      siblingWorldY +
      getRoofSegmentSurfaceY(sibling, siblingPoint[0], siblingPoint[1]) +
      siblingThickness -
      nodeWorldY
    return { ownTop, siblingTop }
  }
  const startHeights = heights(start)
  const endHeights = heights(end)
  const startDelta = startHeights.siblingTop - startHeights.ownTop
  const endDelta = endHeights.siblingTop - endHeights.ownTop
  const tolerance = 1e-5

  const face = (
    firstPoint: readonly [number, number],
    firstHeights: { ownTop: number; siblingTop: number },
    secondPoint: readonly [number, number],
    secondHeights: { ownTop: number; siblingTop: number },
  ) => {
    const firstOwn = new THREE.Vector3(firstPoint[0], firstHeights.ownTop, firstPoint[1])
    const secondOwn = new THREE.Vector3(secondPoint[0], secondHeights.ownTop, secondPoint[1])
    const secondSibling = new THREE.Vector3(
      secondPoint[0],
      secondHeights.siblingTop,
      secondPoint[1],
    )
    const firstSibling = new THREE.Vector3(firstPoint[0], firstHeights.siblingTop, firstPoint[1])
    if (Math.abs(firstHeights.siblingTop - firstHeights.ownTop) <= tolerance) {
      return [firstOwn, secondOwn, secondSibling]
    }
    if (Math.abs(secondHeights.siblingTop - secondHeights.ownTop) <= tolerance) {
      return [firstOwn, secondOwn, firstSibling]
    }
    return [firstOwn, secondOwn, secondSibling, firstSibling]
  }
  // Geometric ownership: a run closes the step only along the stretch where its
  // own roof top sits BELOW the sibling's (delta > 0), raising a vertical wall up
  // to the sibling's top. `delta` is antisymmetric between the two runs, so every
  // point of a seam is owned by exactly one run — the lower one — independent of
  // run count, chain vs. loop topology, or random node ids. Flush stretches
  // (|delta| <= tol) have no step and draw nothing, so a reversed/continuous fold
  // stays open. This replaces the old id-order tiebreak and the "skip when joined
  // on both ends" rule, which together left every seam of a closed loop unclosed.
  const faces: THREE.Vector3[][] = []
  if (startDelta > tolerance && endDelta > tolerance) {
    pushDoubleSidedFace(faces, face(start, startHeights, end, endHeights))
  } else if (startDelta > tolerance || endDelta > tolerance) {
    const ratio = startDelta / (startDelta - endDelta)
    const crossingPoint: [number, number] = [
      start[0] + (end[0] - start[0]) * ratio,
      start[1] + (end[1] - start[1]) * ratio,
    ]
    const crossingHeights = heights(crossingPoint)
    if (startDelta > tolerance) {
      pushDoubleSidedFace(faces, face(start, startHeights, crossingPoint, crossingHeights))
    } else {
      pushDoubleSidedFace(faces, face(crossingPoint, crossingHeights, end, endHeights))
    }
  }
  return faces
}

function clipShedPolygonByLine(
  polygon: RoofPlanPolygon,
  lineStart: readonly [number, number],
  lineEnd: readonly [number, number],
  outsidePoint: readonly [number, number],
): RoofPlanPolygon {
  const lineDx = lineEnd[0] - lineStart[0]
  const lineDz = lineEnd[1] - lineStart[1]
  const outsideSide =
    Math.sign(
      lineDx * (outsidePoint[1] - lineStart[1]) - lineDz * (outsidePoint[0] - lineStart[0]),
    ) || 1
  const side = (point: readonly [number, number]) =>
    outsideSide * (lineDx * (point[1] - lineStart[1]) - lineDz * (point[0] - lineStart[0]))
  const clipped: RoofPlanPolygon = []
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    const currentSide = side(current)
    const nextSide = side(next)
    const currentInside = currentSide <= 1e-7
    const nextInside = nextSide <= 1e-7
    if (currentInside) clipped.push([current[0], current[1]])
    if (currentInside !== nextInside) {
      const ratio = currentSide / (currentSide - nextSide)
      clipped.push([
        current[0] + (next[0] - current[0]) * ratio,
        current[1] + (next[1] - current[1]) * ratio,
      ])
    }
  }
  return clipped
}

function managedShedFootprint(node: RoofSegmentNode): RoofPlanPolygon {
  const trim = normalizeRoofSegmentTrim(node)
  let polygon: RoofPlanPolygon = [
    [-node.width / 2 + trim.left, -node.depth / 2 + trim.back],
    [node.width / 2 - trim.right, -node.depth / 2 + trim.back],
    [node.width / 2 - trim.right, node.depth / 2 - trim.front],
    [-node.width / 2 + trim.left, node.depth / 2 - trim.front],
  ]
  const diagonalTrims = [
    {
      x: trim.frontLeftX,
      z: trim.frontLeftZ,
      start: [-node.width / 2 + trim.left + trim.frontLeftX, node.depth / 2 - trim.front] as [
        number,
        number,
      ],
      end: [-node.width / 2 + trim.left, node.depth / 2 - trim.front - trim.frontLeftZ] as [
        number,
        number,
      ],
      outside: [-node.width / 2 - 1, node.depth / 2 + 1] as [number, number],
    },
    {
      x: trim.frontRightX,
      z: trim.frontRightZ,
      start: [node.width / 2 - trim.right, node.depth / 2 - trim.front - trim.frontRightZ] as [
        number,
        number,
      ],
      end: [node.width / 2 - trim.right - trim.frontRightX, node.depth / 2 - trim.front] as [
        number,
        number,
      ],
      outside: [node.width / 2 + 1, node.depth / 2 + 1] as [number, number],
    },
    {
      x: trim.backLeftX,
      z: trim.backLeftZ,
      start: [-node.width / 2 + trim.left, -node.depth / 2 + trim.back + trim.backLeftZ] as [
        number,
        number,
      ],
      end: [-node.width / 2 + trim.left + trim.backLeftX, -node.depth / 2 + trim.back] as [
        number,
        number,
      ],
      outside: [-node.width / 2 - 1, -node.depth / 2 - 1] as [number, number],
    },
    {
      x: trim.backRightX,
      z: trim.backRightZ,
      start: [node.width / 2 - trim.right - trim.backRightX, -node.depth / 2 + trim.back] as [
        number,
        number,
      ],
      end: [node.width / 2 - trim.right, -node.depth / 2 + trim.back + trim.backRightZ] as [
        number,
        number,
      ],
      outside: [node.width / 2 + 1, -node.depth / 2 - 1] as [number, number],
    },
  ]
  for (const diagonal of diagonalTrims) {
    if (diagonal.x <= 0 || diagonal.z <= 0 || polygon.length < 3) continue
    polygon = clipShedPolygonByLine(polygon, diagonal.start, diagonal.end, diagonal.outside)
  }
  return polygon
}

function buildCustomShedGeometry(
  node: RoofSegmentNode,
  nodes?: Record<string, AnyNode>,
): THREE.BufferGeometry | null {
  if (node.roofType !== 'shed') return null
  const storedPieces = readShedFootprintPieces(node)
  const pieces =
    storedPieces.length > 0
      ? storedPieces
      : node.managedByParent
        ? [managedShedFootprint(node)]
        : []
  const banded = isBandedShedSegment(node) && node.arc
  if (pieces.length === 0) return banded ? buildConcentricBandDeckGeometry(node) : null
  const renderPieces = banded
    ? [...facetBandedRoofPieces(pieces.slice(0, 1), node.width), ...pieces.slice(1)]
    : pieces

  const { cosTheta } = getSegmentSlopeFrame(node)
  const verticalThickness =
    node.deckThickness / Math.max(0.1, cosTheta) + node.shingleThickness * cosTheta
  const geometries: THREE.BufferGeometry[] = []

  for (const polygon of renderPieces) {
    const sanitized = sanitizeRoofPlanPolygon(polygon)
    const signedArea = sanitized.reduce((area, point, index) => {
      const next = sanitized[(index + 1) % sanitized.length]!
      return area + point[0] * next[1] - next[0] * point[1]
    }, 0)
    if (Math.abs(signedArea) <= 1e-9) continue
    const outline = signedArea > 0 ? sanitized : [...sanitized].reverse()
    const bottom = outline.map(
      ([x, z]) => new THREE.Vector3(x, getRoofSegmentSurfaceY(node, x, z), z),
    )
    const triangles = THREE.ShapeUtils.triangulateShape(
      outline.map(([x, z]) => new THREE.Vector2(x, z)),
      [],
    )
    const jointTransitionFaces: THREE.Vector3[][] = []
    const faces: THREE.Vector3[][] = triangles.flatMap((triangle) => {
      const bottomFace = triangle.map((index) => bottom[index]!.clone())
      const normalY = new THREE.Vector3()
        .subVectors(bottomFace[1]!, bottomFace[0]!)
        .cross(new THREE.Vector3().subVectors(bottomFace[2]!, bottomFace[0]!)).y
      if (normalY > 0) bottomFace.reverse()
      const topFace = [...bottomFace]
        .reverse()
        .map((point) => new THREE.Vector3(point.x, point.y + verticalThickness, point.z))
      return [bottomFace, topFace]
    })
    if (!banded) {
      for (let index = 0; index < bottom.length; index++) {
        const next = (index + 1) % bottom.length
        const sideFace = [
          bottom[next]!.clone(),
          bottom[index]!.clone(),
          new THREE.Vector3(
            bottom[index]!.x,
            bottom[index]!.y + verticalThickness,
            bottom[index]!.z,
          ),
          new THREE.Vector3(bottom[next]!.x, bottom[next]!.y + verticalThickness, bottom[next]!.z),
        ]
        const touchesSibling = edgeTouchesSiblingShed(node, outline[index]!, outline[next]!, nodes)
        if (!touchesSibling) {
          faces.push(sideFace)
          continue
        }
        const sibling = findSiblingShedAcrossEdge(node, outline[index]!, outline[next]!, nodes)
        if (sibling && nodes) {
          jointTransitionFaces.push(
            ...buildShedJointTransitionFaces(
              node,
              sibling,
              outline[index]!,
              outline[next]!,
              nodes,
              verticalThickness,
            ),
          )
        }
      }
    }
    geometries.push(
      createGeometryFromFaces(faces, (normal) =>
        normal.y > SHINGLE_SURFACE_EPSILON ? 3 : ROOF_EDGE_MATERIAL_INDEX,
      ),
    )
    if (jointTransitionFaces.length > 0) {
      geometries.push(createGeometryFromFaces(jointTransitionFaces, 3))
    }
  }

  if (banded) {
    const boundaryFaces = unionPolygons(pieces.map((piece) => [...piece])).flatMap((polygon) =>
      facetBandedRoofBoundary(sanitizeRoofPlanPolygon(polygon), node.width).map(([start, end]) => {
        const startBottom = new THREE.Vector3(
          start[0],
          getRoofSegmentSurfaceY(node, start[0], start[1]),
          start[1],
        )
        const endBottom = new THREE.Vector3(
          end[0],
          getRoofSegmentSurfaceY(node, end[0], end[1]),
          end[1],
        )
        return [
          endBottom,
          startBottom,
          new THREE.Vector3(startBottom.x, startBottom.y + verticalThickness, startBottom.z),
          new THREE.Vector3(endBottom.x, endBottom.y + verticalThickness, endBottom.z),
        ]
      }),
    )
    geometries.push(createGeometryFromFaces(boundaryFaces, ROOF_EDGE_MATERIAL_INDEX))
  }

  if (geometries.length === 0) return null
  const merged = mergeGeometriesPreservingGroups(geometries)
  for (const geometry of geometries) geometry.dispose()
  if (!merged) return null
  if (banded) applyBandBendToGeometry(merged, banded)
  merged.computeVertexNormals()
  ensureRenderableGeometryAttributes(merged)
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

function createShedInsetEndPanelGeometry(node: RoofSegmentNode): THREE.BufferGeometry | null {
  if (node.roofType !== 'shed') return null

  const trim = normalizeRoofSegmentTrim(node)
  const openEndSides = readShedOpenEndSides(node)
  const hasCornerSide = (side: -1 | 1) =>
    side < 0
      ? openEndSides.has('left') ||
        (trim.frontLeftX > 0 && trim.frontLeftZ > 0) ||
        (trim.backLeftX > 0 && trim.backLeftZ > 0)
      : (trim.frontRightX > 0 && trim.frontRightZ > 0) ||
        (trim.backRightX > 0 && trim.backRightZ > 0) ||
        openEndSides.has('right')
  const sideInset = Math.min(Math.max(node.wallThickness, 0.05), node.overhang * 0.5, 0.12)
  const fallbackPanelHalfWidth = Math.max(0.01, node.width / 2 - sideInset)
  const sidePanelX = (side: -1 | 1) => resolveShedSideInfillX(node, side, fallbackPanelHalfWidth)
  const { activeRh, tanTheta } = getSegmentSlopeFrame(node)
  const shapeRatios = getRoofShapeRatios({
    gambrelLowerWidthRatio: node.gambrelLowerWidthRatio,
    mansardSteepWidthRatio: node.mansardSteepWidthRatio,
    dutchHipWidthRatio: node.dutchHipWidthRatio,
    dutchHipHeightRatio: node.dutchHipHeightRatio,
    dutchWaistLengthRatio: node.dutchWaistLengthRatio,
    dutchGabletRake: node.dutchGabletRake,
  })
  const wallOuterOffset = node.wallThickness / 2
  const autoDrop = wallOuterOffset * tanTheta
  const wh = Math.max(0.01, node.wallHeight - autoDrop)
  const rh = activeRh > 0 ? activeRh + 2 * autoDrop : activeRh

  const faces = getRoofModuleFaces({
    type: 'shed',
    w: node.width + node.wallThickness,
    d: node.depth + node.wallThickness,
    wh,
    rh,
    baseY: 0,
    insets: {},
    baseW: node.width,
    baseD: node.depth,
    tanTheta,
    shapeRatios,
    dutchTopRakeThickness: node.dutchTopRakeThickness,
  }).map((face) => face.map((point) => new THREE.Vector3(point.x, point.y, point.z)))

  const wallFaces: THREE.Vector3[][] = []
  for (const faceIndex of [6, 8]) {
    const face = faces[faceIndex]
    if (!face) continue
    const faceSide = face.some((point) => point.x < 0) ? -1 : 1
    if (hasCornerSide(faceSide)) continue
    wallFaces.push(
      face.map((point) => {
        const side = point.x < 0 ? -1 : 1
        return new THREE.Vector3(sidePanelX(side), point.y, point.z)
      }),
    )
  }

  if (wallFaces.length === 0) return null
  return createGeometryFromFaces(wallFaces, ROOF_INSET_WALL_MATERIAL_INDEX)
}

function resolveShedSideInfillX(
  node: RoofSegmentNode,
  side: -1 | 1,
  fallbackPanelHalfWidth: number,
): number {
  const sideX = readFiniteNumber(side < 0 ? node.shedSideInfillMinX : node.shedSideInfillMaxX)
  if (sideX !== null) return THREE.MathUtils.clamp(sideX, -node.width / 2, node.width / 2)

  const span = readFiniteNumber(node.shedSideInfillSpan)
  if (span !== null && span > 0) {
    return side * Math.min(span / 2, node.width / 2)
  }

  return side * fallbackPanelHalfWidth
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function addShedInsetEndPanels(
  geometry: THREE.BufferGeometry,
  segments: readonly RoofSegmentNode[],
  applySegmentTransform: boolean,
): THREE.BufferGeometry {
  const shedSegments = segments.filter(
    (segment) => segment.roofType === 'shed' && segment.shedInsetEndPanels,
  )
  if (shedSegments.length === 0) return geometry

  const panelGeometries: THREE.BufferGeometry[] = []

  for (const segment of shedSegments) {
    const panel = createShedInsetEndPanelGeometry(segment)
    if (!panel) continue

    // A banded (curved) deck rotates each span end about the arc center; the flat
    // end panel is at a fixed X, so the bend is a rigid rotation that seats it on
    // the arc end. Applied before any segment transform so it stays segment-local.
    if (isBandedShedSegment(segment) && segment.arc) applyBandBendToGeometry(panel, segment.arc)

    if (applySegmentTransform) {
      _matrix.compose(
        _position.set(segment.position[0], segment.position[1], segment.position[2]),
        _quaternion.setFromAxisAngle(_yAxis, segment.rotation),
        _scale,
      )
      panel.applyMatrix4(_matrix)
    }

    panelGeometries.push(panel)
  }

  if (panelGeometries.length === 0) return geometry

  const merged = mergeGeometriesPreservingGroups([geometry, ...panelGeometries])
  for (const panel of panelGeometries) panel.dispose()
  if (!merged) return geometry

  geometry.dispose()
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
  if (['hip', 'mansard', 'dutch', 'conical'].includes(roofType)) {
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

    if (roofType === 'hip' || roofType === 'conical') {
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
