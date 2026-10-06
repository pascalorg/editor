import {
  type AnyNode,
  type AnyNodeId,
  computeSegmentTransforms,
  createStairFlightFromStair,
  getEffectiveNode,
  getFloorStackedPosition,
  measureStairDetail,
  resolveStraightStairConstruction,
  resolveWinderStairConstruction,
  type StairNode,
  type StairSegmentNode,
  sceneRegistry,
  stairSegmentConstructionError,
  stairSegmentDetailError,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const pendingStairUpdates = new Set<AnyNodeId>()
const MAX_STAIRS_PER_FRAME = 2
const MAX_SEGMENTS_PER_FRAME = 4
const STAIR_TREAD_MATERIAL_INDEX = 0
const STAIR_SIDE_MATERIAL_INDEX = 1
const _uvPosition = new THREE.Vector3()
const _uvNormal = new THREE.Vector3()

// ============================================================================
// STAIR SYSTEM
// ============================================================================

export const StairSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)
  const rootNodeIds = useScene((state) => state.rootNodeIds)

  useFrame(() => {
    if (rootNodeIds.length === 0) {
      pendingStairUpdates.clear()
      return
    }

    if (dirtyNodes.size === 0 && pendingStairUpdates.size === 0) return

    const nodes = useScene.getState().nodes

    // --- Pass 1: Process dirty stair-segments (throttled) ---
    // Collect parent stair IDs that need segment transform recomputation
    const parentsNeedingSegmentSync = new Set<AnyNodeId>()

    let segmentsProcessed = 0
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node) return

      if (node.type === 'stair-segment') {
        const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
        if (mesh) {
          const isVisible = mesh.parent?.visible !== false
          if (isVisible && segmentsProcessed < MAX_SEGMENTS_PER_FRAME) {
            // Geometry will be updated; chained position is applied in the parent sync pass below.
            // Merge live overrides so width / length / height drags update the
            // mesh in real time — the resize arrows publish to
            // `useLiveNodeOverrides` and only commit to scene on pointer-up, so
            // without this the geometry would rebuild from the pre-drag values.
            const effectiveSegment = getEffectiveNode(node as StairSegmentNode)
            updateStairSegmentGeometry(effectiveSegment, mesh)
            if (node.parentId) parentsNeedingSegmentSync.add(node.parentId as AnyNodeId)
            segmentsProcessed++
          } else if (isVisible) {
            return // Over budget — keep dirty, process next frame
          } else if (mesh.geometry.type === 'BoxGeometry') {
            // Replace BoxGeometry placeholder with a non-drawing degenerate one.
            mesh.geometry.dispose()
            mesh.geometry = createEmptyGeometry()
          }
          clearDirty(id as AnyNodeId)
        } else {
          clearDirty(id as AnyNodeId)
        }
        // Queue the parent stair for a merged geometry update
        if (node.parentId) {
          pendingStairUpdates.add(node.parentId as AnyNodeId)
        }
      } else if (node.type === 'stair') {
        pendingStairUpdates.add(id as AnyNodeId)
        // Also sync individual segment positions when in edit mode
        parentsNeedingSegmentSync.add(id as AnyNodeId)
        clearDirty(id as AnyNodeId)
      }
    })

    // --- Pass 1b: Sync chained transforms to individual segment meshes (edit mode) ---
    for (const stairId of parentsNeedingSegmentSync) {
      const baseStairNode = nodes[stairId]
      if (baseStairNode?.type !== 'stair') continue
      // Merge any in-flight drag override (e.g. parent-stair rotate handle)
      // so slab-elevation spatial queries match where the segments are
      // actually being rendered. Without this, dragging the rotate gizmo
      // looks up slabs at the pre-drag world XZ — if rotation carries a
      // segment off the original slab footprint, the floor-stack
      // resolver would otherwise read the pre-drag footprint and drop
      // the flight or landing below the floor mid-drag.
      const stairNode = getEffectiveNode(baseStairNode as StairNode)
      const group = sceneRegistry.nodes.get(stairId) as THREE.Group | undefined
      if (group) {
        syncStairGroupElevation(stairNode, group, nodes)
      }
      syncSegmentMeshTransforms(stairNode, nodes)
    }

    // --- Pass 2: Process pending merged-stair updates (throttled) ---
    let stairsProcessed = 0
    for (const id of pendingStairUpdates) {
      if (stairsProcessed >= MAX_STAIRS_PER_FRAME) break

      const node = nodes[id]
      if (node?.type !== 'stair') {
        pendingStairUpdates.delete(id)
        continue
      }
      const group = sceneRegistry.nodes.get(id) as THREE.Group
      if (group) {
        const mergedMesh = group.getObjectByName('merged-stair') as THREE.Mesh | undefined
        if (mergedMesh?.visible !== false) {
          updateMergedStairGeometry(getEffectiveNode(node as StairNode), group, nodes)
          stairsProcessed++
        }
      }
      pendingStairUpdates.delete(id)
    }
  }, 5)

  return null
}

