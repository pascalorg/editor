import { useFrame } from '@react-three/fiber'
import {
  type AnyNode,
  type AnyNodeId,
  type RoofNode,
  type RoofSegmentNode,
  type RoofType,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ADDITION, Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import { computeBoundsTree } from 'three-mesh-bvh'

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
      if (group) {
        const mergedMesh = group.getObjectByName('merged-roof') as THREE.Mesh | undefined
        if (mergedMesh?.visible !== false) {
          // Only rebuild when visible — RoofEditSystem re-triggers via markDirty on edit mode exit
          updateMergedRoofGeometry(node as RoofNode, group, nodes)
          roofsProcessed++
        }
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

    _matrix.compose(
      _position.set(child.position[0], child.position[1], child.position[2]),
      _quaternion.setFromAxisAngle(_yAxis, child.rotation),
      _scale,
    )

    const applyTransform = (brush: Brush) => {
      brush.geometry.applyMatrix4(_matrix)
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

      const resultGeo = combined.geometry

      const resultMaterials: THREE.Material[] = Array.isArray(combined.material)
        ? combined.material
        : [combined.material]

      const matToIndex = new Map<THREE.Material, number>([
        [dummyMats[0], 0],
        [dummyMats[1], 1],
        [dummyMats[2], 2],
        [dummyMats[3], 3],
      ])

      for (const g of resultGeo.groups) {
        g.materialIndex = mapRoofGroupMaterialIndex(g.materialIndex, resultMaterials, matToIndex)
      }

      ensureUv2Attribute(resultGeo)
      resultGeo.computeVertexNormals()
      mergedMesh.geometry.dispose()
      mergedMesh.geometry = resultGeo

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
  const sourceMaterial = csgMaterials[groupMaterialIndex]
  const mappedIndex = sourceMaterial ? matToIndex.get(sourceMaterial) : undefined
  return mappedIndex ?? 0
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

    resultGeo = combined.geometry

    const resultMaterials: THREE.Material[] = Array.isArray(combined.material)
      ? combined.material
      : [combined.material]

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
    resultGeo = wallBrush.geometry.clone()
  }

  deckSlab.geometry.dispose()
  shinSlab.geometry.dispose()
  wallBrush.geometry.dispose()
  innerBrush.geometry.dispose()

  ensureUv2Attribute(resultGeo)
  resultGeo.computeVertexNormals()
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

      pushRoofUv(uvs, p0, normal)
      pushRoofUv(uvs, fi, normal)
      pushRoofUv(uvs, fi1, normal)

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

  if (absX >= absZ) {
    uvs.push(point.z, point.y)
    return
  }

  uvs.push(point.x, point.y)
}

function ensureUv2Attribute(geometry: THREE.BufferGeometry) {
  const uv = geometry.getAttribute('uv')
  if (!uv) return

  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(Array.from(uv.array), 2))
}
