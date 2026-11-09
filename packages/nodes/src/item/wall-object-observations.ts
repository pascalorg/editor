import {
  type AnyNode,
  type AnyNodeId,
  isCutterName,
  itemClipRegistry,
  sceneRegistry,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import {
  registerSceneCheck,
  type WallObjectGeometry,
  type WallObjectObservation,
  wallObjectObservations,
} from '@pascal-app/core/agent-operations'
import { BATCHED_LAYER, SCENE_LAYER, useViewer } from '@pascal-app/viewer'
import {
  BackSide,
  DoubleSide,
  type Material,
  Matrix4,
  type Mesh,
  type Object3D,
  Vector3,
} from 'three'

const MAX_ITEM_TRIANGLES = 20_000
const MAX_SCENE_TRIANGLES = 100_000
const MAX_ITEM_OBJECTS = 2_000

type Budget = { triangles: number }

function helper(object: Object3D): boolean {
  const name = typeof object.userData.name === 'string' ? object.userData.name : object.name
  return (
    isCutterName(name) ||
    name === 'collider' ||
    isCutterName(object.name) ||
    object.name === 'collider'
  )
}

function visibleMaterial(material: Material | undefined): material is Material {
  return Boolean(material?.visible && material.opacity > 0)
}

function deformedMaterial(material: Material): boolean {
  const shader = material as Material & {
    isShaderMaterial?: boolean
    positionNode?: unknown
    displacementMap?: unknown
    displacementScale?: number
    wireframe?: boolean
  }
  return Boolean(
    shader.isShaderMaterial ||
      shader.positionNode ||
      (shader.displacementMap && shader.displacementScale !== 0) ||
      shader.wireframe,
  )
}

/** Read current transforms without updating the live hierarchy's matrices. */
function worldMatrix(object: Object3D, matrices: Map<Object3D, Matrix4>): Matrix4 {
  const cached = matrices.get(object)
  if (cached) return cached
  const matrix = !object.matrixWorldAutoUpdate
    ? object.matrixWorld.clone()
    : object.matrixAutoUpdate
      ? new Matrix4().compose(object.position, object.quaternion, object.scale)
      : object.matrix.clone()
  if (object.matrixWorldAutoUpdate && object.parent)
    matrix.premultiply(worldMatrix(object.parent, matrices))
  matrices.set(object, matrix)
  return matrix
}

function visibleBranch(object: Object3D): boolean {
  for (let ancestor: Object3D | null = object; ancestor; ancestor = ancestor.parent)
    if (!ancestor.visible) return false
  return true
}

function belongsToHost(object: Object3D, host: Object3D): boolean {
  for (let parent = object.parent; parent; parent = parent.parent) if (parent === host) return true
  return false
}

function geometryInWall(
  root: Object3D,
  inverseHost: Matrix4,
  registeredRoots: ReadonlySet<Object3D>,
  matrices: Map<Object3D, Matrix4>,
  budget: Budget,
): WallObjectGeometry | null {
  const result: WallObjectGeometry = { corners: [], faces: [] }
  let triangles = 0
  let objects = 0
  let unsupported = false
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const ab = new Vector3()
  const ac = new Vector3()
  const normal = new Vector3()

  const visit = (object: Object3D) => {
    if (unsupported || !object.visible || helper(object)) return
    // Hosted nodes have their own geometry/placement; never attribute it to their owner.
    if (object !== root && registeredRoots.has(object)) return
    if (++objects > MAX_ITEM_OBJECTS) {
      unsupported = true
      return
    }
    if (object.animations.length > 0) {
      unsupported = true
      return
    }
    const mesh = object as Mesh & {
      isSkinnedMesh?: boolean
      isInstancedMesh?: boolean
      isBatchedMesh?: boolean
    }
    // Wall-attached items currently draw themselves (item batches require a level parent).
    // If that changes, a hidden packed source cannot establish the batch's current pose.
    if (mesh.isMesh && mesh.layers.isEnabled(BATCHED_LAYER)) {
      unsupported = true
      return
    }
    if (mesh.isMesh && mesh.layers.isEnabled(SCENE_LAYER)) {
      const geometry = mesh.geometry
      const position = geometry?.getAttribute('position')
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (materials.some(visibleMaterial)) {
        if (
          mesh.isSkinnedMesh ||
          mesh.isInstancedMesh ||
          mesh.isBatchedMesh ||
          !position ||
          position.itemSize < 3 ||
          Object.values(geometry.morphAttributes).some((attributes) => attributes.length > 0) ||
          materials.some((material) => visibleMaterial(material) && deformedMaterial(material))
        ) {
          unsupported = true
          return
        }
        const transform = new Matrix4().multiplyMatrices(inverseHost, worldMatrix(mesh, matrices))
        const determinant = transform.determinant()
        if (!Number.isFinite(determinant) || determinant === 0) {
          unsupported = true
          return
        }
        const index = geometry.index
        const count = index?.count ?? position.count
        const drawStart = Math.max(0, geometry.drawRange.start)
        const drawEnd = Math.min(count, drawStart + geometry.drawRange.count)
        const groups = Array.isArray(mesh.material)
          ? geometry.groups
          : [{ start: 0, count, materialIndex: 0 }]
        const seenVertices = new Set<number>()
        for (const group of groups) {
          const material = materials[group.materialIndex ?? 0]
          if (!visibleMaterial(material)) continue
          const start = Math.max(drawStart, group.start)
          const end = Math.min(drawEnd, group.start + group.count)
          const groupTriangles = Math.floor((end - start) / 3)
          if (groupTriangles <= 0) continue
          triangles += groupTriangles
          budget.triangles += groupTriangles
          if (triangles > MAX_ITEM_TRIANGLES || budget.triangles > MAX_SCENE_TRIANGLES) {
            unsupported = true
            return
          }
          for (let offset = start; offset + 2 < end; offset += 3) {
            const indices = [0, 1, 2].map((i) => (index ? index.getX(offset + i) : offset + i))
            if (indices.some((i) => !Number.isInteger(i) || i < 0 || i >= position.count)) {
              unsupported = true
              return
            }
            const vertices = [a, b, c]
            for (let i = 0; i < 3; i++) {
              const vertex = vertices[i]!
              vertex.fromBufferAttribute(position, indices[i]!).applyMatrix4(transform)
              if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) {
                unsupported = true
                return
              }
            }
            normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a))
            if (!Number.isFinite(normal.lengthSq())) {
              unsupported = true
              return
            }
            if (normal.lengthSq() <= 1e-20) continue
            for (let i = 0; i < 3; i++) {
              const vertexIndex = indices[i]!
              if (seenVertices.has(vertexIndex)) continue
              seenVertices.add(vertexIndex)
              result.corners.push(vertices[i]!.toArray())
            }
            normal.normalize()
            // A shallow tilt can span centimetres despite a wall-parallel-looking normal.
            if (
              Math.abs(normal.z) < 0.999 ||
              Math.max(a.z, b.z, c.z) - Math.min(a.z, b.z, c.z) > 1e-5
            )
              continue
            // Three reverses front-face winding for mirrored meshes; BackSide then reverses
            // the rendered side again. DoubleSide represents both real sides of this triangle.
            if (determinant < 0) normal.negate()
            if (material.side === BackSide) normal.negate()
            const face: WallObjectGeometry['faces'][number] = {
              normal: normal.toArray(),
              depth: (a.z + b.z + c.z) / 3,
              polygon: vertices.map((vertex): [number, number] => [vertex.x, vertex.y]),
            }
            result.faces.push(face)
            if (material.side === DoubleSide)
              result.faces.push({
                ...face,
                normal: [-normal.x, -normal.y, -normal.z],
              })
          }
        }
      }
    }
    for (const child of object.children) visit(child)
  }
  visit(root)
  // Partial bounds from an oversized/deformed item are not evidence of its complete body.
  return unsupported || result.corners.length === 0 ? null : result
}

