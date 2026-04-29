import { sceneRegistry, useScene } from '@pascal-app/core'
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import * as THREE from 'three'

const COLLIDER_NODE_TYPES = [
  'wall',
  'fence',
  'slab',
  'stair',
  'stair-segment',
  'roof',
  'roof-segment',
  'door',
  'item',
] as const

const SKIPPED_MESH_NAMES = new Set(['cutout', 'collision-mesh'])
const COLLIDER_MATERIAL = new THREE.MeshBasicMaterial()
const DOWN = new THREE.Vector3(0, -1, 0)
const UP = new THREE.Vector3(0, 1, 0)
const SPAWN_EYE_HEIGHT = 1.65
const RAYCAST_CLEARANCE = 25

export const FIRST_PERSON_SPAWN_EYE_HEIGHT = SPAWN_EYE_HEIGHT

export type FirstPersonColliderWorld = {
  mesh: THREE.Mesh
  bounds: THREE.Box3 | null
  dispose: () => void
}

export type FirstPersonSpawn = {
  position: [number, number, number]
  yaw: number
}

type ColliderNodeType = (typeof COLLIDER_NODE_TYPES)[number]

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return 'isMesh' in object && (object as THREE.Mesh).isMesh
}

function cloneWorldGeometry(mesh: THREE.Mesh) {
  const sourceGeometry = mesh.geometry
  const position = sourceGeometry.getAttribute('position')
  if (!position || position.count < 3) return null

  const workingGeometry = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone()
  const cleanGeometry = new THREE.BufferGeometry()
  cleanGeometry.setAttribute('position', workingGeometry.getAttribute('position').clone())

  const normal = workingGeometry.getAttribute('normal')
  if (normal) {
    cleanGeometry.setAttribute('normal', normal.clone())
  } else {
    cleanGeometry.computeVertexNormals()
  }

  cleanGeometry.applyMatrix4(mesh.matrixWorld)
  workingGeometry.dispose()

  const worldPosition = cleanGeometry.getAttribute('position')
  if (!worldPosition || worldPosition.count < 3) {
    cleanGeometry.dispose()
    return null
  }

  return cleanGeometry
}

function shouldSkipColliderNode(nodeId: string, type: (typeof COLLIDER_NODE_TYPES)[number]) {
  if (type !== 'door') return false

  const node = useScene.getState().nodes[nodeId]
  if (!node || node.type !== 'door') return false

  if (!node.segments.length) return true

  return node.segments.every((segment) => segment.type === 'empty')
}

function buildRegisteredNodeTypeLookup() {
  const nodeTypes = new Map<string, ColliderNodeType>()

  for (const type of COLLIDER_NODE_TYPES) {
    for (const nodeId of sceneRegistry.byType[type]) {
      nodeTypes.set(nodeId, type)
    }
  }

  return nodeTypes
}

function collectColliderGeometriesFromNode(
  root: THREE.Object3D,
  rootNodeId: string,
  visitedMeshes: WeakSet<THREE.Object3D>,
  registeredObjectIds: Map<THREE.Object3D, string>,
  registeredNodeTypes: Map<string, ColliderNodeType>,
): THREE.BufferGeometry[] {
  const geometries: THREE.BufferGeometry[] = []

  const visit = (object: THREE.Object3D) => {
    if (visitedMeshes.has(object)) return
    visitedMeshes.add(object)

    if (isMesh(object) && object.visible && !SKIPPED_MESH_NAMES.has(object.name)) {
      const geometry = cloneWorldGeometry(object)
      if (geometry) {
        geometries.push(geometry)
      }
    }

    for (const child of object.children) {
      const childNodeId = registeredObjectIds.get(child)
      if (childNodeId && childNodeId !== rootNodeId) {
        const childType = registeredNodeTypes.get(childNodeId)
        if (childType && COLLIDER_NODE_TYPES.includes(childType)) {
          continue
        }
      }

      visit(child)
    }
  }

  visit(root)

  return geometries
}