// ============================================================================
// SEGMENT GEOMETRY
// ============================================================================

/**
 * Generates the step/landing profile as a THREE.Shape (in the XY plane),
 * then extrudes along Z for the segment width.
 */
function generateStairSegmentGeometry(
  segment: StairSegmentNode,
  absoluteHeight: number,
  parent?: StairNode,
): THREE.BufferGeometry {
  if (stairSegmentDetailError(segment) || stairSegmentConstructionError(segment, parent))
    return createEmptyGeometry()
  const winderPieces = resolveWinderStairConstruction(segment, absoluteHeight, parent)
  if (winderPieces) {
    const geometries = winderPieces.map((piece) => {
      const polygon = piece.polygon
      const faces = THREE.ShapeUtils.triangulateShape(
        polygon.map(([x, z]) => new THREE.Vector2(x, z)),
        [],
      )
      const positions: number[] = [],
        materials: number[] = []
      const vertex = (i: number, top: boolean): number[] => [
        polygon[i]![0],
        top ? piece.top : piece.bottom[i]!,
        polygon[i]![1],
      ]
      const triangle = (a: number[], b: number[], c: number[], material: number) => {
        positions.push(...a, ...b, ...c)
        materials.push(material)
      }
      for (const face of faces) {
        let [a, b, c] = face as [number, number, number]
        const pa = polygon[a]!,
          pb = polygon[b]!,
          pc = polygon[c]!
        if ((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) < 0)
          [b, c] = [c, b]
        triangle(
          vertex(a!, true),
          vertex(c!, true),
          vertex(b!, true),
          piece.role === 'tread' || piece.walkingTop ? 0 : 1,
        )
        triangle(
          vertex(a!, false),
          vertex(b!, false),
          vertex(c!, false),
          piece.role === 'tread' ? 0 : 1,
        )
      }
      const signedArea = polygon.reduce((sum, a, i) => {
        const b = polygon[(i + 1) % polygon.length]!
        return sum + a[0] * b[1] - a[1] * b[0]
      }, 0)
      const ring =
        signedArea > 0 ? polygon.map((_, i) => i) : polygon.map((_, i) => polygon.length - 1 - i)
      for (let k = 0; k < ring.length; k++) {
        const i = ring[k]!,
          j = ring[(k + 1) % ring.length]!
        triangle(vertex(i, true), vertex(j, true), vertex(j, false), piece.role === 'tread' ? 0 : 1)
        triangle(
          vertex(i, true),
          vertex(j, false),
          vertex(i, false),
          piece.role === 'tread' ? 0 : 1,
        )
      }
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.computeVertexNormals()
      const uvs: number[] = []
      for (let i = 0; i < positions.length; i += 9) {
        const a = new THREE.Vector3(...(positions.slice(i, i + 3) as [number, number, number])),
          b = new THREE.Vector3(...(positions.slice(i + 3, i + 6) as [number, number, number])),
          c = new THREE.Vector3(...(positions.slice(i + 6, i + 9) as [number, number, number]))
        const u = b.clone().sub(a).normalize(),
          normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize(),
          v = normal.clone().cross(u)
        uvs.push(a.dot(u), a.dot(v), b.dot(u), b.dot(v), c.dot(u), c.dot(v))
      }
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
      ensureUv2Attribute(geometry)
      materials.forEach((material, i) => {
        geometry.addGroup(i * 3, 3, material)
      })
      return geometry
    })
    const result = mergeGeometries(geometries, true) ?? createEmptyGeometry()
    result.clearGroups()
    let offset = 0
    for (const geometry of geometries) {
      for (const group of geometry.groups)
        result.addGroup(offset + group.start, group.count, group.materialIndex)
      offset += geometry.getAttribute('position').count
      geometry.dispose()
    }
    result.userData.stairConstructionGroups = true
    return result
  }
  const pieces = resolveStraightStairConstruction(segment, absoluteHeight, parent)
  if (pieces) {
    const geometries = pieces.map((piece) => {
      const shape = new THREE.Shape(piece.profile.map(([z, y]) => new THREE.Vector2(z, y)))
      const geometry = new THREE.ExtrudeGeometry(shape, {
        steps: 1,
        depth: piece.x1 - piece.x0,
        bevelEnabled: false,
      })
      const matrix = new THREE.Matrix4().makeRotationY(-Math.PI / 2)
      matrix.setPosition(piece.x1, 0, 0)
      geometry.applyMatrix4(matrix)
      geometry.computeVertexNormals()
      applyStairSegmentUvs(geometry)
      ensureUv2Attribute(geometry)
      if (piece.role === 'tread' || !piece.walkingTop) {
        geometry.clearGroups()
        geometry.addGroup(
          0,
          geometry.getAttribute('position').count,
          piece.role === 'tread' ? STAIR_TREAD_MATERIAL_INDEX : STAIR_SIDE_MATERIAL_INDEX,
        )
      } else applyStraightStairMaterialGroups(geometry)
      return geometry
    })
    const result = mergeGeometries(geometries, true) ?? createEmptyGeometry()
    result.clearGroups()
    let offset = 0
    for (const geometry of geometries) {
      for (const group of geometry.groups)
        result.addGroup(offset + group.start, group.count, group.materialIndex)
      offset += geometry.getAttribute('position').count
      geometry.dispose()
    }
    result.userData.stairConstructionGroups = true
    return result
  }
  const { width, length, height, stepCount, segmentType, fillToFloor, thickness } = segment

  const shape = new THREE.Shape()

  if (segmentType === 'landing') {
    shape.moveTo(0, 0)
    shape.lineTo(length, 0)

    if (fillToFloor) {
      shape.lineTo(length, -absoluteHeight)
      shape.lineTo(0, -absoluteHeight)
    } else {
      shape.lineTo(length, -thickness)
      shape.lineTo(0, -thickness)
    }
  } else {
    const riserHeight = height / stepCount
    const treadDepth = length / stepCount

    shape.moveTo(0, 0)

    // Draw step profile
    for (let i = 0; i < stepCount; i++) {
      shape.lineTo(i * treadDepth, (i + 1) * riserHeight)
      shape.lineTo((i + 1) * treadDepth, (i + 1) * riserHeight)
    }

    if (fillToFloor) {
      shape.lineTo(length, -absoluteHeight)
      shape.lineTo(0, -absoluteHeight)
    } else {
      // Sloped bottom with consistent thickness
      const angle = Math.atan(riserHeight / treadDepth)
      const vOff = thickness / Math.cos(angle)

      // Bottom-back corner
      shape.lineTo(length, height - vOff)

      if (absoluteHeight === 0) {
        // Ground floor: slope hits the ground (y=0)
        const m = riserHeight / treadDepth
        const xGround = length - (height - vOff) / m

        if (xGround > 0) {
          shape.lineTo(xGround, 0)
        }
      } else {
        // Floating: parallel slope
        shape.lineTo(0, -vOff)
      }
    }
  }

  shape.lineTo(0, 0)

  const extrudedGeometry = new THREE.ExtrudeGeometry(shape, {
    steps: 1,
    depth: width,
    bevelEnabled: false,
  })

  // Rotate so extrusion is along X (width), and the shape is in the XZ plane
  // Shape is drawn in XY, extruded along Z → rotate -90° around Y then offset
  const matrix = new THREE.Matrix4()
  matrix.makeRotationY(-Math.PI / 2)
  matrix.setPosition(width / 2, 0, 0)
  extrudedGeometry.applyMatrix4(matrix)
  extrudedGeometry.computeVertexNormals()

  const geometry = extrudedGeometry.index ? extrudedGeometry.toNonIndexed() : extrudedGeometry
  if (geometry !== extrudedGeometry) {
    extrudedGeometry.dispose()
  }

  applyStairSegmentUvs(geometry)
  ensureUv2Attribute(geometry)

  return geometry
}

