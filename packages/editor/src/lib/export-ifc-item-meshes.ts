import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { ItemNode, sceneRegistry } from '@pascal-app/core'
import type { IfcItemMesh } from '@pascal-app/core/exporters/ifc'
import { resolveAssetUrl } from '@pascal-app/viewer'
import {
  Euler,
  type Mesh,
  Matrix4,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/'
const MIN_EXPORT_TRIANGLES = 20

const gltfSceneCache = new Map<string, Promise<Object3D>>()
let itemGltfLoader: GLTFLoader | null = null

function isMesh(object: Object3D): object is Mesh {
  return (object as Mesh).isMesh === true
}

function multiplyScales(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]]
}

function pascalVertexToIfcShapeLocal(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y]
}

function createItemGltfLoader(): GLTFLoader {
  if (itemGltfLoader) return itemGltfLoader

  const loader = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath(DRACO_DECODER_PATH)
  loader.setDRACOLoader(draco)
  loader.setMeshoptDecoder(MeshoptDecoder)
  itemGltfLoader = loader
  return loader
}

function appendMeshGeometry(
  mesh: Mesh,
  matrix: Matrix4,
  positions: number[],
  indices: number[],
  vertexBase: number,
): number {
  const geometry = mesh.geometry
  const positionAttr = geometry.getAttribute('position')
  if (!positionAttr || positionAttr.count === 0) return vertexBase

  const vertex = new Vector3()
  const indexAttr = geometry.index

  if (indexAttr) {
    for (let i = 0; i < indexAttr.count; i++) {
      vertex.fromBufferAttribute(positionAttr, indexAttr.getX(i))
      vertex.applyMatrix4(matrix)
      const [ix, iy, iz] = pascalVertexToIfcShapeLocal(vertex.x, vertex.y, vertex.z)
      positions.push(ix, iy, iz)
      indices.push(vertexBase++)
    }
    return vertexBase
  }

  for (let i = 0; i < positionAttr.count; i++) {
    vertex.fromBufferAttribute(positionAttr, i)
    vertex.applyMatrix4(matrix)
    const [ix, iy, iz] = pascalVertexToIfcShapeLocal(vertex.x, vertex.y, vertex.z)
    positions.push(ix, iy, iz)
    indices.push(vertexBase++)
  }

  return vertexBase
}

function buildMeshFromScene(
  root: Object3D,
  localMatrixForChild: (child: Object3D) => Matrix4,
): IfcItemMesh | null {
  const positions: number[] = []
  const indices: number[] = []
  let vertexBase = 0

  root.traverse((child) => {
    if (!isMesh(child) || child.name === 'cutout') return
    const matrix = localMatrixForChild(child)
    vertexBase = appendMeshGeometry(child, matrix, positions, indices, vertexBase)
  })

  if (indices.length < 3) return null
  return { positions, indices }
}

function extractItemLocalMesh(item: ItemNode, sceneRoot: Object3D): IfcItemMesh | null {
  sceneRoot.updateMatrixWorld(true)

  const assetScale = multiplyScales(item.asset.scale ?? [1, 1, 1], item.scale ?? [1, 1, 1])
  const correction = new Matrix4().compose(
    new Vector3(...item.asset.offset),
    new Quaternion().setFromEuler(new Euler(...item.asset.rotation, 'XYZ')),
    new Vector3(...assetScale),
  )

  return buildMeshFromScene(sceneRoot, (child) => correction.clone().multiply(child.matrixWorld))
}

function extractItemMeshFromSceneGroup(itemGroup: Object3D): IfcItemMesh | null {
  itemGroup.updateMatrixWorld(true)
  const groupInverse = itemGroup.matrixWorld.clone().invert()
  const localMatrix = new Matrix4()

  return buildMeshFromScene(itemGroup, (child) => {
    localMatrix.copy(child.matrixWorld).premultiply(groupInverse)
    return localMatrix
  })
}

async function loadGltfScene(url: string): Promise<Object3D> {
  const cached = gltfSceneCache.get(url)
  if (cached) return cached.then((scene) => scene.clone(true))

  const loader = createItemGltfLoader()
  const pending = (async () => {
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      const response = await fetch(url)
      const buffer = await response.arrayBuffer()
      return new Promise<Object3D>((resolve, reject) => {
        loader.parse(
          buffer,
          '',
          (gltf) => resolve(gltf.scene),
          (err) => reject(err instanceof Error ? err : new Error(String(err))),
        )
      })
    }

    return new Promise<Object3D>((resolve, reject) => {
      loader.load(
        url,
        (gltf) => resolve(gltf.scene),
        undefined,
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      )
    })
  })()

  gltfSceneCache.set(url, pending)
  return pending.then((scene) => scene.clone(true))
}

function isUsableExportMesh(mesh: IfcItemMesh | null): mesh is IfcItemMesh {
  return mesh != null && mesh.indices.length >= MIN_EXPORT_TRIANGLES
}

export async function collectItemMeshesForIfc(
  nodes: Record<AnyNodeId, AnyNode>,
): Promise<Record<string, IfcItemMesh>> {
  const items = Object.values(nodes).filter((node) => node.type === 'item')
  const meshes: Record<string, IfcItemMesh> = {}

  await Promise.all(
    items.map(async (rawItem) => {
      const item = ItemNode.parse(rawItem)

      const sceneGroup = sceneRegistry.nodes.get(item.id)
      if (sceneGroup) {
        const sceneMesh = extractItemMeshFromSceneGroup(sceneGroup)
        if (isUsableExportMesh(sceneMesh)) {
          meshes[item.id] = sceneMesh
          return
        }
      }

      const url = await resolveAssetUrl(item.asset.src)
      if (!url) return

      try {
        const scene = await loadGltfScene(url)
        const mesh = extractItemLocalMesh(item, scene)
        if (isUsableExportMesh(mesh)) meshes[item.id] = mesh
      } catch {
        // Ignore load failures; the IFC exporter falls back to bounding boxes.
      }
    }),
  )

  return meshes
}
