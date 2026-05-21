import {
  type AnyNode,
  type AnyNodeId,
  type DormerNode,
  type RoofNode,
  type RoofSegmentNode,
  type RoofType,
  sceneRegistry,
  type SkylightNode,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  mergeGeometries,
  mergeVertices,
} from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ADDITION, Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import { computeBoundsTree } from 'three-mesh-bvh'

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
csgEvaluator.attributes = ['position', 'normal', 'uv']

function computeGeometryBoundsTree(geometry: THREE.BufferGeometry) {
  ;(geometry as any).computeBoundsTree = computeBoundsTree
  ;(geometry as any).computeBoundsTree({ maxLeafSize: 10 })
}

function prepareBrushForCSG(brush: Brush) {
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
const MAX_ROOFS_PER_FRAME = 1
const MAX_SEGMENTS_PER_FRAME = 3

// ============================================================================
// ROOF SYSTEM
// ============================================================================

export const RoofSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)
  const rootNodeIds = useScene((state) => state.rootNodeIds)

  useFrame(() => {
    // Clear stale pending updates when the scene is unloaded
    if (rootNodeIds.length === 0) {
      pendingRoofUpdates.clear()
      return
    }

    if (dirtyNodes.size === 0 && pendingRoofUpdates.size === 0) return

    const nodes = useScene.getState().nodes

    // --- Pass 1: Process dirty roof-segments (throttled) ---
    let segmentsProcessed = 0
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node) return

      // A chimney, skylight, solar-panel, dormer, ridge-vent or box-vent
      // edit dirties its host roof so the merged geometry rebuilds. Without
      // this branch, moving/resizing an accessory leaves the merged-roof
      // showing the previous cut shape (stale CSG) once the user exits
      // segment edit mode.
      if (
        node.type === 'chimney' ||
        node.type === 'skylight' ||
        node.type === 'solar-panel' ||
        node.type === 'dormer' ||
        node.type === 'ridge-vent' ||
        node.type === 'box-vent'
      ) {
        const segId = (node as { roofSegmentId?: string }).roofSegmentId
        const seg = segId
          ? (nodes[segId as AnyNodeId] as RoofSegmentNode | undefined)
          : undefined
        if (seg?.parentId) {
          pendingRoofUpdates.add(seg.parentId as AnyNodeId)
        }
        clearDirty(id as AnyNodeId)
        return
      }

      if (node.type === 'roof-segment') {
        const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
        if (mesh) {
          // Only compute expensive individual CSG when the segment is actually rendered
          // (its parent group is visible = the roof is selected for editing)
          const isVisible = mesh.parent?.visible !== false
          if (isVisible && segmentsProcessed < MAX_SEGMENTS_PER_FRAME) {
            updateRoofSegmentGeometry(node as RoofSegmentNode, mesh)
            segmentsProcessed++
          } else if (isVisible) {
            return // Over budget — keep dirty, process next frame
          } else {
            // Just sync transform, skip CSG — the merged roof handles visuals.
            // But replace the initial BoxGeometry once: it has 6 groups (materialIndex 0-5)
            // while roofMaterials only has 4 entries. Three.js raycasts into invisible groups,
            // so MeshBVH hits groups[4].materialIndex → undefined.side → crash.
            if (mesh.geometry.type === 'BoxGeometry') {
              mesh.geometry.dispose()
              const placeholder = new THREE.BufferGeometry()
              placeholder.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
              computeGeometryBoundsTree(placeholder)
              mesh.geometry = placeholder
            }
            mesh.position.set(node.position[0], node.position[1], node.position[2])
            mesh.rotation.y = node.rotation
          }
          clearDirty(id as AnyNodeId)
        } else {
          clearDirty(id as AnyNodeId)
        }
        // Queue the parent roof for a merged geometry update
        if (node.parentId) {
          pendingRoofUpdates.add(node.parentId as AnyNodeId)
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
      if (!node || node.type !== 'roof') {
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

function updateRoofSegmentGeometry(node: RoofSegmentNode, mesh: THREE.Mesh) {
  const newGeo = generateRoofSegmentGeometry(node)

  mesh.geometry.dispose()
  mesh.geometry = newGeo
  computeGeometryBoundsTree(newGeo)

  mesh.position.set(node.position[0], node.position[1], node.position[2])
  mesh.rotation.y = node.rotation
}

function updateMergedRoofGeometry(
  roofNode: RoofNode,
  group: THREE.Group,
  nodes: Record<string, AnyNode>,
) {
  const mergedMesh = group.getObjectByName('merged-roof') as THREE.Mesh | undefined
  if (!mergedMesh) return

  const children = (roofNode.children ?? [])
    .map((id) => nodes[id] as RoofSegmentNode)
    .filter(Boolean)

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

  for (const child of children) {
    const brushes = getRoofSegmentBrushes(child)
    if (!brushes) continue

    // Per-child cuts in SEGMENT-LOCAL space: subtract every skylight on this
    // segment from shin/deck/wall before we accumulate. Mirrors roof-system
    // v1 — the cut brush is built in segment-local using the analytical
    // surface frame, then carved out before the segment transform stacks on.
    let workingShin = brushes.shinSlab
    let workingDeck = brushes.deckSlab
    let workingWall = brushes.wallBrush
    for (const childElemId of child.children ?? []) {
      const childElem = nodes[childElemId as AnyNodeId]
      if (!childElem) continue
      const meta =
        typeof childElem.metadata === 'object' && childElem.metadata !== null
          ? (childElem.metadata as Record<string, unknown>)
          : undefined
      if (meta?.isTransient) continue

      // Build a cut brush in segment-local for either a skylight or a
      // dormer. Both are subtracted from shin / deck / wall so the
      // host roof gets a clean hole where the accessory pokes through.
      let cut: Brush | null = null
      if (childElem.type === 'skylight') {
        cut = buildSkylightCutBrush(childElem as SkylightNode, child)
      } else if (childElem.type === 'dormer') {
        cut = buildDormerCutBrush(childElem as DormerNode)
      }
      if (!cut) continue

      try {
        const nextShin = csgEvaluator.evaluate(workingShin, cut, SUBTRACTION) as Brush
        workingShin.geometry.dispose()
        prepareBrushForCSG(nextShin)
        workingShin = nextShin

        const nextDeck = csgEvaluator.evaluate(workingDeck, cut, SUBTRACTION) as Brush
        workingDeck.geometry.dispose()
        prepareBrushForCSG(nextDeck)
        workingDeck = nextDeck

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

    _matrix.compose(
      _position.set(child.position[0], child.position[1], child.position[2]),
      _quaternion.setFromAxisAngle(_yAxis, child.rotation),
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
      const finalShinTrimmed = csgEvaluator.evaluate(totalShinSlab, totalInner, SUBTRACTION)
      const finalDeckTrimmed = csgEvaluator.evaluate(totalDeckSlab, totalInner, SUBTRACTION)
      const finalWallTrimmed = csgEvaluator.evaluate(totalWall, totalInner, SUBTRACTION)

      const shinDeck = csgEvaluator.evaluate(finalShinTrimmed, finalDeckTrimmed, ADDITION)
      const combined = csgEvaluator.evaluate(shinDeck, finalWallTrimmed, ADDITION)

      const resultGeo = csgGeometry(combined)

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

      const uvReadyGeo = createRoofUvGeometry(resultGeo)
      uvReadyGeo.computeVertexNormals()
      ensureUv2Attribute(uvReadyGeo)
      mergedMesh.geometry.dispose()
      mergedMesh.geometry = uvReadyGeo

      finalShinTrimmed.geometry.dispose()
      finalDeckTrimmed.geometry.dispose()
      finalWallTrimmed.geometry.dispose()
      shinDeck.geometry.dispose()
    } catch (e) {
      console.error('Merged roof CSG failed:', e)
    }

    totalShinSlab.geometry.dispose()
    totalDeckSlab.geometry.dispose()
    totalWall.geometry.dispose()
    totalInner.geometry.dispose()
  }
}

const dummyMats: [
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
const ROOF_MATERIAL_SLOT_COUNT = 4

function mapRoofGroupMaterialIndex(
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
  return ((groupMaterialIndex % ROOF_MATERIAL_SLOT_COUNT) + ROOF_MATERIAL_SLOT_COUNT) %
    ROOF_MATERIAL_SLOT_COUNT
}

function normalizeRoofMaterialIndex(materialIndex: number | undefined): number {
  if (materialIndex === undefined || !Number.isFinite(materialIndex)) return 0
  const normalized = Math.trunc(materialIndex)
  if (normalized < 0 || normalized >= ROOF_MATERIAL_SLOT_COUNT) return 0
  return normalized
}

const SHINGLE_SURFACE_EPSILON = 0.02
const RAKE_FACE_NORMAL_EPSILON = 0.3
const RAKE_FACE_ALIGNMENT_EPSILON = 0.35

/**
 * Generate complete hollow-shell geometry for a roof segment.
 * Ports the prototype's CSG approach using three-bvh-csg.
 */
export function getRoofSegmentBrushes(
  node: RoofSegmentNode,
): { deckSlab: Brush; shinSlab: Brush; wallBrush: Brush; innerBrush: Brush } | null {
  const {
    roofType,
    width,
    depth,
    wallHeight,
    roofHeight,
    wallThickness,
    deckThickness,
    overhang,
    shingleThickness,
  } = node

  const activeRh = roofType === 'flat' ? 0 : roofHeight

  let run = Math.min(width, depth) / 2
  let rise = activeRh
  if (roofType === 'shed') {
    run = depth
  }
  if (roofType === 'gable') {
    run = depth / 2
  }
  if (roofType === 'gambrel') {
    run = depth / 4
    rise = activeRh * 0.6
  }
  if (roofType === 'mansard') {
    run = Math.min(width, depth) * 0.15
    rise = activeRh * 0.7
  }
  if (roofType === 'dutch') {
    run = Math.min(width, depth) * 0.25
    rise = activeRh * 0.5
  }

  const tanTheta = run > 0 ? rise / run : 0
  const cosTheta = Math.cos(Math.atan2(rise, run)) || 1
  const sinTheta = Math.sin(Math.atan2(rise, run)) || 0

  const verticalRt = activeRh > 0 ? deckThickness / cosTheta : deckThickness
  const baseI = Math.min(width, depth) * 0.25

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
    const whV = wallHeight - autoDrop + vOffset

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

    const faces = getModuleFaces(
      roofType,
      wV,
      dV,
      whV,
      rhV,
      safeBaseY,
      { dutchI: structuralI },
      width,
      depth,
      tanTheta,
    )
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

  const getInsets = (wh: number, bY: number, isVoid: boolean, brushW: number, brushD: number) => {
    let inset = (wh - bY) * tanTheta
    const maxSafeInset = Math.min(brushW, brushD) / 2 - 0.005
    if (inset > maxSafeInset) {
      inset = maxSafeInset
    }

    let iF = 0,
      iB = 0,
      iL = 0,
      iR = 0
    if (['hip', 'mansard', 'dutch'].includes(roofType)) {
      iF = inset
      iB = inset
      iL = inset
      iR = inset
    } else if (['gable', 'gambrel'].includes(roofType)) {
      iF = inset
      iB = inset
    } else if (roofType === 'shed') {
      iF = inset
    }

    let structuralI = baseI
    if (isVoid) {
      structuralI += shingleThickness
    }
    return { iF, iB, iL, iR, dutchI: structuralI }
  }

  const insetsBot = getInsets(shinBotWh, botBaseY, true, shinBotW, shinBotD)
  const insetsTop = getInsets(shinTopWh, topBaseY, false, shinTopW, shinTopD)

  const botFaces = getModuleFaces(
    roofType,
    shinBotW,
    shinBotD,
    shinBotWh,
    shinBotRh,
    botBaseY,
    insetsBot,
    width,
    depth,
    tanTheta,
  )
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
  )

  const shinBotGeo = createGeometryFromFaces(botFaces, 1)
  const shinTopGeo = createGeometryFromFaces(topFaces, (normal) =>
    normal.y > SHINGLE_SURFACE_EPSILON ? 3 : 1,
  )

  if (transZ !== 0) {
    shinTopGeo.translate(0, 0, transZ)
  }

  const toBrush = (geo: THREE.BufferGeometry): Brush | null => {
    if (!geo?.attributes.position || geo.attributes.position.count === 0) return null
    if (!geo.index) return null
    // Strip zero-count groups — three-bvh-csg crashes with groupIndices[i] undefined
    // when a group exists but covers no triangles (can happen after mergeVertices)
    geo.groups = geo.groups.filter((g) => g.count > 0)
    if (geo.groups.length === 0) return null
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
      const shinSlab = csgEvaluator.evaluate(shinTopBrush, shinBotBrush, SUBTRACTION)

      deckTopBrush.geometry.dispose()
      deckBotBrush.geometry.dispose()
      shinTopBrush.geometry.dispose()
      shinBotBrush.geometry.dispose()

      return { deckSlab, shinSlab, wallBrush, innerBrush }
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

  return null
}

export function generateRoofSegmentGeometry(node: RoofSegmentNode): THREE.BufferGeometry {
  const brushes = getRoofSegmentBrushes(node)
  if (!brushes) {
    // Fallback: simple box
    return new THREE.BoxGeometry(node.width, node.wallHeight, node.depth)
  }

  const { deckSlab, shinSlab, wallBrush, innerBrush } = brushes
  let resultGeo = new THREE.BufferGeometry()

  try {
    const hollowWall = csgEvaluator.evaluate(wallBrush, innerBrush, SUBTRACTION)
    const shinDeck = csgEvaluator.evaluate(shinSlab, deckSlab, ADDITION)
    const combined = csgEvaluator.evaluate(shinDeck, hollowWall, ADDITION)

    resultGeo = csgGeometry(combined)

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

  const uvReadyGeo = createRoofUvGeometry(resultGeo)
  uvReadyGeo.computeVertexNormals()
  ensureUv2Attribute(uvReadyGeo)
  return uvReadyGeo
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

function remapRoofShellFaces(geometry: THREE.BufferGeometry, node: RoofSegmentNode) {
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

        if (normal.y > SHINGLE_SURFACE_EPSILON) {
          materialIndex = 3
        } else if (isRakeFace(node, geometry, centroid, normal)) {
          materialIndex = 0
        } else {
          materialIndex = 1
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
  if (node.roofType === 'dutch') return node.width >= node.depth ? 'x' : 'z'
  return null
}

/**
 * Generates faces for a roof module volume.
 * Supports: hip, gable, shed, gambrel, dutch, mansard, flat.
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
    const mz = (baseD / 2) * 0.5
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
    const i = Math.min(baseW, baseD) * 0.15
    const mh = wh + i * (tanTheta || 0)

    const m1 = v(-w / 2 + i, mh, d / 2 - i)
    const m2 = v(w / 2 - i, mh, d / 2 - i)
    const m3 = v(w / 2 - i, mh, -d / 2 + i)
    const m4 = v(-w / 2 + i, mh, -d / 2 + i)
    const t1 = v(-w / 2 + i * 2, h, d / 2 - i * 2)
    const t2 = v(w / 2 - i * 2, h, d / 2 - i * 2)
    const t3 = v(w / 2 - i * 2, h, -d / 2 + i * 2)
    const t4 = v(-w / 2 + i * 2, h, -d / 2 + i * 2)
    if (w - i * 4 <= 0.01 || d - i * 4 <= 0.01) {
      if (w >= d) {
        const r1 = v(-w / 2 + d / 2, h, 0)
        const r2 = v(w / 2 - d / 2, h, 0)
        faces.push([e4, e1, r1], [e2, e3, r2], [e1, e2, r2, r1], [e3, e4, r1, r2])
      } else {
        const r1 = v(0, h, d / 2 - w / 2)
        const r2 = v(0, h, -d / 2 + w / 2)
        faces.push([e1, e2, r1], [e3, e4, r2], [e2, e3, r2, r1], [e4, e1, r1, r2])
      }
    } else {
      faces.push(
        [t1, t2, t3, t4],
        [e1, e2, m2, m1],
        [e2, e3, m3, m2],
        [e3, e4, m4, m3],
        [e4, e1, m1, m4],
        [m1, m2, t2, t1],
        [m2, m3, t3, t2],
        [m3, m4, t4, t3],
        [m4, m1, t1, t4],
      )
    }
  } else if (type === 'dutch') {
    const i = insets.dutchI !== undefined ? insets.dutchI : Math.min(baseW, baseD) * 0.25
    const mh = wh + i * (tanTheta || 0)

    if (w >= d) {
      const m1 = v(-w / 2 + i, mh, d / 2 - i)
      const m2 = v(w / 2 - i, mh, d / 2 - i)
      const m3 = v(w / 2 - i, mh, -d / 2 + i)
      const m4 = v(-w / 2 + i, mh, -d / 2 + i)
      const r1 = v(-w / 2 + i, h, 0)
      const r2 = v(w / 2 - i, h, 0)

      faces.push(
        [e1, e2, m2, m1],
        [e2, e3, m3, m2],
        [e3, e4, m4, m3],
        [e4, e1, m1, m4],
        [m4, m1, r1],
        [m2, m3, r2],
        [m1, m2, r2, r1],
        [m3, m4, r1, r2],
      )
    } else {
      const m1 = v(-w / 2 + i, mh, d / 2 - i)
      const m2 = v(w / 2 - i, mh, d / 2 - i)
      const m3 = v(w / 2 - i, mh, -d / 2 + i)
      const m4 = v(-w / 2 + i, mh, -d / 2 + i)
      const r1 = v(0, h, d / 2 - i)
      const r2 = v(0, h, -d / 2 + i)

      faces.push(
        [e1, e2, m2, m1],
        [e2, e3, m3, m2],
        [e3, e4, m4, m3],
        [e4, e1, m1, m4],
        [m1, m2, r1],
        [m3, m4, r2],
        [m2, m3, r2, r1],
        [m4, m1, r1, r2],
      )
    }
  }

  return faces
}

/**
 * Converts an array of face polygons into a BufferGeometry.
 * Each face is triangulated via fan triangulation.
 */
function createGeometryFromFaces(
  faces: THREE.Vector3[][],
  matRule: number | ((normal: THREE.Vector3) => number) | null = null,
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
    let slopeAlignedDown: THREE.Vector3 | null = null
    let slopeAlignedAcross: THREE.Vector3 | null = null
    let slopeAlignedVOrigin = 0

    if (normal.y > SHINGLE_SURFACE_EPSILON) {
      _uvDownSlope.copy(_uvWorldDown).projectOnPlane(normal)
      if (_uvDownSlope.lengthSq() > 1e-8) {
        _uvDownSlope.normalize()
        _uvAcrossSlope.crossVectors(_uvDownSlope, normal).normalize()

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

  ensureUv2Attribute(mergedGeo)
  return mergedGeo
}

function pushRoofUv(uvs: number[], point: THREE.Vector3, normal: THREE.Vector3) {
  _uvFaceNormal.copy(normal).normalize()

  const absX = Math.abs(_uvFaceNormal.x)
  const absY = Math.abs(_uvFaceNormal.y)
  const absZ = Math.abs(_uvFaceNormal.z)

  if (absY >= absX && absY >= absZ) {
    uvs.push(point.x, point.z)
    return
  }

  if (_uvFaceNormal.y > SHINGLE_SURFACE_EPSILON) {
    _uvDownSlope.copy(_uvWorldDown).projectOnPlane(_uvFaceNormal)
    if (_uvDownSlope.lengthSq() > 1e-8) {
      _uvDownSlope.normalize()
      _uvAcrossSlope.crossVectors(_uvDownSlope, _uvFaceNormal).normalize()
      uvs.push(point.dot(_uvAcrossSlope), point.dot(_uvDownSlope))
      return
    }
  }

  if (absX >= absZ) {
    uvs.push(_uvFaceNormal.x >= 0 ? point.z : -point.z, -point.y)
    return
  }

  uvs.push(_uvFaceNormal.z >= 0 ? point.x : -point.x, -point.y)
}

function createRoofUvGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute('position')
  if (!position) return geometry

  const index = geometry.getIndex()
  const sourceCount = index?.count ?? position.count
  const positions: number[] = []
  const uvs: number[] = []
  const groups: THREE.BufferGeometry['groups'] = []
  const sourceGroups =
    geometry.groups.length > 0
      ? geometry.groups
      : [{ start: 0, count: sourceCount, materialIndex: 0 }]

  for (const group of sourceGroups) {
    const groupStart = positions.length / 3
    let groupVertexCount = 0
    const end = Math.min(sourceCount, group.start + group.count)

    for (let offset = group.start; offset + 2 < end; offset += 3) {
      const ia = index?.getX(offset) ?? offset
      const ib = index?.getX(offset + 1) ?? offset + 1
      const ic = index?.getX(offset + 2) ?? offset + 2

      _surfaceV0.fromBufferAttribute(position, ia)
      _surfaceV1.fromBufferAttribute(position, ib)
      _surfaceV2.fromBufferAttribute(position, ic)
      _tmpVec3A.subVectors(_surfaceV1, _surfaceV0)
      _tmpVec3B.subVectors(_surfaceV2, _surfaceV0)
      _surfaceFaceNormal.crossVectors(_tmpVec3A, _tmpVec3B).normalize()

      positions.push(
        _surfaceV0.x,
        _surfaceV0.y,
        _surfaceV0.z,
        _surfaceV1.x,
        _surfaceV1.y,
        _surfaceV1.z,
        _surfaceV2.x,
        _surfaceV2.y,
        _surfaceV2.z,
      )
      pushRoofUv(uvs, _surfaceV0, _surfaceFaceNormal)
      pushRoofUv(uvs, _surfaceV1, _surfaceFaceNormal)
      pushRoofUv(uvs, _surfaceV2, _surfaceFaceNormal)
      groupVertexCount += 3
    }

    if (groupVertexCount > 0) {
      groups.push({
        start: groupStart,
        count: groupVertexCount,
        materialIndex: normalizeRoofMaterialIndex(group.materialIndex),
      })
    }
  }

  const nextGeometry = new THREE.BufferGeometry()
  nextGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  nextGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  for (const group of groups) {
    nextGeometry.addGroup(group.start, group.count, group.materialIndex)
  }
  geometry.dispose()
  return nextGeometry
}

function ensureUv2Attribute(geometry: THREE.BufferGeometry) {
  const uv = geometry.getAttribute('uv')
  if (!uv) return

  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(Array.from(uv.array), 2))
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
    roofHeight,
    wallThickness,
    deckThickness,
    overhang,
    shingleThickness,
  } = segment

  const activeRh = roofType === 'flat' ? 0 : roofHeight

  if (roofType === 'flat' || activeRh === 0) {
    return {
      point: new THREE.Vector3(lx, wallHeight + deckThickness + shingleThickness, lz),
      normal: new THREE.Vector3(0, 1, 0),
    }
  }

  let run = Math.min(width, depth) / 2
  let rise = activeRh
  if (roofType === 'shed') {
    run = depth
  }
  if (roofType === 'gable') {
    run = depth / 2
  }
  if (roofType === 'gambrel') {
    run = depth / 4
    rise = activeRh * 0.6
  }
  if (roofType === 'mansard') {
    run = Math.min(width, depth) * 0.15
    rise = activeRh * 0.7
  }
  if (roofType === 'dutch') {
    run = Math.min(width, depth) * 0.25
    rise = activeRh * 0.5
  }

  const tanTheta = run > 0 ? rise / run : 0
  const cosTheta = Math.cos(Math.atan2(rise, run)) || 1
  const sinTheta = Math.sin(Math.atan2(rise, run)) || 0

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

    let structuralI = baseI
    if (isVoid) {
      structuralI += shingleThickness
    }

    return { iF, iB, iL, iR, dutchI: structuralI }
  }

  const insetsTop = getInsets(shinTopWh, topBaseY, false, shinTopW, shinTopD)
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

export function buildSkylightCutBrush(
  skylight: SkylightNode,
  segment: RoofSegmentNode,
): Brush | null {
  const inflate = Math.max(0, skylight.cutoutOffset ?? 0.01)
  const w = Math.max(0.05, skylight.width + 2 * skylight.frameThickness + 2 * inflate)
  const d = Math.max(0.05, skylight.height + 2 * skylight.frameThickness + 2 * inflate)

  const lx = skylight.position[0]
  const lz = skylight.position[2]

  const surfaceFrame = getRoofOuterSurfaceFrameAtPoint(segment, lx, lz)
  const surfaceY = surfaceFrame.point.y
  const normal = surfaceFrame.normal

  // eslint-disable-next-line no-console
  console.log('[skylight-cut]', skylight.id, {
    lx,
    lz,
    surfaceY,
    surfacePointXZ: [surfaceFrame.point.x, surfaceFrame.point.z],
    normal: normal.toArray(),
    skyRotation: skylight.rotation,
    segPos: segment.position,
    segRot: segment.rotation,
    segRoofType: segment.roofType,
    segWHD: [segment.width, segment.depth],
    cutW: w,
    cutD: d,
  })

  const h = 2.0
  const geo = new THREE.BoxGeometry(w, h, d)

  // Yaw in the box's own (un-tilted) frame so it stays a rotation
  // about the surface normal once tilted. Yawing after the tilt twists
  // the cutout around world-Y on sloped roofs.
  if (Math.abs(skylight.rotation) > 1e-4) {
    geo.rotateY(skylight.rotation)
  }

  if (normal.y < 0.9999) {
    // Match the renderer's basis construction (right = up × normal, forward
    // = right × normal). `setFromUnitVectors` would yaw the cut around the
    // normal by ~90° on hip side faces relative to the frame, leaving a
    // visibly rotated hole.
    const up = new THREE.Vector3(0, 1, 0)
    const right = new THREE.Vector3().crossVectors(up, normal)
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
    else right.normalize()
    const forward = new THREE.Vector3().crossVectors(right, normal).normalize()
    const basis = new THREE.Matrix4().makeBasis(right, normal, forward)
    const quat = new THREE.Quaternion().setFromRotationMatrix(basis)
    geo.applyQuaternion(quat)
  }

  geo.translate(lx, surfaceY, lz)

  // Weld near-coincident vertices. Without this, `applyQuaternion` on a
  // BoxGeometry can leave the half-edge structure that three-bvh-csg
  // depends on in a state where subtractions silently no-op on certain
  // tilt angles (notably hip *short* faces, where the cut box ends up
  // rotated ~90° about the surface normal vs. the long-face case).
  // Mirrors what the chimney's `trimChimneyBodyAgainstRoof` does.
  const merged = mergeVertices(geo, 1e-4)
  const idxCount = merged.getIndex()?.count ?? 0
  merged.clearGroups()
  merged.addGroup(0, idxCount, 0)
  geo.dispose()

  computeGeometryBoundsTree(merged)
  const brush = new Brush(merged, dummyMats[0])
  brush.updateMatrixWorld()
  return brush
}

// =============================================================================
// Dormer geometry — ported from the legacy `roof-system` branch. The dormer
// reuses `getRoofSegmentBrushes` to build its own walls+roof, then CSG-trims
// against the host segment so the part of the dormer buried in the roof is
// hidden. Window openings are cut on each exposed gable face.
// =============================================================================

// Legacy default for the hung-wall (skirt) height. Used as a fallback
// when `dormer.wallSkirtHeight` is undefined (e.g. old saved scenes).
const DORMER_DROP_BELOW = 2
function dormerSkirtHeight(dormer: DormerNode): number {
  return Math.max(0.05, dormer.wallSkirtHeight ?? DORMER_DROP_BELOW)
}
export const DORMER_GABLE_MATERIAL_INDEX = 4

/**
 * Fallback geometry used when CSG cannot run (missing host brushes,
 * thrown exception, degenerate inputs). Builds a simple gable
 * silhouette (rectangular body + triangular gable extruded along the
 * dormer's depth) in dormer-mesh-local. The wall sits at material slot
 * 0 and the roof at slot 3 so it picks up the same material array the
 * renderer passes for the CSG output.
 */
function buildDormerFallbackGeometry(dormer: DormerNode): THREE.BufferGeometry {
  const w = Math.max(0.05, dormer.width)
  const d = Math.max(0.05, dormer.depth)
  const wallH = Math.max(0.05, dormer.height)
  const roofH = Math.max(0, dormer.roofHeight)
  const skirt = dormerSkirtHeight(dormer)

  // Body box: foot at y = -skirt, top at y = wallH.
  const body = new THREE.BoxGeometry(w, wallH + skirt, d)
  body.translate(0, (wallH - skirt) / 2, 0)

  // Roof: extruded triangle from eave (y = wallH) to peak (y = wallH + roofH).
  // Apex points along +Y, base spans the width. Extrude along Z (depth).
  const roofShape = new THREE.Shape()
  roofShape.moveTo(-w / 2, 0)
  roofShape.lineTo(w / 2, 0)
  roofShape.lineTo(0, roofH)
  roofShape.lineTo(-w / 2, 0)
  const roof = new THREE.ExtrudeGeometry(roofShape, { depth: d, bevelEnabled: false })
  roof.translate(0, wallH, -d / 2)

  // Tag each as a single group: body → slot 0 (wall), roof → slot 3 (roof).
  const bIdx = body.getIndex()?.count ?? 0
  body.clearGroups()
  body.addGroup(0, bIdx, 0)
  const rIdx = roof.getIndex()?.count ?? 0
  roof.clearGroups()
  roof.addGroup(0, rIdx, 3)

  const merged = mergeGeometries([body, roof], true) ?? body
  body.dispose()
  roof.dispose()
  if (!merged.getAttribute('normal')) merged.computeVertexNormals()
  return merged
}

function createDormerArchShape(w: number, h: number, archHeight: number): THREE.Shape {
  const hw = w / 2
  const hh = h / 2
  const clampedArch = Math.min(Math.max(archHeight, 0.01), Math.max(h, 0.01))
  const springY = hh - clampedArch
  const segments = 32

  const shape = new THREE.Shape()
  shape.moveTo(-hw, -hh)
  shape.lineTo(hw, -hh)
  shape.lineTo(hw, springY)
  for (let i = 1; i <= segments; i++) {
    const x = hw + (-hw - hw) * (i / segments)
    const t = Math.min(Math.abs(x) / hw, 1)
    const y = springY + clampedArch * Math.sqrt(Math.max(1 - t * t, 0))
    shape.lineTo(x, y)
  }
  shape.lineTo(-hw, -hh)
  shape.closePath()
  return shape
}

function normalizeDormerCornerRadii(
  radii: [number, number, number, number],
  w: number,
  h: number,
): [number, number, number, number] {
  const r = radii.map((v) => Math.max(v, 0)) as [number, number, number, number]
  const scale = Math.min(
    1,
    Math.max(w, 0) / Math.max(r[0] + r[1], 1e-6),
    Math.max(w, 0) / Math.max(r[3] + r[2], 1e-6),
    Math.max(h, 0) / Math.max(r[0] + r[3], 1e-6),
    Math.max(h, 0) / Math.max(r[1] + r[2], 1e-6),
  )
  if (scale >= 1) return r
  return r.map((v) => v * scale) as [number, number, number, number]
}

function createDormerRoundedShape(
  w: number,
  h: number,
  radii: [number, number, number, number],
): THREE.Shape {
  const hw = w / 2
  const hh = h / 2
  const [tl, tr, br, bl] = normalizeDormerCornerRadii(radii, w, h)

  const shape = new THREE.Shape()
  shape.moveTo(-hw + bl, -hh)
  shape.lineTo(hw - br, -hh)
  if (br > 0) shape.absarc(hw - br, -hh + br, br, -Math.PI / 2, 0, false)
  else shape.lineTo(hw, -hh)
  shape.lineTo(hw, hh - tr)
  if (tr > 0) shape.absarc(hw - tr, hh - tr, tr, 0, Math.PI / 2, false)
  else shape.lineTo(hw, hh)
  shape.lineTo(-hw + tl, hh)
  if (tl > 0) shape.absarc(-hw + tl, hh - tl, tl, Math.PI / 2, Math.PI, false)
  else shape.lineTo(-hw, hh)
  shape.lineTo(-hw, -hh + bl)
  if (bl > 0) shape.absarc(-hw + bl, -hh + bl, bl, Math.PI, (3 * Math.PI) / 2, false)
  else shape.lineTo(-hw, -hh)
  shape.closePath()
  return shape
}

function resolveDormerRadii(
  dormer: DormerNode,
  w: number,
  h: number,
): [number, number, number, number] {
  if ((dormer.windowRadiusMode ?? 'all') === 'individual') {
    return normalizeDormerCornerRadii(
      dormer.windowCornerRadii ?? [0.15, 0.15, 0.15, 0.15],
      w,
      h,
    )
  }
  const r = dormer.windowCornerRadius ?? 0.15
  return normalizeDormerCornerRadii([r, r, r, r], w, h)
}

function createDormerWindowCutGeometry(
  dormer: DormerNode,
  w: number,
  h: number,
  depth: number,
): THREE.BufferGeometry {
  const shape = dormer.windowShape ?? 'rectangle'
  if (shape === 'arch') {
    const s = createDormerArchShape(w, h, dormer.windowArchHeight ?? 0.35)
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 24 })
    geo.translate(0, 0, -depth / 2)
    return geo
  }
  if (shape === 'rounded') {
    const radii = resolveDormerRadii(dormer, w, h)
    const s = createDormerRoundedShape(w, h, radii)
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 24 })
    geo.translate(0, 0, -depth / 2)
    return geo
  }
  return new THREE.BoxGeometry(w, h, depth)
}

/**
 * Which faces of a dormer are exposed (not fully buried in the host
 * roof). "front" = mesh-local +Z, "back" = mesh-local −Z (after the
 * +π/2 yaw bake for non-shed roofs). A face is exposed when the
 * dormer's total wall top exceeds the host roof surface at that face's
 * Z position.
 */
export function getDormerExposedFaces(
  dormer: DormerNode,
  hostSegment: RoofSegmentNode,
): { front: boolean; back: boolean } {
  const halfDepth = dormer.depth / 2
  const dormerZ = dormer.position[2] ?? 0
  const dormerY = dormer.position[1] ?? 0
  const rot = dormer.rotation ?? 0

  // Gable-face centres in segment-local Z (accounts for dormer yaw).
  const frontZ = dormerZ + halfDepth * Math.cos(rot)
  const backZ = dormerZ - halfDepth * Math.cos(rot)

  const dormerWallTop = dormerY + dormer.height

  const hostWh = hostSegment.wallHeight ?? 0.5
  const hostRh = hostSegment.roofType === 'flat' ? 0 : hostSegment.roofHeight ?? 2.5
  const hostDepth = hostSegment.depth ?? 4

  const roofHeightAtZ = (segZ: number): number => {
    const hostType = hostSegment.roofType ?? 'gable'
    if (hostType === 'flat') return hostWh
    if (hostType === 'shed') {
      const t = Math.max(0, Math.min(1, (segZ + hostDepth / 2) / Math.max(hostDepth, 0.01)))
      return hostWh + hostRh * (1 - t)
    }
    const halfD = Math.max(hostDepth / 2, 0.01)
    const t = Math.max(0, Math.min(1, Math.abs(segZ) / halfD))
    return hostWh + hostRh * (1 - t)
  }

  // A face is "exposed" only if the dormer's wall actually pokes above
  // the host roof there by a meaningful amount — otherwise the wall is
  // CSG-buried and any window we render at that face will hover with
  // no wall behind it. A 5cm threshold suppresses the borderline-cases
  // where the wall top is essentially level with the slope.
  const minPokeOut = 0.05
  return {
    front: dormerWallTop - roofHeightAtZ(frontZ) > minPokeOut,
    back: dormerWallTop - roofHeightAtZ(backZ) > minPokeOut,
  }
}

/**
 * Computed dimensions for the window opening on a dormer's gable face.
 * The skirt (the wall extension below the eave used for CSG-trim) is
 * `DORMER_DROP_BELOW` tall, so the window sits within that band.
 */
export function getDormerSkirtWindowDims(dormer: DormerNode): {
  width: number
  height: number
  centerY: number
  offsetX: number
} {
  const skirtH = dormerSkirtHeight(dormer)
  const maxW = Math.max(dormer.width - 0.1, 0.1)
  const maxH = Math.max(skirtH - 0.1, 0.1)
  const width = Math.min(Math.max(dormer.windowWidth ?? 1.2, 0.1), maxW)
  const height = Math.min(Math.max(dormer.windowHeight ?? 1.2, 0.1), maxH)
  const offsetX = dormer.windowOffsetX ?? 0
  const offsetY = dormer.windowOffsetY ?? 0
  const centerY = -(skirtH / 2) + offsetY
  return { width, height, centerY, offsetX }
}

/**
 * Build the trimmed dormer geometry hosted on a roof segment. The
 * dormer's own walls+roof are generated via `getRoofSegmentBrushes`
 * on a virtual segment, then the host segment's filled solid is
 * CSG-subtracted in dormer-mesh-local space. Window openings are then
 * subtracted on each exposed gable face.
 */
export function generateDormerGeometry(
  dormer: DormerNode,
  hostSegment: RoofSegmentNode,
): THREE.BufferGeometry {
  const isShed = dormer.roofType === 'shed'
  const yawBake = isShed ? 0 : Math.PI / 2
  const segWidth = isShed ? dormer.width : dormer.depth
  const segDepth = isShed ? dormer.depth : dormer.width
  const skirt = dormerSkirtHeight(dormer)

  const virtualSegment: RoofSegmentNode = {
    object: 'node',
    id: `rseg_dormer_${dormer.id}` as RoofSegmentNode['id'],
    type: 'roof-segment',
    parentId: null,
    visible: true,
    metadata: null,
    children: [],
    position: [0, 0, 0],
    rotation: 0,
    roofType: dormer.roofType,
    width: Math.max(0.05, segWidth),
    depth: Math.max(0.05, segDepth),
    wallHeight: Math.max(0.05, dormer.height) + skirt,
    roofHeight: Math.max(0, dormer.roofHeight),
    wallThickness: 0.05,
    deckThickness: 0.04,
    overhang: 0.08,
    shingleThickness: 0.02,
  }

  const dormerBrushes = getRoofSegmentBrushes(virtualSegment)
  if (!dormerBrushes) {
    // biome-ignore lint/suspicious/noConsole: keep diagnostic — fallback path.
    console.warn('[dormer] getRoofSegmentBrushes returned null; using fallback silhouette.')
    return buildDormerFallbackGeometry(dormer)
  }

  let resultGeo = new THREE.BufferGeometry()
  let dormerSolid: Brush | null = null
  let hostSolid: Brush | null = null

  try {
    const hollowWall = csgEvaluator.evaluate(
      dormerBrushes.wallBrush,
      dormerBrushes.innerBrush,
      SUBTRACTION,
    ) as Brush
    const shinDeck = csgEvaluator.evaluate(
      dormerBrushes.shinSlab,
      dormerBrushes.deckSlab,
      ADDITION,
    ) as Brush
    dormerSolid = csgEvaluator.evaluate(shinDeck, hollowWall, ADDITION) as Brush
    hollowWall.geometry.dispose()
    shinDeck.geometry.dispose()

    const bakeMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(0, -skirt, 0),
      new THREE.Quaternion().setFromAxisAngle(_yAxis, yawBake),
      _scale,
    )
    csgGeometry(dormerSolid).applyMatrix4(bakeMatrix)
    prepareBrushForCSG(dormerSolid)

    const hostBrushes = getRoofSegmentBrushes(hostSegment)
    if (hostBrushes) {
      const wallPlusDeck = csgEvaluator.evaluate(
        hostBrushes.wallBrush,
        hostBrushes.deckSlab,
        ADDITION,
      ) as Brush
      hostSolid = csgEvaluator.evaluate(wallPlusDeck, hostBrushes.shinSlab, ADDITION) as Brush
      wallPlusDeck.geometry.dispose()
      hostBrushes.deckSlab.geometry.dispose()
      hostBrushes.shinSlab.geometry.dispose()
      hostBrushes.wallBrush.geometry.dispose()
      hostBrushes.innerBrush.geometry.dispose()

      // Union a deep ground box covering the host footprint so the
      // dormer's skirt (extending below y=0) has something to subtract.
      const groundMargin = Math.max(hostSegment.width, hostSegment.depth) * 2 + 4
      const groundBoxGeo = new THREE.BoxGeometry(groundMargin, 100, groundMargin)
      groundBoxGeo.translate(0, -50, 0)
      const indexCount = groundBoxGeo.getIndex()?.count ?? 0
      groundBoxGeo.clearGroups()
      groundBoxGeo.addGroup(0, indexCount, 0)
      computeGeometryBoundsTree(groundBoxGeo)
      const groundBrush = new Brush(groundBoxGeo, dummyMats[0])
      groundBrush.updateMatrixWorld()
      const fullTrim = csgEvaluator.evaluate(hostSolid, groundBrush, ADDITION) as Brush
      hostSolid.geometry.dispose()
      groundBrush.geometry.dispose()
      hostSolid = fullTrim

      // Host brushes live in segment-local. Bring them into
      // dormer-mesh-local by inverting T(node.position) · R_y(node.rotation).
      const segToMesh = new THREE.Matrix4()
        .compose(
          new THREE.Vector3(
            dormer.position[0] ?? 0,
            dormer.position[1] ?? 0,
            dormer.position[2] ?? 0,
          ),
          new THREE.Quaternion().setFromAxisAngle(_yAxis, dormer.rotation),
          _scale,
        )
        .invert()
      csgGeometry(hostSolid).applyMatrix4(segToMesh)
      prepareBrushForCSG(hostSolid)

      const trimmed = csgEvaluator.evaluate(dormerSolid, hostSolid, SUBTRACTION) as Brush
      dormerSolid.geometry.dispose()
      hostSolid.geometry.dispose()
      hostSolid = null
      dormerSolid = trimmed
    }

    // Cut window openings on exposed gable faces.
    const exposed = getDormerExposedFaces(dormer, hostSegment)
    const skirtWin = getDormerSkirtWindowDims(dormer)
    const gableHalfZ = dormer.depth / 2
    const cutDepth = 0.4

    const cutFace = (zSign: number) => {
      const cutGeo = createDormerWindowCutGeometry(
        dormer,
        skirtWin.width,
        skirtWin.height,
        cutDepth,
      )
      cutGeo.translate(skirtWin.offsetX, skirtWin.centerY, zSign * gableHalfZ)
      if (!cutGeo.getIndex()) {
        const posCount = cutGeo.getAttribute('position').count
        const idx = new Uint32Array(posCount)
        for (let i = 0; i < posCount; i++) idx[i] = i
        cutGeo.setIndex(new THREE.BufferAttribute(idx, 1))
      }
      const idxCount = cutGeo.getIndex()!.count
      cutGeo.clearGroups()
      cutGeo.addGroup(0, idxCount, 0)
      computeGeometryBoundsTree(cutGeo)
      const brush = new Brush(cutGeo, dummyMats[0])
      brush.updateMatrixWorld()
      const result = csgEvaluator.evaluate(dormerSolid!, brush, SUBTRACTION) as Brush
      dormerSolid!.geometry.dispose()
      brush.geometry.dispose()
      dormerSolid = result
    }

    if (exposed.front) cutFace(+1)
    if (exposed.back) cutFace(-1)

    resultGeo = csgGeometry(dormerSolid)
    const resultMaterials = csgMaterials(dormerSolid)

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
    remapRoofShellFaces(resultGeo, virtualSegment)
    splitDormerGableMaterial(resultGeo, dormer.height, DORMER_GABLE_MATERIAL_INDEX)
  } catch (e) {
    // biome-ignore lint/suspicious/noConsole: dormer CSG can throw; keep diagnostic.
    console.error('[dormer] CSG failed, falling back to silhouette:', e)
    if (dormerSolid) {
      try {
        dormerSolid.geometry.dispose()
      } catch {}
    }
    if (hostSolid) {
      try {
        hostSolid.geometry.dispose()
      } catch {}
    }
    return buildDormerFallbackGeometry(dormer)
  }

  // If CSG produced zero triangles (host fully buried it, or one of the
  // boolean ops collapsed to empty), fall back to the silhouette so the
  // dormer is at least visible.
  const triCount = resultGeo.getIndex()?.count ?? resultGeo.getAttribute('position')?.count ?? 0
  if (triCount === 0) {
    // biome-ignore lint/suspicious/noConsole: keep diagnostic — empty CSG.
    console.warn('[dormer] CSG produced empty geometry; using fallback silhouette.')
    return buildDormerFallbackGeometry(dormer)
  }

  resultGeo.computeVertexNormals()
  ensureUv2Attribute(resultGeo)
  return resultGeo
}

/**
 * Build a cut brush representing the dormer's inner cavity for use
 * against the host roof's shin / deck / wall (so the host roof gets a
 * hole where the dormer sits). Mirrors `generateDormerGeometry`'s
 * virtual-segment + bake exactly: build the inner brush in
 * virtual-segment-local, apply the dormer's yaw + drop-below bake,
 * then the dormer's segment-local position + rotation, so the brush
 * lives in host-segment-local — the same frame the merged-roof CSG
 * loop operates in.
 *
 * Returns null on degenerate input so the caller can skip the cut.
 */
export function buildDormerCutBrush(dormer: DormerNode): Brush | null {
  // Defensive: bail on any non-finite or sub-millimeter dimension. A
  // degenerate cut brush passed to three-bvh-csg can produce a result
  // buffer with NaN positions / invalid indices, which the WebGPU
  // renderer then refuses to submit ("Invalid CommandBuffer") and the
  // error cascades to every subsequent submit.
  const dims = [
    dormer.width,
    dormer.depth,
    dormer.height,
    dormer.roofHeight,
    dormer.wallSkirtHeight,
    dormer.position[0],
    dormer.position[1],
    dormer.position[2],
    dormer.rotation,
  ]
  for (const v of dims) {
    if (!Number.isFinite(v)) return null
  }
  if (dormer.width < 0.01 || dormer.depth < 0.01) return null

  const skirt = dormerSkirtHeight(dormer)
  const wallThickness = 0.05
  const innerW = Math.max(0.05, dormer.width - 2 * wallThickness)
  const innerD = Math.max(0.05, dormer.depth - 2 * wallThickness)
  const wallH = Math.max(0.05, dormer.height)
  const roofH = Math.max(0, dormer.roofHeight)

  // Shape semantics match `buildSkylightCutBrush`: a single clean
  // indexed geometry, single material slot, welded vertices, bounds
  // tree — never a CSG-derived brush, otherwise three-bvh-csg's
  // three-way subtraction (shin / deck / wall) corrupts the result and
  // WebGPU rejects every subsequent command buffer.
  //
  // Cut footprint matches the dormer's INNER cavity (outer dim minus
  // the 0.05m wall thickness on each side); the dormer's own outer
  // wall sits over the resulting 5cm strip of host roof, hiding it
  // and preventing the sub-pixel gap an exact outer-footprint cut
  // would expose where dormer wall meets host roof.
  //
  // The shape ABOVE the eave varies per roof type so the host hole
  // matches the dormer body's outline:
  //   - flat:    box (no peak above the eave)
  //   - shed:    trapezoid with one sloped top edge
  //   - hip / dutch / mansard:  pyramid (narrows on all 4 sides)
  //   - gable / gambrel:        pentagon (narrows along width axis)
  const geo = buildDormerCutShape(dormer.roofType, innerW, innerD, skirt, wallH, roofH)

  // Yaw in the geometry's own (un-translated) frame so the cut aligns
  // with the dormer's footprint after rotation.
  if (Math.abs(dormer.rotation) > 1e-4) {
    geo.rotateY(dormer.rotation)
  }

  // Translate into segment-local. position[1] becomes the dormer's
  // local Y = 0 (the wall foot / eave line); the shape's foot at
  // local Y = -skirt then sits at world Y = position[1] - skirt.
  geo.translate(dormer.position[0], dormer.position[1], dormer.position[2])

  // Weld + single group + bounds tree — same recipe as skylight.
  const merged = mergeVertices(geo, 1e-4)
  const idxCount = merged.getIndex()?.count ?? 0
  merged.clearGroups()
  if (idxCount > 0) merged.addGroup(0, idxCount, 0)
  merged.computeVertexNormals()
  geo.dispose()

  computeGeometryBoundsTree(merged)
  const cleanBrush = new Brush(merged, dummyMats[0])
  cleanBrush.updateMatrixWorld()
  return cleanBrush
}

/**
 * Build the dormer cut shape in dormer-mesh-local coordinates. The
 * returned geometry is centered at X=Z=0 and spans Y ∈ [-skirt, peak]
 * — the caller layers on the dormer's yaw + position to bring it into
 * segment-local space.
 *
 * Shapes per roof type:
 * - **flat**:                a plain box (top flush with the eave; the
 *                            dormer body has no roof above wallH).
 * - **shed**:                trapezoid in YZ, extruded along X. Eave
 *                            at z=+d/2 (y=wallH), peak at z=-d/2
 *                            (y=wallH+roofH) — matches the slope
 *                            direction the dormer body uses.
 * - **gable / gambrel**:     pentagon (rectangle + symmetric triangle)
 *                            in XY, extruded along Z. Ridge runs
 *                            along Z (mesh-Z = virtualSegment-X after
 *                            the yaw bake).
 * - **hip / dutch / mansard**: pyramid — rectangular base, single
 *                            apex at the peak. Narrows on all four
 *                            sides.
 *
 * Gambrel / dutch / mansard fall back to gable / hip rather than the
 * legacy CSG-derived geometry, because three-bvh-csg's three-way
 * subtraction in the merged-roof loop can't accept CSG-derived
 * brushes without corrupting the result. The dormer body itself still
 * carries the precise per-type shape; the cut just needs to clear
 * enough of the host shell for the body to sit cleanly.
 */
function buildDormerCutShape(
  roofType: DormerNode['roofType'],
  innerW: number,
  innerD: number,
  skirt: number,
  wallH: number,
  roofH: number,
): THREE.BufferGeometry {
  const hw = innerW / 2
  const hd = innerD / 2

  if (roofType === 'flat') {
    const geo = new THREE.BoxGeometry(innerW, skirt + wallH, innerD)
    geo.translate(0, (wallH - skirt) / 2, 0)
    return geo
  }

  if (roofType === 'shed') {
    // Trapezoid in shape XY → extruded along Z (shape's natural
    // extrude axis) → rotated +π/2 around Y so the shape's X axis
    // ends up along mesh-(-Z) and the extrusion ends up along mesh-X.
    //
    // `getRoofSegmentBrushes`'s shed slope puts the peak at z=-d/2
    // and the eave at z=+d/2 (matching the `roofHeightAtZ` helper).
    // After the +π/2 rotation, shape-X=+hd → mesh-Z=-hd, so place the
    // PEAK at shape-X=+hd and the EAVE at shape-X=-hd to keep the cut
    // aligned with the dormer body's actual slope direction.
    const shape = new THREE.Shape()
    shape.moveTo(-hd, -skirt)
    shape.lineTo(hd, -skirt)
    shape.lineTo(hd, wallH + roofH) // peak (lands at mesh-Z = -d/2)
    shape.lineTo(-hd, wallH) // eave (lands at mesh-Z = +d/2)
    shape.closePath()
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: innerW,
      bevelEnabled: false,
    })
    geo.rotateY(Math.PI / 2)
    geo.translate(-innerW / 2, 0, 0) // centre along X
    return geo
  }

  if (roofType === 'hip' || roofType === 'dutch' || roofType === 'mansard') {
    // Truncated pyramid: rectangular base + eave rect + a top ridge
    // along the longer axis. Mirrors `getRoofSegmentBrushes`'s hip:
    //   run = min(w, d) / 2
    //   ridge length = |w - d| (zero when w == d → degenerates to a
    //                            single apex point)
    //
    // For non-shed dormers, `virtualSegment.width = dormer.depth` runs
    // along mesh-Z, so the longer-axis ridge direction follows the
    // larger of innerD vs. innerW.
    //
    // Triangle windings below are CCW from outside (verified
    // case-by-case via cross-product test); three-bvh-csg uses the
    // normals to determine inside/outside for SUBTRACTION, so an
    // inverted winding here would make the cut subtract the
    // complement of the dormer footprint — a hand-built pyramid is
    // the only shape in this file that does NOT get its windings from
    // Three.js geometry primitives, so we have to wind it carefully.
    const longerIsZ = innerD >= innerW
    const ridgeHalfLen = Math.max(0, (Math.max(innerW, innerD) - Math.min(innerW, innerD)) / 2)
    const peakY = wallH + roofH

    // Ridge endpoints in mesh frame.
    const ridgeA = longerIsZ
      ? ([0, peakY, -ridgeHalfLen] as const)
      : ([-ridgeHalfLen, peakY, 0] as const)
    const ridgeB = longerIsZ
      ? ([0, peakY, ridgeHalfLen] as const)
      : ([ridgeHalfLen, peakY, 0] as const)

    const positions = new Float32Array([
      // 0..3 = bottom rect (y = -skirt) — NW, NE, SE, SW
      -hw, -skirt, -hd,
      hw, -skirt, -hd,
      hw, -skirt, hd,
      -hw, -skirt, hd,
      // 4..7 = eave rect (y = wallH) — NW, NE, SE, SW
      -hw, wallH, -hd,
      hw, wallH, -hd,
      hw, wallH, hd,
      -hw, wallH, hd,
      // 8 = ridge endpoint A (- end along the ridge axis)
      ridgeA[0], ridgeA[1], ridgeA[2],
      // 9 = ridge endpoint B (+ end along the ridge axis)
      ridgeB[0], ridgeB[1], ridgeB[2],
    ])

    // Triangles (CCW from outside). Windings verified by computing
    // `(v1-v0) × (v2-v0)` for each triangle and checking the normal
    // points along the expected outward direction.
    const indices: number[] = [
      // Bottom (normal -Y).
      0, 1, 2, 0, 2, 3,
      // -Z wall (normal -Z) — eave 4,5 on top, base 0,1 below.
      1, 0, 4, 1, 4, 5,
      // +X wall (normal +X) — eave 5,6 on top, base 1,2 below.
      2, 1, 5, 2, 5, 6,
      // +Z wall (normal +Z) — eave 6,7 on top, base 2,3 below.
      3, 2, 6, 3, 6, 7,
      // -X wall (normal -X) — eave 7,4 on top, base 3,0 below.
      0, 3, 7, 0, 7, 4,
    ]

    if (longerIsZ) {
      // Ridge along Z. A=8 at -Z end, B=9 at +Z end.
      //   -Z end face (triangle, normal -Z/+Y): 4, 8, 5
      //   +X side face (quad, normal +X/+Y):    5, 9, 6 + 5, 8, 9
      //   +Z end face (triangle, normal +Z/+Y): 6, 9, 7
      //   -X side face (quad, normal -X/+Y):    7, 8, 4 + 7, 9, 8
      indices.push(4, 8, 5)
      indices.push(5, 9, 6, 5, 8, 9)
      indices.push(6, 9, 7)
      indices.push(7, 8, 4, 7, 9, 8)
    } else {
      // Ridge along X. A=8 at -X end, B=9 at +X end.
      //   -X end face (triangle, normal -X/+Y): 4, 7, 8
      //   -Z side face (quad, normal -Z/+Y):    4, 9, 5 + 4, 8, 9
      //   +X end face (triangle, normal +X/+Y): 5, 9, 6
      //   +Z side face (quad, normal +Z/+Y):    6, 8, 7 + 6, 9, 8
      indices.push(4, 7, 8)
      indices.push(4, 9, 5, 4, 8, 9)
      indices.push(5, 9, 6)
      indices.push(6, 8, 7, 6, 9, 8)
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1))
    // CSG evaluator requires 'uv'; cut brushes are never rendered so zeros are fine.
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((positions.length / 3) * 2), 2))
    geo.computeVertexNormals()
    return geo
  }

  if (roofType === 'gambrel') {
    // Gambrel: two-segment slope per side. `getRoofSegmentBrushes`
    // uses `run = depth / 4` and `rise = activeRh * 0.6` for the
    // outer (steeper) portion. The cut profile in XY mirrors that —
    // straight from eave up to a kink at (±hw/2, wallH + 0.6*roofH),
    // then up to the ridge at (0, wallH + roofH). Extruded along Z.
    const kinkX = hw / 2
    const kinkY = wallH + roofH * 0.6
    const shape = new THREE.Shape()
    shape.moveTo(-hw, -skirt)
    shape.lineTo(hw, -skirt)
    shape.lineTo(hw, wallH)
    shape.lineTo(kinkX, kinkY)
    shape.lineTo(0, wallH + roofH)
    shape.lineTo(-kinkX, kinkY)
    shape.lineTo(-hw, wallH)
    shape.closePath()
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: innerD,
      bevelEnabled: false,
    })
    geo.translate(0, 0, -innerD / 2)
    return geo
  }

  // gable (and any unrecognised type) — pentagon (rectangle +
  // symmetric triangle peak), extruded along Z. Ridge runs along Z,
  // matching mesh-Z which (for non-shed types) corresponds to the
  // virtualSegment-X gable ridge direction after the +π/2 yaw bake
  // the body geometry uses.
  const shape = new THREE.Shape()
  shape.moveTo(-hw, -skirt)
  shape.lineTo(hw, -skirt)
  shape.lineTo(hw, wallH)
  shape.lineTo(0, wallH + roofH)
  shape.lineTo(-hw, wallH)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: innerD,
    bevelEnabled: false,
  })
  geo.translate(0, 0, -innerD / 2)
  return geo
}