function updateStairSegmentGeometry(node: StairSegmentNode, mesh: THREE.Mesh) {
  // Compute absolute height from parent chain
  const absoluteHeight = computeAbsoluteHeight(node)

  const parent = node.parentId ? useScene.getState().nodes[node.parentId as AnyNodeId] : undefined
  const effectiveParent = parent?.type === 'stair' ? getEffectiveNode(parent) : undefined
  const newGeometry = generateStairSegmentGeometry(node, absoluteHeight, effectiveParent)
  applyStraightStairMaterialGroups(newGeometry)

  mesh.geometry.dispose()
  mesh.geometry = newGeometry

  // NOTE: position/rotation are NOT set here — they're set by syncSegmentMeshTransforms
  // which computes the chained position based on segment order and attachmentSide.
}

/**
 * Applies chained transforms to individual segment meshes (edit mode).
 * Each segment's world position is determined by the chain of previous segments,
 * not by the node's stored position field.
 */
function syncSegmentMeshTransforms(stairNode: StairNode, nodes: Record<string, AnyNode>) {
  // Merge live overrides into each segment so the chain math reflects the
  // in-flight drag (a width / length change shifts every downstream segment's
  // anchor). Without this, dragging a width handle would resize the dragged
  // segment's mesh but leave subsequent segments at their pre-drag positions.
  const segments = (stairNode.children ?? [])
    .map((childId) => nodes[childId as AnyNodeId] as StairSegmentNode | undefined)
    .filter((n): n is StairSegmentNode => n?.type === 'stair-segment')
    .map((n) => getEffectiveNode(n))

  if (segments.length === 0) return

  const transforms = computeSegmentTransforms(segments)

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    const transform = transforms[i]!
    const mesh = sceneRegistry.nodes.get(segment.id) as THREE.Mesh | undefined
    if (mesh) {
      if (mesh.position.y !== transform.position[1]) useScene.getState().markDirty(segment.id)
      mesh.position.set(transform.position[0], transform.position[1], transform.position[2])
      mesh.rotation.y = transform.rotation
    }
  }
}