export function buildFirstPersonColliderWorldFromRegistry(): FirstPersonColliderWorld | null {
  const geometries: THREE.BufferGeometry[] = []
  const visitedMeshes = new WeakSet<THREE.Object3D>()
  const registeredNodeTypes = buildRegisteredNodeTypeLookup()
  const registeredObjectIds = new Map<THREE.Object3D, string>()

  for (const [nodeId, object] of sceneRegistry.nodes) {
    registeredObjectIds.set(object, nodeId)
  }

  for (const type of COLLIDER_NODE_TYPES) {
    for (const nodeId of sceneRegistry.byType[type]) {
      if (shouldSkipColliderNode(nodeId, type)) continue

      const root = sceneRegistry.nodes.get(nodeId)
      if (!root) continue

      root.updateMatrixWorld(true)
      geometries.push(
        ...collectColliderGeometriesFromNode(
          root,
          nodeId,
          visitedMeshes,
          registeredObjectIds,
          registeredNodeTypes,
        ),
      )
    }
  }

  if (geometries.length === 0) {
    return null
  }

  const mergedGeometry = mergeGeometries(geometries, false)
  geometries.forEach((geometry) => geometry.dispose())

  if (!mergedGeometry || mergedGeometry.getAttribute('position') == null) {
    mergedGeometry?.dispose()
    return null
  }

  const bvhGeometry = mergedGeometry as THREE.BufferGeometry & {
    computeBoundsTree?: typeof computeBoundsTree
    disposeBoundsTree?: typeof disposeBoundsTree
  }

  ;(bvhGeometry as any).computeBoundsTree = computeBoundsTree
  ;(bvhGeometry as any).disposeBoundsTree = disposeBoundsTree
  bvhGeometry.computeBoundsTree?.({
    maxLeafTris: 12,
    strategy: 0,
  } as never)
  bvhGeometry.computeBoundingBox()

  const mesh = new THREE.Mesh(bvhGeometry, COLLIDER_MATERIAL)
  mesh.raycast = acceleratedRaycast
  mesh.visible = true
  mesh.userData = {
    type: 'STATIC',
    friction: 0.8,
    restitution: 0.05,
    excludeFloatHit: false,
    excludeCollisionCheck: false,
  }
  mesh.updateMatrixWorld(true)

  return {
    mesh,
    bounds: bvhGeometry.boundingBox?.clone() ?? null,
    dispose: () => {
      bvhGeometry.disposeBoundsTree?.()
      bvhGeometry.dispose()
    },
  }
}

export function deriveFirstPersonSpawn(
  camera: THREE.Camera,
  world: FirstPersonColliderWorld,
): FirstPersonSpawn {
  const direction = new THREE.Vector3()
  camera.getWorldDirection(direction)
  direction.y = 0
  if (direction.lengthSq() < 1e-6) {
    direction.set(0, 0, -1)
  } else {
    direction.normalize()
  }

  const yaw = Math.atan2(-direction.x, -direction.z)
  const raycaster = new THREE.Raycaster()
  const candidates: Array<[number, number]> = [[camera.position.x, camera.position.z]]

  const boundsCenter = world.bounds?.getCenter(new THREE.Vector3())
  if (boundsCenter) {
    candidates.push([boundsCenter.x, boundsCenter.z])
  }

  for (const [x, z] of candidates) {
    const topY = Math.max(world.bounds?.max.y ?? camera.position.y, camera.position.y) + RAYCAST_CLEARANCE
    raycaster.set(new THREE.Vector3(x, topY, z), DOWN)
    const intersections = raycaster.intersectObject(world.mesh, false)
    const hit = intersections.find((intersection) => {
      if (!intersection.face) return true
      const normal = intersection.face.normal.clone().transformDirection(world.mesh.matrixWorld)
      return normal.dot(UP) > 0.2
    })

    if (hit) {
      return {
        position: [hit.point.x, hit.point.y + SPAWN_EYE_HEIGHT, hit.point.z],
        yaw,
      }
    }
  }

  return {
    position: [
      camera.position.x,
      Math.max(camera.position.y, SPAWN_EYE_HEIGHT),
      camera.position.z,
    ],
    yaw,
  }
}