/** Actual settled mesh evidence, in each direct straight host wall's local frame. */
export function wallObjectRenderedObservations(
  nodes: Readonly<Record<string, AnyNode>>,
): WallObjectObservation[] {
  const current = useScene.getState()
  const overrides = useLiveNodeOverrides.getState()
  const transforms = useLiveTransforms.getState()
  const failures = useViewer.getState().itemLoadFailures
  const registeredRoots = new Set(sceneRegistry.nodes.values())
  const matrices = new Map<Object3D, Matrix4>()
  const rendered: Record<string, WallObjectGeometry> = {}
  const budget: Budget = { triangles: 0 }
  for (const item of Object.values(nodes)) {
    if (budget.triangles > MAX_SCENE_TRIANGLES) break
    if (
      item.type !== 'item' ||
      item.visible === false ||
      (item as AnyNode & { roomClearPreview?: boolean }).roomClearPreview === true ||
      (item.asset.attachTo !== 'wall' && item.asset.attachTo !== 'wall-side') ||
      current.nodes[item.id] !== item ||
      failures[item.id] ||
      itemClipRegistry.has(item.id) ||
      item.asset.interactive?.effects.some((effect) => effect.kind === 'animation')
    )
      continue
    const host = item.parentId ? nodes[item.parentId] : undefined
    if (
      host?.type !== 'wall' ||
      host.visible === false ||
      host.curveOffset ||
      current.nodes[host.id] !== host
    )
      continue
    if (
      overrides.get(item.id as AnyNodeId) ||
      overrides.get(host.id as AnyNodeId) ||
      transforms.get(item.id) ||
      transforms.get(host.id) ||
      current.dirtyNodes.has(item.id) ||
      current.dirtyNodes.has(host.id)
    )
      continue
    const root = sceneRegistry.nodes.get(item.id)
    const hostRoot = sceneRegistry.nodes.get(host.id)
    if (
      !root ||
      !hostRoot ||
      root.userData.itemModelSettled !== true ||
      root.userData.itemHasAnimations === true ||
      !visibleBranch(root) ||
      !belongsToHost(root, hostRoot)
    )
      continue
    const hostMatrix = worldMatrix(hostRoot, matrices)
    const determinant = hostMatrix.determinant()
    if (!Number.isFinite(determinant) || determinant === 0) continue
    const geometry = geometryInWall(
      root,
      hostMatrix.clone().invert(),
      registeredRoots,
      matrices,
      budget,
    )
    if (geometry) rendered[item.id] = geometry
  }
  return wallObjectObservations(nodes, rendered).filter((observation) => {
    if (!rendered[observation.itemId]) return false
    if (
      observation.type === 'item_wall_coplanar_face' ||
      observation.type === 'item_wall_object_coplanar_face'
    )
      return true
    const item = nodes[observation.itemId]
    return (
      item?.type === 'item' &&
      !item.source &&
      (observation.type === 'item_wall_body_overlap' || observation.type === 'item_through_wall')
    )
  })
}

export function registerWallObjectSceneCheck(): void {
  registerSceneCheck({
    name: 'wall-object-rendered-faces',
    order: 50,
    run: (nodes) => wallObjectRenderedObservations(nodes),
  })
}