function syncStairGroupElevation(
  stairNode: StairNode,
  group: THREE.Group,
  nodes: Record<string, AnyNode>,
) {
  const effectiveNodes: Record<string, AnyNode> = { ...nodes, [stairNode.id]: stairNode }
  for (const childId of stairNode.children ?? []) {
    const segment = nodes[childId as AnyNodeId]
    if (segment?.type === 'stair-segment') {
      effectiveNodes[segment.id] = getEffectiveNode(segment as StairSegmentNode)
    }
  }
  const visualPosition = getFloorStackedPosition({
    node: stairNode,
    nodes: effectiveNodes,
    position: stairNode.position,
    rotation: stairNode.rotation,
  })
  group.position.y = visualPosition[1]
}

// ============================================================================
// MERGED STAIR GEOMETRY
// ============================================================================

const _matrix = new THREE.Matrix4()
const _position = new THREE.Vector3()
const _quaternion = new THREE.Quaternion()
const _scale = new THREE.Vector3(1, 1, 1)
const _yAxis = new THREE.Vector3(0, 1, 0)

function updateMergedStairGeometry(
  stairNode: StairNode,
  group: THREE.Group,
  nodes: Record<string, AnyNode>,
) {
  const mergedMesh = group.getObjectByName('merged-stair') as THREE.Mesh | undefined
  if (!mergedMesh) return

  if (stairNode.stairType === 'curved' || stairNode.stairType === 'spiral') {
    replaceMeshGeometry(mergedMesh, createEmptyGeometry())
    return
  }

  const children = stairNode.children ?? []
  // Merge live overrides — same reason as `syncSegmentMeshTransforms`: a
  // width / length / height drag publishes the new value to
  // `useLiveNodeOverrides`, so the merged geometry has to read through that
  // overlay or the merged mesh stays at pre-drag values until pointer-up.
  const segments = children
    .map((childId) => nodes[childId as AnyNodeId] as StairSegmentNode | undefined)
    .filter((n): n is StairSegmentNode => n?.type === 'stair-segment')
    .map((n) => getEffectiveNode(n))

  // A straight stair with no segments has nothing to merge and would render as
  // nothing at all — the state a stair authored as curved lands in the moment
  // it is switched to straight. Draw the flight its own fields describe
  // instead of vanishing; it is the same flight the panel materializes.
  const bodySegments =
    segments.length > 0 ? segments : [createStairFlightFromStair(stairNode, nodes)]

  if (measureStairDetail(stairNode, bodySegments).error) {
    replaceMeshGeometry(mergedMesh, createEmptyGeometry())
    return
  }

  // Compute chained transforms for segments
  const transforms = computeSegmentTransforms(bodySegments)

  const geometries: THREE.BufferGeometry[] = []
  const materialOffsets: number[] = []

  for (let i = 0; i < bodySegments.length; i++) {
    const segment = bodySegments[i]!
    if (segment.visible === false) continue
    materialOffsets.push(i * 2)
    const transform = transforms[i]!

    const absoluteHeight = transform.position[1]
    const geo = generateStairSegmentGeometry(segment, absoluteHeight, stairNode)
    applyStraightStairMaterialGroups(geo)

    // Apply segment transform (position + rotation) relative to parent stair
    _position.set(transform.position[0], transform.position[1], transform.position[2])
    _quaternion.setFromAxisAngle(_yAxis, transform.rotation)
    _matrix.compose(_position, _quaternion, _scale)
    geo.applyMatrix4(_matrix)

    geometries.push(geo)
  }

  const merged =
    (geometries.length ? mergeGeometries(geometries, false) : null) ?? createEmptyGeometry()
  merged.clearGroups()
  let vertexOffset = 0
  for (const [index, geometry] of geometries.entries()) {
    for (const group of geometry.groups)
      merged.addGroup(
        vertexOffset + group.start,
        group.count,
        materialOffsets[index]! + (group.materialIndex ?? 0),
      )
    vertexOffset += geometry.getAttribute('position').count
  }
  mergedMesh.userData.slotIds = bodySegments.flatMap(() => ['treads', 'body'])
  mergedMesh.userData.surfaceNodeIds = bodySegments.flatMap((segment) => [segment.id, segment.id])
  mergedMesh.userData.segmentIds = bodySegments.flatMap((segment) => [segment.id, segment.id])
  replaceMeshGeometry(mergedMesh, merged)

  // Dispose individual geometries
  for (const geo of geometries) {
    geo.dispose()
  }
}