/**
 * Reassign slot-0 (wall) triangles whose entire footprint sits above
 * `wallHeight` to a separate material slot — lets the renderer colour
 * the rectangular wall and the gable triangle differently.
 */
function splitDormerGableMaterial(
  geometry: THREE.BufferGeometry,
  wallHeight: number,
  gableMatIndex: number,
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const index = geometry.getIndex()
  if (!(position && index) || index.count === 0 || geometry.groups.length === 0) return

  const triangleCount = index.count / 3
  if (triangleCount === 0) return

  const triangleMats = new Array<number>(triangleCount).fill(0)
  for (const g of geometry.groups) {
    const startTri = Math.floor(g.start / 3)
    const endTri = Math.floor((g.start + g.count) / 3)
    const mat = g.materialIndex ?? 0
    for (let i = startTri; i < endTri; i++) triangleMats[i] = mat
  }

  const epsilon = 0.001
  for (let i = 0; i < triangleCount; i++) {
    if (triangleMats[i] !== 0) continue
    const a = index.getX(i * 3)
    const b = index.getX(i * 3 + 1)
    const c = index.getX(i * 3 + 2)
    const ya = position.getY(a)
    const yb = position.getY(b)
    const yc = position.getY(c)
    if (ya > wallHeight + epsilon && yb > wallHeight + epsilon && yc > wallHeight + epsilon) {
      triangleMats[i] = gableMatIndex
    }
  }

  const sortedTri = Array.from({ length: triangleCount }, (_, i) => i)
  sortedTri.sort((a, b) => (triangleMats[a] ?? 0) - (triangleMats[b] ?? 0))

  const newIdx = new Uint32Array(index.count)
  for (let i = 0; i < sortedTri.length; i++) {
    const ti = sortedTri[i] as number
    newIdx[i * 3] = index.getX(ti * 3)
    newIdx[i * 3 + 1] = index.getX(ti * 3 + 1)
    newIdx[i * 3 + 2] = index.getX(ti * 3 + 2)
  }
  geometry.setIndex(new THREE.BufferAttribute(newIdx, 1))

  geometry.clearGroups()
  let groupStart = 0
  let curMat = triangleMats[sortedTri[0] as number] as number
  for (let i = 1; i < sortedTri.length; i++) {
    const mat = triangleMats[sortedTri[i] as number] as number
    if (mat !== curMat) {
      geometry.addGroup(groupStart, i * 3 - groupStart, curMat)
      groupStart = i * 3
      curMat = mat
    }
  }
  geometry.addGroup(groupStart, sortedTri.length * 3 - groupStart, curMat)
}