function applyStraightStairMaterialGroups(geometry: THREE.BufferGeometry) {
  if (geometry.userData.stairConstructionGroups) return
  const position = geometry.getAttribute('position')
  if (!position || position.count < 3) {
    geometry.clearGroups()
    return
  }

  const index = geometry.getIndex()
  const triangleCount = index ? index.count / 3 : position.count / 3

  if (!Number.isFinite(triangleCount) || triangleCount <= 0) {
    geometry.clearGroups()
    return
  }

  const triangleMaterials: number[] = new Array(triangleCount)
  const v0 = new THREE.Vector3()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  const edge1 = new THREE.Vector3()
  const edge2 = new THREE.Vector3()
  const normal = new THREE.Vector3()

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
    const vertexOffset = triangleIndex * 3
    const a = index ? index.getX(vertexOffset) : vertexOffset
    const b = index ? index.getX(vertexOffset + 1) : vertexOffset + 1
    const c = index ? index.getX(vertexOffset + 2) : vertexOffset + 2

    v0.fromBufferAttribute(position, a)
    v1.fromBufferAttribute(position, b)
    v2.fromBufferAttribute(position, c)

    edge1.subVectors(v1, v0)
    edge2.subVectors(v2, v0)
    normal.crossVectors(edge1, edge2)

    triangleMaterials[triangleIndex] =
      normal.lengthSq() > 0 && normal.normalize().y > 0.75
        ? STAIR_TREAD_MATERIAL_INDEX
        : STAIR_SIDE_MATERIAL_INDEX
  }

  geometry.clearGroups()

  let currentMaterial = triangleMaterials[0]
  let groupStart = 0

  for (let triangleIndex = 1; triangleIndex < triangleMaterials.length; triangleIndex++) {
    const materialIndex = triangleMaterials[triangleIndex]
    if (materialIndex === currentMaterial) continue

    geometry.addGroup(groupStart * 3, (triangleIndex - groupStart) * 3, currentMaterial)
    groupStart = triangleIndex
    currentMaterial = materialIndex
  }

  geometry.addGroup(
    groupStart * 3,
    (triangleMaterials.length - groupStart) * 3,
    currentMaterial ?? STAIR_SIDE_MATERIAL_INDEX,
  )
}

function applyStairSegmentUvs(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')

  if (!(position && normal) || position.count === 0) {
    geometry.deleteAttribute('uv')
    return
  }

  const uv: number[] = []

  for (let index = 0; index < position.count; index++) {
    _uvPosition.fromBufferAttribute(position, index)
    _uvNormal.fromBufferAttribute(normal, index).normalize()

    const absX = Math.abs(_uvNormal.x)
    const absY = Math.abs(_uvNormal.y)
    const absZ = Math.abs(_uvNormal.z)

    if (absY >= absX && absY >= absZ) {
      uv.push(_uvPosition.x, _uvPosition.z)
    } else if (absX >= absZ) {
      uv.push(_uvPosition.z, _uvPosition.y)
    } else {
      uv.push(_uvPosition.x, _uvPosition.y)
    }
  }

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
}

function ensureUv2Attribute(geometry: THREE.BufferGeometry) {
  const uv = geometry.getAttribute('uv')
  if (!uv) return

  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(Array.from(uv.array), 2))
}

// ============================================================================
// SEGMENT CHAINING
// ============================================================================

function createEmptyGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  // Three zero-vertices (one degenerate, invisible triangle), not an empty
  // attribute: an empty position (count 0) leaves WebGPU vertex buffer slot 0
  // unbound and the draw is rejected ("Vertex buffer slot 0 … was not set"),
  // poisoning the command encoder. The count-0 groups keep nothing drawn.
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
  geometry.addGroup(0, 0, STAIR_TREAD_MATERIAL_INDEX)
  geometry.addGroup(0, 0, STAIR_SIDE_MATERIAL_INDEX)
  return geometry
}

function replaceMeshGeometry(mesh: THREE.Mesh, geometry: THREE.BufferGeometry) {
  mesh.geometry.dispose()
  mesh.geometry = geometry
}

/**
 * Computes the absolute Y height of a segment by traversing the stair's segment chain.
 */
function computeAbsoluteHeight(node: StairSegmentNode): number {
  const nodes = useScene.getState().nodes
  if (!node.parentId) return 0

  const parent = nodes[node.parentId as AnyNodeId]
  if (parent?.type !== 'stair') return 0

  const stair = getEffectiveNode(parent)
  const segments = (stair.children ?? [])
    .map((childId) => nodes[childId as AnyNodeId] as StairSegmentNode | undefined)
    .filter((n): n is StairSegmentNode => n?.type === 'stair-segment')
    .map((segment) => getEffectiveNode(segment))

  const transforms = computeSegmentTransforms(segments)
  const index = segments.findIndex((s) => s.id === node.id)
  if (index < 0) return 0

  return transforms[index]?.position[1] ?? 0
}
